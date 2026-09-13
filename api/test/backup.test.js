'use strict';
// BT-002 backup and restore acceptance tests: encryption and authentication, key rotation,
// validated bytes, non-mutating summary-only previews, scoped restores that never touch other
// members' private records, no resurrection of access, atomic replace with a recovery point,
// interruption safety, merge conflicts, create-new, and an isolated operator drill.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { harness, household, TEST_KEYS } = require('./helpers');
const { createMemoryStorage } = require('../_shared/storage');
const archive = require('../_shared/archive');
const { runDrill } = require('../../scripts/recovery/drill.cjs');

const DAY = 24 * 60 * 60 * 1000;

async function backupNow(h, f, as = 'alice') {
  const res = await h.call('backups', 'POST', { as, query: f.q, body: {} });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.archive.archiveId;
}
const archiveBytes = async (h, f, id) => (await h.backupStorage.getBytes(`workspaces/${f.ws.id}/${id}.btbk`)).bytes;
const snapshotFiles = (s) => JSON.stringify([...s.files.entries()].map(([k, v]) => [k, v.etag]));
const preview = (h, f, as, archiveId, mode) => h.call('restore', 'POST', { as, query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode } });
const execute = (h, f, as, body) => h.call('restore', 'POST', { as, query: { action: 'execute' }, body: { workspaceId: f.ws.id, ...body } });

describe('BT-002 archives', () => {
  test('archives are encrypted: no names, emails or payees in the bytes; metadata only in listings', async () => {
    const h = harness();
    const f = await household(h);
    const id = await backupNow(h, f);
    const bytes = await archiveBytes(h, f, id);
    for (const secret of ['Secret Jeweller', 'Fictional Grocer', 'alice@example.com', 'Bob Card', '25000']) {
      assert.equal(bytes.includes(Buffer.from(secret)), false, secret);
    }
    const listing = (await h.call('backups', 'GET', { as: 'alice', query: f.q })).body;
    assert.equal(listing.archives.length, 1);
    assert.deepEqual(Object.keys(listing.archives[0]).sort(), ['archiveId', 'createdAt', 'createdBy', 'reason']);
    assert.equal((await h.call('backups', 'GET', { as: 'bob', query: f.q })).status, 403, 'members cannot list');
    assert.equal((await h.call('backups', 'GET', { as: 'dave', query: f.q })).status, 404, 'site admin has no route in');
  });

  test('tampering with header or ciphertext, truncation, wrong workspace and wrong key are rejected', async () => {
    const h = harness();
    const f = await household(h);
    const bytes = await archiveBytes(h, f, await backupNow(h, f));
    const keyring = archive.loadKeys(h.env);
    const { headerEnd } = archive.readHeader(bytes);
    const flip = (i) => { const b = Buffer.from(bytes); b[i] ^= 1; return b; };
    assert.throws(() => archive.open(flip(12), keyring), (e) => e.status === 422, 'header byte');
    assert.throws(() => archive.open(flip(bytes.length - 1), keyring), (e) => e.code === 'archive_authentication');
    assert.throws(() => archive.open(flip(headerEnd + 3), keyring), (e) => e.code === 'archive_authentication', 'nonce');
    assert.throws(() => archive.open(bytes.subarray(0, bytes.length - 10), keyring), (e) => e.status === 422);
    assert.throws(() => archive.open(bytes, keyring, { expectedWorkspaceId: 'ws_other000' }), (e) => e.code === 'archive_workspace_mismatch');
    const otherKeys = archive.loadKeys({ BT_BACKUP_KEYS: `k1:${TEST_KEYS.k2}`, BT_BACKUP_ACTIVE_KEY: 'k1' });
    assert.throws(() => archive.open(bytes, otherKeys), (e) => e.code === 'archive_authentication');
    // Header edited to claim another workspace, with a consistent length: authentication fails.
    const text = bytes.toString('latin1').replace(f.ws.id, f.ws.id.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')));
    assert.throws(() => archive.open(Buffer.from(text, 'latin1'), keyring), (e) => e.status === 422);
  });

  test('key rotation: old archives open while their key is listed, and fail clearly once removed', async () => {
    const h = harness();
    const f = await household(h);
    const id = await backupNow(h, f);
    h.env.BT_BACKUP_KEYS = `k1:${TEST_KEYS.k1},k2:${TEST_KEYS.k2}`;
    h.env.BT_BACKUP_ACTIVE_KEY = 'k2';
    assert.equal((await preview(h, f, 'alice', id, 'merge')).status, 200);
    const id2 = await backupNow(h, f);
    assert.equal(archive.readHeader(await archiveBytes(h, f, id2)).header.keyId, 'k2');
    h.env.BT_BACKUP_KEYS = `k2:${TEST_KEYS.k2}`;
    const res = await preview(h, f, 'alice', id, 'merge');
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'backup_key_unavailable');
    assert.throws(() => archive.loadKeys({ BT_BACKUP_KEYS: `k1:${Buffer.alloc(32).toString('base64')}`, BT_BACKUP_ACTIVE_KEY: 'k1' }), /misconfigured/);
  });

  test('a workspace failing financial invariants is not backed up and nothing is stored', async () => {
    const h = harness();
    const f = await household(h);
    const name = `workspaces/${f.ws.id}/workspace.json`;
    const { value } = await h.storage.getJson(name);
    value.transactions[0].amountMinor = 0.5;
    await h.storage.putJson(name, value);
    const res = await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'backup_invalid');
    assert.deepEqual(await h.backupStorage.list(''), []);
  });
});

describe('BT-002 restore previews', () => {
  test('preview changes nothing and reveals nothing outside the caller\'s scope', async () => {
    const h = harness();
    const f = await household(h);
    const id = await backupNow(h, f);
    const before = snapshotFiles(h.storage);
    const res = await preview(h, f, 'alice', id, 'replace');
    assert.equal(res.status, 200);
    assert.equal(snapshotFiles(h.storage), before, 'no storage writes');
    const text = JSON.stringify(res.body);
    for (const hidden of ['Secret Jeweller', 'Bob Card', f.bobCard.id, f.secret.id, '-250.00']) assert.equal(text.includes(hidden), false, hidden);
    assert.equal(res.body.excluded.otherMembersPrivateRecords, true);
    assert.equal(res.body.scope.accounts, 2, 'Joint and Alice Savings');
    // Totals for in-scope accounts only: 917.60 + 5000.00.
    assert.deepEqual(res.body.totalsAfter, [{ currency: 'EUR', amount: '5917.60' }]);
    assert.match(res.body.permissions, /never restored/);
    assert.equal(typeof res.body.expectedEtag, 'string');
  });

  test('viewers and non-members cannot reach backups; unknown archives are not-found', async () => {
    const h = harness();
    const f = await household(h);
    const id = await backupNow(h, f);
    assert.equal((await preview(h, f, 'carol', id, 'merge')).status, 404);
    assert.equal((await preview(h, f, 'eve', id, 'merge')).status, 404);
    assert.equal((await preview(h, f, 'dave', id, 'merge')).status, 404);
    assert.equal((await preview(h, f, 'alice', 'bak_nosuch000', 'merge')).status, 404);
  });
});

describe('BT-002 replace', () => {
  test('restores in-scope records, leaves other members\' private records and current access untouched', async () => {
    const h = harness();
    const f = await household(h);
    const bob = f.memberId('Bob');
    const alice = f.memberId('Alice');
    // Before the backup: Bob grants Alice view access to his card.
    const grant = (await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: alice, capabilities: ['view-transactions'] } })).body.grant;
    const id = await backupNow(h, f);
    // After the backup: Alice deletes the grocery entry; Bob edits his private entry and revokes the
    // grant; Carol is removed.
    await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: f.grocery.id, revision: 1, reason: 'Fictional test' } });
    await h.call('transactions', 'PATCH', { as: 'bob', query: f.q, body: { transactionId: f.secret.id, revision: 1, amount: '260.00', reason: 'Fictional test' } });
    await h.call('grants', 'DELETE', { as: 'bob', query: f.q, body: { grantId: grant.id } });
    await h.call('members', 'DELETE', { as: 'alice', query: f.q, body: { memberId: f.memberId('Carol') } });
    const pv = (await preview(h, f, 'alice', id, 'replace')).body;
    assert.equal(pv.canExecute, true);
    assert.equal((await execute(h, f, 'alice', { archiveId: id, mode: 'replace', expectedEtag: pv.expectedEtag })).body.error.code, 'confirm_required');
    const res = await execute(h, f, 'alice', { archiveId: id, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.recoveryPoint);
    const joint = (await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: f.joint.id } })).body;
    assert.equal(joint.total, 1, 'grocery entry restored');
    const bobTx = (await h.call('transactions', 'GET', { as: 'bob', query: { ...f.q, accountId: f.bobCard.id } })).body.transactions[0];
    assert.equal(bobTx.amount, '-260.00', 'Bob\'s newer private edit was not rolled back by Alice');
    assert.ok(!(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).body.accounts.some((a) => a.id === f.bobCard.id), 'revoked grant not resurrected');
    assert.equal((await h.call('accounts', 'GET', { as: 'carol', query: f.q })).status, 404, 'removed member not resurrected');
    const list = (await h.call('backups', 'GET', { as: 'alice', query: f.q })).body.archives;
    assert.ok(list.some((a) => a.reason === 'pre-restore'));
    assert.ok((await h.call('audit', 'GET', { as: 'bob', query: f.q })).body.entries.some((e) => e.action === 'workspace.restore-replace'));
    void bob;
  });

  test('BT-001-05 A7 replace sets records aside with who, when, why and the archive — it never drops them', async () => {
    const h = harness();
    const f = await household(h);
    const id = await backupNow(h, f);
    const extra = (await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '7.00', notes: 'after the backup' } })).body.transactions[0];
    await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: f.grocery.id, revision: 1, notes: 'edited after the backup' } });
    const pv = (await preview(h, f, 'alice', id, 'replace')).body;
    assert.equal(pv.excluded.setAside, 2);
    assert.match(pv.warnings[0], /kept in the workspace history/);
    const res = await execute(h, f, 'alice', { archiveId: id, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const live = (await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: f.joint.id } })).body.transactions;
    assert.deepEqual(live.map((t) => [t.id, t.notes]), [[f.grocery.id, '']], 'the lists show the backup version');
    const { value: doc } = await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`);
    const aside = doc.superseded.map((s) => [s.collection, s.reason, s.record.id, s.record.notes, s.archiveId, s.by]);
    assert.deepEqual(aside.sort(), [
      ['transactions', 'not-in-backup', extra.id, 'after the backup', id, 'google:g-alice'],
      ['transactions', 'replaced-by-backup', f.grocery.id, 'edited after the backup', id, 'google:g-alice'],
    ].sort());
    assert.deepEqual(doc.restores.map((r) => [r.archiveId, r.mode, r.recoveryPoint, r.setAside]), [[id, 'replace', res.body.recoveryPoint, 2]]);
    // A second replace keeps what the first one set aside.
    const pv2 = (await preview(h, f, 'alice', id, 'replace')).body;
    assert.equal((await execute(h, f, 'alice', { archiveId: id, mode: 'replace', expectedEtag: pv2.expectedEtag, confirm: 'REPLACE' })).status, 200);
    const { value: doc2 } = await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`);
    assert.equal(doc2.superseded.length, 2);
    assert.equal(doc2.restores.length, 2);
  });

  test('BT-001-05 restore history shows set-aside records only to people who could see them; counts only to the restorer', async () => {
    const h = harness();
    const f = await household(h);
    const id = await backupNow(h, f);
    const extra = (await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '7.00' } })).body.transactions[0];
    const bobExtra = (await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, kind: 'expense', amount: '9.00' } })).body.transactions[0];
    // Alice (owner) restores her scope; then Bob (member) restores his own private scope.
    let pv = (await preview(h, f, 'alice', id, 'replace')).body;
    assert.equal((await execute(h, f, 'alice', { archiveId: id, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' })).status, 200);
    pv = (await preview(h, f, 'bob', id, 'replace')).body;
    assert.equal((await execute(h, f, 'bob', { archiveId: id, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' })).status, 200);
    const hist = async (as) => h.call('backups', 'GET', { as, query: { ...f.q, action: 'history' } });
    const asAlice = (await hist('alice')).body;
    assert.deepEqual(asAlice.setAside.map((s) => s.recordId), [extra.id], 'Bob\'s private entry is never shown to the owner');
    assert.deepEqual(asAlice.restores.map((r) => [r.by, r.mode, r.setAside]), [['Alice Fictional', 'replace', 1], ['Bob Fictional', 'replace', null]]);
    assert.deepEqual([asAlice.setAside[0].collection, asAlice.setAside[0].reason, asAlice.setAside[0].summary], ['transactions', 'not-in-backup', { date: extra.date, amount: '-7.00', currency: 'EUR' }]);
    assert.equal(asAlice.setAside[0].record, undefined, 'summaries only, never the stored record');
    const asBob = (await hist('bob')).body;
    assert.deepEqual(asBob.setAside.map((s) => s.recordId).sort(), [extra.id, bobExtra.id].sort());
    assert.deepEqual(asBob.restores.map((r) => [r.by, r.setAside]), [['Alice Fictional', null], ['Bob Fictional', 1]]);
    assert.equal((await hist('carol')).status, 404, 'viewers cannot restore, so they see no restore history');
    assert.equal((await hist('dave')).status, 404, 'site administration gives no workspace access');
    assert.equal((await hist('eve')).status, 404);
  });

  test('a stale preview is refused and a failed swap leaves the workspace unchanged', async () => {
    const h = harness();
    const f = await household(h);
    const id = await backupNow(h, f);
    const pv = (await preview(h, f, 'alice', id, 'replace')).body;
    await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '3.00' } });
    const stale = await execute(h, f, 'alice', { archiveId: id, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'stale_preview');

    // Interrupted restore: the document write fails after the recovery point was taken.
    const name = `workspaces/${f.ws.id}/workspace.json`;
    const pv2 = (await preview(h, f, 'alice', id, 'replace')).body;
    const before = (await h.storage.getBytes(name)).bytes.toString();
    const originalPut = h.storage.putBytes;
    h.storage.putBytes = async (n, bytes, cond) => { if (n === name) throw Object.assign(new Error('simulated outage'), { code: 'injected' }); return originalPut(n, bytes, cond); };
    const failed = await execute(h, f, 'alice', { archiveId: id, mode: 'replace', expectedEtag: pv2.expectedEtag, confirm: 'REPLACE' });
    h.storage.putBytes = originalPut;
    assert.equal(failed.status, 500);
    assert.equal((await h.storage.getBytes(name)).bytes.toString(), before, 'workspace untouched');
    assert.ok((await h.call('backups', 'GET', { as: 'alice', query: f.q })).body.archives.some((a) => a.reason === 'pre-restore'), 'recovery point kept');
    // Safe restart: a fresh preview and execute succeed.
    const pv3 = (await preview(h, f, 'alice', id, 'replace')).body;
    assert.equal((await execute(h, f, 'alice', { archiveId: id, mode: 'replace', expectedEtag: pv3.expectedEtag, confirm: 'REPLACE' })).status, 200);
  });

  test('an edit that lands while the recovery point is being written is never overwritten', async () => {
    const h = harness();
    const f = await household(h);
    const id = await backupNow(h, f);
    const pv = (await preview(h, f, 'alice', id, 'replace')).body;
    // Bob saves an entry at the exact moment the pre-restore archive is being stored.
    const originalPut = h.backupStorage.putBytes;
    let raced = false;
    h.backupStorage.putBytes = async (n, bytes, cond) => {
      if (!raced && n.endsWith('.btbk')) {
        raced = true;
        const r = await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '4.00', notes: 'concurrent' } });
        assert.equal(r.status, 201);
      }
      return originalPut(n, bytes, cond);
    };
    const res = await execute(h, f, 'alice', { archiveId: id, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' });
    h.backupStorage.putBytes = originalPut;
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'stale_preview');
    const joint = (await h.call('transactions', 'GET', { as: 'bob', query: { ...f.q, accountId: f.joint.id } })).body.transactions;
    assert.ok(joint.some((t) => t.notes === 'concurrent'), 'the concurrent edit survived');
  });

  test('a restore that would split a transfer with another member\'s private account is blocked', async () => {
    const h = harness();
    const f = await household(h);
    await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.joint.id, kind: 'transfer', amount: '50.00', transfer: { toAccountId: f.bobCard.id } } });
    const id = await backupNow(h, f);
    // After backup, Bob deletes the transfer (both legs). Alice's replace would bring back only the
    // shared leg, which would unbalance the pair.
    const xfer = (await h.call('transactions', 'GET', { as: 'bob', query: { ...f.q, kind: 'transfer', accountId: f.joint.id } })).body.transactions[0];
    assert.equal((await h.call('transactions', 'DELETE', { as: 'bob', query: f.q, body: { transactionId: xfer.id, revision: 1, reason: 'Fictional test' } })).status, 200);
    const pv = (await preview(h, f, 'alice', id, 'replace')).body;
    assert.equal(pv.canExecute, false);
    assert.match(pv.blockers[0], /recovery operator/);
    assert.equal((await execute(h, f, 'alice', { archiveId: id, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' })).body.error.code, 'restore_blocked');
  });
});

describe('BT-002 merge and create-new', () => {
  test('merge adds missing in-scope records, skips conflicting ones and keeps current versions', async () => {
    const h = harness();
    const f = await household(h);
    const id0 = await backupNow(h, f);
    const extra = (await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '7.00' } })).body.transactions[0];
    const id1 = await backupNow(h, f);
    let pv = (await preview(h, f, 'alice', id0, 'replace')).body;
    await execute(h, f, 'alice', { archiveId: id0, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' });
    assert.equal((await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: f.joint.id } })).body.total, 1, 'extra removed by replace');
    await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: f.grocery.id, revision: 1, notes: 'edited after' } });
    pv = (await preview(h, f, 'alice', id1, 'merge')).body;
    assert.equal(pv.excluded.conflictsSkipped >= 1, true);
    assert.equal((await execute(h, f, 'alice', { archiveId: id1, mode: 'merge', expectedEtag: pv.expectedEtag })).status, 200);
    const txns = (await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: f.joint.id } })).body.transactions;
    assert.deepEqual(txns.map((t) => t.id).sort(), [extra.id, f.grocery.id].sort());
    assert.equal(txns.find((t) => t.id === f.grocery.id).notes, 'edited after', 'conflict kept current version');
  });

  test('create-new by a member contains only their own private records; no grants, sole owner', async () => {
    const h = harness();
    const f = await household(h);
    await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: f.memberId('Alice'), capabilities: ['view-transactions'] } });
    const id = await backupNow(h, f);
    const pv = (await preview(h, f, 'bob', id, 'create-new')).body;
    assert.equal(pv.scope.accounts, 1);
    assert.equal(pv.excluded.archivedAccessIgnored, true);
    const res = await execute(h, f, 'bob', { archiveId: id, mode: 'create-new' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const nq = { workspaceId: res.body.workspace.id };
    assert.deepEqual((await h.call('accounts', 'GET', { as: 'bob', query: nq })).body.accounts.map((a) => a.name), ['Bob Card']);
    assert.equal((await h.call('members', 'GET', { as: 'bob', query: nq })).body.members.length, 1);
    assert.equal((await h.call('accounts', 'GET', { as: 'alice', query: nq })).status, 404, 'no archived access carried over');
    const stored = (await h.storage.getJson(`workspaces/${nq.workspaceId}/workspace.json`)).value;
    assert.deepEqual(stored.grants, []);
    assert.ok(!JSON.stringify(stored).includes('Fictional Grocer'), 'no other records copied');
  });
});

describe('BT-002 isolated operator drill', () => {
  test('restores into an empty isolated directory, verifies balances and reports no financial values', async () => {
    const h = harness();
    const f = await household(h);
    const bytes = await archiveBytes(h, f, await backupNow(h, f));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-drill-'));
    try {
      const report = await runDrill({ archiveBytes: bytes, env: h.env, workspaceId: f.ws.id, targetDir: dir });
      assert.equal(report.result, 'passed');
      assert.ok(report.checks.every((c) => c.ok));
      assert.equal(report.counts.accounts, 3);
      assert.equal(typeof report.durationsMs.total, 'number');
      const text = JSON.stringify(report);
      for (const hidden of ['Secret Jeweller', 'alice@example.com', '-25000', 'Fictional']) assert.equal(text.includes(hidden), false, hidden);
      await assert.rejects(() => runDrill({ archiveBytes: bytes, env: h.env, workspaceId: f.ws.id, targetDir: dir }), /empty directory/);
      await assert.rejects(() => runDrill({ archiveBytes: bytes, env: h.env, workspaceId: 'ws_wrong0000', targetDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bt-drill-')) }), /Drill check failed|workspace/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('backups are refused when backup storage is not configured separately', async () => {
    const { backupStorageFor, _resetStorage } = require('../_shared/runtime');
    _resetStorage();
    assert.throws(() => backupStorageFor({ BT_BACKUP_STORAGE: 'blob', BT_BACKUP_CONTAINER: 'data', BT_DATA_CONTAINER: 'data', BT_BACKUP_CONNECTION_STRING: 'x', BT_STORAGE_CONNECTION_STRING: 'x' }), /separate/);
    _resetStorage();
    assert.throws(() => backupStorageFor({ BT_BACKUP_STORAGE: 'file', BT_LOCAL_DEV: '1', BT_BACKUP_DIR: 'same', BT_FILE_STORAGE_DIR: 'same' }), /own directory/);
    _resetStorage();
    assert.throws(() => backupStorageFor({}), /not configured/);
    _resetStorage();
    void createMemoryStorage; void DAY;
  });
});
