// The core user workflow owns storage persistence and replacement acceptance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { waitFor } from "./helpers/acceptance.mjs";
import { composeSuite } from "./helpers/compose-project.mjs";

composeSuite("Compose workflow", { name: "compose" }, (p, step) => {
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
    assert.deepEqual(Object.keys(state.HostConfig.PortBindings), ["5173/tcp"]);
    assert.equal(state.HostConfig.PortBindings["5173/tcp"].length, 1);
    assert.equal(state.HostConfig.PortBindings["5173/tcp"][0].HostIp, "127.0.0.1");
    assert.equal(state.Mounts.length, 4);
    fixture("check-persistence.mjs");
  };
  const refuse = (target, pattern) => {
    const before = inspect().Id;
    assert.throws(() => p.make(target), pattern);
    assert.equal(inspect().Id, before, "refusal must leave the existing container intact");
  };
  let initial;

  step("make up starts a private, healthy container with seeded storage", () => {
    p.make("up");
    fixture("seed-storage.mjs");
    assertState();
  });

  step("the dev port serves host HTTP on loopback only", async () => {
    // A one-request server verifies real host-to-container HTTP, without app dependencies.
    p.compose(["exec", "-T", "-d", "pi-box", "node", "-e", `
      const server = require('node:http').createServer((req, res) => {
        res.end('pi-box-dev-port', () => server.close());
      });
      server.listen(5173, '0.0.0.0');
      setTimeout(() => process.exit(1), 30000).unref();
    `]);
    const bindings = inspect().NetworkSettings.Ports["5173/tcp"];
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].HostIp, "127.0.0.1");
    const response = await waitFor(
      () => fetch(`http://127.0.0.1:${bindings[0].HostPort}`, { signal: AbortSignal.timeout(1000) }),
      { intervalMs: 100, message: "Dev server did not respond" },
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "pi-box-dev-port");
  });

  step("an unchanged make up keeps the running container", () => {
    initial = inspect().Id;
    p.make("up");
    assert.equal(inspect().Id, initial, "unchanged up must not replace sessions");
  });

  step("make replace recreates the container and keeps storage", () => {
    p.make("replace");
    assert.notEqual(inspect().Id, initial);
    assertState();
  });

  step("replacement refuses while non-persistent Git config exists", () => {
    exec(["sh", "-c", "printf SYNTHETIC > /home/node/.gitconfig"]);
    for (const target of ["up", "replace"]) refuse(target, /non-persistent/);
    exec(["rm", "/home/node/.gitconfig"]);
  });

  step("replacement refuses a stopped container", () => {
    p.compose(["stop", "pi-box"]);
    refuse("replace", /Start .* first/);
    p.compose(["start", "--wait", "--wait-timeout", "60", "pi-box"]);
    assertState();
  });

  step("storage survives compose down and make up", () => {
    p.compose(["down"]); // No -v: the replacement must reuse the seeded storage.
    p.make("up");
    assertState();
  });
});
