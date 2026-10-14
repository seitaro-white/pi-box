import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { prepareRuntime, PI_PACKAGE } from "../container/prepare-runtime.mjs";
import { root, readJson } from "./helpers/files.mjs";

const source = readJson(join(root, "container/package.json"));
const extensions = Object.keys(source.dependencies).filter(
  (name) => name !== PI_PACKAGE,
);

/** Check that committed manifests, registrations and locks match generated output. */
function assertCommittedRuntime(profile, expected) {
  assert.deepEqual(prepareRuntime(source, profile), expected);
  const prefix = join(root, profile === "base" ? "container/base" : "container");
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
  for (const [name, version] of Object.entries(expected.manifest.dependencies)) {
    assert.equal(lock.packages[`node_modules/${name}`].version, version, name);
  }
  return lock;
}

describe("runtime manifests", () => {
  it("base keeps the pinned Pi runtime and overrides, without bundled extensions", () => {
    const lock = assertCommittedRuntime("base", {
      manifest: {
        ...source,
        dependencies: { [PI_PACKAGE]: source.dependencies[PI_PACKAGE] },
      },
      settings: { packages: [] },
    });
    for (const name of extensions) {
      assert.equal(lock.packages[`node_modules/${name}`], undefined, name);
    }
  });

  it("recommended keeps all exact pins and registers every bundled extension", () => {
    assertCommittedRuntime("recommended", {
      manifest: source,
      settings: {
        packages: extensions.map((name) => `/opt/pi/node_modules/${name}`),
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
});
