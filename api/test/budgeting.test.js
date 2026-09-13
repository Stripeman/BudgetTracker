'use strict';
// BT-008-01: schedules, budgets, commitments and forecasts. Expected values are computed by hand.
// The harness clock is 2026-09-13, so "today" is 2026-09-13 and the September period is
// 2026-09-01..2026-09-30.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household, merchant } = require('./helpers');
const schedule = require('../_shared/schedule');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

describe('BT-008-01 schedules', () => {
  test('a monthly schedule on the 31st clamps short months without drifting', () => {
    const s = schedule.validateSchedule({ freq: 'monthly', startDate: '2026-01-31' });
    assert.deepEqual(schedule.occurrences(s, '2026-01-01', '2026-05-31'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });
  test('a yearly schedule on 29 February falls on the 28th in non-leap years', () => {
    const s = schedule.validateSchedule({ freq: 'yearly', startDate: '2028-02-29' });
    assert.deepEqual(schedule.occurrences(s, '2028-01-01', '2032-12-31'), ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });
  test('weekly with an interval, bounded by the end date', () => {
    const s = schedule.validateSchedule({ freq: 'weekly', interval: 2, startDate: '2026-09-01', endDate: '2026-10-10' });
    assert.deepEqual(schedule.occurrences(s, '2026-09-01', '2026-12-31'), ['2026-09-01', '2026-09-15', '2026-09-29']);
  });
  test('invalid schedules are refused', () => {
    for (const bad of [{ freq: 'daily', startDate: '2026-01-01' }, { freq: 'monthly', startDate: '2026-02-30' }, { freq: 'monthly', interval: 0, startDate: '2026-01-01' }, { freq: 'monthly', startDate: '2026-05-01', endDate: '2026-04-01' }]) {
      assert.throws(() => schedule.validateSchedule(bad));
    }
  });
});

async function budgetFixture(h) {
  const f = await household(h);
  const cats = Object.fromEntries(ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories.map((c) => [c.name, c.id]));
  const tx = (as, body) => h.call('transactions', 'POST', { as, query: f.q, body });
  // household() already added Groceries? No: its grocery entry (82.40) is uncategorized.
  ok(await tx('alice', { accountId: f.joint.id, kind: 'expense', amount: '100.00', categoryId: cats.Groceries, date: '2026-09-02' }), 201);
  ok(await tx('bob', { accountId: f.joint.id, kind: 'expense', amount: '50.00', categoryId: cats.Groceries, date: '2026-09-05' }), 201);
  ok(await tx('alice', { accountId: f.joint.id, kind: 'refund', amount: '20.00', categoryId: cats.Groceries, date: '2026-09-06' }), 201);
  ok(await tx('alice', { accountId: f.joint.id, kind: 'expense', amount: '30.00', categoryId: cats.Groceries, date: '2026-08-20' }), 201);
  // Bob's PRIVATE grocery spending must never appear in the shared budget.
  ok(await tx('bob', { accountId: f.bobCard.id, kind: 'expense', amount: '999.00', categoryId: cats.Groceries, date: '2026-09-07' }), 201);
  const courier = await merchant(h, f.q, 'alice', { name: 'Fictional Delivery', visibility: 'shared' });
  const delivery = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: {
    name: 'Fictional Delivery', billType: 'subscription', accountId: f.joint.id, amount: '25.00', categoryId: cats.Groceries, payeeId: courier.id,
    schedule: { freq: 'monthly', startDate: '2026-07-20' },
  } }), 201).recurring;
  return { ...f, cats, delivery };
}

describe('BT-008-01 budgets', () => {
  test('available = planned + carry − spent − still committed; private spending never leaks into shared budgets', async () => {
    const h = harness();
    const f = await budgetFixture(h);
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Household food', scope: 'shared', currency: 'EUR', period: 'monthly', startDate: '2026-01-01', lines: [{ categoryId: f.cats.Groceries, amount: '400.00' }] } }), 201);
    const [b] = ok(await h.call('budgets', 'GET', { as: 'carol', query: f.q })).budgets;
    assert.deepEqual(b.status.period, { start: '2026-09-01', end: '2026-09-30' });
    // Spent: 100.00 + 50.00 − 20.00 refund = 130.00. Committed: the 20 Sept delivery, 25.00.
    // Available: 400.00 − 130.00 − 25.00 = 245.00. Bob's private 999.00 is excluded.
    assert.deepEqual(b.status.lines[0], { categoryId: f.cats.Groceries, category: 'Groceries', rollover: false, planned: '400.00', actual: '130.00', committed: '25.00', carry: '0.00', available: '245.00', over: false });
    assert.match(b.status.scopeNote, /private spending is never included/);
  });

  test('recording a commitment moves it from committed to spent without changing what is available', async () => {
    const h = harness();
    const f = await budgetFixture(h);
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Food', scope: 'shared', currency: 'EUR', startDate: '2026-01-01', lines: [{ categoryId: f.cats.Groceries, amount: '400.00' }] } }), 201);
    const before = ok(await h.call('budgets', 'GET', { as: 'alice', query: f.q })).budgets[0].status.lines[0];
    ok(await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'record' }, body: { recurringId: f.delivery.id, occurrence: '2026-09-20' } }), 201);
    const after = ok(await h.call('budgets', 'GET', { as: 'alice', query: f.q })).budgets[0].status.lines[0];
    assert.equal(before.available, '245.00');
    assert.equal(after.actual, '155.00');
    assert.equal(after.committed, '0.00');
    assert.equal(after.available, '245.00', 'no double counting');
    const again = await h.call('recurring', 'POST', { as: 'bob', query: { ...f.q, action: 'record' }, body: { recurringId: f.delivery.id, occurrence: '2026-09-20' } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'already_recorded');
    assert.equal((await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'record' }, body: { recurringId: f.delivery.id, occurrence: '2026-09-21' } })).body.error.code, 'invalid_occurrence');
  });

  test('rollover carries the previous period\'s unspent amount (one period)', async () => {
    const h = harness();
    const f = await budgetFixture(h);
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Food', scope: 'shared', currency: 'EUR', startDate: '2026-01-01', lines: [{ categoryId: f.cats.Groceries, amount: '400.00', rollover: true }] } }), 201);
    const line = ok(await h.call('budgets', 'GET', { as: 'alice', query: f.q })).budgets[0].status.lines[0];
    // August: planned 400.00, spent 30.00 → carry 370.00. Available: 400 + 370 − 130 − 25 = 615.00.
    // (The 20 Aug delivery occurrence was never recorded, so August spending is only the 30.00.)
    assert.equal(line.carry, '370.00');
    assert.equal(line.available, '615.00');
  });

  test('private budgets are invisible to others and count the owner\'s own accounts; shared budgets need a manager', async () => {
    const h = harness();
    const f = await budgetFixture(h);
    ok(await h.call('budgets', 'POST', { as: 'bob', query: f.q, body: { name: 'Bob food', scope: 'private', currency: 'EUR', startDate: '2026-01-01', lines: [{ categoryId: f.cats.Groceries, amount: '1000.00' }] } }), 201);
    const bob = ok(await h.call('budgets', 'GET', { as: 'bob', query: f.q })).budgets[0];
    // Bob sees Joint (shared) and his own card: 130.00 + 999.00 = 1129.00 spent; 25.00 committed.
    assert.equal(bob.status.lines[0].actual, '1129.00');
    assert.equal(bob.status.lines[0].available, '-154.00');
    assert.equal(bob.status.lines[0].over, true);
    assert.deepEqual(ok(await h.call('budgets', 'GET', { as: 'alice', query: f.q })).budgets, []);
    assert.equal((await h.call('budgets', 'POST', { as: 'bob', query: f.q, body: { name: 'x', scope: 'shared', lines: [{ categoryId: f.cats.Groceries, amount: '1.00' }] } })).status, 403);
    assert.equal((await h.call('budgets', 'GET', { as: 'dave', query: f.q })).status, 404);
  });
});

async function forecastFixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Plan', kind: 'personal', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const checking = ok(await h.call('accounts', 'POST', { as: 'alice', query: q, body: { name: 'Checking', type: 'checking', currency: 'EUR', openingBalance: '1000.00', openingDate: '2026-09-01' } }), 201).account;
  const savings = ok(await h.call('accounts', 'POST', { as: 'alice', query: q, body: { name: 'Savings', type: 'savings', currency: 'EUR' } }), 201).account;
  const rec = (body) => h.call('recurring', 'POST', { as: 'alice', query: q, body });
  const salary = ok(await rec({ name: 'Salary', billType: 'income', accountId: checking.id, amount: '2000.00', schedule: { freq: 'monthly', startDate: '2026-08-25' } }), 201).recurring;
  const landlord = await merchant(h, q, 'alice', { name: 'Fictional Landlord' });
  ok(await rec({ name: 'Rent', billType: 'housing', accountId: checking.id, amount: '800.00', schedule: { freq: 'monthly', startDate: '2026-09-01' }, payeeId: landlord.id }), 201);
  const utility = ok(await rec({ name: 'Utilities', billType: 'utilities', accountId: checking.id, amount: '100.00', amountType: 'variable', schedule: { freq: 'monthly', startDate: '2026-08-15' } }), 201).recurring;
  ok(await rec({ name: 'Savings', billType: 'savings', kind: 'transfer', accountId: checking.id, toAccountId: savings.id, amount: '150.00', schedule: { freq: 'monthly', startDate: '2026-09-28' } }), 201);
  return { q, checking, savings, salary, utility };
}

describe('BT-008-01 backup and restore', () => {
  test('replace restores shared budgets and commitments but never another member\'s private budget; create-new carries only the caller\'s own', async () => {
    const h = harness();
    const f = await budgetFixture(h);
    const shared = ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Food', scope: 'shared', startDate: '2026-01-01', lines: [{ categoryId: f.cats.Groceries, amount: '400.00' }] } }), 201).budget;
    const bobs = ok(await h.call('budgets', 'POST', { as: 'bob', query: f.q, body: { name: 'Bob food', scope: 'private', startDate: '2026-01-01', lines: [{ categoryId: f.cats.Groceries, amount: '300.00' }] } }), 201).budget;
    const bobRec = ok(await h.call('recurring', 'POST', { as: 'bob', query: f.q, body: { name: 'Streaming', billType: 'subscription', accountId: f.bobCard.id, amount: '12.00', schedule: { freq: 'monthly', startDate: '2026-09-25' } } }), 201).recurring;
    const backup = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;

    ok(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: shared.id, revision: 1, name: 'Renamed' } }));
    ok(await h.call('recurring', 'DELETE', { as: 'alice', query: f.q, body: { recurringId: f.delivery.id, revision: 1 } }));
    ok(await h.call('budgets', 'DELETE', { as: 'bob', query: f.q, body: { budgetId: bobs.id, revision: 1 } }));

    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId: backup, mode: 'replace' } }));
    assert.equal(pv.scope.budgets, 1, 'only the shared budget is in the owner\'s scope');
    ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId: backup, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' } }));
    assert.deepEqual(ok(await h.call('budgets', 'GET', { as: 'alice', query: f.q })).budgets.map((b) => b.name), ['Food']);
    assert.ok(ok(await h.call('recurring', 'GET', { as: 'alice', query: f.q })).recurring.some((r) => r.id === f.delivery.id), 'shared commitment restored');
    assert.deepEqual(ok(await h.call('budgets', 'GET', { as: 'bob', query: f.q })).budgets.map((b) => b.name), ['Food'], 'Bob\'s private deletion was not rolled back by the owner');

    const created = ok(await h.call('restore', 'POST', { as: 'bob', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId: backup, mode: 'create-new' } }), 201);
    const nq = { workspaceId: created.workspace.id };
    assert.deepEqual(ok(await h.call('budgets', 'GET', { as: 'bob', query: nq })).budgets.map((b) => b.name), ['Bob food']);
    assert.deepEqual(ok(await h.call('recurring', 'GET', { as: 'bob', query: nq })).recurring.map((r) => r.id), [bobRec.id]);
  });
});

describe('BT-008-01 forecast', () => {
  test('30-day projection with confirmed and estimated items, savings transfers and a buffer', async () => {
    const h = harness();
    const f = await forecastFixture(h);
    const { forecast } = ok(await h.call('forecast', 'GET', { as: 'alice', query: { ...f.q, horizon: '30', buffer: '950.00' } }));
    assert.equal(forecast.end, '2026-10-13');
    const checking = forecast.accounts.find((a) => a.name === 'Checking');
    // Today's balance 1000.00. Sep 15 −100 (estimate) → 900; Sep 25 +2000 → 2900; Sep 28 −150 → 2750;
    // Oct 1 −800 → 1950. The 1 Sept rent is in the past and unrecorded, so it is not projected.
    assert.equal(checking.start, '1000.00');
    assert.deepEqual(checking.expected, { end: '1950.00', lowest: { amount: '900.00', date: '2026-09-15' }, belowBufferFrom: '2026-09-15' });
    assert.equal(checking.conservative.end, '1950.00', 'no estimated income to leave out');
    assert.deepEqual(checking.optimistic, { end: '2050.00', lowest: { amount: '1000.00', date: '2026-09-13' }, belowBufferFrom: null });
    assert.equal(forecast.accounts.find((a) => a.name === 'Savings').expected.end, '150.00');
  });

  test('what-if scenarios are computed in memory and never saved', async () => {
    const h = harness();
    const f = await forecastFixture(h);
    const name = `workspaces/${f.q.workspaceId}/workspace.json`;
    const before = (await h.storage.getBytes(name)).bytes.toString();
    const res = ok(await h.call('forecast', 'POST', { as: 'alice', query: { ...f.q, action: 'scenario' }, body: {
      horizon: 30, changes: [
        { type: 'one-off', accountId: f.checking.id, date: '2026-09-20', amount: '-1500.00' },
        { type: 'change-recurring', recurringId: f.salary.id, amount: '2100.00' },
        { type: 'exclude-recurring', recurringId: f.utility.id },
      ],
    } }));
    const checking = res.forecast.accounts.find((a) => a.name === 'Checking');
    // 1000 → Sep 20 −1500 = −500 → Sep 25 +2100 = 1600 → Sep 28 −150 = 1450 → Oct 1 −800 = 650.
    assert.deepEqual(checking.expected, { end: '650.00', lowest: { amount: '-500.00', date: '2026-09-20' }, belowBufferFrom: null });
    assert.equal(res.saved, false);
    assert.equal((await h.storage.getBytes(name)).bytes.toString(), before, 'the workspace was not modified');
  });

  test('forecasts cover only accounts the viewer may see, without upcoming items where entries are not shared', async () => {
    const h = harness();
    const f = await household(h);
    ok(await h.call('recurring', 'POST', { as: 'bob', query: f.q, body: { name: 'Card plan', accountId: f.bobCard.id, amount: '60.00', schedule: { freq: 'monthly', startDate: '2026-09-20' } } }), 201);
    const alice = ok(await h.call('forecast', 'GET', { as: 'alice', query: { ...f.q, horizon: '30' } })).forecast;
    assert.ok(!alice.accounts.some((a) => a.name === 'Bob Card'));
    ok(await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: f.memberId('Alice'), capabilities: ['view-balances'] } }), 201);
    const granted = ok(await h.call('forecast', 'GET', { as: 'alice', query: { ...f.q, horizon: '30' } })).forecast.accounts.find((a) => a.name === 'Bob Card');
    assert.equal(granted.itemsShared, false);
    assert.equal(granted.events, 0);
    assert.equal(granted.expected.end, '-250.00', 'balance only; Bob\'s upcoming 60.00 is not revealed');
    assert.equal((await h.call('forecast', 'GET', { as: 'dave', query: f.q })).status, 404);
    assert.equal((await h.call('forecast', 'GET', { as: 'alice', query: { ...f.q, horizon: '45' } })).status, 400);
  });
});
