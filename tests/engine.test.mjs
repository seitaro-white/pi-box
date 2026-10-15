// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEngine, runCommand } from "./helpers/engine.mjs";

for (const kind of ["docker", "podman"]) {
  test(`engine selection: ${kind}, executable paths and stdin`, () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-box-engine-"));
    try {
      const executable = join(directory, "engine with spaces");
      const log = join(directory, "calls.json");
      writeFileSync(
        executable,
        `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync(process.env.LOG, JSON.stringify({ args: process.argv.slice(2), input: fs.readFileSync(0, "utf8") }));
console.log("captured output");
`,
        { mode: 0o755 },
      );
      const engine = createEngine({
        ...process.env,
        PI_BOX_ENGINE: kind,
        DOCKER_BIN: executable,
        PODMAN_BIN: executable,
        PODMAN_CONNECTION: "connection with spaces",
        LOG: log,
      });
      assert.equal(
        engine.run(["exec", "synthetic", "node"], {
          input: "synthetic fixture",
        }),
        "captured output",
      );
      assert.deepEqual(JSON.parse(readFileSync(log, "utf8")), {
        args: [
          ...(kind === "podman"
            ? ["--connection", "connection with spaces"]
            : []),
          "exec",
          "synthetic",
          "node",
        ],
        input: "synthetic fixture",
      });
      assert.equal(engine.succeeds(["info"]), true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("engine validation, nonzero exits, missing executables and timeouts", () => {
  assert.throws(
    () => createEngine({ PI_BOX_ENGINE: "invalid" }),
    /PI_BOX_ENGINE/,
  );
  assert.throws(
    () =>
      runCommand(process.execPath, [
        "-e",
        'console.error("synthetic failure"); process.exit(7)',
      ]),
    /failed \(7\).*synthetic failure/,
  );
  const missing = createEngine({
    DOCKER_BIN: "/nonexistent/pi-box-synthetic-engine",
  });
  assert.throws(() => missing.run(["info"]), /ENOENT/);
  assert.throws(() => missing.succeeds(["info"]), /ENOENT/);
  assert.throws(
    () =>
      runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
        timeout: 50,
      }),
    /ETIMEDOUT/,
  );
  const failing = createEngine({ DOCKER_BIN: process.execPath });
  assert.equal(failing.succeeds(["-e", "process.exit(1)"]), false);
});
