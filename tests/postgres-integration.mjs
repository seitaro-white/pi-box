// Focused MVP acceptance: SQL from Pi Box, least-privilege role, private
// networking and persistence. Only disposable credentials/containers/volumes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./helpers/engine.mjs";

const testProjectName = `pi-box-postgres-${randomUUID()}`;
const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));
const temporaryProjectDirectory = mkdtempSync(join(tmpdir(), testProjectName));
// Copy only the runtime configuration/scripts, never the operator's .env or data.
for (const resourcePath of [
  "Makefile",
  "compose.yaml",
  "compose.postgres.yaml",
  "scripts",
  "container/bootstrap-app-role.sh",
]) {
  const destinationPath = join(temporaryProjectDirectory, resourcePath);
  mkdirSync(dirname(destinationPath), { recursive: true });
  cpSync(join(repositoryDirectory, resourcePath), destinationPath, {
    recursive: true,
  });
}
const localComposeSettings = {
  COMPOSE_FILE: "compose.yaml:compose.postgres.yaml",
  COMPOSE_PROJECT_NAME: testProjectName,
  CONTAINER: testProjectName,
  IMAGE: process.env.PI_BOX_RECOMMENDED_IMAGE || "pi-box:0.2.0",
  TARGET: "recommended",
  WORKSPACE_VOLUME: `${testProjectName}-workspace`,
  AGENT_VOLUME: `${testProjectName}-agent`,
  GIT_VOLUME: `${testProjectName}-git`,
};
writeFileSync(
  join(temporaryProjectDirectory, ".env"),
  Object.entries(localComposeSettings)
    .map(([settingName, settingValue]) => `${settingName}=${settingValue}\n`)
    .join(""),
  { mode: 0o600 },
);
const testEnvironment = { ...process.env };
for (const settingName of [
  ...Object.keys(localComposeSettings),
  "POSTGRES_PASSWORD",
  "APP_DB_PASSWORD",
  "COMPOSE_ENV_FILES",
  "COMPOSE_DISABLE_ENV_FILE",
  "COMPOSE_PROFILES",
  "COMPOSE_PATH_SEPARATOR",
])
  delete testEnvironment[settingName];
const commandOptions = {
  cwd: temporaryProjectDirectory,
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
  assert.equal(resolvedComposeConfiguration.name, testProjectName);
  assert.equal(
    resolvedComposeConfiguration.services.pi.image,
    localComposeSettings.IMAGE,
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

  // Selecting Pi-only in .env stops passing credentials to Pi but retains the
  // database volume. Re-selecting the overlay reconnects to the same data.
  const environmentFilePath = join(temporaryProjectDirectory, ".env");
  const databaseEnabledConfiguration = readFileSync(
    environmentFilePath,
    "utf8",
  );
  runComposeCommand(["stop", "db"]);
  writeFileSync(
    environmentFilePath,
    databaseEnabledConfiguration.replace(
      "COMPOSE_FILE=compose.yaml:compose.postgres.yaml",
      "COMPOSE_FILE=compose.yaml",
    ),
  );
  runMakeTarget("up");
  const piOnlyConfiguration = JSON.parse(
    runComposeCommand(["config", "--format", "json"]),
  );
  assert.deepEqual(Object.keys(piOnlyConfiguration.services), ["pi"]);
  assert.equal(
    inspectContainer(testProjectName).Config.Env.some((value) =>
      value.startsWith("PGPASSWORD="),
    ),
    false,
  );
  writeFileSync(environmentFilePath, databaseEnabledConfiguration);
  runMakeTarget("up");
  assert.equal(executeSqlInPiContainer("SELECT body FROM notes"), "updated");

  runComposeCommand(["down"]);
  runDockerCommand([
    "volume",
    "rm",
    localComposeSettings.WORKSPACE_VOLUME,
    localComposeSettings.AGENT_VOLUME,
    localComposeSettings.GIT_VOLUME,
    resolvedComposeConfiguration.volumes.postgres.name,
  ]);
  rmSync(temporaryProjectDirectory, { recursive: true, force: true });
  console.log(
    "PASS: native .env Compose selection/overrides, PostgreSQL SQL/CRUD, restricted role, private networking and persistence across recreation.",
  );
} catch (error) {
  console.error(
    `FAILED: retained isolated project ${testProjectName} and private test directory ${temporaryProjectDirectory}.`,
  );
  throw error; // Never print credential-bearing Compose config or environment files.
}
