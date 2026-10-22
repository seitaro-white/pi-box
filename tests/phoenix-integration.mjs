// Opt-in pi-otel installation in disposable storage; no real model or credentials.
import assert from "node:assert/strict";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withComposeProject } from "./helpers/compose-project.mjs";

await withComposeProject({
  name: "phoenix",
  overlays: ["compose.phoenix.yaml"],
}, async (p) => {
  assert.equal(p.config().services.phoenix.ports[0].host_ip, "127.0.0.1");
  p.make("up");
  const phoenixId = () => p.compose(["ps", "--all", "--quiet", "phoenix"]);
  const originalId = phoenixId();
  function origin() {
    const container = p.inspect(phoenixId());
    assert.equal(container.State.Health.Status, "healthy");
    const bindings = container.NetworkSettings.Ports;
    assert.deepEqual(Object.keys(bindings), ["6006/tcp"]);
    assert.equal(bindings["6006/tcp"].length, 1);
    assert.equal(bindings["6006/tcp"][0].HostIp, "127.0.0.1");
    return `http://127.0.0.1:${bindings["6006/tcp"][0].HostPort}`;
  }
  let endpoint = origin();
  async function waitForTrace(traceId) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await fetch(`${endpoint}/v1/projects/default/spans?limit=100`, {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, 200);
      const { data } = await response.json();
      const recognizable = data.find((span) =>
        JSON.stringify(span).includes("SYNTHETIC_RESPONSE: fixture complete") &&
        (!traceId || span.context.trace_id === traceId));
      if (recognizable) return recognizable.context.trace_id;
      await delay(1000);
    }
    assert.fail("Phoenix did not retain the recognizable synthetic Pi trace");
  }

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
  const traceId = await waitForTrace();
  assert.ok(traceId);
  p.compose([
    "up", "-d", "--no-build", "--pull", "never", "--no-deps",
    "--force-recreate", "--wait", "--wait-timeout", "60", "phoenix",
  ]);
  assert.notEqual(phoenixId(), originalId);
  endpoint = origin();
  assert.equal(await waitForTrace(traceId), traceId, "synthetic trace survives Phoenix recreation");
  console.log("PASS: synthetic Pi workflow exports a trace to loopback-only Phoenix and survives recreation.");
});
