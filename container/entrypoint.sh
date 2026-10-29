#!/bin/sh
set -eu
# Restrict newly created auth, history, and workspace files by default.
umask 077
# Defaults live outside the mounted volume; existing operator config is retained.
node /opt/pi/init-git.mjs
node /opt/pi/init-agent.mjs
# Install after the persistent agent volume is mounted and initialized. Refresh
# Herdr's own managed reporter on replacement/restart, without starting Herdr.
if command -v herdr >/dev/null 2>&1; then
    herdr integration install pi
    install -m 0600 /opt/pi/extensions/herdr-question-state.ts \
        "$HOME/.pi/agent/extensions/herdr-question-state.ts"
fi
exec "$@"
