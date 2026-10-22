// SQL from Pi using disposable configured credentials; no published DB port.
import assert from "node:assert/strict";
import { withComposeProject } from "./helpers/compose-project.mjs";

await withComposeProject({
  name: "postgres",
  overlays: ["compose.postgres.yaml"],
}, async (p) => {
  const config = p.config();
  assert.equal(config.services.postgres.ports, undefined);
  // Avoid credential-bearing assertion output, even for this synthetic password.
  assert.ok(config.services["pi-box"].environment.PGPASSWORD === p.settings.POSTGRES_PASSWORD);
  assert.ok(config.services.postgres.environment.POSTGRES_PASSWORD === p.settings.POSTGRES_PASSWORD);
  p.make("up");
  const postgresId = () => p.compose(["ps", "--all", "--quiet", "postgres"]);
  const originalId = postgresId();
  assert.equal(p.inspect(originalId).State.Health.Status, "healthy");
  assert.deepEqual(p.inspect(originalId).HostConfig.PortBindings || {}, {});
  const sql = (query) => p.compose([
    "exec", "-T", "pi-box", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-Atc", query,
  ]);
  assert.equal(sql("SELECT current_user, current_database()"), "postgres|appdb");
  sql("CREATE TABLE acceptance_note (body text); INSERT INTO acceptance_note VALUES ('synthetic-persisted-note');");
  assert.equal(sql("SELECT body FROM acceptance_note"), "synthetic-persisted-note");

  p.make("replace");
  assert.equal(postgresId(), originalId, "replacing Pi leaves the database alone");
  p.compose([
    "up", "-d", "--no-build", "--pull", "never", "--no-deps",
    "--force-recreate", "--wait", "--wait-timeout", "60", "postgres",
  ]);
  assert.notEqual(postgresId(), originalId);
  assert.equal(sql("SELECT body FROM acceptance_note"), "synthetic-persisted-note",
    "database recreation retains the write from Pi");
  console.log("PASS: Pi PostgreSQL connectivity, private networking and recreation persistence.");
});
