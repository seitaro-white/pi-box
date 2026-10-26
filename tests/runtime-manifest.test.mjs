import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
        packages: [...extensions.map((name) => `/opt/pi/node_modules/${name}`), "/opt/pi/node_modules/personal-skills"],
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

  it("adds personal skills from main at build time, outside both npm locks", () => {
    assert.equal(source.piBox.personalSkills, true);
    assert.equal(source.dependencies["personal-skills"], undefined);
    for (const prefix of ["container", "container/base"]) {
      const lock = readJson(join(root, prefix, "package-lock.json"));
      assert.equal(lock.packages["node_modules/personal-skills"], undefined);
    }
    const instruction = "ADD https://github.com/seitaro-white/personal-agent-skills.git#main /opt/pi/node_modules/personal-skills/";
    for (const file of ["Dockerfile", "sandbox/pi-box.dockerfile"]) {
      const dockerfile = readFileSync(join(root, file), "utf8");
      assert(dockerfile.startsWith("# syntax=docker/dockerfile:1\n"), file);
      assert(dockerfile.split("\n").includes(instruction), file);
    }
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
