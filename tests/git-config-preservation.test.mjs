import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'pi-box-git-'));
  const home = join(root, 'home');
  const directory = join(root, 'git-volume');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(directory, 'config'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  // Do not inherit injected host configuration into credential tests.
  for (const key of Object.keys(env)) {
    if (key === 'GIT_CONFIG' || key === 'GIT_CONFIG_COUNT' || /^GIT_CONFIG_(KEY|VALUE)_/.test(key)) delete env[key];
  }
  const git = (args, input) => {
    const result = spawnSync('git', args, { env, input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const initialize = () => spawnSync(process.execPath, ['container/init-git.mjs'], { env, encoding: 'utf8' });
  try { fn({ root, home, directory, env, git, initialize }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('fresh Git volume seeds a private config and scoped credential store', () => fixture(({ directory, git, initialize }) => {
  const result = initialize();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, 'config')).mode & 0o777, 0o600);
  assert.match(git(['config', '--global', '--get-all', 'credential.helper']), /store --file=/);
  assert.equal(git(['config', '--global', '--get', 'credential.https://github.com.useHttpPath']).trim(), 'true');
}));

test('settings and synthetic PAT survive home replacement; credentials are repository-scoped', () => fixture(({ home, directory, env, git, initialize }) => {
  assert.equal(initialize().status, 0);
  git(['config', '--global', 'user.email', 'synthetic@example.invalid']);
  git(['credential', 'approve'], 'protocol=https\nhost=github.com\npath=owner/first.git\nusername=synthetic\npassword=SYNTHETIC_NOT_A_REAL_TOKEN\n\n');
  const config = readFileSync(join(directory, 'config'), 'utf8');
  const credentials = readFileSync(join(directory, 'credentials'), 'utf8');
  assert.equal(statSync(join(directory, 'credentials')).mode & 0o777, 0o600);
  for (let replacement = 0; replacement < 2; replacement++) {
    rmSync(home, { recursive: true });
    mkdirSync(home);
    const result = initialize();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(directory, 'config'), 'utf8'), config);
    assert.equal(readFileSync(join(directory, 'credentials'), 'utf8'), credentials);
    assert.equal(git(['config', '--global', 'user.email']).trim(), 'synthetic@example.invalid');
    assert.match(git(['credential', 'fill'], 'protocol=https\nhost=github.com\npath=owner/first.git\n\n'), /password=SYNTHETIC_NOT_A_REAL_TOKEN/);
    git(['config', '--global', 'credential.interactive', 'false']);
    const other = spawnSync('git', ['credential', 'fill'], {
      env: { ...env, GIT_ASKPASS: '/usr/bin/false' },
      input: 'protocol=https\nhost=github.com\npath=owner/other.git\n\n', encoding: 'utf8',
    });
    assert.notEqual(other.status, 0);
    assert.ok(!other.stdout.includes('SYNTHETIC_NOT_A_REAL_TOKEN'));
    git(['config', '--global', '--unset', 'credential.interactive']);
  }
}));

test('startup preserves operator helper choices and tightens permissions', () => fixture(({ directory, git, initialize }) => {
  assert.equal(initialize().status, 0);
  git(['config', '--global', '--replace-all', 'credential.helper', 'cache']);
  const before = readFileSync(join(directory, 'config'), 'utf8');
  chmodSync(directory, 0o755);
  chmodSync(join(directory, 'config'), 0o644);
  assert.equal(initialize().status, 0);
  assert.equal(readFileSync(join(directory, 'config'), 'utf8'), before);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, 'config')).mode & 0o777, 0o600);
}));

test('malformed config is retained and startup fails', () => fixture(({ directory, initialize }) => {
  mkdirSync(directory);
  const broken = '[broken';
  writeFileSync(join(directory, 'config'), broken);
  assert.notEqual(initialize().status, 0);
  assert.equal(readFileSync(join(directory, 'config'), 'utf8'), broken);
}));

for (const path of ['config', 'credentials']) {
  test(`startup refuses symlinked ${path} without touching its target`, () => fixture(({ root, directory, initialize }) => {
    mkdirSync(directory);
    const target = join(root, 'target');
    writeFileSync(target, 'DO_NOT_CHANGE');
    symlinkSync(target, join(directory, path));
    assert.notEqual(initialize().status, 0);
    assert.equal(readFileSync(target, 'utf8'), 'DO_NOT_CHANGE');
  }));
}
