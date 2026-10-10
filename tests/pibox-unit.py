#!/usr/bin/env python3
"""Mock-only tests: never invoke real Podman, SSH or model providers."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'pibox'
FAKE = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ['MOCK_LOG'], 'a') as f:
    f.write(json.dumps([Path(sys.argv[0]).name, *args]) + '\n')
path = Path(os.environ['MOCK_STATE'])
s = json.loads(path.read_text())
def out(value):
    print(value)
    sys.exit(0)
if Path(sys.argv[0]).name == 'ssh':
    sys.exit(s.get('ssh_exit', 0))
if args[:2] == ['machine', 'inspect']:
    if s.get('missing_machine'): sys.exit(1)
    out(s['machine'])
if args[:2] == ['machine', 'start']:
    if s.get('start_fail'): sys.exit(1)
    s['machine'] = 'running'
    path.write_text(json.dumps(s))
    sys.exit(0)
assert args[:2] == ['--connection', 'podman-machine-default'], args
args = args[2:]
if args[0] == 'info':
    if s.get('info_fail'): sys.exit(1)
    out(s.get('rootless', 'true'))
if args[:2] == ['container', 'inspect']:
    if s.get('missing_container'): sys.exit(1)
    fmt = args[-1]
    if 'Labels' in fmt: out(s.get('label', 'pi-box'))
    if fmt == '{{len .Mounts}}': out(s.get('mounts', 2))
    if '"/workspace"' in fmt: out(s.get('workspace', 'volume:pi-box-workspace'))
    if '"/home/node/.pi/agent"' in fmt: out(s.get('agent', 'volume:pi-box-agent'))
    if fmt == '{{.State.Status}}': out(s['container'])
if args[0] == 'ps':
    out(s.get(args[2], ''))
if args[0] == 'start':
    if s.get('container_start_fail'): sys.exit(1)
    s['container'] = 'running'
    path.write_text(json.dumps(s))
    out('pi-box-dev')
if args[0] == 'stop':
    assert args == ['stop', '--time', '10', 'pi-box-dev'], args
    if s.get('stop_fail'): sys.exit(1)
    if not s.get('stop_no_effect'): s['container'] = 'exited'
    path.write_text(json.dumps(s))
    out('pi-box-dev')
if args[0] == 'exec':
    if 'list-sessions' in args:
        if s.get('tmux_fail'): sys.exit(1)
        out('\n'.join(s.get('sessions', ['shell', 'remote-pi-trial'])))
    if 'attach-session' in args: sys.exit(0)
raise AssertionError(args)
'''


class PiboxTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.log = self.base / 'calls.jsonl'
        self.state = self.base / 'state.json'
        self.config = self.base / 'config'
        self.fake = self.base / 'podman'
        self.fake.write_text(FAKE)
        self.fake.chmod(0o700)
        (self.base / 'ssh').write_text(FAKE)
        (self.base / 'ssh').chmod(0o700)
        self.env = dict(os.environ, PIBOX_CONFIG=str(self.config),
                        MOCK_LOG=str(self.log), MOCK_STATE=str(self.state),
                        PATH=f'{self.base}:{os.environ["PATH"]}')
        self.configure()
        self.set_state()

    def configure(self, mode='local', extra=''):
        self.config.write_text(f'PIBOX_MODE={mode}\nPIBOX_PODMAN={shlex.quote(str(self.fake))}\n'
                               'PIBOX_REMOTE_SCRIPT=/home/test-user/.local/bin/pibox\n' + extra)

    def set_state(self, **kwargs):
        self.state.write_text(json.dumps(dict(machine='running', container='running', **kwargs)))

    def run_pibox(self, *args):
        return subprocess.run(['bash', str(SCRIPT), *args], env=self.env,
                              text=True, capture_output=True, timeout=15)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def starts(self):
        return [c for c in self.calls() if c[1:3] == ['machine', 'start'] or
                c[1:4] == ['--connection', 'podman-machine-default', 'start']]

    def assert_ok(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_help_without_config_or_tools(self):
        self.config.unlink()
        self.assert_ok(self.run_pibox('help'))
        self.assertEqual(self.calls(), [])

    def test_invalid_arguments_before_side_effects(self):
        for args in [('down',), ('up', 'extra'), ('attach', 'shell', 'extra'),
                     ('attach', '-bad'), ('attach', 'shell;touch'), ('sessions', 'shell'),
                     ('stop', 'shell'), ('stop', '--force')]:
            with self.subTest(args=args):
                self.log.unlink(missing_ok=True)
                self.assertNotEqual(self.run_pibox(*args).returncode, 0)
                self.assertEqual(self.calls(), [])

    def test_missing_config(self):
        self.config.unlink()
        self.assertIn('Missing config', self.run_pibox('up').stderr)
        self.assertEqual(self.calls(), [])

    def test_up_running_is_idempotent(self):
        self.assert_ok(self.run_pibox('up'))
        self.assertEqual(self.starts(), [])
        self.assertFalse(any('exec' in c for c in self.calls()))

    def test_up_stopped_starts_existing_resources_only(self):
        self.state.write_text(json.dumps(dict(machine='stopped', container='exited')))
        self.assert_ok(self.run_pibox('up'))
        self.assertEqual(self.starts(), [
            ['podman', 'machine', 'start', 'podman-machine-default'],
            ['podman', '--connection', 'podman-machine-default', 'start', 'pi-box-dev']])
        self.assertFalse(any('exec' in c for c in self.calls()))

    def test_stop_targets_only_dev_container_and_warns(self):
        result = self.run_pibox('stop')
        self.assert_ok(result)
        self.assertIn('WARNING', result.stderr)
        self.assertIn('ALL its Pi processes', result.stderr)
        stops = [c for c in self.calls() if 'stop' in c]
        self.assertEqual(stops, [['podman', '--connection', 'podman-machine-default',
                                 'stop', '--time', '10', 'pi-box-dev']])
        self.assertEqual(self.starts(), [])
        self.assertFalse(any('rm' in c or 'exec' in c or 'volume' in c for c in self.calls()))
        state = json.loads(self.state.read_text())
        self.assertEqual(state['machine'], 'running')
        self.assertEqual(state['container'], 'exited')
        self.assertEqual(self.calls()[-1][-1], '{{.State.Status}}')
        # Repeated stop is a no-op, not another stop/restart.
        self.assert_ok(self.run_pibox('stop'))
        self.assertEqual(len([c for c in self.calls() if 'stop' in c]), 1)

    def test_stop_never_starts_a_stopped_vm(self):
        self.state.write_text(json.dumps(dict(machine='stopped', container='exited')))
        result = self.run_pibox('stop')
        self.assert_ok(result)
        self.assertIn('VM is already stopped', result.stdout)
        self.assertEqual(len(self.calls()), 1)
        self.assertEqual(self.calls()[0][1:3], ['machine', 'inspect'])

    def test_stop_already_stopped_container_is_noop(self):
        for status in ['exited', 'created']:
            with self.subTest(status=status):
                self.log.unlink(missing_ok=True)
                self.state.write_text(json.dumps(dict(machine='running', container=status)))
                self.assert_ok(self.run_pibox('stop'))
                self.assertEqual(self.starts(), [])
                self.assertFalse(any('stop' in c for c in self.calls()))

    def test_stop_refuses_unsafe_engine_resources_and_states(self):
        for options in [dict(rootless='false'), dict(info_fail=True), dict(missing_machine=True),
                        dict(missing_container=True), dict(label='other'), dict(mounts=3),
                        dict(workspace='bind:workspace'), dict(agent='volume:other'),
                        dict(container='paused'), dict(container='stopping'), dict(machine='starting')]:
            with self.subTest(options=options):
                self.log.unlink(missing_ok=True)
                state = dict(machine='running', container='running')
                state.update(options)
                self.state.write_text(json.dumps(state))
                self.assertNotEqual(self.run_pibox('stop').returncode, 0)
                self.assertFalse(any('stop' in c for c in self.calls()))
                self.assertEqual(self.starts(), [])

    def test_stop_failure_does_not_retry_or_claim_success(self):
        self.set_state(stop_fail=True)
        result = self.run_pibox('stop')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('stop failed', result.stderr)
        self.assertNotIn('stopped;', result.stdout)
        self.assertEqual(len([c for c in self.calls() if 'stop' in c]), 1)
        self.assertEqual(self.starts(), [])

    def test_stop_verifies_container_really_stopped(self):
        self.set_state(stop_no_effect=True)
        result = self.run_pibox('stop')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('state after stop is running', result.stderr)
        self.assertNotIn('stopped;', result.stdout)
        self.assertEqual(len([c for c in self.calls() if 'stop' in c]), 1)

    def test_attach_default_and_exact_named_session(self):
        for name in ['shell', 'remote-pi-trial']:
            with self.subTest(name=name):
                self.assert_ok(self.run_pibox('attach', name))
                self.assertEqual(self.calls()[-1], ['podman', '--connection',
                    'podman-machine-default', 'exec', '-it', 'pi-box-dev',
                    'tmux', 'attach-session', '-t', '=' + name])
                self.assertEqual(self.starts(), [])

    def test_attach_can_start_then_attach(self):
        self.state.write_text(json.dumps(dict(machine='stopped', container='created')))
        self.assert_ok(self.run_pibox('attach'))
        self.assertEqual(len(self.starts()), 2)
        self.assertIn('attach-session', self.calls()[-1])

    def test_missing_session_does_not_launch_pi_or_new_session(self):
        self.set_state(sessions=['shell-other'])
        r = self.run_pibox('attach')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('No tmux session', r.stderr)
        self.assertFalse(any('attach-session' in c or 'new-session' in c for c in self.calls()))

    def test_sessions_is_read_only(self):
        self.assert_ok(self.run_pibox('sessions'))
        self.assertEqual(self.starts(), [])
        self.assertEqual(self.calls()[-1][-2:], ['tmux', 'list-sessions'])

    def test_sessions_refuses_stopped_resources(self):
        for machine, container in [('stopped', 'exited'), ('running', 'exited')]:
            with self.subTest(machine=machine):
                self.state.write_text(json.dumps(dict(machine=machine, container=container)))
                self.assertNotEqual(self.run_pibox('sessions').returncode, 0)
                self.assertEqual(self.starts(), [])

    def test_missing_vm_and_failed_vm_start_do_not_retry(self):
        for options in [dict(missing_machine=True), dict(machine='stopped', start_fail=True)]:
            with self.subTest(options=options):
                state = dict(machine='running', container='exited')
                state.update(options)
                self.state.write_text(json.dumps(state))
                self.log.unlink(missing_ok=True)
                self.assertNotEqual(self.run_pibox('up').returncode, 0)
                self.assertLessEqual(len(self.starts()), 1)
                self.assertFalse(any('init' in c or 'reset' in c for c in self.calls()))

    def test_unsafe_engine_container_and_mounts_fail_closed(self):
        for options in [dict(rootless='false'), dict(info_fail=True), dict(missing_container=True),
                        dict(label='other'), dict(mounts=3), dict(workspace='bind:workspace'),
                        dict(agent='volume:other'), dict(container='paused'), dict(machine='starting')]:
            with self.subTest(options=options):
                state = dict(machine='running', container='exited')
                state.update(options)
                self.state.write_text(json.dumps(state))
                self.assertNotEqual(self.run_pibox('up').returncode, 0)
                self.assertEqual(self.starts(), [])

    def test_running_rollback_on_either_volume_blocks_start(self):
        for volume in ['pi-box-workspace', 'pi-box-agent']:
            with self.subTest(volume=volume):
                self.state.write_text(json.dumps(dict(machine='running', container='exited',
                    **{'volume=' + volume: 'pi-box-dev-0.1.0-retained'})))
                self.assertNotEqual(self.run_pibox('up').returncode, 0)
                self.assertEqual(self.starts(), [])

    def test_container_start_failure_does_not_attach(self):
        self.state.write_text(json.dumps(dict(machine='running', container='exited', container_start_fail=True)))
        self.assertNotEqual(self.run_pibox('attach').returncode, 0)
        self.assertEqual(len(self.starts()), 1)
        self.assertFalse(any('attach-session' in c for c in self.calls()))

    def test_tmux_list_failure_does_not_attach(self):
        self.set_state(tmux_fail=True)
        self.assertNotEqual(self.run_pibox('attach').returncode, 0)
        self.assertFalse(any('attach-session' in c for c in self.calls()))

    def test_remote_commands_route_with_pty_only_for_attach(self):
        self.configure('remote')
        for command in ['up', 'sessions', 'attach', 'stop']:
            with self.subTest(command=command):
                self.assert_ok(self.run_pibox(command))
                call = self.calls()[-1]
                self.assertEqual(call[0], 'ssh')
                self.assertEqual('-t' in call, command == 'attach')
                self.assertIn('ForwardAgent=no', call)
                self.assertIn('StrictHostKeyChecking=ask', call)
                self.assertIn('ConnectTimeout=10', call)
                self.assertIn('ConnectionAttempts=1', call)
                self.assertIn('ServerAliveInterval=10', call)
                self.assertIn('ServerAliveCountMax=3', call)
                self.assertNotIn('BatchMode=yes', call)  # Password login still allowed.
                self.assertEqual(call[-2], 'macbox')
                expected = ['exec', '/home/test-user/.local/bin/pibox', '--local', command]
                if command == 'attach': expected.append('shell')
                self.assertEqual(shlex.split(call[-1]), expected)
        self.assertTrue(all(c[0] == 'ssh' for c in self.calls()))

    def test_remote_requires_explicit_helper_path(self):
        self.configure('remote', 'unset PIBOX_REMOTE_SCRIPT\n')
        result = self.run_pibox('up')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Set PIBOX_REMOTE_SCRIPT', result.stderr)
        self.assertEqual(self.calls(), [])

    def test_remote_path_quotes_shell_metacharacters(self):
        path = "/Users/some one's/$(touch nope);/pibox"
        self.configure('remote', f'PIBOX_REMOTE_SCRIPT={shlex.quote(path)}\n')
        self.assert_ok(self.run_pibox('attach', 'remote-pi-trial'))
        self.assertEqual(shlex.split(self.calls()[-1][-1]),
                         ['exec', path, '--local', 'attach', 'remote-pi-trial'])
        # Execute only the generated argument quoting in a real shell; printf
        # replaces exec, so no SSH/Podman/path payload is evaluated.
        quoted = self.calls()[-1][-1].removeprefix('exec ')
        result = subprocess.run(['bash', '-c', "printf '%s\\n' " + quoted],
                                text=True, capture_output=True, check=True)
        self.assertEqual(result.stdout.splitlines()[0], path)
        self.assertFalse(Path('nope').exists())

    def test_remote_rejects_bad_host_or_relative_path(self):
        for extra in ["PIBOX_SSH_HOST='-oProxyCommand=bad'\n", "PIBOX_SSH_HOST='foo;bar'\n",
                      'PIBOX_REMOTE_SCRIPT=relative\n']:
            with self.subTest(extra=extra):
                self.configure('remote', extra)
                self.assertNotEqual(self.run_pibox('up').returncode, 0)
                self.assertEqual(self.calls(), [])

    def test_ssh_failure_propagates_with_actionable_error_and_no_retry(self):
        self.configure('remote')
        self.set_state(ssh_exit=255)
        for command in ['up', 'sessions', 'attach', 'stop']:
            with self.subTest(command=command):
                self.log.unlink(missing_ok=True)
                result = self.run_pibox(command)
                self.assertEqual(result.returncode, 255)
                self.assertIn('10s SSH connection timeout', result.stderr)
                self.assertIn('Check Tailscale on both laptops', result.stderr)
                self.assertIn('Do not bypass host-key warnings', result.stderr)
                self.assertIn('inspect remote state', result.stderr)
                self.assertEqual(len(self.calls()), 1)
                self.assertEqual(self.calls()[0][0], 'ssh')

    def test_remote_command_error_keeps_exit_code_without_connection_claim(self):
        self.configure('remote')
        self.set_state(ssh_exit=7)
        result = self.run_pibox('sessions')
        self.assertEqual(result.returncode, 7)
        self.assertIn('Remote command exited 7', result.stderr)
        self.assertNotIn('connection/login', result.stderr)
        self.assertEqual(len(self.calls()), 1)

    def test_keyboard_cancel_is_not_reported_as_connection_failure(self):
        self.configure('remote')
        self.set_state(ssh_exit=130)
        result = self.run_pibox('attach')
        self.assertEqual(result.returncode, 130)
        self.assertNotIn('failed', result.stderr)
        self.assertNotIn('Remote command exited', result.stderr)
        self.assertEqual(len(self.calls()), 1)

    def test_remote_recursion_guard(self):
        self.configure('remote')
        for command in ['up', 'stop']:
            self.assertIn('refusing recursion', self.run_pibox('--local', command).stderr)
            self.assertEqual(self.calls(), [])

    def test_local_guard_allows_correct_host(self):
        self.assert_ok(self.run_pibox('--local', 'up'))

    def test_xdg_config_default(self):
        del self.env['PIBOX_CONFIG']
        self.env['XDG_CONFIG_HOME'] = str(self.base / 'xdg')
        path = Path(self.env['XDG_CONFIG_HOME']) / 'pibox'
        path.mkdir(parents=True)
        (path / 'config').write_text(self.config.read_text())
        self.assert_ok(self.run_pibox('up'))


if __name__ == '__main__':
    unittest.main()
