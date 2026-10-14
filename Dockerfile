# Shared development tools; no Pi packages are installed in this stage.
FROM docker.io/library/node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS common

# Development tools (Debian packages are not snapshot-pinned).
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates fd-find git ripgrep tmux \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd

# uv and a baseline Python interpreter.
COPY --from=ghcr.io/astral-sh/uv:0.12.23@sha256:61d393e44e249f2e4b526b6c7ddcecce245946826e608e11c93ad4f5bba55b21 /uv /uvx /usr/local/bin/
RUN UV_PYTHON_INSTALL_DIR=/opt/python UV_PYTHON_BIN_DIR=/usr/local/bin \
    uv python install 3.13.16 --default --no-cache
ENV UV_PYTHON_INSTALL_DIR=/home/node/.pi/agent/python \
    UV_PYTHON_BIN_DIR=/home/node/.pi/agent/bin \
    UV_TOOL_DIR=/home/node/.pi/agent/uv-tools \
    UV_TOOL_BIN_DIR=/home/node/.pi/agent/bin \
    UV_LINK_MODE=copy \
    PATH=/home/node/.pi/agent/bin:$PATH

COPY container/entrypoint.sh /usr/local/bin/pi-box-entrypoint
COPY container/tmux.conf /etc/tmux.conf
COPY container/gitconfig /etc/gitconfig
COPY container/init-agent.mjs container/init-git.mjs container/prepare-runtime.mjs /opt/pi/
RUN chmod 0755 /usr/local/bin/pi-box-entrypoint \
    && install -d -m 0700 -o node -g node /workspace /home/node/.pi /home/node/.pi/agent \
        /home/node/.config /home/node/.config/git

# UTF-8 prevents tmux from replacing Unicode UI characters.
ENV HOME=/home/node \
    GIT_CONFIG_GLOBAL=/home/node/.config/git/config \
    LANG=C.UTF-8 \
    TERM=xterm-256color \
    PI_CODING_AGENT_DIR=/home/node/.pi/agent \
    PI_SKIP_VERSION_CHECK=1 \
    PI_TELEMETRY=0

USER node
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/pi-box-entrypoint"]
CMD ["tmux", "-D"]

# The base lockfile describes only Pi. Derive its manifest from the same source
# used by recommended; npm ci fails if the derived manifest and lock disagree.
FROM common AS base
USER root
WORKDIR /opt/pi
COPY container/package.json ./
COPY container/base/package-lock.json ./package-lock.json
RUN node prepare-runtime.mjs base \
    && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force \
    && ln -s /opt/pi/node_modules/.bin/pi /usr/local/bin/pi
ENV PI_BOX_PROFILE=base
USER node
WORKDIR /workspace

# Last target is the default: Pi plus all extensions in container/package.json.
FROM common AS recommended
USER root
WORKDIR /opt/pi
COPY container/package.json container/package-lock.json ./
RUN node prepare-runtime.mjs recommended \
    && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force \
    && ln -s /opt/pi/node_modules/.bin/pi /usr/local/bin/pi
# Bind inside the container for Docker forwarding; publish only on host loopback.
# Remote mode prints the review URL instead of opening a container browser.
ENV PI_BOX_PROFILE=recommended \
    PLANNOTATOR_REMOTE=1 \
    PLANNOTATOR_PORT=19432
EXPOSE 19432
USER node
WORKDIR /workspace
