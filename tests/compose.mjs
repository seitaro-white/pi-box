// Real Compose acceptance against a prebuilt image. No live operator resources,
// model calls or credentials; failures retain only this test's isolated resources.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runCommand } from "./helpers/engine.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const name = `pi-box-compose-${randomUUID()}`;
const env = {
  ...process.env,
  COMPOSE_DISABLE_ENV_FILE: "1",
  COMPOSE_FILE: fileURLToPath(new URL("../compose.yaml", import.meta.url)),
  COMPOSE_PROJECT_NAME: name,
  CONTAINER: name,
  IMAGE: process.env.PI_BOX_RECOMMENDED_IMAGE || "pi-box:0.2.0",
  TARGET: "recommended",
  WORKSPACE_VOLUME: `${name}-workspace`,
  AGENT_VOLUME: `${name}-agent`,
  GIT_VOLUME: `${name}-git`,
};
// Do not load the operator's local environment files during acceptance.
delete env.COMPOSE_ENV_FILES;
const options = { cwd: root, env, timeout: 120_000 };
const docker = (args, extra = {}) =>
  runCommand("docker", args, { ...options, ...extra });
const compose = (args) => docker(["compose", ...args]);
// Skip only the build prerequisite: acceptance consumes prebuilt images, like smoke.mjs.
const make = (target) => runCommand("make", ["-o", "build", target], options);
const inspect = () => JSON.parse(docker(["container", "inspect", name]))[0];
const exec = (args) => docker(["exec", name, ...args]);
const volumes = [env.WORKSPACE_VOLUME, env.AGENT_VOLUME, env.GIT_VOLUME];

function refuse(target, pattern) {
  const before = inspect().Id;
  const result = spawnSync("make", ["-o", "build", target], {
    ...options,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
  assert.equal(
    inspect().Id,
    before,
    "refusal must leave the existing container intact",
  );
}

function assertState() {
  exec([
    "sh",
    "-ec",
    `
    test "$(cat /workspace/compose-canary)" = workspace
    test "$(cat /home/node/.pi/agent/compose-canary)" = agent
    test "$(cat /home/node/.config/git/compose-canary)" = git
  `,
  ]);
  const state = inspect();
  assert.equal(state.State.Health.Status, "healthy");
  assert.equal(state.Config.User, "node");
  assert.ok(state.HostConfig.CapDrop.includes("ALL"));
  assert.ok(state.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert.deepEqual(state.HostConfig.PortBindings || {}, {});
  assert.equal(state.Mounts.length, 3);
}

try {
  const config = JSON.parse(compose(["config", "--format", "json"]));
  assert.deepEqual(Object.keys(config.services), ["pi"]);
  assert.equal(config.services.pi.build.target, "recommended");
  assert.equal(
    config.services.pi.ports,
    undefined,
    "standard Compose publishes no ports",
  );
  assert.deepEqual(
    Object.values(config.volumes)
      .map((v) => v.name)
      .sort(),
    [...volumes].sort(),
  );

  // Fresh start, health readiness and private persistence on all three mounts.
  make("up");
  exec([
    "sh",
    "-ec",
    `
    printf workspace > /workspace/compose-canary
    printf agent > /home/node/.pi/agent/compose-canary
    printf git > /home/node/.config/git/compose-canary
  `,
  ]);
  assertState();
  const initial = inspect().Id;
  make("up");
  assert.equal(inspect().Id, initial, "unchanged up must not replace sessions");
  make("replace");
  assert.notEqual(inspect().Id, initial);
  assertState();

  for (const target of ["up", "replace"]) {
    exec(["sh", "-c", "printf SYNTHETIC > /home/node/.gitconfig"]);
    refuse(target, /non-persistent/);
    exec(["rm", "/home/node/.gitconfig"]);
  }
  compose(["stop", "pi"]);
  refuse("replace", /Start .* first/);
  compose(["start", "--wait", "--wait-timeout", "60", "pi"]);
  assertState();

  // Full teardown/recreation must retain all three volumes, not just replacement.
  compose(["down"]); // Deliberately no -v: retain our canaries.
  make("up");
  assertState();
  compose(["down"]);
  docker(["volume", "rm", ...volumes]);
  console.log(
    "PASS: Compose fresh/idempotent startup, replacement, refusal guards and persistent storage across teardown/recreation.",
  );
} catch (error) {
  console.error(
    `FAILED: retained isolated Compose project/container ${name}, volumes ${volumes.join(", ")}`,
  );
  throw error;
}
