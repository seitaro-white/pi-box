#!/bin/sh
# Check the image's user, pinned CLI and writable/private state directories.
set -eu

test "$(id -u)" = 1000
test "$EDITOR" = micro
test "$VISUAL" = micro
test "$PAGER" = batcat
test "$(pi --version)" = "$EXPECTED_PI_VERSION"
for tool in git nano micro nnn batcat rg fdfind uv python tmux psql curl; do command -v "$tool" >/dev/null; done
nano --version >/dev/null
micro --version >/dev/null
nnn -V >/dev/null
batcat --version >/dev/null
rg --version >/dev/null
fdfind --version >/dev/null
psql --version | grep -E '^psql \(PostgreSQL\) 15\.' >/dev/null
# The client is present in both variants, never the PostgreSQL server.
if command -v postgres >/dev/null; then
    echo "PostgreSQL server must not be installed in the Pi image" >&2
    exit 1
fi
# Later uv installations still use persistent storage, unlike the sandbox home.
test "$(uv python dir)" = /home/node/.pi/agent/python
test "$(uv tool dir)" = /home/node/.pi/agent/uv-tools
test "$(uv tool dir --bin)" = /home/node/.pi/agent/bin
if [ "$EXPECTED_PROFILE" = recommended ]; then
    herdr --version
    test "$(stat -c %u /usr/local/bin/herdr)" = 0
    test ! -w /usr/local/bin/herdr
    test "$(readlink /home/node/.config/herdr)" = /home/node/.herdr/config
    test "$(readlink /home/node/.local/state/herdr)" = /home/node/.herdr/state
    for path in /home/node/.herdr /home/node/.herdr/config /home/node/.herdr/state; do
        test "$(stat -c %a "$path")" = 700
        test -w "$path"
    done
    test "$(stat -c %a /home/node/.config/herdr/config.toml)" = 600
else
    if command -v herdr >/dev/null; then
        echo "Herdr must not be installed in the base image" >&2
        exit 1
    fi
    test ! -e /home/node/.herdr/config
fi
# Integration installation is an operator action, not an entrypoint side effect.
test ! -e /home/node/.pi/agent/extensions/herdr-agent-state.ts
test ! -w /opt/pi
test "$(stat -c %a /home/node/.pi/agent)" = 700
test "$(stat -c %a /home/node/.pi/agent/settings.json)" = 600
test "$(stat -c %a /home/node/.pi/agent/pi-box-packages.json)" = 600
test -w /workspace
test -w /home/node/.pi/agent
test "$GIT_CONFIG_GLOBAL" = /home/node/.config/git/config
test -w /home/node/.config/git
test "$(stat -c %a /home/node/.config/git)" = 700
test "$(stat -c %a "$GIT_CONFIG_GLOBAL")" = 600
test "$(git config --get credential.https://github.com.useHttpPath)" = true
