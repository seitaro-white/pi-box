import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const scenario of ['normal', 'unsafe', 'mounts', 'shared']) {
  test(`container replacement: ${scenario}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-box-lifecycle-'));
    try {
      const log = join(dir, 'calls');
      writeFileSync(join(dir, 'docker'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$LOG"
case "$1" in
  inspect)
    if [[ "$*" == *State.Running* ]]; then echo true
    elif [[ "$SCENARIO" == mounts ]]; then echo 'bind /workspace'
    else printf 'volume pi-box-workspace /workspace\\nvolume pi-box-agent /home/node/.pi/agent\\n'; fi ;;
  exec) [[ "$SCENARIO" != unsafe ]] ;;
  ps) if [[ "$SCENARIO" == shared ]]; then echo other; fi ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
      const result = spawnSync('bash', ['scripts/dev-container.sh', 'replace'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, LOG: log, SCENARIO: scenario,
          IMAGE: 'pi-box:0.2.0', CONTAINER: 'pi-box-dev', WORKSPACE_VOLUME: 'pi-box-workspace', AGENT_VOLUME: 'pi-box-agent' },
      });
      const calls = readFileSync(log, 'utf8');
      assert.equal(result.status, scenario === 'normal' ? 0 : 1, result.stderr);
      assert.equal(calls.includes('stop pi-box-dev'), scenario === 'normal');
      assert.equal(calls.includes('rm pi-box-dev'), scenario === 'normal');
      assert.equal(calls.includes('run -d'), scenario === 'normal');
      assert.ok(!calls.includes('volume rm'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
