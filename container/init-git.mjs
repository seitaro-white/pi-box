// Git state belongs to its runtime volume, never to the image or agent volume.
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const config = process.env.GIT_CONFIG_GLOBAL;
if (!config) throw new Error('GIT_CONFIG_GLOBAL must point into the Git volume');
const directory = dirname(config);
const credentials = join(directory, 'credentials');

function requireType(path, directoryExpected = false) {
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink() || (directoryExpected ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`Refusing unexpected Git state path: ${path}`);
  }
}

requireType(directory, true);
requireType(config);
requireType(credentials);
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
for (const path of [config, credentials]) {
  if (existsSync(path)) chmodSync(path, 0o600);
}

// Seed defaults once. On subsequent starts, preserve operator preferences,
// including an intentionally disabled or replaced credential helper.
if (!existsSync(config)) {
  const staging = mkdtempSync(join(directory, '.init-'));
  try {
    const stagedConfig = join(staging, 'config');
    const configure = (...args) => execFileSync('git', ['config', '--file', stagedConfig, ...args]);
    const quoted = `'${credentials.replaceAll("'", "'\\''")}'`;
    configure('--add', 'credential.helper', ''); // Reset inherited helpers.
    configure('--add', 'credential.helper', `store --file=${quoted}`);
    // Avoid offering a token saved for one repository to a different repository.
    configure('credential.https://github.com.useHttpPath', 'true');
    chmodSync(stagedConfig, 0o600);
    renameSync(stagedConfig, config);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

// Fail startup on malformed existing config, without replacing it.
const validation = spawnSync('git', ['config', '--global', '--list'], { stdio: 'ignore' });
if (validation.status !== 0) throw new Error('Git global config is invalid; existing file retained');
