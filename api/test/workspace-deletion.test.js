'use strict';
// BT-014 whole-workspace permanent deletion (Terry, 2026-09-17): an explicit exception to the
// per-record cascade rule. An owner may permanently delete their own workspace; a site
// administrator may perform the same administrative deletion without ever gaining visibility into
// its private financial content. Both go through the same impact/confirm/audit logic
// (api/_shared/workspace-deletion.js). All data is fictional; expected values are worked out by
// hand.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

describe('BT-014 whole-workspace permanent deletion', () => {
  test('an owner sees the impact (counts only), then permanently deletes their own workspace after two confirmations', async () => {
    const h = harness();
    const f = await household(h);
    const imp = ok(await h.call('workspaces', 'POST', { as: 'alice', query: { id: f.ws.id, action: 'delete-impact' } })).impact;
    assert.equal(imp.blocked, false);
    assert.equal(imp.confirmPhrase, 'Fictional Household');
    assert.equal(imp.datasets.accounts, 3, 'joint, alice savings, bob card');
    assert.equal(imp.datasets.transactions, 2, 'secret + grocery');
    assert.equal(imp.datasets.members, 3);
    // The wrong typed confirmation refuses it.
    const wrong = await h.call('workspaces', 'POST', { as: 'alice', query: { id: f.ws.id, action: 'delete-permanent' }, body: { impactToken: imp.token, typedConfirmation: 'not the name' } });
    assert.equal(wrong.status, 400);
    // The right one, with a stale token, is refused too.
    const stale = await h.call('workspaces', 'POST', { as: 'alice', query: { id: f.ws.id, action: 'delete-permanent' }, body: { impactToken: 'not-a-real-token', typedConfirmation: 'Fictional Household' } });
    assert.equal(stale.status, 409);
    // Correct token and phrase together: it is really gone.
    ok(await h.call('workspaces', 'POST', { as: 'alice', query: { id: f.ws.id, action: 'delete-permanent' }, body: { impactToken: imp.token, typedConfirmation: 'Fictional Household' } }));
    for (const who of ['alice', 'bob', 'carol']) {
      assert.equal((await h.call('workspaces', 'GET', { as: who, query: { id: f.ws.id } })).status, 404, `${who} loses access entirely, owner included`);
    }
    const doc = JSON.parse((await h.storage.getBytes(`workspaces/${f.ws.id}/workspace.json`)).bytes.toString());
    assert.equal(doc.status, 'deleted-permanent');
    assert.deepEqual(doc.accounts, []);
    assert.deepEqual(doc.transactions, []);
    assert.deepEqual(doc.members, []);
    assert.deepEqual(doc.audit, [], 'the workspace-local audit is wiped with everything else');
    // The summary survives OUTSIDE the workspace: actor, counts, outcome — never a name or balance.
    const log = JSON.parse((await h.storage.getBytes('site/deletions.json')).bytes.toString());
    const entry = log.entries.find((e) => e.workspaceId === f.ws.id);
    assert.equal(entry.outcome, 'completed');
    assert.equal(entry.actorRole, 'owner');
    assert.equal(entry.datasets.accounts, 3);
    assert.equal(JSON.stringify(entry).includes('Fictional Household'), false, 'no workspace name in the outside record');
  });

  test('a member, a viewer and an outsider cannot permanently delete the workspace; only an owner can', async () => {
    const h = harness();
    const f = await household(h);
    for (const who of ['bob', 'carol']) {
      assert.equal((await h.call('workspaces', 'POST', { as: who, query: { id: f.ws.id, action: 'delete-impact' } })).status, 403, who);
    }
    assert.equal((await h.call('workspaces', 'POST', { as: 'eve', query: { id: f.ws.id, action: 'delete-impact' } })).status, 404, 'an outsider learns nothing');
  });

  test('a workspace with Shared-expenses involvement is refused, not guessed at (the fuller download/sever flow is not built in this version)', async () => {
    const h = harness();
    const f = await household(h);
    // Seeded directly (bypassing /api/group, whose expense/split contract is exercised by its own
    // suite): this test is only about the workspace-deletion blocker, not Shared expenses itself.
    const path = `workspaces/${f.ws.id}/workspace.json`;
    const raw = JSON.parse((await h.storage.getBytes(path)).bytes.toString());
    raw.groupExpenses = [{ id: 'gex_seed', description: 'x', currency: 'EUR', amountMinor: 100 }];
    await h.storage.putBytes(path, Buffer.from(JSON.stringify(raw)), { ifMatch: (await h.storage.getBytes(path)).etag });
    const imp = ok(await h.call('workspaces', 'POST', { as: 'alice', query: { id: f.ws.id, action: 'delete-impact' } })).impact;
    assert.equal(imp.blocked, true);
    assert.match(imp.blockers[0], /Shared-expenses/);
  });

  test('site administrator: the directory lists workspaces by counts only, never a name or balance; administrative deletion reuses the same logic', async () => {
    const h = harness();
    const f = await household(h);
    // Not a member: the ordinary member-gated route is unreachable to the site administrator.
    assert.equal((await h.call('workspaces', 'GET', { as: 'dave', query: { id: f.ws.id } })).status, 404);
    const dir = ok(await h.call('analytics', 'GET', { as: 'dave', query: { action: 'directory' } }));
    const entry = dir.workspaces.find((w) => w.id === f.ws.id);
    assert.ok(entry, 'the site admin can enumerate it without being a member');
    assert.equal(entry.datasets.accounts, 3);
    assert.equal(entry.memberCount, 3);
    assert.equal(JSON.stringify(entry).includes('Joint'), false, 'no account or workspace name, ever');
    assert.equal(JSON.stringify(entry).includes('Fictional Household'), false);

    assert.equal((await h.call('analytics', 'GET', { as: 'alice', query: { action: 'directory' } })).status, 403, 'never a member, even the owner');

    const imp = ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'delete-impact', workspaceId: f.ws.id } })).impact;
    assert.equal(imp.blocked, false);
    assert.equal(JSON.stringify(imp).includes('Fictional Household'), true, 'the confirmation phrase is the only place the name appears, and only to the admin actually confirming a deletion they were already given the id for');
    ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'delete-permanent', workspaceId: f.ws.id }, body: { impactToken: imp.token, typedConfirmation: imp.confirmPhrase } }));
    assert.equal((await h.call('workspaces', 'GET', { as: 'alice', query: { id: f.ws.id } })).status, 404, 'gone for the owner too');
    const log = JSON.parse((await h.storage.getBytes('site/deletions.json')).bytes.toString());
    assert.equal(log.entries.find((e) => e.workspaceId === f.ws.id).actorRole, 'site-admin');
  });

  test('an outsider (not a site administrator) cannot reach the directory or administrative deletion', async () => {
    const h = harness();
    const f = await household(h);
    assert.equal((await h.call('analytics', 'GET', { as: 'eve', query: { action: 'directory' } })).status, 403);
    assert.equal((await h.call('analytics', 'POST', { as: 'eve', query: { action: 'delete-impact', workspaceId: f.ws.id } })).status, 403);
  });
});
