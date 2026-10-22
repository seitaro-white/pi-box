# syntax=docker/dockerfile:1
# Built only from the allowlisted staging directory in scripts/sandbox.mjs.
FROM docker.io/library/node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash bat ca-certificates curl fd-find git micro nano nnn postgresql-client ripgrep tmux \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && ln -s /usr/bin/batcat /usr/local/bin/bat \
    && usermod -l agent -d /home/agent -m node \
    && groupmod -n agent node
COPY --from=ghcr.io/astral-sh/uv:0.12.23@sha256:61d393e44e249f2e4b526b6c7ddcecce245946826e608e11c93ad4f5bba55b21 /uv /uvx /usr/local/bin/
RUN UV_PYTHON_INSTALL_DIR=/opt/python UV_PYTHON_BIN_DIR=/usr/local/bin \
    uv python install 3.13.16 --default --no-cache
ARG RUFF_VERSION=0.17.0
RUN UV_TOOL_DIR=/opt/ruff UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_PYTHON_INSTALL_DIR=/opt/python UV_PYTHON_DOWNLOADS=never \
    uv tool install --no-cache --python /usr/local/bin/python3 "ruff==${RUFF_VERSION}"

WORKDIR /opt/pi
COPY runtime/package.json runtime/package-lock.json runtime/prepare-runtime.mjs runtime/init-agent.mjs ./
RUN node prepare-runtime.mjs recommended \
    && npm ci --cache /tmp/npm-cache --omit=dev --ignore-scripts --no-audit --no-fund \
    && rm -rf /tmp/npm-cache \
    && ln -s /opt/pi/node_modules/.bin/pi /usr/local/bin/pi \
    && ln -s /opt/pi/node_modules/.bin/biome /usr/local/bin/biome
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
    PATH=/home/agent/.local/bin:/home/agent/.pi/agent/bin:$PATH \
    BASH_ENV=/etc/sandbox-persistent.sh \
    PI_CODING_AGENT_DIR=/home/agent/.pi/agent \
    PI_BOX_DEFAULTS_DIR=/opt/pi/defaults \
    PI_BOX_PROFILE=recommended \
    PI_SKIP_VERSION_CHECK=1 \
    PI_TELEMETRY=0 \
    UV_PYTHON_INSTALL_DIR=/home/agent/.pi/agent/python \
    UV_PYTHON_BIN_DIR=/home/agent/.pi/agent/bin \
    UV_TOOL_DIR=/home/agent/.pi/agent/uv-tools \
    UV_TOOL_BIN_DIR=/home/agent/.pi/agent/bin \
    UV_LINK_MODE=copy \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
    NODE_USE_ENV_PROXY=1 \
    EDITOR=micro VISUAL=micro PAGER=bat LANG=C.UTF-8 TERM=xterm-256color
USER agent
# Register bundled extensions once, without touching runtime login credentials.
RUN node /opt/pi/init-agent.mjs
WORKDIR /home/agent/workspace
# No entrypoint wrapper: sbx's shell identity supplies its own shell command.
ENTRYPOINT []
CMD ["/bin/bash", "-l"]
