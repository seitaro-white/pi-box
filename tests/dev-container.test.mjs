import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const scenario of ['normal', 'legacy', 'legacy-reset', 'ssh-reset', 'mounts', 'shared-git']) {
  test(`container lifecycle: ${scenario}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-box-lifecycle-'));
    try {
      const log = join(dir, 'calls');
      const home = join(dir, 'home');
      mkdirSync(join(home, '.config/git'), { recursive: true });
      // Normal persistent Git state must not trigger the disposable-file guard.
      writeFileSync(join(home, '.config/git/config'), '[user]\nname = Synthetic\n');
      if (['legacy', 'legacy-reset'].includes(scenario)) writeFileSync(join(home, '.gitconfig'), 'LEGACY_CONFIG');
      if (scenario === 'ssh-reset') mkdirSync(join(home, '.ssh'));
      writeFileSync(join(dir, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const scenario = process.env.SCENARIO;
fs.appendFileSync(process.env.LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'image' && args.includes('--format')) {
  console.log('GIT_CONFIG_GLOBAL=/home/node/.config/git/config');
} else if (args[0] === 'inspect') {
  if (args.join(' ').includes('State.Running')) console.log('true');
  else if (scenario === 'mounts') console.log('bind  /workspace');
  else {
    console.log('volume pi-box-agent /home/node/.pi/agent\\nvolume pi-box-workspace /workspace');
    if (!['legacy', 'legacy-reset'].includes(scenario)) console.log('volume pi-box-git /home/node/.config/git');
  }
} else if (args[0] === 'exec' && args.includes('sh')) {
  const env = { ...process.env };
  for (let i = 1; i < args.length; i++) if (args[i] === '-e') {
    const [key, value] = args[++i].split('='); env[key] = value;
  }
  const code = args[args.indexOf('sh') + 2].replaceAll('/home/node', process.env.TEST_HOME);
  const result = spawnSync('sh', ['-c', code], { env, stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else if (args[0] === 'ps' && scenario === 'shared-git' && args.includes('volume=pi-box-git')) console.log('other');
`, { mode: 0o755 });
      const reset = ['legacy-reset', 'ssh-reset'].includes(scenario);
      const result = spawnSync('bash', ['scripts/dev-container.sh', 'replace'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, LOG: log, SCENARIO: scenario, TEST_HOME: home,
          IMAGE: 'pi-box:0.2.0', CONTAINER: 'pi-box-dev', WORKSPACE_VOLUME: 'pi-box-workspace', AGENT_VOLUME: 'pi-box-agent',
          GIT_VOLUME: 'pi-box-git', RESET_LEGACY_GIT: reset ? '1' : '0' },
      });
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const success = ['normal', 'legacy-reset'].includes(scenario);
      assert.equal(result.status, success ? 0 : 1, result.stderr);
      for (const action of ['stop', 'rm', 'run']) {
        assert.equal(calls.some(args => args[0] === action), success);
      }
      if (success) assert.ok(calls.find(args => args[0] === 'run').includes('pi-box-git:/home/node/.config/git'));
      assert.ok(!calls.some(args => args[0] === 'volume' && args[1] === 'rm'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
