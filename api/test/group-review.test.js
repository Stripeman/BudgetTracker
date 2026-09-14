'use strict';
// BT-009 increment 1 review remediation: regression tests for the independent financial review
// (findings 1–8) and security review (S1–S8) of f3ce009. Every expected value is computed by hand in
// the comments, independently of the code. All people, accounts and amounts are fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');
const groups = require('../_shared/groups');

const FRANK = Object.freeze({ userId: 'g-frank', email: 'frank@example.com', name: 'Frank Fictional' });
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const who = (w) => (typeof w === 'string' ? { as: w } : { user: w });

// Alice owner, Bob member, Carol viewer, Frank manager, Eve member, Dana a shared contact (no login).
async function fixture(h, { kind = 'group' } = {}) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Review Club', kind, reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const join = async (w, role) => {
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: (typeof w === 'string' ? USERS[w] : w).email, role } }), 201);
    ok(await h.call('invitations', 'POST', { ...who(w), query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  };
  await join('bob', 'member');
  await join('carol', 'viewer');
  await join(FRANK, 'manager');
  await join('eve', 'member');
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const mid = (name) => members.find((m) => m.name.startsWith(name)).id;
  const dana = ok(await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'workspace', workspaceId: ws.id, name: 'Dana Contact' } }), 201).contact;
  const refs = { alice: `member:${mid('Alice')}`, bob: `member:${mid('Bob')}`, carol: `member:${mid('Carol')}`, frank: `member:${mid('Frank')}`, eve: `member:${mid('Eve')}`, dana: dana.ref };
  return { ws, q, refs, mid };
}

const G = (h, f, w, method, { query = {}, body } = {}) => h.call('group', method, { ...who(w), query: { ...f.q, ...query }, body });
const act = (h, f, w, action, body) => G(h, f, w, 'POST', { query: { action }, body });
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });
const addExpense = async (h, f, w, body) => ok(await G(h, f, w, 'POST', { body }), 201).expense;
const settle = async (h, f, w, body) => ok(await act(h, f, w, 'settle', body), 201).settlement;
const view = async (h, f, w = 'alice') => ok(await G(h, f, w, 'GET'));
const account = async (h, f, w, body) => ok(await h.call('accounts', 'POST', { ...who(w), query: f.q, body }), 201).account;
const balanceOf = async (h, f, w, id) => ok(await h.call('accounts', 'GET', { ...who(w), query: f.q })).accounts.find((a) => a.id === id).balance;
const entriesOf = async (h, f, w, accountId) => ok(await h.call('transactions', 'GET', { ...who(w), query: { ...f.q, accountId } })).transactions;
const summaryOf = async (h, f, w, accountId) => ok(await h.call('transactions', 'GET', { ...who(w), query: { ...f.q, accountId } })).summary.find((s) => s.currency === 'EUR');

describe('finding 4 / S3: group link keys are server-only', () => {
  test('the transactions route refuses links.groupExpenseId and links.groupSettlementId on create', async () => {
    const h = harness();
    const f = await fixture(h, { kind: 'household' });
    const joint = await account(h, f, 'alice', { name: 'Joint', type: 'checking', currency: 'EUR', visibility: 'shared', openingBalance: '1000.00' });
    const cash = await account(h, f, 'alice', { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    const e = await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '300.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.frank, f.refs.dana), ledger: { accountId: cash.id } });
    for (const [w, accountId, links] of [['eve', joint.id, { groupExpenseId: e.id }], ['alice', cash.id, { groupExpenseId: e.id }], ['alice', cash.id, { groupSettlementId: 'gst_nosuch0000' }]]) {
      const res = await h.call('transactions', 'POST', { ...who(w), query: f.q, body: { accountId, kind: 'expense', amount: '20.00', links } });
      assert.equal(res.status, 400, `${w} ${JSON.stringify(links)}`);
      assert.equal(res.body.error.code, 'invalid_field');
    }
    // Nothing was written: Alice's cash is 500.00 − 300.00 = 200.00; the Joint is untouched.
    assert.equal(await balanceOf(h, f, 'alice', cash.id), '200.00');
    assert.equal(await balanceOf(h, f, 'alice', joint.id), '1000.00');
    // Other link keys still work.
    ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: cash.id, kind: 'expense', amount: '1.00', links: { tripId: 'trp_fiction0001' } } }), 201);
    assert.equal((await view(h, f)).expenses[0].myLedger.needsReview, false);
  });
});

describe('finding 6: the backup integrity check applies the split rules the API applies', () => {
  const EQUAL = { method: 'equal', lines: [{ ref: 'member:a', value: null }, { ref: 'member:b', value: null }] };
  // One expense of 90.00 paid by a, with shares exactly what the stored split gives (when it can be
  // computed at all), so only the split rule itself can be at fault.
  const docWith = (split) => {
    let shares;
    try { shares = groups.computeShares(9000, split).shares.map(({ ref, amountMinor }) => ({ ref, amountMinor })); } catch { shares = [{ ref: 'member:a', amountMinor: 4500 }, { ref: 'member:b', amountMinor: 4500 }]; }
    return { members: [{ id: 'a' }, { id: 'b' }], contacts: [], categories: [], groupSettlements: [],
      groupExpenses: [{ id: 'x', currency: 'EUR', amountMinor: 9000, payers: [{ ref: 'member:a', amountMinor: 9000 }], split, shares }] };
  };
  test('valid stored splits of every method pass', () => {
    for (const split of [
      EQUAL,
      { method: 'shares', lines: [{ ref: 'member:a', value: 2 }, { ref: 'member:b', value: 1 }] },
      { method: 'percentages', lines: [{ ref: 'member:a', value: '60' }, { ref: 'member:b', value: '40' }] },
      { method: 'amounts', lines: [{ ref: 'member:a', value: 5000 }, { ref: 'member:b', value: 4000 }] },
    ]) assert.equal(groups.invariantProblem(docWith(split)), null, split.method);
  });
  test('percentages not totalling 100, zero or oversized weights, zero amounts, values on an equal split, non-canonical percentages and repeated people are refused', () => {
    for (const [label, split] of [
      // 50 % + 40 % = 90 %: the API refuses it (split_percent_total); the shares 5000 / 4000 still add up to 9000.
      ['percent total', { method: 'percentages', lines: [{ ref: 'member:a', value: '50' }, { ref: 'member:b', value: '40' }] }],
      ['zero weight', { method: 'shares', lines: [{ ref: 'member:a', value: 0 }, { ref: 'member:b', value: 1 }] }],
      ['weight too big', { method: 'shares', lines: [{ ref: 'member:a', value: 1001 }, { ref: 'member:b', value: 1 }] }],
      ['fractional weight', { method: 'shares', lines: [{ ref: 'member:a', value: 1.5 }, { ref: 'member:b', value: 1 }] }],
      ['zero amount', { method: 'amounts', lines: [{ ref: 'member:a', value: 0 }, { ref: 'member:b', value: 9000 }] }],
      ['equal with value', { method: 'equal', lines: [{ ref: 'member:a', value: 1 }, { ref: 'member:b', value: null }] }],
      ['non-canonical percent', { method: 'percentages', lines: [{ ref: 'member:a', value: '50.0' }, { ref: 'member:b', value: '50' }] }],
      ['repeated person', { method: 'equal', lines: [{ ref: 'member:a', value: null }, { ref: 'member:a', value: null }] }],
    ]) assert.equal(groups.invariantProblem(docWith(split)), 'group expense split', label);
  });
  test('a backup of a workspace whose stored split breaks the rule is refused', async () => {
    const h = harness();
    const f = await fixture(h);
    await addExpense(h, f, 'alice', { description: 'Fictional museum', amount: '90.00', payers: [{ ref: f.refs.alice }], split: { method: 'percentages', lines: [{ ref: f.refs.alice, value: '50' }, { ref: f.refs.bob, value: '50' }] } });
    const name = `workspaces/${f.ws.id}/workspace.json`;
    const { value } = await h.storage.getJson(name);
    // 50/40 with the shares recomputed so they still add up to 90.00 (5000 + 4000).
    value.groupExpenses[0].split.lines[1].value = '40';
    value.groupExpenses[0].shares = groups.computeShares(9000, value.groupExpenses[0].split).shares.map(({ ref, amountMinor }) => ({ ref, amountMinor }));
    await h.storage.putJson(name, value);
    const res = await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'backup_invalid');
    assert.match(res.body.error.message, /group expense split/);
  });
});

// A pure-model document: each expense is paid by one person for one other person, so its net effect is
// exactly +amount for the payer and −amount for the beneficiary.
const lent = (id, from, to, amountMinor) => ({ id, currency: 'EUR', amountMinor, date: '2026-09-01', description: id, voidedAt: null,
  payers: [{ ref: to, amountMinor }], shares: [{ ref: from, amountMinor }] });
const pay = (id, from, to, amountMinor, status, date = '2026-09-02') => ({ id, from, to, amountMinor, currency: 'EUR', status, date, createdAt: `${date}T00:00:00.000Z`, voidedAt: null });

describe('finding 7: fewest payments matches exact opposite amounts first', () => {
  test('balances +4 −9 +9 +6 −4 +6 −12 settle in 4 payments, not 6', () => {
    const P = Array.from({ length: 7 }, (_, i) => `member:p${i}`);
    // p1 owes p2 9, p4 owes p0 4, p6 owes p3 6 and p5 6 → nets p0 +4, p1 −9, p2 +9, p3 +6, p4 −4, p5 +6, p6 −12.
    const doc = { members: [], contacts: [], groupSettlements: [], groupExpenses: [
      lent('a', P[1], P[2], 900), lent('b', P[4], P[0], 400), lent('c', P[6], P[3], 600), lent('d', P[6], P[5], 600)] };
    const [b] = groups.balances(doc, P);
    assert.deepEqual(P.map((r) => b.rows.find((x) => x.ref === r).netMinor), [400, -900, 900, 600, -400, 600, -1200]);
    // Exact pairs first, creditors largest first then in listed order: 9 ↔ 9, then 4 ↔ 4; the rest by the
    // greedy rule, ties in listed order: p6 pays p3 6, then p5 6.
    assert.deepEqual(b.suggestions, [
      { from: P[1], to: P[2], amountMinor: 900 },
      { from: P[4], to: P[0], amountMinor: 400 },
      { from: P[6], to: P[3], amountMinor: 600 },
      { from: P[6], to: P[5], amountMinor: 600 },
    ]);
  });
});

describe('finding 5: a reported payment counts in suggestions only up to what is owed', () => {
  const A = 'member:a';
  const B = 'member:b';
  const C = 'member:c';
  const base = () => ({ members: [], contacts: [], groupExpenses: [
    // a paid 100.00 shared equally by a and b: a +50, b −50.
    { id: 'E', currency: 'EUR', amountMinor: 10000, date: '2026-09-01', description: 'E', voidedAt: null, payers: [{ ref: A, amountMinor: 10000 }], shares: [{ ref: A, amountMinor: 5000 }, { ref: B, amountMinor: 5000 }] },
  ], groupSettlements: [] });
  test('b owes 50.00 but reports paying 80.00: no suggestion asks a to pay b', () => {
    const doc = base();
    doc.groupSettlements = [pay('S', B, A, 8000, 'reported')];
    const [b] = groups.balances(doc, [A, B]);
    // Nets stay +50 / −50 (reported payments are pending); pending shown in full.
    assert.deepEqual(b.rows.map((r) => [r.ref, r.netMinor, r.pendingInMinor, r.pendingOutMinor]), [[A, 5000, 8000, 0], [B, -5000, 0, 8000]]);
    assert.deepEqual(b.suggestions, []);
  });
  test('a smaller reported payment is counted in full; the rest is suggested', () => {
    const doc = base();
    doc.groupSettlements = [pay('S', B, A, 3000, 'reported')];
    assert.deepEqual(groups.balances(doc, [A, B])[0].suggestions, [{ from: B, to: A, amountMinor: 2000 }]);
  });
  test('an overclaim never moves a debt onto someone else, and a claim to someone who is owed nothing is not counted', () => {
    const doc = base();
    // c also owes a 30.00: a +80, b −50, c −30.
    doc.groupExpenses.push(lent('F', C, A, 3000));
    doc.groupSettlements = [pay('S', B, A, 8000, 'reported')];
    // b's 80.00 claim counts 50.00 (what b owes); c still owes a 30.00.
    assert.deepEqual(groups.balances(doc, [A, B, C])[0].suggestions, [{ from: C, to: A, amountMinor: 3000 }]);
    // b reports paying c, who is owed nothing: not counted, so b still pays a 50.00 and c pays a 30.00.
    doc.groupSettlements = [pay('S', B, C, 5000, 'reported')];
    assert.deepEqual(groups.balances(doc, [A, B, C])[0].suggestions, [{ from: B, to: A, amountMinor: 5000 }, { from: C, to: A, amountMinor: 3000 }]);
  });
  test('generated groups with reported and disputed payments: the basis adds up to zero, never crosses zero, and suggestions clear it in at most n − 1 payments', () => {
    let seed = 23;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let run = 0; run < 400; run += 1) {
      const P = Array.from({ length: 2 + rnd(7) }, (_, i) => `member:p${i}`);
      const pick = () => P[rnd(P.length)];
      const expenses = Array.from({ length: 1 + rnd(6) }, (_, i) => {
        const [from, to] = [pick(), pick()];
        return lent(`x${i}`, from, to === from ? P[(P.indexOf(from) + 1) % P.length] : to, 1 + rnd(20000));
      });
      const settlements = Array.from({ length: rnd(5) }, (_, i) => {
        const from = pick();
        const to = P[(P.indexOf(from) + 1 + rnd(P.length - 1)) % P.length];
        return pay(`s${i}`, from, to, 1 + rnd(20000), ['reported', 'confirmed', 'disputed'][rnd(3)], `2026-09-0${1 + rnd(9)}`);
      });
      const doc = { members: [], contacts: [], groupExpenses: expenses, groupSettlements: settlements };
      const [b] = groups.balances(doc, P);
      assert.equal(b.rows.reduce((s, r) => s + r.basisMinor, 0), 0, `run ${run} basis sums to zero`);
      for (const r of b.rows) {
        assert.ok(Math.sign(r.basisMinor) === 0 || Math.sign(r.basisMinor) === Math.sign(r.netMinor), `run ${run} ${r.ref} basis ${r.basisMinor} crossed net ${r.netMinor}`);
        assert.ok(Math.abs(r.basisMinor) <= Math.abs(r.netMinor), `run ${run} ${r.ref} basis grew`);
      }
      const left = new Map(b.rows.map((r) => [r.ref, r.basisMinor]));
      for (const s of b.suggestions) {
        assert.ok(s.amountMinor > 0);
        assert.ok(left.get(s.from) < 0 && left.get(s.to) > 0, `run ${run} pays only debtor to creditor`);
        left.set(s.from, left.get(s.from) + s.amountMinor);
        left.set(s.to, left.get(s.to) - s.amountMinor);
      }
      assert.ok([...left.values()].every((v) => v === 0), `run ${run} clears everyone`);
      assert.ok(b.suggestions.length <= Math.max(0, b.rows.length - 1), `run ${run} at most n − 1`);
      assert.deepEqual(groups.balances(doc, P)[0].suggestions, b.suggestions, 'deterministic');
    }
  });
});

describe('finding 3: changing the reporting currency never strands an open balance', () => {
  const setCurrency = (h, f, as, reportingCurrency) => h.call('workspaces', 'PATCH', { as, query: { id: f.ws.id }, body: { settings: { reportingCurrency } } });
  test('the change is refused while any group balance is not zero, and allowed once everyone is settled up', async () => {
    const h = harness();
    const f = await fixture(h);
    // EUR 90.00 paid by Alice, shared by Alice and Bob: Alice +45.00, Bob −45.00.
    await addExpense(h, f, 'alice', { description: 'Fictional food', amount: '90.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    const refused = await setCurrency(h, f, 'alice', 'USD');
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'group_balances_open');
    assert.match(refused.body.error.message, /EUR/);
    assert.match(refused.body.error.message, /settle/i);
    assert.equal((await view(h, f)).currency, 'EUR', 'unchanged');
    // Other settings still change.
    ok(await h.call('workspaces', 'PATCH', { as: 'alice', query: { id: f.ws.id }, body: { settings: { weekStart: 0 } } }));
    // A reported payment is not enough: balances count confirmed payments only.
    const s = await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.alice, amount: '45.00' });
    assert.equal((await setCurrency(h, f, 'alice', 'USD')).body.error.code, 'group_balances_open');
    ok(await act(h, f, 'alice', 'confirm', { settlementId: s.id, revision: s.revision }));
    ok(await setCurrency(h, f, 'alice', 'USD'));
    assert.equal((await view(h, f)).currency, 'USD');
  });

  test('a balance left in the earlier currency can still be settled in it, and is shown', async () => {
    const h = harness();
    const f = await fixture(h);
    await addExpense(h, f, 'alice', { description: 'Fictional food', amount: '90.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    const s = await settle(h, f, 'alice', { from: f.refs.bob, to: f.refs.alice, amount: '45.00' });
    ok(await setCurrency(h, f, 'alice', 'USD'));
    // The EUR payment is withdrawn afterwards, so Bob owes EUR 45.00 again in a workspace now in USD.
    ok(await act(h, f, 'alice', 'void', { settlementId: s.id, revision: s.revision, reason: 'Recorded by mistake' }));
    let v = await view(h, f, 'bob');
    assert.equal(v.currency, 'USD');
    const eur = v.balances.find((b) => b.currency === 'EUR');
    assert.deepEqual(eur.rows.filter((r) => r.netMinor).map((r) => [r.ref, r.net]), [[f.refs.alice, '45.00'], [f.refs.bob, '-45.00']]);
    assert.deepEqual(eur.suggestions.map((x) => [x.from, x.to, x.amount]), [[f.refs.bob, f.refs.alice, '45.00']]);
    // Settling in EUR is allowed because EUR has an open balance; a currency with none is not.
    const paid = await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.alice, amount: '45.00', currency: 'EUR' });
    assert.equal(paid.currency, 'EUR');
    ok(await act(h, f, 'alice', 'confirm', { settlementId: paid.id, revision: paid.revision }));
    v = await view(h, f, 'bob');
    assert.ok(v.balances.find((b) => b.currency === 'EUR').rows.every((r) => r.netMinor === 0), 'EUR settled');
    const gbp = await act(h, f, 'bob', 'settle', { from: f.refs.bob, to: f.refs.alice, amount: '1.00', currency: 'GBP' });
    assert.equal(gbp.status, 400);
    assert.equal(gbp.body.error.code, 'currency_not_supported');
    // Now EUR is settled, a new EUR payment is refused too; expenses stay in the reporting currency.
    assert.equal((await act(h, f, 'bob', 'settle', { from: f.refs.bob, to: f.refs.alice, amount: '1.00', currency: 'EUR' })).body.error.code, 'currency_not_supported');
    assert.equal((await G(h, f, 'alice', 'POST', { body: { description: 'x', amount: '1.00', currency: 'EUR', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice) } })).body.error.code, 'currency_not_supported');
    ok(await act(h, f, 'bob', 'settle', { from: f.refs.bob, to: f.refs.alice, amount: '1.00', currency: 'USD' }), 201);
  });
});

// ---- the personal ledger (findings 1 and 2, S2) -------------------------------------------------
// For a person who records their shared expenses on an account of their own, per group and currency
// (Terry's model, 2026-09-14):
//   cash        = −(what they paid for expenses) + (repayments received) − (repayments made)
//   spending    = the sum of their shares of every active expense, whoever paid
//   receivable  = advances − reimbursements − payables + repayments = their group balance
// The summary reports each bucket as a positive amount and `receivable` signed (+ owed to them).
const ledgerOf = async (h, f, w, accountId) => {
  const s = await summaryOf(h, f, w, accountId) || { gross: '0.00', advances: '0.00', payables: '0.00', reimbursements: '0.00', repayments: '0.00', receivable: '0.00' };
  return { cash: await balanceOf(h, f, w, accountId), spent: s.gross, advances: s.advances, payables: s.payables, reimbursed: s.reimbursements, repaid: s.repayments, receivable: s.receivable };
};
const netOf = (v, ref, currency = 'EUR') => v.balances.find((b) => b.currency === currency).rows.find((r) => r.ref === ref).net;

describe('finding 2: shares of other people\'s expenses and repayments are recorded, so spending and what is owed are right after netting', () => {
  test('dinner + taxi, settled by netting, then a void and a correction: both people\'s cash, spending and outstanding after every step', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, frank, dana } = f.refs;
    const aCash = await account(h, f, 'alice', { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    const bCash = await account(h, f, 'bob', { name: 'Bob Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });

    // 1. Alice pays dinner 300.00 shared by Alice, Bob, Frank and Dana (75.00 each) and records it.
    //    Alice: cash 500 − 300 = 200; spending 75; lent 225; owed to her 225 = her balance 300 − 75.
    const dinner = await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '300.00', payers: [{ ref: alice }], split: equal(alice, bob, frank, dana), ledger: { accountId: aCash.id } });
    assert.deepEqual(await ledgerOf(h, f, 'alice', aCash.id), { cash: '200.00', spent: '75.00', advances: '225.00', payables: '0.00', reimbursed: '0.00', repaid: '0.00', receivable: '225.00' });
    assert.equal(netOf(await view(h, f), alice), '225.00');

    // 2. Bob pays a taxi 100.00 shared by Alice and Bob (50.00 each) and records his group activity.
    //    Bob: dinner share 75 (paid 0) → spending 75, owes 75; taxi paid 100, share 50 → spending 50,
    //    lent 50. Cash 500 − 100 = 400; spending 125; outstanding 50 − 75 = −25 = his balance 100 − 125.
    const taxi = await addExpense(h, f, 'bob', { description: 'Fictional taxi', amount: '100.00', payers: [{ ref: bob }], split: equal(alice, bob), ledger: { accountId: bCash.id } });
    assert.deepEqual(await ledgerOf(h, f, 'bob', bCash.id), { cash: '400.00', spent: '125.00', advances: '50.00', payables: '75.00', reimbursed: '0.00', repaid: '0.00', receivable: '-25.00' });
    let v = await view(h, f);
    assert.deepEqual([netOf(v, alice), netOf(v, bob)], ['175.00', '-25.00']);
    // Bob's write never touched Alice's account; her taxi share waits for her.
    assert.equal(await balanceOf(h, f, 'alice', aCash.id), '200.00');
    assert.equal(v.expenses.find((e) => e.id === taxi.id).myLedger.needsReview, true);
    ok(await act(h, f, 'alice', 'ledger', { expenseId: taxi.id }));
    // Alice: + taxi share 50 (paid 0) → spending 125; owes 50; outstanding 225 − 50 = 175 = her balance.
    assert.deepEqual(await ledgerOf(h, f, 'alice', aCash.id), { cash: '200.00', spent: '125.00', advances: '225.00', payables: '50.00', reimbursed: '0.00', repaid: '0.00', receivable: '175.00' });

    // 3. Settle by the suggestions: Alice +175, Bob −25, Frank −75, Dana −75 → Frank 75, Dana 75, Bob 25 to Alice.
    assert.deepEqual((await view(h, f)).balances[0].suggestions.map((s) => [s.from, s.to, s.amount]), [[frank, alice, '75.00'], [dana, alice, '75.00'], [bob, alice, '25.00']]);
    const fromFrank = await settle(h, f, FRANK, { from: frank, to: alice, amount: '75.00' });
    ok(await act(h, f, 'alice', 'confirm', { settlementId: fromFrank.id, revision: fromFrank.revision }));
    await settle(h, f, 'alice', { from: dana, to: alice, amount: '75.00' });
    const fromBob = await settle(h, f, 'bob', { from: bob, to: alice, amount: '25.00' });
    // A reported payment is not in the balance, so nothing is recorded for it yet.
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    assert.equal((await ledgerOf(h, f, 'bob', bCash.id)).cash, '400.00');
    ok(await act(h, f, 'alice', 'confirm', { settlementId: fromBob.id, revision: fromBob.revision }));
    // Alice received 175: cash 200 + 175 = 375; spending still 125; nothing owed to her.
    assert.deepEqual(await ledgerOf(h, f, 'alice', aCash.id), { cash: '375.00', spent: '125.00', advances: '225.00', payables: '50.00', reimbursed: '175.00', repaid: '0.00', receivable: '0.00' });
    v = await view(h, f, 'bob');
    assert.equal(v.settlements.find((s) => s.id === fromBob.id).myLedger.needsReview, true);
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    // Bob paid out 25: cash 400 − 25 = 375 (true: 500 − 100 − 25); spending 125; owes nothing.
    assert.deepEqual(await ledgerOf(h, f, 'bob', bCash.id), { cash: '375.00', spent: '125.00', advances: '50.00', payables: '75.00', reimbursed: '0.00', repaid: '25.00', receivable: '0.00' });
    for (const r of (await view(h, f)).balances[0].rows) assert.equal(r.net, '0.00', r.ref);

    // 4. Bob voids the taxi after netting; his own entries follow at once.
    //    Bob: cash 375 + 100 = 475; spending 75; owes 75 − 25 = 50 = his balance 0 − 75 + 25.
    ok(await act(h, f, 'bob', 'void', { expenseId: taxi.id, revision: taxi.revision, reason: 'Paid by the company' }));
    assert.deepEqual(await ledgerOf(h, f, 'bob', bCash.id), { cash: '475.00', spent: '75.00', advances: '0.00', payables: '75.00', reimbursed: '0.00', repaid: '25.00', receivable: '-50.00' });
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR' }));
    //    Alice: taxi share gone → spending 75; owed 225 − 175 = 50 = her balance 300 − 75 − 175.
    assert.deepEqual(await ledgerOf(h, f, 'alice', aCash.id), { cash: '375.00', spent: '75.00', advances: '225.00', payables: '0.00', reimbursed: '175.00', repaid: '0.00', receivable: '50.00' });
    v = await view(h, f);
    assert.deepEqual([netOf(v, alice), netOf(v, bob)], ['50.00', '-50.00']);

    // 5. Alice corrects the dinner to 320.00 (80.00 each); her entries follow at once.
    //    Alice: cash 375 − 20 = 355; spending 80; owed 240 − 175 = 65 = 320 − 80 − 175.
    const cur = (await view(h, f)).expenses.find((e) => e.id === dinner.id);
    ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: dinner.id, revision: cur.revision, amount: '320.00', payers: [{ ref: alice }], split: equal(alice, bob, frank, dana), reason: 'Tip added' } }));
    assert.deepEqual(await ledgerOf(h, f, 'alice', aCash.id), { cash: '355.00', spent: '80.00', advances: '240.00', payables: '0.00', reimbursed: '175.00', repaid: '0.00', receivable: '65.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    //    Bob: no cash moves; spending 80; owes 80 − 25 = 55 = 0 − 80 + 25.
    assert.deepEqual(await ledgerOf(h, f, 'bob', bCash.id), { cash: '475.00', spent: '80.00', advances: '0.00', payables: '80.00', reimbursed: '0.00', repaid: '25.00', receivable: '-55.00' });
    v = await view(h, f);
    assert.deepEqual([alice, bob, frank, dana].map((r) => netOf(v, r)), ['65.00', '-55.00', '-5.00', '-5.00']);
    // Nothing needs review, and bringing everything up to date again adds no entry.
    const count = (await entriesOf(h, f, 'bob', bCash.id)).length;
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    assert.equal((await entriesOf(h, f, 'bob', bCash.id)).length, count);
    assert.ok((await view(h, f, 'bob')).expenses.every((e) => !e.myLedger || !e.myLedger.needsReview));
  });

  test('the brief\'s EUR 300 dinner is unchanged for the payer', async () => {
    const h = harness();
    const f = await fixture(h);
    const cash = await account(h, f, 'alice', { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    const e = await addExpense(h, f, 'alice', { description: 'Shared dinner', amount: '300.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.frank, f.refs.dana), ledger: { accountId: cash.id } });
    assert.deepEqual((await entriesOf(h, f, 'alice', cash.id)).map((t) => [t.kind, t.amount, t.links.groupExpenseId]).sort(), [['advance', '-225.00', e.id], ['expense', '-75.00', e.id]]);
    assert.deepEqual(await ledgerOf(h, f, 'alice', cash.id), { cash: '200.00', spent: '75.00', advances: '225.00', payables: '0.00', reimbursed: '0.00', repaid: '0.00', receivable: '225.00' });
  });

  test('someone who paid less than their share: spending is the share and the rest is owed', async () => {
    const h = harness();
    const f = await fixture(h);
    const aCash = await account(h, f, 'alice', { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    const bCash = await account(h, f, 'bob', { name: 'Bob Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    // 100.00 paid 30.00 by Alice and 70.00 by Bob, shared equally (50.00 each).
    await addExpense(h, f, 'alice', { description: 'Fictional groceries', amount: '100.00', payers: [{ ref: f.refs.alice, amount: '30.00' }, { ref: f.refs.bob, amount: '70.00' }], split: equal(f.refs.alice, f.refs.bob), ledger: { accountId: aCash.id } });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: bCash.id }));
    // Alice: cash −30; spending 50; owes 20. Bob: cash −70; spending 50; owed 20.
    assert.deepEqual(await ledgerOf(h, f, 'alice', aCash.id), { cash: '470.00', spent: '50.00', advances: '0.00', payables: '20.00', reimbursed: '0.00', repaid: '0.00', receivable: '-20.00' });
    assert.deepEqual(await ledgerOf(h, f, 'bob', bCash.id), { cash: '430.00', spent: '50.00', advances: '20.00', payables: '0.00', reimbursed: '0.00', repaid: '0.00', receivable: '20.00' });
    const v = await view(h, f);
    assert.deepEqual([netOf(v, f.refs.alice), netOf(v, f.refs.bob)], ['-20.00', '20.00']);
  });

  test('a budget counts a share of someone else\'s expense as spending', async () => {
    const h = harness();
    const f = await fixture(h);
    const cat = ok(await h.call('categories', 'GET', { as: 'bob', query: f.q })).categories.find((c) => c.type !== 'income' && !c.archived);
    const bCash = await account(h, f, 'bob', { name: 'Bob Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: bCash.id }));
    ok(await h.call('budgets', 'POST', { as: 'bob', query: f.q, body: { name: 'Bob eating out', scope: 'private', currency: 'EUR', startDate: '2026-01-01', lines: [{ categoryId: cat.id, amount: '200.00' }] } }), 201);
    await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '300.00', categoryId: cat.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.frank, f.refs.dana) });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    // Bob paid nothing, but 75.00 of the dinner is his spending in that category; his cash is unchanged.
    const [b] = ok(await h.call('budgets', 'GET', { as: 'bob', query: f.q })).budgets;
    assert.deepEqual([b.status.lines[0].actual, b.status.lines[0].available], ['75.00', '125.00']);
    assert.equal(await balanceOf(h, f, 'bob', bCash.id), '500.00');
  });

  test('stopping reverses every entry in that currency and keeps the link as ended; linking again restores them', async () => {
    const h = harness();
    const f = await fixture(h);
    const cash = await account(h, f, 'bob', { name: 'Bob Cash', type: 'cash', currency: 'EUR', openingBalance: '50.00' });
    await addExpense(h, f, 'alice', { description: 'Fictional bread', amount: '10.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    await addExpense(h, f, 'bob', { description: 'Fictional milk', amount: '4.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.alice, f.refs.bob), ledger: { accountId: cash.id } });
    // Bob: bread share 5 (owed), milk paid 4 (share 2, lent 2): cash 50 − 4 = 46; spending 7; outstanding 2 − 5 = −3.
    assert.deepEqual(await ledgerOf(h, f, 'bob', cash.id), { cash: '46.00', spent: '7.00', advances: '2.00', payables: '5.00', reimbursed: '0.00', repaid: '0.00', receivable: '-3.00' });
    assert.deepEqual((await view(h, f, 'bob')).myLedgers.map((l) => [l.currency, l.accountId, l.accountName]), [['EUR', cash.id, 'Bob Cash']]);
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: null }));
    assert.deepEqual(await ledgerOf(h, f, 'bob', cash.id), { cash: '50.00', spent: '0.00', advances: '0.00', payables: '0.00', reimbursed: '0.00', repaid: '0.00', receivable: '0.00' });
    assert.equal((await view(h, f, 'bob')).myLedgers, undefined, 'no current link, so none is shown');
    const { value: doc } = await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`);
    assert.equal(doc.groupLedgers.length, 1);
    assert.ok(doc.groupLedgers[0].endedAt, 'ended, not removed');
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: cash.id }));
    assert.equal((await ledgerOf(h, f, 'bob', cash.id)).cash, '46.00');
  });
});

describe('S2: only the caller\'s own private account can be linked', () => {
  test('a shared account and another person\'s private account are refused, even with a grant to add entries', async () => {
    const h = harness();
    const f = await fixture(h, { kind: 'household' });
    const joint = await account(h, f, 'alice', { name: 'Joint', type: 'checking', currency: 'EUR', visibility: 'shared', openingBalance: '1000.00' });
    const alicePrivate = await account(h, f, 'alice', { name: 'Alice Private', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    ok(await h.call('grants', 'POST', { as: 'alice', query: f.q, body: { accountId: alicePrivate.id, memberId: f.mid('Bob'), capabilities: ['view-transactions', 'create'] } }), 201);
    const body = { description: 'Fictional dinner', amount: '40.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.dana) };
    for (const [w, accountId] of [['bob', joint.id], ['alice', joint.id], [FRANK, joint.id], ['bob', alicePrivate.id]]) {
      const res = await G(h, f, w, 'POST', { body: { ...body, ledger: { accountId } } });
      assert.equal(res.status, 400, `${JSON.stringify(w)} ${accountId}`);
      assert.equal(res.body.error.code, 'not_own_account');
    }
    const e = await addExpense(h, f, 'bob', body);
    assert.equal((await act(h, f, 'bob', 'ledger', { expenseId: e.id, accountId: joint.id })).body.error.code, 'not_own_account');
    assert.equal((await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: alicePrivate.id })).body.error.code, 'not_own_account');
    // Nothing was written anywhere, and no expense was left behind by the refused requests.
    assert.equal(await balanceOf(h, f, 'alice', joint.id), '1000.00');
    assert.equal(await balanceOf(h, f, 'alice', alicePrivate.id), '100.00');
    assert.deepEqual((await view(h, f)).expenses.map((x) => x.id), [e.id]);
  });

  test('the account is shown only to its owner', async () => {
    const h = harness();
    const f = await fixture(h);
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    await addExpense(h, f, 'bob', { description: 'Fictional pizza', amount: '40.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.alice), ledger: { accountId: wallet.id } });
    for (const w of ['alice', 'carol', FRANK]) {
      const text = JSON.stringify(await view(h, f, w));
      assert.equal(text.includes(wallet.id) || text.includes('Bob Wallet'), false, JSON.stringify(w));
    }
    assert.equal((await view(h, f, 'bob')).myLedgers[0].accountId, wallet.id);
  });
});

describe('finding 1: each person\'s entries are theirs alone', () => {
  // Increment 1 let two payers record one expense on the same shared account; this recreates that
  // stored state (links and entries exactly as increment 1 wrote them).
  async function legacyJoint() {
    const h = harness();
    const f = await fixture(h, { kind: 'household' });
    const joint = await account(h, f, 'alice', { name: 'Joint', type: 'checking', currency: 'EUR', visibility: 'shared', openingBalance: '1000.00' });
    // 200.00 paid 100.00 each by Alice and Frank, shared equally: each is charged their own 100.00.
    const e = await addExpense(h, f, 'alice', { description: 'Fictional groceries', amount: '200.00', payers: [{ ref: f.refs.alice, amount: '100.00' }, { ref: f.refs.frank, amount: '100.00' }], split: equal(f.refs.alice, f.refs.frank) });
    const name = `workspaces/${f.ws.id}/workspace.json`;
    const { value: doc } = await h.storage.getJson(name);
    const { newEntry } = require('../_shared/entries');
    const at = '2026-09-13T10:00:00.000Z';
    const rec = doc.groupExpenses[0];
    rec.ledgerLinks = ['google:g-alice', 'google:g-frank'].map((subject) => ({ subject, accountId: joint.id, linkedAt: at, endedAt: null }));
    doc.transactions.push(...['google:g-alice', 'google:g-frank'].map((by) => newEntry({ accountId: joint.id, currency: 'EUR', kind: 'expense', amountMinor: -10000, date: rec.date, notes: 'My share of shared expense', links: { groupExpenseId: e.id }, by, at })));
    await h.storage.putJson(name, doc);
    return { h, f, joint, e };
  }

  test('a sync touches only the caller\'s own entries and never flip-flops', async () => {
    const { h, f, joint, e } = await legacyJoint();
    assert.equal(await balanceOf(h, f, 'alice', joint.id), '800.00');
    // Links to a shared account are no longer honoured (S2): each person's own entry needs review, and
    // only their own entry is listed as theirs.
    let mine = (await view(h, f, 'alice')).expenses[0].myLedger;
    assert.equal(mine.needsReview, true);
    assert.equal(mine.entries.length, 1);
    ok(await act(h, f, 'alice', 'ledger', { expenseId: e.id }));
    // Only Alice's 100.00 is reversed: 800 + 100 = 900. Frank's entry is untouched.
    assert.equal(await balanceOf(h, f, 'alice', joint.id), '900.00');
    const live = (await entriesOf(h, f, 'alice', joint.id)).filter((t) => t.links.groupExpenseId === e.id && !t.reversedBy && !t.links.reverses);
    assert.equal(live.length, 1);
    const count = (await entriesOf(h, f, 'alice', joint.id)).length;
    ok(await act(h, f, 'alice', 'ledger', { expenseId: e.id }));
    assert.equal((await entriesOf(h, f, 'alice', joint.id)).length, count, 'no flip-flop');
    assert.equal((await view(h, f, 'alice')).expenses[0].myLedger, undefined, 'nothing of Alice\'s is left');
    mine = (await view(h, f, FRANK)).expenses[0].myLedger;
    assert.equal(mine.needsReview, true);
    ok(await act(h, f, FRANK, 'ledger', { expenseId: e.id }));
    assert.equal(await balanceOf(h, f, 'alice', joint.id), '1000.00');
    ok(await act(h, f, 'alice', 'ledger', { expenseId: e.id }));
    // Frank's update added one entry (the reversal of his own); Alice's repeat added none: 3 + 1 = 4.
    assert.equal((await entriesOf(h, f, 'alice', joint.id)).length, count + 1, 'only Frank\'s reversal was added');
  });

  test('a per-record link from increment 1 to the person\'s own private account keeps working until they link the group', async () => {
    const h = harness();
    const f = await fixture(h);
    const cash = await account(h, f, 'alice', { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    const e = await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '300.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.frank, f.refs.dana) });
    const taxi = await addExpense(h, f, 'bob', { description: 'Fictional taxi', amount: '100.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.alice, f.refs.bob) });
    const name = `workspaces/${f.ws.id}/workspace.json`;
    const { value: doc } = await h.storage.getJson(name);
    const { newEntry } = require('../_shared/entries');
    const at = '2026-09-13T10:00:00.000Z';
    doc.groupExpenses.find((x) => x.id === e.id).ledgerLinks = [{ subject: 'google:g-alice', accountId: cash.id, linkedAt: at, endedAt: null }];
    doc.transactions.push(
      newEntry({ accountId: cash.id, currency: 'EUR', kind: 'expense', amountMinor: -7500, date: e.date, links: { groupExpenseId: e.id }, by: 'google:g-alice', at }),
      newEntry({ accountId: cash.id, currency: 'EUR', kind: 'advance', amountMinor: -22500, date: e.date, links: { groupExpenseId: e.id }, by: 'google:g-alice', at }),
    );
    await h.storage.putJson(name, doc);
    let v = await view(h, f);
    assert.deepEqual([v.expenses.find((x) => x.id === e.id).myLedger.needsReview, v.expenses.find((x) => x.id === e.id).myLedger.accountName], [false, 'Alice Cash']);
    assert.equal(v.expenses.find((x) => x.id === taxi.id).myLedger, undefined, 'not linked');
    assert.equal(v.myLedgers, undefined, 'a per-record link is not a link for the currency');
    // Linking the group ends the per-record link and brings in the taxi share (50.00 owed, no cash).
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR', accountId: cash.id }));
    assert.deepEqual(await ledgerOf(h, f, 'alice', cash.id), { cash: '200.00', spent: '125.00', advances: '225.00', payables: '50.00', reimbursed: '0.00', repaid: '0.00', receivable: '175.00' });
    const { value: after } = await h.storage.getJson(name);
    assert.ok(after.groupExpenses.find((x) => x.id === e.id).ledgerLinks[0].endedAt, 'ended, kept');
    v = await view(h, f);
    assert.ok(v.expenses.every((x) => x.myLedger && !x.myLedger.needsReview));
  });
});
