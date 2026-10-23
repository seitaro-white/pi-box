import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root, temporaryDirectory } from "./helpers/files.mjs";

const initializer = join(root, "container/init-herdr.mjs");
const defaults = readFileSync(join(root, "container/defaults/herdr.toml"), "utf8");

test("Herdr seeds private state without rewriting operator config or agent data", (t) => {
  const home = temporaryDirectory(t, "pi-box-herdr-");
  const agent = join(home, ".pi", "agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, "auth.json"), "SYNTHETIC_AUTH");
  const run = () => execFileSync(process.execPath, [initializer], {
    env: { ...process.env, HOME: home },
  });
  run();
  const dir = join(agent, "herdr");
  const config = join(dir, "config", "config.toml");
  for (const path of [dir, join(dir, "config"), join(dir, "state")]) {
    assert.equal(statSync(path).mode & 0o777, 0o700);
  }
  assert.equal(statSync(config).mode & 0o777, 0o600);
  assert.equal(readFileSync(config, "utf8"), defaults);
  const originalMtime = statSync(config).mtimeMs;
  run();
  assert.equal(statSync(config).mtimeMs, originalMtime);
  const operatorConfig = "# operator config, deliberately not parsed by startup\n";
  writeFileSync(config, operatorConfig);
  const operatorMtime = statSync(config).mtimeMs;
  run();
  assert.equal(readFileSync(config, "utf8"), operatorConfig);
  assert.equal(statSync(config).mtimeMs, operatorMtime);
  assert.equal(readFileSync(join(agent, "auth.json"), "utf8"), "SYNTHETIC_AUTH");
  assert.equal(existsSync(join(agent, "extensions/herdr-agent-state.ts")), false);
});
