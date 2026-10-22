#!/bin/sh
# Install a synthetic local package into Pi's runtime prefix without networking.
set -eu

test "$(id -u)" = 1000
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/package"
printf '%s\n' '{"name":"pi-box-cache-test","version":"1.0.0"}' > "$work/package/package.json"
npm pack "$work/package" --pack-destination "$work" --offline --ignore-scripts
npm install "$work/pi-box-cache-test-1.0.0.tgz" \
    --prefix /home/node/.pi/agent/npm --legacy-peer-deps \
    --offline --ignore-scripts --no-audit --no-fund
test -f /home/node/.pi/agent/npm/node_modules/pi-box-cache-test/package.json
