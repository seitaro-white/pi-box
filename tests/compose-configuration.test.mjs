import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function createTemporaryTestDirectory(testContext) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "pi-box-compose-configuration-"),
  );
  testContext.after(() =>
    rmSync(temporaryDirectory, { recursive: true, force: true }),
  );
  return temporaryDirectory;
}
for (const explicitOverrides of [false, true]) {
  test(`Make delegates file selection to Compose (explicit overrides: ${explicitOverrides})`, (testContext) => {
    const temporaryDirectory = createTemporaryTestDirectory(testContext);
    writeFileSync(
      join(temporaryDirectory, "docker"),
      `#!${process.execPath}
console.log(JSON.stringify({ composeFiles: process.env.COMPOSE_FILE || null, image: process.env.IMAGE || null }));
`,
      { mode: 0o755 },
    );
    const stubEnvironment = {
      ...process.env,
      PATH: `${temporaryDirectory}:${process.env.PATH}`,
    };
    delete stubEnvironment.COMPOSE_FILE;
    delete stubEnvironment.IMAGE;
    const makeArguments = [
      "-s",
      "attach",
      ...(explicitOverrides
        ? [
            "COMPOSE_FILE=compose.yaml:compose.postgres.yaml",
            "IMAGE=pi-box:test-override",
          ]
        : []),
    ];
    const commandResult = spawnSync("make", makeArguments, {
      encoding: "utf8",
      env: stubEnvironment,
    });
    assert.equal(commandResult.status, 0, commandResult.stderr);
    assert.deepEqual(
      JSON.parse(commandResult.stdout),
      explicitOverrides
        ? {
            composeFiles: "compose.yaml:compose.postgres.yaml",
            image: "pi-box:test-override",
          }
        : { composeFiles: null, image: null },
    );
  });
}

test("local configuration is Git-ignored and excluded from image context", () => {
  const gitIgnoreResult = spawnSync("git", ["check-ignore", ".env"], {
    encoding: "utf8",
  });
  assert.equal(gitIgnoreResult.status, 0, gitIgnoreResult.stderr);
  const dockerIgnoreContents = readFileSync(".dockerignore", "utf8");
  assert.match(dockerIgnoreContents, /^\*\*$/m);
  assert.doesNotMatch(dockerIgnoreContents, /^!.*\.env/m);
});
