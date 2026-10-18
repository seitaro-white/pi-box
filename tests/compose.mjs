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
  COMPOSE_FILE: fileURLToPath(new URL("../compose.yaml", import.meta.url)),
  COMPOSE_PROJECT_NAME: name,
  CONTAINER: name,
  IMAGE: process.env.PI_BOX_RECOMMENDED_IMAGE || "pi-box:0.2.0",
  TARGET: "recommended",
  WORKSPACE_VOLUME: `${name}-workspace`,
  AGENT_VOLUME: `${name}-agent`,
  GIT_VOLUME: `${name}-git`,
};
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

  // A genuine old docker-run container with the same volume names. Compose must
  // refuse implicit takeover, then preserve data during the explicit handover.
  compose(["down"]); // Deliberately no -v: retain our canaries.
  docker([
    "run",
    "-d",
    "--name",
    name,
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "-v",
    `${env.WORKSPACE_VOLUME}:/workspace`,
    "-v",
    `${env.AGENT_VOLUME}:/home/node/.pi/agent`,
    "-v",
    `${env.GIT_VOLUME}:/home/node/.config/git`,
    env.IMAGE,
  ]);
  // Legacy images have no Compose healthcheck; wait for their normal startup.
  for (let attempt = 0; ; attempt++) {
    const ready = spawnSync(
      "docker",
      ["exec", name, "tmux", "has-session", "-t", "=shell"],
      options,
    );
    if (ready.status === 0) break;
    if (attempt === 29) throw new Error("legacy startup timed out");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  refuse("up", /make migrate/);
  exec(["sh", "-c", "mkdir /home/node/.ssh"]);
  refuse("migrate", /non-persistent/);
  exec(["rmdir", "/home/node/.ssh"]);
  make("migrate");
  assert.equal(inspect().Config.Labels["com.docker.compose.project"], name);
  assertState();

  // Re-run the handover with genuinely pre-Compose, unlabelled volumes too.
  // Keep the original canaries and use a second isolated set for this case.
  compose(["down"]);
  for (const key of ["WORKSPACE_VOLUME", "AGENT_VOLUME", "GIT_VOLUME"])
    env[key] += "-legacy";
  for (const volume of [
    env.WORKSPACE_VOLUME,
    env.AGENT_VOLUME,
    env.GIT_VOLUME,
  ]) {
    docker(["volume", "create", volume]);
  }
  docker([
    "run",
    "-d",
    "--name",
    name,
    "-v",
    `${env.WORKSPACE_VOLUME}:/workspace`,
    "-v",
    `${env.AGENT_VOLUME}:/home/node/.pi/agent`,
    "-v",
    `${env.GIT_VOLUME}:/home/node/.config/git`,
    env.IMAGE,
  ]);
  // init may briefly be running; the migration check requires only a running
  // container and safe files, and Compose then waits for its replacement.
  exec(["sh", "-ec", "printf legacy > /workspace/legacy-canary"]);
  make("migrate");
  assert.equal(exec(["cat", "/workspace/legacy-canary"]), "legacy");
  compose(["down"]);
  docker([
    "volume",
    "rm",
    ...volumes,
    env.WORKSPACE_VOLUME,
    env.AGENT_VOLUME,
    env.GIT_VOLUME,
  ]);
  console.log(
    "PASS: Compose fresh/idempotent startup, replacement, refusal guards and legacy migration with persistent storage.",
  );
} catch (error) {
  console.error(
    `FAILED: retained isolated Compose project/container ${name}, volumes ${[...volumes, env.WORKSPACE_VOLUME, env.AGENT_VOLUME, env.GIT_VOLUME].join(", ")}`,
  );
  throw error;
}
