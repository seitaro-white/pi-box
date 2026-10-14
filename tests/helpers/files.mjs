import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));

/** Read a fixture's JSON without hiding missing or malformed files. */
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * Allocate an isolated test directory and register cleanup with the test runner.
 *
 * @param {import("node:test").TestContext} t Owning test context.
 * @param {string} prefix Temporary directory name prefix.
 * @returns {string} Absolute path to the temporary directory.
 */
export function temporaryDirectory(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
