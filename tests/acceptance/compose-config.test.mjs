// Configuration-only contracts: no builds, containers or operator environment.
import { expect } from "vitest";
import { composeTest } from "../support/compose-project.mjs";

const test = composeTest({
  name: "configuration",
  settings: {
    POSTGRES_PASSWORD: "synthetic-config-only",
    BROWSER_TOKEN: "synthetic-config-only",
    PHOENIX_UI_PORT: "0",
    DEV_PORT: "", // Exercise Compose's 5173 default, not the helper's ephemeral port.
  },
});

const expectDevPort = (service, published) => {
  expect(service.ports).toHaveLength(1);
  expect(service.ports[0]).toMatchObject({ host_ip: "127.0.0.1", target: 5173, protocol: "tcp" });
  expect(String(service.ports[0].published)).toBe(published);
};
const overlayFiles = (names) => names.map((name) => `compose.${name}.yaml`);
const serviceNames = { postgres: "postgres", browserless: "browser", phoenix: "phoenix" };
// Every non-empty combination of optional overlays, e.g. ["postgres", "phoenix"].
const selections = Object.keys(serviceNames)
  .reduce((sets, name) => sets.concat(sets.map((set) => [...set, name])), [[]])
  .slice(1);

test("compose.yaml alone is Pi Box with isolated volumes and no sidecar settings", ({ project: p }) => {
  const base = p.config(["compose.yaml"]);
  expect(Object.keys(base.services)).toEqual(["pi-box"]);
  expectDevPort(base.services["pi-box"], "5173");
  expect(base.services["pi-box"].build.target).toBe("recommended");
  expect(Object.values(base.volumes).map((volume) => volume.name).sort()).toEqual(
    [p.settings.WORKSPACE_VOLUME, p.settings.AGENT_VOLUME, p.settings.GIT_VOLUME, p.settings.HERDR_VOLUME].sort(),
  );
  for (const key of ["PGPASSWORD", "BROWSER_TOKEN", "BROWSER_CDP_URL"]) {
    expect(base.services["pi-box"].environment?.[key], key).toBeUndefined();
  }
});

test.for(selections.map((selected) => ({ label: selected.join(" + "), selected })))(
  "overlays $label wire each sidecar into Pi, unpublished except Phoenix's loopback UI",
  ({ selected }, { project: p }) => {
    const config = p.config(["compose.yaml", ...overlayFiles(selected)]);
    const pi = config.services["pi-box"];
    expect(Object.keys(config.services).sort()).toEqual(
      ["pi-box", ...selected.map((name) => serviceNames[name])].sort(),
    );
    expectDevPort(pi, "5173");
    if (selected.includes("postgres")) {
      expect(pi.environment.PGHOST).toBe("postgres");
      expect(pi.environment.PGPASSWORD).toBe(config.services.postgres.environment.POSTGRES_PASSWORD);
      expect(config.services.postgres.ports).toBeUndefined();
      expect(pi.depends_on.postgres.condition).toBe("service_healthy");
    }
    if (selected.includes("browserless")) {
      expect(pi.environment.BROWSER_CDP_URL).toBe("ws://browser:3000/chromium");
      expect(pi.environment.BROWSER_TOKEN).toBe(config.services.browser.environment.TOKEN);
      expect(config.services.browser.ports).toBeUndefined();
      expect(config.services.browser.volumes).toBeUndefined();
      expect(pi.depends_on.browser.condition).toBe("service_healthy");
    }
    if (selected.includes("phoenix")) {
      const phoenix = config.services.phoenix;
      expect(phoenix.ports).toHaveLength(1);
      expect(phoenix.ports[0]).toMatchObject({ host_ip: "127.0.0.1", target: 6006 });
      expect(phoenix.environment.PHOENIX_WORKING_DIR).toBe("/mnt/data");
      expect(config.volumes.phoenix.name).toBe(`${p.project}_phoenix`);
      const others = selected.filter((name) => name !== "phoenix");
      const withoutPhoenix = p.config(["compose.yaml", ...overlayFiles(others)]);
      expect(pi, "Phoenix must not modify or enable tracing in Pi").toEqual(withoutPhoenix.services["pi-box"]);
    }
  },
);
