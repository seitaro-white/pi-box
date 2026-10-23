// The core user workflow owns storage persistence and replacement acceptance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withComposeProject } from "./helpers/compose-project.mjs";

await withComposeProject({ name: "compose" }, async (p) => {
  const inspect = () => p.inspect(p.project);
  const exec = (args) => p.compose(["exec", "-T", "pi-box", ...args]);
  const fixture = (file) => p.compose([
    "exec", "-T", "pi-box", "node", "--input-type=module",
  ], {
    input: readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"),
    inherit: true,
  });
  const assertState = () => {
    const state = inspect();
    assert.equal(state.State.Health.Status, "healthy");
    assert.equal(state.Config.User, "node");
    assert.ok(state.HostConfig.CapDrop.includes("ALL"));
    assert.ok(state.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
    assert.deepEqual(state.HostConfig.PortBindings || {}, {});
    assert.equal(state.Mounts.length, 4);
    fixture("check-persistence.mjs");
  };
  const refuse = (target, pattern) => {
    const before = inspect().Id;
    assert.throws(() => p.make(target), pattern);
    assert.equal(inspect().Id, before, "refusal must leave the existing container intact");
  };

  p.make("up");
  fixture("seed-storage.mjs");
  assertState();
  const initial = inspect().Id;
  p.make("up");
  assert.equal(inspect().Id, initial, "unchanged up must not replace sessions");

  p.make("replace");
  assert.notEqual(inspect().Id, initial);
  assertState();

  exec(["sh", "-c", "printf SYNTHETIC > /home/node/.gitconfig"]);
  for (const target of ["up", "replace"]) refuse(target, /non-persistent/);
  exec(["rm", "/home/node/.gitconfig"]);
  p.compose(["stop", "pi-box"]);
  refuse("replace", /Start .* first/);
  p.compose(["start", "--wait", "--wait-timeout", "60", "pi-box"]);
  assertState();

  p.compose(["down"]); // No -v: the replacement must reuse the seeded storage.
  p.make("up");
  assertState();
  console.log("PASS: Compose startup, idempotence, replacement guards and private storage across restart/recreation.");
});
