'use strict';
// BT-008-02 recurring costs and bills. Expected values are computed by hand. The harness clock is
// 2026-09-13; the household fixture's Joint account stands at 917.60 EUR (1000.00 − 82.40).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household, merchant } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const monthly = (startDate) => ({ freq: 'monthly', startDate });
const create = (h, q, as, body) => h.call('recurring', 'POST', { as, query: q, body });
const act = (h, q, as, action, body, headers) => h.call('recurring', 'POST', { as, query: { ...q, action }, body, headers });
const list = async (h, q, as) => ok(await h.call('recurring', 'GET', { as, query: q }));
const find = async (h, q, as, id) => (await list(h, q, as)).recurring.find((r) => r.id === id);
const draft = (h, q, as, recurringId, occurrence) => h.call('recurring', 'GET', { as, query: { ...q, action: 'draft', recurringId, occurrence } });
async function categories(h, q) {
  return Object.fromEntries(ok(await h.call('categories', 'GET', { as: 'alice', query: q })).categories.map((c) => [c.name, c.id]));
}

describe('BT-008-02 bills: data model', () => {
  test('a bill records type, schedule, next due date, amount, account, payee, category, responsible person and notes', async () => {
    const h = harness();
    const f = await household(h);
    const cats = await categories(h, f.q);
    const landlord = await merchant(h, f.q, 'alice', { name: 'Fictional Landlord', visibility: 'shared' });
    const rent = ok(await create(h, f.q, 'alice', {
      name: 'Rent', billType: 'housing', accountId: f.joint.id, amount: '800.00', schedule: monthly('2026-10-01'),
      categoryId: cats.Housing, payeeId: landlord.id, responsibleRef: `member:${f.memberId('Bob')}`, reminderDays: 5, notes: 'Standing order',
    }), 201).recurring;
    assert.equal(rent.nextDue, '2026-10-01');
    assert.deepEqual(rent.upcoming.slice(0, 3), ['2026-10-01', '2026-11-01', '2026-12-01']);
    assert.deepEqual(
      { amount: rent.amount, currency: rent.currency, amountType: rent.amountType, kind: rent.kind, payee: rent.payeeName, category: rent.categoryId, responsible: rent.responsible.label, notes: rent.notes, account: rent.accountName, overdue: rent.overdue },
      { amount: '800.00', currency: 'EUR', amountType: 'fixed', kind: 'expense', payee: 'Fictional Landlord', category: cats.Housing, responsible: 'Bob Fictional', notes: 'Standing order', account: 'Joint', overdue: [] },
    );
    assert.equal(rent.canEdit, true);
    assert.equal(rent.canRecord, true);
    const income = ok(await create(h, f.q, 'alice', { name: 'Salary', billType: 'income', accountId: f.joint.id, amount: '2500.00', schedule: monthly('2026-09-25') }), 201).recurring;
    assert.equal(income.kind, 'income');
  });

  test('invalid bills are refused with a specific reason', async () => {
    const h = harness();
    const f = await household(h);
    const base = { name: 'X', accountId: f.joint.id, amount: '1.00', schedule: monthly('2026-10-01') };
    code(await create(h, f.q, 'alice', { ...base, billType: 'lottery' }), 400, 'invalid_field');
    code(await create(h, f.q, 'alice', { ...base, name: undefined }), 400, 'missing_field');
    code(await create(h, f.q, 'alice', { ...base, amount: '0.00' }), 400, 'invalid_amount');
    code(await create(h, f.q, 'alice', { ...base, createdBy: 'someone-else' }), 400, 'unknown_field');
    code(await create(h, f.q, 'alice', { ...base, tripId: 'trp_nope' }), 400, 'invalid_trip');
    code(await create(h, f.q, 'alice', { ...base, reminderDays: 99 }), 400, 'invalid_field');
    code(await create(h, f.q, 'alice', { ...base, schedule: { freq: 'monthly', startDate: '2026-02-30' } }), 400, 'invalid_date');
  });

  test('loan, debt and savings payments are transfers that record both sides', async () => {
    const h = harness();
    const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Plan', kind: 'personal', reportingCurrency: 'EUR' } }), 201).workspace;
    const q = { workspaceId: ws.id };
    const checking = ok(await h.call('accounts', 'POST', { as: 'alice', query: q, body: { name: 'Checking', type: 'checking', currency: 'EUR', openingBalance: '1000.00' } }), 201).account;
    const savings = ok(await h.call('accounts', 'POST', { as: 'alice', query: q, body: { name: 'Savings', type: 'savings', currency: 'EUR' } }), 201).account;
    const cats = await categories(h, q);
    code(await create(h, q, 'alice', { name: 'Bad', accountId: checking.id, toAccountId: savings.id, amount: '10.00', schedule: monthly('2026-09-20'), categoryId: cats.Housing }), 400, 'invalid_transfer');
    const bill = ok(await create(h, q, 'alice', { name: 'Loan payment', billType: 'debt-payment', accountId: checking.id, toAccountId: savings.id, amount: '250.00', schedule: monthly('2026-09-20') }), 201).recurring;
    assert.equal(bill.kind, 'transfer');
    assert.equal(bill.toAccountName, 'Savings');
    const out = ok(await act(h, q, 'alice', 'record', { recurringId: bill.id, occurrence: '2026-09-20' }), 201);
    assert.deepEqual(out.transactions.map((t) => [t.accountName, t.amount]), [['Checking', '-250.00'], ['Savings', '250.00']]);
  });
});

describe('BT-008-02 bills: review before finalizing', () => {
  test('a generated occurrence can be reviewed and edited before it becomes an entry; the bill is unchanged', async () => {
    const h = harness();
    const f = await household(h);
    const cats = await categories(h, f.q);
    const landlord = await merchant(h, f.q, 'alice', { name: 'Fictional Landlord', visibility: 'shared' });
    const rent = ok(await create(h, f.q, 'alice', { name: 'Rent', billType: 'housing', accountId: f.joint.id, amount: '800.00', schedule: monthly('2026-10-01'), categoryId: cats.Housing, payeeId: landlord.id }), 201).recurring;
    const res = ok(await draft(h, f.q, 'alice', rent.id, '2026-10-01'));
    assert.equal(res.saved, false);
    assert.deepEqual(
      { amount: res.draft.amount, payee: res.draft.payeeName, category: res.draft.categoryId, status: res.draft.status, overdue: res.draft.overdue, estimate: res.draft.amountIsEstimate },
      { amount: '800.00', payee: 'Fictional Landlord', category: cats.Housing, status: 'due', overdue: false, estimate: false },
    );
    const out = ok(await act(h, f.q, 'alice', 'record', { recurringId: rent.id, occurrence: '2026-10-01', amount: '812.50', date: '2026-10-02', categoryId: cats.Utilities, notes: 'Included a late fee' }), 201);
    const t = out.transactions[0];
    assert.deepEqual(
      { amount: t.amount, date: t.date, category: t.categoryId, notes: t.notes, payee: t.payeeName, links: t.links },
      { amount: '-812.50', date: '2026-10-02', category: cats.Utilities, notes: 'Included a late fee', payee: 'Fictional Landlord', links: { recurringId: rent.id, occurrence: '2026-10-01' } },
    );
    const after = await find(h, f.q, 'alice', rent.id);
    assert.equal(after.amount, '800.00', 'recording with edits never changes the bill');
    assert.equal(after.nextDue, '2026-11-01');
    assert.equal(after.recordedCount, 1);
    code(await draft(h, f.q, 'alice', rent.id, '2026-10-01'), 409, 'already_recorded');
  });

  test('a variable bill is forecast as an estimate and needs the actual amount when recorded', async () => {
    const h = harness();
    const f = await household(h);
    const power = ok(await create(h, f.q, 'alice', { name: 'Electricity', billType: 'utilities', accountId: f.joint.id, amount: '90.00', amountType: 'variable', schedule: monthly('2026-09-20') }), 201).recurring;
    assert.equal(ok(await draft(h, f.q, 'alice', power.id, '2026-09-20')).draft.amountIsEstimate, true);
    code(await act(h, f.q, 'alice', 'record', { recurringId: power.id, occurrence: '2026-09-20' }), 400, 'amount_required');
    const fc = ok(await h.call('forecast', 'GET', { as: 'alice', query: { ...f.q, horizon: '30' } })).forecast.accounts.find((a) => a.name === 'Joint');
    // 917.60 − 90.00 estimate (20 Sep); the next one (20 Oct) is past the 13 Oct horizon.
    assert.equal(fc.expected.end, '827.60');
    assert.equal(fc.optimistic.end, '917.60', 'optimistic leaves out estimated expenses');
    assert.equal(ok(await act(h, f.q, 'alice', 'record', { recurringId: power.id, occurrence: '2026-09-20', amount: '104.37' }), 201).transactions[0].amount, '-104.37');
  });

  test('recording is idempotent: a retried request with the same key creates one entry', async () => {
    const h = harness();
    const f = await household(h);
    const rent = ok(await create(h, f.q, 'alice', { name: 'Rent', accountId: f.joint.id, amount: '800.00', schedule: monthly('2026-10-01') }), 201).recurring;
    // Built at runtime: a fictional, low-entropy key (a literal hex string trips secret scanners).
    const headers = { 'idempotency-key': `k-${'ab'.repeat(16)}` };
    const first = ok(await act(h, f.q, 'alice', 'record', { recurringId: rent.id, occurrence: '2026-10-01' }, headers), 201);
    const second = ok(await act(h, f.q, 'alice', 'record', { recurringId: rent.id, occurrence: '2026-10-01' }, headers), 201);
    assert.equal(second.replayed, true);
    assert.deepEqual(second.transactions.map((t) => t.id), first.transactions.map((t) => t.id));
    const all = ok(await h.call('transactions', 'GET', { as: 'alice', query: f.q })).transactions.filter((t) => t.links.recurringId === rent.id);
    assert.equal(all.length, 1);
  });
});

describe('BT-008-02 bills: changes from a date and historical preservation', () => {
  test('changes take effect from a chosen date as new versions and never rewrite recorded entries', async () => {
    const h = harness();
    const f = await household(h);
    const cats = await categories(h, f.q);
    const rent = ok(await create(h, f.q, 'alice', { name: 'Rent', billType: 'housing', accountId: f.joint.id, amount: '800.00', schedule: monthly('2026-08-01'), categoryId: cats.Housing }), 201).recurring;
    const recorded = ok(await act(h, f.q, 'alice', 'record', { recurringId: rent.id, occurrence: '2026-09-01' }), 201).transactions[0];
    const txnNow = async () => ok(await h.call('transactions', 'GET', { as: 'alice', query: f.q })).transactions.find((t) => t.id === recorded.id);
    const before = await txnNow();

    code(await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: rent.id, revision: rent.revision, amount: '850.00' } }), 400, 'missing_field');
    code(await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: rent.id, revision: rent.revision, amount: '850.00', effectiveFrom: '2026-07-01' } }), 400, 'invalid_effective_date');
    const v2 = ok(await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: rent.id, revision: rent.revision, amount: '850.00', effectiveFrom: '2026-11-01' } })).recurring;
    assert.equal(v2.amount, '800.00', 'today the old terms still apply');
    assert.deepEqual(v2.versions.map((v) => [v.effectiveFrom, v.amount]), [['2026-08-01', '800.00'], ['2026-11-01', '850.00']]);
    assert.equal(ok(await draft(h, f.q, 'alice', rent.id, '2026-10-01')).draft.amount, '800.00');
    assert.equal(ok(await draft(h, f.q, 'alice', rent.id, '2026-11-01')).draft.amount, '850.00');
    code(await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: rent.id, revision: rent.revision, notes: 'late' } }), 409, 'stale_revision');

    const v3 = ok(await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: rent.id, revision: v2.revision, categoryId: cats.Utilities, effectiveFrom: '2026-12-01' } })).recurring;
    assert.deepEqual([v3.versions[2].amount, v3.versions[2].categoryId], ['850.00', cats.Utilities], 'a later version carries forward the terms in force');
    assert.deepEqual(v3.history.map((x) => x.fields), [['create'], ['terms from 2026-11-01'], ['terms from 2026-12-01']]);
    assert.deepEqual(await txnNow(), before, 'the recorded September entry is untouched');
  });

  test('removing a bill keeps the entries already recorded from it', async () => {
    const h = harness();
    const f = await household(h);
    const rent = ok(await create(h, f.q, 'alice', { name: 'Rent', accountId: f.joint.id, amount: '800.00', schedule: monthly('2026-10-01') }), 201).recurring;
    const t = ok(await act(h, f.q, 'alice', 'record', { recurringId: rent.id, occurrence: '2026-10-01' }), 201).transactions[0];
    ok(await h.call('recurring', 'DELETE', { as: 'alice', query: f.q, body: { recurringId: rent.id, revision: rent.revision } }));
    assert.equal(await find(h, f.q, 'alice', rent.id), undefined);
    assert.ok(ok(await h.call('transactions', 'GET', { as: 'alice', query: f.q })).transactions.some((x) => x.id === t.id));
  });
});

describe('BT-008-02 bills: skips, pauses, overdue and reminders', () => {
  test('skipped occurrences and temporary pauses drop out of upcoming items and forecasts', async () => {
    const h = harness();
    const f = await household(h);
    const gym = ok(await create(h, f.q, 'alice', { name: 'Gym', billType: 'membership', accountId: f.aliceSavings.id, amount: '30.00', schedule: monthly('2026-09-15') }), 201).recurring;
    const skipped = ok(await act(h, f.q, 'alice', 'skip', { recurringId: gym.id, occurrence: '2026-10-15', reason: 'Holiday' })).recurring;
    assert.deepEqual(skipped.upcoming.slice(0, 3), ['2026-09-15', '2026-11-15', '2026-12-15']);
    assert.deepEqual(skipped.skips, [{ date: '2026-10-15', reason: 'Holiday' }]);
    code(await act(h, f.q, 'alice', 'record', { recurringId: gym.id, occurrence: '2026-10-15' }), 409, 'skipped');
    assert.deepEqual(ok(await act(h, f.q, 'alice', 'unskip', { recurringId: gym.id, occurrence: '2026-10-15' })).recurring.upcoming.slice(0, 3), ['2026-09-15', '2026-10-15', '2026-11-15']);

    const paused = ok(await act(h, f.q, 'alice', 'pause', { recurringId: gym.id, from: '2026-11-01', until: '2027-01-31' })).recurring;
    assert.deepEqual(paused.upcoming.slice(0, 3), ['2026-09-15', '2026-10-15', '2027-02-15']);
    code(await act(h, f.q, 'alice', 'pause', { recurringId: gym.id, from: '2026-12-01' }), 409, 'overlapping_pause');
    code(await act(h, f.q, 'alice', 'record', { recurringId: gym.id, occurrence: '2026-12-15' }), 409, 'paused');
    const resumed = ok(await act(h, f.q, 'alice', 'resume', { recurringId: gym.id, date: '2026-12-01' })).recurring;
    assert.deepEqual(resumed.pauses.map((p) => [p.from, p.until]), [['2026-11-01', '2026-11-30']]);
    assert.deepEqual(resumed.upcoming.slice(0, 3), ['2026-09-15', '2026-10-15', '2026-12-15']);
    code(await act(h, f.q, 'alice', 'resume', { recurringId: gym.id, date: '2026-12-01' }), 409, 'not_paused');

    // 60 days to 12 Nov: 15 Sep and 15 Oct only (15 Nov is paused): 5000.00 − 60.00.
    const fc = ok(await h.call('forecast', 'GET', { as: 'alice', query: { ...f.q, horizon: '60' } })).forecast.accounts.find((a) => a.name === 'Alice Savings');
    assert.equal(fc.expected.end, '4940.00');
  });

  test('missed and overdue items, reminders and the 30-day total; overdue items are counted in the forecast today', async () => {
    const h = harness();
    const f = await household(h);
    const phone = ok(await create(h, f.q, 'alice', { name: 'Phone', billType: 'subscription', accountId: f.joint.id, amount: '20.00', schedule: monthly('2026-08-05'), trackFrom: '2026-08-05', reminderDays: 3 }), 201).recurring;
    assert.deepEqual([phone.overdue, phone.nextDue, phone.reminders], [['2026-08-05', '2026-09-05'], '2026-10-05', []]);
    const water = ok(await create(h, f.q, 'alice', { name: 'Water', billType: 'utilities', accountId: f.joint.id, amount: '40.00', schedule: monthly('2026-09-15'), reminderDays: 3 }), 201).recurring;
    assert.deepEqual(water.reminders, ['2026-09-15']);
    assert.deepEqual(water.overdue, [], 'a bill started before it was tracked is not reported as missed');
    const { summary } = await list(h, f.q, 'alice');
    // Due 13 Sep – 13 Oct: water 15 Sep (40.00) and phone 5 Oct (20.00).
    assert.deepEqual(summary, { overdue: 2, dueSoon: 1, next30Days: [{ currency: 'EUR', outgoing: '60.00', incoming: '0.00' }] });

    ok(await act(h, f.q, 'alice', 'record', { recurringId: phone.id, occurrence: '2026-08-05' }), 201);
    assert.deepEqual((await find(h, f.q, 'alice', phone.id)).overdue, ['2026-09-05']);
    // Start 917.60 − 20.00 (5 Aug, now recorded) = 897.60; overdue 5 Sep counted today → 877.60;
    // 15 Sep water → 837.60; 5 Oct phone → 817.60.
    const fc = ok(await h.call('forecast', 'GET', { as: 'alice', query: { ...f.q, horizon: '30' } })).forecast.accounts.find((a) => a.name === 'Joint');
    assert.equal(fc.start, '897.60');
    assert.deepEqual(fc.expected.lowest, { amount: '817.60', date: '2026-10-05' });
  });

  test('cash-flow conflicts name the bills that push a balance below zero', async () => {
    const h = harness();
    const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Tight', kind: 'personal', reportingCurrency: 'EUR' } }), 201).workspace;
    const q = { workspaceId: ws.id };
    const checking = ok(await h.call('accounts', 'POST', { as: 'alice', query: q, body: { name: 'Checking', type: 'checking', currency: 'EUR', openingBalance: '100.00', openingDate: '2026-09-01' } }), 201).account;
    ok(await create(h, q, 'alice', { name: 'Rent', billType: 'housing', accountId: checking.id, amount: '800.00', schedule: monthly('2026-10-01') }), 201);
    ok(await create(h, q, 'alice', { name: 'Salary', billType: 'income', accountId: checking.id, amount: '2000.00', schedule: monthly('2026-10-03') }), 201);
    const fc = ok(await h.call('forecast', 'GET', { as: 'alice', query: { ...q, horizon: '30' } })).forecast;
    assert.deepEqual(fc.warnings, [{ accountId: checking.id, accountName: 'Checking', currency: 'EUR', type: 'below-zero', date: '2026-10-01', balance: '-700.00', obligations: ['Rent'] }]);
    assert.equal(fc.accounts[0].expected.end, '1300.00');
  });
});

describe('BT-008-02 bills: permissions', () => {
  async function fixture() {
    const h = harness();
    const f = await household(h);
    const rent = ok(await create(h, f.q, 'alice', { name: 'Rent', accountId: f.joint.id, amount: '800.00', schedule: monthly('2026-10-01') }), 201).recurring;
    const streaming = ok(await create(h, f.q, 'bob', { name: 'Streaming', billType: 'subscription', accountId: f.bobCard.id, amount: '12.00', schedule: monthly('2026-09-25') }), 201).recurring;
    return { h, f, rent, streaming };
  }

  test('a viewer sees shared bills but cannot create, record, skip, pause, change or remove them', async () => {
    const { h, f, rent } = await fixture();
    assert.deepEqual((await list(h, f.q, 'carol')).recurring.map((r) => r.name), ['Rent']);
    assert.equal((await create(h, f.q, 'carol', { name: 'X', accountId: f.joint.id, amount: '1.00', schedule: monthly('2026-10-01') })).status, 403);
    assert.equal((await act(h, f.q, 'carol', 'record', { recurringId: rent.id, occurrence: '2026-10-01' })).status, 403);
    assert.equal((await act(h, f.q, 'carol', 'skip', { recurringId: rent.id, occurrence: '2026-10-01' })).status, 403);
    assert.equal((await act(h, f.q, 'carol', 'pause', { recurringId: rent.id, from: '2026-10-01' })).status, 403);
    assert.equal((await h.call('recurring', 'PATCH', { as: 'carol', query: f.q, body: { recurringId: rent.id, revision: rent.revision, notes: 'x' } })).status, 403);
    assert.equal((await h.call('recurring', 'DELETE', { as: 'carol', query: f.q, body: { recurringId: rent.id, revision: rent.revision } })).status, 403);
  });

  test('a plain member may record a shared bill but not change one someone else created', async () => {
    const { h, f, rent } = await fixture();
    assert.equal((await h.call('recurring', 'PATCH', { as: 'bob', query: f.q, body: { recurringId: rent.id, revision: rent.revision, notes: 'x' } })).status, 403);
    assert.equal((await act(h, f.q, 'bob', 'skip', { recurringId: rent.id, occurrence: '2026-10-01' })).status, 403);
    ok(await act(h, f.q, 'bob', 'record', { recurringId: rent.id, occurrence: '2026-10-01' }), 201);
  });

  test('another member\'s private bill is invisible (404) to the owner, a site admin and outsiders', async () => {
    const { h, f, streaming } = await fixture();
    assert.ok(!(await list(h, f.q, 'alice')).recurring.some((r) => r.id === streaming.id));
    assert.equal((await draft(h, f.q, 'alice', streaming.id, '2026-09-25')).status, 404);
    assert.equal((await act(h, f.q, 'alice', 'record', { recurringId: streaming.id, occurrence: '2026-09-25' })).status, 404);
    assert.equal((await act(h, f.q, 'alice', 'skip', { recurringId: streaming.id, occurrence: '2026-09-25' })).status, 404);
    assert.equal((await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: streaming.id, revision: 1, notes: 'x' } })).status, 404);
    assert.equal((await h.call('recurring', 'GET', { as: 'dave', query: f.q })).status, 404);
    assert.equal((await h.call('recurring', 'GET', { as: 'eve', query: f.q })).status, 404);
  });

  test('a view-only grant shows the bill but gives no power to record, skip or change it', async () => {
    const { h, f, streaming } = await fixture();
    ok(await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: f.memberId('Alice'), capabilities: ['view-balances', 'view-transactions'] } }), 201);
    const seen = await find(h, f.q, 'alice', streaming.id);
    assert.deepEqual([seen.canEdit, seen.canRecord], [false, false]);
    assert.equal((await act(h, f.q, 'alice', 'skip', { recurringId: streaming.id, occurrence: '2026-09-25' })).status, 403);
    assert.equal((await act(h, f.q, 'alice', 'record', { recurringId: streaming.id, occurrence: '2026-09-25' })).status, 403);
  });
});
