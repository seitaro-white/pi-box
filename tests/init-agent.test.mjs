import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { agentState } from "./helpers/agent-state.mjs";
import { readJson, root, temporaryDirectory } from "./helpers/files.mjs";

const defaults = readJson(
  join(root, "container/defaults/settings.json"),
).packages;
const operatorPackage = {
  source: "npm:operator-package@1.0.0",
  extensions: [],
};
const policyFiles = [
  "web-search.json",
  "extensions/subagent/config.json",
  "extensions/operator-extension/config.json",
  "pi-lsp.json",
];

/** Seed personal settings, policy and synthetic secrets that startup must retain. */
function seedOperatorState(state) {
  state.writeJson("settings.json", {
    defaultModel: "operator-model",
    packages: [operatorPackage],
    subagents: { disableBuiltins: false },
  });
  state.write("auth.json", "SYNTHETIC_AUTH_CANARY");
  state.write("history-canary", "SYNTHETIC_HISTORY_CANARY");
  for (const file of policyFiles) {
    state.writeJson(file, { operator: "preserve" });
  }
}

/** Verify startup has not changed the operator-owned state seeded above. */
function assertOperatorState(state) {
  assert.equal(state.json("settings.json").defaultModel, "operator-model");
  assert.deepEqual(state.json("settings.json").subagents, {
    disableBuiltins: false,
  });
  assert.equal(state.read("auth.json"), "SYNTHETIC_AUTH_CANARY");
  assert.equal(state.read("history-canary"), "SYNTHETIC_HISTORY_CANARY");
  for (const file of policyFiles) {
    assert.deepEqual(state.json(file), { operator: "preserve" });
  }
}

describe("agent initialization", () => {
  it("uses the current home and adjacent defaults without environment overrides", (t) => {
    const home = temporaryDirectory(t, "pi-box-home-");
    const env = { ...process.env, HOME: home };
    delete env.PI_CODING_AGENT_DIR;
    delete env.PI_BOX_DEFAULTS_DIR;
    execFileSync(process.execPath, [join(root, "container/init-agent.mjs")], { env });
    const dir = join(home, ".pi", "agent");
    assert.deepEqual(readJson(join(dir, "settings.json")), { packages: defaults });
    assert.equal(statSync(join(dir, "settings.json")).mode & 0o777, 0o600);
    assert.equal(existsSync(join(dir, "auth.json")), false);
  });

  it("seeds the correct private settings for fresh base and recommended installs", (t) => {
    for (const profile of ["base", "recommended"]) {
      const state = agentState(t);
      state.run(profile);
      assert.deepEqual(state.json("settings.json"), {
        packages: profile === "base" ? [] : defaults,
      });
      for (const file of ["settings.json", "pi-box-packages.json"]) {
        assert.equal(statSync(state.path(file)).mode & 0o777, 0o600, file);
      }
      for (const file of policyFiles) {
        assert.equal(existsSync(state.path(file)), false, file);
      }
    }
  });

  it("preserves operator state and resource filters without rewriting on repeated startup", (t) => {
    const state = agentState(t);
    seedOperatorState(state);
    const filteredPackages = defaults.map((source, index) =>
      index === 0 ? { source, prompts: [] } : source,
    );
    const settings = state.json("settings.json");
    settings.packages.push(...filteredPackages);
    state.writeJson("settings.json", settings);
    state.run();
    const files = ["settings.json", "pi-box-packages.json"];
    const before = files.map((file) => ({
      content: state.read(file),
      mtime: statSync(state.path(file)).mtimeMs,
    }));

    state.run();

    assertOperatorState(state);
    assert.deepEqual(state.json("settings.json").packages, [
      operatorPackage,
      ...filteredPackages,
    ]);
    files.forEach((file, index) => {
      assert.equal(state.read(file), before[index].content, file);
      assert.equal(
        statSync(state.path(file)).mtimeMs,
        before[index].mtime,
        file,
      );
    });
  });

  it("reconciles recommended → base → recommended while preserving operator state", (t) => {
    const state = agentState(t);
    seedOperatorState(state);
    for (const profile of ["recommended", "base", "recommended"]) {
      state.run(profile);
      assertOperatorState(state);
      assert.deepEqual(state.json("settings.json").packages, [
        operatorPackage,
        ...(profile === "base" ? [] : defaults),
      ]);
    }
  });

  it("removes formerly managed packages without removing unrelated image paths", (t) => {
    const state = agentState(t);
    state.run();
    const removed = "/opt/pi/node_modules/former-extension";
    const unrelated = "/opt/pi/node_modules/operator-extension";
    const ownership = state.json("pi-box-packages.json");
    ownership.packages.push(removed);
    state.writeJson("pi-box-packages.json", ownership);
    state.writeJson("settings.json", { packages: [removed, unrelated] });

    state.run();

    assert.deepEqual(state.json("settings.json").packages, [
      unrelated,
      ...defaults,
    ]);
  });

  it("preserves unowned image paths when no ownership file exists", (t) => {
    const state = agentState(t);
    const packages = [
      { source: "/opt/pi/node_modules/operator-extension", prompts: [] },
      operatorPackage,
    ];
    state.writeJson("settings.json", { packages });

    state.run("base");

    assert.deepEqual(state.json("settings.json").packages, packages);
    assert.deepEqual(state.json("pi-box-packages.json"), {
      version: 1,
      packages: [],
    });
  });

  it("refuses broken settings or ownership without overwriting either file", (t) => {
    for (const [file, content, error] of [
      ["settings.json", "{broken", /SyntaxError/],
      [
        "pi-box-packages.json",
        JSON.stringify({ version: 2, packages: [] }),
        /Invalid Pi Box package ownership file/,
      ],
    ]) {
      const state = agentState(t);
      state.run();
      state.write(file, content);
      const files = ["settings.json", "pi-box-packages.json"];
      const before = files.map((name) => state.read(name));

      assert.throws(() => state.run(), error);

      files.forEach((name, index) => {
        assert.equal(state.read(name), before[index], name);
      });
    }
  });
});
