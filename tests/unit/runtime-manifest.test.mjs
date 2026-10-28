import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PI_PACKAGE, prepareRuntime } from "../../container/prepare-runtime.mjs";
import { readJson, root } from "../support/files.mjs";

const source = readJson(join(root, "container/package.json"));
const npmTools = source.piBox.npmTools;
const extensions = Object.keys(source.dependencies).filter(
  (name) => name !== PI_PACKAGE && !npmTools.includes(name),
);

/** Check that committed manifests, registrations and locks match generated output. */
function expectCommittedRuntime(profile, expected) {
  expect(prepareRuntime(source, profile)).toEqual(expected);
  const prefix = join(root, profile === "base" ? "container/base" : "container");
  expect(readJson(join(prefix, "package.json")), "regenerate manifest").toEqual(expected.manifest);
  expect(readJson(join(prefix, "defaults/settings.json")), "regenerate defaults").toEqual(expected.settings);
  const lock = readJson(join(prefix, "package-lock.json"));
  expect(lock.packages[""].dependencies, "regenerate lockfile").toEqual(expected.manifest.dependencies);
  for (const [name, version] of Object.entries(expected.manifest.dependencies)) {
    const installed = lock.packages[`node_modules/${name}`];
    if (version.startsWith("git+")) {
      // npm canonicalizes GitHub URLs to SSH; builds rewrite transport to HTTPS.
      expect(
        installed.resolved.replace("git+ssh://git@github.com/", "git+https://github.com/"),
        name,
      ).toBe(version);
    } else {
      expect(installed.version, name).toBe(version);
    }
  }
  return lock;
}

describe("committed runtime manifests", () => {
  test("base keeps the pinned Pi runtime and overrides, without bundled extensions", () => {
    const lock = expectCommittedRuntime("base", {
      manifest: {
        ...source,
        piBox: { ...source.piBox, personalSkills: false, npmTools: [] },
        dependencies: { [PI_PACKAGE]: source.dependencies[PI_PACKAGE] },
      },
      settings: { packages: [] },
    });
    for (const name of [...extensions, ...npmTools]) {
      expect(lock.packages[`node_modules/${name}`], name).toBeUndefined();
    }
  });

  test("recommended keeps all exact pins and registers extensions but not CLI tools", () => {
    expectCommittedRuntime("recommended", {
      manifest: source,
      settings: {
        packages: [
          ...extensions.map((name) => `/opt/pi/node_modules/${name}`),
          "/opt/pi/node_modules/personal-skills",
        ],
      },
    });
  });

  // The image adds personal skills from Git; the smoke test checks the result.
  test("keeps personal skills out of the manifest and both npm locks", () => {
    expect(source.piBox.personalSkills).toBe(true);
    expect(source.dependencies["personal-skills"]).toBeUndefined();
    for (const prefix of ["container", "container/base"]) {
      const lock = readJson(join(root, prefix, "package-lock.json"));
      expect(lock.packages["node_modules/personal-skills"], prefix).toBeUndefined();
    }
  });

  test("treats Claude Code as a CLI tool rather than a Pi extension", () => {
    expect(npmTools).toContain("@anthropic-ai/claude-code");
    expect(extensions).not.toContain("@anthropic-ai/claude-code");
  });
});

describe("prepareRuntime", () => {
  const withPi = (dependencies, extra = {}) => ({
    dependencies: { [PI_PACKAGE]: "1.4.0", ...dependencies },
    ...extra,
  });

  test("accepts a full HTTPS Git commit pin", () => {
    const manifest = withPi({ skills: `git+https://github.com/example/skills.git#${"a".repeat(40)}` });
    expect(prepareRuntime(manifest, "recommended").settings).toEqual({
      packages: ["/opt/pi/node_modules/skills"],
    });
  });

  test("supports manifests without CLI tools", () => {
    expect(prepareRuntime(withPi({ extension: "1.0.0" }), "recommended").settings).toEqual({
      packages: ["/opt/pi/node_modules/extension"],
    });
  });

  test.for([
    { pin: "a version range", manifest: withPi({ [PI_PACKAGE]: "^1.2.0" }) },
    ...["main", "v1.0.0", "abc1234", ""].map((ref) => ({
      pin: `Git ref "${ref}"`,
      manifest: withPi({ skills: `git+https://github.com/example/skills.git#${ref}` }),
    })),
  ])("rejects $pin", ({ manifest }) => {
    expect(() => prepareRuntime(manifest, "recommended")).toThrow(/Use an exact version/);
  });

  test.for([
    { npmTools: "extension" },
    { npmTools: [PI_PACKAGE] },
    { npmTools: ["missing"] },
  ])("rejects piBox.npmTools = $npmTools", ({ npmTools: tools }) => {
    const manifest = withPi({ extension: "1.0.0" }, { piBox: { npmTools: tools } });
    expect(() => prepareRuntime(manifest, "recommended")).toThrow(
      /piBox.npmTools must list non-Pi runtime dependencies/,
    );
  });

  test("rejects an unknown profile and a manifest without Pi", () => {
    expect(() => prepareRuntime(withPi({}), "unknown")).toThrow(/Profile must be/);
    expect(() => prepareRuntime({ dependencies: {} }, "base")).toThrow(/Runtime must include Pi/);
  });
});
