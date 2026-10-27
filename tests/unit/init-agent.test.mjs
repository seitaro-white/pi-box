import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { test } from "../support/fixtures.mjs";
import { readJson, root } from "../support/files.mjs";

const defaults = readJson(join(root, "container/defaults/settings.json")).packages;
const operatorPackage = { source: "npm:operator-package@1.0.0", extensions: [] };
const policyFiles = [
  "web-search.json",
  "extensions/subagent/config.json",
  "extensions/operator-extension/config.json",
  "pi-lsp.json",
];
const mode = (path) => statSync(path).mode & 0o777;

/** Seed personal settings, policy and synthetic secrets that startup must retain. */
function seedOperatorState(state) {
  state.writeJson("settings.json", {
    defaultModel: "operator-model",
    packages: [operatorPackage],
    subagents: { disableBuiltins: false },
  });
  state.write("auth.json", "SYNTHETIC_AUTH_CANARY");
  state.write("history-canary", "SYNTHETIC_HISTORY_CANARY");
  for (const file of policyFiles) state.writeJson(file, { operator: "preserve" });
}

/** Verify startup has not changed the operator-owned state seeded above. */
function expectOperatorState(state) {
  expect(state.json("settings.json")).toMatchObject({
    defaultModel: "operator-model",
    subagents: { disableBuiltins: false },
  });
  expect(state.read("auth.json")).toBe("SYNTHETIC_AUTH_CANARY");
  expect(state.read("history-canary")).toBe("SYNTHETIC_HISTORY_CANARY");
  for (const file of policyFiles) expect(state.json(file), file).toEqual({ operator: "preserve" });
}

describe("agent initialization", () => {
  test("uses the current home and adjacent defaults without environment overrides", ({ tmpDir }) => {
    const env = { ...process.env, HOME: tmpDir };
    delete env.PI_CODING_AGENT_DIR;
    delete env.PI_BOX_DEFAULTS_DIR;
    execFileSync(process.execPath, [join(root, "container/init-agent.mjs")], { env });
    const dir = join(tmpDir, ".pi", "agent");
    expect(readJson(join(dir, "settings.json"))).toEqual({ packages: defaults });
    expect(mode(join(dir, "settings.json"))).toBe(0o600);
    expect(existsSync(join(dir, "auth.json"))).toBe(false);
  });

  test.for([
    { profile: "base", packages: [] },
    { profile: "recommended", packages: defaults },
  ])("seeds private settings for a fresh $profile install", ({ profile, packages }, { agentState }) => {
    agentState.run(profile);
    expect(agentState.json("settings.json")).toEqual({ packages });
    for (const file of ["settings.json", "pi-box-packages.json"]) {
      expect(mode(agentState.path(file)), file).toBe(0o600);
    }
    for (const file of policyFiles) expect(existsSync(agentState.path(file)), file).toBe(false);
  });

  test("preserves operator state and resource filters without rewriting on repeated startup", ({ agentState: state }) => {
    seedOperatorState(state);
    const filteredPackages = defaults.map((source, index) =>
      index === 0 ? { source, prompts: [] } : source,
    );
    const settings = state.json("settings.json");
    settings.packages.push(...filteredPackages);
    state.writeJson("settings.json", settings);
    state.run();
    const files = ["settings.json", "pi-box-packages.json"];
    const snapshot = () => files.map((file) => ({
      file, content: state.read(file), mtime: statSync(state.path(file)).mtimeMs,
    }));
    const before = snapshot();

    state.run();

    expectOperatorState(state);
    expect(state.json("settings.json").packages).toEqual([operatorPackage, ...filteredPackages]);
    expect(snapshot()).toEqual(before);
  });

  test("reconciles recommended → base → recommended while preserving operator state", ({ agentState: state }) => {
    seedOperatorState(state);
    for (const profile of ["recommended", "base", "recommended"]) {
      state.run(profile);
      expectOperatorState(state);
      expect(state.json("settings.json").packages, profile).toEqual([
        operatorPackage,
        ...(profile === "base" ? [] : defaults),
      ]);
    }
  });

  test("removes formerly managed packages without removing unrelated image paths", ({ agentState: state }) => {
    state.run();
    const removed = "/opt/pi/node_modules/former-extension";
    const unrelated = "/opt/pi/node_modules/operator-extension";
    const ownership = state.json("pi-box-packages.json");
    ownership.packages.push(removed);
    state.writeJson("pi-box-packages.json", ownership);
    state.writeJson("settings.json", { packages: [removed, unrelated] });

    state.run();

    expect(state.json("settings.json").packages).toEqual([unrelated, ...defaults]);
  });

  test("removes the retired image-owned Herdr npm reporter on upgrade", ({ agentState: state }) => {
    const retired = "/opt/pi/node_modules/@muzi3/herdr-agent-state";
    state.writeJson("pi-box-packages.json", { version: 1, packages: [retired] });
    state.writeJson("settings.json", { packages: [retired, operatorPackage] });

    state.run();

    expect(state.json("settings.json").packages).toEqual([operatorPackage, ...defaults]);
    expect(defaults).not.toContain(retired);
  });

  test("preserves unowned image paths when no ownership file exists", ({ agentState: state }) => {
    const packages = [
      { source: "/opt/pi/node_modules/operator-extension", prompts: [] },
      operatorPackage,
    ];
    state.writeJson("settings.json", { packages });

    state.run("base");

    expect(state.json("settings.json").packages).toEqual(packages);
    expect(state.json("pi-box-packages.json")).toEqual({ version: 1, packages: [] });
  });

  test.for([
    { file: "settings.json", content: "{broken", error: /SyntaxError/ },
    {
      file: "pi-box-packages.json",
      content: JSON.stringify({ version: 2, packages: [] }),
      error: /Invalid Pi Box package ownership file/,
    },
  ])("refuses a broken $file without overwriting either file", ({ file, content, error }, { agentState: state }) => {
    state.run();
    state.write(file, content);
    const files = ["settings.json", "pi-box-packages.json"];
    const before = files.map((name) => state.read(name));

    expect(() => state.run()).toThrow(error);

    expect(files.map((name) => state.read(name))).toEqual(before);
  });
});
