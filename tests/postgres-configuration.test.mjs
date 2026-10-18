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

function createTemporaryTestDirectory(testContext) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "pi-box-postgres-configuration-"),
  );
  testContext.after(() =>
    rmSync(temporaryDirectory, { recursive: true, force: true }),
  );
  return temporaryDirectory;
}

test("database credentials are private, random, separate and never printed or overwritten", (testContext) => {
  const temporaryDirectory = createTemporaryTestDirectory(testContext);
  const credentialsFilePath = join(temporaryDirectory, ".env.postgres");
  const runCredentialsGenerator = () =>
    spawnSync(process.execPath, ["scripts/generate-db-credentials.mjs"], {
      encoding: "utf8",
      env: { ...process.env, POSTGRES_CREDENTIALS_FILE: credentialsFilePath },
    });
  const generationResult = runCredentialsGenerator();
  assert.equal(generationResult.status, 0, generationResult.stderr);
  const credentialsFileContents = readFileSync(credentialsFilePath, "utf8");
  assert.match(
    credentialsFileContents,
    /^POSTGRES_PASSWORD=[a-f0-9]{64}\nAPP_DB_PASSWORD=[a-f0-9]{64}\n$/,
  );
  const generatedPasswords = credentialsFileContents
    .trim()
    .split("\n")
    .map((environmentEntry) => environmentEntry.split("=")[1]);
  assert.notEqual(generatedPasswords[0], generatedPasswords[1]);
  for (const generatedPassword of generatedPasswords) {
    assert.ok(
      !(generationResult.stdout + generationResult.stderr).includes(
        generatedPassword,
      ),
    );
  }
  assert.equal(statSync(credentialsFilePath).mode & 0o777, 0o600);
  const repeatGenerationResult = runCredentialsGenerator();
  assert.equal(repeatGenerationResult.status, 1);
  assert.match(repeatGenerationResult.stderr, /left unchanged/);
  assert.equal(
    readFileSync(credentialsFilePath, "utf8"),
    credentialsFileContents,
  );
  rmSync(credentialsFilePath);
  const symlinkTargetPath = join(temporaryDirectory, "symlink-target");
  writeFileSync(symlinkTargetPath, "SYNTHETIC");
  symlinkSync(symlinkTargetPath, credentialsFilePath);
  assert.equal(runCredentialsGenerator().status, 1);
  assert.equal(readFileSync(symlinkTargetPath, "utf8"), "SYNTHETIC");
});

for (const postgresEnabled of ["0", "1"]) {
  test(`Make selects PostgreSQL only with ENABLE_POSTGRES=${postgresEnabled}`, (testContext) => {
    const temporaryDirectory = createTemporaryTestDirectory(testContext);
    writeFileSync(
      join(temporaryDirectory, "docker"),
      `#!${process.execPath}
console.log(JSON.stringify({ composeFiles: process.env.COMPOSE_FILE || "", composeEnvironmentFiles: process.env.COMPOSE_ENV_FILES || "" }));
`,
      { mode: 0o755 },
    );
    const stubEnvironment = {
      ...process.env,
      PATH: `${temporaryDirectory}:${process.env.PATH}`,
    };
    delete stubEnvironment.COMPOSE_FILE;
    delete stubEnvironment.COMPOSE_ENV_FILES;
    const commandResult = spawnSync(
      "make",
      [
        "-s",
        "attach",
        `ENABLE_POSTGRES=${postgresEnabled}`,
        "POSTGRES_CREDENTIALS_FILE=.env.test-postgres",
      ],
      { encoding: "utf8", env: stubEnvironment },
    );
    assert.equal(commandResult.status, 0, commandResult.stderr);
    assert.deepEqual(
      JSON.parse(commandResult.stdout),
      postgresEnabled === "1"
        ? {
            composeFiles: "compose.yaml:compose.postgres.yaml",
            composeEnvironmentFiles: ".env.test-postgres",
          }
        : { composeFiles: "compose.yaml", composeEnvironmentFiles: "" },
    );
  });
}

test("the default credential file is ignored by Git and excluded from image context", () => {
  const gitIgnoreResult = spawnSync("git", ["check-ignore", ".env.postgres"], {
    encoding: "utf8",
  });
  assert.equal(gitIgnoreResult.status, 0, gitIgnoreResult.stderr);
  const dockerIgnoreContents = readFileSync(".dockerignore", "utf8");
  assert.match(dockerIgnoreContents, /^\*\*$/m);
  assert.doesNotMatch(dockerIgnoreContents, /^!.*\.env/m);
});
