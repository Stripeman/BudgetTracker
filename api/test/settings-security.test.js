'use strict';
// Independent security review of eefd115 (workspace settings): M-1, L-1, L-2, L-3 and I-2. Expected
// values are written out here by hand. Fictional data only.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');
const { createMemoryStorage } = require('../_shared/storage');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const docPath = (id) => `workspaces/${id}/workspace.json`;
const readDoc = async (h, id) => (await h.storage.getJson(docPath(id))).value;
const setSettings = (h, as, id, settings) => h.call('workspaces', 'PATCH', { as, query: { id }, body: { settings } });

// ---- M-1: a transfer bill moves money INTO its destination account ---------------------------------
// Fixture: Alice (owner) has the shared Joint and her private Alice Savings; Bob is a member, Carol a
// viewer. The bill moves 200.00 a month from the Joint into Alice Savings, from 2026-09-20.
async function transferBill(h, f, toAccountId, name = 'Fictional savings transfer') {
  return ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: {
    name, kind: 'transfer', accountId: f.joint.id, toAccountId, amount: '200.00', schedule: { freq: 'monthly', interval: 1, startDate: '2026-09-20' },
  } }), 201).recurring;
}
const listed = async (h, f, as, id) => ok(await h.call('recurring', 'GET', { as, query: f.q })).recurring.find((r) => r.id === id);
const billAttempts = async (h, f, as, bill) => ({
  edit: (await h.call('recurring', 'PATCH', { as, query: f.q, body: { recurringId: bill.id, revision: bill.revision, amount: '5000.00', effectiveFrom: '2026-09-20' } })).status,
  rename: (await h.call('recurring', 'PATCH', { as, query: f.q, body: { recurringId: bill.id, revision: bill.revision, name: 'Renamed' } })).status,
  skip: (await h.call('recurring', 'POST', { as, query: { ...f.q, action: 'skip' }, body: { recurringId: bill.id, occurrence: '2026-09-20' } })).status,
  pause: (await h.call('recurring', 'POST', { as, query: { ...f.q, action: 'pause' }, body: { recurringId: bill.id, from: '2026-09-20' } })).status,
  end: (await h.call('recurring', 'DELETE', { as, query: f.q, body: { recurringId: bill.id, revision: bill.revision } })).status,
});
const REFUSED = { edit: 403, rename: 403, skip: 403, pause: 403, end: 403 };

describe('M-1: a transfer bill into a private account is changed only by people who may change that account', () => {
  test('a member under "Any entry" is refused every change and is offered none; nothing changes', async () => {
    const h = harness();
    const f = await household(h);
    const bill = await transferBill(h, f, f.aliceSavings.id);
    ok(await setSettings(h, 'alice', f.ws.id, { memberEditsOthers: 'any' }));
    const seen = await listed(h, f, 'bob', bill.id);
    assert.deepEqual([seen.canEdit, seen.canDelete], [false, false]);
    assert.deepEqual(await billAttempts(h, f, 'bob', seen), REFUSED);
    const stored = (await readDoc(h, f.ws.id)).recurring.find((r) => r.id === bill.id);
    assert.deepEqual([stored.versions.length, stored.versions[0].amountMinor, (stored.skips || []).length, (stored.pauses || []).length, stored.deletedAt, stored.name],
      [1, 20000, 0, 0, null, 'Fictional savings transfer']);
  });

  test('a manager is refused too (a workspace role never reaches another member\'s private account); Alice keeps full control', async () => {
    const h = harness();
    const f = await household(h);
    const bill = await transferBill(h, f, f.aliceSavings.id);
    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.memberId('Carol'), role: 'manager' } }));
    const seen = await listed(h, f, 'carol', bill.id);
    assert.deepEqual([seen.canEdit, seen.canDelete], [false, false]);
    assert.deepEqual(await billAttempts(h, f, 'carol', seen), REFUSED);
    const mine = await listed(h, f, 'alice', bill.id);
    assert.deepEqual([mine.canEdit, mine.canDelete], [true, true]);
    assert.equal(ok(await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: bill.id, revision: mine.revision, name: 'Alice renamed it' } })).recurring.name, 'Alice renamed it');
    ok(await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'pause' }, body: { recurringId: bill.id, from: '2026-10-20' } }));
  });

  test('a transfer bill between two shared accounts still follows the setting', async () => {
    const h = harness();
    const f = await household(h);
    const joint2 = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Fictional Joint Savings', type: 'savings', currency: 'EUR', visibility: 'shared' } }), 201).account;
    const bill = await transferBill(h, f, joint2.id, 'Fictional shared transfer');
    assert.equal((await listed(h, f, 'bob', bill.id)).canEdit, false, 'default: only their own');
    ok(await setSettings(h, 'alice', f.ws.id, { memberEditsOthers: 'any' }));
    const seen = await listed(h, f, 'bob', bill.id);
    assert.deepEqual([seen.canEdit, seen.canDelete], [true, true]);
    assert.equal(ok(await h.call('recurring', 'PATCH', { as: 'bob', query: f.q, body: { recurringId: bill.id, revision: seen.revision, name: 'Bob renamed it' } })).recurring.name, 'Bob renamed it');
  });
});

// ---- L-1: backups are as tolerant as reads (a later version's values after a rollback) ----------------
async function editDoc(h, id, fn) {
  const { value } = await h.storage.getJson(docPath(id));
  fn(value);
  await h.storage.putJson(docPath(id), value);
}
const valuesOf = async (h, id) => ok(await h.call('workspaces', 'GET', { as: 'alice', query: { id } })).workspace.settingValues;
const backupStatus = async (h, id) => (await h.call('backups', 'POST', { as: 'alice', query: { workspaceId: id }, body: {} })).status;

describe('L-1: a well-typed value this version does not know reads as its default and never stops a backup or a restore', () => {
  test('unknown values of the right shape: read as the defaults; backup and a replace preview go ahead', async () => {
    const h = harness();
    const f = await household(h);
    const id = f.ws.id;
    await editDoc(h, id, (doc) => Object.assign(doc.settings, {
      weekStart: 3, memberEditsOthers: 'everyone', billReminderDays: 999, sharedExpenses: 'maybe', memberRestoreModes: ['merge', 'teleport'],
      futureSetting: { anything: 'left by a later version' },
    }));
    const v = await valuesOf(h, id);
    assert.deepEqual([v.weekStart, v.memberEditsOthers, v.billReminderDays, v.sharedExpenses, v.memberRestoreModes], [1, 'own', 3, true, ['create-new', 'merge', 'restore-deleted', 'replace']]);
    assert.equal(await backupStatus(h, id), 201);
    h.clock.advance(60000);
    const archiveId = ok(await h.call('backups', 'GET', { as: 'alice', query: f.q })).archives[0].archiveId;
    assert.equal((await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: id, archiveId, mode: 'replace' } })).status, 200);
  });

  test('broken structure is still refused: settings that are not an object, an object or list where one value belongs, a set that is not a list of values', async () => {
    const cases = [
      ['settings a list', (doc) => { doc.settings = ['not', 'an', 'object']; }],
      ['weekStart an object', (doc) => { doc.settings.weekStart = { n: 1 }; }],
      ['billReminderDays a list', (doc) => { doc.settings.billReminderDays = [3]; }],
      ['memberRestoreModes a word', (doc) => { doc.settings.memberRestoreModes = 'merge'; }],
      ['memberRestoreModes holding an object', (doc) => { doc.settings.memberRestoreModes = ['merge', { x: 1 }]; }],
    ];
    for (const [label, change] of cases) {
      const h = harness();
      const f = await household(h);
      await editDoc(h, f.ws.id, change);
      assert.equal(await backupStatus(h, f.ws.id), 422, label);
    }
  });
});

// ---- L-2: Shared expenses switched off between the gate's read and the write -----------------------
// Storage that turns Shared expenses off right after the next read of the workspace (the gate's read), as
// an owner's switch-off landing between the gate and the write would.
function switchOffAfterNextRead() {
  const base = createMemoryStorage();
  let armed = null;
  const storage = { ...base, async getJson(name) {
    const r = await base.getJson(name);
    if (armed && name === armed) {
      armed = null;
      const v = structuredClone(r.value);
      v.settings.sharedExpenses = false;
      await base.putJson(name, v);
    }
    return r;
  } };
  return { storage, arm: (name) => { armed = name; } };
}

describe('L-2: a group write re-checks Shared expenses in the same write', () => {
  test('an expense, a payment report and a settings change that meet Shared expenses off at the write are refused, and nothing is written', async () => {
    const attempts = {
      expense: (f, A, B) => ({ query: f.q, body: { description: 'Fictional race', amount: '10.00', payers: [{ ref: A }], split: { method: 'equal', lines: [{ ref: A }, { ref: B }] } } }),
      settle: (f, A, B) => ({ query: { ...f.q, action: 'settle' }, body: { from: B, to: A, amount: '5.00' } }),
      settings: (f) => ({ query: { ...f.q, action: 'settings' }, body: { changes: { anyoneConfirms: false } } }),
    };
    for (const [label, make] of Object.entries(attempts)) {
      const { storage, arm } = switchOffAfterNextRead();
      const h = harness({ storage });
      const f = await household(h);
      const [A, B] = [`member:${f.memberId('Alice')}`, `member:${f.memberId('Bob')}`];
      const before = await readDoc(h, f.ws.id);
      arm(docPath(f.ws.id));
      const res = await h.call('group', 'POST', { as: 'alice', ...make(f, A, B) });
      assert.deepEqual([res.status, res.body.error && res.body.error.code], [403, 'shared_expenses_off'], label);
      const after = await readDoc(h, f.ws.id);
      assert.deepEqual([(after.groupExpenses || []).length, (after.groupSettlements || []).length, JSON.stringify(after.groupSettings || null), after.settings.sharedExpenses],
        [(before.groupExpenses || []).length, (before.groupSettlements || []).length, JSON.stringify(before.groupSettings || null), false], label);
    }
  });
});
