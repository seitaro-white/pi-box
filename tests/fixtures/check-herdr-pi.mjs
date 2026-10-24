// Verify Herdr's officially installed integration against pinned Pi, without a provider.
// This intentionally runs outside Herdr: the image-provided extension must
// be harmless for ordinary Pi sessions too. Interactive reporting is manual.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "/opt/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

assert.equal(process.env.HERDR_ENV, undefined);
const agentDir = join(homedir(), ".pi", "agent");
const extension = join(agentDir, "extensions/herdr-agent-state.ts");
assert(existsSync(extension));
const loader = new DefaultResourceLoader({ cwd: "/workspace", agentDir });
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
assert.equal(loader.getExtensions().extensions.filter((item) => item.resolvedPath === extension).length, 1);
assert.equal(existsSync("/opt/pi/node_modules/@muzi3/herdr-agent-state"), false);
const { session } = await createAgentSession({
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});
try {
  const errors = [];
  await session.bindExtensions({ onError: (error) => errors.push(error) });
  await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  assert.deepEqual(errors, []);
} finally {
  session.dispose();
}
console.log("PASS: Herdr Pi extension loads and exits outside Herdr, without a model call.");
