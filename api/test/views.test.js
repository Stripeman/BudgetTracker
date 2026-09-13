'use strict';
// UX review remediation on the API side (UX-002) and public build information. Expected values are
// computed by hand from the household fixture:
//   Joint (shared)          1000.00 - 82.40 = 917.60
//   Alice Savings (Alice)   5000.00
//   Bob Card (Bob)          -250.00
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

test('UX-002 a grantee sees whose account it is, and their totals separate their own money', async () => {
  const h = harness();
  const f = await household(h);
  ok(await h.call('grants', 'POST', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, memberId: f.memberId('Bob'), capabilities: ['view-balances'] } }), 201);
  const bob = ok(await h.call('accounts', 'GET', { as: 'bob', query: f.q }));
  const byName = Object.fromEntries(bob.accounts.map((a) => [a.name, a]));
  assert.equal(byName['Alice Savings'].access, 'granted');
  assert.equal(byName['Alice Savings'].ownerName, 'Alice Fictional');
  assert.equal(byName['Bob Card'].access, 'own');
  assert.equal(byName['Bob Card'].ownerName, null);
  assert.equal(byName.Joint.access, 'shared');
  // Bob: own -250.00, shared 917.60, granted 5000.00; all = 5667.60
  assert.deepEqual(bob.totals, [{ currency: 'EUR', minor: 566760, amount: '5667.60', breakdown: { own: '-250.00', shared: '917.60', granted: '5000.00' } }]);
});

test('UX-002 the owner name is never exposed for accounts the viewer cannot see', async () => {
  const h = harness();
  const f = await household(h);
  const alice = ok(await h.call('accounts', 'GET', { as: 'alice', query: f.q }));
  assert.ok(!alice.accounts.some((a) => a.ownerName), 'Alice owns or shares everything she sees');
  assert.ok(!JSON.stringify(alice).includes('Bob Card'));
});

test('public build information names the environment and deployed commit without sign-in', async () => {
  const h = harness({ env: { BT_ENVIRONMENT: 'preview', BT_COMMIT: 'a3d8c162a7f273ec2ea16ef435190e97caba0be2' } });
  const anon = ok(await h.call('site-settings', 'GET', {}));
  assert.deepEqual(anon.app, { name: 'BudgetTracker', version: '0.1.0-alpha.1', channel: 'alpha', environment: 'preview', commit: 'a3d8c162a7f273ec2ea16ef435190e97caba0be2' });
  const bad = ok(await harness({ env: { BT_ENVIRONMENT: 'prod', BT_COMMIT: 'not-a-sha' } }).call('site-settings', 'GET', {}));
  assert.equal(bad.app.environment, 'unconfigured', 'unknown environment names are not echoed');
  assert.equal(bad.app.commit, null, 'malformed commit values are not echoed');
});
