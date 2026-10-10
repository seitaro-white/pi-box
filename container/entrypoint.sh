#!/bin/sh
set -eu
# Restrict newly created auth, history, and workspace files by default.
umask 077
# Defaults live outside the mounted volume; existing operator config is retained.
node /opt/pi/init-agent.mjs
exec "$@"
