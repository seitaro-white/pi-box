// Focused MVP acceptance: SQL from Pi Box, least-privilege role, private
// networking and persistence. Only disposable credentials/containers/volumes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./helpers/engine.mjs";

const testProjectName = `pi-box-postgres-${randomUUID()}`;
const temporaryCredentialsDirectory = mkdtempSync(
  join(tmpdir(), testProjectName),
);
const testEnvironment = {
  ...process.env,
  COMPOSE_FILE: ["../compose.yaml", "../compose.postgres.yaml"]
    .map((composeFilePath) =>
      fileURLToPath(new URL(composeFilePath, import.meta.url)),
    )
    .join(":"),
  COMPOSE_ENV_FILES: join(temporaryCredentialsDirectory, ".env.postgres"),
  POSTGRES_CREDENTIALS_FILE: join(
    temporaryCredentialsDirectory,
    ".env.postgres",
  ),
  ENABLE_POSTGRES: "1",
  COMPOSE_PROJECT_NAME: testProjectName,
  CONTAINER: testProjectName,
  IMAGE: process.env.PI_BOX_RECOMMENDED_IMAGE || "pi-box:0.2.0",
  TARGET: "recommended",
  WORKSPACE_VOLUME: `${testProjectName}-workspace`,
  AGENT_VOLUME: `${testProjectName}-agent`,
  GIT_VOLUME: `${testProjectName}-git`,
};
for (const credentialVariable of ["POSTGRES_PASSWORD", "APP_DB_PASSWORD"]) {
  delete testEnvironment[credentialVariable];
}
const commandOptions = {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: testEnvironment,
  timeout: 300_000,
};
const runDockerCommand = (argumentsList) =>
  runCommand("docker", argumentsList, commandOptions);
const runComposeCommand = (argumentsList) =>
  runDockerCommand(["compose", ...argumentsList]);
// Acceptance uses prebuilt Pi images; normal make up still builds first.
const runMakeTarget = (targetName) =>
  runCommand("make", ["-o", "build", targetName], commandOptions);
const inspectContainer = (containerId) =>
  JSON.parse(runDockerCommand(["inspect", containerId]))[0];
const getPostgresContainerId = () =>
  runComposeCommand(["ps", "--all", "--quiet", "db"]);
const executeSqlInPiContainer = (sqlQuery) =>
  runComposeCommand([
    "exec",
    "-T",
    "pi",
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    sqlQuery,
  ]);

try {
  runMakeTarget("generate-db-credentials");
  const resolvedComposeConfiguration = JSON.parse(
    runComposeCommand(["config", "--format", "json"]),
  );
  assert.equal(resolvedComposeConfiguration.services.db.ports, undefined);
  assert.equal(
    resolvedComposeConfiguration.services.pi.environment.POSTGRES_PASSWORD,
    undefined,
  );
  assert.notEqual(
    resolvedComposeConfiguration.services.pi.environment.PGPASSWORD,
    resolvedComposeConfiguration.services.db.environment.POSTGRES_PASSWORD,
  );
  runMakeTarget("up");
  const originalPostgresContainerId = getPostgresContainerId();
  assert.equal(
    inspectContainer(originalPostgresContainerId).State.Health.Status,
    "healthy",
  );
  assert.deepEqual(
    inspectContainer(originalPostgresContainerId).HostConfig.PortBindings || {},
    {},
  );
  assert.equal(
    executeSqlInPiContainer("SELECT current_user, current_database()"),
    "app|appdb",
  );
  assert.match(executeSqlInPiContainer("SHOW server_version"), /^15\./);
  assert.equal(
    executeSqlInPiContainer(
      "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    ),
    "f|f|f|f|f",
  );
  assert.equal(
    executeSqlInPiContainer(
      "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'",
    ),
    "0",
    "normal startup creates no demo tables",
  );

  const incorrectPasswordConnectionResult = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "pi",
      "env",
      "PGPASSWORD=SYNTHETIC_WRONG_PASSWORD",
      "psql",
      "-X",
      "-c",
      "SELECT 1",
    ],
    { ...commandOptions, encoding: "utf8" },
  );
  assert.notEqual(incorrectPasswordConnectionResult.status, 0);
  assert.match(
    incorrectPasswordConnectionResult.stderr,
    /password authentication failed/,
  );
  executeSqlInPiContainer(
    "CREATE TABLE notes (id integer PRIMARY KEY, body text); INSERT INTO notes VALUES (1, 'synthetic'), (2, 'delete me'); UPDATE notes SET body = 'updated' WHERE id = 1; DELETE FROM notes WHERE id = 2;",
  );
  assert.equal(
    executeSqlInPiContainer("SELECT id, body FROM notes"),
    "1|updated",
  );

  runMakeTarget("replace");
  assert.equal(
    getPostgresContainerId(),
    originalPostgresContainerId,
    "replacing Pi must leave the database container alone",
  );
  assert.equal(executeSqlInPiContainer("SELECT body FROM notes"), "updated");
  runComposeCommand([
    "up",
    "-d",
    "--no-build",
    "--pull",
    "never",
    "--no-deps",
    "--force-recreate",
    "--wait",
    "--wait-timeout",
    "60",
    "db",
  ]);
  assert.notEqual(getPostgresContainerId(), originalPostgresContainerId);
  assert.equal(
    executeSqlInPiContainer("SELECT body FROM notes"),
    "updated",
    "database recreation retains data without replaying bootstrap",
  );

  runComposeCommand(["down"]);
  runDockerCommand([
    "volume",
    "rm",
    testEnvironment.WORKSPACE_VOLUME,
    testEnvironment.AGENT_VOLUME,
    testEnvironment.GIT_VOLUME,
    resolvedComposeConfiguration.volumes.postgres.name,
  ]);
  rmSync(temporaryCredentialsDirectory, { recursive: true, force: true });
  console.log(
    "PASS: PostgreSQL SQL/CRUD from Pi, restricted role, password authentication, no published ports and persistence across recreation.",
  );
} catch (error) {
  console.error(
    `FAILED: retained isolated project ${testProjectName} and credential directory ${temporaryCredentialsDirectory}.`,
  );
  throw error; // Never print credential-bearing Compose config or environment files.
}
