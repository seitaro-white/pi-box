// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { runIntegration } from "./integration.mjs";

for (const overrides of [false, true]) {
  test(`integration dispatch (${overrides ? "custom" : "default"} images)`, () => {
    /** @type {{executable: string, args: string[], options?: import("./helpers/engine.mjs").CommandOptions}[]} */
    const calls = [];
    const env = {
      PI_BOX_ENGINE: "podman",
      ...(overrides
        ? {
            PI_BOX_RECOMMENDED_IMAGE: "custom:recommended",
            PI_BOX_BASE_IMAGE: "custom:base",
          }
        : {}),
    };
    runIntegration(env, (executable, args, options) => {
      calls.push({ executable, args, options });
      return "";
    });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].executable, "npm");
    assert.deepEqual(calls[0].args, ["test"]);
    for (const { index, profile, image } of [
      {
        index: 1,
        profile: "recommended",
        image: overrides ? "custom:recommended" : "pi-box:0.2.0",
      },
      {
        index: 2,
        profile: "base",
        image: overrides ? "custom:base" : "pi-box:0.2.0-base",
      },
    ]) {
      const call = calls[index];
      assert.equal(call.executable, process.execPath);
      assert.deepEqual(call.args, ["tests/smoke.mjs"]);
      assert.equal(call.options?.env?.PI_BOX_PROFILE, profile);
      assert.equal(call.options?.env?.PI_BOX_IMAGE, image);
      assert.equal(call.options?.env?.PI_BOX_ENGINE, "podman");
    }
  });
}

test("integration stops at the first failing command", () => {
  for (const failureIndex of [0, 1, 2]) {
    let count = 0;
    assert.throws(
      () =>
        runIntegration({}, () => {
          if (count++ === failureIndex) throw new Error("synthetic failure");
          return "";
        }),
      /synthetic failure/,
    );
    assert.equal(count, failureIndex + 1);
  }
});
