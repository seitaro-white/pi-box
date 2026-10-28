// Shared unit-test fixtures (Vitest's equivalent of pytest's conftest.py).
// Tests request them by name: test("...", ({ tmpDir, agentState }) => ...).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test as base } from "vitest";
import { readJson, root } from "./files.mjs";

export const test = base.extend({
  /** A private, empty directory removed after the test (pytest's tmp_path). */
  // biome-ignore lint/correctness/noEmptyPattern: Vitest reads fixture dependencies from this destructuring pattern.
  tmpDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), "pi-box-test-"));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },

  /**
   * Synthetic Pi agent state plus a runner for the real initializer.
   * Never reads or writes the host's Pi state.
   */
  agentState: async ({ tmpDir }, use) => {
    const path = (name) => join(tmpDir, name);
    const write = (name, value) => {
      mkdirSync(dirname(path(name)), { recursive: true, mode: 0o700 });
      writeFileSync(path(name), value, { mode: 0o600 });
    };
    await use({
      path,
      read: (name) => readFileSync(path(name), "utf8"),
      json: (name) => readJson(path(name)),
      write,
      writeJson: (name, value) => write(name, JSON.stringify(value)),
      /** Run container/init-agent.mjs as the given image profile would. */
      run: (profile = "recommended") =>
        execFileSync(process.execPath, [join(root, "container/init-agent.mjs")], {
          env: {
            ...process.env,
            PI_CODING_AGENT_DIR: tmpDir,
            PI_BOX_DEFAULTS_DIR: join(
              root,
              profile === "base" ? "container/base/defaults" : "container/defaults",
            ),
          },
          stdio: "pipe",
        }),
    });
  },
});
