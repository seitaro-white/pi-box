// package.json is authoritative. All direct dependencies except Pi are bundled
// Pi packages. Derive the base manifest and registrations; never resolve versions.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PI_PACKAGE = '@earendil-works/pi-coding-agent';
export function prepareRuntime(manifest, profile) {
  if (!['base', 'recommended'].includes(profile)) throw new Error('Profile must be base or recommended');
  if (!manifest.dependencies?.[PI_PACKAGE]) throw new Error('Runtime must include Pi');
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`Use an exact version for ${name}`);
    }
  }
  const dependencies = profile === 'base'
    ? { [PI_PACKAGE]: manifest.dependencies[PI_PACKAGE] }
    : manifest.dependencies;
  return {
    manifest: { ...manifest, dependencies },
    settings: { packages: Object.keys(dependencies)
      .filter(name => name !== PI_PACKAGE)
      .map(name => `/opt/pi/node_modules/${name}`) },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const [profile, destination = sourceDir] = process.argv.slice(2);
  const source = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'));
  const runtime = prepareRuntime(source, profile);
  mkdirSync(join(destination, 'defaults'), { recursive: true });
  writeFileSync(join(destination, 'package.json'), JSON.stringify(runtime.manifest, null, 2) + '\n');
  writeFileSync(join(destination, 'defaults/settings.json'), JSON.stringify(runtime.settings, null, 2) + '\n');
}
