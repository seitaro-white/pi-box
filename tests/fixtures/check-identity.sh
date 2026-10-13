#!/bin/sh
# Check the image's user, pinned CLI and writable/private state directories.
set -eu

test "$PI_BOX_PROFILE" = "$EXPECTED_PROFILE"
test "$(id -u)" = 1000
test "$(pi --version)" = "$EXPECTED_PI_VERSION"
for tool in git rg fd uv python tmux; do command -v "$tool" >/dev/null; done
test ! -w /opt/pi
test "$(stat -c %a /home/node/.pi/agent)" = 700
test "$(stat -c %a /home/node/.pi/agent/settings.json)" = 600
test "$(stat -c %a /home/node/.pi/agent/pi-box-packages.json)" = 600
test -w /workspace
test -w /home/node/.pi/agent
