// Run on stdin inside a disposable, credential-free smoke-test container.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAgentSession, DefaultResourceLoader, SessionManager } from '/opt/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js';

const profile = process.env.PI_BOX_PROFILE;
const piPackage = '@earendil-works/pi-coding-agent';
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

test(`${profile}: exact package pins and extension/tool/command registration`, async t => {
  assert(['base', 'recommended'].includes(profile));
  const expected = JSON.parse(process.env.EXPECTED_DEPENDENCIES_JSON);
  const extensions = Object.keys(expected).filter(name => name !== piPackage);
  const manifest = readJson('/opt/pi/package.json');
  assert.deepEqual(manifest.dependencies, profile === 'base' ? { [piPackage]: expected[piPackage] } : expected);

  // The image must not seed policy files before upstream extensions initialize.
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  for (const file of ['extensions/subagent/config.json', 'web-search.json']) {
    assert.equal(existsSync(`${agentDir}/${file}`), false, file);
  }
  for (const name of extensions) {
    const path = `/opt/pi/node_modules/${name}/package.json`;
    assert.equal(existsSync(path), profile === 'recommended', `package presence for ${name}`);
    if (profile === 'recommended') assert.equal(readJson(path).version, expected[name], name);
  }

  const loader = new DefaultResourceLoader({ cwd: '/workspace', agentDir });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await createAgentSession({ resourceLoader: loader, sessionManager: SessionManager.inMemory() });
  t.after(async () => {
    try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); }
    finally { session.dispose(); }
  });
  const errors = [];
  await session.bindExtensions({ onError: error => errors.push(error) });
  const tools = new Set(session.getAllTools().map(tool => tool.name));
  const bundled = new Set(profile === 'recommended' ? extensions : []);
  for (const [packageName, names] of [
    ['pi-subagents', ['subagent', 'bg_wait']],
    ['pi-web-access', ['fetch_content', 'get_search_content']],
  ]) {
    for (const name of names) assert.equal(tools.has(name), bundled.has(packageName), `tool ${name}`);
  }
  const loaded = loader.getExtensions().extensions;
  for (const name of bundled) {
    assert(loaded.some(extension => extension.resolvedPath.startsWith(`/opt/pi/node_modules/${name}/`)), `extension from ${name}`);
  }
  assert.equal(loaded.some(extension => extension.commands.has('usage')), bundled.has('@sreetej510/pi-usage'), '/usage command');
  assert.deepEqual(errors, []);
  // Tools/providers are never invoked; only loading, binding and shutdown run.
});
