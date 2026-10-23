// Configuration-only contracts: no builds, containers or operator environment.
import assert from "node:assert/strict";
import { withComposeProject } from "./helpers/compose-project.mjs";

await withComposeProject({
  name: "configuration",
  settings: {
    POSTGRES_PASSWORD: "synthetic-config-only",
    BROWSER_TOKEN: "synthetic-config-only",
    PHOENIX_UI_PORT: "0",
  },
}, async (p) => {
  const base = p.config(["compose.yaml"]);
  assert.deepEqual(Object.keys(base.services), ["pi-box"]);
  assert.equal(base.services["pi-box"].ports, undefined);
  assert.equal(base.services["pi-box"].build.target, "recommended");
  assert.deepEqual(
    Object.values(base.volumes).map((volume) => volume.name).sort(),
    [p.settings.WORKSPACE_VOLUME, p.settings.AGENT_VOLUME, p.settings.GIT_VOLUME, p.settings.HERDR_VOLUME].sort(),
  );
  for (const key of ["PGPASSWORD", "BROWSER_TOKEN", "BROWSER_CDP_URL"]) {
    assert.equal(base.services["pi-box"].environment?.[key], undefined);
  }

  const overlays = ["postgres", "browserless", "phoenix"];
  for (let mask = 1; mask < 8; mask++) {
    const selected = overlays.filter((_, index) => mask & (1 << index));
    const config = p.config(["compose.yaml", ...selected.map((name) => `compose.${name}.yaml`)]);
    assert.deepEqual(Object.keys(config.services).sort(), [
      "pi-box",
      ...(mask & 1 ? ["postgres"] : []),
      ...(mask & 2 ? ["browser"] : []),
      ...(mask & 4 ? ["phoenix"] : []),
    ].sort());
    assert.equal(config.services["pi-box"].ports, undefined);
    if (mask & 1) {
      assert.equal(config.services["pi-box"].environment.PGHOST, "postgres");
      assert.equal(config.services["pi-box"].environment.PGPASSWORD, config.services.postgres.environment.POSTGRES_PASSWORD);
      assert.equal(config.services.postgres.ports, undefined);
      assert.equal(config.services["pi-box"].depends_on.postgres.condition, "service_healthy");
    }
    if (mask & 2) {
      assert.equal(config.services["pi-box"].environment.BROWSER_CDP_URL, "ws://browser:3000/chromium");
      assert.equal(config.services["pi-box"].environment.BROWSER_TOKEN, config.services.browser.environment.TOKEN);
      assert.equal(config.services.browser.ports, undefined);
      assert.equal(config.services.browser.volumes, undefined);
      assert.equal(config.services["pi-box"].depends_on.browser.condition, "service_healthy");
    }
    if (mask & 4) {
      const phoenix = config.services.phoenix;
      assert.equal(phoenix.ports.length, 1);
      assert.equal(phoenix.ports[0].host_ip, "127.0.0.1");
      assert.equal(phoenix.ports[0].target, 6006);
      assert.equal(phoenix.environment.PHOENIX_WORKING_DIR, "/mnt/data");
      assert.equal(config.volumes.phoenix.name, `${p.project}_phoenix`);
      const withoutPhoenix = p.config(["compose.yaml", ...selected.filter((name) => name !== "phoenix").map((name) => `compose.${name}.yaml`)]);
      assert.deepEqual(config.services["pi-box"], withoutPhoenix.services["pi-box"], "Phoenix must not modify or enable tracing in Pi");
    }
  }
  console.log("PASS: Pi-only defaults, isolated volumes and all eight optional-service selections.");
});
