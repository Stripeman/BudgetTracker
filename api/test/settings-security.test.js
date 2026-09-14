'use strict';
// Independent security review of eefd115 (workspace settings): M-1, L-1, L-2, L-3 and I-2. Expected
// values are written out here by hand. Fictional data only.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

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
