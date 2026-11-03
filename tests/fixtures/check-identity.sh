#!/bin/sh
# Check the image's user, pinned CLI and writable/private state directories.
set -eu

test "$(id -u)" = 1000
test "$EDITOR" = micro
test "$VISUAL" = micro
test "$PAGER" = batcat
test "$(pi --version)" = "$EXPECTED_PI_VERSION"
for tool in gh git ss make nano micro nnn batcat rg fdfind uv python tmux psql curl gcloud terraform mise; do command -v "$tool" >/dev/null; done
gh --version >/dev/null
nano --version >/dev/null
micro --version >/dev/null
nnn -V >/dev/null
batcat --version >/dev/null
rg --version >/dev/null
fdfind --version >/dev/null
psql --version >/dev/null
mise --version >/dev/null
test "$(gcloud version --format=json | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8"))["Google Cloud SDK"]')" = "$EXPECTED_GCLOUD_VERSION"
test "$(terraform version -json | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).terraform_version')" = "$EXPECTED_TERRAFORM_VERSION"
test ! -w "$(command -v gcloud)"
test ! -w "$(command -v terraform)"
test "$CLOUDSDK_CONFIG" = /home/node/.pi/agent/gcloud
gcloud config set project pi-box-smoke-test
test "$(gcloud config get project)" = pi-box-smoke-test
test -d "$CLOUDSDK_CONFIG/configurations"
# Only the client is installed, never the PostgreSQL server.
if command -v postgres >/dev/null; then
    echo "PostgreSQL server must not be installed in the Pi image" >&2
    exit 1
fi
# Later uv installations still use persistent storage, unlike the sandbox home.
test "$(uv python dir)" = /home/node/.pi/agent/python
test "$(uv tool dir)" = /home/node/.pi/agent/uv-tools
test "$(uv tool dir --bin)" = /home/node/.pi/agent/bin
test "$(herdr --version)" = "herdr $EXPECTED_HERDR_VERSION"
test "$(hunk --version)" = "$EXPECTED_HUNK_VERSION"
test ! -w "$(command -v hunk)"
test -r /home/node/.agents/skills/hunk-review/SKILL.md
test ! -w /home/node/.agents/skills/hunk-review/SKILL.md
test -r /home/node/.agents/skills/herdr/SKILL.md
test ! -w /home/node/.agents/skills/herdr/SKILL.md
test -s /home/node/.pi/agent/extensions/herdr-agent-state.ts
test "$(stat -c %u /usr/local/bin/herdr)" = 0
test ! -w /usr/local/bin/herdr
test "$(readlink /home/node/.config/herdr)" = /home/node/.herdr/config
test "$(readlink /home/node/.local/state/herdr)" = /home/node/.herdr/state
for path in /home/node/.herdr /home/node/.herdr/config /home/node/.herdr/state; do
    test "$(stat -c %a "$path")" = 700
    test -w "$path"
done
test "$(stat -c %a /home/node/.config/herdr/config.toml)" = 600
test ! -w /opt/pi
test "$(stat -c %a /home/node/.pi/agent)" = 700
test "$(stat -c %a /home/node/.pi/agent/settings.json)" = 600
test "$(stat -c %a /home/node/.pi/agent/pi-box-packages.json)" = 600
test -w /workspace
test -w /home/node/.pi/agent
test -w /home/node/.local
test "$GH_CONFIG_DIR" = /home/node/.config/git/gh
test "$GIT_CONFIG_GLOBAL" = /home/node/.config/git/config
test -w /home/node/.config/git
test "$(stat -c %a /home/node/.config/git)" = 700
test "$(stat -c %a "$GIT_CONFIG_GLOBAL")" = 600
test "$(git config --get credential.https://github.com.useHttpPath)" = true
