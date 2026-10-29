// Verify Herdr's officially installed integration against pinned Pi, without a provider.
// This intentionally runs outside Herdr: the image-provided extension must
// be harmless for ordinary Pi sessions too. Interactive reporting is manual.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  SessionManager,
} from "/opt/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

assert.equal(process.env.HERDR_ENV, undefined);
const agentDir = join(homedir(), ".pi", "agent");
const extension = join(agentDir, "extensions/herdr-agent-state.ts");
const bridge = join(agentDir, "extensions/herdr-question-state.ts");
assert(existsSync(extension));
assert(existsSync(bridge));
const eventBus = createEventBus();
const reports = [];
eventBus.on("herdr:blocked", (report) => reports.push(report));
const loader = new DefaultResourceLoader({ cwd: "/workspace", agentDir, eventBus });
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
// Image-owned global skills remain visible with fresh and reused agent volumes.
for (const name of ["hunk-review", "herdr"]) {
  assert.equal(loader.getSkills().skills.filter((skill) => skill.name === name).length, 1, name);
}
for (const path of [extension, bridge]) {
  assert.equal(loader.getExtensions().extensions.filter((item) => item.resolvedPath === path).length, 1);
}
assert.equal(existsSync("/opt/pi/node_modules/@muzi3/herdr-agent-state"), false);
const { session } = await createAgentSession({
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});
try {
  const errors = [];
  await session.bindExtensions({ onError: (error) => errors.push(error) });
  eventBus.emit("rpiv:ask-user:blocked", { active: true, toolCallId: "smoke-question" });
  eventBus.emit("rpiv:ask-user:blocked", { active: false, toolCallId: "smoke-question" });
  assert.deepEqual(reports, [
    { active: true, label: "Waiting for your answers" },
    { active: false, label: "Waiting for your answers" },
  ]);
  await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  assert.deepEqual(errors, []);
} finally {
  session.dispose();
}
console.log("PASS: Herdr Pi extension loads and exits outside Herdr, without a model call.");
