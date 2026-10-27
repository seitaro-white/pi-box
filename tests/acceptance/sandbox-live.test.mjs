// Explicit opt-in live test (`npm run test:sandbox-live` on the macOS host).
// Never run by `npm test` or GitHub CI. No model calls, Git writes, or
// credential values are printed.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { incrementalSteps } from "../support/acceptance.mjs";

const name = process.env.SANDBOX_NAME || "pi-sandbox";
const canary = `.pi-box-smoke-${randomUUID()}`;
function sbx(args) {
  const result = spawnSync("sbx", args, { encoding: "utf8" });
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  return result.stdout;
}
const check = `set -eu
pi --version
python3 --version
uv --version
ruff --version
ty --version
biome --version
claude --version
tmux -V
node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  import { homedir } from "node:os";
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const manifest = read("/opt/pi/package.json");
  const expected = Object.keys(manifest.dependencies)
    .filter((name) => name !== "@earendil-works/pi-coding-agent" && !manifest.piBox.npmTools.includes(name))
    .map((name) => "/opt/pi/node_modules/" + name);
  const actual = read(homedir() + "/.pi/agent/settings.json").packages
    .map((item) => typeof item === "string" ? item : item.source);
  for (const source of expected) assert(actual.includes(source), "missing managed package " + source);
'
test "$(id -un)" = agent
test "$PWD" = /home/agent/workspace
test ! -S "\${SSH_AUTH_SOCK:-/no-socket}"
test ! -e /var/run/docker.sock
# sbx reserves a socket variable even when forwarding is disabled: test the socket.
printf canary > '${canary}'
# Auth store must not be seeded or rewritten by our initializer.
node -e 'const fs=require("node:fs"); const p=require("node:os").homedir()+"/.pi/agent/auth.json"; const before=fs.existsSync(p)?fs.readFileSync(p):null; require("node:child_process").execFileSync("node",["/opt/pi/init-agent.mjs"]); const after=fs.existsSync(p)?fs.readFileSync(p):null; if(before===null?after!==null:!before.equals(after)) process.exit(1)'
echo sandbox-runtime-ok`;
incrementalSteps();
let canaryWritten = false;
afterAll(() => {
  if (canaryWritten) sbx(["exec", name, "rm", "-f", canary]);
});

test(`sandbox ${name} exists`, () => {
  const list = JSON.parse(sbx(["ls", "--format", "json"]));
  expect(list.map((item) => item.name), "create the named sandbox first").toContain(name);
});

test("runtime has the agent user, bundled tools and no forwarded sockets", () => {
  canaryWritten = true;
  expect(sbx(["exec", name, "bash", "-lc", check]).trim()).toMatch(/sandbox-runtime-ok$/);
});

// Opt-in: stopping the sandbox ends its running sessions.
test.runIf(process.env.PI_BOX_SANDBOX_RESTART === "1")("files survive a sandbox stop and start", () => {
  sbx(["stop", name]);
  sbx(["exec", name, "bash", "-lc", `test "$(cat '${canary}')" = canary`]);
  sbx(["run", "--detach", "--name", name]);
});
