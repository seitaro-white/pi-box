import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

/**
 * List direct dependencies and flat overrides without merging their roles.
 *
 * @param {object} manifest Runtime package manifest.
 * @returns {{name: string, pinned: string, kind: string}[]} Versions to compare.
 * @throws {Error} If an override uses an unsupported nested structure.
 */
export function manifestEntries(manifest) {
  return [
    ...Object.entries(manifest.dependencies ?? {}).map(([name, pinned]) => ({
      name,
      pinned,
      kind: "dependency",
    })),
    ...Object.entries(manifest.overrides ?? {}).map(([name, pinned]) => {
      if (typeof pinned !== "string") {
        throw new Error(`Unsupported nested override: ${name}`);
      }
      return { name, pinned, kind: "override" };
    }),
  ];
}

/**
 * Query npm's latest dist-tag; this does not install or update anything.
 *
 * @param {string} name npm package name.
 * @returns {Promise<string>} Version currently assigned to the latest dist-tag.
 * @throws {Error} If the lookup fails or returns no usable version.
 */
export async function latestVersion(name) {
  const { stdout } = await execFileAsync(
    "npm",
    ["view", `${name}@latest`, "version", "--json"],
    {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  const version = JSON.parse(stdout);
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("Registry returned no latest version");
  }
  return version;
}

/**
 * Compare pins concurrently, recording lookup errors without modifying the manifest.
 *
 * @param {object} manifest Runtime package manifest.
 * @param {(name: string) => Promise<string>} [lookup] Version lookup, injectable in tests.
 * @returns {Promise<object[]>} Comparison rows, including per-package failures.
 */
export async function checkVersions(manifest, lookup = latestVersion) {
  return Promise.all(
    manifestEntries(manifest).map(async (entry) => {
      try {
        const latest = await lookup(entry.name);
        return {
          ...entry,
          latest,
          status: latest === entry.pinned ? "current" : "different",
        };
      } catch (error) {
        return { ...entry, latest: "—", status: "ERROR", error: error.message };
      }
    }),
  );
}

async function main() {
  const manifest = JSON.parse(
    await readFile(new URL("../container/package.json", import.meta.url), "utf8"),
  );
  const rows = await checkVersions(manifest);
  const columns = ["Package", "Kind", "Pinned", "Latest", "Status"];
  const values = rows.map(({ name, kind, pinned, latest, status }) => [
    name,
    kind,
    pinned,
    latest,
    status,
  ]);
  const widths = columns.map((header, i) =>
    Math.max(header.length, ...values.map((row) => row[i].length)),
  );
  const format = (row) =>
    row
      .map((cell, i) => cell.padEnd(widths[i]))
      .join("  ")
      .trimEnd();

  console.log(format(columns));
  for (const row of values) {
    console.log(format(row));
  }
  console.log(
    "\nRead-only: latest means the npm latest dist-tag; different does not necessarily mean newer.",
  );
  for (const row of rows.filter((row) => row.error)) {
    console.error(`${row.name}: ${row.error}`);
  }
  if (rows.some((row) => row.error)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
