'use strict';
// BT-009-25 (Terry, 2026-09-19): couples/families as an "optional settlement unit containing
// individually identifiable participants. Preserve each person's expense and payment attribution;
// aggregate only for the selected settlement view. Unit membership must not grant access, rewrite
// historical allocations or silently move liability between people." Worked example and expected
// balances traced in docs/BT-009-25-WORKED-EXAMPLES.md §1 before this was implemented. All data is
// fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Unit Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const join = async (w, role) => {
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: USERS[w].email, role } }), 201);
    ok(await h.call('invitations', 'POST', { as: w, query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  };
  await join('bob', 'member');
  await join('carol', 'viewer');
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const mid = (name) => members.find((m) => m.name.startsWith(name)).id;
  const refs = { alice: `member:${mid('Alice')}`, bob: `member:${mid('Bob')}`, carol: `member:${mid('Carol')}` };
  return { ws, q, refs };
}
const G = (h, f, as, method, opts = {}) => h.call('group', method, { as, query: { ...f.q, ...(opts.query || {}) }, body: opts.body });
const act = (h, f, as, action, body) => G(h, f, as, 'POST', { query: { action }, body });
const units = async (h, f, as = 'alice') => ok(await G(h, f, as, 'GET', { query: { action: 'units' } })).units;
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });

describe('BT-009-25 settlement units (couples/families)', () => {
  test('any writer creates a unit naming >=2 real people; a viewer may not; it appears in the directory and the main view', async () => {
    const h = harness();
    const f = await fixture(h);
    const viewerTry = await act(h, f, 'carol', 'create-unit', { name: 'The Smiths', memberRefs: [f.refs.alice, f.refs.bob] });
    assert.equal(viewerTry.status, 403);
    const created = ok(await act(h, f, 'bob', 'create-unit', { name: 'The Smiths', memberRefs: [f.refs.alice, f.refs.bob] }), 201).unit;
    assert.equal(created.name, 'The Smiths');
    assert.deepEqual(created.memberRefs, [f.refs.alice, f.refs.bob]);
    const list = await units(h, f, 'alice');
    assert.equal(list.length, 1);
    const v = ok(await G(h, f, 'alice', 'GET'));
    assert.equal(v.settlementUnits.length, 1, 'embedded in the main view too');
  });

  test('fewer than two people, a duplicate person, an unknown ref, or a private contact are all refused', async () => {
    const h = harness();
    const f = await fixture(h);
    assert.equal((await act(h, f, 'alice', 'create-unit', { name: 'x', memberRefs: [f.refs.alice] })).status, 400);
    assert.equal((await act(h, f, 'alice', 'create-unit', { name: 'x', memberRefs: [f.refs.alice, f.refs.alice] })).status, 400);
    assert.equal((await act(h, f, 'alice', 'create-unit', { name: 'x', memberRefs: [f.refs.alice, 'member:nosuch00000'] })).status, 400);
  });

  test('a person already in one active unit cannot be named in a second active unit', async () => {
    const h = harness();
    const f = await fixture(h);
    ok(await act(h, f, 'alice', 'create-unit', { name: 'The Smiths', memberRefs: [f.refs.alice, f.refs.bob] }), 201);
    const overlap = await act(h, f, 'alice', 'create-unit', { name: 'Also Bob', memberRefs: [f.refs.bob, f.refs.carol] });
    assert.equal(overlap.status, 409);
  });

  test('deleting a unit removes it from the directory but is soft (kept for audit), and does not free its members for a new overlapping unit incorrectly — it does, once actually removed', async () => {
    const h = harness();
    const f = await fixture(h);
    const created = ok(await act(h, f, 'alice', 'create-unit', { name: 'The Smiths', memberRefs: [f.refs.alice, f.refs.bob] }), 201).unit;
    const deleteTry = await act(h, f, 'carol', 'delete-unit', { unitId: created.id });
    assert.equal(deleteTry.status, 403, 'not the creator, not a manager');
    ok(await act(h, f, 'alice', 'delete-unit', { unitId: created.id }));
    assert.equal((await units(h, f)).length, 0);
    // Now Bob can be named in a new unit — the old one no longer counts as an overlap.
    ok(await act(h, f, 'alice', 'create-unit', { name: 'Bob and Carol', memberRefs: [f.refs.bob, f.refs.carol] }), 201);
  });

  test('a unit changes NOTHING about who paid what or who owes what — the worked example from docs/BT-009-25-WORKED-EXAMPLES.md §1, hand-computed', async () => {
    const h = harness();
    const f = await fixture(h);
    // EUR 90.00 dinner, Alice pays, split equally three ways.
    await ok(await G(h, f, 'alice', 'POST', { body: { description: 'Fictional dinner', amount: '90.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.carol) } }), 201);
    const before = ok(await G(h, f, 'alice', 'GET', { query: { action: 'balances' } })).balances[0];
    const netOf = (rows, ref) => rows.find((r) => r.ref === ref).netMinor;
    assert.equal(netOf(before.rows, f.refs.alice), 6000);
    assert.equal(netOf(before.rows, f.refs.bob), -3000);
    assert.equal(netOf(before.rows, f.refs.carol), -3000);
    // Creating "The Smiths" (Alice+Carol — Carol is a viewer in this fixture, so Bob, a member, is
    // used as the one who reports the payment below; the arithmetic is identical either way) must
    // not change any of the above.
    ok(await act(h, f, 'alice', 'create-unit', { name: 'The Smiths', memberRefs: [f.refs.alice, f.refs.carol] }), 201);
    const after = ok(await G(h, f, 'alice', 'GET', { query: { action: 'balances' } })).balances[0];
    assert.equal(netOf(after.rows, f.refs.alice), 6000, 'a unit never changes an individual net');
    assert.equal(netOf(after.rows, f.refs.bob), -3000);
    assert.equal(netOf(after.rows, f.refs.carol), -3000);
    // The unit-aware suggestion combines Alice+Carol into one node: Bob -> The Smiths, 30.00 — one
    // payment instead of two, but naming a REAL person to actually receive it (the member with the
    // larger-magnitude individual basis — here Alice, +60 vs Carol's -30).
    assert.equal(after.unitSuggestions.length, 1);
    const s = after.unitSuggestions[0];
    assert.equal(s.from, f.refs.bob);
    assert.equal(s.toIsUnit, true);
    assert.equal(s.toName, 'The Smiths');
    assert.equal(s.toRef, f.refs.alice, 'the real receiving person is always named, never hidden behind the unit');
    assert.equal(s.amountMinor, 3000);
    // Recording and confirming that exact settlement (Bob -> Alice 30.00) must land on the SAME
    // individual balances an ordinary, non-unit settlement always has — proving the unit changed
    // only the suggestion, never the arithmetic.
    const settle = ok(await act(h, f, 'bob', 'settle', { from: f.refs.bob, to: f.refs.alice, amount: '30.00' }), 201).settlement;
    ok(await act(h, f, 'alice', 'confirm', { settlementId: settle.id, revision: settle.revision }));
    const final = ok(await G(h, f, 'alice', 'GET', { query: { action: 'balances' } })).balances[0];
    assert.equal(netOf(final.rows, f.refs.alice), 3000, 'Alice: +60 paid/share, -30 received from Bob');
    assert.equal(netOf(final.rows, f.refs.carol), -3000, 'Carol is completely untouched by a settlement she was never party to');
    assert.equal(netOf(final.rows, f.refs.bob), 0, 'Bob is settled up');
  });

  test('groups.invariantProblem refuses a unit with fewer than two members, a duplicate member, an unknown ref, or two active units overlapping on the same person', () => {
    const groups = require('../_shared/groups');
    const base = { members: [{ id: 'a', subject: 's:a' }, { id: 'b', subject: 's:b' }], contacts: [], categories: [], groupExpenses: [], groupSettlements: [] };
    assert.equal(groups.invariantProblem({ ...base, groupSettlementUnits: [{ id: 'u1', memberRefs: ['member:a'], active: true }] }), 'settlement unit members');
    assert.equal(groups.invariantProblem({ ...base, groupSettlementUnits: [{ id: 'u1', memberRefs: ['member:a', 'member:a'], active: true }] }), 'settlement unit members');
    assert.equal(groups.invariantProblem({ ...base, groupSettlementUnits: [{ id: 'u1', memberRefs: ['member:a', 'member:nosuch'], active: true }] }), 'settlement unit members');
    assert.equal(groups.invariantProblem({ ...base, groupSettlementUnits: [{ id: 'u1', memberRefs: ['member:a'], active: true }, { id: 'u1', memberRefs: ['member:b'], active: true }] }), 'settlement unit ids');
    assert.equal(groups.invariantProblem({ ...base, groupSettlementUnits: [{ id: 'u1', memberRefs: ['member:a', 'member:b'], active: true }, { id: 'u2', memberRefs: ['member:a', 'member:b'], active: true }] }), 'settlement unit overlap');
    // An inactive (deleted) unit is excluded from the overlap check — it may freely share a member
    // with a currently-active one.
    assert.equal(groups.invariantProblem({ ...base, groupSettlementUnits: [{ id: 'u1', memberRefs: ['member:a', 'member:b'], active: false }, { id: 'u2', memberRefs: ['member:a', 'member:b'], active: true }] }), null);
  });

  test('backup/restore: a settlement unit is backed up and restored (replace/merge)', async () => {
    const h = harness();
    const f = await fixture(h);
    ok(await act(h, f, 'alice', 'create-unit', { name: 'The Smiths', memberRefs: [f.refs.alice, f.refs.bob] }), 201);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    // A genuine change after the backup, so there is something for replace to actually undo.
    ok(await act(h, f, 'alice', 'delete-unit', { unitId: (await units(h, f, 'alice'))[0].id }));
    assert.equal((await units(h, f, 'alice')).length, 0);
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace' } }));
    assert.equal(pv.scope.groupSettlementUnits, 1);
    ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' } }));
    const restored = await units(h, f, 'alice');
    assert.equal(restored.length, 1);
    assert.equal(restored[0].name, 'The Smiths');
  });

  test('backup/restore: a settlement unit naming another member is dropped on create-new (never left half-formed naming someone who does not exist there)', async () => {
    const h = harness();
    const f = await fixture(h);
    // No expense ever names Bob, so create-new is not blocked outright — only the unit itself would
    // end up naming a "former member" once Bob's own identity does not come along.
    ok(await act(h, f, 'alice', 'create-unit', { name: 'The Smiths', memberRefs: [f.refs.alice, f.refs.bob] }), 201);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }));
    assert.equal(pv.canExecute, true, JSON.stringify(pv.blockers));
    const exec = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }), 201);
    const newUnits = ok(await h.call('group', 'GET', { as: 'alice', query: { workspaceId: exec.workspace.id, action: 'units' } })).units;
    assert.equal(newUnits.length, 0, 'a unit naming a member who does not exist in the new workspace is dropped, never left half-formed');
  });
});
