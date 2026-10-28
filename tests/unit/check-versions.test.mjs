import { expect, test } from "vitest";
import { checkVersions, manifestEntries } from "../../scripts/check-versions.mjs";

test("reads dependencies and labels overrides separately", () => {
  expect(manifestEntries({
    dependencies: { pi: "1.0.0" },
    overrides: { protobufjs: "7.6.6" },
  })).toEqual([
    { name: "pi", pinned: "1.0.0", kind: "dependency" },
    { name: "protobufjs", pinned: "7.6.6", kind: "override" },
  ]);
  expect(manifestEntries({})).toEqual([]);
  expect(() => manifestEntries({ overrides: { foo: { bar: "1" } } })).toThrow(/nested override/);
});

test("reports Git pins without looking them up on npm", async () => {
  const source = `git+https://github.com/example/skills.git#${"a".repeat(40)}`;
  const rows = await checkVersions(
    { dependencies: { skills: source } },
    async () => { throw new Error("Git packages must not query npm"); },
  );
  expect(rows).toEqual([
    { name: "skills", pinned: source, kind: "dependency", latest: "—", status: "git-pinned" },
  ]);
});

test("reports matches, differences and failures without changing the manifest", async () => {
  const manifest = {
    dependencies: { same: "1.0.0", changed: "2.0.0", failed: "1.0.0" },
  };
  const before = structuredClone(manifest);
  const rows = await checkVersions(manifest, async (name) => {
    if (name === "failed") throw new Error("registry unavailable");
    return "1.0.0";
  });
  expect(rows.map((row) => row.status)).toEqual(["current", "different", "ERROR"]);
  expect(rows[2].error).toBe("registry unavailable");
  expect(manifest).toEqual(before);
});
