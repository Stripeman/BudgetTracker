'use strict';
// BT-009-25 (Terry, 2026-09-19): linked refunds — "retain the original expense and record a
// separate linked refund. Default to the original allocation, allow an explicitly reviewed
// adjustment, and show the effects on balances and any resulting repayment obligations. Never
// silently rewrite confirmed settlements." Worked example and its corrected, hand-verified
// zero-sum trace in docs/BT-009-25-WORKED-EXAMPLES.md §3 before this was implemented. All data is
// fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Refund Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const join = async (w, role) => {
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: USERS[w].email, role } }), 201);
    ok(await h.call('invitations', 'POST', { as: w, query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  };
  await join('bob', 'member');
  await join('carol', 'member');
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const mid = (name) => members.find((m) => m.name.startsWith(name)).id;
  const refs = { alice: `member:${mid('Alice')}`, bob: `member:${mid('Bob')}`, carol: `member:${mid('Carol')}` };
  return { ws, q, refs };
}
const G = (h, f, as, method, opts = {}) => h.call('group', method, { as, query: { ...f.q, ...(opts.query || {}) }, body: opts.body });
const act = (h, f, as, action, body) => G(h, f, as, 'POST', { query: { action }, body });
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });
const netOf = (rows, ref) => rows.find((r) => r.ref === ref).netMinor;
const balances = async (h, f) => ok(await G(h, f, 'alice', 'GET', { query: { action: 'balances' } })).balances[0];

describe('BT-009-25 linked refunds', () => {
  test('any writer who could correct the expense records a refund; a viewer may not; the original expense is never edited', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = ok(await G(h, f, 'alice', 'POST', { body: { description: 'Fictional dinner', amount: '90.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.carol) } }), 201).expense;
    const carolTry = await act(h, f, 'carol', 'create-refund', { expenseId: e.id, amount: '30.00', reason: 'Overcharge' });
    // Carol did not create the expense and is not a manager/owner — refused by the same rule as
    // correcting the expense (only the creator, or a manager/owner, by default).
    assert.equal(carolTry.status, 403);
    const refund = ok(await act(h, f, 'alice', 'create-refund', { expenseId: e.id, amount: '30.00', reason: 'Restaurant overcharge' }), 201).refund;
    assert.equal(refund.amountMinor, 3000);
    assert.equal(refund.refundOf, e.id);
    // Default allocation = the original expense's own split (same method, same people).
    assert.equal(refund.split.method, 'equal');
    assert.deepEqual(refund.shares.map((s) => s.ref).sort(), [f.refs.alice, f.refs.bob, f.refs.carol].sort());
    const view = ok(await G(h, f, 'alice', 'GET'));
    const original = view.expenses.find((x) => x.id === e.id);
    assert.equal(original.amount, '90.00', 'the original expense record itself is never edited');
    assert.equal(original.split.method, 'equal');
    assert.equal(original.refunded, '30.00', 'the expense view shows how much has been refunded');
  });

  test('a refund cannot exceed the expense total, alone or combined with an earlier one', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = ok(await G(h, f, 'alice', 'POST', { body: { description: 'x', amount: '50.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) } }), 201).expense;
    assert.equal((await act(h, f, 'alice', 'create-refund', { expenseId: e.id, amount: '60.00', reason: 'too much' })).status, 409);
    ok(await act(h, f, 'alice', 'create-refund', { expenseId: e.id, amount: '30.00', reason: 'partial' }), 201);
    assert.equal((await act(h, f, 'alice', 'create-refund', { expenseId: e.id, amount: '25.00', reason: 'too much combined' })).status, 409);
    ok(await act(h, f, 'alice', 'create-refund', { expenseId: e.id, amount: '20.00', reason: 'the rest, exactly' }), 201);
  });

  test('an explicitly reviewed adjustment allocates the refund differently from the original split', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = ok(await G(h, f, 'alice', 'POST', { body: { description: 'x', amount: '90.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.carol) } }), 201).expense;
    // Only Bob's item was defective — the refund is allocated to him alone, not split three ways.
    const refund = ok(await act(h, f, 'alice', 'create-refund', { expenseId: e.id, amount: '10.00', reason: "Bob's item only", split: { method: 'equal', lines: [{ ref: f.refs.bob }] } }), 201).refund;
    assert.deepEqual(refund.shares.map((s) => s.ref), [f.refs.bob]);
    assert.equal(refund.shares[0].amountMinor, 1000);
  });

  test('a refund is blocked once the linked event is closed, exactly like a correction; voiding a refund needs a reason and keeps it in history', async () => {
    const h = harness();
    const f = await fixture(h);
    const ev = ok(await act(h, f, 'alice', 'create-event', { name: 'Trip' }), 201).event;
    const e = ok(await G(h, f, 'alice', 'POST', { body: { description: 'x', amount: '40.00', eventId: ev.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) } }), 201).expense;
    const refund = ok(await act(h, f, 'alice', 'create-refund', { expenseId: e.id, amount: '10.00', reason: 'x' }), 201).refund;
    // While the event is still active: voiding needs a real reason.
    const noReason = await act(h, f, 'alice', 'void-refund', { refundId: refund.id });
    assert.equal(noReason.status, 400);
    const voided = ok(await act(h, f, 'alice', 'void-refund', { refundId: refund.id, reason: 'made in error' })).refund;
    assert.equal(voided.status, 'void');
    const stillThere = ok(await G(h, f, 'alice', 'GET', { query: { eventId: ev.id } })).refunds.find((r) => r.id === refund.id);
    assert.equal(stillThere.status, 'void', 'a voided refund is kept in history, never deleted');
    // Once the event is closed, a NEW refund is refused, exactly like a correction.
    ok(await act(h, f, 'alice', 'event-status', { eventId: ev.id, status: 'closed' }));
    assert.equal((await act(h, f, 'alice', 'create-refund', { expenseId: e.id, amount: '5.00', reason: 'too late' })).status, 409);
  });

  test('the worked example from docs/BT-009-25-WORKED-EXAMPLES.md §3, hand-computed and verified to a real zero-sum result: a refund after a confirmed settlement creates a genuine new repayment obligation, never rewriting the confirmed settlement', async () => {
    const h = harness();
    const f = await fixture(h);
    // EUR 90.00 dinner, Alice pays, split equally three ways (30.00 each).
    const e = ok(await G(h, f, 'alice', 'POST', { body: { description: 'Fictional dinner', amount: '90.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.carol) } }), 201).expense;
    // Bob's 30.00 payment to Alice is reported and CONFIRMED before any refund exists.
    const settle = ok(await act(h, f, 'bob', 'settle', { from: f.refs.bob, to: f.refs.alice, amount: '30.00' }), 201).settlement;
    ok(await act(h, f, 'alice', 'confirm', { settlementId: settle.id, revision: settle.revision }));
    const before = await balances(h, f);
    assert.equal(netOf(before.rows, f.refs.alice), 3000, 'Alice: +60 paid/share, -30 already received from Bob');
    assert.equal(netOf(before.rows, f.refs.bob), 0, 'Bob is settled up');
    assert.equal(netOf(before.rows, f.refs.carol), -3000, 'Carol has not paid yet');

    // A week later, the restaurant refunds Alice EUR 30.00. Default allocation = the original equal
    // split (10.00 reduction to each of Alice/Bob/Carol's true share).
    ok(await act(h, f, 'alice', 'create-refund', { expenseId: e.id, amount: '30.00', reason: 'Restaurant overcharge' }), 201);

    // The confirmed settlement itself is NEVER rewritten.
    const settlementsAfter = ok(await G(h, f, 'alice', 'GET')).settlements;
    const bobsSettlement = settlementsAfter.find((s) => s.id === settle.id);
    assert.equal(bobsSettlement.status, 'confirmed');
    assert.equal(bobsSettlement.amount, '30.00', "Bob's original confirmed 30.00 payment is untouched");

    // The corrected, hand-verified zero-sum result from the worked-examples doc:
    // Alice = paid(60, after the refund reduces her 90 by 30) - share(20) - received(30 from Bob) = +10.00
    // Bob    = share(20) - paid-in-full(30, his own earlier settlement counted as payment) = +10.00 (he
    //          overpaid relative to his now-reduced share, so the group owes HIM — a genuine new
    //          repayment obligation, exactly as Terry's instruction names it)
    // Carol  = share(20) - paid(0) = -20.00
    // Sum: +10.00 + 10.00 - 20.00 = 0.00 (the zero-sum invariant every balance in this codebase holds)
    const after = await balances(h, f);
    assert.equal(netOf(after.rows, f.refs.alice), 1000, 'Alice: +60 paid/share, -30 received from Bob (with amounts reduced by the refund)');
    assert.equal(netOf(after.rows, f.refs.bob), 1000, "Bob overpaid his now-reduced 20.00 share by paying 30.00 — a genuine new repayment obligation owed to him, never touching his original confirmed settlement");
    assert.equal(netOf(after.rows, f.refs.carol), -2000, "Carol's own unpaid share reduced from 30.00 to 20.00 by the refund");
    const sum = after.rows.reduce((s, r) => s + r.netMinor, 0);
    assert.equal(sum, 0, 'the zero-sum invariant holds after a refund, exactly like every other balance in this codebase');
  });

  test('backup/restore: a refund is backed up and restored (replace), and a refund naming another member blocks create-new exactly like an expense naming one', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = ok(await G(h, f, 'alice', 'POST', { body: { description: 'Fictional dinner', amount: '90.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.carol) } }), 201).expense;
    ok(await act(h, f, 'alice', 'create-refund', { expenseId: e.id, amount: '30.00', reason: 'Restaurant overcharge' }), 201);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    // create-new is blocked: the refund's own allocation names Bob and Carol, other real members —
    // exactly the same rule as an expense naming them (groups.recordRefs now includes a refund's
    // own shares, so this is not a silent exception).
    const pvNew = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }));
    assert.equal(pvNew.canExecute, false);
    assert.match(pvNew.blockers[0], /Shared expenses in this backup name other members/);
    // Void the refund, add another one after the backup, so replace has something to undo.
    const secondExpense = ok(await G(h, f, 'alice', 'POST', { body: { description: 'y', amount: '10.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) } }), 201).expense;
    ok(await act(h, f, 'alice', 'create-refund', { expenseId: secondExpense.id, amount: '5.00', reason: 'after backup' }), 201);
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace' } }));
    assert.equal(pv.scope.groupRefunds, 1);
    ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' } }));
    const restored = ok(await G(h, f, 'alice', 'GET')).refunds;
    assert.equal(restored.length, 1);
    assert.equal(restored[0].amountMinor, 3000);
  });

  test('groups.invariantProblem refuses a refund naming an unknown expense, an invalid split, shares that do not reconcile, or a total that exceeds the expense', () => {
    const groups = require('../_shared/groups');
    const base = { members: [{ id: 'a', subject: 's:a' }, { id: 'b', subject: 's:b' }], contacts: [], categories: [] };
    const expense = { id: 'gex_1', currency: 'EUR', amountMinor: 5000, payers: [{ ref: 'member:a', amountMinor: 5000 }], shares: [{ ref: 'member:a', amountMinor: 2500 }, { ref: 'member:b', amountMinor: 2500 }], split: { method: 'equal', lines: [{ ref: 'member:a', value: null }, { ref: 'member:b', value: null }] } };
    const validRefund = { id: 'grf_1', refundOf: 'gex_1', amountMinor: 1000, currency: 'EUR', split: { method: 'equal', lines: [{ ref: 'member:a', value: null }, { ref: 'member:b', value: null }] }, shares: [{ ref: 'member:a', amountMinor: 500 }, { ref: 'member:b', amountMinor: 500 }] };
    assert.equal(groups.invariantProblem({ ...base, groupExpenses: [expense], groupSettlements: [], groupRefunds: [{ ...validRefund, refundOf: 'gex_nosuch' }] }), 'group refund reference');
    assert.equal(groups.invariantProblem({ ...base, groupExpenses: [expense], groupSettlements: [], groupRefunds: [{ ...validRefund, shares: [{ ref: 'member:a', amountMinor: 999 }, { ref: 'member:b', amountMinor: 500 }] }] }), 'group refund shares');
    assert.equal(groups.invariantProblem({ ...base, groupExpenses: [expense], groupSettlements: [], groupRefunds: [{ ...validRefund, amountMinor: 6000, shares: [{ ref: 'member:a', amountMinor: 3000 }, { ref: 'member:b', amountMinor: 3000 }] }] }), 'group refund total exceeds expense');
    assert.equal(groups.invariantProblem({ ...base, groupExpenses: [expense], groupSettlements: [], groupRefunds: [validRefund] }), null);
  });
});
