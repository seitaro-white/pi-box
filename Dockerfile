# syntax=docker/dockerfile:1
# Image built without --target (see the final stage). pi-box.yaml selects sandbox.
ARG PI_BOX_TARGET=recommended

# User-neutral OS packages and Python, shared by every image.
FROM docker.io/library/node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS system

# Development tools (Debian packages are not snapshot-pinned).
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash bat ca-certificates curl fd-find gh git iproute2 make micro nano nnn postgresql-client ripgrep tmux \
    && rm -rf /var/lib/apt/lists/*

# uv and a baseline Python interpreter.
COPY --from=ghcr.io/astral-sh/uv:0.12.23@sha256:61d393e44e249f2e4b526b6c7ddcecce245946826e608e11c93ad4f5bba55b21 /uv /uvx /usr/local/bin/
RUN UV_PYTHON_INSTALL_DIR=/opt/python UV_PYTHON_BIN_DIR=/usr/local/bin \
    uv python install 3.13.16 --default --no-cache

# Bundled Pi packages and CLI tools for the recommended and sandbox images.
# Everything lives under /opt so either image can add its own user and paths.
FROM system AS tools
WORKDIR /opt/pi
ARG RUFF_VERSION=0.17.0
RUN UV_TOOL_DIR=/opt/ruff UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_PYTHON_INSTALL_DIR=/opt/python UV_PYTHON_DOWNLOADS=never \
    uv tool install --no-cache --python /usr/local/bin/python3 "ruff==${RUFF_VERSION}"
ARG TY_VERSION=0.0.92
RUN UV_TOOL_DIR=/opt/ty UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_PYTHON_INSTALL_DIR=/opt/python UV_PYTHON_DOWNLOADS=never \
    uv tool install --no-cache --python /usr/local/bin/python3 "ty==${TY_VERSION}"
COPY container/package.json container/package-lock.json container/prepare-runtime.mjs container/init-agent.mjs ./
# npm can canonicalize GitHub Git sources to SSH; force anonymous HTTPS for builds.
RUN node prepare-runtime.mjs recommended \
    && GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf \
       GIT_CONFIG_VALUE_0=ssh://git@github.com/ \
       npm ci --cache /tmp/npm-cache --omit=dev --ignore-scripts --no-audit --no-fund \
    && rm -rf /tmp/npm-cache \
    && node node_modules/@anthropic-ai/claude-code/install.cjs \
    && node_modules/.bin/claude --version \
    && ln -s /opt/pi/node_modules/.bin/pi /usr/local/bin/pi \
    && ln -s /opt/pi/node_modules/.bin/biome /usr/local/bin/biome \
    && ln -s /opt/pi/node_modules/.bin/claude /usr/local/bin/claude
# BuildKit resolves main on every build and keys the cache by its commit.
# Keep the old package path so existing settings and resource filters still work.
ADD https://github.com/seitaro-white/personal-agent-skills.git#main /opt/pi/node_modules/personal-skills/

# Docker Sandboxes kit image (pi-box.yaml): mountless, no Herdr or Hunk.
FROM tools AS sandbox
USER root
RUN usermod -l agent -d /home/agent -m node \
    && groupmod -n agent node
# sbx launch contract: agent UID 1000, bash, writable workspace and trusted CA.
RUN install -d -m 0700 -o agent -g agent /home/agent/workspace \
        /home/agent/.pi/agent /home/agent/.local/bin \
        /home/agent/.local/share /home/agent/.local/state \
        /home/agent/.config/git /home/agent/.docker/sandbox/locks \
    && printf '%s\n' 'umask 077' > /etc/sandbox-persistent.sh \
    && chown agent:agent /etc/sandbox-persistent.sh \
    && printf '%s\n' '. /etc/sandbox-persistent.sh' > /etc/profile.d/sandbox-persistent.sh \
    && printf '%s\n' '. /etc/sandbox-persistent.sh' >> /home/agent/.bashrc
ENV HOME=/home/agent \
    PATH=/home/agent/.local/bin:$PATH \
    BASH_ENV=/etc/sandbox-persistent.sh \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
    NODE_USE_ENV_PROXY=1 \
    EDITOR=micro VISUAL=micro PAGER=batcat LANG=C.UTF-8 TERM=xterm-256color
USER agent
# Register bundled extensions once, without touching runtime login credentials.
RUN node /opt/pi/init-agent.mjs
WORKDIR /home/agent/workspace
# Plain shell: session management belongs to the user.
ENTRYPOINT []
CMD ["/bin/bash", "-l"]

# Compose images: the node user, persistent-volume paths and startup scripts.
FROM system AS common
ENV UV_PYTHON_INSTALL_DIR=/home/node/.pi/agent/python \
    UV_PYTHON_BIN_DIR=/home/node/.pi/agent/bin \
    UV_TOOL_DIR=/home/node/.pi/agent/uv-tools \
    UV_TOOL_BIN_DIR=/home/node/.pi/agent/bin \
    PATH=/home/node/.pi/agent/bin:$PATH

COPY container/entrypoint.sh /usr/local/bin/pi-box-entrypoint
COPY container/tmux.conf /etc/tmux.conf
COPY container/gitconfig /etc/gitconfig
COPY container/init-agent.mjs container/init-git.mjs container/prepare-runtime.mjs /opt/pi/
RUN chmod 0755 /usr/local/bin/pi-box-entrypoint \
    && install -d -m 0700 -o node -g node /workspace /home/node/.pi /home/node/.pi/agent \
        /home/node/.config /home/node/.config/git /home/node/.herdr

# UTF-8 prevents tmux from replacing Unicode UI characters.
ENV HOME=/home/node \
    EDITOR=micro \
    VISUAL=micro \
    PAGER=batcat \
    GIT_CONFIG_GLOBAL=/home/node/.config/git/config \
    GH_CONFIG_DIR=/home/node/.config/git/gh \
    LANG=C.UTF-8 \
    TERM=xterm-256color \
    PI_TELEMETRY=0

# Image-owned guidance stays current and is not hidden by persistent volumes.
# Pi loads ancestor AGENTS.md files and discovers ~/.agents/skills automatically.
COPY container/defaults/AGENTS.md /AGENTS.md
COPY container/skills/pi-box/SKILL.md /home/node/.agents/skills/pi-box/SKILL.md

ENTRYPOINT ["/usr/local/bin/pi-box-entrypoint"]
CMD ["tmux", "-D"]

# Root's build-time npm cache must not touch the runtime user's home directory.
# The base lockfile describes only Pi. Derive its manifest from the same source
# used by recommended; npm ci fails if the derived manifest and lock disagree.
FROM common AS base
USER root
WORKDIR /opt/pi
COPY container/package.json ./
COPY container/base/package-lock.json ./package-lock.json
RUN node prepare-runtime.mjs base \
    && npm ci --cache /tmp/npm-cache --omit=dev --ignore-scripts --no-audit --no-fund \
    && rm -rf /tmp/npm-cache \
    && ln -s /opt/pi/node_modules/.bin/pi /usr/local/bin/pi
USER node
WORKDIR /workspace

# Pi, bundled extensions and their CLI tools.
FROM common AS recommended
USER root
WORKDIR /opt/pi
COPY --from=tools /opt/ruff /opt/ruff
COPY --from=tools /opt/ty /opt/ty
COPY --from=tools /opt/pi /opt/pi
# Recreate the tools stage's command links; this image's /usr/local/bin differs.
RUN ln -s /opt/ruff/ruff/bin/ruff /usr/local/bin/ruff \
    && ln -s /opt/ty/ty/bin/ty /usr/local/bin/ty \
    && ln -s /opt/pi/node_modules/.bin/pi /usr/local/bin/pi \
    && ln -s /opt/pi/node_modules/.bin/biome /usr/local/bin/biome \
    && ln -s /opt/pi/node_modules/.bin/claude /usr/local/bin/claude
# Pinned release binary; bump the version and both checksums together, using
# the sha256 entries in https://herdr.dev/latest.json for that release.
ARG HERDR_VERSION=0.9.5
ARG HERDR_SHA256_AMD64=14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d
ARG HERDR_SHA256_ARM64=17d7536f2da50859523680ef279dffcac8e4a235f4e46fe8da6c2ec44141897c
ARG TARGETARCH
RUN case "$TARGETARCH" in \
        amd64) arch=x86_64 sha256=$HERDR_SHA256_AMD64 ;; \
        arm64) arch=aarch64 sha256=$HERDR_SHA256_ARM64 ;; \
        *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/herdrdev/herdr/releases/download/v${HERDR_VERSION}/herdr-linux-${arch}" -o /tmp/herdr \
    && echo "${sha256}  /tmp/herdr" | sha256sum -c - \
    && install -m 0755 /tmp/herdr /usr/local/bin/herdr \
    && rm /tmp/herdr \
    && install -d /home/node/.agents/skills/herdr \
    && herdr --skill > /home/node/.agents/skills/herdr/SKILL.md
# Hunk's standalone release bundles the matching review skill. Keep both outside
# the persistent Pi volume so existing installs receive them on replacement.
ARG HUNK_VERSION=0.24.0
RUN curl -fsSL https://hunk.dev/install.sh -o /tmp/install-hunk.sh \
    && HUNK_VERSION=${HUNK_VERSION} HUNK_INSTALL_DIR=/opt/hunk sh /tmp/install-hunk.sh --no-modify-path \
    && rm /tmp/install-hunk.sh \
    && ln -s /opt/hunk/hunk /usr/local/bin/hunk \
    && install -d /home/node/.agents/skills \
    && ln -s /opt/hunk/skills/hunk-review /home/node/.agents/skills/hunk-review
# Claude Code state (login, settings, sessions) persists in the agent volume.
ENV CLAUDE_CONFIG_DIR=/home/node/.pi/agent/claude
# Docker seeds a fresh Herdr volume from these image-owned defaults.
RUN install -d -m 0700 -o node -g node /home/node/.herdr/config \
        /home/node/.herdr/state /home/node/.local/state \
    && ln -s /home/node/.herdr/config /home/node/.config/herdr \
    && ln -s /home/node/.herdr/state /home/node/.local/state/herdr
COPY --chown=node:node --chmod=0600 container/defaults/herdr.toml /home/node/.herdr/config/config.toml
COPY container/extensions/herdr-question-state.ts /opt/pi/extensions/herdr-question-state.ts
USER node
WORKDIR /workspace

# Default image. Sandbox kits cannot pass --target, so they set PI_BOX_TARGET.
FROM ${PI_BOX_TARGET}
