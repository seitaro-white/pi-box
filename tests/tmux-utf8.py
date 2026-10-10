#!/usr/bin/env python3
"""Verify Unicode spinner output through an attached tmux client, without a model.

Called by smoke.sh on its disposable, network-disabled container. Refuses live
containers so automated key injection cannot touch real user conversations.
"""
import fcntl
import json
import os
import pty
import select
import struct
import subprocess
import sys
import termios
import time

binary, connection, name, session = sys.argv[1:]
podman = [binary, "--connection", connection]
container = json.loads(subprocess.check_output(podman + ["inspect", name]))[0]
assert container["Config"]["Labels"].get("io.pi-box.smoke") == name, "not a disposable smoke container"
assert container["HostConfig"]["NetworkMode"] == "none", "test needs disabled networking"
assert subprocess.check_output(podman + ["exec", name, "locale", "charmap"]).strip() == b"UTF-8"


def tmux(*args):
    return subprocess.run(podman + ["exec", name, "tmux", *args], check=True, capture_output=True)


master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
client = subprocess.Popen(
    podman + ["exec", "-it", name, "tmux", "attach-session", "-t", "=" + session],
    stdin=slave, stdout=slave, stderr=slave,
)
os.close(slave)
output = bytearray()
try:
    deadline = time.monotonic() + 20
    while b"/workspace" not in output:
        assert client.poll() is None, "client exited before attachment"
        assert time.monotonic() < deadline, "attachment timeout"
        if select.select([master], [], [], 0.1)[0]:
            output.extend(os.read(master, 65536))
    output.clear()
    target = session + ":0.0"
    tmux("send-keys", "-t", target, "-l", "!!printf 'UTF8_ARROWS_↑↓\\n'; sleep 8")
    tmux("send-keys", "-t", target, "Enter")
    # Observe several animation frames, not just one successful initial draw.
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            output.extend(os.read(master, 65536))
    frames = {c for c in "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏" if c.encode() in output}
    assert b"Running..." in output, "attached client lost the activity label"
    assert len(frames) >= 3, "attached client lost Unicode spinner frames (check LANG or tmux -u)"
    assert "↑".encode() in output and "↓".encode() in output, "attached client lost Unicode arrows"
    print(f"PASS: attached tmux client received {len(frames)} Unicode spinner frames and up/down arrows")
finally:
    try:
        tmux("send-keys", "-t", session + ":0.0", "Escape")
        tmux("detach-client", "-s", session)
    finally:
        deadline = time.monotonic() + 5
        while client.poll() is None and time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    os.read(master, 65536)
                except OSError:
                    pass
        if client.poll() is None:
            client.kill()
        client.wait()
        os.close(master)
