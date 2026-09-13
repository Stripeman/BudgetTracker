'use strict';
// Regression tests for the independent security review of the bills, budgets, forecast and merchant
// surfaces (SEC-B1 … SEC-B12, docs/reviews/2026-09-13-security-review-bills-merchants.md), plus the
// non-destructive bill skip/resume records (BT-001-05). All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household, merchant } = require('./helpers');
const schedule = require('../_shared/schedule');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const monthly = (startDate) => ({ freq: 'monthly', startDate });
const bill = (h, q, as, body) => h.call('recurring', 'POST', { as, query: q, body });
const act = (h, q, as, action, body) => h.call('recurring', 'POST', { as, query: { ...q, action }, body });
const rawDoc = async (h, wsId) => JSON.parse((await h.storage.getBytes(`workspaces/${wsId}/workspace.json`)).bytes.toString());
async function replaceRestore(h, f, archiveId) {
  const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace' } }));
  return h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' } });
}

describe('SEC-B1 restores and bills never leave dangling references', () => {
  test('a replace restore keeps categories created after the backup; recording and later backups still work', async () => {
    const h = harness();
    const f = await household(h);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    const vet = ok(await h.call('categories', 'POST', { as: 'alice', query: f.q, body: { name: 'Vet bills' } }), 201).category;
    const b = ok(await bill(h, f.q, 'bob', { name: 'Vet plan', accountId: f.bobCard.id, amount: '20.00', schedule: monthly('2026-09-20'), categoryId: vet.id }), 201).recurring;
    ok(await replaceRestore(h, f, archiveId));
    assert.ok(ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories.some((c) => c.id === vet.id), 'the category is kept');
    ok(await act(h, f.q, 'bob', 'record', { recurringId: b.id, occurrence: '2026-09-20' }), 201);
    ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
  });

  test('a create-new restore carries the merchants that carried bills use', async () => {
    const h = harness();
    const f = await household(h);
    ok(await bill(h, f.q, 'bob', { name: 'Groceries box', accountId: f.bobCard.id, amount: '30.00', schedule: monthly('2026-09-22'), payeeId: f.merchants.grocer.id }), 201);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    const created = ok(await h.call('restore', 'POST', { as: 'bob', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }), 201);
    const nq = { workspaceId: created.workspace.id };
    assert.equal(ok(await h.call('recurring', 'GET', { as: 'bob', query: nq })).recurring[0].payeeName, 'Fictional Grocer');
    ok(await h.call('backups', 'POST', { as: 'bob', query: nq, body: {} }), 201);
  });
});

describe('SEC-B2 the forecast never reveals another member\'s private bill', () => {
  test('a private transfer into a shared account does not appear in a viewer\'s forecast', async () => {
    const h = harness();
    const f = await household(h);
    const bobChecking = ok(await h.call('accounts', 'POST', { as: 'bob', query: f.q, body: { name: 'Bob Checking', type: 'checking', currency: 'EUR' } }), 201).account;
    ok(await bill(h, f.q, 'bob', { name: 'Top up', kind: 'transfer', accountId: bobChecking.id, toAccountId: f.joint.id, amount: '123.45', schedule: monthly('2026-09-20') }), 201);
    const joint = ok(await h.call('forecast', 'GET', { as: 'carol', query: { ...f.q, horizon: '90' } })).forecast.accounts.find((a) => a.name === 'Joint');
    assert.deepEqual([joint.events, joint.expected.end], [0, '917.60']);
  });
});

describe('SEC-B3 and SEC-B4 bills cannot break or stall shared views', () => {
  test('an absurd bill amount is refused and every shared view still loads', async () => {
    const h = harness();
    const f = await household(h);
    code(await bill(h, f.q, 'bob', { name: 'Huge', accountId: f.joint.id, amount: '10000000000000.00', schedule: { freq: 'weekly', startDate: '2026-09-14' } }), 400, 'amount_too_large');
    for (const route of ['recurring', 'forecast', 'budgets']) ok(await h.call(route, 'GET', { as: 'carol', query: f.q }));
  });

  test('dates outside 1900–2200 are refused, and schedules jump straight to the range asked for', async () => {
    const h = harness();
    const f = await household(h);
    code(await bill(h, f.q, 'bob', { name: 'Ancient', accountId: f.joint.id, amount: '1.00', schedule: { freq: 'weekly', startDate: '1100-01-01' } }), 400, 'invalid_date');
    code(await h.call('budgets', 'GET', { as: 'carol', query: { ...f.q, date: '9999-12-01' } }), 400, 'invalid_date');
    const cats = Object.fromEntries(ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories.map((c) => [c.name, c.id]));
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Food', scope: 'shared', startDate: '2026-01-01', lines: [{ categoryId: cats.Groceries, amount: '100.00' }] } }), 201);
    for (let i = 0; i < 5; i += 1) ok(await bill(h, f.q, 'bob', { name: `Old ${i}`, accountId: f.joint.id, amount: '1.00', categoryId: cats.Groceries, schedule: { freq: 'weekly', startDate: '1900-01-07' } }), 201);
    const started = Date.now();
    ok(await h.call('budgets', 'GET', { as: 'carol', query: { ...f.q, date: '2200-12-01' } }));
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
    // 1900-01-07 and 2026-09-13 are both Sundays: five weekly dates in the next month.
    const s = schedule.validateSchedule({ freq: 'weekly', startDate: '1900-01-07' });
    assert.deepEqual(schedule.occurrences(s, '2026-09-13', '2026-10-13'), ['2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11']);
    const m = schedule.validateSchedule({ freq: 'monthly', startDate: '1901-01-31' });
    assert.deepEqual(schedule.occurrences(m, '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30'], 'clamping still correct after the jump');
  });
});

describe('SEC-B5 the member quota counts merchants, bills and budgets', () => {
  test('a viewer cannot fill the workspace with private merchants', async () => {
    const h = harness({ env: { BT_MEMBER_QUOTA_BYTES: '4000' } });
    const f = await household(h);
    let refused = null;
    for (let i = 0; i < 40 && !refused; i += 1) {
      const res = await h.call('payees', 'POST', { as: 'carol', query: f.q, body: { name: `Carol shop ${i}`, notes: 'x'.repeat(200) } });
      if (res.status !== 201) refused = res;
    }
    assert.ok(refused, 'the quota refused a merchant');
    code(refused, 409, 'member_quota_exceeded');
    ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '1.00' } }), 201);
  });
});

describe('SEC-B6 and SEC-B7 bill payments stay single and bills follow their account', () => {
  test('restoring a deleted payment is refused once the same occurrence was recorded again', async () => {
    const h = harness();
    const f = await household(h);
    const b = ok(await bill(h, f.q, 'alice', { name: 'Rent', accountId: f.joint.id, amount: '800.00', schedule: monthly('2026-09-01') }), 201).recurring;
    const first = ok(await act(h, f.q, 'alice', 'record', { recurringId: b.id, occurrence: '2026-09-01' }), 201).transactions[0];
    ok(await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: first.id, revision: first.revision } }));
    ok(await act(h, f.q, 'alice', 'record', { recurringId: b.id, occurrence: '2026-09-01' }), 201);
    code(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'restore' }, body: { transactionId: first.id } }), 409, 'already_recorded');
  });

  test('bills on a deleted account are no longer listed or recordable', async () => {
    const h = harness();
    const f = await household(h);
    const b = ok(await bill(h, f.q, 'alice', { name: 'Rent', accountId: f.joint.id, amount: '800.00', schedule: monthly('2026-10-01') }), 201).recurring;
    ok(await h.call('accounts', 'DELETE', { as: 'alice', query: f.q, body: { accountId: f.joint.id } }));
    assert.equal((await act(h, f.q, 'bob', 'record', { recurringId: b.id, occurrence: '2026-10-01' })).status, 404);
    assert.deepEqual(ok(await h.call('recurring', 'GET', { as: 'carol', query: f.q })).recurring, []);
  });
});

describe('SEC-B8 to SEC-B12 name-only merchants, budget counts, grants, sharing, destinations', () => {
  test('aliases of a merchant seen only by name are neither shown nor searchable', async () => {
    const h = harness();
    const f = await household(h);
    ok(await h.call('payees', 'PATCH', { as: 'bob', query: f.q, body: { payeeId: f.merchants.jeweller.id, revision: 1, aliases: ['Engagement ring for Carol'] } }));
    ok(await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: f.memberId('Alice'), capabilities: ['view-transactions'] } }), 201);
    const options = ok(await h.call('people', 'GET', { as: 'alice', query: { ...f.q, field: 'payee' } })).options;
    assert.ok(!JSON.stringify(options).includes('Engagement'));
    assert.equal(ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, q: 'engagement ring' } })).total, 0);
  });

  test('a private budget counts only accounts in its own scope', async () => {
    const h = harness();
    const f = await household(h);
    const cats = Object.fromEntries(ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories.map((c) => [c.name, c.id]));
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Mine', scope: 'private', currency: 'EUR', lines: [{ categoryId: cats.Groceries, amount: '50.00' }] } }), 201);
    ok(await h.call('accounts', 'POST', { as: 'bob', query: f.q, body: { name: 'Bob Dollars', type: 'cash', currency: 'USD' } }), 201);
    assert.equal(ok(await h.call('budgets', 'GET', { as: 'alice', query: f.q })).budgets[0].status.excludedCurrencyAccounts, 0);
  });

  test('a merchant created through a grant cannot be used after the grant is revoked', async () => {
    const h = harness();
    const f = await household(h);
    const aliceChecking = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Alice Checking', type: 'checking', currency: 'EUR' } }), 201).account;
    const g1 = ok(await h.call('grants', 'POST', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, memberId: f.memberId('Bob'), capabilities: ['create'] } }), 201).grant;
    ok(await h.call('grants', 'POST', { as: 'alice', query: f.q, body: { accountId: aliceChecking.id, memberId: f.memberId('Bob'), capabilities: ['create'] } }), 201);
    const pharmacy = ok(await h.call('payees', 'POST', { as: 'bob', query: f.q, body: { name: 'Pharmacy', accountId: f.aliceSavings.id } }), 201).payee;
    ok(await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.aliceSavings.id, kind: 'expense', amount: '9.00', payeeId: pharmacy.id } }), 201);
    ok(await h.call('grants', 'DELETE', { as: 'alice', query: f.q, body: { grantId: g1.id } }));
    code(await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: aliceChecking.id, kind: 'expense', amount: '9.00', payeeId: pharmacy.id } }), 400, 'invalid_payee');
  });

  test('sharing a private merchant does not publish its earlier history or account ids', async () => {
    const h = harness();
    const f = await household(h);
    const m = await merchant(h, f.q, 'alice', { name: 'Clinic', notes: 'my private medical note', defaultAccountId: f.aliceSavings.id });
    const v2 = ok(await h.call('payees', 'PATCH', { as: 'alice', query: f.q, body: { payeeId: m.id, revision: 1, notes: 'neutral' } })).payee;
    ok(await h.call('payees', 'PATCH', { as: 'alice', query: f.q, body: { payeeId: m.id, revision: v2.revision, visibility: 'shared' } }));
    const seen = ok(await h.call('payees', 'GET', { as: 'carol', query: f.q })).payees.find((p) => p.id === m.id);
    const text = JSON.stringify(seen);
    assert.ok(!text.includes('medical'), 'no earlier private values');
    assert.ok(!text.includes(f.aliceSavings.id), 'no private account id');
  });

  test('a private transfer destination is not identified, and permission is checked before existence', async () => {
    const h = harness();
    const f = await household(h);
    const b = ok(await bill(h, f.q, 'alice', { name: 'Save', kind: 'transfer', accountId: f.joint.id, toAccountId: f.aliceSavings.id, amount: '50.00', schedule: monthly('2026-09-25') }), 201).recurring;
    const seen = ok(await h.call('recurring', 'GET', { as: 'carol', query: f.q })).recurring.find((x) => x.id === b.id);
    assert.deepEqual([seen.toAccountId, seen.toAccountName], [null, 'Another member\'s account']);
    assert.equal((await act(h, f.q, 'bob', 'record', { recurringId: b.id, occurrence: '2026-09-25' })).status, 403);
  });
});

describe('BT-001-05 bill skips and pauses are never removed', () => {
  test('undoing a skip keeps the skip record; resuming keeps the pause record', async () => {
    const h = harness();
    const f = await household(h);
    const b = ok(await bill(h, f.q, 'alice', { name: 'Gym', accountId: f.aliceSavings.id, amount: '30.00', schedule: monthly('2026-09-15') }), 201).recurring;
    ok(await act(h, f.q, 'alice', 'skip', { recurringId: b.id, occurrence: '2026-10-15', reason: 'Holiday' }));
    ok(await act(h, f.q, 'alice', 'unskip', { recurringId: b.id, occurrence: '2026-10-15' }));
    ok(await act(h, f.q, 'alice', 'pause', { recurringId: b.id, from: '2026-11-01', until: '2027-01-31' }));
    ok(await act(h, f.q, 'alice', 'resume', { recurringId: b.id, date: '2026-12-01' }));
    const stored = (await rawDoc(h, f.ws.id)).recurring.find((x) => x.id === b.id);
    assert.equal(stored.skips.length, 1);
    assert.equal(stored.skips[0].reason, 'Holiday');
    assert.ok(stored.skips[0].withdrawnAt, 'withdrawn, not removed');
    assert.deepEqual([stored.pauses[0].from, stored.pauses[0].until], ['2026-11-01', '2027-01-31'], 'the pause record is unchanged');
    assert.equal(stored.resumes.length, 1);
  });
});
