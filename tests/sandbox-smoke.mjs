// Explicit opt-in live test. Never run by `npm test` or ordinary GitHub CI.
// No model calls, Git writes, or credential values are printed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const name = process.env.SANDBOX_NAME || "pi-box";
const canary = `.pi-box-smoke-${randomUUID()}`;
function sbx(args) {
  const result = spawnSync("sbx", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}
const list = JSON.parse(sbx(["ls", "--format", "json"]));
assert.ok(list.some((item) => item.name === name), "create the named sandbox first");
const check = `set -eu
pi --version
python3 --version
uv --version
ruff --version
biome --version
tmux -V
node -e 'const s=require(process.env.PI_CODING_AGENT_DIR+"/settings.json"); if(s.packages.length !== 4) process.exit(1)'
test "$(id -un)" = agent
test "$PWD" = /home/agent/workspace
test ! -S "\${SSH_AUTH_SOCK:-/no-socket}"
test ! -e /var/run/docker.sock
# sbx reserves a socket variable even when forwarding is disabled: test the socket.
printf canary > '${canary}'
# Auth store must not be seeded or rewritten by our initializer.
node -e 'const fs=require("node:fs"); const p=process.env.PI_CODING_AGENT_DIR+"/auth.json"; const before=fs.existsSync(p)?fs.readFileSync(p):null; require("node:child_process").execFileSync("node",["/opt/pi/init-agent.mjs"]); const after=fs.existsSync(p)?fs.readFileSync(p):null; if(before===null?after!==null:!before.equals(after)) process.exit(1)'
echo sandbox-runtime-ok`;
try {
  console.log(sbx(["exec", name, "bash", "-lc", check]).trim());
  if (process.env.PI_BOX_SANDBOX_RESTART === "1") {
    console.log("Stopping sandbox: running sessions will end.");
    sbx(["stop", name]);
    sbx(["exec", name, "bash", "-lc", `test "$(cat '${canary}')" = canary`]);
    sbx(["run", "--detach", "--name", name]);
    console.log("sandbox-restart-persistence-ok");
  }
} finally {
  sbx(["exec", name, "rm", "-f", canary]);
}
