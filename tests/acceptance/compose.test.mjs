// The core user workflow owns storage persistence and replacement acceptance.
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { incrementalSteps, waitFor } from "../support/acceptance.mjs";
import { composeTest } from "../support/compose-project.mjs";

const test = composeTest({ name: "compose" });
incrementalSteps();

const inspect = (p) => p.inspect(p.project);
const exec = (p, args) => p.compose(["exec", "-T", "pi-box", ...args]);
const inContainer = (p, file) => p.compose(["exec", "-T", "pi-box", "node", "--input-type=module"], {
  input: readFileSync(new URL(`../in-container/${file}`, import.meta.url), "utf8"),
  inherit: true,
});
/** The container is private, healthy and still has the seeded storage. */
const expectPrivateState = (p) => {
  const state = inspect(p);
  expect(state.State.Health.Status).toBe("healthy");
  expect(state.Config.User).toBe("node");
  expect(state.HostConfig.CapDrop).toContain("ALL");
  expect(state.HostConfig.SecurityOpt).toContain("no-new-privileges:true");
  expect(Object.keys(state.HostConfig.PortBindings)).toEqual(["5173/tcp"]);
  expect(state.HostConfig.PortBindings["5173/tcp"]).toHaveLength(1);
  expect(state.HostConfig.PortBindings["5173/tcp"][0].HostIp).toBe("127.0.0.1");
  expect(state.Mounts).toHaveLength(4);
  inContainer(p, "check-persistence.mjs");
};
/** `make <target>` fails with `pattern` and leaves the container untouched. */
const expectRefusal = (p, target, pattern) => {
  const before = inspect(p).Id;
  expect(() => p.make(target)).toThrow(pattern);
  expect(inspect(p).Id, "refusal must leave the existing container intact").toBe(before);
};
let initialId;

test("make up starts a private, healthy container with seeded storage", ({ project: p }) => {
  p.make("up");
  inContainer(p, "seed-storage.mjs");
  expectPrivateState(p);
});

test("the dev port serves host HTTP on loopback only", async ({ project: p }) => {
  // A one-request server verifies real host-to-container HTTP, without app dependencies.
  p.compose(["exec", "-T", "-d", "pi-box", "node", "-e", `
    const server = require('node:http').createServer((req, res) => {
      res.end('pi-box-dev-port', () => server.close());
    });
    server.listen(5173, '0.0.0.0');
    setTimeout(() => process.exit(1), 30000).unref();
  `]);
  const bindings = inspect(p).NetworkSettings.Ports["5173/tcp"];
  expect(bindings).toHaveLength(1);
  expect(bindings[0].HostIp).toBe("127.0.0.1");
  const response = await waitFor(
    () => fetch(`http://127.0.0.1:${bindings[0].HostPort}`, { signal: AbortSignal.timeout(1000) }),
    { intervalMs: 100, message: "Dev server did not respond" },
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("pi-box-dev-port");
});

test("an unchanged make up keeps the running container", ({ project: p }) => {
  initialId = inspect(p).Id;
  p.make("up");
  expect(inspect(p).Id, "unchanged up must not replace sessions").toBe(initialId);
});

test("make replace recreates the container and keeps storage", ({ project: p }) => {
  p.make("replace");
  expect(inspect(p).Id).not.toBe(initialId);
  expectPrivateState(p);
});

test.for(["up", "replace"])("make %s refuses while non-persistent Git config exists", (target, { project: p }) => {
  exec(p, ["sh", "-c", "printf SYNTHETIC > /home/node/.gitconfig"]);
  try {
    expectRefusal(p, target, /non-persistent/);
  } finally {
    exec(p, ["rm", "/home/node/.gitconfig"]);
  }
});

test("make replace refuses a stopped container", ({ project: p }) => {
  p.compose(["stop", "pi-box"]);
  expectRefusal(p, "replace", /Start .* first/);
  p.compose(["start", "--wait", "--wait-timeout", "60", "pi-box"]);
  expectPrivateState(p);
});

test("storage survives compose down and make up", ({ project: p }) => {
  p.compose(["down"]); // No -v: the replacement must reuse the seeded storage.
  p.make("up");
  expectPrivateState(p);
});
