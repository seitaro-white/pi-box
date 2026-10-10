#!/usr/bin/env bash
# Disposable, credential-free smoke test. Failed resources are kept for diagnosis.
set -euo pipefail
cd "$(dirname "$0")/.."
ENGINE="${PI_BOX_ENGINE:-docker}"
IMAGE="${PI_BOX_IMAGE:-pi-box:0.2.0}"
case "$ENGINE" in
    docker) P=("${DOCKER_BIN:-docker}") ;;
    podman) P=("${PODMAN_BIN:-/opt/podman/bin/podman}" --connection "${PODMAN_CONNECTION:-podman-machine-default}") ;;
    *) echo 'PI_BOX_ENGINE must be docker or podman' >&2; exit 1 ;;
esac
EXPECTED_PI_VERSION="$(python3 -c 'import json; print(json.load(open("container/package.json"))["dependencies"]["@earendil-works/pi-coding-agent"])')"
name="pi-box-smoke-$(date +%s)-$$"
workspace="$name-workspace"
agent="$name-agent"
label="io.pi-box.smoke=$name"
passed=false
trap 'if [ "$passed" != true ]; then printf "FAILED: inspect retained resources %s, %s, %s\n" "$name" "$workspace" "$agent" >&2; fi' EXIT

"${P[@]}" info >/dev/null
if [[ $ENGINE == podman ]]; then
    [ "$("${P[@]}" info --format '{{.Host.Security.Rootless}}')" = true ]
fi
"${P[@]}" image inspect "$IMAGE" >/dev/null
# Unique names; volume create is otherwise idempotent and could reuse old data.
for volume in "$workspace" "$agent"; do
    existing_volumes="$("${P[@]}" volume ls --format '{{.Name}}')"
    if grep -Fxq "$volume" <<< "$existing_volumes"; then
        echo "Refusing to reuse $volume" >&2; exit 1
    fi
    "${P[@]}" volume create --label "$label" "$volume" >/dev/null
done

launch() {
    "${P[@]}" run -d --name "$name" --label "$label" \
        --cap-drop=ALL --security-opt=no-new-privileges \
        --network=none \
        -v "$workspace:/workspace" -v "$agent:/home/node/.pi/agent" \
        "$IMAGE" >/dev/null
    for ((i=0; i<30; i++)); do
        if "${P[@]}" exec "$name" tmux has-session -t '=shell' 2>/dev/null; then return; fi
        sleep 1
    done
    "${P[@]}" logs "$name"; echo 'tmux did not become ready' >&2; exit 1
}
check_identity() {
    "${P[@]}" exec -e EXPECTED_PI_VERSION="$EXPECTED_PI_VERSION" "$name" sh -ec '
        test "$(id -u)" = 1000
        test "$(pi --version)" = "$EXPECTED_PI_VERSION"
        test "$(node --version)" = v24.21.0
        test "$(uv --version | cut -d " " -f 2)" = 0.12.23
        test "$(python --version)" = "Python 3.13.16"
        test "$(python3 --version)" = "Python 3.13.16"
        uv venv --offline --clear /workspace/smoke-venv
        /workspace/smoke-venv/bin/python -c "import ssl, sqlite3, ctypes, venv"
        test ! -w /opt/python
        test "$(locale charmap)" = UTF-8
        test "$(tmux show-options -s -v escape-time)" = 10
        test "$(stat -c %a /home/node/.pi/agent)" = 700
        test "$(stat -c %a /home/node/.pi/agent/settings.json)" = 600
        test "$(tmux show-options -g -v mouse)" = on
        test ! -e /var/run/docker.sock
        test ! -e /run/podman/podman.sock
        grep -q "CapEff:[[:space:]]*0000000000000000" /proc/self/status
        grep -q "NoNewPrivs:[[:space:]]*1" /proc/self/status
        test -w /workspace
        test -w /home/node/.pi/agent
    '
    "${P[@]}" inspect "$name" | python3 -c '
import json, sys
c = json.load(sys.stdin)[0]
assert c["Config"]["User"] == "node"
assert not c["HostConfig"]["Privileged"]
assert not c["HostConfig"].get("PortBindings")
assert {m["Destination"] for m in c["Mounts"]} == {"/workspace", "/home/node/.pi/agent"}
assert all(m["Type"] == "volume" for m in c["Mounts"])
assert c["HostConfig"]["NetworkMode"] == "none"
assert all(not e.split("=", 1)[0].endswith(("API_KEY", "TOKEN")) for e in c["Config"]["Env"])
'
}
launch
check_identity
"${P[@]}" exec -e PI_OFFLINE=1 -i "$name" node --input-type=module < tests/extensions-offline.mjs

# Create an unpushed repository change and clearly synthetic session histories.
# No provider credentials, model requests, or tool actions are involved.
"${P[@]}" exec "$name" sh -ec '
    umask 077
    mkdir -p /workspace/repo-a /workspace/repo-b
    git -C /workspace/repo-a init -q --initial-branch=main
    printf "PI_BOX_UNPUSHED_CHANGE\n" > /workspace/repo-a/unpushed.txt
'
"${P[@]}" exec -i "$name" node --input-type=module <<'JS'
import { mkdirSync, writeFileSync } from 'node:fs';
for (const repo of ['repo-a', 'repo-b']) {
    const dir = `/home/node/.pi/agent/sessions/--workspace-${repo}--`;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const timestamp = new Date().toISOString();
    const entries = [
        { type: 'session', version: 3, id: `smoke-${repo}`, timestamp, cwd: `/workspace/${repo}` },
        { type: 'message', id: '00000001', parentId: null, timestamp,
          message: { role: 'user', content: `PI_BOX_OFFLINE_FIXTURE_${repo}`, timestamp: Date.now() } },
        { type: 'message', id: '00000002', parentId: '00000001', timestamp,
          message: { role: 'assistant', content: [{ type: 'text', text: `Synthetic offline response for ${repo}; no model was called.` }],
            api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-5.2',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'stop', timestamp: Date.now() } }
    ];
    writeFileSync(`${dir}/fixture.jsonl`, entries.map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
}
JS

start_pi() {
    local repo="$1"
    "${P[@]}" exec "$name" tmux new-session -d -s "$repo" -c "/workspace/$repo" \
        "exec pi --offline --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --session /home/node/.pi/agent/sessions/--workspace-$repo--/fixture.jsonl"
    for ((i=0; i<30; i++)); do
        if "${P[@]}" exec "$name" tmux capture-pane -p -t "${repo}:0.0" | grep -q "PI_BOX_OFFLINE_FIXTURE_$repo"; then return; fi
        sleep 1
    done
    "${P[@]}" exec "$name" tmux capture-pane -p -t "${repo}:0.0" || true
    echo "Pi did not load the offline fixture in $repo" >&2; exit 1
}
start_pi repo-a
start_pi repo-b
pid_a="$("${P[@]}" exec "$name" tmux display-message -p -t 'repo-a:0.0' '#{pane_pid}')"
pid_b="$("${P[@]}" exec "$name" tmux display-message -p -t 'repo-b:0.0' '#{pane_pid}')"
[ "$pid_a" != "$pid_b" ]
for pid in "$pid_a" "$pid_b"; do
    "${P[@]}" exec "$name" sh -ec 'test -d "/proc/$1"; readlink "/proc/$1/exe" | grep -q "/node$"; tr "\000" " " < "/proc/$1/cmdline" | grep -q "^pi"' sh "$pid"
done
# Exercise real terminal attachment, normal detach, and abrupt client exit.
# Check the same Pi pane PIDs afterwards; no keys are sent to Pi itself.
python3 - "$name" "${P[@]}" <<'PY'
import fcntl, os, pty, select, struct, subprocess, sys, termios, time
name, *command = sys.argv[1:]
for abrupt in (False, True):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    proc = subprocess.Popen(command + ['exec', '-it', name,
                             'tmux', 'attach-session', '-t', '=repo-a'],
                            stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    try:
        output = b''
        deadline = time.monotonic() + 20
        while b'PI_BOX_OFFLINE_FIXTURE_repo-a' not in output:
            assert time.monotonic() < deadline, 'terminal attachment did not render fixture'
            assert proc.poll() is None, 'terminal client exited before attachment'
            if select.select([master], [], [], 0.2)[0]:
                output += os.read(master, 65536)
        if abrupt:
            proc.kill()  # Abruptly disconnect this owned client, not the server.
        else:
            # Server-side detach avoids relying on the client's keyboard protocol.
            subprocess.run(command + ['exec', name,
                            'tmux', 'detach-client', '-s', 'repo-a'], check=True)
        deadline = time.monotonic() + 10
        while proc.poll() is None:
            assert time.monotonic() < deadline, 'terminal client did not exit'
            if select.select([master], [], [], 0.2)[0]:
                try:
                    os.read(master, 65536)
                except OSError:
                    pass
        if not abrupt:
            assert proc.returncode == 0, f'tmux detach failed: {proc.returncode}'
        else:
            # A killed remote client can leave its exec-side tmux client behind.
            subprocess.run(command + ['exec', name,
                            'tmux', 'detach-client', '-s', 'repo-a'], check=True)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        os.close(master)
PY
[ "$("${P[@]}" exec "$name" tmux display-message -p -t 'repo-a:0.0' '#{pane_pid}')" = "$pid_a" ]
[ "$("${P[@]}" exec "$name" tmux display-message -p -t 'repo-b:0.0' '#{pane_pid}')" = "$pid_b" ]
"${P[@]}" exec "$name" tmux list-sessions
python3 tests/tmux-utf8.py "$name" repo-a "${P[@]}"

check_data() {
    "${P[@]}" exec "$name" sh -ec '
        grep -q PI_BOX_UNPUSHED_CHANGE /workspace/repo-a/unpushed.txt
        test "$(git -C /workspace/repo-a status --porcelain)" = "?? unpushed.txt"
        grep -q PI_BOX_OFFLINE_FIXTURE_repo-a /home/node/.pi/agent/sessions/--workspace-repo-a--/fixture.jsonl
        grep -q PI_BOX_OFFLINE_FIXTURE_repo-b /home/node/.pi/agent/sessions/--workspace-repo-b--/fixture.jsonl
        test "$(stat -c %a /home/node/.pi/agent/auth.json)" = 600
        test "$(stat -c %a /home/node/.pi/agent/sessions/--workspace-repo-a--/fixture.jsonl)" = 600
    '
    "${P[@]}" exec "$name" node --input-type=module -e '
        import assert from "node:assert/strict";
        import { readFileSync } from "node:fs";
        assert.deepEqual(JSON.parse(readFileSync("/home/node/.pi/agent/auth.json", "utf8")), {});
    '
}
check_data
"${P[@]}" stop --time 10 "$name" >/dev/null
"${P[@]}" start "$name" >/dev/null
for ((i=0; i<30; i++)); do
    if "${P[@]}" exec "$name" tmux has-session -t '=shell' 2>/dev/null; then break; fi
    sleep 1
done
"${P[@]}" exec "$name" tmux has-session -t '=shell'
# Restart restores storage, not Pi processes or prompts.
if "${P[@]}" exec "$name" tmux has-session -t '=repo-a' 2>/dev/null; then exit 1; fi
check_identity
check_data
# Remove only this test's container, never its volumes during replacement.
"${P[@]}" rm --force "$name" >/dev/null
launch
check_identity
check_data
start_pi repo-a
start_pi repo-b
check_data

# Cleanup is restricted to disposable resources this run created.
"${P[@]}" rm --force "$name" >/dev/null
"${P[@]}" volume rm "$workspace" "$agent" >/dev/null
passed=true
printf 'PASS: non-root, locked CLI, hardening, two offline Pi sessions, terminal detach/disconnect and Unicode spinners/arrows, restart/replacement persistence, manual resume. No auth/model calls.\n'
