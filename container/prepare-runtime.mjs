// package.json is authoritative. Direct dependencies except Pi and piBox.npmTools
// are bundled Pi packages. Personal skills are added from Git at image build time.
// Derive registrations; never resolve versions.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/**
 * Derive Pi package registrations from pinned inputs.
 *
 * @param {object} manifest Authoritative runtime package manifest.
 * @returns {{settings: {packages: (string | object)[]}}} Generated files.
 * @throws {Error} If Pi is missing or sources are not pinned.
 */
export function prepareRuntime(manifest) {
  if (!manifest.dependencies?.[PI_PACKAGE]) {
    throw new Error("Runtime must include Pi");
  }
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
    const gitCommit = /^git\+https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git#[a-f0-9]{40}$/.test(version);
    if (!exactVersion && !gitCommit) {
      throw new Error(`Use an exact version or full Git commit for ${name}`);
    }
  }

  const npmTools = manifest.piBox?.npmTools ?? [];
  if (
    !Array.isArray(npmTools) ||
    npmTools.some((name) => name === PI_PACKAGE || !manifest.dependencies[name])
  ) {
    throw new Error("piBox.npmTools must list non-Pi runtime dependencies");
  }

  return {
    settings: {
      packages: [
        ...Object.keys(manifest.dependencies)
          .filter((name) => name !== PI_PACKAGE && !npmTools.includes(name))
          .map((name) => {
            const source = `/opt/pi/node_modules/${name}`;
            const resources = manifest.piBox?.packageResources?.[name];
            return resources ? { source, ...resources } : source;
          }),
        ...(manifest.piBox?.personalSkills
          ? ["/opt/pi/node_modules/personal-skills"]
          : []),
      ],
    },
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const [destination = sourceDir] = process.argv.slice(2);
  const source = JSON.parse(
    readFileSync(join(sourceDir, "package.json"), "utf8"),
  );
  const runtime = prepareRuntime(source);
  mkdirSync(join(destination, "defaults"), { recursive: true });
  writeFileSync(
    join(destination, "defaults/settings.json"),
    JSON.stringify(runtime.settings, null, 2) + "\n",
  );
}
