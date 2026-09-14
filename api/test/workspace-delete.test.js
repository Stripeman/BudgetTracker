'use strict';
// An owner deletes their own workspace (Terry, 2026-09-14: "the workspace owner should be able to delete
// their own workspace(s)"). Underneath it is the recoverable archive — nothing is ever physically deleted
// (BT-001-05) — but it must really take the workspace away: nobody reaches its records, it leaves members'
// lists, owners keep it under "Deleted workspaces" and bring it back, and then everyone's access returns.
// Fictional data only.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household, USERS } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const UNAVAILABLE = 'This workspace is not available.';

describe('deleting a workspace (the recoverable archive underneath)', () => {
  test('nobody reaches a deleted workspace, owners included; outsiders still learn nothing', async () => {
    const h = harness();
    const f = await household(h);
    ok(await h.call('accounts', 'GET', { as: 'bob', query: f.q }));
    ok(await h.call('workspaces', 'DELETE', { as: 'alice', query: { id: f.ws.id }, body: { reason: 'No longer needed' } }));

    for (const as of ['alice', 'bob', 'carol']) {
      for (const [route, method, query, body] of [
        ['accounts', 'GET', f.q], ['transactions', 'GET', f.q], ['members', 'GET', f.q], ['budgets', 'GET', f.q],
        ['workspaces', 'GET', { id: f.ws.id }],
        ['transactions', 'POST', f.q, { accountId: f.joint.id, kind: 'expense', amount: '1.00' }],
        ['workspaces', 'PATCH', { id: f.ws.id }, { name: 'Renamed' }],
      ]) {
        const res = await h.call(route, method, { as, query, body });
        assert.deepEqual([res.status, res.body.error.code, res.body.error.message], [404, 'not_found', UNAVAILABLE], `${as} ${method} ${route}`);
      }
    }
    // Someone who never belonged gets the same answer as for a workspace that does not exist.
    const eve = await h.call('accounts', 'GET', { as: 'eve', query: f.q });
    assert.deepEqual([eve.status, eve.body.error.message], [404, 'Unknown workspace.']);
    const dave = await h.call('accounts', 'GET', { as: 'dave', query: f.q });
    assert.deepEqual([dave.status, dave.body.error.message], [404, 'Unknown workspace.'], 'a site administrator gains nothing either');
  });

  test('it leaves members\' lists; owners keep it as deleted, with when', async () => {
    const h = harness();
    const f = await household(h);
    ok(await h.call('workspaces', 'DELETE', { as: 'alice', query: { id: f.ws.id }, body: { reason: 'No longer needed' } }));
    for (const as of ['bob', 'carol']) {
      assert.ok(!ok(await h.call('workspaces', 'GET', { as })).workspaces.some((w) => w.id === f.ws.id), `${as}'s workspace list`);
      assert.ok(!ok(await h.call('me', 'GET', { as })).workspaces.some((w) => w.id === f.ws.id), `${as}'s /api/me`);
    }
    for (const list of [ok(await h.call('workspaces', 'GET', { as: 'alice' })).workspaces, ok(await h.call('me', 'GET', { as: 'alice' })).workspaces]) {
      const mine = list.find((w) => w.id === f.ws.id);
      assert.deepEqual([mine.status, mine.role, mine.archivedAt], ['archived', 'owner', '2026-09-13T10:00:00.000Z']);
    }
  });

  test('only an owner deletes or brings it back; a member cannot even see that it is there', async () => {
    const h = harness();
    const f = await household(h);
    code(await h.call('workspaces', 'DELETE', { as: 'bob', query: { id: f.ws.id }, body: {} }), 403, 'forbidden');
    ok(await h.call('workspaces', 'DELETE', { as: 'alice', query: { id: f.ws.id }, body: { reason: 'No longer needed' } }));
    // Deleting again changes nothing and still answers the owner.
    assert.equal(ok(await h.call('workspaces', 'DELETE', { as: 'alice', query: { id: f.ws.id }, body: {} })).workspace.status, 'archived');
    for (const as of ['bob', 'carol']) {
      assert.equal((await h.call('workspaces', 'POST', { as, query: { id: f.ws.id, action: 'restore' }, body: {} })).status, 404, `${as} bring back`);
      assert.equal((await h.call('workspaces', 'DELETE', { as, query: { id: f.ws.id }, body: {} })).status, 404, `${as} delete`);
    }
  });

  test('an invitation to a deleted workspace is not valid', async () => {
    const h = harness();
    const f = await household(h);
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: USERS.eve.email, role: 'member' } }), 201);
    ok(await h.call('workspaces', 'DELETE', { as: 'alice', query: { id: f.ws.id }, body: {} }));
    const body = { workspaceId: f.ws.id, token: inv.token };
    code(await h.call('invitations', 'POST', { as: 'eve', query: { action: 'preview' }, body }), 404, 'not_found');
    code(await h.call('invitations', 'POST', { as: 'eve', query: { action: 'accept' }, body }), 404, 'not_found');
    assert.ok(!ok(await h.call('me', 'GET', { as: 'eve' })).workspaces.some((w) => w.id === f.ws.id));
    // Brought back, the same (unexpired) invitation works again: nothing about it was changed.
    ok(await h.call('workspaces', 'POST', { as: 'alice', query: { id: f.ws.id, action: 'restore' }, body: {} }));
    ok(await h.call('invitations', 'POST', { as: 'eve', query: { action: 'accept' }, body }));
  });

  test('brought back, everything is as it was and everyone has their access again; the reasons are kept', async () => {
    const h = harness();
    const f = await household(h);
    const before = ok(await h.call('transactions', 'GET', { as: 'bob', query: f.q })).transactions.map((t) => [t.id, t.amount]);
    ok(await h.call('workspaces', 'DELETE', { as: 'alice', query: { id: f.ws.id }, body: { reason: 'No longer needed' } }));
    h.clock.advance(60 * 1000);
    const back = ok(await h.call('workspaces', 'POST', { as: 'alice', query: { id: f.ws.id, action: 'restore' }, body: { reason: 'Needed after all' } })).workspace;
    assert.deepEqual([back.status, back.archivedAt], ['active', null]);
    assert.deepEqual(ok(await h.call('transactions', 'GET', { as: 'bob', query: f.q })).transactions.map((t) => [t.id, t.amount]), before);
    assert.ok(ok(await h.call('workspaces', 'GET', { as: 'bob' })).workspaces.some((w) => w.id === f.ws.id && w.status === 'active'));
    ok(await h.call('accounts', 'GET', { as: 'carol', query: f.q }));
    const ws = ok(await h.call('workspaces', 'GET', { as: 'alice', query: { id: f.ws.id } })).workspace;
    assert.deepEqual(ws.lifecycle.map((x) => [x.state, x.by, x.reason]), [['archived', 'Alice Fictional', 'No longer needed'], ['active', 'Alice Fictional', 'Needed after all']]);
    const audit = ok(await h.call('audit', 'GET', { as: 'alice', query: f.q })).entries.map((e) => e.action);
    assert.ok(audit.includes('workspace.archive') && audit.includes('workspace.restore'));
  });

  test('bringing one back at the limit says what to do, in words about bringing it back', async () => {
    const h = harness({ env: { BT_MAX_WORKSPACES: '1' } });
    const one = ok(await h.call('workspaces', 'POST', { as: 'eve', body: { name: 'Fictional One' } }), 201).workspace;
    ok(await h.call('workspaces', 'DELETE', { as: 'eve', query: { id: one.id }, body: {} }));
    ok(await h.call('workspaces', 'POST', { as: 'eve', body: { name: 'Fictional Two' } }), 201);
    const res = await h.call('workspaces', 'POST', { as: 'eve', query: { id: one.id, action: 'restore' }, body: {} });
    assert.deepEqual([res.status, res.body.error.code, res.body.error.message], [409, 'workspace_limit',
      'You can have up to 1 active workspace that you created. Delete one you no longer use, then bring this one back.']);
    const create = await h.call('workspaces', 'POST', { as: 'eve', body: { name: 'Fictional Three' } });
    assert.deepEqual([create.status, create.body.error.message], [409, 'You can have up to 1 active workspace that you created. Delete one you no longer use to create another.']);
  });
});
