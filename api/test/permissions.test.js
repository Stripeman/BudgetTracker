'use strict';
// BT-001 permission matrix — release gate. Negative cases across direct ids and every derived
// surface built so far: lists, totals, filters, payees, suggestions, people selectors, audit,
// "who can see this", grants, membership changes and restores of access.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household, principalHeader, USERS } = require('./helpers');

const DAY = 24 * 60 * 60 * 1000;
const names = (list) => list.map((x) => x.name).sort();

describe('BT-001 identity and request protection', () => {
  test('unauthenticated, wrong-provider, role-less and malformed principals are refused', async () => {
    const h = harness();
    assert.equal((await h.call('me', 'GET')).status, 401);
    for (const header of [
      principalHeader(USERS.alice, { identityProvider: 'aad' }),
      principalHeader(USERS.alice, { userRoles: ['anonymous'] }),
      principalHeader(USERS.alice, { userDetails: 'not-an-email' }),
      principalHeader(USERS.alice, { userId: '../../etc' }),
      'not-base64-json',
    ]) {
      const res = await h.call('me', 'GET', { headers: { 'x-ms-client-principal': header } });
      assert.equal(res.status, 401, header.slice(0, 20));
    }
  });

  test('state-changing requests without the protection header are refused before any handler', async () => {
    const h = harness();
    const res = await h.call('workspaces', 'POST', { as: 'alice', csrf: false, body: { name: 'X' } });
    assert.equal(res.status, 403);
    assert.equal((await h.call('workspaces', 'GET', { as: 'alice' })).body.workspaces.length, 0, 'nothing was created');
  });

  test('server-owned fields cannot be smuggled in a body', async () => {
    const h = harness();
    const { q } = await household(h);
    const res = await h.call('accounts', 'POST', { as: 'carol', query: q, body: { name: 'Mine', type: 'cash', currency: 'EUR', ownerSubject: 'google:g-alice' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'unknown_field');
  });
});

describe('BT-001 private accounts stay private from the workspace owner', () => {
  test('owner lists, totals, filters and direct ids never reach a member\'s private account', async () => {
    const h = harness();
    const f = await household(h);
    const accounts = (await h.call('accounts', 'GET', { as: 'alice', query: f.q })).body;
    assert.deepEqual(names(accounts.accounts), ['Alice Savings', 'Joint']);
    // Totals: Joint 1000.00 - 82.40 = 917.60, plus Alice Savings 5000.00 = 5917.60. Bob's card
    // (-250.00) must not be included.
    assert.deepEqual(accounts.totals, [{ currency: 'EUR', minor: 591760, amount: '5917.60', breakdown: { own: '5000.00', shared: '917.60', granted: '0.00' } }]);
    const txns = (await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q } })).body;
    assert.deepEqual(txns.transactions.map((t) => t.payeeName), ['Fictional Grocer']);
    assert.equal((await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: f.bobCard.id } })).body.total, 0);
    assert.equal((await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, q: 'jeweller' } })).body.total, 0);
    const edit = await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: f.secret.id, revision: 1, notes: 'x' } });
    assert.equal(edit.status, 404);
    assert.equal((await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: f.secret.id, revision: 1 } })).status, 404);
    assert.equal((await h.call('accounts', 'PATCH', { as: 'alice', query: f.q, body: { accountId: f.bobCard.id, name: 'Mine now' } })).status, 404);
    assert.equal((await h.call('grants', 'GET', { as: 'alice', query: { ...f.q, accountId: f.bobCard.id } })).status, 404);
  });

  test('payees, suggestions, people selectors and audit do not reveal hidden spending', async () => {
    const h = harness();
    const f = await household(h);
    const payees = (await h.call('payees', 'GET', { as: 'alice', query: f.q })).body.payees;
    assert.deepEqual(names(payees), ['Fictional Grocer']);
    const secretPayeeId = f.secret.payeeId;
    assert.equal((await h.call('payees', 'GET', { as: 'alice', query: { ...f.q, action: 'suggest', payeeId: secretPayeeId } })).status, 404);
    const options = (await h.call('people', 'GET', { as: 'alice', query: { ...f.q, field: 'payee' } })).body.options;
    assert.ok(!options.some((o) => o.label === 'Secret Jeweller'));
    // Reusing the hidden merchant's name creates a separate merchant: the duplicate check neither
    // reveals Bob's private one nor attaches to it.
    const created = await h.call('payees', 'POST', { as: 'alice', query: f.q, body: { name: 'Secret Jeweller', visibility: 'shared' } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.similar, []);
    const mine = (await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '1.00', payeeId: created.body.payee.id } })).body.transactions[0];
    assert.notEqual(mine.payeeId, secretPayeeId);
    const audit = (await h.call('audit', 'GET', { as: 'alice', query: f.q })).body.entries;
    assert.ok(!audit.some((e) => e.targetId === f.bobCard.id || e.targetId === f.secret.id), 'no audit entries about Bob\'s private account');
    assert.ok(audit.some((e) => e.targetId === f.grocery.id));
  });

  test('Bob sees his own private account and the shared account, not Alice\'s private one', async () => {
    const h = harness();
    const f = await household(h);
    assert.deepEqual(names((await h.call('accounts', 'GET', { as: 'bob', query: f.q })).body.accounts), ['Bob Card', 'Joint']);
    const card = (await h.call('accounts', 'GET', { as: 'bob', query: f.q })).body.accounts.find((a) => a.name === 'Bob Card');
    assert.equal(card.balance, '-250.00');
  });
});

describe('BT-001 site administration and outsiders', () => {
  test('a site administrator gets no workspace or financial access', async () => {
    const h = harness();
    const f = await household(h);
    const me = (await h.call('me', 'GET', { as: 'dave' })).body;
    assert.equal(me.user.siteAdmin, true);
    assert.deepEqual(me.workspaces, []);
    for (const [route, query] of [['workspaces', { id: f.ws.id }], ['accounts', f.q], ['transactions', f.q], ['members', f.q], ['audit', f.q], ['payees', f.q], ['people', f.q]]) {
      assert.equal((await h.call(route, 'GET', { as: 'dave', query })).status, 404, route);
    }
    assert.equal((await h.call('site-settings', 'PUT', { as: 'dave', body: { maintenanceMessage: 'Fictional maintenance' } })).status, 200);
    assert.equal((await h.call('site-settings', 'PUT', { as: 'alice', body: { maintenanceMessage: 'x' } })).status, 403);
  });

  test('an outsider receives not-found (never forbidden) for every workspace surface', async () => {
    const h = harness();
    const f = await household(h);
    const probes = [
      ['workspaces', 'GET', { id: f.ws.id }], ['accounts', 'GET', f.q], ['transactions', 'GET', f.q],
      ['grants', 'GET', { ...f.q, accountId: f.joint.id }], ['audit', 'GET', f.q], ['categories', 'GET', f.q],
      ['transactions', 'POST', f.q, { accountId: f.joint.id, kind: 'expense', amount: '1.00' }],
      ['accounts', 'PATCH', f.q, { accountId: f.joint.id, name: 'Hijacked' }],
      ['members', 'PATCH', f.q, { memberId: f.memberId('Alice'), role: 'viewer' }],
      ['workspaces', 'GET', { id: 'ws_doesnotexist0000' }],
    ];
    for (const [route, method, query, body] of probes) {
      const res = await h.call(route, method, { as: 'eve', query, body });
      assert.equal(res.status, 404, `${method} ${route}`);
    }
  });
});

describe('BT-001 grants: explicit, scoped, expiring, revocable', () => {
  test('a view-transactions grant shows entries but not balances, and expires', async () => {
    const h = harness();
    const f = await household(h);
    const aliceMember = f.memberId('Alice');
    const g = await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: aliceMember, capabilities: ['view-transactions'], expiresAt: new Date(h.clock.now() + DAY).toISOString() } });
    assert.equal(g.status, 201);
    const card = (await h.call('accounts', 'GET', { as: 'alice', query: f.q })).body.accounts.find((a) => a.id === f.bobCard.id);
    assert.ok(card, 'granted account is visible');
    assert.equal(card.balance, undefined, 'no view-balances capability, so no balance');
    assert.equal((await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: f.bobCard.id } })).body.total, 1);
    assert.equal((await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: f.secret.id, revision: 1, notes: 'x' } })).status, 403, 'view does not imply edit');
    h.clock.advance(2 * DAY);
    assert.equal((await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: f.bobCard.id } })).body.total, 0, 'expired grant gives nothing');
  });

  test('revocation blocks future retrieval; only the owner can grant; grants cannot escalate', async () => {
    const h = harness();
    const f = await household(h);
    const alice = f.memberId('Alice');
    assert.equal((await h.call('grants', 'POST', { as: 'alice', query: f.q, body: { accountId: f.bobCard.id, memberId: alice, capabilities: ['view-transactions'] } })).status, 404, 'workspace owner cannot grant herself Bob\'s account');
    assert.equal((await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: alice, capabilities: ['change-permissions'] } })).status, 400);
    assert.equal((await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.joint.id, memberId: alice, capabilities: ['view-balances'] } })).status, 400, 'shared accounts use roles');
    const g = (await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: alice, capabilities: ['view-balances', 'view-transactions'] } })).body.grant;
    assert.equal((await h.call('accounts', 'GET', { as: 'alice', query: f.q })).body.accounts.find((a) => a.id === f.bobCard.id).balance, '-250.00');
    const who = (await h.call('grants', 'GET', { as: 'bob', query: { ...f.q, accountId: f.bobCard.id } })).body;
    assert.deepEqual(who.people.map((p) => p.source).sort(), ['grant', 'owner']);
    assert.match(who.notice, /cannot|may keep/);
    assert.equal((await h.call('grants', 'DELETE', { as: 'bob', query: f.q, body: { grantId: g.id } })).status, 200);
    assert.ok(!(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).body.accounts.some((a) => a.id === f.bobCard.id));
  });
});

describe('BT-001 roles on shared accounts', () => {
  test('viewer can read but not write; member edits only their own entries', async () => {
    const h = harness();
    const f = await household(h);
    assert.equal((await h.call('transactions', 'GET', { as: 'carol', query: { ...f.q, accountId: f.joint.id } })).body.total, 1);
    assert.equal((await h.call('transactions', 'POST', { as: 'carol', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '5.00' } })).status, 403);
    assert.equal((await h.call('transactions', 'PATCH', { as: 'bob', query: f.q, body: { transactionId: f.grocery.id, revision: 1, notes: 'mine?' } })).status, 403);
    const own = (await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '5.00' } })).body.transactions[0];
    assert.equal((await h.call('transactions', 'PATCH', { as: 'bob', query: f.q, body: { transactionId: own.id, revision: 1, notes: 'ok' } })).status, 200);
    assert.equal((await h.call('accounts', 'POST', { as: 'bob', query: f.q, body: { name: 'Shared by Bob', type: 'cash', currency: 'EUR', visibility: 'shared' } })).status, 403);
  });
});

describe('BT-001 membership lifecycle', () => {
  test('removing a member revokes their grants and grants on their accounts; rejoining restores none', async () => {
    const h = harness();
    const f = await household(h);
    const alice = f.memberId('Alice');
    const bob = f.memberId('Bob');
    await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: alice, capabilities: ['view-transactions'] } });
    await h.call('grants', 'POST', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, memberId: bob, capabilities: ['view-balances'] } });
    const removed = await h.call('members', 'DELETE', { as: 'alice', query: f.q, body: { memberId: bob } });
    assert.equal(removed.body.grantsRevoked, 2);
    assert.equal((await h.call('accounts', 'GET', { as: 'bob', query: f.q })).status, 404);
    assert.ok(!(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).body.accounts.some((a) => a.id === f.bobCard.id));
    const inv = (await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: USERS.bob.email, role: 'viewer' } })).body;
    assert.equal((await h.call('invitations', 'POST', { as: 'bob', query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: inv.token } })).status, 200);
    const bobView = (await h.call('accounts', 'GET', { as: 'bob', query: f.q })).body.accounts;
    assert.deepEqual(names(bobView), ['Bob Card', 'Joint'], 'own private account returns, Alice\'s grant does not');
    assert.ok(!(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).body.accounts.some((a) => a.id === f.bobCard.id));
  });

  test('the last owner cannot be demoted or removed; only owners change roles', async () => {
    const h = harness();
    const f = await household(h);
    const alice = f.memberId('Alice');
    assert.equal((await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: alice, role: 'member' } })).status, 409);
    assert.equal((await h.call('members', 'DELETE', { as: 'alice', query: f.q, body: { memberId: alice } })).status, 409);
    assert.equal((await h.call('members', 'PATCH', { as: 'bob', query: f.q, body: { memberId: f.memberId('Carol'), role: 'owner' } })).status, 403);
  });

  test('invitations: wrong email, expired, revoked and reused tokens are all not-found', async () => {
    const h = harness();
    const f = await household(h);
    const inv = (await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: 'frank@example.com', role: 'member' } })).body;
    assert.match(inv.accessPreview.summary, /Cannot see anyone's private accounts/);
    assert.equal((await h.call('invitations', 'POST', { as: 'eve', query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: inv.token } })).status, 404, 'token for another email');
    assert.equal((await h.call('invitations', 'POST', { as: 'bob', query: f.q, body: { email: 'x@example.com', role: 'owner' } })).status, 403, 'member cannot invite');
    const second = (await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: USERS.eve.email, role: 'viewer' } })).body;
    h.clock.advance(8 * DAY);
    assert.equal((await h.call('invitations', 'POST', { as: 'eve', query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: second.token } })).status, 404, 'expired');
    const third = (await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: USERS.eve.email, role: 'viewer' } })).body;
    await h.call('invitations', 'DELETE', { as: 'alice', query: f.q, body: { invitationId: third.invitation.id } });
    assert.equal((await h.call('invitations', 'POST', { as: 'eve', query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: third.token } })).status, 404, 'revoked');
  });
});

describe('BT-001 preferences are private to their owner', () => {
  test('a site administrator cannot read another person\'s preferences; locked keys cannot be overridden', async () => {
    const h = harness();
    await h.call('preferences', 'PUT', { as: 'alice', body: { themeMode: 'dark', balanceMasking: true } });
    const dave = (await h.call('preferences', 'GET', { as: 'dave' })).body;
    assert.equal(dave.stored.themeMode, undefined);
    assert.equal(dave.sources.themeMode, 'site');
    await h.call('site-settings', 'PUT', { as: 'dave', body: { locked: ['themeMode'], defaults: { themeMode: 'light' } } });
    const alice = (await h.call('preferences', 'GET', { as: 'alice' })).body;
    assert.equal(alice.effective.themeMode, 'light');
    assert.equal(alice.sources.themeMode, 'locked');
    assert.equal((await h.call('preferences', 'PUT', { as: 'alice', body: { themeMode: 'dark' } })).status, 403);
  });
});
