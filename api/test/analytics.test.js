'use strict';
// /api/analytics — site usage aggregate (BT-012-01, Terry 2026-09-14: "usage statistics ... what
// users, how many users, frequency of use, last log ins etc"). HARD INVARIANT: site administration
// never sees financial records. These tests prove the permission boundary, hand-computed counts
// from a small fictional fixture, that the per-day touch is idempotent and race-safe, and that no
// financial field ever reaches the response.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');
const usage = require('../_shared/usage');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const DAY_MS = 24 * 60 * 60 * 1000;

describe('BT-012-01 site usage: permissions', () => {
  test('a workspace owner, a member and a viewer with no site-admin role are refused', async () => {
    const h = harness();
    await household(h);
    for (const as of ['alice', 'bob', 'carol']) {
      const res = await h.call('analytics', 'GET', { as });
      assert.equal(res.status, 403, as);
      assert.equal(res.body.error.code, 'forbidden', as);
    }
  });

  test('an outsider (not a member of anything) is refused', async () => {
    const h = harness();
    await household(h);
    const res = await h.call('analytics', 'GET', { as: 'eve' });
    assert.equal(res.status, 403);
  });

  test('an anonymous caller is refused', async () => {
    const h = harness();
    await household(h);
    const res = await h.call('analytics', 'GET', {});
    assert.equal(res.status, 401);
  });

  test('a site administrator is let through', async () => {
    const h = harness();
    await household(h);
    const res = await h.call('analytics', 'GET', { as: 'dave' });
    assert.equal(res.status, 200);
  });
});

describe('BT-012-01 site usage: hand-computed counts from a fictional fixture', () => {
  test('total users, sign-ins and new users per day, and workspace counts by kind and status', async () => {
    const h = harness({ start: '2026-09-01T09:00:00Z' });
    // Day 1: Alice signs in (her user document is created on this first GET /api/me) and opens a
    // household workspace. A second sign-in the same day changes nothing.
    ok(await h.call('me', 'GET', { as: 'alice' }));
    ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional household', kind: 'household' } }), 201);
    ok(await h.call('me', 'GET', { as: 'alice' }));
    // Day 2: Bob and Carol sign in for the first time; Bob opens, then archives, a personal workspace.
    h.clock.advance(DAY_MS);
    ok(await h.call('me', 'GET', { as: 'bob' }));
    ok(await h.call('me', 'GET', { as: 'carol' }));
    const personal = ok(await h.call('workspaces', 'POST', { as: 'bob', body: { name: 'Fictional personal', kind: 'personal' } }), 201).workspace;
    ok(await h.call('workspaces', 'DELETE', { as: 'bob', query: { id: personal.id } }));

    const data = ok(await h.call('analytics', 'GET', { as: 'dave' }));
    assert.equal(data.totals.users, 3);
    assert.equal(data.totals.workspaces, 2);
    assert.equal(data.totals.activeThisWeek, 3);
    assert.deepEqual(data.workspacesByKindStatus, { 'household:active': 1, 'personal:archived': 1 });

    const day1 = '2026-09-01';
    const day2 = '2026-09-02';
    const signIns = Object.fromEntries(data.signInsPerDay.map((p) => [p.date, p.count]));
    const newUsers = Object.fromEntries(data.newUsersPerDay.map((p) => [p.date, p.count]));
    assert.equal(signIns[day1], 1, 'only Alice on day 1, a repeat sign-in the same day does not count twice');
    assert.equal(signIns[day2], 2, 'Bob and Carol on day 2');
    assert.equal(newUsers[day1], 1);
    assert.equal(newUsers[day2], 2);
    assert.equal(data.signInsPerDay.length, 30, 'a fixed 30-day window');
    assert.equal(data.newUsersPerDay.length, 30);

    assert.equal(data.users.length, 3);
    // Most recently active first: Bob and Carol (day 2) sort before Alice (day 1).
    assert.ok(data.users[0].lastActiveAt > data.users[2].lastActiveAt);
    assert.equal(data.usersTruncated, false);
  });

  test('no financial field ever appears in the response, even with real financial data present', async () => {
    const h = harness();
    await household(h); // real accounts, transactions and merchants with amountMinor, balances, ids
    const data = ok(await h.call('analytics', 'GET', { as: 'dave' }));
    const text = JSON.stringify(data);
    const FORBIDDEN_KEYS = [
      'accountId', 'amountMinor', 'amount', 'balance', 'currency', 'payeeId', 'categoryId',
      'merchantId', 'transactionId', 'accounts', 'transactions', 'merchants', 'budgets', 'payees',
      'workspaceName', 'name', 'email', 'iban', 'openingBalance', 'notes',
    ];
    for (const key of FORBIDDEN_KEYS) assert.ok(!text.includes(`"${key}"`), `response must not contain "${key}"`);
  });
});

describe('BT-012-01 usage touch: idempotent per day, race-safe, never fatal', () => {
  test('two concurrent first-visits-of-the-day for the same person record exactly one sign-in', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.call('me', 'GET', { as: 'alice' }), h.call('me', 'GET', { as: 'alice' })]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const { usage: doc } = await usage.readUsage(h.storage);
    assert.equal(doc.totalUsers, 1);
    assert.equal(Object.values(doc.signInsByDay).reduce((s, n) => s + n, 0), 1);
    assert.equal(Object.values(doc.newUsersByDay).reduce((s, n) => s + n, 0), 1);
  });

  test('a second sign-in later the same day writes nothing new', async () => {
    const h = harness();
    ok(await h.call('me', 'GET', { as: 'alice' }));
    h.clock.advance(60 * 60 * 1000); // an hour later, same day
    ok(await h.call('me', 'GET', { as: 'alice' }));
    const { usage: doc } = await usage.readUsage(h.storage);
    assert.equal(Object.values(doc.signInsByDay).reduce((s, n) => s + n, 0), 1);
  });

  test('a corrupt usage document never breaks GET /api/me (the touch failure is swallowed)', async () => {
    const h = harness();
    await h.storage.putJson('site/usage.json', { not: 'a valid usage document' }, {});
    const res = await h.call('me', 'GET', { as: 'alice' });
    assert.equal(res.status, 200);
  });
});
