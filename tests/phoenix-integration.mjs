// Explicit opt-in only: pulls pinned Phoenix, installs pi-otel in disposable
// agent storage, and runs synthetic Pi workflows. No real models/credentials.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runCommand } from "./helpers/engine.mjs";

const project = `pi-box-phoenix-${randomUUID()}`;
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), project));
for (const path of [
  "Makefile",
  "compose.yaml",
  "compose.phoenix.yaml",
  "compose.postgres.yaml",
  "scripts",
]) {
  cpSync(join(root, path), join(directory, path), { recursive: true });
}
cpSync(join(root, "tests/fixtures/phoenix"), join(directory, "fixture"), {
  recursive: true,
});
const settings = {
  COMPOSE_FILE: "compose.yaml:compose.phoenix.yaml",
  COMPOSE_PROJECT_NAME: project,
  CONTAINER: project,
  IMAGE:
    process.env.PI_BOX_IMAGE ||
    process.env.PI_BOX_RECOMMENDED_IMAGE ||
    "pi-box:0.2.0",
  WORKSPACE_VOLUME: `${project}-workspace`,
  AGENT_VOLUME: `${project}-agent`,
  GIT_VOLUME: `${project}-git`,
  PHOENIX_UI_PORT: "0", // Docker allocates an unused loopback port.
  POSTGRES_PASSWORD: "synthetic-config-only-not-used-for-login",
};
writeFileSync(
  join(directory, ".env"),
  Object.entries(settings)
    .map(([k, v]) => `${k}=${v}\n`)
    .join(""),
  { mode: 0o600 },
);
const env = { ...process.env };
for (const key of [
  ...Object.keys(settings),
  "COMPOSE_ENV_FILES",
  "COMPOSE_DISABLE_ENV_FILE",
  "COMPOSE_PROFILES",
  "COMPOSE_PATH_SEPARATOR",
  "TARGET",
])
  delete env[key];
const options = { cwd: directory, env, timeout: 300_000 };
const docker = (args) => runCommand("docker", args, options);
const compose = (args) => docker(["compose", ...args]);
const config = (files) =>
  JSON.parse(
    compose([
      ...files.flatMap((file) => ["-f", file]),
      "config",
      "--format",
      "json",
    ]),
  );
const inspect = (id) => JSON.parse(docker(["inspect", id]))[0];
const phoenixId = () => compose(["ps", "--all", "-q", "phoenix"]);
let origin;
async function spans() {
  const response = await fetch(
    `${origin}/v1/projects/default/spans?limit=100`,
    { signal: AbortSignal.timeout(3000) },
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.next_cursor, null, "all synthetic spans fit in one page");
  return result.data;
}
async function waitForSpans(count) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const stored = await spans();
    if (stored.length === count) return stored;
    await delay(1000);
  }
  assert.fail(`expected ${count} stored spans`);
}
function workflow(disabled = false) {
  const start = performance.now();
  const result = compose([
    "exec",
    "-T",
    "pi-box",
    "env",
    "PI_OFFLINE=1",
    ...(disabled ? ["PI_OTEL_DISABLED=1"] : []),
    "pi",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-mcp",
    "--no-approve",
    "-e",
    "/home/node/.pi/agent/npm/node_modules/pi-otel/dist/index.js",
    "-e",
    "/fixture/provider.mjs",
    "--model",
    "phoenix-fixture/fixture-model",
    "--tools",
    "read",
    "--mode",
    "json",
    "SYNTHETIC_PROMPT: inspect fixture",
    "SYNTHETIC_FOLLOWUP: confirm complete",
  ]);
  const events = result.split("\n").map((line) => JSON.parse(line));
  assert.equal(events.filter((e) => e.type === "agent_end").length, 2);
  assert.equal(
    events.filter((e) => e.type === "tool_execution_end" && e.isError).length,
    1,
  );
  assert.ok(
    events.some(
      (e) =>
        e.type === "message_end" &&
        e.message.role === "assistant" &&
        e.message.content.some((c) => c.text?.includes("SYNTHETIC_RESPONSE")),
    ),
  );
  return performance.now() - start;
}
function verifySpans(stored) {
  assert.equal(
    stored.length,
    10,
    "normal CLI exit flushes the complete workflow",
  );
  const agents = stored.filter((s) => s.span_kind === "AGENT");
  const llms = stored.filter((s) => s.span_kind === "LLM");
  const tools = stored.filter((s) => s.span_kind === "TOOL");
  assert.equal(agents.length, 2);
  assert.equal(llms.length, 3);
  assert.equal(tools.length, 2);
  const byId = new Map(stored.map((s) => [s.context.span_id, s]));
  for (const span of [...llms, ...tools]) {
    const turn = byId.get(span.parent_id);
    assert.equal(turn.name, "pi.turn");
    assert.equal(byId.get(turn.parent_id).span_kind, "AGENT");
    assert.equal(turn.context.trace_id, span.context.trace_id);
    assert.equal(
      byId.get(turn.parent_id).context.trace_id,
      span.context.trace_id,
    );
  }
  for (const llm of llms) {
    const a = llm.attributes;
    assert.equal(a["llm.model_name"], "fixture-model");
    assert.equal(a["llm.system"], "phoenix-fixture");
    assert.equal(a["llm.token_count.prompt"], 17);
    assert.equal(a["llm.token_count.completion"], 5);
    assert.equal(a["llm.token_count.total"], 22);
    assert.equal(a["pi.cost.usd"], 0.000027);
  }
  assert.ok(
    llms.some(
      (s) =>
        s.attributes["llm.input_messages.0.message.content"] ===
        "SYNTHETIC_PROMPT: inspect fixture",
    ),
  );
  assert.ok(
    llms.some(
      (s) =>
        s.attributes["llm.output_messages.0.message.content"] ===
        "SYNTHETIC_RESPONSE: fixture complete",
    ),
  );
  assert.ok(
    llms.some(
      (s) =>
        s.attributes[
          "llm.output_messages.0.message.tool_calls.0.tool_call.function.name"
        ] === "read",
    ),
  );
  const successful = tools.find((s) => s.status_code !== "ERROR");
  const failed = tools.find((s) => s.status_code === "ERROR");
  assert.equal(successful.attributes["tool.name"], "read");
  assert.equal(
    successful.attributes["tool.parameters.path"],
    "/fixture/marker.txt",
  );
  assert.match(successful.attributes["output.value"], /SYNTHETIC_TOOL_RESULT/);
  assert.equal(
    failed.attributes["tool.parameters.path"],
    "/fixture/does-not-exist.txt",
  );
  assert.match(failed.attributes["output.value"], /ENOENT/);
  const sessions = new Set(stored.map((s) => s.attributes["session.id"]));
  assert.equal(sessions.size, 1);
  assert.ok([...sessions][0]);
}

try {
  const base = config(["compose.yaml"]);
  assert.deepEqual(Object.keys(base.services), ["pi-box"]);
  assert.deepEqual(Object.keys(base.volumes).sort(), [
    "agent",
    "git",
    "workspace",
  ]);
  const selected = config(["compose.yaml", "compose.phoenix.yaml"]);
  assert.deepEqual(
    selected.services["pi-box"],
    base.services["pi-box"],
    "overlay does not alter Pi",
  );
  assert.deepEqual(Object.keys(selected.services).sort(), [
    "phoenix",
    "pi-box",
  ]);
  const phoenix = selected.services.phoenix;
  assert.deepEqual(Object.keys(phoenix.environment), ["PHOENIX_WORKING_DIR"]);
  assert.equal(phoenix.ports.length, 1);
  assert.equal(phoenix.ports[0].host_ip, "127.0.0.1");
  assert.equal(phoenix.ports[0].target, 6006);
  assert.equal(phoenix.volumes.length, 1);
  assert.equal(selected.volumes.phoenix.name, `${project}_phoenix`);
  const combined = config([
    "compose.yaml",
    "compose.postgres.yaml",
    "compose.phoenix.yaml",
  ]);
  assert.deepEqual(Object.keys(combined.services).sort(), [
    "phoenix",
    "pi-box",
    "postgres",
  ]);
  assert.equal(combined.services["pi-box"].depends_on.phoenix, undefined);

  // Use the normal preflight/start path, with a prebuilt Pi image.
  runCommand("make", ["-o", "build", "up"], options);
  const originalId = phoenixId();
  assert.equal(inspect(originalId).State.Health.Status, "healthy");
  const bindings = inspect(originalId).HostConfig.PortBindings;
  assert.deepEqual(Object.keys(bindings), ["6006/tcp"]);
  assert.equal(bindings["6006/tcp"][0].HostIp, "127.0.0.1");
  origin = `http://${compose(["port", "phoenix", "6006"])}`;
  const expectedPi = JSON.parse(
    readFileSync(join(root, "container/package.json"), "utf8"),
  ).dependencies["@earendil-works/pi-coding-agent"];
  assert.equal(
    compose(["exec", "-T", "pi-box", "pi", "--version"]),
    expectedPi,
  );
  // Copy fixtures into disposable container-local storage; do not add bind mounts.
  compose(["cp", join(directory, "fixture"), "pi-box:/fixture"]);
  // Merge only this opt-in key; preserve all seeded package registrations.
  compose([
    "exec",
    "-T",
    "pi-box",
    "node",
    "--input-type=module",
    "-e",
    `
    import {readFileSync,writeFileSync} from 'node:fs';
    const path='/home/node/.pi/agent/settings.json';
    const settings=JSON.parse(readFileSync(path,'utf8'));
    settings.otel=JSON.parse(readFileSync('/fixture/settings.json','utf8')).otel;
    writeFileSync(path,JSON.stringify(settings,null,2)+'\\n');
  `,
  ]);
  compose(["exec", "-T", "pi-box", "pi", "install", "npm:pi-otel@0.3.0"]);
  assert.equal(
    compose([
      "exec",
      "-T",
      "pi-box",
      "node",
      "-p",
      "require('/home/node/.pi/agent/npm/node_modules/pi-otel/package.json').version",
    ]),
    "0.3.0",
  );
  const enabledMs = workflow();
  const stored = await waitForSpans(10);
  verifySpans(stored);
  writeFileSync(
    join(directory, "verified-spans.json"),
    JSON.stringify(stored, null, 2),
  );

  const disabledMs = workflow(true);
  await delay(3000);
  assert.equal((await spans()).length, 10, "explicit disable exports no spans");
  compose([
    "up",
    "-d",
    "--no-build",
    "--no-deps",
    "--force-recreate",
    "--wait",
    "--wait-timeout",
    "60",
    "phoenix",
  ]);
  assert.notEqual(phoenixId(), originalId);
  origin = `http://${compose(["port", "phoenix", "6006"])}`;
  const persisted = await waitForSpans(10);
  assert.deepEqual(
    persisted.map((s) => s.context.span_id).sort(),
    stored.map((s) => s.context.span_id).sort(),
    "SQLite survives recreation",
  );
  compose(["stop", "phoenix"]);
  const unavailableMs = workflow();
  assert.ok(
    unavailableMs < disabledMs + 3000,
    `unavailable backend adds less than 3s (${unavailableMs.toFixed(0)}ms vs disabled ${disabledMs.toFixed(0)}ms)`,
  );
  compose(["start", "--wait", "--wait-timeout", "60", "phoenix"]);
  origin = `http://${compose(["port", "phoenix", "6006"])}`;
  await delay(3000);
  assert.equal(
    (await spans()).length,
    10,
    "unreachable-at-start session does not replay traces",
  );
  console.log(
    `PASS: Pi ${expectedPi}, pi-otel 0.3.0, Phoenix 20.23.0; native kinds/content/hierarchy/tokens/session, flush, disable, SQLite recreation, unavailable startup. Durations: enabled=${enabledMs.toFixed(0)}ms disabled=${disabledMs.toFixed(0)}ms unavailable=${unavailableMs.toFixed(0)}ms.`,
  );
  compose(["down"]);
  docker([
    "volume",
    "rm",
    settings.WORKSPACE_VOLUME,
    settings.AGENT_VOLUME,
    settings.GIT_VOLUME,
    selected.volumes.phoenix.name,
  ]);
  rmSync(directory, { recursive: true, force: true });
} catch (error) {
  console.error(
    `FAILED: retained isolated project ${project} and test directory ${directory}. No live resources were used. Inspect/clean only this project's resources.`,
  );
  throw error;
}
