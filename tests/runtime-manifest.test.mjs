import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { prepareRuntime, PI_PACKAGE } from "../container/prepare-runtime.mjs";
import { root, readJson } from "./helpers/files.mjs";

const source = readJson(join(root, "container/package.json"));
const npmTools = source.piBox.npmTools;
const extensions = Object.keys(source.dependencies).filter(
  (name) => name !== PI_PACKAGE && !npmTools.includes(name),
);

/** Check that committed registrations and lock match generated output. */
function assertCommittedRuntime(expected) {
  assert.deepEqual(prepareRuntime(source), expected);
  assert.deepEqual(
    readJson(join(root, "container/defaults/settings.json")),
    expected.settings,
    "regenerate defaults",
  );
  const lock = readJson(join(root, "container/package-lock.json"));
  assert.deepEqual(
    lock.packages[""].dependencies,
    source.dependencies,
    "regenerate lockfile",
  );
  for (const [name, version] of Object.entries(source.dependencies)) {
    const installed = lock.packages[`node_modules/${name}`];
    if (version.startsWith("git+")) {
      // npm canonicalizes GitHub URLs to SSH; builds rewrite transport to HTTPS.
      assert.equal(
        installed.resolved.replace("git+ssh://git@github.com/", "git+https://github.com/"),
        version,
        name,
      );
    } else {
      assert.equal(installed.version, version, name);
    }
  }
}

describe("runtime manifests", () => {
  it("keeps all exact pins and registers extensions but not CLI tools", () => {
    assertCommittedRuntime({
      settings: {
        packages: [
          ...extensions.map((name) => `/opt/pi/node_modules/${name}`),
          "/opt/pi/node_modules/personal-skills",
        ],
      },
    });
    assert.throws(
      () =>
        prepareRuntime({
          ...source,
          dependencies: { ...source.dependencies, [PI_PACKAGE]: "^1.2.0" },
        }),
      /Use an exact version/,
    );
  });

  // The image adds personal skills from Git; the smoke test checks the result.
  it("keeps personal skills out of the manifest and npm lock", () => {
    assert.equal(source.piBox.personalSkills, true);
    assert.equal(source.dependencies["personal-skills"], undefined);
    const lock = readJson(join(root, "container/package-lock.json"));
    assert.equal(lock.packages["node_modules/personal-skills"], undefined);
  });

  it("loads the context explorer instead of the context-management package", () => {
    const packages = prepareRuntime(source).settings.packages;
    assert.ok(packages.includes("/opt/pi/node_modules/pi-context-view"));
    assert.equal(source.dependencies["pi-context"], undefined);
    assert.equal(source.dependencies["pi-intercom"], undefined);
    const lock = readJson(join(root, "container/package-lock.json"));
    assert.equal(lock.packages["node_modules/pi-context"], undefined);
  });

  it("treats Claude Code as a CLI tool rather than a Pi extension", () => {
    assert.ok(source.piBox.npmTools.includes("@anthropic-ai/claude-code"));
    assert.ok(!extensions.includes("@anthropic-ai/claude-code"));
  });

  it("accepts full HTTPS Git commit pins but rejects floating refs", () => {
    const gitSource = "git+https://github.com/example/skills.git#";
    const manifest = (ref) => ({
      dependencies: { [PI_PACKAGE]: "1.4.0", skills: gitSource + ref },
    });
    assert.deepEqual(
      prepareRuntime(manifest("a".repeat(40))).settings,
      { packages: ["/opt/pi/node_modules/skills"] },
    );
    for (const ref of ["main", "v1.0.0", "abc1234", ""]) {
      assert.throws(
        () => prepareRuntime(manifest(ref)),
        /Use an exact version or full Git commit/,
      );
    }
  });

  it("supports manifests without CLI tools and rejects invalid tool declarations", () => {
    const minimal = {
      dependencies: { [PI_PACKAGE]: "1.2.0", extension: "1.0.0" },
    };
    assert.deepEqual(prepareRuntime(minimal).settings, {
      packages: ["/opt/pi/node_modules/extension"],
    });
    for (const invalidTools of ["extension", [PI_PACKAGE], ["missing"]]) {
      assert.throws(
        () =>
          prepareRuntime({ ...minimal, piBox: { npmTools: invalidTools } }),
        /piBox.npmTools must list non-Pi runtime dependencies/,
      );
    }
    assert.throws(
      () => prepareRuntime({ dependencies: {} }),
      /Runtime must include Pi/,
    );
  });
});
