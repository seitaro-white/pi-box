// Run on stdin after restart and replacement of the disposable smoke container.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';

test(`${process.env.STORAGE_TRANSITION}: workspace and private agent state persist`, () => {
  assert.equal(readFileSync('/workspace/repo/unpushed.txt', 'utf8'), 'SYNTHETIC_WORKSPACE_CANARY\n');
  assert.equal(execFileSync('git', ['-C', '/workspace/repo', 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '?? unpushed.txt');
  assert.equal(readFileSync('/home/node/.pi/agent/history-canary', 'utf8'), 'SYNTHETIC_HISTORY_CANARY');
  const auth = '/home/node/.pi/agent/auth.json';
  assert.deepEqual(JSON.parse(readFileSync(auth, 'utf8')), {});
  assert.equal(statSync(auth).mode & 0o777, 0o600);
});
