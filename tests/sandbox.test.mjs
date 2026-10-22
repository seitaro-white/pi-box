import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildInputs, main, stageKit } from "../scripts/sandbox.mjs";

const image = {
  sandbox: { image: "sbx-kit-src:test", resources: { cpu: 4, memory: "4096m" } },
};
function fake(existing = true, forwarding = "false", compiled = image) {
  const calls = [];
  const run = (args, capture) => {
    calls.push(args);
    if (args[0] === "ls" && capture) return JSON.stringify(existing ? [{ name: "pi-box" }] : []);
    if (args[0] === "settings") return forwarding;
    if (args[0] === "kit" && args[1] === "inspect") return JSON.stringify(compiled);
    return "";
  };
  return { calls, run };
}

test("sandbox staging uses an explicit allowlist, never checkout/.env/auth state", () => {
  const directory = stageKit();
  try {
    assert.deepEqual(readdirSync(directory).sort(), ["pi-box.dockerfile", "pi-box.yaml", "runtime"]);
    assert.deepEqual(readdirSync(join(directory, "runtime")).sort(), ["init-agent.mjs", "package-lock.json", "package.json", "prepare-runtime.mjs"]);
    assert.equal(buildInputs.some(([source]) => /auth\.json|\.env|credentials|\.git\//.test(source)), false);
    assert.equal(existsSync(join(directory, "launch.sh")), false);
    assert.equal(existsSync(join(directory, "runtime/tmux.conf")), false);
  } finally { rmSync(dirname(directory), { recursive: true, force: true }); }
});

test("sandbox creation builds locally then uses shell identity without a workspace path", () => {
  const { calls, run } = fake(false);
  main("create", {}, run);
  const create = calls.find(([command]) => command === "create");
  assert.deepEqual(create.slice(0, 7), ["create", "--name", "pi-box", "--skills", "off", "--cpus", "4"]);
  assert.deepEqual(create.slice(7), ["--memory", "4096m", "--pull", "never", "--template", "sbx-kit-src:test", "shell"]);
  const inspection = calls.find(([command]) => command === "kit");
  assert.equal(existsSync(dirname(inspection[2])), false, "staged build files cleaned up");
  assert.equal(create.includes("--kit"), false, "no project network-policy mixin");
  assert.equal(calls.at(-1), create, "creation needs no runtime initializer");
});

test("creation refuses an existing sandbox or enabled SSH forwarding", () => {
  const existing = fake(true);
  assert.throws(() => main("create", {}, existing.run), /already exists/);
  assert.equal(existing.calls.length, 1);
  const forwarding = fake(false, "true");
  assert.throws(() => main("create", {}, forwarding.run), /Disable SSH-agent/);
  assert.equal(forwarding.calls.some(([command]) => command === "create"), false);
});

test("start and shell cannot implicitly create a missing name and mount cwd", () => {
  for (const action of ["start", "shell", "stop"]) {
    const { calls, run } = fake(false);
    assert.throws(() => main(action, {}, run), /does not exist/);
    assert.deepEqual(calls, [["ls", "--format", "json"]]);
  }
});

test("normal lifecycle never removes, rebuilds or passes host environment files", () => {
  const expected = {
    start: ["run", "--detach", "--name", "pi-box"],
    shell: ["exec", "-it", "pi-box", "bash", "-l"],
    stop: ["stop", "pi-box"],
  };
  for (const [action, args] of Object.entries(expected)) {
    const { calls, run } = fake();
    main(action, {}, run);
    assert.deepEqual(calls.at(-1), args);
    assert.equal(calls.flat().some((value) => ["rm", "reset", "prune", "--rm", "--env-file"].includes(value)), false);
  }
});

test("malformed names and build responses fail closed", () => {
  for (const name of ["default", "x", "../host", "bad name"]) {
    assert.throws(() => main("start", { SANDBOX_NAME: name }, () => assert.fail()), /Invalid/);
  }
  const { run } = fake(false, "false", {});
  assert.throws(() => main("create", {}, run), /no image or resource/);
});

test("image registers extensions at build time and leaves session management to the user", () => {
  const kit = readFileSync(new URL("../sandbox/pi-box.yaml", import.meta.url), "utf8");
  const dockerfile = readFileSync(new URL("../sandbox/pi-box.dockerfile", import.meta.url), "utf8");
  assert.equal(kit.includes("credential@"), false);
  assert.equal(kit.includes("ssh-agent@"), false);
  assert.equal(kit.includes("filesystem@"), false);
  assert.equal(kit.includes("network-policy@"), false);
  assert.match(dockerfile, /USER agent\n[\s\S]*RUN node \/opt\/pi\/init-agent\.mjs/);
  assert.match(dockerfile, /ENTRYPOINT \[\]/);
  assert.match(dockerfile, /CMD \["\/bin\/bash", "-l"\]/);
  assert.equal(dockerfile.includes("pi-box-launch"), false);
  assert.equal(dockerfile.includes("/etc/tmux.conf"), false);
  assert.equal(dockerfile.includes("umask 077"), true);
});

test("Make no longer exposes either attach target", () => {
  const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");
  assert.doesNotMatch(makefile, /\b(?:sandbox-)?attach\b/);
  assert.throws(() => main("attach", {}, () => assert.fail()), /Usage:/);
});
