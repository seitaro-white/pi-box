// Run on stdin inside a disposable, credential-free image container.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createAgentSession, DefaultResourceLoader, SessionManager } from '/opt/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
// Assert the image seeder did not write policy files before extensions initialise.
assert.equal(existsSync(`${process.env.PI_CODING_AGENT_DIR}/extensions/subagent/config.json`), false);
assert.equal(existsSync(`${process.env.PI_CODING_AGENT_DIR}/web-search.json`), false);
const loader = new DefaultResourceLoader({ cwd: '/workspace', agentDir: process.env.PI_CODING_AGENT_DIR });
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const { session } = await createAgentSession({ resourceLoader: loader, sessionManager: SessionManager.inMemory() });
const errors = [];
try {
  await session.bindExtensions({ onError: error => errors.push(error) });
  const names = session.getAllTools().map(t => t.name);
  for (const name of ['subagent', 'bg_wait', 'fetch_content', 'get_search_content']) assert(names.includes(name), `Missing ${name}`);
  // Do not pin extension policy/tool availability to our former custom defaults.
  // This test binds extensions but never invokes a tool or calls a provider.
  assert.deepEqual(errors, []);
  console.log('PASS: locked extensions loaded without image-seeded policy files');
} finally {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  session.dispose();
}
