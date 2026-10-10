// Seed non-secret defaults into fresh OR existing volumes without clobbering
// model preferences, auth, history, or operator-owned extension configuration.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.env.PI_CODING_AGENT_DIR || '/home/node/.pi/agent';
const defaults = new URL('./defaults/', import.meta.url);
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const baseline = read(new URL('settings.json', defaults));
mkdirSync(dir, { recursive: true, mode: 0o700 });
const settingsPath = join(dir, 'settings.json');
let settings;
try { settings = read(settingsPath); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  settings = {};
}
if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid Pi settings object');
const original = JSON.stringify(settings);
settings.packages ??= [];
if (!Array.isArray(settings.packages)) throw new Error('Invalid Pi packages list');
for (const item of baseline.packages) {
  const source = typeof item === 'string' ? item : item.source;
  if (!settings.packages.some(p => (typeof p === 'string' ? p : p.source) === source)) settings.packages.push(item);
}
if (JSON.stringify(settings) !== original) writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
// Extension policy files are operator-owned. Fresh installs use upstream
// defaults; existing persistent configuration is deliberately left untouched.
