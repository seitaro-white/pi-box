#!/bin/sh
# Exercise the default runtime cache and Pi's package prefix without networking.
set -eu

test "$(id -u)" = 1000
test "$(npm config get cache)" = /home/node/.npm
test ! -e /tmp/npm-cache
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/package"
printf '%s\n' '{"name":"pi-box-cache-test","version":"1.0.0"}' > "$work/package/package.json"
npm pack "$work/package" --pack-destination "$work" --offline --ignore-scripts
# Explicitly populate _cacache, so a local install cannot skip the cache check.
npm cache add "$work/pi-box-cache-test-1.0.0.tgz" --offline
npm install "$work/pi-box-cache-test-1.0.0.tgz" \
    --prefix /home/node/.pi/agent/npm --legacy-peer-deps \
    --offline --ignore-scripts --no-audit --no-fund
test -f /home/node/.pi/agent/npm/node_modules/pi-box-cache-test/package.json
test -w /home/node/.npm/_cacache
test -w /home/node/.npm/_logs
test -z "$(find /home/node/.npm ! -user node -print -quit)"
