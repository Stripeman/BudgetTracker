'use strict';
// Direct tests of the authorization layer, independent of the store's membership check, so the
// rule holds even if a future caller forgets to go through loadWorkspace (defense in depth).
// Covers prototype review findings 1 (owner shortcut) and 6 (inherited/getter properties).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const authz = require('../_shared/authz');

const NOW = Date.parse('2026-09-13T10:00:00Z');
const alice = Object.freeze({ subject: 'google:a' });
const bob = Object.freeze({ subject: 'google:b' });
const eve = Object.freeze({ subject: 'google:e' });

function ws(overrides = {}) {
  return {
    members: [
      { id: 'm1', subject: alice.subject, role: 'owner', status: 'active' },
      { id: 'm2', subject: bob.subject, role: 'member', status: 'active' },
    ],
    accounts: [
      { id: 'shared1', visibility: 'shared', ownerSubject: null },
      { id: 'bobPrivate', visibility: 'private', ownerSubject: bob.subject },
    ],
    grants: [],
    ...overrides,
  };
}
const acct = (doc, id) => doc.accounts.find((a) => a.id === id);

test('non-members get nothing, even on shared resources', () => {
  const doc = ws();
  assert.equal(authz.capabilitiesFor(doc, eve, acct(doc, 'shared1'), NOW).size, 0);
  assert.equal(authz.can(doc, eve, acct(doc, 'shared1'), 'view-transactions', NOW), false);
  assert.deepEqual(authz.visibleAccounts(doc, eve, 'view-transactions', NOW), []);
});

test('an owner of a private account who is no longer an active member has no access (finding 1)', () => {
  const doc = ws();
  doc.members[1].status = 'removed';
  assert.equal(authz.capabilitiesFor(doc, bob, acct(doc, 'bobPrivate'), NOW).size, 0);
  doc.members[1].status = 'active';
  assert.ok(authz.can(doc, bob, acct(doc, 'bobPrivate'), 'view-balances', NOW));
});

test('workspace owner role gives nothing on another member\'s private account', () => {
  const doc = ws();
  assert.equal(authz.capabilitiesFor(doc, alice, acct(doc, 'bobPrivate'), NOW).size, 0);
});

test('publish is never granted by role, ownership or grant', () => {
  const doc = ws({ grants: [{ subject: alice.subject, resourceType: 'account', resourceId: 'bobPrivate', capabilities: ['publish', 'view-balances'], expiresAt: null, revokedAt: null }] });
  assert.equal(authz.can(doc, bob, acct(doc, 'bobPrivate'), 'publish', NOW), false);
  assert.equal(authz.can(doc, alice, acct(doc, 'shared1'), 'publish', NOW), false);
  assert.equal(authz.can(doc, alice, acct(doc, 'bobPrivate'), 'publish', NOW), false);
  assert.equal(authz.can(doc, alice, acct(doc, 'bobPrivate'), 'view-balances', NOW), true);
});

test('malformed grants deny: missing revokedAt, bad expiry, wrong type, wrong resource', () => {
  const base = { subject: alice.subject, resourceType: 'account', resourceId: 'bobPrivate', capabilities: ['view-transactions'], expiresAt: null, revokedAt: null };
  for (const bad of [
    (() => { const g = { ...base }; delete g.revokedAt; return g; })(),
    (() => { const g = { ...base }; delete g.expiresAt; return g; })(),
    { ...base, expiresAt: 'not-a-date' },
    { ...base, expiresAt: Infinity },
    { ...base, expiresAt: '2026-09-13T09:59:59Z' },
    { ...base, revokedAt: '2026-09-01T00:00:00Z' },
    { ...base, resourceType: 'category' },
    { ...base, resourceId: 'shared1' },
    { ...base, capabilities: 'view-transactions' },
    { ...base, capabilities: ['change-permissions'] },
  ]) {
    const doc = ws({ grants: [bad] });
    assert.equal(authz.can(doc, alice, acct(doc, 'bobPrivate'), 'view-transactions', NOW), false, JSON.stringify(bad));
    assert.equal(authz.can(doc, alice, acct(doc, 'bobPrivate'), 'change-permissions', NOW), false);
  }
});

test('inherited or prototype-polluted properties cannot satisfy a check (finding 6)', () => {
  const doc = ws();
  const inherited = Object.create({ subject: 'google:a', resourceType: 'account', resourceId: 'bobPrivate', capabilities: ['view-transactions'], expiresAt: null, revokedAt: null });
  doc.grants = [inherited];
  assert.equal(authz.can(doc, alice, acct(doc, 'bobPrivate'), 'view-transactions', NOW), false);
  Object.prototype.revokedAt = null; // eslint-disable-line no-extend-native
  try {
    doc.grants = [{ subject: alice.subject, resourceType: 'account', resourceId: 'bobPrivate', capabilities: ['view-transactions'], expiresAt: null }];
    assert.equal(authz.can(doc, alice, acct(doc, 'bobPrivate'), 'view-transactions', NOW), false);
  } finally { delete Object.prototype.revokedAt; }
  const memberInherited = ws({ members: [Object.create({ subject: eve.subject, role: 'owner', status: 'active' })] });
  assert.equal(authz.can(memberInherited, eve, acct(memberInherited, 'shared1'), 'view-balances', NOW), false);
  assert.equal(authz.can(ws(), { subject: 'google:a', siteAdmin: true, role: 'owner' }, acct(ws(), 'bobPrivate'), 'view-balances', NOW), false);
});

test('unknown roles and capabilities deny', () => {
  const doc = ws({ members: [{ subject: alice.subject, role: 'superuser', status: 'active' }] });
  assert.equal(authz.capabilitiesFor(doc, alice, acct(doc, 'shared1'), NOW).size, 0);
  assert.equal(authz.can(ws(), alice, acct(ws(), 'shared1'), 'launch-missiles', NOW), false);
});
