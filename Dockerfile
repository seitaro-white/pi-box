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
ENV CLOUDSDK_PYTHON=/usr/local/bin/python3

COPY --from=ghcr.io/jdx/mise:2026.10.25@sha256:91417f41840316b7c5da6854bef393eccea4546ae70f8baf0803e0e94287b68d /usr/local/bin/mise /usr/local/bin/mise

# One locked install, like npm ci; export runtime artifacts by image profile.
FROM system AS tools
ARG TARGETARCH
WORKDIR /opt/tool-config
ENV MISE_DATA_DIR=/var/cache/mise/data \
    MISE_CACHE_DIR=/var/cache/mise/cache \
    MISE_CONFIG_DIR=/tmp/mise-config \
    MISE_TRUSTED_CONFIG_PATHS=/opt/tool-config \
    MISE_YES=1
COPY container/mise.toml container/mise.lock ./
COPY container/install-tools.sh /tmp/install-tools.sh
RUN --mount=type=cache,id=mise-${TARGETARCH},target=/var/cache/mise,sharing=locked sh /tmp/install-tools.sh

FROM system AS cloud-tools
COPY --from=tools /out/cloud/ /
# /opt/pi is copied last by each image; these links resolve once it arrives.
RUN ln -s /opt/pi/node_modules/.bin/pi /usr/local/bin/pi \
    && ln -s /opt/pi/node_modules/.bin/biome /usr/local/bin/biome \
    && ln -s /opt/pi/node_modules/.bin/claude /usr/local/bin/claude
# UTF-8 prevents tmux from replacing Unicode UI characters.
ENV CLOUDSDK_CORE_DISABLE_USAGE_REPORTING=true \
    CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK=true \
    EDITOR=micro \
    VISUAL=micro \
    PAGER=batcat \
    LANG=C.UTF-8 \
    TERM=xterm-256color \
    PI_TELEMETRY=0

FROM system AS npm-runtime
WORKDIR /opt/pi
COPY container/package.json container/package-lock.json container/prepare-runtime.mjs ./
# npm can canonicalize GitHub Git sources to SSH; force anonymous HTTPS for builds.
RUN node prepare-runtime.mjs \
    && GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf \
       GIT_CONFIG_VALUE_0=ssh://git@github.com/ \
       npm ci --cache /tmp/npm-cache --omit=dev --ignore-scripts --no-audit --no-fund \
    && rm -rf /tmp/npm-cache \
    && node node_modules/@anthropic-ai/claude-code/install.cjs \
    && node_modules/.bin/claude --version

FROM system AS personal-skills
# BuildKit resolves main on every build and keys the cache by its commit.
# Keep the old package path so existing settings and resource filters still work.
ADD https://github.com/seitaro-white/personal-agent-skills.git#main /opt/pi/node_modules/personal-skills/

# Docker Sandboxes kit image (pi-box.yaml): mountless, no Herdr or Hunk.
FROM cloud-tools AS sandbox
RUN usermod -l agent -d /home/agent -m node \
    && groupmod -n agent node
# sbx launch contract: agent UID 1000, bash, writable workspace and trusted CA.
# install -d applies -o/-m only to listed paths, so list each parent too.
RUN install -d -m 0700 -o agent -g agent /home/agent/workspace \
        /home/agent/.pi /home/agent/.pi/agent /home/agent/.local \
        /home/agent/.local/bin /home/agent/.local/share /home/agent/.local/state \
        /home/agent/.config /home/agent/.config/git /home/agent/.docker \
        /home/agent/.docker/sandbox /home/agent/.docker/sandbox/locks \
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
    NODE_USE_ENV_PROXY=1
COPY --chown=agent:agent container/defaults/micro-settings.json /home/agent/.config/micro/settings.json
COPY --from=tools /out/python/ /
COPY --from=npm-runtime /opt/pi /opt/pi
COPY --from=personal-skills /opt/pi/node_modules/personal-skills /opt/pi/node_modules/personal-skills
COPY container/init-agent.mjs /opt/pi/init-agent.mjs
USER agent
# Register bundled extensions once, without touching runtime login credentials.
RUN node /opt/pi/init-agent.mjs
WORKDIR /home/agent/workspace
# Plain shell: session management belongs to the user.
ENTRYPOINT []
CMD ["/bin/bash", "-l"]

# Compose images: the node user, persistent-volume paths and startup scripts.
FROM cloud-tools AS common
ENV CLOUDSDK_CONFIG=/home/node/.pi/agent/gcloud \
    UV_PYTHON_INSTALL_DIR=/home/node/.pi/agent/python \
    UV_PYTHON_BIN_DIR=/home/node/.pi/agent/bin \
    UV_TOOL_DIR=/home/node/.pi/agent/uv-tools \
    UV_TOOL_BIN_DIR=/home/node/.pi/agent/bin \
    PATH=/home/node/.pi/agent/bin:$PATH

COPY container/entrypoint.sh /usr/local/bin/pi-box-entrypoint
COPY --chown=node:node container/defaults/micro-settings.json /home/node/.config/micro/settings.json
COPY container/tmux.conf /etc/tmux.conf
COPY container/gitconfig /etc/gitconfig
COPY container/init-agent.mjs container/init-git.mjs container/prepare-runtime.mjs /opt/pi/
RUN chmod 0755 /usr/local/bin/pi-box-entrypoint \
    && install -d -m 0700 -o node -g node /workspace /home/node/.pi /home/node/.pi/agent \
        /home/node/.config /home/node/.config/git /home/node/.herdr

ENV HOME=/home/node \
    GIT_CONFIG_GLOBAL=/home/node/.config/git/config \
    GH_CONFIG_DIR=/home/node/.config/git/gh

# Image-owned guidance stays current and is not hidden by persistent volumes.
# Pi loads ancestor AGENTS.md files and discovers ~/.agents/skills automatically.
COPY container/defaults/AGENTS.md /AGENTS.md
COPY container/skills/pi-box/SKILL.md /home/node/.agents/skills/pi-box/SKILL.md

ENTRYPOINT ["/usr/local/bin/pi-box-entrypoint"]
CMD ["tmux", "-D"]

# Assemble configuration before tools, then copy the frequently updated packages.
FROM common AS recommended
# Claude Code state (login, settings, sessions) persists in the agent volume.
ENV CLAUDE_CONFIG_DIR=/home/node/.pi/agent/claude
# Docker seeds a fresh Herdr volume from these image-owned defaults.
RUN install -d -m 0700 -o node -g node /home/node/.herdr/config \
        /home/node/.herdr/state /home/node/.local /home/node/.local/state \
    && ln -s /home/node/.herdr/config /home/node/.config/herdr \
    && ln -s /home/node/.herdr/state /home/node/.local/state/herdr \
    && ln -s /opt/hunk/hunk /usr/local/bin/hunk \
    && install -d /home/node/.agents/skills \
    && ln -s /opt/herdr /home/node/.agents/skills/herdr \
    && ln -s /opt/hunk/skills/hunk-review /home/node/.agents/skills/hunk-review
COPY --chown=node:node --chmod=0600 container/defaults/herdr.toml /home/node/.herdr/config/config.toml
COPY --from=tools /out/python/ /
COPY --from=tools /out/review/ /
COPY --from=npm-runtime /opt/pi /opt/pi
COPY --from=personal-skills /opt/pi/node_modules/personal-skills /opt/pi/node_modules/personal-skills
COPY container/extensions/herdr-question-state.ts /opt/pi/extensions/herdr-question-state.ts
USER node
WORKDIR /workspace

# Default image. Sandbox kits cannot pass --target, so they set PI_BOX_TARGET.
FROM ${PI_BOX_TARGET}
