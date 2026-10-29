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
    const ports = Array.from({ length: 10 }, (_, index) => `${5173 + index}/tcp`);
    assert.deepEqual(Object.keys(state.HostConfig.PortBindings).sort(), ports);
    for (const port of ports) {
      assert.equal(state.HostConfig.PortBindings[port].length, 1);
      assert.equal(state.HostConfig.PortBindings[port][0].HostIp, "127.0.0.1");
    }
    exec(["ss", "-ltnp"]);
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

  step("all ten dev ports serve host HTTP on loopback concurrently", async () => {
    // One-request servers verify real host-to-container HTTP without app dependencies.
    p.compose(["exec", "-T", "-d", "pi-box", "node", "-e", `
      for (let port = 5173; port <= 5182; port++) {
        const server = require('node:http').createServer((req, res) => {
          res.end('pi-box-dev-port-' + port, () => server.close());
        });
        server.listen(port, '0.0.0.0');
      }
      setTimeout(() => process.exit(1), 30000).unref();
    `]);
    const published = inspect().NetworkSettings.Ports;
    for (let port = 5173; port <= 5182; port++) {
      const bindings = published[`${port}/tcp`];
      assert.equal(bindings.length, 1);
      assert.equal(bindings[0].HostIp, "127.0.0.1");
      const response = await waitFor(
        () => fetch(`http://127.0.0.1:${bindings[0].HostPort}`, { signal: AbortSignal.timeout(1000) }),
        { intervalMs: 100, message: `Dev server on port ${port} did not respond` },
      );
      assert.equal(response.status, 200);
      assert.equal(await response.text(), `pi-box-dev-port-${port}`);
    }
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
