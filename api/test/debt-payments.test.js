'use strict';
// BT-020-03/04 (Terry, 2026-09-19): manual interest, fees and balance corrections on a debt account
// reuse the canonical transactions API (kind 'interest'/'fee'/'adjustment') rather than a parallel
// payment system — the only new rule is that these three kinds, when entered by hand against a
// LIABILITY account, are "explicit, dated, audited... with a reason": a required, non-empty reason
// (the entry's own `notes`). Scoped to liability accounts only, so every existing use of the same
// kinds on an ordinary asset account (a rounding adjustment, say) is completely unaffected — checked
// directly below. All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const txn = (h, q, as, body) => h.call('transactions', 'POST', { as, query: q, body });
const balanceOf = async (h, q, as, id) => (await h.call('accounts', 'GET', { as, query: q })).body.accounts.find((a) => a.id === id).balance;

describe('BT-020-03 manual interest, fee and balance-correction entries on a debt account require a reason', () => {
  test('an interest charge on a debt account without a reason is refused; with one it is recorded and increases what is owed', async () => {
    const h = harness();
    const f = await household(h);
    code(await txn(h, f.q, 'bob', { accountId: f.bobCard.id, kind: 'interest', amount: '30.00' }), 400, 'missing_field');
    const out = ok(await txn(h, f.q, 'bob', { accountId: f.bobCard.id, kind: 'interest', amount: '30.00', notes: 'September statement interest' }), 201);
    assert.equal(out.transactions[0].amount, '-30.00');
    assert.equal(await balanceOf(h, f.q, 'bob', f.bobCard.id), '-280.00');
  });

  test('a fee on a debt account without a reason is refused; with one it is recorded', async () => {
    const h = harness();
    const f = await household(h);
    code(await txn(h, f.q, 'bob', { accountId: f.bobCard.id, kind: 'fee', amount: '5.00' }), 400, 'missing_field');
    ok(await txn(h, f.q, 'bob', { accountId: f.bobCard.id, kind: 'fee', amount: '5.00', notes: 'Late payment fee' }), 201);
    assert.equal(await balanceOf(h, f.q, 'bob', f.bobCard.id), '-255.00');
  });

  test('a balance correction (adjustment) on a debt account without a reason is refused; with one, the entered signed delta is recorded exactly and history stays as amendments, never a rewrite', async () => {
    const h = harness();
    const f = await household(h);
    // Desired balance -300.00, currently -250.00: the adjustment itself is the delta, -50.00.
    code(await txn(h, f.q, 'bob', { accountId: f.bobCard.id, kind: 'adjustment', amount: '-50.00' }), 400, 'missing_field');
    const out = ok(await txn(h, f.q, 'bob', { accountId: f.bobCard.id, kind: 'adjustment', amount: '-50.00', notes: 'Corrected to match the statement' }), 201);
    assert.equal(out.transactions[0].amount, '-50.00');
    assert.equal(await balanceOf(h, f.q, 'bob', f.bobCard.id), '-300.00');
    // The original expense that was already recorded is untouched — a correction is a new entry,
    // never a silent rewrite of history (BT-001-05, CLAUDE.md financial-integrity invariant).
    const original = (await h.call('transactions', 'GET', { as: 'bob', query: { ...f.q, accountId: f.bobCard.id } })).body.transactions.find((t) => t.id === f.secret.id);
    assert.equal(original.amount, '-250.00');
  });

  test('the SAME kinds on an ordinary asset account need no reason at all — the requirement is scoped to debt (liability) accounts only', async () => {
    const h = harness();
    const f = await household(h);
    ok(await txn(h, f.q, 'alice', { accountId: f.joint.id, kind: 'adjustment', amount: '-0.50' }), 201);
    ok(await txn(h, f.q, 'alice', { accountId: f.aliceSavings.id, kind: 'interest', amount: '2.00' }), 201);
  });

  test('a one-off manual payment (transfer) or credit (refund) on a debt account needs no separate reason — only interest/fee/adjustment do', async () => {
    const h = harness();
    const f = await household(h);
    // Bob pays 100.00 from his own... there is no private checking for Bob in this fixture, so pay
    // from the shared Joint account instead (Bob may add entries there as a member).
    ok(await txn(h, f.q, 'bob', { accountId: f.joint.id, kind: 'transfer', amount: '100.00', transfer: { toAccountId: f.bobCard.id } }), 201);
    assert.equal(await balanceOf(h, f.q, 'bob', f.bobCard.id), '-150.00');
    ok(await txn(h, f.q, 'bob', { accountId: f.bobCard.id, kind: 'refund', amount: '20.00' }), 201);
    assert.equal(await balanceOf(h, f.q, 'bob', f.bobCard.id), '-130.00');
  });
});

describe('BT-020-05 integrity: unauthorized destinations, duplicate protection, and edits never rewrite what is recorded', () => {
  test('a debt-payment bill cannot be created against another member\'s private debt account — not found, never revealing it exists', async () => {
    const h = harness();
    const f = await household(h);
    const alicesCard = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Alice Private Card', type: 'credit-card', currency: 'EUR' } }), 201).account;
    code(await h.call('recurring', 'POST', { as: 'bob', query: f.q, body: { name: 'Sneaky', billType: 'debt-payment', accountId: f.joint.id, toAccountId: alicesCard.id, amount: '10.00', schedule: { freq: 'monthly', startDate: '2026-10-01' } } }), 404, 'not_found');
  });

  test('recording a debt-payment occurrence with a breakdown is idempotent: a retried request with the same key creates exactly one set of entries', async () => {
    const h = harness();
    const f = await household(h);
    const card = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Retry Card', type: 'credit-card', currency: 'EUR', openingBalance: '-500.00' } }), 201).account;
    const bill = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Retry payment', billType: 'debt-payment', accountId: f.joint.id, toAccountId: card.id, amount: '100.00', schedule: { freq: 'monthly', startDate: '2026-10-01' } } }), 201).recurring;
    const body = { recurringId: bill.id, occurrence: '2026-10-01', interestAmount: '15.00' };
    const key = { 'idempotency-key': 'retry-debt-payment-1' };
    const first = ok(await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'record' }, body, headers: key }), 201);
    const second = ok(await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'record' }, body, headers: key }), 201);
    assert.equal(second.replayed, true, 'the retry is served from the idempotency record, not recomputed');
    assert.deepEqual(second.transactions.map((t) => t.id), first.transactions.map((t) => t.id), 'the exact same entries, nothing created twice');
    const entries = (await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: card.id, includeDeleted: '1' } })).body.transactions;
    assert.equal(entries.length, 2, 'exactly one transfer-in leg and one interest leg on the debt account, never duplicated');
  });

  test('editing a debt-payment bill\'s terms afterward never rewrites a payment (and its interest breakdown) already recorded', async () => {
    const h = harness();
    const f = await household(h);
    const card = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Edited Card', type: 'credit-card', currency: 'EUR', openingBalance: '-500.00' } }), 201).account;
    const bill = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Card payment', billType: 'debt-payment', accountId: f.joint.id, toAccountId: card.id, amount: '100.00', schedule: { freq: 'monthly', startDate: '2026-10-01' } } }), 201).recurring;
    const recorded = ok(await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'record' }, body: { recurringId: bill.id, occurrence: '2026-10-01', interestAmount: '10.00' } }), 201);
    // Change the bill's amount going forward, effective next month.
    ok(await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: bill.id, revision: bill.revision, amount: '120.00', effectiveFrom: '2026-11-01' } }));
    const still = (await h.call('transactions', 'GET', { as: 'alice', query: f.q })).body.transactions;
    for (const original of recorded.transactions) {
      const now = still.find((t) => t.id === original.id);
      assert.equal(now.amount, original.amount, 'the already-recorded amount is unchanged by a later terms edit');
    }
  });
});
