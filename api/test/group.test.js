'use strict';
// BT-009 shared expenses and settlement through the real /api/group handler: a group workspace that
// needs no account, splits, multiple payers, the brief's EUR 300 dinner rule end to end on a real
// account, corrections and voids with history, the settlement state machine, pending amounts,
// suggestions, permissions (viewer, member, manager, owner, site administrator, outsider, contacts),
// no leak of private accounts, idempotent creation, stale edits and backup/restore coverage.
// All people and amounts are fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const FRANK = Object.freeze({ userId: 'g-frank', email: 'frank@example.com', name: 'Frank Fictional' });
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

// Alice owner, Bob member, Carol viewer, Frank manager, Dana a shared contact (no login).
async function groupFixture(h, { kind = 'group' } = {}) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Dinner Club', kind, reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const join = async (user, role) => {
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: user.email, role } }), 201);
    ok(await h.call('invitations', 'POST', { user, query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  };
  await join(USERS.bob, 'member');
  await join(USERS.carol, 'viewer');
  await join(FRANK, 'manager');
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const ref = (name) => `member:${members.find((m) => m.name.startsWith(name)).id}`;
  const dana = ok(await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'workspace', workspaceId: ws.id, name: 'Dana Contact' } }), 201).contact;
  return { ws, q, refs: { alice: ref('Alice'), bob: ref('Bob'), carol: ref('Carol'), frank: ref('Frank'), dana: dana.ref } };
}

// `who` is a USERS key or FRANK.
const who = (w) => (typeof w === 'string' ? { as: w } : { user: w });
const G = (h, f, w, method, { query = {}, body, headers } = {}) => h.call('group', method, { ...who(w), query: { ...f.q, ...query }, body, headers });
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });
const addExpense = async (h, f, w, body, headers) => ok(await G(h, f, w, 'POST', { body, headers }), 201).expense;
const settle = async (h, f, w, body) => ok(await G(h, f, w, 'POST', { query: { action: 'settle' }, body }), 201).settlement;
const view = async (h, f, w = 'alice') => ok(await G(h, f, w, 'GET'));
const row = (v, ref) => v.balances.find((b) => b.currency === 'EUR').rows.find((r) => r.ref === ref);
const eur = (v) => v.balances.find((b) => b.currency === 'EUR');
const accountBalance = async (h, f, as, id) => ok(await h.call('accounts', 'GET', { as, query: f.q })).accounts.find((a) => a.id === id).balance;
const summaryOf = async (h, f, as, accountId) => ok(await h.call('transactions', 'GET', { as, query: { ...f.q, accountId } })).summary.find((s) => s.currency === 'EUR');

describe('BT-009-01 a shared-expense group needs no account', () => {
  test('a group with no accounts records expenses and shows balances and suggestions', async () => {
    const h = harness();
    const f = await groupFixture(h);
    assert.deepEqual(ok(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).accounts, []);
    // 90.00 paid by Alice, shared equally by Alice, Bob and Dana: 30.00 each.
    const e = await addExpense(h, f, 'alice', { description: 'Fictional groceries', date: '2026-09-10', amount: '90.00', payers: [{ ref: f.refs.alice, amount: '90.00' }], split: equal(f.refs.alice, f.refs.bob, f.refs.dana) });
    assert.equal(e.amount, '90.00');
    assert.deepEqual(e.shares.map((s) => [s.ref, s.amount]), [[f.refs.alice, '30.00'], [f.refs.bob, '30.00'], [f.refs.dana, '30.00']]);
    const v = await view(h, f);
    assert.equal(v.currency, 'EUR');
    assert.deepEqual([row(v, f.refs.alice).net, row(v, f.refs.bob).net, row(v, f.refs.dana).net, row(v, f.refs.frank).net], ['60.00', '-30.00', '-30.00', '0.00']);
    // Debtors of equal size are ordered as listed: members in joining order, then contacts.
    assert.deepEqual(eur(v).suggestions.map((s) => [s.from, s.to, s.amount]), [[f.refs.bob, f.refs.alice, '30.00'], [f.refs.dana, f.refs.alice, '30.00']]);
    assert.deepEqual(v.participants.map((p) => p.type), ['member', 'member', 'member', 'member', 'contact']);
    assert.equal(v.participants.find((p) => p.ref === f.refs.alice).self, true);
  });

  test('a single payer may leave the paid amount out; it is the total', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const e = await addExpense(h, f, 'bob', { description: 'Fictional taxi', amount: '12.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.alice) });
    assert.deepEqual(e.payers.map((p) => [p.ref, p.amount]), [[f.refs.bob, '12.00']]);
    assert.equal(e.date, '2026-09-13', 'today by default');
  });
});

describe('BT-009-02 splits through the API', () => {
  test('equal 100.00 three ways: 33.34 / 33.33 / 33.33 with the rounding adjustment shown', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const e = await addExpense(h, f, 'alice', { description: 'Fictional museum', amount: '100.00', payers: [{ ref: f.refs.alice, amount: '100.00' }], split: equal(f.refs.alice, f.refs.bob, f.refs.frank) });
    assert.deepEqual(e.shares.map((s) => [s.amount, s.adjustmentMinor]), [['33.34', 1], ['33.33', 0], ['33.33', 0]]);
    assert.deepEqual(e.rounding, { residualMinor: 1, residual: '0.01' });
  });

  test('percentages, amounts and shares, each hand computed; bad totals are refused with the numbers', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const base = { description: 'Fictional split', amount: '100.00', payers: [{ ref: f.refs.alice, amount: '100.00' }] };
    const pct = await addExpense(h, f, 'alice', { ...base, split: { method: 'percentages', lines: [{ ref: f.refs.alice, value: '33.3333' }, { ref: f.refs.bob, value: '33.3333' }, { ref: f.refs.dana, value: '33.3334' }] } });
    assert.deepEqual(pct.shares.map((s) => s.amount), ['33.33', '33.33', '33.34']);
    const amt = await addExpense(h, f, 'alice', { ...base, split: { method: 'amounts', lines: [{ ref: f.refs.alice, value: '60.00' }, { ref: f.refs.bob, value: '40.00' }] } });
    assert.deepEqual(amt.shares.map((s) => s.amount), ['60.00', '40.00']);
    assert.deepEqual(amt.split.lines.map((l) => l.value), ['60.00', '40.00']);
    const shr = await addExpense(h, f, 'alice', { ...base, split: { method: 'shares', lines: [{ ref: f.refs.alice, value: 2 }, { ref: f.refs.bob, value: 1 }, { ref: f.refs.dana, value: 1 }] } });
    assert.deepEqual(shr.shares.map((s) => s.amount), ['50.00', '25.00', '25.00']);
    let res = await G(h, f, 'alice', 'POST', { body: { ...base, split: { method: 'percentages', lines: [{ ref: f.refs.alice, value: '50' }, { ref: f.refs.bob, value: '40' }] } } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'split_percent_total');
    assert.match(res.body.error.message, /90%/);
    res = await G(h, f, 'alice', 'POST', { body: { ...base, split: { method: 'amounts', lines: [{ ref: f.refs.alice, value: '60.00' }, { ref: f.refs.bob, value: '30.00' }] } } });
    assert.equal(res.body.error.code, 'split_amount_total');
    res = await G(h, f, 'alice', 'POST', { body: { ...base, currency: 'USD', split: equal(f.refs.alice) } });
    assert.equal(res.body.error.code, 'currency_not_supported', 'only the reporting currency in this increment');
    res = await G(h, f, 'alice', 'POST', { body: { ...base, amount: '0.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice) } });
    assert.equal(res.body.error.code, 'invalid_amount');
  });

  test('several payers must add up to the total; balances and the direct view follow what each paid', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const body = { description: 'Fictional cabin', amount: '120.00', split: equal(f.refs.alice, f.refs.bob, f.refs.dana) };
    const bad = await G(h, f, 'alice', 'POST', { body: { ...body, payers: [{ ref: f.refs.alice, amount: '80.00' }, { ref: f.refs.bob, amount: '30.00' }] } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'payer_total');
    assert.match(bad.body.error.message, /110\.00/);
    await addExpense(h, f, 'alice', { ...body, payers: [{ ref: f.refs.alice, amount: '80.00' }, { ref: f.refs.bob, amount: '40.00' }] });
    const v = await view(h, f);
    // Each share is 40.00: Alice 80 − 40 = +40, Bob 40 − 40 = 0, Dana −40.
    assert.deepEqual([row(v, f.refs.alice).net, row(v, f.refs.bob).net, row(v, f.refs.dana).net], ['40.00', '0.00', '-40.00']);
    assert.deepEqual(eur(v).direct.map((d) => [d.from, d.to, d.amount]), [[f.refs.dana, f.refs.alice, '40.00']]);
  });
});

describe('BT-009-06 personal and group accounting: the EUR 300 dinner', () => {
  test('cash −300.00, spending 75.00, lent 225.00; repayments 225.00 are reimbursements; spending stays 75.00', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const cash = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' } }), 201).account;
    const dinner = await addExpense(h, f, 'alice', {
      description: 'Shared dinner', date: '2026-09-12', amount: '300.00', payers: [{ ref: f.refs.alice, amount: '300.00' }],
      split: equal(f.refs.alice, f.refs.bob, f.refs.frank, f.refs.dana), ledger: { accountId: cash.id },
    });
    assert.deepEqual(dinner.shares.map((s) => s.amount), ['75.00', '75.00', '75.00', '75.00']);
    // His cash account decreases by 300.00: 500.00 → 200.00.
    assert.equal(await accountBalance(h, f, 'alice', cash.id), '200.00');
    // Personal spending 75.00; 225.00 owed back to him (an advance, not spending).
    let s = await summaryOf(h, f, 'alice', cash.id);
    assert.deepEqual([s.gross, s.advances, s.income, s.reimbursements], ['75.00', '225.00', '0.00', '0.00']);
    const entries = ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: cash.id } })).transactions;
    assert.deepEqual(entries.map((t) => [t.kind, t.amount, t.links.groupExpenseId]).sort(), [['advance', '-225.00', dinner.id], ['expense', '-75.00', dinner.id]]);
    assert.equal(dinner.myLedger.needsReview, false);
    assert.equal(dinner.myLedger.accountId, cash.id);
    // The group records ONE 300.00 expense.
    let v = await view(h, f);
    assert.deepEqual(v.expenses.map((e) => e.amount), ['300.00']);
    assert.equal(row(v, f.refs.alice).net, '225.00');
    // Repayment: Bob and Frank report 75.00 each; Alice confirms both onto her cash account; Alice
    // records that Dana (a contact) paid her 75.00, which is confirmed because she received it.
    const fromBob = await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.alice, amount: '75.00', date: '2026-09-13' });
    const fromFrank = await settle(h, f, FRANK, { from: f.refs.frank, to: f.refs.alice, amount: '75.00', date: '2026-09-13' });
    assert.deepEqual([fromBob.status, fromFrank.status], ['reported', 'reported']);
    v = await view(h, f);
    assert.equal(row(v, f.refs.alice).net, '225.00', 'reported payments are not in the net');
    assert.equal(row(v, f.refs.alice).pendingIn, '150.00');
    ok(await G(h, f, 'alice', 'POST', { query: { action: 'confirm' }, body: { settlementId: fromBob.id, revision: fromBob.revision, ledger: { accountId: cash.id } } }));
    ok(await G(h, f, 'alice', 'POST', { query: { action: 'confirm' }, body: { settlementId: fromFrank.id, revision: fromFrank.revision, ledger: { accountId: cash.id } } }));
    const fromDana = await settle(h, f, 'alice', { from: f.refs.dana, to: f.refs.alice, amount: '75.00', date: '2026-09-13', method: 'Cash', ledger: { accountId: cash.id } });
    assert.equal(fromDana.status, 'confirmed');
    // Repayment clears the amount owed without new spending or ordinary income: 200.00 + 225.00.
    assert.equal(await accountBalance(h, f, 'alice', cash.id), '425.00');
    s = await summaryOf(h, f, 'alice', cash.id);
    assert.deepEqual([s.gross, s.advances, s.reimbursements, s.income], ['75.00', '225.00', '225.00', '0.00']);
    v = await view(h, f);
    for (const r of eur(v).rows) assert.equal(r.net, '0.00', r.ref);
    assert.deepEqual(eur(v).suggestions, []);
    assert.deepEqual(v.expenses.map((e) => e.amount), ['300.00'], 'still one group expense');
  });

  // Terry's model (2026-09-14, financial review finding 2): anyone who shares an expense records their
  // share, not only a payer; the account must be their own, in the same currency.
  test('the account must be the caller\'s own and in the same currency; a refused choice leaves nothing behind', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const usd = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Alice Dollars', type: 'cash', currency: 'USD' } }), 201).account;
    const eurAcc = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Alice Euros', type: 'cash', currency: 'EUR' } }), 201).account;
    const body = { description: 'Fictional tickets', amount: '20.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.alice, f.refs.bob) };
    assert.equal((await G(h, f, 'alice', 'POST', { body: { ...body, ledger: { accountId: usd.id } } })).body.error.code, 'currency_mismatch');
    // Bob cannot use Alice's private account: it does not exist for him.
    assert.equal((await G(h, f, 'bob', 'POST', { body: { ...body, ledger: { accountId: eurAcc.id } } })).status, 404);
    // A refused ledger choice leaves no expense behind.
    assert.deepEqual((await view(h, f)).expenses, []);
    // Alice shared but did not pay: her 10.00 share is spending and owed to Bob; no money moves.
    await addExpense(h, f, 'alice', { ...body, ledger: { accountId: eurAcc.id } });
    assert.equal(await accountBalance(h, f, 'alice', eurAcc.id), '0.00');
    const s = await summaryOf(h, f, 'alice', eurAcc.id);
    assert.deepEqual([s.gross, s.payables, s.receivable], ['10.00', '10.00', '-10.00']);
  });
});

describe('BT-009-03 corrections and voids keep history', () => {
  test('an edit needs a reason and the current revision, keeps before and after, and re-syncs the editor\'s own account', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const cash = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' } }), 201).account;
    const split = equal(f.refs.alice, f.refs.bob, f.refs.frank, f.refs.dana);
    const e = await addExpense(h, f, 'alice', { description: 'Shared dinner', date: '2026-09-12', amount: '300.00', payers: [{ ref: f.refs.alice, amount: '300.00' }], split, ledger: { accountId: cash.id } });
    const change = { expenseId: e.id, amount: '320.00', payers: [{ ref: f.refs.alice, amount: '320.00' }], split };
    let res = await G(h, f, 'alice', 'PATCH', { body: { ...change, revision: e.revision } });
    assert.equal(res.body.error.code, 'reason_required');
    res = await G(h, f, 'alice', 'PATCH', { body: { ...change, revision: e.revision + 1, reason: 'Tip added' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'stale_revision');
    assert.equal((await G(h, f, 'bob', 'PATCH', { body: { ...change, revision: e.revision, reason: 'Not mine' } })).status, 403, 'a member cannot change someone else\'s expense');
    const edited = ok(await G(h, f, 'alice', 'PATCH', { body: { ...change, revision: e.revision, reason: 'Tip added' } })).expense;
    assert.deepEqual([edited.amount, edited.revision, edited.shares[0].amount], ['320.00', 2, '80.00']);
    const hist = ok(await G(h, f, 'alice', 'GET', { query: { action: 'history', expenseId: e.id } }));
    assert.equal(hist.amendments.length, 1);
    assert.equal(hist.amendments[0].reason, 'Tip added');
    assert.equal(hist.amendments[0].by, 'Alice Fictional');
    const amountChange = hist.amendments[0].changes.find((c) => c.field === 'amountMinor');
    assert.deepEqual([amountChange.from, amountChange.to], ['300.00', '320.00']);
    // Alice's account follows through reversals and new entries, never by rewriting: 500 − 320.
    assert.equal(await accountBalance(h, f, 'alice', cash.id), '180.00');
    const s = await summaryOf(h, f, 'alice', cash.id);
    assert.deepEqual([s.gross, s.advances], ['80.00', '240.00']);
    const all = ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: cash.id } })).transactions;
    assert.equal(all.length, 6, 'two originals, their two reversals, two new entries');
    assert.equal(all.filter((t) => t.reversedBy).length, 2);
    // A manager may correct someone else's expense.
    ok(await G(h, f, FRANK, 'PATCH', { body: { expenseId: e.id, revision: 2, description: 'Shared dinner (Lisbon)', reason: 'Clearer name' } }));
  });

  test('a void needs a reason, leaves the expense listed as void, takes it out of balances and reverses the voider\'s entries', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const cash = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' } }), 201).account;
    const e = await addExpense(h, f, 'alice', { description: 'Shared dinner', amount: '300.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.frank, f.refs.dana), ledger: { accountId: cash.id } });
    assert.equal((await G(h, f, 'alice', 'POST', { query: { action: 'void' }, body: { expenseId: e.id, revision: e.revision } })).body.error.code, 'reason_required');
    assert.equal((await G(h, f, 'carol', 'POST', { query: { action: 'void' }, body: { expenseId: e.id, revision: e.revision, reason: 'x' } })).status, 403);
    const voided = ok(await G(h, f, 'alice', 'POST', { query: { action: 'void' }, body: { expenseId: e.id, revision: e.revision, reason: 'Entered twice' } })).expense;
    assert.deepEqual([voided.status, voided.voidReason, voided.revision], ['void', 'Entered twice', 2]);
    const again = await G(h, f, 'alice', 'POST', { query: { action: 'void' }, body: { expenseId: e.id, revision: 2, reason: 'x' } });
    assert.equal(again.body.error.code, 'already_void');
    const v = await view(h, f);
    assert.deepEqual(v.expenses.map((x) => [x.id, x.status]), [[e.id, 'void']], 'still listed');
    for (const r of eur(v).rows) assert.equal(r.net, '0.00');
    assert.equal(await accountBalance(h, f, 'alice', cash.id), '500.00');
    const s = await summaryOf(h, f, 'alice', cash.id);
    assert.deepEqual([s.gross, s.advances], ['0.00', '0.00']);
    assert.equal((await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: 2, description: 'x', reason: 'x' } })).body.error.code, 'voided');
  });
});

describe('BT-009-07 another person\'s private account is never exposed', () => {
  test('a manager\'s change makes the payer\'s own entries "needs review"; only the payer sees or syncs them', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const wallet = ok(await h.call('accounts', 'POST', { as: 'bob', query: f.q, body: { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' } }), 201).account;
    const e = await addExpense(h, f, 'bob', { description: 'Fictional pizza', amount: '40.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.dana), ledger: { accountId: wallet.id } });
    assert.equal(await accountBalance(h, f, 'bob', wallet.id), '60.00');
    const bobEntries = ok(await h.call('transactions', 'GET', { as: 'bob', query: { ...f.q, accountId: wallet.id } })).transactions.map((t) => t.id);
    const hidden = [wallet.id, 'Bob Wallet', ...bobEntries];
    const frankEdit = await G(h, f, FRANK, 'PATCH', { body: { expenseId: e.id, revision: e.revision, amount: '50.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.dana), reason: 'Receipt says 50' } });
    assert.equal(frankEdit.status, 200);
    for (const [label, res] of [['manager edit', frankEdit], ['owner view', await G(h, f, 'alice', 'GET')], ['viewer view', await G(h, f, 'carol', 'GET')], ['history', await G(h, f, 'alice', 'GET', { query: { action: 'history', expenseId: e.id } })]]) {
      const text = JSON.stringify(res.body);
      for (const x of hidden) assert.equal(text.includes(x), false, `${label} reveals ${x}`);
      assert.equal(text.includes('myLedger'), false, `${label} says the expense is on an account`);
    }
    // The owner cannot see Bob's entries through the ledger either.
    assert.ok(!ok(await h.call('transactions', 'GET', { as: 'alice', query: f.q })).transactions.some((t) => bobEntries.includes(t.id)));
    let mine = (await view(h, f, 'bob')).expenses.find((x) => x.id === e.id).myLedger;
    assert.deepEqual([mine.accountId, mine.accountName, mine.needsReview], [wallet.id, 'Bob Wallet', true]);
    assert.equal(await accountBalance(h, f, 'bob', wallet.id), '60.00', 'nobody else changed Bob\'s account');
    ok(await G(h, f, 'bob', 'POST', { query: { action: 'ledger' }, body: { expenseId: e.id } }));
    assert.equal(await accountBalance(h, f, 'bob', wallet.id), '50.00');
    mine = (await view(h, f, 'bob')).expenses.find((x) => x.id === e.id).myLedger;
    assert.equal(mine.needsReview, false);
    // Syncing again changes nothing.
    ok(await G(h, f, 'bob', 'POST', { query: { action: 'ledger' }, body: { expenseId: e.id } }));
    assert.equal(ok(await h.call('transactions', 'GET', { as: 'bob', query: { ...f.q, accountId: wallet.id } })).total, 6);
    // Another member cannot record anything on Bob's private account: it does not exist for them.
    const notTheirs = await G(h, f, 'alice', 'POST', { query: { action: 'ledger' }, body: { expenseId: e.id, accountId: wallet.id } });
    assert.equal(notTheirs.status, 404);
    // Syncing a private account never changes the shared record's revision, so nobody else's edit is
    // refused as stale because of it. A manager's void leaves Bob's account for Bob; his sync reverses
    // what is left.
    ok(await G(h, f, FRANK, 'POST', { query: { action: 'void' }, body: { expenseId: e.id, revision: 2, reason: 'Duplicate' } }));
    assert.equal(await accountBalance(h, f, 'bob', wallet.id), '50.00');
    ok(await G(h, f, 'bob', 'POST', { query: { action: 'ledger' }, body: { expenseId: e.id } }));
    assert.equal(await accountBalance(h, f, 'bob', wallet.id), '100.00');
    // A void expense takes no new account link.
    assert.equal((await G(h, f, 'bob', 'POST', { query: { action: 'ledger' }, body: { expenseId: e.id, accountId: wallet.id } })).body.error.code, 'already_void');
  });

  test('a payer can stop recording an expense on their account: the entries are reversed, the link kept as ended', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const cash = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '50.00' } }), 201).account;
    const e = await addExpense(h, f, 'alice', { description: 'Fictional bread', amount: '10.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    assert.equal(e.myLedger, undefined);
    ok(await G(h, f, 'alice', 'POST', { query: { action: 'ledger' }, body: { expenseId: e.id, accountId: cash.id } }));
    assert.equal(await accountBalance(h, f, 'alice', cash.id), '40.00');
    ok(await G(h, f, 'alice', 'POST', { query: { action: 'ledger' }, body: { expenseId: e.id, accountId: null } }));
    assert.equal(await accountBalance(h, f, 'alice', cash.id), '50.00');
    assert.equal((await view(h, f)).expenses[0].myLedger, undefined);
    const { value: doc } = await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`);
    // One link per person and currency (Terry, 2026-09-14), kept as ended, never removed.
    assert.equal(doc.groupLedgers.length, 1);
    assert.ok(doc.groupLedgers[0].endedAt, 'ended, not removed');
  });
});

describe('BT-009-04 settlements: reported, confirmed, disputed, void', () => {
  test('only the receiving member confirms or disputes; a dispute can be resolved; a confirmed payment is voided, not disputed', async () => {
    const h = harness();
    const f = await groupFixture(h);
    // These are the rules when "Anyone in the group can confirm payments" is off (Terry, 2026-09-14;
    // it is on by default, tested in group-recheck.test.js).
    ok(await G(h, f, 'alice', 'POST', { query: { action: 'settings' }, body: { changes: { anyoneConfirms: false } } }));
    await addExpense(h, f, 'alice', { description: 'Fictional fuel', amount: '60.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    const s = await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.alice, amount: '30.00', method: 'Bank transfer' });
    assert.deepEqual([s.status, s.voided, s.method], ['reported', false, 'Bank transfer']);
    const act = (w, action, body) => G(h, f, w, 'POST', { query: { action }, body });
    assert.equal((await act('carol', 'confirm', { settlementId: s.id, revision: 1 })).status, 403, 'viewer');
    assert.equal((await act(FRANK, 'confirm', { settlementId: s.id, revision: 1 })).status, 403, 'a manager cannot confirm for a member');
    assert.equal((await act('bob', 'confirm', { settlementId: s.id, revision: 1 })).status, 403, 'the payer cannot confirm their own payment');
    assert.equal((await act('bob', 'dispute', { settlementId: s.id, revision: 1, reason: 'x' })).status, 403);
    assert.equal((await act('alice', 'dispute', { settlementId: s.id, revision: 1 })).body.error.code, 'reason_required');
    const disputed = ok(await act('alice', 'dispute', { settlementId: s.id, revision: 1, reason: 'Nothing arrived yet' })).settlement;
    assert.deepEqual([disputed.status, disputed.disputeReason], ['disputed', 'Nothing arrived yet']);
    let v = await view(h, f);
    assert.deepEqual([row(v, f.refs.alice).net, row(v, f.refs.alice).pendingIn, row(v, f.refs.alice).disputedIn], ['30.00', '0.00', '30.00']);
    assert.deepEqual(eur(v).suggestions.map((x) => x.amount), ['30.00'], 'a disputed payment is not counted as made');
    assert.equal((await act('alice', 'confirm', { settlementId: s.id, revision: 1 })).body.error.code, 'stale_revision');
    const confirmed = ok(await act('alice', 'confirm', { settlementId: s.id, revision: 2 })).settlement;
    assert.equal(confirmed.status, 'confirmed');
    v = await view(h, f);
    assert.equal(row(v, f.refs.alice).net, '0.00');
    assert.equal((await act('alice', 'dispute', { settlementId: s.id, revision: 3, reason: 'x' })).body.error.code, 'not_disputable');
    assert.equal((await act('alice', 'confirm', { settlementId: s.id, revision: 3 })).body.error.code, 'already_confirmed');
    assert.equal((await act('carol', 'void', { settlementId: s.id, revision: 3, reason: 'x' })).status, 403);
    // Once confirmed, the payer and reporter alone can no longer void it; the receiver withdraws the
    // confirmation (security review S6, Terry 2026-09-14).
    assert.equal((await act('bob', 'void', { settlementId: s.id, revision: 3, reason: 'Paid the wrong person' })).status, 403);
    const voided = ok(await act('alice', 'void', { settlementId: s.id, revision: 3, reason: 'Paid the wrong person' })).settlement;
    assert.deepEqual([voided.voided, voided.voidReason, voided.status, voided.withdrawn], [true, 'Paid the wrong person', 'confirmed', true]);
    v = await view(h, f);
    assert.equal(row(v, f.refs.alice).net, '30.00', 'a void takes the payment out again');
    assert.equal(v.settlements.length, 1, 'still listed');
    assert.equal((await act('alice', 'void', { settlementId: s.id, revision: 4, reason: 'x' })).body.error.code, 'already_void');
    const hist = ok(await G(h, f, 'bob', 'GET', { query: { action: 'history', settlementId: s.id } }));
    // Alice's confirmation came after her own dispute, so it is kept as one made over a dispute (financial recheck F1).
    assert.deepEqual(hist.history.map((x) => x.event), ['reported', 'disputed', 'confirmed-over-dispute', 'withdrawn']);
  });

  test('a payment to a contact is confirmed by a manager or owner, not a plain member; bad payments are refused', async () => {
    const h = harness();
    const f = await groupFixture(h);
    // The rule when "Anyone in the group can confirm payments" is off (Terry, 2026-09-14; default on).
    ok(await G(h, f, 'alice', 'POST', { query: { action: 'settings' }, body: { changes: { anyoneConfirms: false } } }));
    const s = await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.dana, amount: '10.00' });
    assert.equal((await G(h, f, 'bob', 'POST', { query: { action: 'confirm' }, body: { settlementId: s.id, revision: 1 } })).status, 403);
    assert.equal((await G(h, f, 'bob', 'POST', { query: { action: 'dispute' }, body: { settlementId: s.id, revision: 1, reason: 'x' } })).status, 403);
    assert.equal(ok(await G(h, f, FRANK, 'POST', { query: { action: 'confirm' }, body: { settlementId: s.id, revision: 1 } })).settlement.status, 'confirmed');
    const bad = async (body, code) => { const r = await G(h, f, 'bob', 'POST', { query: { action: 'settle' }, body }); assert.equal(r.status, 400, JSON.stringify(r.body)); assert.equal(r.body.error.code, code); };
    await bad({ from: f.refs.bob, to: f.refs.bob, amount: '1.00' }, 'same_person');
    await bad({ from: f.refs.bob, to: f.refs.alice, amount: '0.00' }, 'invalid_amount');
    await bad({ from: f.refs.bob, to: f.refs.alice, amount: '1.00', currency: 'USD' }, 'currency_not_supported');
    assert.equal((await G(h, f, 'carol', 'POST', { query: { action: 'settle' }, body: { from: f.refs.carol, to: f.refs.alice, amount: '1.00' } })).status, 403, 'viewers only read');
  });

  test('balances, pending and suggestions over several expenses (hand computed)', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const { alice, bob, frank, dana } = f.refs;
    await addExpense(h, f, 'alice', { description: 'E1', amount: '100.00', payers: [{ ref: alice }], split: equal(alice, bob, frank, dana) });
    await addExpense(h, f, 'bob', { description: 'E2', amount: '60.00', payers: [{ ref: bob }], split: { method: 'shares', lines: [{ ref: bob, value: 1 }, { ref: frank, value: 2 }] } });
    await addExpense(h, f, 'alice', { description: 'E3', amount: '30.00', payers: [{ ref: dana }], split: { method: 'amounts', lines: [{ ref: alice, value: '10.00' }, { ref: dana, value: '20.00' }] } });
    let v = await view(h, f, 'carol');
    // Alice 100 − 35 = +65; Bob 60 − 45 = +15; Frank 0 − 65 = −65; Dana 30 − 45 = −15.
    assert.deepEqual([alice, bob, frank, dana].map((r) => row(v, r).net), ['65.00', '15.00', '-65.00', '-15.00']);
    assert.deepEqual([row(v, alice).paid, row(v, alice).share], ['100.00', '35.00']);
    assert.deepEqual(row(v, alice).expenses.map((x) => [x.description, x.paid, x.share]), [['E1', '100.00', '25.00'], ['E3', '0.00', '10.00']]);
    assert.deepEqual(eur(v).suggestions.map((s) => [s.from, s.to, s.amount]), [[frank, alice, '65.00'], [dana, bob, '15.00']]);
    await settle(h, f, FRANK, { from: frank, to: alice, amount: '65.00' });
    v = await view(h, f, 'carol');
    assert.deepEqual([row(v, alice).net, row(v, alice).pendingIn, row(v, frank).pendingOut], ['65.00', '65.00', '65.00']);
    assert.deepEqual(eur(v).suggestions.map((s) => [s.from, s.to, s.amount]), [[dana, bob, '15.00']]);
    assert.deepEqual(eur(v).direct.map((d) => [d.from, d.to, d.amount]), [[alice, frank, '40.00'], [bob, alice, '25.00'], [frank, bob, '40.00'], [dana, alice, '15.00']]);
    const balancesOnly = ok(await G(h, f, 'carol', 'GET', { query: { action: 'balances' } }));
    assert.deepEqual(balancesOnly.balances, v.balances);
  });
});

describe('BT-009-07 permissions', () => {
  test('viewer reads only; members add; the creator, managers and owners change; site administrators and outsiders get 404', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const body = { description: 'Fictional lunch', amount: '20.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.alice) };
    const e = await addExpense(h, f, 'bob', body);
    for (const w of ['alice', 'bob', 'carol', FRANK]) assert.equal((await G(h, f, w, 'GET')).status, 200);
    for (const w of ['dave', 'eve']) {
      assert.equal((await G(h, f, w, 'GET')).status, 404, `${w} GET`);
      assert.equal((await G(h, f, w, 'POST', { body })).status, 404, `${w} POST`);
      assert.equal((await G(h, f, w, 'PATCH', { body: { expenseId: e.id, revision: 1, description: 'x', reason: 'x' } })).status, 404, `${w} PATCH`);
      assert.equal((await G(h, f, w, 'GET', { query: { action: 'history', expenseId: e.id } })).status, 404);
    }
    assert.equal((await G(h, f, 'carol', 'POST', { body })).status, 403);
    assert.equal((await G(h, f, 'carol', 'GET')).body.permissions.canAdd, false);
    assert.equal((await G(h, f, 'carol', 'GET')).body.expenses[0].canEdit, false);
    const alicesView = (await G(h, f, 'alice', 'GET')).body.expenses[0];
    assert.deepEqual([alicesView.canEdit, alicesView.canVoid, alicesView.createdBy, alicesView.createdBySelf], [true, true, 'Bob Fictional', false]);
    ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: 1, description: 'Owner fixed it', reason: 'Typo' } }));
    ok(await G(h, f, FRANK, 'PATCH', { body: { expenseId: e.id, revision: 2, description: 'Manager fixed it', reason: 'Typo' } }));
    const alicesOwn = await addExpense(h, f, 'alice', body);
    assert.equal((await G(h, f, 'bob', 'PATCH', { body: { expenseId: alicesOwn.id, revision: 1, description: 'x', reason: 'x' } })).status, 403);
    assert.equal((await G(h, f, 'bob', 'POST', { query: { action: 'void' }, body: { expenseId: alicesOwn.id, revision: 1, reason: 'x' } })).status, 403);
    // An unknown or other-workspace id is not found.
    assert.equal((await G(h, f, 'alice', 'PATCH', { body: { expenseId: 'gex_nosuch000', revision: 1, description: 'x', reason: 'x' } })).status, 404);
    const other = await groupFixture(h);
    assert.equal((await G(h, other, 'alice', 'PATCH', { body: { expenseId: e.id, revision: 3, description: 'x', reason: 'x' } })).status, 404);
  });

  test('contacts can pay and share; private contacts never take part; unknown people are refused', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const mine = ok(await h.call('contacts', 'POST', { as: 'bob', body: { scope: 'private', name: 'Bob Private Friend' } }), 201).contact;
    const res = await G(h, f, 'bob', 'POST', { body: { description: 'x', amount: '10.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, mine.ref) } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'private_contact');
    assert.equal((await G(h, f, 'bob', 'POST', { body: { description: 'x', amount: '10.00', payers: [{ ref: 'member:mem_nosuch000' }], split: equal(f.refs.bob) } })).body.error.code, 'invalid_person');
    const e = await addExpense(h, f, 'bob', { description: 'Dana paid', amount: '10.00', payers: [{ ref: f.refs.dana }], split: equal(f.refs.bob, f.refs.dana) });
    assert.deepEqual(e.payers.map((p) => p.ref), [f.refs.dana]);
    const v = await view(h, f);
    assert.equal(row(v, f.refs.dana).net, '5.00');
    // An archived contact keeps its history but cannot be chosen again.
    ok(await h.call('contacts', 'DELETE', { as: 'alice', body: { scope: 'workspace', workspaceId: f.ws.id, contactId: f.refs.dana.slice(8) } }));
    assert.equal((await G(h, f, 'bob', 'POST', { body: { description: 'x', amount: '10.00', payers: [{ ref: f.refs.dana }], split: equal(f.refs.bob) } })).body.error.code, 'invalid_person');
    const after = await view(h, f);
    assert.equal(row(after, f.refs.dana).net, '5.00');
    assert.deepEqual(after.participants.find((p) => p.ref === f.refs.dana), { ref: f.refs.dana, name: 'Dana Contact', type: 'contact', self: false, active: false });
    // Editing an expense that already names the archived contact keeps it.
    ok(await G(h, f, 'bob', 'PATCH', { body: { expenseId: e.id, revision: 1, description: 'Dana paid (kept)', reason: 'Wording' } }));
  });
});

describe('BT-009-08 reliability', () => {
  test('a repeated Idempotency-Key returns the first expense and writes nothing; reuse for another body is refused', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const body = { description: 'Fictional ferry', amount: '44.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) };
    // Low-entropy fictional keys, as in bills.test.js.
    const expenseKey = `k-${'fe'.repeat(16)}`;
    const paymentKey = `k-${'pa'.repeat(16)}`;
    const headers = { 'idempotency-key': expenseKey };
    const first = ok(await G(h, f, 'alice', 'POST', { body, headers }), 201);
    const second = ok(await G(h, f, 'alice', 'POST', { body, headers }), 201);
    assert.equal(second.expense.id, first.expense.id);
    assert.equal(second.replayed, true);
    assert.equal((await view(h, f)).expenses.length, 1);
    const reused = await G(h, f, 'alice', 'POST', { body: { ...body, amount: '45.00', payers: [{ ref: f.refs.alice }] }, headers });
    assert.equal(reused.status, 409);
    assert.equal(reused.body.error.code, 'idempotency_key_reused');
    const s1 = ok(await G(h, f, 'bob', 'POST', { query: { action: 'settle' }, body: { from: f.refs.bob, to: f.refs.alice, amount: '22.00' }, headers: { 'idempotency-key': paymentKey } }), 201);
    const s2 = ok(await G(h, f, 'bob', 'POST', { query: { action: 'settle' }, body: { from: f.refs.bob, to: f.refs.alice, amount: '22.00' }, headers: { 'idempotency-key': paymentKey } }), 201);
    assert.equal(s2.settlement.id, s1.settlement.id);
    assert.equal((await view(h, f)).settlements.length, 1);
  });
});

describe('BT-009-09 backups and restores include shared expenses', () => {
  const backupNow = async (h, f) => ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
  const preview = (h, f, as, archiveId, mode) => h.call('restore', 'POST', { as, query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode } });
  const execute = (h, f, as, body) => h.call('restore', 'POST', { as, query: { action: 'execute' }, body: { workspaceId: f.ws.id, ...body } });

  test('replace sets later expenses aside (kept whole), and merge brings them back', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const e1 = await addExpense(h, f, 'alice', { description: 'Before backup', amount: '40.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    const s1 = await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.alice, amount: '5.00' });
    const b0 = await backupNow(h, f);
    const e2 = await addExpense(h, f, 'bob', { description: 'After backup', amount: '10.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.alice, f.refs.bob) });
    const b1 = await backupNow(h, f);
    const pv = ok(await preview(h, f, 'alice', b0, 'replace'));
    assert.equal(pv.scope.groupExpenses, 1);
    assert.equal(pv.scope.groupSettlements, 1);
    assert.equal(pv.excluded.setAside, 1);
    ok(await execute(h, f, 'alice', { archiveId: b0, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' }));
    let v = await view(h, f);
    assert.deepEqual(v.expenses.map((x) => x.id), [e1.id]);
    assert.deepEqual(v.settlements.map((x) => x.id), [s1.id]);
    const { value: doc } = await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`);
    assert.deepEqual(doc.superseded.map((s) => [s.collection, s.reason, s.record.id]), [['groupExpenses', 'not-in-backup', e2.id]]);
    const hist = ok(await h.call('backups', 'GET', { as: 'alice', query: { ...f.q, action: 'history' } }));
    assert.deepEqual(hist.setAside.map((s) => [s.collection, s.summary]), [['groupExpenses', { date: e2.date, amount: '10.00', currency: 'EUR', name: 'After backup' }]]);
    const pv2 = ok(await preview(h, f, 'alice', b1, 'merge'));
    ok(await execute(h, f, 'alice', { archiveId: b1, mode: 'merge', expectedEtag: pv2.expectedEtag }));
    v = await view(h, f);
    assert.deepEqual(v.expenses.map((x) => x.id).sort(), [e1.id, e2.id].sort());
    // Alice +20.00 on the first expense − 5.00 share of the second; the reported 5.00 is pending.
    assert.deepEqual([row(v, f.refs.alice).net, row(v, f.refs.alice).pendingIn], ['15.00', '5.00']);
  });

  test('a member\'s restore does not touch shared expenses', async () => {
    const h = harness();
    const f = await groupFixture(h);
    await addExpense(h, f, 'alice', { description: 'Shared', amount: '10.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    const b0 = await backupNow(h, f);
    const pv = ok(await preview(h, f, 'bob', b0, 'replace'));
    assert.equal(pv.scope.groupExpenses, 0);
  });

  test('integrity checks refuse payers or shares that do not add up, unknown people and empty payments', async () => {
    for (const [label, tamper] of [
      ['payers', (d) => { d.groupExpenses[0].payers[0].amountMinor = 3000; }],
      ['shares', (d) => { d.groupExpenses[0].shares[0].amountMinor += 1; d.groupExpenses[0].shares[1].amountMinor -= 1; }],
      ['person', (d) => { d.groupExpenses[0].payers[0].ref = 'member:mem_nosuch000'; }],
      ['private contact', (d) => { d.groupExpenses[0].shares[1].ref = 'pcontact:pc_nosuch000'; }],
      ['settlement', (d) => { d.groupSettlements[0].amountMinor = 0; }],
      ['settlement currency', (d) => { d.groupSettlements[0].currency = 'ZZZ'; }],
    ]) {
      const h = harness();
      const f = await groupFixture(h);
      await addExpense(h, f, 'alice', { description: 'x', amount: '40.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
      await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.alice, amount: '5.00' });
      const name = `workspaces/${f.ws.id}/workspace.json`;
      const { value } = await h.storage.getJson(name);
      tamper(value);
      await h.storage.putJson(name, value);
      const res = await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} });
      assert.equal(res.status, 422, label);
      assert.equal(res.body.error.code, 'backup_invalid', label);
    }
  });

  test('create-new keeps shared expenses only when they name nobody but the restorer and contacts', async () => {
    const h = harness();
    const f = await groupFixture(h);
    await addExpense(h, f, 'alice', { description: 'With Bob', amount: '10.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    const b0 = await backupNow(h, f);
    const blocked = ok(await preview(h, f, 'alice', b0, 'create-new'));
    assert.equal(blocked.canExecute, false);
    assert.match(blocked.blockers[0], /Shared expenses in this backup name other members/);
    // A solo group: Alice and a contact.
    const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Solo Trip', kind: 'trip', reportingCurrency: 'EUR' } }), 201).workspace;
    const solo = { ws, q: { workspaceId: ws.id } };
    const me = `member:${ok(await h.call('members', 'GET', { as: 'alice', query: solo.q })).members[0].id}`;
    const pal = ok(await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'workspace', workspaceId: ws.id, name: 'Travel Pal' } }), 201).contact;
    await addExpense(h, solo, 'alice', { description: 'Hostel', amount: '50.00', payers: [{ ref: me }], split: equal(me, pal.ref) });
    const b1 = await backupNow(h, solo);
    const pv = ok(await preview(h, solo, 'alice', b1, 'create-new'));
    assert.equal(pv.canExecute, true, JSON.stringify(pv.blockers));
    const res = ok(await execute(h, solo, 'alice', { archiveId: b1, mode: 'create-new' }), 201);
    const nv = ok(await h.call('group', 'GET', { as: 'alice', query: { workspaceId: res.workspace.id } }));
    assert.deepEqual(nv.expenses.map((x) => x.description), ['Hostel']);
    assert.equal(nv.participants.find((p) => p.ref === me).self, true, 'the restorer keeps their place as payer');
    assert.equal(row(nv, me).net, '25.00');
  });

  test('a replace that would separate a shared expense from entries another member recorded on their own account is blocked', async () => {
    const h = harness();
    const f = await groupFixture(h);
    const b0 = await backupNow(h, f);
    const wallet = ok(await h.call('accounts', 'POST', { as: 'bob', query: f.q, body: { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' } }), 201).account;
    await addExpense(h, f, 'bob', { description: 'After backup', amount: '10.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.alice, f.refs.bob), ledger: { accountId: wallet.id } });
    const pv = ok(await preview(h, f, 'alice', b0, 'replace'));
    assert.equal(pv.canExecute, false);
    assert.match(pv.blockers[0], /recorded on their own account/);
    assert.equal(JSON.stringify(pv).includes(wallet.id), false);
  });
});
