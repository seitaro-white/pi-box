import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const credentialsGeneratorPath = fileURLToPath(
  new URL("../scripts/generate-db-credentials.mjs", import.meta.url),
);
function createTemporaryTestDirectory(testContext) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "pi-box-postgres-configuration-"),
  );
  testContext.after(() =>
    rmSync(temporaryDirectory, { recursive: true, force: true }),
  );
  return temporaryDirectory;
}
function runCredentialsGenerator(temporaryDirectory) {
  return spawnSync(process.execPath, [credentialsGeneratorPath], {
    cwd: temporaryDirectory,
    encoding: "utf8",
  });
}

test("credential generation preserves local Compose settings, creates private passwords and refuses rotation", (testContext) => {
  const temporaryDirectory = createTemporaryTestDirectory(testContext);
  const credentialsFilePath = join(temporaryDirectory, ".env");
  const existingSettings =
    "# Keep this selection\nCOMPOSE_FILE=compose.yaml:compose.postgres.yaml";
  writeFileSync(credentialsFilePath, existingSettings, { mode: 0o644 });
  const generationResult = runCredentialsGenerator(temporaryDirectory);
  assert.equal(generationResult.status, 0, generationResult.stderr);
  const credentialsFileContents = readFileSync(credentialsFilePath, "utf8");
  assert.ok(credentialsFileContents.startsWith(`${existingSettings}\n`));
  const credentialMatch = credentialsFileContents.match(
    /POSTGRES_PASSWORD=([a-f0-9]{64})\nAPP_DB_PASSWORD=([a-f0-9]{64})\n$/,
  );
  assert.ok(credentialMatch);
  assert.notEqual(credentialMatch[1], credentialMatch[2]);
  for (const generatedPassword of credentialMatch.slice(1)) {
    assert.ok(
      !(generationResult.stdout + generationResult.stderr).includes(
        generatedPassword,
      ),
    );
  }
  assert.equal(statSync(credentialsFilePath).mode & 0o777, 0o600);
  const repeatGenerationResult = runCredentialsGenerator(temporaryDirectory);
  assert.equal(repeatGenerationResult.status, 1);
  assert.match(repeatGenerationResult.stderr, /left unchanged/);
  assert.equal(
    readFileSync(credentialsFilePath, "utf8"),
    credentialsFileContents,
  );
});

test("credentials can be generated before local configuration and existing entries are never overwritten", (testContext) => {
  const temporaryDirectory = createTemporaryTestDirectory(testContext);
  const credentialsFilePath = join(temporaryDirectory, ".env");
  assert.equal(runCredentialsGenerator(temporaryDirectory).status, 0);
  assert.match(
    readFileSync(credentialsFilePath, "utf8"),
    /^POSTGRES_PASSWORD=[a-f0-9]{64}\nAPP_DB_PASSWORD=[a-f0-9]{64}\n$/,
  );
  writeFileSync(
    credentialsFilePath,
    "export APP_DB_PASSWORD=SYNTHETIC_EXISTING\n",
  );
  assert.equal(runCredentialsGenerator(temporaryDirectory).status, 1);
  assert.equal(
    readFileSync(credentialsFilePath, "utf8"),
    "export APP_DB_PASSWORD=SYNTHETIC_EXISTING\n",
  );
  rmSync(credentialsFilePath);
  const symlinkTargetPath = join(temporaryDirectory, "symlink-target");
  writeFileSync(symlinkTargetPath, "SYNTHETIC");
  symlinkSync(symlinkTargetPath, credentialsFilePath);
  assert.equal(runCredentialsGenerator(temporaryDirectory).status, 1);
  assert.equal(readFileSync(symlinkTargetPath, "utf8"), "SYNTHETIC");
});

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
