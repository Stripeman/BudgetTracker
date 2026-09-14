'use strict';
// BT-001-05 lifecycle and history for bills, budgets, members and workspaces (audit B14, B15,
// B16, C): prior values are kept with who, when and why; archived records come back; nothing is
// dropped.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household, USERS } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };

describe('BT-001-05 lifecycle and history', () => {
  test('B14 bill detail edits keep their before and after values', async () => {
    const h = harness();
    const f = await household(h);
    const bill = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Rent', billType: 'housing', accountId: f.joint.id, amount: '900.00', notes: 'Flat 1', schedule: { freq: 'monthly', interval: 1, startDate: '2026-10-01' } } }), 201).recurring;
    const edited = ok(await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: bill.id, revision: bill.revision, name: 'Rent (new flat)', notes: 'Flat 2', reminderDays: 5, endDate: '2027-09-30' } })).recurring;
    const last = edited.history.at(-1);
    assert.deepEqual(last.fields, ['name', 'notes', 'reminderDays', 'endDate']);
    assert.deepEqual(last.changes, [
      { field: 'name', from: 'Rent', to: 'Rent (new flat)' },
      { field: 'notes', from: 'Flat 1', to: 'Flat 2' },
      { field: 'reminderDays', from: 3, to: 5 },
      { field: 'endDate', from: null, to: '2027-09-30' },
    ]);
  });

  test('budgets are archived with a reason, listed on request and restored; history keeps every step', async () => {
    const h = harness();
    const f = await household(h);
    const categoryId = ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories[0].id;
    const b = ok(await h.call('budgets', 'POST', { as: 'bob', query: f.q, body: { name: 'Mine', lines: [{ categoryId, amount: '100' }] } }), 201).budget;
    const renamed = ok(await h.call('budgets', 'PATCH', { as: 'bob', query: f.q, body: { budgetId: b.id, revision: b.revision, name: 'Groceries plan', reason: 'Clearer' } })).budget;
    ok(await h.call('budgets', 'DELETE', { as: 'bob', query: f.q, body: { budgetId: b.id, revision: renamed.revision, reason: 'Not needed this year' } }));
    assert.ok(!ok(await h.call('budgets', 'GET', { as: 'bob', query: f.q })).budgets.some((x) => x.id === b.id), 'out of the default list');
    const archived = ok(await h.call('budgets', 'GET', { as: 'bob', query: { ...f.q, includeArchived: '1' } })).budgets.find((x) => x.id === b.id);
    assert.deepEqual([archived.archived, archived.archiveReason, archived.name], [true, 'Not needed this year', 'Groceries plan']);
    // Another member's private budget stays invisible, archived or not.
    assert.equal((await h.call('budgets', 'POST', { as: 'alice', query: { ...f.q, action: 'restore' }, body: { budgetId: b.id, revision: archived.revision } })).status, 404);
    code(await h.call('budgets', 'POST', { as: 'bob', query: { ...f.q, action: 'restore' }, body: { budgetId: b.id, revision: archived.revision - 1 } }), 409, 'stale_revision');
    const restored = ok(await h.call('budgets', 'POST', { as: 'bob', query: { ...f.q, action: 'restore' }, body: { budgetId: b.id, revision: archived.revision, reason: 'Needed after all' } })).budget;
    assert.equal(restored.archived, false);
    assert.deepEqual(restored.history.map((x) => [x.by, x.changes.map((c) => `${c.field}:${c.from}->${c.to}`).join(','), x.reason]), [
      ['Bob Fictional', 'name:Mine->Groceries plan', 'Clearer'],
      ['Bob Fictional', 'archived:false->true', 'Not needed this year'],
      ['Bob Fictional', 'archived:true->false', 'Needed after all'],
    ]);
    code(await h.call('budgets', 'POST', { as: 'bob', query: { ...f.q, action: 'restore' }, body: { budgetId: b.id, revision: restored.revision } }), 409, 'not_archived');
  });

  test('B15 role changes, removal and rejoining are kept as membership history; former members stay listed for managers', async () => {
    const h = harness();
    const f = await household(h);
    const carol = f.memberId('Carol');
    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: carol, role: 'member' } }));
    ok(await h.call('members', 'DELETE', { as: 'alice', query: f.q, body: { memberId: carol, reason: 'Moved out' } }));
    const withFormer = ok(await h.call('members', 'GET', { as: 'alice', query: { ...f.q, includeFormer: '1' } }));
    const former = withFormer.former.find((m) => m.id === carol);
    assert.equal(former.status, 'removed');
    assert.deepEqual(former.history.map((x) => [x.event, x.from || x.role, x.to || null, x.by, x.reason || null]), [
      ['role', 'viewer', 'member', 'Alice Fictional', null],
      ['removed', 'member', null, 'Alice Fictional', 'Moved out'],
    ]);
    assert.equal((await h.call('members', 'GET', { as: 'bob', query: { ...f.q, includeFormer: '1' } })).status, 403, 'members do not see former members');
    assert.ok(!ok(await h.call('members', 'GET', { as: 'bob', query: f.q })).members.some((m) => m.id === carol));
    // Carol is invited again and rejoins as a viewer: the earlier period stays in her history.
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: USERS.carol.email, role: 'viewer' } }), 201);
    ok(await h.call('invitations', 'POST', { as: 'carol', query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: inv.token } }));
    const back = ok(await h.call('members', 'GET', { as: 'alice', query: { ...f.q, includeFormer: '1' } })).members.find((m) => m.id === carol);
    assert.deepEqual(back.history.map((x) => x.event), ['role', 'removed', 'rejoined']);
    assert.deepEqual([back.history[2].from, back.history[2].to], ['member', 'viewer']);
  });

  test('B16 workspace edits keep before and after values; archiving and restoring keep who, when and why', async () => {
    const h = harness();
    const f = await household(h);
    const q = { id: f.ws.id };
    ok(await h.call('workspaces', 'PATCH', { as: 'alice', query: q, body: { name: 'Fictional Home', settings: { weekStart: 0 }, reason: 'New house' } }));
    ok(await h.call('workspaces', 'PATCH', { as: 'alice', query: q, body: { name: 'Fictional Home' } }));
    ok(await h.call('workspaces', 'DELETE', { as: 'alice', query: q, body: { reason: 'Paused' } }));
    ok(await h.call('workspaces', 'POST', { as: 'alice', query: { ...q, action: 'restore' }, body: { reason: 'Back again' } }));
    const ws = ok(await h.call('workspaces', 'GET', { as: 'alice', query: q })).workspace;
    assert.deepEqual(ws.history.map((x) => [x.by, x.changes.map((c) => `${c.field}:${c.from}->${c.to}`).join(','), x.reason]), [
      ['Alice Fictional', 'name:Fictional Household->Fictional Home,settings.weekStart:1->0', 'New house'],
    ], 'an unchanged save records nothing');
    assert.deepEqual(ws.lifecycle.map((x) => [x.state, x.by, x.reason]), [['archived', 'Alice Fictional', 'Paused'], ['active', 'Alice Fictional', 'Back again']]);
    assert.equal(ws.status, 'active');
    const asBob = ok(await h.call('workspaces', 'GET', { as: 'bob', query: q })).workspace;
    assert.deepEqual([asBob.history, asBob.lifecycle], [undefined, undefined], 'members see the workspace, not its administration history');
  });
});
