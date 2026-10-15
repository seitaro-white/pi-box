// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { runSmoke } from "./smoke.mjs";

/**
 * A recording engine exercises orchestration without Docker, live volumes or credentials.
 * @param {{failAt?: string, ready?: boolean, collision?: boolean, rootless?: boolean, address?: string, kind?: "docker" | "podman"}} [settings] Failure scenarios.
 */
function recordingEngine(settings = {}) {
  /** @type {{args: string[], options?: import("./helpers/engine.mjs").CommandOptions}[]} */
  const calls = [];
  /** @type {import("./helpers/engine.mjs").Engine} */
  const engine = {
    kind: settings.kind ?? "docker",
    run(args, options) {
      calls.push({ args, options });
      if (args[0] === settings.failAt)
        throw new Error("synthetic engine failure");
      if (args[0] === "info")
        return settings.rootless === false ? "false" : "true";
      if (args[0] === "port") return settings.address ?? "127.0.0.1:12345";
      if (args[0] === "volume" && args[1] === "ls" && settings.collision) {
        const created = calls.find((call) => call.args[1] === "create");
        // Refuse reuse of the second volume after creating the first.
        return created?.args.at(-1)?.replace(/-workspace$/, "-agent") ?? "";
      }
      return "";
    },
    succeeds(args) {
      calls.push({ args });
      return settings.ready !== false;
    },
  };
  return { engine, calls };
}

for (const profile of ["base", "recommended"]) {
  test(`smoke orchestration: ${profile}`, async (t) => {
    t.mock.method(console, "log", () => {});
    const { engine, calls } = recordingEngine();
    /** @type {string[]} */
    const addresses = [];
    await runSmoke({
      env: { PI_BOX_PROFILE: profile, PI_BOX_IMAGE: "synthetic:image" },
      engine,
      checkHttp: (address) => {
        addresses.push(address);
      },
    });
    const launches = calls.filter(({ args }) => args[0] === "run");
    const storage = launches.filter(({ args }) =>
      args.includes("--network=none"),
    );
    assert.equal(storage.length, 2, "initial launch and replacement");
    assert.deepEqual(
      storage[0].args,
      storage[1].args,
      "reuse only this run's mounts",
    );
    for (const { args } of launches) {
      assert.ok(args.includes("--cap-drop=ALL"));
      assert.ok(args.includes("--security-opt=no-new-privileges"));
      assert.equal(args.at(-1), "synthetic:image");
    }
    assert.equal(storage[0].args.filter((arg) => arg === "-v").length, 3);
    const name = storage[0].args[storage[0].args.indexOf("--name") + 1];
    assert.match(name, /^pi-box-smoke-/);
    assert.ok(
      calls.some(({ args }) => args[0] === "stop" && args.at(-1) === name),
    );
    assert.ok(
      calls.some(({ args }) => args[0] === "start" && args.at(-1) === name),
    );
    for (const transition of ["restart", "replacement"]) {
      assert.ok(
        calls.some(
          ({ args, options }) =>
            args.includes(`STORAGE_TRANSITION=${transition}`) &&
            options?.input?.includes("STORAGE_TRANSITION"),
        ),
      );
    }
    assert.ok(
      calls.some(
        ({ args, options }) =>
          args.includes("sh") &&
          args.includes(`EXPECTED_PROFILE=${profile}`) &&
          options?.input,
      ),
    );
    assert.ok(
      calls.some(
        ({ args, options }) =>
          args.includes("PI_OFFLINE=1") &&
          args.some((arg) => arg.startsWith("EXPECTED_DEPENDENCIES_JSON=")) &&
          options?.input,
      ),
    );
    assert.deepEqual(
      addresses,
      profile === "recommended" ? ["127.0.0.1:12345"] : [],
    );
    const web = launches.find(({ args }) => args.includes("--publish"));
    if (profile === "recommended") {
      assert.ok(web);
      assert.ok(web.args.includes("127.0.0.1::19432"));
      assert.ok(
        !web.args.includes("-v"),
        "HTTP container has no persistent mounts",
      );
    } else {
      assert.equal(web, undefined);
    }
    const cleanup = calls.at(-1)?.args;
    assert.deepEqual(cleanup, [
      "volume",
      "rm",
      `${name}-workspace`,
      `${name}-agent`,
      `${name}-git`,
    ]);
  });
}

for (const scenario of [
  "command failure",
  "startup timeout",
  "volume collision",
  "rootful Podman",
  "unsafe port",
  "HTTP failure",
]) {
  test(`smoke retains resources on ${scenario}`, async (t) => {
    t.mock.method(console, "log", () => {});
    const errors = t.mock.method(console, "error", () => {});
    const { engine, calls } = recordingEngine({
      failAt: scenario === "command failure" ? "exec" : undefined,
      ready: scenario !== "startup timeout",
      collision: scenario === "volume collision",
      kind: scenario === "rootful Podman" ? "podman" : "docker",
      rootless: scenario !== "rootful Podman",
      address: scenario === "unsafe port" ? "0.0.0.0:12345" : undefined,
    });
    await assert.rejects(
      runSmoke({
        env: {},
        engine,
        sleep: async () => {},
        checkHttp: () => {
          if (scenario === "HTTP failure")
            throw new Error("synthetic HTTP failure");
        },
      }),
    );
    assert.ok(
      !calls.some(({ args }) => args[0] === "volume" && args[1] === "rm"),
    );
    assert.equal(errors.mock.callCount(), 1);
    assert.match(
      String(errors.mock.calls[0].arguments[0]),
      /FAILED: inspect retained resources pi-box-smoke-/,
    );
    const removals = calls.filter(({ args }) => args[0] === "rm");
    // Only the deliberate replacement may remove a container before later failure.
    assert.equal(
      removals.length,
      ["unsafe port", "HTTP failure"].includes(scenario) ? 1 : 0,
    );
    if (scenario === "startup timeout") {
      assert.equal(
        calls.filter(({ args }) => args.includes("has-session")).length,
        30,
      );
      assert.ok(calls.some(({ args }) => args[0] === "logs"));
    }
    if (["volume collision", "rootful Podman"].includes(scenario)) {
      assert.ok(!calls.some(({ args }) => args[0] === "run"));
    }
  });
}

test("invalid profile is rejected before engine access", async () => {
  const { engine, calls } = recordingEngine();
  await assert.rejects(
    runSmoke({ env: { PI_BOX_PROFILE: "invalid" }, engine }),
    /PI_BOX_PROFILE/,
  );
  assert.equal(calls.length, 0);
});
