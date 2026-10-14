import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('replacement preserves and refreshes actual Git config across two replacements', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-box-git-'));
  const home = join(dir, 'home');
  const agent = join(dir, 'agent');
  mkdirSync(home);
  mkdirSync(agent);
  try {
    writeFileSync(join(dir, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const home = process.env.TEST_HOME;
const agent = process.env.TEST_AGENT;
if (args[0] === 'inspect') {
  console.log(args.join(' ').includes('State.Running') ? 'true' : 'volume pi-box-workspace /workspace\\nvolume pi-box-agent /home/node/.pi/agent');
} else if (args[0] === 'exec') {
  const code = args[4].replaceAll('/home/node/.pi/agent', agent).replaceAll('/home/node', home);
  const result = spawnSync('sh', ['-c', code], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else if (args[0] === 'rm') {
  fs.rmSync(home, { recursive: true });
  fs.mkdirSync(home);
}
`, { mode: 0o755 });
    for (const email of ['first@example.com', 'updated@example.com']) {
      const config = `[user]\n\temail = ${email}\n`;
      writeFileSync(join(home, '.gitconfig'), config);
      const result = spawnSync('bash', ['scripts/dev-container.sh', 'replace'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_HOME: home, TEST_AGENT: agent,
          IMAGE: 'pi-box:0.2.0', CONTAINER: 'pi-box-dev', WORKSPACE_VOLUME: 'pi-box-workspace', AGENT_VOLUME: 'pi-box-agent' },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(home, '.gitconfig'), 'utf8'), config);
      assert.equal(readFileSync(join(agent, 'container-config/gitconfig'), 'utf8'), config);
      assert.equal(statSync(join(home, '.gitconfig')).mode & 0o777, 0o600);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
