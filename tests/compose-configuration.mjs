// Configuration-only contracts: no builds, containers or operator environment.
import assert from "node:assert/strict";
import { composeSuite } from "./helpers/compose-project.mjs";

const assertDevPort = (service, published) => {
  assert.equal(service.ports.length, 1);
  assert.equal(service.ports[0].host_ip, "127.0.0.1");
  assert.equal(service.ports[0].target, 5173);
  assert.equal(String(service.ports[0].published), published);
  assert.equal(service.ports[0].protocol, "tcp");
};
const overlayFiles = (names) => names.map((name) => `compose.${name}.yaml`);
const serviceNames = { postgres: "postgres", browserless: "browser", phoenix: "phoenix" };
// Every non-empty combination of optional overlays, e.g. ["postgres", "phoenix"].
const selections = Object.keys(serviceNames)
  .reduce((sets, name) => sets.concat(sets.map((set) => [...set, name])), [[]])
  .slice(1);

composeSuite("Compose configuration", {
  name: "configuration",
  settings: {
    POSTGRES_PASSWORD: "synthetic-config-only",
    BROWSER_TOKEN: "synthetic-config-only",
    PHOENIX_UI_PORT: "0",
    DEV_PORT: "", // Exercise Compose's 5173 default, not the helper's ephemeral port.
  },
}, (p, step) => {
  step("compose.yaml alone is Pi Box with isolated volumes and no sidecar settings", () => {
    const base = p.config(["compose.yaml"]);
    assert.deepEqual(Object.keys(base.services), ["pi-box"]);
    assertDevPort(base.services["pi-box"], "5173");
    assert.equal(base.services["pi-box"].build.target, "recommended");
    assert.deepEqual(
      Object.values(base.volumes).map((volume) => volume.name).sort(),
      [p.settings.WORKSPACE_VOLUME, p.settings.AGENT_VOLUME, p.settings.GIT_VOLUME, p.settings.HERDR_VOLUME].sort(),
    );
    for (const key of ["PGPASSWORD", "BROWSER_TOKEN", "BROWSER_CDP_URL"]) {
      assert.equal(base.services["pi-box"].environment?.[key], undefined);
    }
  });

  for (const selected of selections) {
    step(`overlays: ${selected.join(" + ")}`, () => {
      const config = p.config(["compose.yaml", ...overlayFiles(selected)]);
      const pi = config.services["pi-box"];
      assert.deepEqual(
        Object.keys(config.services).sort(),
        ["pi-box", ...selected.map((name) => serviceNames[name])].sort(),
      );
      assertDevPort(pi, "5173");
      if (selected.includes("postgres")) {
        assert.equal(pi.environment.PGHOST, "postgres");
        assert.equal(pi.environment.PGPASSWORD, config.services.postgres.environment.POSTGRES_PASSWORD);
        assert.equal(config.services.postgres.ports, undefined);
        assert.equal(pi.depends_on.postgres.condition, "service_healthy");
      }
      if (selected.includes("browserless")) {
        assert.equal(pi.environment.BROWSER_CDP_URL, "ws://browser:3000/chromium");
        assert.equal(pi.environment.BROWSER_TOKEN, config.services.browser.environment.TOKEN);
        assert.equal(config.services.browser.ports, undefined);
        assert.equal(config.services.browser.volumes, undefined);
        assert.equal(pi.depends_on.browser.condition, "service_healthy");
      }
      if (selected.includes("phoenix")) {
        const phoenix = config.services.phoenix;
        assert.equal(phoenix.ports.length, 1);
        assert.equal(phoenix.ports[0].host_ip, "127.0.0.1");
        assert.equal(phoenix.ports[0].target, 6006);
        assert.equal(phoenix.environment.PHOENIX_WORKING_DIR, "/mnt/data");
        assert.equal(config.volumes.phoenix.name, `${p.project}_phoenix`);
        const others = selected.filter((name) => name !== "phoenix");
        const withoutPhoenix = p.config(["compose.yaml", ...overlayFiles(others)]);
        assert.deepEqual(pi, withoutPhoenix.services["pi-box"], "Phoenix must not modify or enable tracing in Pi");
      }
    });
  }
});

composeSuite("Custom dev port", { name: "custom-dev-port", settings: { DEV_PORT: "15173" } }, (p, step) => {
  step("a custom host port keeps the loopback binding and container port 5173", () => {
    const port = p.config().services["pi-box"].ports;
    assert.equal(port.length, 1);
    assert.equal(port[0].host_ip, "127.0.0.1");
    assert.equal(port[0].target, 5173);
    assert.equal(String(port[0].published), "15173");
  });
});
