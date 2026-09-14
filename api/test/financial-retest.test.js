'use strict';
// Financial-accuracy retest of ff5d9c5 before the first Production release (FIN-T1 to FIN-T8).
// Every expected value is worked out by hand in the comment beside it. The harness clock is
// 2026-09-13; the household fixture's Joint account stands at 917.60 EUR (1000.00 - 82.40).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');
const backup = require('../_shared/backup');
const money = require('../_shared/money');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const cats = async (h, q) => Object.fromEntries(ok(await h.call('categories', 'GET', { as: 'alice', query: q })).categories.map((c) => [c.name, c.id]));
const balance = async (h, q, id, as = 'alice') => ok(await h.call('accounts', 'GET', { as, query: q })).accounts.find((a) => a.id === id).balance;
const txn = async (h, q, body, as = 'alice') => ok(await h.call('transactions', 'POST', { as, query: q, body }), 201).transactions[0];
const reverse = async (h, q, id, body = {}) => ok(await h.call('transactions', 'POST', { as: 'alice', query: { ...q, action: 'reverse' }, body: { transactionId: id, reason: 'Wrong amount', ...body } }), 201).transactions;
const backupId = async (h, q) => ok(await h.call('backups', 'POST', { as: 'alice', query: q, body: {} }), 201).archive.archiveId;
const preview = async (h, f, archiveId, mode, as = 'alice') => ok(await h.call('restore', 'POST', { as, query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode } }));
const execute = (h, f, archiveId, mode, expectedEtag, as = 'alice') => h.call('restore', 'POST', { as, query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode, expectedEtag, confirm: 'REPLACE' } });
const billAct = (h, q, action, body, as = 'alice') => h.call('recurring', 'POST', { as, query: { ...q, action }, body });
const budgetLine = async (h, q) => ok(await h.call('budgets', 'GET', { as: 'alice', query: q })).budgets[0].status.lines[0];

describe('FIN-T1 a reversal is never separated from what it reverses', () => {
  test('replace then merge cannot re-attach a reversal to an original that no longer names it', async () => {
    const h = harness();
    const f = await household(h);
    const e = await txn(h, f.q, { accountId: f.joint.id, kind: 'expense', amount: '100.00', date: '2026-09-12' });
    const a0 = await backupId(h, f.q);
    await reverse(h, f.q, e.id);
    const a1 = await backupId(h, f.q);
    // Replace from A0: the original goes back to "not reversed" and the reversal is set aside.
    // Joint 917.60 - 100.00 = 817.60.
    let pv = await preview(h, f, a0, 'replace');
    ok(await execute(h, f, a0, 'replace', pv.expectedEtag));
    assert.equal(await balance(h, f.q, f.joint.id), '817.60');
    // Merging A1 would add the reversal (+100.00) beside an original that does not name it; before
    // the fix this passed every check, and reversing the original again created 100.00 (1017.60).
    pv = await preview(h, f, a1, 'merge');
    assert.equal(pv.canExecute, false);
    assert.match(pv.blockers[0], /reversal link/);
    code(await execute(h, f, a1, 'merge', pv.expectedEtag), 409, 'restore_blocked');
    assert.equal(await balance(h, f.q, f.joint.id), '817.60');
  });

  test('the integrity check requires the original and its reversal to name each other', async () => {
    const h = harness();
    const f = await household(h);
    const e = await txn(h, f.q, { accountId: f.joint.id, kind: 'expense', amount: '100.00', date: '2026-09-12' });
    await reverse(h, f.q, e.id);
    const { value: doc } = await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`);
    assert.doesNotThrow(() => backup.checkInvariants(doc));
    doc.transactions.find((t) => t.id === e.id).reversedBy = null;
    assert.throws(() => backup.checkInvariants(doc), (err) => err.detail === 'reversal link');
  });
});

describe('FIN-T2 backups add each account exactly, whatever the order of its entries', () => {
  test('a running total beyond the range on the way to a valid balance does not block backups', () => {
    const big = Math.floor(money.MAX_MINOR * 0.9);
    const mid = Math.floor(money.MAX_MINOR * 0.6);
    // 0 + 0.9 max + 0.6 max - 0.6 max = 0.9 max: valid, although 1.5 max is passed on the way.
    const doc = { accounts: [{ id: 'acc_fictional01', openingBalanceMinor: 0 }], transactions: [big, mid, -mid].map((amountMinor, i) => ({ id: `txn_fictional0${i}`, accountId: 'acc_fictional01', amountMinor })) };
    assert.equal(backup.balances(doc).get('acc_fictional01'), big);
  });
});

describe('FIN-T3 paying an overdue bill does not change what is available', () => {
  test('an overdue occurrence from an earlier period is recorded today by default', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    const power = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Power', billType: 'utilities', accountId: f.joint.id, amount: '60.00', schedule: { freq: 'monthly', startDate: '2026-08-20' }, categoryId: c.Utilities, trackFrom: '2026-08-01' } }), 201).recurring;
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Utilities', scope: 'shared', currency: 'EUR', startDate: '2026-08-01', confirmBackdate: true, lines: [{ categoryId: c.Utilities, amount: '100.00' }] } }), 201);
    // September: spent 0.00; owed 60.00 (20 Aug, overdue) + 60.00 (20 Sep) = 120.00; available -20.00.
    let line = await budgetLine(h, f.q);
    assert.deepEqual([line.actual, line.committed, line.available], ['0.00', '120.00', '-20.00']);
    const [entry] = ok(await billAct(h, f.q, 'record', { recurringId: power.id, occurrence: '2026-08-20' }), 201).transactions;
    assert.equal(entry.date, '2026-09-13', 'paid today, not back-dated to the due date');
    // Spent 60.00; owed 60.00 (20 Sep); available still -20.00. Before the fix: 40.00.
    line = await budgetLine(h, f.q);
    assert.deepEqual([line.actual, line.committed, line.available], ['60.00', '60.00', '-20.00']);
  });
});

describe('FIN-T4 a reversal nets out in the same period as its original', () => {
  test('it takes the original entry\'s date by default', async () => {
    const h = harness();
    const f = await household(h);
    const e = await txn(h, f.q, { accountId: f.joint.id, kind: 'expense', amount: '600.00', date: '2026-08-15' });
    const [, rev] = await reverse(h, f.q, e.id);
    assert.equal(rev.date, '2026-08-15');
    const [, other] = await reverse(h, f.q, (await txn(h, f.q, { accountId: f.joint.id, kind: 'expense', amount: '5.00', date: '2026-08-16' })).id, { date: '2026-09-01' });
    assert.equal(other.date, '2026-09-01', 'an explicit date is kept');
  });
});

describe('FIN-T5 an account the backup holds outside the caller\'s scope keeps all of its records', () => {
  test('entries added or changed after it was shared stay, so its balance is one it really had', async () => {
    const h = harness();
    const f = await household(h);
    const wallet = ok(await h.call('accounts', 'POST', { as: 'bob', query: f.q, body: { name: 'Bob Wallet', type: 'checking', currency: 'EUR', openingBalance: '300.00' } }), 201).account;
    const w = await txn(h, f.q, { accountId: wallet.id, kind: 'expense', amount: '50.00', date: '2026-09-12' }, 'bob');
    const id = await backupId(h, f.q);
    ok(await h.call('accounts', 'PATCH', { as: 'bob', query: f.q, body: { accountId: wallet.id, revision: 1, visibility: 'shared', confirmShare: true } }));
    ok(await h.call('transactions', 'PATCH', { as: 'bob', query: f.q, body: { transactionId: w.id, revision: w.revision, amount: '55.00', reason: 'Receipt' } }));
    await txn(h, f.q, { accountId: wallet.id, kind: 'expense', amount: '20.00', date: '2026-09-13' });
    await txn(h, f.q, { accountId: f.joint.id, kind: 'expense', amount: '7.00', date: '2026-09-13' });
    // 300.00 - 55.00 - 20.00 = 225.00 before and after. Before the fix: 245.00.
    assert.equal(await balance(h, f.q, wallet.id), '225.00');
    const pv = await preview(h, f, id, 'replace');
    ok(await execute(h, f, id, 'replace', pv.expectedEtag));
    assert.equal(await balance(h, f.q, wallet.id), '225.00');
    // Joint: the 7.00 entry added after the backup is set aside: 917.60.
    assert.equal(await balance(h, f.q, f.joint.id), '917.60');
  });
});

describe('FIN-T6 a new period start day cannot count days twice without confirmation', () => {
  test('moving the start day so the new period begins before the change needs confirmation', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    const b = ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Groceries', scope: 'shared', currency: 'EUR', startDate: '2026-08-01', confirmBackdate: true, lines: [{ categoryId: c.Groceries, amount: '400.00' }] } }), 201).budget;
    // From 1 Sep with the 15th as start day, the period containing 1 Sep is 15 Aug - 14 Sep:
    // 15-31 Aug were already counted in August.
    const change = { budgetId: b.id, revision: b.revision, startDate: '2026-08-15', effectiveFrom: '2026-09-01' };
    code(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: change }), 409, 'backdate_unconfirmed');
    const saved = ok(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { ...change, confirmBackdate: true } })).budget;
    assert.equal(saved.versions[saved.versions.length - 1].backdated, true);
  });
});

describe('FIN-U1 an occurrence from before tracking started keeps its own date', () => {
  test('only tracked, overdue occurrences are recorded today by default', async () => {
    const h = harness();
    const f = await household(h);
    const power = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Power', billType: 'utilities', accountId: f.joint.id, amount: '60.00', schedule: { freq: 'monthly', startDate: '2026-07-15' }, trackFrom: '2026-09-01' } }), 201).recurring;
    const [entry] = ok(await billAct(h, f.q, 'record', { recurringId: power.id, occurrence: '2026-08-15' }), 201).transactions;
    // 15 Aug is before tracking started on 1 Sep, so it was never owed here and is not overdue.
    assert.equal(entry.date, '2026-08-15');
  });
});

describe('FIN-U2 a change of amounts alone needs no confirmation within the current period', () => {
  test('an amount change dated today is saved and applies to the current period', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    const b = ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Groceries', scope: 'shared', currency: 'EUR', startDate: '2026-08-01', confirmBackdate: true, lines: [{ categoryId: c.Groceries, amount: '400.00' }] } }), 201).budget;
    ok(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: b.id, revision: b.revision, lines: [{ categoryId: c.Groceries, amount: '450.00' }], effectiveFrom: '2026-09-13' } }));
    assert.equal((await budgetLine(h, f.q)).planned, '450.00');
  });
});

describe('FIN-T7 restoring a deleted bill payment uses the recording rule', () => {
  test('the correct payment can be restored while the mistaken one stays reversed', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    const power = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Power', billType: 'utilities', accountId: f.joint.id, amount: '60.00', schedule: { freq: 'monthly', startDate: '2026-09-15' }, categoryId: c.Utilities } }), 201).recurring;
    const wrong = ok(await billAct(h, f.q, 'record', { recurringId: power.id, occurrence: '2026-09-15', amount: '600.00' }), 201).transactions[0];
    await reverse(h, f.q, wrong.id);
    const right = ok(await billAct(h, f.q, 'record', { recurringId: power.id, occurrence: '2026-09-15', amount: '60.00' }), 201).transactions[0];
    ok(await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: right.id, revision: right.revision, reason: 'Entered on the wrong day' } }));
    // Before the fix: 409 "recorded again after this entry was deleted", which was not true.
    ok(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'restore' }, body: { transactionId: right.id } }));
    // 917.60 - 600.00 + 600.00 - 60.00 = 857.60.
    assert.equal(await balance(h, f.q, f.joint.id), '857.60');
    await backupId(h, f.q);
  });
});

describe('FIN-T8 closed accounts take no reversals', () => {
  test('reversing an entry on a closed account is refused like any new entry', async () => {
    const h = harness();
    const f = await household(h);
    ok(await h.call('accounts', 'POST', { as: 'alice', query: { ...f.q, action: 'close' }, body: { accountId: f.joint.id, revision: f.joint.revision, reason: 'Moved banks' } }));
    code(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'reverse' }, body: { transactionId: f.grocery.id, reason: 'Wrong amount' } }), 409, 'account_closed');
  });
});
