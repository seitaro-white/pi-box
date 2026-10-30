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

/** Check that committed manifests, registrations and locks match generated output. */
function assertCommittedRuntime(profile, expected) {
  assert.deepEqual(prepareRuntime(source, profile), expected);
  const prefix = join(
    root,
    profile === "base" ? "container/base" : "container",
  );
  assert.deepEqual(
    readJson(join(prefix, "package.json")),
    expected.manifest,
    "regenerate manifest",
  );
  assert.deepEqual(
    readJson(join(prefix, "defaults/settings.json")),
    expected.settings,
    "regenerate defaults",
  );
  const lock = readJson(join(prefix, "package-lock.json"));
  assert.deepEqual(
    lock.packages[""].dependencies,
    expected.manifest.dependencies,
    "regenerate lockfile",
  );
  for (const [name, version] of Object.entries(
    expected.manifest.dependencies,
  )) {
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
  return lock;
}

describe("runtime manifests", () => {
  it("base keeps the pinned Pi runtime and overrides, without bundled extensions", () => {
    const lock = assertCommittedRuntime("base", {
      manifest: {
        ...source,
        piBox: { ...source.piBox, personalSkills: false, npmTools: [] },
        dependencies: { [PI_PACKAGE]: source.dependencies[PI_PACKAGE] },
      },
      settings: { packages: [] },
    });
    for (const name of [...extensions, ...npmTools]) {
      assert.equal(lock.packages[`node_modules/${name}`], undefined, name);
    }
  });

  it("recommended keeps all exact pins and registers extensions but not CLI tools", () => {
    assertCommittedRuntime("recommended", {
      manifest: source,
      settings: {
        packages: [
          ...extensions.map((name) => `/opt/pi/node_modules/${name}`),
          "/opt/pi/node_modules/personal-skills",
        ],
      },
    });
    assert.throws(
      () =>
        prepareRuntime(
          {
            ...source,
            dependencies: { ...source.dependencies, [PI_PACKAGE]: "^1.2.0" },
          },
          "recommended",
        ),
      /Use an exact version/,
    );
  });

  // The image adds personal skills from Git; the smoke test checks the result.
  it("keeps personal skills out of the manifest and both npm locks", () => {
    assert.equal(source.piBox.personalSkills, true);
    assert.equal(source.dependencies["personal-skills"], undefined);
    for (const prefix of ["container", "container/base"]) {
      const lock = readJson(join(root, prefix, "package-lock.json"));
      assert.equal(lock.packages["node_modules/personal-skills"], undefined);
    }
  });

  it("loads the context explorer instead of the context-management package", () => {
    const packages = prepareRuntime(source, "recommended").settings.packages;
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
      prepareRuntime(manifest("a".repeat(40)), "recommended").settings,
      { packages: ["/opt/pi/node_modules/skills"] },
    );
    for (const ref of ["main", "v1.0.0", "abc1234", ""]) {
      assert.throws(
        () => prepareRuntime(manifest(ref), "recommended"),
        /Use an exact version or full Git commit/,
      );
    }
  });

  it("supports manifests without CLI tools and rejects invalid tool declarations", () => {
    const minimal = {
      dependencies: { [PI_PACKAGE]: "1.2.0", extension: "1.0.0" },
    };
    assert.deepEqual(prepareRuntime(minimal, "recommended").settings, {
      packages: ["/opt/pi/node_modules/extension"],
    });
    for (const invalidTools of ["extension", [PI_PACKAGE], ["missing"]]) {
      assert.throws(
        () =>
          prepareRuntime(
            { ...minimal, piBox: { npmTools: invalidTools } },
            "recommended",
          ),
        /piBox.npmTools must list non-Pi runtime dependencies/,
      );
    }
    assert.throws(() => prepareRuntime(minimal, "unknown"), /Profile must be/);
    assert.throws(
      () => prepareRuntime({ dependencies: {} }, "base"),
      /Runtime must include Pi/,
    );
  });
});
