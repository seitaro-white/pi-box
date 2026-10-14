import test from 'node:test';
import assert from 'node:assert/strict';
import { checkVersions, manifestEntries } from '../scripts/check-versions.mjs';

test('reads dependencies and labels overrides separately', () => {
  assert.deepEqual(manifestEntries({ dependencies: { pi: '1.0.0' }, overrides: { protobufjs: '7.6.6' } }), [
    { name: 'pi', pinned: '1.0.0', kind: 'dependency' },
    { name: 'protobufjs', pinned: '7.6.6', kind: 'override' },
  ]);
  assert.deepEqual(manifestEntries({}), []);
  assert.throws(() => manifestEntries({ overrides: { foo: { bar: '1' } } }), /nested override/);
});

test('reports matches, differences and failures without changing the manifest', async () => {
  const manifest = { dependencies: { same: '1.0.0', changed: '2.0.0', failed: '1.0.0' } };
  const before = structuredClone(manifest);
  const rows = await checkVersions(manifest, async (name) => {
    if (name === 'failed') throw new Error('registry unavailable');
    return '1.0.0';
  });
  assert.deepEqual(rows.map((row) => row.status), ['current', 'different', 'ERROR']);
  assert.equal(rows[2].error, 'registry unavailable');
  assert.deepEqual(manifest, before);
});
