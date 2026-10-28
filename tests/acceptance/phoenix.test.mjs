// Opt-in pi-otel installation in disposable storage; no real model or credentials.
import { join } from "node:path";
import { expect } from "vitest";
import { incrementalSteps, waitFor } from "../support/acceptance.mjs";
import { composeTest } from "../support/compose-project.mjs";

const test = composeTest({ name: "phoenix", overlays: ["compose.phoenix.yaml"] });
incrementalSteps();

const phoenixId = (p) => p.compose(["ps", "--all", "--quiet", "phoenix"]);
/** Check the healthy, loopback-only UI binding and return its host URL. */
function origin(p) {
  const container = p.inspect(phoenixId(p));
  expect(container.State.Health.Status).toBe("healthy");
  const bindings = container.NetworkSettings.Ports;
  expect(Object.keys(bindings)).toEqual(["6006/tcp"]);
  expect(bindings["6006/tcp"]).toHaveLength(1);
  expect(bindings["6006/tcp"][0].HostIp).toBe("127.0.0.1");
  return `http://127.0.0.1:${bindings["6006/tcp"][0].HostPort}`;
}
/** Wait for the synthetic Pi span (optionally a specific trace) and return its trace ID. */
const waitForTrace = (endpoint, traceId) => waitFor(async () => {
  const response = await fetch(`${endpoint}/v1/projects/default/spans?limit=100`, {
    signal: AbortSignal.timeout(3000),
  });
  expect(response.status).toBe(200);
  const { data } = await response.json();
  return data.find((span) =>
    JSON.stringify(span).includes("SYNTHETIC_RESPONSE: fixture complete") &&
    (!traceId || span.context.trace_id === traceId))?.context.trace_id;
}, { message: "Phoenix did not retain the recognizable synthetic Pi trace" });
let originalId;
let traceId;

test("make up starts Phoenix on host loopback", ({ project: p }) => {
  expect(p.config().services.phoenix.ports[0].host_ip).toBe("127.0.0.1");
  p.make("up");
  originalId = phoenixId(p);
  origin(p);
});

test("a synthetic Pi run with pi-otel exports a trace", async ({ project: p }) => {
  // Follow the documented install/settings path, preserving seeded registrations.
  p.compose(["cp", join(p.root, "tests/in-container/phoenix"), "pi-box:/fixture"]);
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
  expect(result).toMatch(/SYNTHETIC_RESPONSE: fixture complete/);
  traceId = await waitForTrace(origin(p));
});

test("the trace survives Phoenix recreation", async ({ project: p }) => {
  p.compose([
    "up", "-d", "--no-build", "--pull", "never", "--no-deps",
    "--force-recreate", "--wait", "--wait-timeout", "60", "phoenix",
  ]);
  expect(phoenixId(p)).not.toBe(originalId);
  expect(await waitForTrace(origin(p), traceId)).toBe(traceId);
});
