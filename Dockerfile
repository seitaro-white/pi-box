# Shared development tools; no Pi packages are installed in this stage.
FROM docker.io/library/node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS common

# Development tools (Debian packages are not snapshot-pinned).
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash bat ca-certificates curl fd-find git micro nano nnn postgresql-client ripgrep tmux \
    && rm -rf /var/lib/apt/lists/*

# uv and a baseline Python interpreter.
COPY --from=ghcr.io/astral-sh/uv:0.12.23@sha256:61d393e44e249f2e4b526b6c7ddcecce245946826e608e11c93ad4f5bba55b21 /uv /uvx /usr/local/bin/
RUN UV_PYTHON_INSTALL_DIR=/opt/python UV_PYTHON_BIN_DIR=/usr/local/bin \
    uv python install 3.13.16 --default --no-cache
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
    LANG=C.UTF-8 \
    TERM=xterm-256color \
    PI_TELEMETRY=0

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

# Last target is the default: Pi, bundled extensions and their CLI tools.
FROM common AS recommended
USER root
WORKDIR /opt/pi
# Official installer selects the platform and verifies the latest release.
# Download first so a failed fetch cannot be hidden by a successful shell pipe.
RUN curl -fsSL https://herdr.dev/install.sh -o /tmp/install-herdr.sh \
    && HERDR_INSTALL_DIR=/usr/local/bin sh /tmp/install-herdr.sh \
    && rm /tmp/install-herdr.sh \
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
# Image-owned installation, not hidden by an existing agent-volume mount.
ARG RUFF_VERSION=0.17.0
RUN UV_TOOL_DIR=/opt/ruff UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_PYTHON_INSTALL_DIR=/opt/python UV_PYTHON_DOWNLOADS=never \
    uv tool install --no-cache --python /usr/local/bin/python3 "ruff==${RUFF_VERSION}"
COPY container/package.json container/package-lock.json ./
RUN node prepare-runtime.mjs recommended \
    && npm ci --cache /tmp/npm-cache --omit=dev --ignore-scripts --no-audit --no-fund \
    && rm -rf /tmp/npm-cache \
    && ln -s /opt/pi/node_modules/.bin/pi /usr/local/bin/pi \
    && ln -s /opt/pi/node_modules/.bin/biome /usr/local/bin/biome
# Docker seeds a fresh Herdr volume from these image-owned defaults.
RUN install -d -m 0700 -o node -g node /home/node/.herdr/config \
        /home/node/.herdr/state /home/node/.local/state \
    && ln -s /home/node/.herdr/config /home/node/.config/herdr \
    && ln -s /home/node/.herdr/state /home/node/.local/state/herdr
COPY --chown=node:node --chmod=0600 container/defaults/herdr.toml /home/node/.herdr/config/config.toml
USER node
WORKDIR /workspace
