'use strict';
// BT-014-17: a site-admin on/off toggle for a "request account" feature (Terry, 2026-09-17: "a
// feature that the site admin can turn off or on that enables a request account feature that the
// site admin approves"). Off by default (today's unchanged behaviour); when on, a BRAND-NEW
// account starts pending and cannot create or join a workspace until a site administrator approves
// it — the two ways to gain any financial-data access at all, per the existing membership model.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const FRANK = { userId: 'g-frank', email: 'frank@example.com', name: 'Frank Newcomer' };

async function enableAccountRequests(h) {
  ok(await h.call('site-settings', 'PUT', { as: 'dave', body: { accountRequestsEnabled: true } }));
}

describe('BT-014-17 account requests: off by default', () => {
  test('with the setting off, a brand-new account is immediately approved and can create a workspace, unchanged', async () => {
    const h = harness();
    const me = ok(await h.call('me', 'GET', { user: FRANK }));
    assert.equal(me.user.pendingApproval, false);
    assert.equal(me.user.rejected, false);
    ok(await h.call('workspaces', 'POST', { user: FRANK, body: { name: 'Frank Household', kind: 'personal' } }), 201);
  });
});

describe('BT-014-17 account requests: on, a brand-new account is pending', () => {
  test('GET /api/me reports pendingApproval and no workspaces are loaded', async () => {
    const h = harness();
    await enableAccountRequests(h);
    const me = ok(await h.call('me', 'GET', { user: FRANK }));
    assert.equal(me.user.pendingApproval, true);
    assert.equal(me.user.rejected, false);
    assert.deepEqual(me.workspaces, []);
  });

  test('a pending account cannot create a workspace', async () => {
    const h = harness();
    await enableAccountRequests(h);
    ok(await h.call('me', 'GET', { user: FRANK }));
    const res = await h.call('workspaces', 'POST', { user: FRANK, body: { name: 'Frank Household', kind: 'personal' } });
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /waiting for a site administrator to approve/);
  });

  test('a pending account cannot join a workspace by invitation', async () => {
    const h = harness();
    // Account requests turned on AFTER alice's own workspace already exists (alice, an existing
    // approved user, is unaffected by turning the setting on later).
    const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Household', kind: 'household' } }), 201).workspace;
    await enableAccountRequests(h);
    ok(await h.call('me', 'GET', { user: FRANK }));
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: { workspaceId: ws.id }, body: { email: FRANK.email, role: 'member' } }), 201);
    const res = await h.call('invitations', 'POST', { user: FRANK, query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } });
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /waiting for a site administrator to approve/);
  });

  test('turning the setting on does not retroactively pend an existing, already-approved account', async () => {
    const h = harness();
    ok(await h.call('me', 'GET', { as: 'alice' })); // alice's account is created (approved) while the setting is off.
    await enableAccountRequests(h);
    const me = ok(await h.call('me', 'GET', { as: 'alice' }));
    assert.equal(me.user.pendingApproval, false);
    ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Still Works', kind: 'personal' } }), 201);
  });

  test('a site administrator is never blocked by their own approval status, even on their very first visit', async () => {
    const h = harness();
    await enableAccountRequests(h);
    const me = ok(await h.call('me', 'GET', { as: 'dave' }));
    assert.equal(me.user.pendingApproval, false, 'dave (BT_SITE_ADMINS) is never pending, even brand new');
    ok(await h.call('workspaces', 'POST', { as: 'dave', body: { name: 'Dave Testing', kind: 'personal' } }), 201);
  });
});

describe('BT-014-17 the site-admin approval queue', () => {
  test('only a site administrator may list, approve or reject; an outsider and a plain member cannot', async () => {
    const h = harness();
    await enableAccountRequests(h);
    ok(await h.call('me', 'GET', { user: FRANK }));
    for (const as of ['alice', 'eve']) {
      assert.equal((await h.call('analytics', 'GET', { as, query: { action: 'pending-users' } })).status, 403, as);
      assert.equal((await h.call('analytics', 'POST', { as, query: { action: 'approve-user' }, body: { subject: `google:${FRANK.userId}` } })).status, 403, as);
    }
  });

  test('the queue lists a pending account by subject/email/name/createdAt, never anything financial, and excludes an already-approved one', async () => {
    const h = harness();
    ok(await h.call('me', 'GET', { as: 'alice' })); // alice's account exists (approved) BEFORE the setting turns on.
    await enableAccountRequests(h);
    ok(await h.call('me', 'GET', { user: FRANK })); // frank's account is created AFTER — pending.
    const queue = ok(await h.call('analytics', 'GET', { as: 'dave', query: { action: 'pending-users' } }));
    const subjects = queue.pending.map((p) => p.subject);
    assert.deepEqual(subjects, [`google:${FRANK.userId}`], 'only the pending account appears; alice, already approved, does not');
    const frank = queue.pending[0];
    assert.equal(frank.email, FRANK.email);
    assert.equal(frank.name, FRANK.name);
    assert.ok(frank.createdAt);
  });

  test('approving a pending account lets it create a workspace immediately after', async () => {
    const h = harness();
    await enableAccountRequests(h);
    ok(await h.call('me', 'GET', { user: FRANK }));
    ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'approve-user' }, body: { subject: `google:${FRANK.userId}` } }));
    const me = ok(await h.call('me', 'GET', { user: FRANK }));
    assert.equal(me.user.pendingApproval, false);
    ok(await h.call('workspaces', 'POST', { user: FRANK, body: { name: 'Frank Household', kind: 'personal' } }), 201);
  });

  test('rejecting a pending account keeps it blocked, and GET /api/me reports rejected, not pendingApproval', async () => {
    const h = harness();
    await enableAccountRequests(h);
    ok(await h.call('me', 'GET', { user: FRANK }));
    ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'reject-user' }, body: { subject: `google:${FRANK.userId}` } }));
    const me = ok(await h.call('me', 'GET', { user: FRANK }));
    assert.equal(me.user.pendingApproval, false);
    assert.equal(me.user.rejected, true);
    const res = await h.call('workspaces', 'POST', { user: FRANK, body: { name: 'Frank Household', kind: 'personal' } });
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /not approved/);
  });

  test('a site administrator may reconsider a rejection and approve afterwards', async () => {
    const h = harness();
    await enableAccountRequests(h);
    ok(await h.call('me', 'GET', { user: FRANK }));
    ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'reject-user' }, body: { subject: `google:${FRANK.userId}` } }));
    ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'approve-user' }, body: { subject: `google:${FRANK.userId}` } }));
    const me = ok(await h.call('me', 'GET', { user: FRANK }));
    assert.equal(me.user.pendingApproval, false);
    assert.equal(me.user.rejected, false);
  });

  test('approving or rejecting an already-approved account is refused, never a silent no-op', async () => {
    const h = harness();
    await enableAccountRequests(h);
    ok(await h.call('me', 'GET', { as: 'alice' }));
    ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'approve-user' }, body: { subject: 'google:g-alice' } }));
    const res = await h.call('analytics', 'POST', { as: 'dave', query: { action: 'reject-user' }, body: { subject: 'google:g-alice' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'already_approved');
  });

  test('approving or rejecting twice in a row is refused, never a silent no-op', async () => {
    const h = harness();
    await enableAccountRequests(h);
    ok(await h.call('me', 'GET', { user: FRANK }));
    ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'reject-user' }, body: { subject: `google:${FRANK.userId}` } }));
    const res = await h.call('analytics', 'POST', { as: 'dave', query: { action: 'reject-user' }, body: { subject: `google:${FRANK.userId}` } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'no_change');
  });

  test('approving or rejecting an unknown subject is a plain 404, never revealing whether the account exists some other way', async () => {
    const h = harness();
    await enableAccountRequests(h);
    const res = await h.call('analytics', 'POST', { as: 'dave', query: { action: 'approve-user' }, body: { subject: 'google:g-nobody' } });
    assert.equal(res.status, 404);
  });
});
