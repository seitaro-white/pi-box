import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { root, readJson, temporaryDirectory } from "./files.mjs";

/**
 * Create synthetic agent state and helpers for running the real initializer.
 * Never reads or writes the host's Pi state; cleanup belongs to the owning test.
 *
 * @param {import("node:test").TestContext} t Owning test context.
 * @returns {object} File helpers and an initializer runner.
 */
export function agentState(t) {
  const dir = temporaryDirectory(t, "pi-box-init-");
  const path = (name) => join(dir, name);
  const write = (name, value) => {
    mkdirSync(dirname(path(name)), { recursive: true, mode: 0o700 });
    writeFileSync(path(name), value, { mode: 0o600 });
  };
  return {
    path,
    read: (name) => readFileSync(path(name), "utf8"),
    json: (name) => readJson(path(name)),
    write,
    writeJson: (name, value) => write(name, JSON.stringify(value)),
    run: (defaultsDir = join(root, "container/defaults")) =>
      execFileSync(process.execPath, [join(root, "container/init-agent.mjs")], {
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: dir,
          PI_BOX_DEFAULTS_DIR: defaultsDir,
        },
        stdio: "pipe",
      }),
  };
}
