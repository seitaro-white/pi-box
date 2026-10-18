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

const name = `pi-box-postgres-${randomUUID()}`;
const dir = mkdtempSync(join(tmpdir(), name));
const env = {
  ...process.env,
  COMPOSE_FILE: ["../compose.yaml", "../compose.postgres.yaml"]
    .map((path) => fileURLToPath(new URL(path, import.meta.url)))
    .join(":"),
  COMPOSE_ENV_FILES: join(dir, ".env.postgres"),
  DATABASE_ENV_FILE: join(dir, ".env.postgres"),
  DATABASE: "1",
  COMPOSE_PROJECT_NAME: name,
  CONTAINER: name,
  IMAGE: process.env.PI_BOX_RECOMMENDED_IMAGE || "pi-box:0.2.0",
  TARGET: "recommended",
  WORKSPACE_VOLUME: `${name}-workspace`,
  AGENT_VOLUME: `${name}-agent`,
  GIT_VOLUME: `${name}-git`,
};
for (const key of ["POSTGRES_PASSWORD", "APP_DB_PASSWORD"]) delete env[key];
const options = {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env,
  timeout: 300_000,
};
const docker = (args) => runCommand("docker", args, options);
const compose = (args) => docker(["compose", ...args]);
// Acceptance uses prebuilt Pi images; normal make up still builds first.
const make = (target) => runCommand("make", ["-o", "build", target], options);
const inspect = (id) => JSON.parse(docker(["inspect", id]))[0];
const database = () => compose(["ps", "--all", "--quiet", "db"]);
const sql = (query) =>
  compose([
    "exec",
    "-T",
    "pi",
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    query,
  ]);

try {
  make("db-init");
  const config = JSON.parse(compose(["config", "--format", "json"]));
  assert.equal(config.services.db.ports, undefined);
  assert.equal(config.services.pi.environment.POSTGRES_PASSWORD, undefined);
  assert.notEqual(
    config.services.pi.environment.PGPASSWORD,
    config.services.db.environment.POSTGRES_PASSWORD,
  );
  make("up");
  const db = database();
  assert.equal(inspect(db).State.Health.Status, "healthy");
  assert.deepEqual(inspect(db).HostConfig.PortBindings || {}, {});
  assert.equal(sql("SELECT current_user, current_database()"), "app|appdb");
  assert.match(sql("SHOW server_version"), /^15\./);
  assert.equal(
    sql(
      "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    ),
    "f|f|f|f|f",
  );
  assert.equal(
    sql("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"),
    "0",
    "normal startup creates no demo tables",
  );

  const wrongPassword = spawnSync(
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
    { ...options, encoding: "utf8" },
  );
  assert.notEqual(wrongPassword.status, 0);
  assert.match(wrongPassword.stderr, /password authentication failed/);
  sql(
    "CREATE TABLE notes (id integer PRIMARY KEY, body text); INSERT INTO notes VALUES (1, 'synthetic'), (2, 'delete me'); UPDATE notes SET body = 'updated' WHERE id = 1; DELETE FROM notes WHERE id = 2;",
  );
  assert.equal(sql("SELECT id, body FROM notes"), "1|updated");

  make("replace");
  assert.equal(
    database(),
    db,
    "replacing Pi must leave the database container alone",
  );
  assert.equal(sql("SELECT body FROM notes"), "updated");
  compose([
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
  assert.notEqual(database(), db);
  assert.equal(
    sql("SELECT body FROM notes"),
    "updated",
    "database recreation retains data without replaying bootstrap",
  );

  compose(["down"]);
  docker([
    "volume",
    "rm",
    env.WORKSPACE_VOLUME,
    env.AGENT_VOLUME,
    env.GIT_VOLUME,
    config.volumes.postgres.name,
  ]);
  rmSync(dir, { recursive: true, force: true });
  console.log(
    "PASS: PostgreSQL SQL/CRUD from Pi, restricted role, password authentication, no published ports and persistence across recreation.",
  );
} catch (error) {
  console.error(
    `FAILED: retained isolated project ${name} and credential directory ${dir}.`,
  );
  throw error; // Never print credential-bearing Compose config or environment files.
}
