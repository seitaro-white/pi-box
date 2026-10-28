// SQL from Pi using disposable configured credentials; no published DB port.
import { expect } from "vitest";
import { incrementalSteps } from "../support/acceptance.mjs";
import { composeTest } from "../support/compose-project.mjs";

const test = composeTest({ name: "postgres", overlays: ["compose.postgres.yaml"] });
incrementalSteps();

const postgresId = (p) => p.compose(["ps", "--all", "--quiet", "postgres"]);
const sql = (p, query) => p.compose([
  "exec", "-T", "pi-box", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-Atc", query,
]);
let originalId;

test("configuration shares the password and publishes no database port", ({ project: p }) => {
  const config = p.config();
  expect(config.services.postgres.ports).toBeUndefined();
  // Compare without printing the password, even this synthetic one.
  expect(config.services["pi-box"].environment.PGPASSWORD === p.settings.POSTGRES_PASSWORD).toBe(true);
  expect(config.services.postgres.environment.POSTGRES_PASSWORD === p.settings.POSTGRES_PASSWORD).toBe(true);
});

test("make up starts a healthy, unpublished database", ({ project: p }) => {
  p.make("up");
  originalId = postgresId(p);
  const postgres = p.inspect(originalId);
  expect(postgres.State.Health.Status).toBe("healthy");
  expect(postgres.HostConfig.PortBindings || {}).toEqual({});
});

test("Pi can write and read through psql", ({ project: p }) => {
  expect(sql(p, "SELECT current_user, current_database()")).toBe("postgres|appdb");
  sql(p, "CREATE TABLE acceptance_note (body text); INSERT INTO acceptance_note VALUES ('synthetic-persisted-note');");
  expect(sql(p, "SELECT body FROM acceptance_note")).toBe("synthetic-persisted-note");
});

test("replacing Pi leaves the database alone", ({ project: p }) => {
  p.make("replace");
  expect(postgresId(p)).toBe(originalId);
});

test("database recreation retains the write from Pi", ({ project: p }) => {
  p.compose([
    "up", "-d", "--no-build", "--pull", "never", "--no-deps",
    "--force-recreate", "--wait", "--wait-timeout", "60", "postgres",
  ]);
  expect(postgresId(p)).not.toBe(originalId);
  expect(sql(p, "SELECT body FROM acceptance_note")).toBe("synthetic-persisted-note");
});
