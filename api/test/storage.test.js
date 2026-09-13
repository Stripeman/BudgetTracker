'use strict';
// Storage and schema safety: corruption refusal, concurrency, preconditions, future versions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createMemoryStorage, createFileStorage, update, checkName } = require('../_shared/storage');
const { readDocument } = require('../_shared/schema');
const { harness } = require('./helpers');

test('corrupt JSON is refused, never treated as empty, and nothing is overwritten', async () => {
  const s = createMemoryStorage();
  await s.putBytes('workspaces/ws_x/workspace.json', Buffer.from('{"truncated'));
  await assert.rejects(() => s.getJson('workspaces/ws_x/workspace.json'), (e) => e.code === 'storage_corrupt');
  await assert.rejects(() => update(s, 'workspaces/ws_x/workspace.json', () => ({ replaced: true })), (e) => e.code === 'storage_corrupt');
  assert.equal((await s.getBytes('workspaces/ws_x/workspace.json')).bytes.toString(), '{"truncated');
});

test('prototype-polluting keys are dropped when stored JSON is parsed', async () => {
  const s = createMemoryStorage();
  await s.putBytes('a.json', Buffer.from('{"__proto__":{"polluted":true},"ok":1}'));
  const { value } = await s.getJson('a.json');
  assert.equal(value.ok, 1);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
});

test('concurrent updates both land; a stale client precondition is refused', async () => {
  const s = createMemoryStorage();
  await s.putJson('c.json', { n: 0 });
  await Promise.all(Array.from({ length: 8 }, () => update(s, 'c.json', (v) => ({ n: v.n + 1 }))));
  assert.equal((await s.getJson('c.json')).value.n, 8);
  await assert.rejects(() => update(s, 'c.json', (v) => v, { expectedEtag: '"stale"' }), (e) => e.status === 409);
});

test('storage names cannot traverse paths', () => {
  for (const bad of ['../x', 'a/../b', '/abs', 'a//b', 'a\\b', '']) assert.throws(() => checkName(bad));
  assert.equal(checkName('workspaces/ws_1/workspace.json'), 'workspaces/ws_1/workspace.json');
});

test('file storage writes atomically and honours preconditions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-store-'));
  try {
    const s = createFileStorage(dir);
    const etag = await s.putJson('w/doc.json', { a: 1 }, { ifNoneMatch: '*' });
    await assert.rejects(() => s.putJson('w/doc.json', { a: 2 }, { ifNoneMatch: '*' }), (e) => e.code === 'precondition_failed');
    await s.putJson('w/doc.json', { a: 3 }, { ifMatch: etag });
    assert.equal((await s.getJson('w/doc.json')).value.a, 3);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'w')).filter((f) => f.endsWith('.tmp')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a document from a newer schema is refused with 503 and not modified', async () => {
  assert.throws(() => readDocument('workspace', { schemaVersion: 99 }), (e) => e.code === 'schema_unsupported' && e.status === 503);
  assert.throws(() => readDocument('workspace', { name: 'no version' }), (e) => e.code === 'schema_invalid');
  const h = harness();
  const ws = (await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Future' } })).body.workspace;
  const name = `workspaces/${ws.id}/workspace.json`;
  const { value } = await h.storage.getJson(name);
  const future = { ...value, schemaVersion: 2 };
  await h.storage.putJson(name, future);
  const before = (await h.storage.getBytes(name)).bytes.toString();
  const res = await h.call('workspaces', 'PATCH', { as: 'alice', query: { id: ws.id }, body: { name: 'Changed' } });
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'schema_unsupported');
  assert.equal((await h.storage.getBytes(name)).bytes.toString(), before);
});

test('internal errors are generic and carry no stored values', async () => {
  const s = createMemoryStorage({ failWrite: (n) => n.startsWith('workspaces/') });
  const h = harness({ storage: s });
  const res = await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fails' } });
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'server_error');
  assert.ok(!JSON.stringify(res.body).includes('Injected'));
});
