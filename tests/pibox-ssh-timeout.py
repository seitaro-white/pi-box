#!/usr/bin/env python3
"""Loopback-only test of real OpenSSH's initial-handshake timeout.

An ephemeral 127.0.0.1 listener accepts but never sends an SSH banner. No SSH
server, authentication, Tailscale, container or external network is involved.
The test disables normal SSH config/known-host files and cleans up its listener.
"""
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import tempfile
import time

script = Path(__file__).resolve().parents[1] / 'scripts' / 'pibox'
ssh = shutil.which('ssh')
if not ssh:
    raise SystemExit('Real OpenSSH client required for this loopback-only test')

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener, tempfile.TemporaryDirectory() as temp:
    listener.bind(('127.0.0.1', 0))
    listener.listen(1)
    listener.settimeout(5)
    port = listener.getsockname()[1]
    root = Path(temp)
    config = root / 'config'
    config.write_text('PIBOX_MODE=remote\nPIBOX_SSH_HOST=127.0.0.1\n'
                      'PIBOX_REMOTE_SCRIPT=/home/test-user/.local/bin/pibox\n')
    wrapper = root / 'ssh'
    # Test-only settings: avoid reading/writing user SSH configuration, host
    # trust or credentials. Authentication is never reached without a banner.
    wrapper.write_text('#!/bin/sh\nexec ' + shlex.quote(ssh) +
                       f' -F /dev/null -p {port} -o BatchMode=yes'
                       ' -o UserKnownHostsFile=/dev/null -o GlobalKnownHostsFile=/dev/null "$@"\n')
    wrapper.chmod(0o700)
    env = dict(os.environ, PIBOX_CONFIG=str(config), PATH=f'{root}:{os.environ["PATH"]}')
    start = time.monotonic()
    proc = subprocess.Popen(['bash', str(script), 'sessions'], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        conn, _ = listener.accept()
        with conn:
            # Never send a banner. The helper's ConnectTimeout must terminate
            # SSH itself, not our subprocess timeout safety net.
            stdout, stderr = proc.communicate(timeout=18)
        elapsed = time.monotonic() - start
        assert proc.returncode == 255, f'Unexpected exit {proc.returncode}'
        assert 7 <= elapsed < 17, f'Expected bounded ~10s handshake timeout, got {elapsed:.1f}s'
        assert 'Connection timed out' in stderr, 'OpenSSH did not report a connection timeout'
        assert 'SSH connection/login' in stderr, 'Missing helper diagnostic'
        assert 'Check Tailscale on both laptops' in stderr
        assert 'No automatic retry' in stderr
        assert not stdout, 'Failed connection must not claim command success'
        print(f'PASS: real SSH handshake timed out after {elapsed:.1f}s; helper exited 255 with guidance; loopback only')
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
