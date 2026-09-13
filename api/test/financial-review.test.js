'use strict';
// Financial-accuracy review before the first Production release (findings FIN-R1..R16; FIN-R10 is
// deferred). Every expected value is computed by hand in the comment beside it. The harness clock
// is 2026-09-13 and the household fixture's Joint account stands at 917.60 EUR (1000.00 − 82.40,
// the uncategorized grocery entry of 11 Sep).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');
const ledger = require('../_shared/ledger');
const money = require('../_shared/money');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const cats = async (h, q) => Object.fromEntries(ok(await h.call('categories', 'GET', { as: 'alice', query: q })).categories.map((c) => [c.name, c.id]));
const balance = async (h, q, name, as = 'alice') => ok(await h.call('accounts', 'GET', { as, query: q })).accounts.find((a) => a.name === name).balance;
const gross = async (h, q, accountId) => ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...q, accountId } })).summary[0].gross;
const txn = async (h, q, body, as = 'alice') => ok(await h.call('transactions', 'POST', { as, query: q, body }), 201).transactions[0];
const reverse = async (h, q, id, body = {}) => ok(await h.call('transactions', 'POST', { as: 'alice', query: { ...q, action: 'reverse' }, body: { transactionId: id, reason: 'Wrong amount', ...body } }), 201).transactions;
const patch = (h, q, body, as = 'alice') => h.call('transactions', 'PATCH', { as, query: q, body });
const backupOk = async (h, q) => ok(await h.call('backups', 'POST', { as: 'alice', query: q, body: {} }), 201);
const all = async (h, q) => ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...q, includeDeleted: '1' } })).transactions;
const bill = (h, q, body, as = 'alice') => h.call('recurring', 'POST', { as, query: q, body });
const billAct = (h, q, action, body, as = 'alice') => h.call('recurring', 'POST', { as, query: { ...q, action }, body });
const budgetLine = async (h, q, extra = {}) => ok(await h.call('budgets', 'GET', { as: 'alice', query: { ...q, ...extra } })).budgets[0].status.lines[0];
const forecastOf = async (h, q, name, as = 'alice') => ok(await h.call('forecast', 'GET', { as, query: { ...q, horizon: '30' } })).forecast.accounts.find((a) => a.name === name);
const billsSummary = async (h, q, as = 'alice') => ok(await h.call('recurring', 'GET', { as, query: q })).summary;

describe('FIN-R1 a live reversal pair keeps its financial fields', () => {
  test('amount, kind, category, merchant, date and splits are locked on both halves; notes, tags and status stay editable and every backup succeeds', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    // Joint 917.60 − 100.00 = 817.60; the reversal adds 100.00 back → 917.60.
    const e = await txn(h, f.q, { accountId: f.joint.id, kind: 'expense', amount: '100.00', date: '2026-09-12', categoryId: c.Groceries });
    const [original, reversal] = await reverse(h, f.q, e.id);
    assert.equal(await balance(h, f.q, 'Joint'), '917.60');
    // Before the fix: editing the original to 150.00 gave Joint 867.60; re-typing the reversal's
    // amount re-signed it to −100.00 (Joint 717.60, gross 282.40) and every backup then failed 422.
    const locked = [
      [original, { amount: '150.00' }], [reversal, { amount: '100.00' }], [reversal, { kind: 'refund' }], [original, { kind: 'fee' }],
      [reversal, { categoryId: c.Utilities }], [original, { categoryId: null }], [reversal, { date: '2026-09-01' }], [original, { postedDate: '2026-09-14' }],
      [reversal, { payeeId: f.merchants.grocer.id }], [original, { splits: [{ categoryId: c.Groceries, amount: '60.00' }, { categoryId: c.Utilities, amount: '40.00' }] }],
      [reversal, { responsibleRef: null }], [original, { original: { amount: '100.00', currency: 'EUR' } }],
    ];
    for (const [t, change] of locked) code(await patch(h, f.q, { transactionId: t.id, revision: t.revision, reason: 'Fix it', ...change }), 409, 'reversal_locked');
    assert.equal(await balance(h, f.q, 'Joint'), '917.60');
    // Gross spending on Joint: 82.40 + 100.00 − 100.00 = 82.40.
    assert.equal(await gross(h, f.q, f.joint.id), '82.40');
    await backupOk(h, f.q);

    let o = ok(await patch(h, f.q, { transactionId: original.id, revision: original.revision, notes: 'Charged twice' })).transactions[0];
    await backupOk(h, f.q);
    let r = ok(await patch(h, f.q, { transactionId: reversal.id, revision: reversal.revision, tags: ['correction'] })).transactions[0];
    await backupOk(h, f.q);
    r = ok(await patch(h, f.q, { transactionId: r.id, revision: r.revision, status: 'cleared' })).transactions[0];
    await backupOk(h, f.q);
    o = ok(await patch(h, f.q, { transactionId: o.id, revision: o.revision, status: 'reconciled' })).transactions[0];
    await backupOk(h, f.q);
    assert.deepEqual([o.notes, o.status, o.amount, r.tags, r.status, r.amount], ['Charged twice', 'reconciled', '-100.00', ['correction'], 'cleared', '100.00']);
    assert.equal(await balance(h, f.q, 'Joint'), '917.60');
  });

  test('entries that are not part of a reversal still accept financial corrections', async () => {
    const h = harness();
    const f = await household(h);
    const edited = ok(await patch(h, f.q, { transactionId: f.grocery.id, revision: 1, amount: '84.20', reason: 'Receipt' })).transactions[0];
    assert.equal(edited.amount, '-84.20');
  });
});

describe('FIN-R2/R3 a reversal and its original share deletion state', () => {
  test('deleting the original deletes its reversal too; restoring either brings both back; backups succeed throughout', async () => {
    const h = harness();
    const f = await household(h);
    const e = await txn(h, f.q, { accountId: f.joint.id, kind: 'expense', amount: '100.00', date: '2026-09-12' });
    const [original, reversal] = await reverse(h, f.q, e.id);
    // Before the fix the reversal stayed live at +100.00: Joint 1017.60 and gross −17.60.
    const del = ok(await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: original.id, revision: original.revision, reason: 'Entered twice' } }));
    assert.deepEqual(del.changed.slice().sort(), [original.id, reversal.id].sort());
    const both = (await all(h, f.q)).filter((t) => t.id === original.id || t.id === reversal.id);
    assert.deepEqual(both.map((t) => Boolean(t.deletedAt)), [true, true]);
    // 1000.00 − 82.40 = 917.60; gross is the grocery entry only.
    assert.equal(await balance(h, f.q, 'Joint'), '917.60');
    assert.equal(await gross(h, f.q, f.joint.id), '82.40');
    await backupOk(h, f.q);

    const restored = ok(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'restore' }, body: { transactionId: reversal.id } }));
    assert.deepEqual(restored.changed.slice().sort(), [original.id, reversal.id].sort());
    assert.equal(await balance(h, f.q, 'Joint'), '917.60');
    await backupOk(h, f.q);
  });

  test('deleting the reversal deletes the pair, so the original is never shown reversed while counted in full', async () => {
    const h = harness();
    const f = await household(h);
    const e = await txn(h, f.q, { accountId: f.joint.id, kind: 'expense', amount: '100.00', date: '2026-09-12' });
    const [, reversal] = await reverse(h, f.q, e.id);
    ok(await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: reversal.id, revision: reversal.revision, reason: 'Reversed by mistake' } }));
    const live = ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: f.joint.id } })).transactions;
    // Before the fix the original stayed live, marked Reversed, and Joint read 817.60.
    assert.equal(live.some((t) => t.id === e.id), false, 'the original left with its reversal');
    assert.equal(await balance(h, f.q, 'Joint'), '917.60');
    code(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'reverse' }, body: { transactionId: e.id, reason: 'again' } }), 409, 'deleted');
    await backupOk(h, f.q);
  });

  test('a pair with a reconciled half cannot be deleted from either side', async () => {
    const h = harness();
    const f = await household(h);
    ok(await patch(h, f.q, { transactionId: f.grocery.id, revision: 1, status: 'reconciled' }));
    const [, reversal] = await reverse(h, f.q, f.grocery.id);
    code(await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: reversal.id, revision: reversal.revision, reason: 'x' } }), 409, 'reconciled_locked');
    assert.equal((await all(h, f.q)).find((t) => t.id === reversal.id).deletedAt, null);
  });
});

describe('FIN-R4 a reversed bill recording reopens the occurrence', () => {
  test('the budget commits the bill again, the forecast keeps the obligation, and the occurrence can be skipped', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    const power = ok(await bill(h, f.q, { name: 'Power', billType: 'utilities', accountId: f.joint.id, amount: '60.00', schedule: { freq: 'monthly', startDate: '2026-09-15' }, categoryId: c.Utilities }), 201).recurring;
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Utilities', scope: 'shared', currency: 'EUR', startDate: '2026-09-01', lines: [{ categoryId: c.Utilities, amount: '100.00' }] } }), 201);
    const recorded = ok(await billAct(h, f.q, 'record', { recurringId: power.id, occurrence: '2026-09-15', amount: '600.00' }), 201).transactions[0];
    await reverse(h, f.q, recorded.id, { reason: 'Typed 600 instead of 60', date: '2026-09-15' });
    // Spent 600.00 − 600.00 = 0.00; owed again 60.00; available 100.00 − 0.00 − 60.00 = 40.00.
    // Before the fix: committed 0.00, available 100.00.
    const line = await budgetLine(h, f.q);
    assert.deepEqual([line.actual, line.committed, line.available], ['0.00', '60.00', '40.00']);
    // Joint 917.60; 15 Sep: −600.00 entry, +600.00 reversal, −60.00 bill still owed → 857.60.
    // Before the fix the obligation was dropped: 917.60.
    assert.equal((await forecastOf(h, f.q, 'Joint')).expected.end, '857.60');
    const view = (await h.call('recurring', 'GET', { as: 'alice', query: f.q })).body.recurring.find((r) => r.id === power.id);
    assert.equal(view.nextDue, '2026-09-15');
    // Before the fix skipping gave 409 already_recorded.
    ok(await billAct(h, f.q, 'skip', { recurringId: power.id, occurrence: '2026-09-15', reason: 'Paid in cash' }));
    const skipped = await budgetLine(h, f.q);
    assert.deepEqual([skipped.committed, skipped.available], ['0.00', '100.00']);
    await backupOk(h, f.q);
  });

  test('the occurrence can be recorded again correctly beside the reversed recording, once, and backups succeed', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    const power = ok(await bill(h, f.q, { name: 'Power', billType: 'utilities', accountId: f.joint.id, amount: '60.00', schedule: { freq: 'monthly', startDate: '2026-09-15' }, categoryId: c.Utilities }), 201).recurring;
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Utilities', scope: 'shared', currency: 'EUR', startDate: '2026-09-01', lines: [{ categoryId: c.Utilities, amount: '100.00' }] } }), 201);
    const wrong = ok(await billAct(h, f.q, 'record', { recurringId: power.id, occurrence: '2026-09-15', amount: '600.00' }), 201).transactions[0];
    await reverse(h, f.q, wrong.id, { reason: 'Typed 600 instead of 60', date: '2026-09-15' });
    ok(await billAct(h, f.q, 'record', { recurringId: power.id, occurrence: '2026-09-15', amount: '60.00' }), 201);
    // Spent 600.00 − 600.00 + 60.00 = 60.00; nothing owed; available 100.00 − 60.00 = 40.00.
    const line = await budgetLine(h, f.q);
    assert.deepEqual([line.actual, line.committed, line.available], ['60.00', '0.00', '40.00']);
    // Joint 917.60 − 600.00 + 600.00 − 60.00 = 857.60.
    assert.equal(await balance(h, f.q, 'Joint'), '857.60');
    await backupOk(h, f.q);
    // The correct recording counts, so a third one is refused.
    code(await billAct(h, f.q, 'record', { recurringId: power.id, occurrence: '2026-09-15', amount: '60.00' }), 409, 'already_recorded');
  });

  test('an unreversed recording still counts once', async () => {
    const h = harness();
    const f = await household(h);
    const power = ok(await bill(h, f.q, { name: 'Power', accountId: f.joint.id, amount: '60.00', schedule: { freq: 'monthly', startDate: '2026-09-15' } }), 201).recurring;
    ok(await billAct(h, f.q, 'record', { recurringId: power.id, occurrence: '2026-09-15' }), 201);
    code(await billAct(h, f.q, 'record', { recurringId: power.id, occurrence: '2026-09-15' }), 409, 'already_recorded');
    code(await billAct(h, f.q, 'skip', { recurringId: power.id, occurrence: '2026-09-15' }), 409, 'already_recorded');
  });
});

describe('FIN-R6/R7 carry-over', () => {
  test('a budget\'s first period carries nothing over from before the budget existed', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    await txn(h, f.q, { accountId: f.joint.id, kind: 'expense', amount: '150.00', date: '2026-08-10', categoryId: c.Groceries });
    const line = ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'New', scope: 'shared', currency: 'EUR', startDate: '2026-09-01', lines: [{ categoryId: c.Groceries, amount: '400.00', rollover: true }] } }), 201).budget.status.lines[0];
    // Before the fix: carry 400.00 − 150.00 = 250.00 and available 650.00.
    assert.deepEqual([line.carry, line.available], ['0.00', '400.00']);
  });

  test('nothing carries across a change of period type', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    for (const d of ['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25']) await txn(h, f.q, { accountId: f.joint.id, kind: 'expense', amount: '90.00', date: d, categoryId: c.Groceries });
    const b = ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'W', scope: 'shared', currency: 'EUR', period: 'weekly', startDate: '2026-07-06', lines: [{ categoryId: c.Groceries, amount: '100.00', rollover: true }] } }), 201).budget;
    const edited = ok(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: b.id, revision: b.revision, period: 'monthly', startDate: '2026-09-01', effectiveFrom: '2026-09-01', confirmBackdate: true, lines: [{ categoryId: c.Groceries, amount: '400.00', rollover: true }] } })).budget;
    assert.deepEqual(edited.status.period, { start: '2026-09-01', end: '2026-09-30' });
    // Before the fix: August (monthly, 360.00 spent) was compared with the weekly 100.00 → −260.00.
    const line = edited.status.lines[0];
    assert.deepEqual([line.carry, line.available], ['0.00', '400.00']);
  });
});

describe('FIN-R8 same-day forecast events follow a data rule, not creation order', () => {
  for (const order of ['rent first', 'salary first']) {
    test(`money in is counted before money out on the same day (${order})`, async () => {
      const h = harness();
      const f = await household(h);
      const tiny = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Tiny', type: 'checking', currency: 'EUR', openingBalance: '200.00' } }), 201).account;
      const rent = { name: 'Rent', billType: 'housing', accountId: tiny.id, amount: '1500.00', schedule: { freq: 'monthly', startDate: '2026-09-25' } };
      const pay = { name: 'Salary', billType: 'income', kind: 'income', accountId: tiny.id, amount: '3000.00', schedule: { freq: 'monthly', startDate: '2026-09-25' } };
      for (const body of order === 'rent first' ? [rent, pay] : [pay, rent]) ok(await bill(h, f.q, body), 201);
      const t = await forecastOf(h, f.q, 'Tiny');
      // 200.00 + 3000.00 − 1500.00 = 1700.00; the lowest point is today's 200.00, and there is no
      // below-zero warning. Before the fix, "rent first" dipped to −1300.00 on 25 Sep with a warning.
      assert.deepEqual(t.expected, { end: '1700.00', lowest: { amount: '200.00', date: '2026-09-13' }, belowBufferFrom: null });
      assert.deepEqual(t.warnings, []);
    });
  }
});

describe('FIN-R9 bills on a closed or removed account', () => {
  test('a closed source account takes its bills out of budgets, forecasts and totals, and the bills say why', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    const save = ok(await bill(h, f.q, { name: 'Save', billType: 'savings', accountId: f.joint.id, toAccountId: f.aliceSavings.id, amount: '200.00', schedule: { freq: 'monthly', startDate: '2026-09-20' } }), 201).recurring;
    const veg = ok(await bill(h, f.q, { name: 'Veg box', accountId: f.joint.id, amount: '25.00', schedule: { freq: 'monthly', startDate: '2026-09-20' }, categoryId: c.Groceries }), 201).recurring;
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'F', scope: 'shared', currency: 'EUR', startDate: '2026-09-01', lines: [{ categoryId: c.Groceries, amount: '400.00' }] } }), 201);
    assert.equal((await budgetLine(h, f.q)).committed, '25.00');
    ok(await h.call('accounts', 'POST', { as: 'alice', query: { ...f.q, action: 'close' }, body: { accountId: f.joint.id, revision: f.joint.revision, reason: 'Moved banks' } }));
    // Before the fix: committed stayed 25.00, Alice Savings was forecast at 5200.00 and the next 30
    // days showed 225.00 going out, although recording either bill is refused (account_closed).
    assert.equal((await budgetLine(h, f.q)).committed, '0.00');
    assert.equal((await forecastOf(h, f.q, 'Alice Savings')).expected.end, '5000.00');
    const list = ok(await h.call('recurring', 'GET', { as: 'alice', query: f.q }));
    assert.deepEqual(list.summary.next30Days, []);
    for (const id of [save.id, veg.id]) {
      const v = list.recurring.find((r) => r.id === id);
      assert.deepEqual([v.inactiveReason, v.nextDue, v.upcoming, v.overdue, v.reminders], ['account_closed', null, [], [], []]);
    }
    code(await billAct(h, f.q, 'record', { recurringId: veg.id, occurrence: '2026-09-20' }), 409, 'account_closed');
  });

  test('a closed destination takes a transfer bill out of the source account\'s forecast', async () => {
    const h = harness();
    const f = await household(h);
    const save = ok(await bill(h, f.q, { name: 'Save', billType: 'savings', accountId: f.joint.id, toAccountId: f.aliceSavings.id, amount: '200.00', schedule: { freq: 'monthly', startDate: '2026-09-20' } }), 201).recurring;
    ok(await bill(h, f.q, { name: 'Veg box', accountId: f.joint.id, amount: '25.00', schedule: { freq: 'monthly', startDate: '2026-09-20' } }), 201);
    ok(await h.call('accounts', 'POST', { as: 'alice', query: { ...f.q, action: 'close' }, body: { accountId: f.aliceSavings.id, revision: f.aliceSavings.revision, reason: 'Closed' } }));
    // 917.60 − 25.00 = 892.60. Before the fix the transfer still left Joint: 692.60.
    assert.equal((await forecastOf(h, f.q, 'Joint')).expected.end, '892.60');
    const list = ok(await h.call('recurring', 'GET', { as: 'alice', query: f.q }));
    assert.equal(list.recurring.find((r) => r.id === save.id).inactiveReason, 'destination_closed');
    assert.deepEqual(list.summary.next30Days, [{ currency: 'EUR', outgoing: '25.00', incoming: '0.00', transfers: '0.00' }]);
  });
});

describe('FIN-R11/R12 bills summary', () => {
  test('transfers between accounts the viewer sees are reported apart from money in and out', async () => {
    const h = harness();
    const f = await household(h);
    const card = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Alice Card', type: 'credit-card', currency: 'EUR' } }), 201).account;
    ok(await bill(h, f.q, { name: 'Card payment', billType: 'debt-payment', accountId: f.aliceSavings.id, toAccountId: card.id, amount: '500.00', schedule: { freq: 'monthly', startDate: '2026-09-28' } }), 201);
    // Before the fix: outgoing 500.00, incoming 0.00 — a movement between Alice's own accounts.
    assert.deepEqual((await billsSummary(h, f.q)).next30Days, [{ currency: 'EUR', outgoing: '0.00', incoming: '0.00', transfers: '500.00' }]);
  });

  test('a transfer into an account the viewer cannot see counts as money out for them only', async () => {
    const h = harness();
    const f = await household(h);
    ok(await bill(h, f.q, { name: 'Card top-up', billType: 'debt-payment', accountId: f.joint.id, toAccountId: f.bobCard.id, amount: '60.00', schedule: { freq: 'monthly', startDate: '2026-09-28' } }, 'bob'), 201);
    assert.deepEqual((await billsSummary(h, f.q, 'alice')).next30Days, [{ currency: 'EUR', outgoing: '60.00', incoming: '0.00', transfers: '0.00' }]);
    assert.deepEqual((await billsSummary(h, f.q, 'bob')).next30Days, [{ currency: 'EUR', outgoing: '0.00', incoming: '0.00', transfers: '60.00' }]);
  });

  test('the overdue count covers every overdue payment, not just the 24 listed', async () => {
    const h = harness();
    const f = await household(h);
    // Weekly from Monday 5 Jan 2026: 5 Jan + 7k up to 12 Sep is k = 0..35 (7 Sep) → 36 overdue.
    const weekly = ok(await bill(h, f.q, { name: 'Cleaner', accountId: f.joint.id, amount: '10.00', schedule: { freq: 'weekly', startDate: '2026-01-05' }, trackFrom: '2026-01-05' }), 201).recurring;
    const list = ok(await h.call('recurring', 'GET', { as: 'alice', query: f.q }));
    const v = list.recurring.find((r) => r.id === weekly.id);
    assert.equal(v.overdue.length, 24, 'the displayed list stays bounded');
    assert.equal(v.overdue[23], '2026-09-07', 'the most recent are listed');
    assert.equal(v.overdueCount, 36);
    // Before the fix: 24.
    assert.equal(list.summary.overdue, 36);
  });
});

describe('FIN-R13 overdue occurrences from earlier periods', () => {
  test('stay committed in the current period until recorded or skipped', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    const power = ok(await bill(h, f.q, { name: 'Power', accountId: f.joint.id, amount: '60.00', schedule: { freq: 'monthly', startDate: '2026-08-15' }, trackFrom: '2026-08-15', categoryId: c.Utilities }), 201).recurring;
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'U', scope: 'shared', currency: 'EUR', startDate: '2026-08-01', lines: [{ categoryId: c.Utilities, amount: '100.00' }] } }), 201);
    // 15 Aug (overdue) + 15 Sep = 120.00 owed; available 100.00 − 120.00 = −20.00.
    // Before the fix only 15 Sep counted: committed 60.00, available 40.00.
    const line = await budgetLine(h, f.q);
    assert.deepEqual([line.committed, line.available, line.over], ['120.00', '-20.00', true]);
    ok(await billAct(h, f.q, 'skip', { recurringId: power.id, occurrence: '2026-08-15' }));
    assert.equal((await budgetLine(h, f.q)).committed, '60.00');
  });

  test('occurrences before the bill was tracked are not counted', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    ok(await bill(h, f.q, { name: 'Power', accountId: f.joint.id, amount: '60.00', schedule: { freq: 'monthly', startDate: '2026-07-15' }, trackFrom: '2026-09-01', categoryId: c.Utilities }), 201);
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'U', scope: 'shared', currency: 'EUR', startDate: '2026-08-01', lines: [{ categoryId: c.Utilities, amount: '100.00' }] } }), 201);
    assert.equal((await budgetLine(h, f.q)).committed, '60.00');
  });
});

describe('FIN-R14 budget plan dates', () => {
  const stored = async (h, q, id) => JSON.parse((await h.storage.getBytes(`workspaces/${q.workspaceId}/workspace.json`)).bytes.toString()).budgets.find((b) => b.id === id);

  test('a plan change dated before the current period needs explicit confirmation', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    const b = ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Food', scope: 'shared', currency: 'EUR', startDate: '2026-01-01', lines: [{ categoryId: c.Groceries, amount: '400.00' }] } }), 201).budget;
    const lines = [{ categoryId: c.Groceries, amount: '500.00' }];
    // Before the fix any past date was accepted, rewriting finished periods.
    code(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: b.id, revision: 1, lines, effectiveFrom: '2026-08-01' } }), 409, 'backdate_unconfirmed');
    code(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: b.id, revision: 1, lines, effectiveFrom: '2026-08-01', confirmBackdate: 'yes' } }), 400, 'invalid_field');
    assert.equal((await budgetLine(h, f.q, { date: '2026-08-15' })).planned, '400.00');
    const edited = ok(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: b.id, revision: 1, lines, effectiveFrom: '2026-08-01', confirmBackdate: true, reason: 'Missed last month' } })).budget;
    assert.deepEqual(edited.versions.map((v) => [v.effectiveFrom, v.lines[0].amount, v.backdated]), [['2026-01-01', '400.00', false], ['2026-08-01', '500.00', true]]);
    assert.equal((await budgetLine(h, f.q, { date: '2026-08-15' })).planned, '500.00');
    // The current period's start (the default) needs no confirmation.
    ok(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: b.id, revision: edited.revision, lines: [{ categoryId: c.Groceries, amount: '550.00' }], effectiveFrom: '2026-09-01' } }));
  });

  test('the stored top-level plan mirrors the plan in force today, not the last version added', async () => {
    const h = harness();
    const f = await household(h);
    const c = await cats(h, f.q);
    const b = ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Food', scope: 'shared', currency: 'EUR', startDate: '2026-01-01', lines: [{ categoryId: c.Groceries, amount: '400.00' }] } }), 201).budget;
    // A future version (1 Oct, 600.00) does not apply today: the top level stays at 400.00.
    const future = ok(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: b.id, revision: 1, lines: [{ categoryId: c.Groceries, amount: '600.00' }], effectiveFrom: '2026-10-01' } })).budget;
    assert.equal((await stored(h, f.q, b.id)).lines[0].amountMinor, 40000);
    assert.equal(future.lines[0].amount, '400.00');
    // Today's version (1 Sep, 500.00), then a confirmed backdate to 1 Aug (450.00) that never
    // applies today: the top level is 500.00. Before the fix it followed the last version added.
    const now = ok(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: b.id, revision: future.revision, lines: [{ categoryId: c.Groceries, amount: '500.00' }] } })).budget;
    assert.equal((await stored(h, f.q, b.id)).lines[0].amountMinor, 50000);
    ok(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: b.id, revision: now.revision, lines: [{ categoryId: c.Groceries, amount: '450.00' }], effectiveFrom: '2026-08-01', confirmBackdate: true } }));
    assert.equal((await stored(h, f.q, b.id)).lines[0].amountMinor, 50000);
    assert.equal((await budgetLine(h, f.q)).planned, '500.00');
  });
});

describe('FIN-R15/R16 exact running totals and current ISO 4217 codes', () => {
  test('a running balance is exact even when a partial sum passes 2^53', () => {
    // 10 × 1e15 = 1e16 (above 2^53 ≈ 9.007e15, where Numbers are spaced 2 apart), then +1, then
    // −10 × 1e15: the exact result is 1 + the opening 5 = 6. Plain Number addition loses the 1.
    const amounts = [...Array(10).fill(1e15), 1, ...Array(10).fill(-1e15)];
    const doc = { transactions: amounts.map((amountMinor, i) => ({ id: `t${i}`, accountId: 'a1', amountMinor, deletedAt: null })) };
    assert.equal(ledger.balanceOf(doc, { id: 'a1', openingBalanceMinor: 5 }), 6);
  });

  test('XCG, ZWG and VED have two decimals; ANG and ZWL stay readable for history', () => {
    for (const c of ['XCG', 'ZWG', 'VED', 'ANG', 'ZWL']) assert.equal(money.precisionOf(c), 2, c);
    assert.equal(money.parseDecimal('12.34', 'XCG'), 1234);
    assert.throws(() => money.parseDecimal('1.234', 'VED'), /more decimal places/);
    assert.equal(money.toDecimal(-5, 'ZWG'), '-0.05');
  });
});
