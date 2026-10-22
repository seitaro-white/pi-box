// Seed only synthetic workspace, history, auth and Git credentials in the test image.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

assert.equal(
  process.env.PI_CODING_AGENT_DIR,
  "/home/node/.pi/agent",
  "fixture must run inside the test image",
);
const cwd = "/workspace/repo";
mkdirSync(cwd, { recursive: true, mode: 0o700 });
execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd });
writeFileSync(`${cwd}/unpushed.txt`, "SYNTHETIC_WORKSPACE_CANARY\n", {
  mode: 0o600,
});
writeFileSync("/home/node/.pi/agent/history-canary", "SYNTHETIC_HISTORY_CANARY", {
  mode: 0o600,
});
writeFileSync(
  "/home/node/.pi/agent/auth.json",
  JSON.stringify({ synthetic: "SYNTHETIC_AUTH_CANARY_NOT_A_REAL_TOKEN" }),
  { mode: 0o600 },
);
execFileSync("git", ["config", "--global", "user.email", "synthetic@example.invalid"]);
execFileSync("git", ["credential", "approve"], {
  input:
    "protocol=https\nhost=github.com\npath=synthetic/repo.git\nusername=synthetic\npassword=SYNTHETIC_NOT_A_REAL_TOKEN\n\n",
});
