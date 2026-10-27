// SQL from Pi using disposable configured credentials; no published DB port.
import assert from "node:assert/strict";
import { composeSuite } from "./helpers/compose-project.mjs";

composeSuite("PostgreSQL sidecar", {
  name: "postgres",
  overlays: ["compose.postgres.yaml"],
}, (p, step) => {
  const postgresId = () => p.compose(["ps", "--all", "--quiet", "postgres"]);
  const sql = (query) => p.compose([
    "exec", "-T", "pi-box", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-Atc", query,
  ]);
  let originalId;

  step("configuration shares the password and publishes no database port", () => {
    const config = p.config();
    assert.equal(config.services.postgres.ports, undefined);
    // Avoid credential-bearing assertion output, even for this synthetic password.
    assert.ok(config.services["pi-box"].environment.PGPASSWORD === p.settings.POSTGRES_PASSWORD);
    assert.ok(config.services.postgres.environment.POSTGRES_PASSWORD === p.settings.POSTGRES_PASSWORD);
  });

  step("make up starts a healthy, unpublished database", () => {
    p.make("up");
    originalId = postgresId();
    assert.equal(p.inspect(originalId).State.Health.Status, "healthy");
    assert.deepEqual(p.inspect(originalId).HostConfig.PortBindings || {}, {});
  });

  step("Pi can write and read through psql", () => {
    assert.equal(sql("SELECT current_user, current_database()"), "postgres|appdb");
    sql("CREATE TABLE acceptance_note (body text); INSERT INTO acceptance_note VALUES ('synthetic-persisted-note');");
    assert.equal(sql("SELECT body FROM acceptance_note"), "synthetic-persisted-note");
  });

  step("replacing Pi leaves the database alone", () => {
    p.make("replace");
    assert.equal(postgresId(), originalId);
  });

  step("database recreation retains the write from Pi", () => {
    p.compose([
      "up", "-d", "--no-build", "--pull", "never", "--no-deps",
      "--force-recreate", "--wait", "--wait-timeout", "60", "postgres",
    ]);
    assert.notEqual(postgresId(), originalId);
    assert.equal(sql("SELECT body FROM acceptance_note"), "synthetic-persisted-note");
  });
});
