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
      "build",
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

test("Compose uses descriptive service names without changing persistent storage", () => {
  const base = readFileSync("compose.yaml", "utf8");
  const postgres = readFileSync("compose.postgres.yaml", "utf8");
  const services = (contents) =>
    [...contents.split(/^volumes:/m)[0].matchAll(/^  ([\w-]+):$/gm)]
      .map((match) => match[1]);
  assert.deepEqual(services(base), ["pi-box"]);
  assert.deepEqual(services(postgres), ["pi-box", "postgres"]);
  assert.match(base, /container_name: \$\{CONTAINER:-pi-box-main-container\}/);
  assert.ok(postgres.includes("container_name: ${COMPOSE_PROJECT_NAME:-pi-box}-postgres-container"));
  for (const name of ["workspace", "agent", "git"]) {
    assert.ok(base.includes(`:-pi-box-${name}}`), `retain ${name} volume name`);
  }
  assert.match(postgres, /PGHOST: postgres/);
  assert.match(postgres, /depends_on:\n      postgres:\n        condition: service_healthy/);
  assert.match(postgres, /- postgres:\/var\/lib\/postgresql\/data/);
  assert.match(postgres, /^  postgres: \{\}$/m);
});

test("local configuration is Git-ignored and excluded from image context", () => {
  const gitIgnoreResult = spawnSync("git", ["check-ignore", ".env"], {
    encoding: "utf8",
  });
  assert.equal(gitIgnoreResult.status, 0, gitIgnoreResult.stderr);
  const dockerIgnoreContents = readFileSync(".dockerignore", "utf8");
  assert.match(dockerIgnoreContents, /^\*\*$/m);
  assert.doesNotMatch(dockerIgnoreContents, /^!.*\.env/m);
});
