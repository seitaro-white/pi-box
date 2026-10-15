// package.json is authoritative. Direct dependencies except Pi and piBox.npmTools
// are bundled Pi packages. Derive manifests and registrations; never resolve versions.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/**
 * Derive a profile's dependencies and Pi package registrations from pinned inputs.
 *
 * @param {object} manifest Authoritative runtime package manifest.
 * @param {"base" | "recommended"} profile Image variant to prepare.
 * @returns {{manifest: object, settings: {packages: string[]}}} Generated files.
 * @throws {Error} If the profile is invalid, Pi is missing, or versions are not exact.
 */
export function prepareRuntime(manifest, profile) {
  if (!["base", "recommended"].includes(profile)) {
    throw new Error("Profile must be base or recommended");
  }
  if (!manifest.dependencies?.[PI_PACKAGE]) {
    throw new Error("Runtime must include Pi");
  }
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`Use an exact version for ${name}`);
    }
  }

  const npmTools = manifest.piBox?.npmTools ?? [];
  if (
    !Array.isArray(npmTools) ||
    npmTools.some((name) => name === PI_PACKAGE || !manifest.dependencies[name])
  ) {
    throw new Error("piBox.npmTools must list non-Pi runtime dependencies");
  }

  const dependencies =
    profile === "base"
      ? { [PI_PACKAGE]: manifest.dependencies[PI_PACKAGE] }
      : manifest.dependencies;
  return {
    manifest: {
      ...manifest,
      ...(profile === "base" && manifest.piBox
        ? { piBox: { ...manifest.piBox, npmTools: [] } }
        : {}),
      dependencies,
    },
    settings: {
      packages: Object.keys(dependencies)
        .filter((name) => name !== PI_PACKAGE && !npmTools.includes(name))
        .map((name) => `/opt/pi/node_modules/${name}`),
    },
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const [profile, destination = sourceDir] = process.argv.slice(2);
  const source = JSON.parse(
    readFileSync(join(sourceDir, "package.json"), "utf8"),
  );
  const runtime = prepareRuntime(source, profile);
  mkdirSync(join(destination, "defaults"), { recursive: true });
  writeFileSync(
    join(destination, "package.json"),
    JSON.stringify(runtime.manifest, null, 2) + "\n",
  );
  writeFileSync(
    join(destination, "defaults/settings.json"),
    JSON.stringify(runtime.settings, null, 2) + "\n",
  );
}
