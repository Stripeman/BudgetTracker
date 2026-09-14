'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { mayAccess, encryptSnapshot, previewRestore } = require('../lib/foundation.cjs');
const owner = { verified: true, subject: 'fictional-owner' };
const outsider = { verified: true, subject: 'fictional-other', siteAdmin: true, workspaceOwner: true };
const operator = { ...owner, capability: 'recover-workspace', workspaceId: 'fictional-workspace' };
const resource = { id: 'fictional-record', ownerId: owner.subject, workspaceId: operator.workspaceId };
const grant = { subject: outsider.subject, resourceId: resource.id, workspaceId: resource.workspaceId,
  capability: 'view-transactions', revoked: false, expiresAt: 2000 };
function fixture() {
  const bytes = Buffer.from('FICTIONAL RECEIPT');
  return { schemaVersion: 1, workspaceId: resource.workspaceId,
    records: [{ ...resource, amountMinor: '-30000', currency: 'EUR', precision: 2, attachmentIds: ['receipt'] }],
    attachments: [{ id: 'receipt', recordId: resource.id, workspaceId: resource.workspaceId,
      base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }],
    grants: [grant] };
}
test('BT-001-02 denies anonymous, forged, administrator and cross-scope access', () => {
  assert.equal(mayAccess(null, resource, 'view-transactions', []), false);
  assert.equal(mayAccess({ ...owner, verified: false }, resource, 'view-transactions', []), false);
  assert.equal(mayAccess(outsider, resource, 'view-transactions', []), false);
  assert.equal(mayAccess(owner, resource, 'unknown', []), false);
  assert.equal(mayAccess(owner, resource, 'view-transactions', []), true);
  assert.equal(mayAccess(outsider, resource, 'view-transactions', [grant], 1000), true);
  for (const change of [{ revoked: true }, { expiresAt: 1000 }, { workspaceId: 'other' },
    { resourceId: 'other' }, { capability: 'export' }]) {
    assert.equal(mayAccess(outsider, resource, 'view-transactions', [{ ...grant, ...change }], 1000), false);
  }
});
test('BT-002-02 encrypted isolated preview preserves amounts/attachments and strips archived grants', () => {
  const snapshot = fixture();
  const original = structuredClone(snapshot);
  const key = randomBytes(32);
  const archive = encryptSnapshot(snapshot, key, operator);
  assert.equal(archive.includes(Buffer.from('fictional-owner')), false);
  assert.notDeepEqual(archive, encryptSnapshot(snapshot, key, operator));
  const restored = previewRestore(archive, key, operator, resource.workspaceId);
  assert.equal(restored.records[0].amountMinor, '-30000');
  assert.deepEqual(restored.attachments, snapshot.attachments);
  assert.deepEqual(restored.grants, []);
  assert.equal(mayAccess(outsider, restored.records[0], 'view-transactions', restored.grants, 1000), false);
  assert.equal(restored.executable, false);
  assert.deepEqual(snapshot, original);
});
test('BT-002-02 rejects tampering, wrong keys, scope and ordinary-owner recovery', () => {
  const key = randomBytes(32), archive = encryptSnapshot(fixture(), key, operator);
  const bad = Buffer.from(archive); bad[bad.length - 1] ^= 1;
  assert.throws(() => previewRestore(bad, key, operator, resource.workspaceId));
  assert.throws(() => previewRestore(archive, randomBytes(32), operator, resource.workspaceId));
  assert.throws(() => previewRestore(archive, key, owner, resource.workspaceId));
  assert.throws(() => previewRestore(archive, key, { ...operator, workspaceId: 'other' }, 'other'));
  assert.throws(() => encryptSnapshot(fixture(), key, owner));
});
test('BT-002-02 rejects incompatible, incomplete or malformed snapshots', () => {
  for (const mutate of [s => { s.schemaVersion = 2; }, s => { s.attachments = []; },
    s => { s.attachments[0].sha256 = 'incorrect'; }, s => { s.records[0].amountMinor = 0.1; },
    s => { s.records[0].workspaceId = 'other'; }, s => { s.records.push(s.records[0]); }]) {
    const s = fixture(); mutate(s);
    assert.throws(() => encryptSnapshot(s, randomBytes(32), operator));
  }
});
