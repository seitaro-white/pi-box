// Opt-in pi-otel installation in disposable storage; no real model or credentials.
import assert from "node:assert/strict";
import { join } from "node:path";
import { waitFor } from "./helpers/acceptance.mjs";
import { composeSuite } from "./helpers/compose-project.mjs";

composeSuite("Phoenix tracing", {
  name: "phoenix",
  overlays: ["compose.phoenix.yaml"],
}, (p, step) => {
  const phoenixId = () => p.compose(["ps", "--all", "--quiet", "phoenix"]);
  /** Check the loopback-only UI binding and return its host URL. */
  function origin() {
    const container = p.inspect(phoenixId());
    assert.equal(container.State.Health.Status, "healthy");
    const bindings = container.NetworkSettings.Ports;
    assert.deepEqual(Object.keys(bindings), ["6006/tcp"]);
    assert.equal(bindings["6006/tcp"].length, 1);
    assert.equal(bindings["6006/tcp"][0].HostIp, "127.0.0.1");
    return `http://127.0.0.1:${bindings["6006/tcp"][0].HostPort}`;
  }
  /** Wait for the synthetic Pi span (optionally a specific trace) and return its trace ID. */
  const waitForTrace = (endpoint, traceId) => waitFor(async () => {
    const response = await fetch(`${endpoint}/v1/projects/default/spans?limit=100`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    return data.find((span) =>
      JSON.stringify(span).includes("SYNTHETIC_RESPONSE: fixture complete") &&
      (!traceId || span.context.trace_id === traceId))?.context.trace_id;
  }, { message: "Phoenix did not retain the recognizable synthetic Pi trace" });
  let originalId;
  let traceId;

  step("make up starts Phoenix on host loopback", () => {
    assert.equal(p.config().services.phoenix.ports[0].host_ip, "127.0.0.1");
    p.make("up");
    originalId = phoenixId();
    origin();
  });

  step("a synthetic Pi run with pi-otel exports a trace", async () => {
    // Follow the documented install/settings path, preserving seeded registrations.
    p.compose(["cp", join(p.root, "tests/fixtures/phoenix"), "pi-box:/fixture"]);
    p.compose([
      "exec", "-T", "pi-box", "node", "--input-type=module", "-e", `
        import {readFileSync,writeFileSync} from 'node:fs';
        const path='/home/node/.pi/agent/settings.json';
        const settings=JSON.parse(readFileSync(path,'utf8'));
        settings.otel=JSON.parse(readFileSync('/fixture/settings.json','utf8')).otel;
        writeFileSync(path,JSON.stringify(settings,null,2)+'\\n');
      `,
    ]);
    p.compose(["exec", "-T", "pi-box", "pi", "install", "npm:pi-otel@0.3.0"]);
    const result = p.compose([
      "exec", "-T", "pi-box", "env", "PI_OFFLINE=1", "pi",
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
      "--no-mcp", "--no-approve",
      "-e", "/home/node/.pi/agent/npm/node_modules/pi-otel/dist/index.js",
      "-e", "/fixture/provider.mjs", "--model", "phoenix-fixture/fixture-model",
      "--tools", "read", "--mode", "json", "SYNTHETIC_PROMPT: inspect fixture",
    ]);
    assert.match(result, /SYNTHETIC_RESPONSE: fixture complete/);
    traceId = await waitForTrace(origin());
  });

  step("the trace survives Phoenix recreation", async () => {
    p.compose([
      "up", "-d", "--no-build", "--pull", "never", "--no-deps",
      "--force-recreate", "--wait", "--wait-timeout", "60", "phoenix",
    ]);
    assert.notEqual(phoenixId(), originalId);
    assert.equal(await waitForTrace(origin(), traceId), traceId);
  });
});
