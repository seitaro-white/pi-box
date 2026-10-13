// Seed non-secret defaults into fresh OR existing volumes without clobbering
// model preferences, auth, history, or operator-owned extension configuration.
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const dir = process.env.PI_CODING_AGENT_DIR || '/home/node/.pi/agent';
const defaults = process.env.PI_BOX_DEFAULTS_DIR
  ? join(process.env.PI_BOX_DEFAULTS_DIR, 'settings.json')
  : new URL('./defaults/settings.json', import.meta.url);
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const baseline = read(defaults);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const settingsPath = join(dir, 'settings.json');
let settings;
try { settings = read(settingsPath); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  settings = {};
}
if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid Pi settings object');
const sourceOf = item => typeof item === 'string' ? item : item?.source;
const validPackages = packages => Array.isArray(packages)
  && packages.every(item => typeof sourceOf(item) === 'string');
const original = JSON.stringify(settings);
settings.packages ??= [];
if (!validPackages(settings.packages)) throw new Error('Invalid Pi packages list');
if (!validPackages(baseline.packages)) throw new Error('Invalid image packages list');

// Track only image-owned paths, not npm/git sources installed by the operator.
// The two legacy paths migrate volumes created before ownership was recorded.
const legacy = ['/opt/pi/node_modules/pi-subagents', '/opt/pi/node_modules/pi-web-access'];
const managedPath = join(dir, 'pi-box-packages.json');
let previous;
let hadOwnership = true;
try { previous = read(managedPath); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  hadOwnership = false;
  previous = { version: 1, packages: legacy };
}
if (previous?.version !== 1 || !Array.isArray(previous.packages)
  || !previous.packages.every(p => typeof p === 'string' && p.startsWith('/opt/pi/node_modules/'))) {
  throw new Error('Invalid Pi Box package ownership file');
}
const desired = new Set(baseline.packages.map(sourceOf));
const managed = new Set([...previous.packages, ...desired]);
settings.packages = settings.packages.filter(item => !managed.has(sourceOf(item)) || desired.has(sourceOf(item)));
for (const item of baseline.packages) {
  if (!settings.packages.some(p => sourceOf(p) === sourceOf(item))) settings.packages.push(item);
}
const writeAtomic = (path, value) => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
};
// Keep the history of owned paths. Record it before changing settings so a
// restart after interruption can still clean references from an older image.
const ownership = { version: 1, packages: [...managed] };
if (!hadOwnership || JSON.stringify(previous) !== JSON.stringify(ownership)) writeAtomic(managedPath, ownership);
if (JSON.stringify(settings) !== original) writeAtomic(settingsPath, settings);
// Extension policy files are operator-owned. Fresh installs use upstream
// defaults; existing persistent configuration is deliberately left untouched.
