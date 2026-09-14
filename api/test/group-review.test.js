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
    // Bob already paid his 70.00 before linking, so this first link would backdate a confirmed cash
    // entry (financial recheck FA-1): refused until he confirms it.
    const refused = await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: bCash.id });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'confirm_backdated');
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: bCash.id, confirmBackdated: true }));
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
    ok(await h.call('budgets', 'POST', { as: 'bob', query: f.q, body: { name: 'Bob eating out', scope: 'private', currency: 'EUR', startDate: '2026-01-01', confirmBackdate: true, lines: [{ categoryId: cat.id, amount: '200.00' }] } }), 201);
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
    // Linking again is treated as a first link too (the earlier one ended): the milk advance is
    // confirmed, pending cash again (financial recheck FA-1), so it needs confirming once more.
    const refused = await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: cash.id });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'confirm_backdated');
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: cash.id, confirmBackdated: true }));
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

  // Security recheck R1 (Terry, 2026-09-14): nothing new is recorded on an account that is not the
  // person's own private account. Financial recheck of 53cf181, N-1 (decision 2026-09-14): each of them
  // paid their own share from the Joint, so their entries stay there, where the money moved; they need no
  // review, and a sync finds them already up to date.
  test('each person sees only their own entry; entries that moved cash on a shared account stay there and a sync writes nothing', async () => {
    const { h, f, joint, e } = await legacyJoint();
    assert.equal(await balanceOf(h, f, 'alice', joint.id), '800.00');
    const count = (await entriesOf(h, f, 'alice', joint.id)).length;
    for (const w of ['alice', FRANK]) {
      const mine = (await view(h, f, w)).expenses[0].myLedger;
      assert.deepEqual([mine.entries.length, mine.needsReview, mine.keptAccount.reason], [1, false, 'shared'], JSON.stringify(w));
      ok(await act(h, f, w, 'ledger', { expenseId: e.id }));
      ok(await act(h, f, w, 'ledger', { currency: 'EUR' }));
    }
    // Nothing written by either: 1000.00 − 100.00 − 100.00 = 800.00, the same two entries (no flip-flop).
    assert.equal(await balanceOf(h, f, 'alice', joint.id), '800.00');
    assert.equal((await entriesOf(h, f, 'alice', joint.id)).length, count);
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

// ---- restores (S1, S4) ----------------------------------------------------------------------------
const backupNow = async (h, f) => { h.clock.advance(60000); return ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId; };
async function restoreAs(h, f, archiveId, mode) {
  h.clock.advance(60000);
  const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode } }));
  assert.equal(pv.canExecute, true, JSON.stringify(pv.blockers));
  return ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode, ...(mode === 'create-new' ? {} : { expectedEtag: pv.expectedEtag }), ...(mode === 'replace' ? { confirm: 'REPLACE' } : {}) } }), mode === 'create-new' ? 201 : 200);
}
const liveFor = async (h, f, w, accountId, id) => (await entriesOf(h, f, w, accountId)).filter((t) => t.links.groupExpenseId === id && !t.reversedBy && !t.links.reverses).length;
// Increment 1's per-record link, planted as it stored it: Bob's pizza on his own wallet.
async function plantRecordLink(h, f, expenseId, walletId) {
  const name = `workspaces/${f.ws.id}/workspace.json`;
  const { value: doc } = await h.storage.getJson(name);
  const { newEntry } = require('../_shared/entries');
  const at = '2026-09-13T10:00:00.000Z';
  const rec = doc.groupExpenses.find((x) => x.id === expenseId);
  rec.ledgerLinks = [{ subject: 'google:g-bob', accountId: walletId, linkedAt: at, endedAt: null }];
  // Bob paid 40.00 and shares 20.00: expense −20.00, advance −20.00.
  doc.transactions.push(
    newEntry({ accountId: walletId, currency: 'EUR', kind: 'expense', amountMinor: -2000, date: rec.date, links: { groupExpenseId: expenseId }, by: 'google:g-bob', at }),
    newEntry({ accountId: walletId, currency: 'EUR', kind: 'advance', amountMinor: -2000, date: rec.date, links: { groupExpenseId: expenseId }, by: 'google:g-bob', at }),
  );
  await h.storage.putJson(name, doc);
}
async function bobEditsPizza(h, f, id) {
  const e = (await view(h, f, 'bob')).expenses.find((x) => x.id === id);
  ok(await G(h, f, 'bob', 'PATCH', { body: { expenseId: id, revision: e.revision, description: 'Fictional pizza night', reason: 'Typo' } }));
}

describe('S1: restores never take a personal ledger link from an archive', () => {
  test('replace: a link for the currency that was stopped after the backup stays stopped', async () => {
    const h = harness();
    const f = await fixture(h);
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    const e = await addExpense(h, f, 'bob', { description: 'Fictional pizza', amount: '40.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.alice), ledger: { accountId: wallet.id } });
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '60.00');
    const b0 = await backupNow(h, f);
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: null }));
    // Something for the replace to roll back.
    await addExpense(h, f, 'alice', { description: 'After the backup', amount: '10.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.dana) });
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '100.00');
    await restoreAs(h, f, b0, 'replace');
    const v = await view(h, f, 'bob');
    assert.equal(v.myLedgers, undefined);
    assert.equal(v.expenses.find((x) => x.id === e.id).myLedger, undefined);
    await bobEditsPizza(h, f, e.id);
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '100.00');
    assert.equal(await liveFor(h, f, 'bob', wallet.id, e.id), 0);
  });

  test('replace: a per-record link that was stopped after the backup is not brought back with the archived record', async () => {
    const h = harness();
    const f = await fixture(h);
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    const e = await addExpense(h, f, 'bob', { description: 'Fictional pizza', amount: '40.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.alice) });
    await plantRecordLink(h, f, e.id, wallet.id);
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '60.00');
    const b0 = await backupNow(h, f);
    ok(await act(h, f, 'bob', 'ledger', { expenseId: e.id, accountId: null }));
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '100.00');
    // Something for the replace to roll back; the pizza itself must keep the link it has now (ended).
    await addExpense(h, f, 'alice', { description: 'After the backup', amount: '10.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.dana) });
    await restoreAs(h, f, b0, 'replace');
    assert.equal((await view(h, f, 'bob')).expenses.find((x) => x.id === e.id).myLedger, undefined, 'still stopped');
    // Bob's own edit writes nothing to his private wallet: 100.00, no live entries.
    await bobEditsPizza(h, f, e.id);
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '100.00');
    assert.equal(await liveFor(h, f, 'bob', wallet.id, e.id), 0);
  });

  test('replace then merge: an expense brought back whole comes back without anyone\'s link', async () => {
    const h = harness();
    const f = await fixture(h);
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    const early = await backupNow(h, f);
    const e = await addExpense(h, f, 'bob', { description: 'Fictional pizza', amount: '40.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.alice) });
    await plantRecordLink(h, f, e.id, wallet.id);
    const b0 = await backupNow(h, f);
    ok(await act(h, f, 'bob', 'ledger', { expenseId: e.id, accountId: null }));
    await restoreAs(h, f, early, 'replace');
    assert.deepEqual((await view(h, f)).expenses, [], 'set aside');
    await restoreAs(h, f, b0, 'merge');
    assert.deepEqual((await view(h, f)).expenses.map((x) => x.id), [e.id], 'back');
    assert.equal((await view(h, f, 'bob')).expenses[0].myLedger, undefined, 'no link came back');
    await bobEditsPizza(h, f, e.id);
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '100.00');
    assert.equal(await liveFor(h, f, 'bob', wallet.id, e.id), 0);
  });
});

describe('S4: create-new carries no other member\'s identifiers', () => {
  test('no other member\'s subject, member id or account id anywhere in the new document; the restorer\'s own link still works', async () => {
    const h = harness();
    const f = await fixture(h);
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    const cash = await account(h, f, 'alice', { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    // Bob adds and records a hostel paid by him for Alice and Dana; Alice corrects the payer to herself.
    const e = await addExpense(h, f, 'bob', { description: 'Fictional hostel', amount: '30.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.alice, f.refs.dana), ledger: { accountId: wallet.id } });
    ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: e.revision, reason: 'Alice paid', payers: [{ ref: f.refs.alice }] } }));
    // Alice is now the corrected payer of the hostel, confirmed cash she already paid before linking
    // (financial recheck FA-1): her first link needs confirming.
    const refused = await act(h, f, 'alice', 'ledger', { currency: 'EUR', accountId: cash.id });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'confirm_backdated');
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR', accountId: cash.id, confirmBackdated: true }));
    const b0 = await backupNow(h, f);
    const res = await restoreAs(h, f, b0, 'create-new');
    const { value: doc } = await h.storage.getJson(`workspaces/${res.workspace.id}/workspace.json`);
    const text = JSON.stringify(doc);
    for (const [label, secret] of [['Bob\'s subject', 'google:g-bob'], ['Bob\'s member id', f.mid('Bob')], ['Bob\'s wallet', wallet.id], ['Frank\'s subject', 'google:g-frank'], ['Carol\'s subject', 'google:g-carol'], ['Eve\'s subject', 'google:g-eve']]) {
      assert.equal(text.includes(secret), false, label);
    }
    // Who added it shows as a former member; Alice's own part is still recorded on her own account:
    // paid 30.00, share 15.00 → cash 470.00, spending 15.00, lent 15.00.
    const q = { workspaceId: res.workspace.id };
    const nv = ok(await h.call('group', 'GET', { as: 'alice', query: q }));
    assert.equal(nv.expenses[0].createdBy, 'Former member');
    const hist = ok(await h.call('group', 'GET', { as: 'alice', query: { ...q, action: 'history', expenseId: e.id } }));
    assert.equal(hist.createdBy, 'Former member');
    assert.deepEqual(nv.myLedgers.map((l) => [l.accountId, l.reviewCount]), [[cash.id, 0]]);
    assert.equal(nv.expenses[0].myLedger.needsReview, false);
    const s = ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...q, accountId: cash.id } })).summary[0];
    assert.deepEqual([s.gross, s.advances, s.receivable], ['15.00', '15.00', '15.00']);
  });
});

describe('S8: the integrity check covers personal ledger links and the entries they make', () => {
  // Bob records his part on his wallet; the stored document is then tampered with and backed up.
  async function linked() {
    const h = harness();
    const f = await fixture(h);
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    const e = await addExpense(h, f, 'bob', { description: 'Fictional pizza', amount: '40.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.alice), ledger: { accountId: wallet.id } });
    return { h, f, wallet, e };
  }
  const tamperAndBackUp = async ({ h, f }, change) => {
    const name = `workspaces/${f.ws.id}/workspace.json`;
    const { value } = await h.storage.getJson(name);
    change(value);
    await h.storage.putJson(name, value);
    return h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} });
  };

  test('an untouched workspace with links backs up', async () => {
    const x = await linked();
    ok(await tamperAndBackUp(x, () => {}), 201);
  });

  test('links to unknown people or accounts, links in another currency, two active links and entries for unknown records are refused', async () => {
    for (const [label, rule, change] of [
      ['unknown person', 'group ledger link', (d) => { d.groupLedgers[0].subject = 'google:g-nobody'; }],
      ['unknown account', 'group ledger link', (d) => { d.groupLedgers[0].accountId = 'acc_nosuch00000'; }],
      ['other currency', 'group ledger link', (d) => { d.groupLedgers[0].currency = 'USD'; }],
      ['two active for one currency', 'group ledger link', (d) => { d.groupLedgers.push({ ...d.groupLedgers[0], id: 'gld_second00000' }); }],
      ['two active on one record', 'group ledger link', (d) => { const s = d.groupLedgers[0]; d.groupExpenses[0].ledgerLinks = [{ subject: s.subject, accountId: s.accountId, linkedAt: s.linkedAt, endedAt: null }, { subject: s.subject, accountId: s.accountId, linkedAt: s.linkedAt, endedAt: null }]; }],
      ['record link to unknown person', 'group ledger link', (d) => { d.groupExpenses[0].ledgerLinks = [{ subject: 'google:g-nobody', accountId: d.groupLedgers[0].accountId, linkedAt: d.groupLedgers[0].linkedAt, endedAt: null }]; }],
      ['entry for an unknown expense', 'transaction group link', (d) => { d.transactions.find((t) => t.links && t.links.groupExpenseId).links.groupExpenseId = 'gex_nosuch00000'; }],
      ['entry for an unknown payment', 'transaction group link', (d) => { d.transactions.find((t) => t.links && t.links.groupExpenseId).links = { groupSettlementId: 'gst_nosuch00000' }; }],
    ]) {
      const res = await tamperAndBackUp(await linked(), change);
      assert.equal(res.status, 422, label);
      assert.equal(res.body.error.code, 'backup_invalid', label);
      assert.match(res.body.error.message, new RegExp(rule), label);
    }
  });

  test('entries of an expense that a replace set aside still point at a record that exists', async () => {
    const h = harness();
    const f = await fixture(h);
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    const early = await backupNow(h, f);
    const e = await addExpense(h, f, 'bob', { description: 'Fictional pizza', amount: '40.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.alice), ledger: { accountId: wallet.id } });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: null }));
    await restoreAs(h, f, early, 'replace');
    const { value: doc } = await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`);
    assert.deepEqual(doc.superseded.map((s) => s.record.id), [e.id]);
    assert.ok(doc.transactions.some((t) => t.links && t.links.groupExpenseId === e.id), 'Bob\'s reversed entries still name it');
    await backupNow(h, f);
  });
});

// ---- settlement rules (S5, S6, S7) --------------------------------------------------------------
const historyOf = async (h, f, settlementId) => ok(await G(h, f, 'alice', 'GET', { query: { action: 'history', settlementId } })).history;

describe('S5: nobody confirms their own payment; a manager confirming a payment they reported is shown as such', () => {
  test('the payer never confirms; a manager or owner confirming a contact payment they reported is marked', async () => {
    const h = harness();
    const f = await fixture(h);
    // The S5 rules apply when "Anyone in the group can confirm payments" is off (Terry, 2026-09-14;
    // it is on by default, tested in group-recheck.test.js).
    ok(await act(h, f, 'alice', 'settings', { changes: { anyoneConfirms: false } }));
    // Frank (manager) reports that Bob paid Dana (a contact) and confirms it himself: allowed, marked.
    const s1 = await settle(h, f, FRANK, { from: f.refs.bob, to: f.refs.dana, amount: '50.00' });
    const c1 = ok(await act(h, f, FRANK, 'confirm', { settlementId: s1.id, revision: s1.revision })).settlement;
    assert.deepEqual([c1.status, c1.confirmedByReporter], ['confirmed', true]);
    assert.deepEqual((await historyOf(h, f, s1.id)).map((x) => x.event), ['reported', 'confirmed-by-reporter']);
    // Frank reports his own payment to Dana: he paid, so he cannot confirm it; the owner can.
    const s2 = await settle(h, f, FRANK, { from: f.refs.frank, to: f.refs.dana, amount: '10.00' });
    assert.equal(s2.canConfirm, false);
    assert.equal((await act(h, f, FRANK, 'confirm', { settlementId: s2.id, revision: s2.revision })).status, 403);
    const c2 = ok(await act(h, f, 'alice', 'confirm', { settlementId: s2.id, revision: s2.revision })).settlement;
    assert.deepEqual([c2.status, c2.confirmedByReporter], ['confirmed', false]);
    // The owner cannot confirm her own payment to a contact either.
    const s3 = await settle(h, f, 'alice', { from: f.refs.alice, to: f.refs.dana, amount: '5.00' });
    assert.equal((await act(h, f, 'alice', 'confirm', { settlementId: s3.id, revision: s3.revision })).status, 403);
    // Money a member records as received is the confirmation itself, and is not marked.
    const s4 = await settle(h, f, 'alice', { from: f.refs.bob, to: f.refs.alice, amount: '7.00' });
    assert.deepEqual([s4.status, s4.confirmedByReporter], ['confirmed', false]);
    // A plain member still cannot confirm a payment to a contact.
    const s5 = await settle(h, f, 'eve', { from: f.refs.eve, to: f.refs.dana, amount: '3.00' });
    assert.equal((await act(h, f, 'eve', 'confirm', { settlementId: s5.id, revision: s5.revision })).status, 403);
  });
});

describe('S6: a confirmed payment is withdrawn only by its receiver or a manager or owner', () => {
  test('an owner or manager may withdraw a confirmation, and it is recorded as withdrawn with the reason', async () => {
    const h = harness();
    const f = await fixture(h);
    // Bob paid 50.00 shared with Alice: Alice owes 25.00, reports paying it, and Bob confirms. Alice is
    // the owner, and owners and managers may withdraw a confirmation (S6); other members may not.
    await addExpense(h, f, 'bob', { description: 'Fictional fuel', amount: '50.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.alice, f.refs.bob) });
    const s = await settle(h, f, 'alice', { from: f.refs.alice, to: f.refs.bob, amount: '25.00' });
    const c = ok(await act(h, f, 'bob', 'confirm', { settlementId: s.id, revision: s.revision })).settlement;
    assert.equal((await view(h, f)).settlements[0].canVoid, true, 'the owner may');
    assert.equal((await view(h, f, 'eve')).settlements[0].canVoid, false, 'a member who is not the receiver may not');
    ok(await act(h, f, 'alice', 'void', { settlementId: s.id, revision: c.revision, reason: 'Changed my mind' }));
    const hist = await historyOf(h, f, s.id);
    assert.deepEqual(hist.map((x) => [x.event, x.reason]), [['reported', ''], ['confirmed', ''], ['withdrawn', 'Changed my mind']]);
  });

  test('a plain member who paid cannot withdraw it; the receiving member or a manager can', async () => {
    const h = harness();
    const f = await fixture(h);
    // Eve owes Bob 25.00 (fuel 50.00 shared by Eve and Bob); she reports paying and Bob confirms.
    await addExpense(h, f, 'bob', { description: 'Fictional fuel', amount: '50.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.eve, f.refs.bob) });
    const s = await settle(h, f, 'eve', { from: f.refs.eve, to: f.refs.bob, amount: '25.00' });
    const c = ok(await act(h, f, 'bob', 'confirm', { settlementId: s.id, revision: s.revision })).settlement;
    assert.equal((await view(h, f, 'eve')).settlements[0].canVoid, false);
    assert.equal((await act(h, f, 'eve', 'void', { settlementId: s.id, revision: c.revision, reason: 'Changed my mind' })).status, 403);
    assert.equal(netOf(await view(h, f), f.refs.eve), '0.00', 'still counted');
    const w = ok(await act(h, f, 'bob', 'void', { settlementId: s.id, revision: c.revision, reason: 'The transfer bounced' })).settlement;
    assert.deepEqual([w.voided, w.withdrawn, w.voidReason], [true, true, 'The transfer bounced']);
    assert.equal(netOf(await view(h, f), f.refs.eve), '-25.00');
    assert.deepEqual((await historyOf(h, f, s.id)).map((x) => [x.event, x.reason]), [['reported', ''], ['confirmed', ''], ['withdrawn', 'The transfer bounced']]);
    // A manager may withdraw another confirmation.
    const s2 = await settle(h, f, 'eve', { from: f.refs.eve, to: f.refs.bob, amount: '25.00' });
    const c2 = ok(await act(h, f, 'bob', 'confirm', { settlementId: s2.id, revision: s2.revision })).settlement;
    assert.equal(ok(await act(h, f, FRANK, 'void', { settlementId: s2.id, revision: c2.revision, reason: 'Duplicate' })).settlement.withdrawn, true);
  });

  test('before confirmation the reporter may still void, which is not a withdrawal; a confirmed payment to a contact is withdrawn by a manager or owner only', async () => {
    const h = harness();
    const f = await fixture(h);
    const r = await settle(h, f, 'eve', { from: f.refs.eve, to: f.refs.bob, amount: '10.00' });
    const v = ok(await act(h, f, 'eve', 'void', { settlementId: r.id, revision: r.revision, reason: 'Entered twice' })).settlement;
    assert.deepEqual([v.voided, v.withdrawn], [true, false]);
    assert.deepEqual((await historyOf(h, f, r.id)).map((x) => x.event), ['reported', 'void']);
    const d = await settle(h, f, 'eve', { from: f.refs.eve, to: f.refs.dana, amount: '4.00' });
    const dc = ok(await act(h, f, FRANK, 'confirm', { settlementId: d.id, revision: d.revision })).settlement;
    assert.equal((await act(h, f, 'eve', 'void', { settlementId: d.id, revision: dc.revision, reason: 'x' })).status, 403);
    assert.equal(ok(await act(h, f, 'alice', 'void', { settlementId: d.id, revision: dc.revision, reason: 'Never paid' })).settlement.withdrawn, true);
  });
});

describe('S7: a viewer confirms or disputes payments to them and keeps their own account up to date', () => {
  test('a viewer confirms or disputes payments made to them, and nothing else', async () => {
    const h = harness();
    const f = await fixture(h);
    const s = await settle(h, f, 'alice', { from: f.refs.alice, to: f.refs.carol, amount: '5.00' });
    const mine = (await view(h, f, 'carol')).settlements.find((x) => x.id === s.id);
    assert.deepEqual([mine.canConfirm, mine.canDispute, mine.canVoid], [true, true, false]);
    assert.equal(ok(await act(h, f, 'carol', 'confirm', { settlementId: s.id, revision: s.revision })).settlement.status, 'confirmed');
    const d = await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.carol, amount: '6.00' });
    const dd = ok(await act(h, f, 'carol', 'dispute', { settlementId: d.id, revision: d.revision, reason: 'Not received' })).settlement;
    assert.equal(dd.status, 'disputed');
    for (const [label, res] of [
      ['add an expense', await G(h, f, 'carol', 'POST', { body: { description: 'x', amount: '1.00', payers: [{ ref: f.refs.carol }], split: equal(f.refs.carol) } })],
      ['report a payment', await act(h, f, 'carol', 'settle', { from: f.refs.carol, to: f.refs.alice, amount: '1.00' })],
      ['void', await act(h, f, 'carol', 'void', { settlementId: s.id, revision: s.revision + 1, reason: 'x' })],
      ['start a link', await act(h, f, 'carol', 'ledger', { currency: 'EUR', accountId: 'acc_nosuch00000' })],
      ['confirm and start a link', await act(h, f, 'carol', 'confirm', { settlementId: d.id, revision: dd.revision, ledger: { accountId: 'acc_nosuch00000' } })],
      ['confirm a payment to someone else', await act(h, f, 'carol', 'confirm', { settlementId: (await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.alice, amount: '2.00' })).id, revision: 1 })],
    ]) assert.equal(res.status, 403, label);
  });

  test('a member demoted to viewer still updates and stops recording on their own private account, but cannot start again', async () => {
    const h = harness();
    const f = await fixture(h);
    const cash = await account(h, f, 'eve', { name: 'Eve Cash', type: 'cash', currency: 'EUR', openingBalance: '50.00' });
    // Eve paid 8.00 shared with Alice: share 4.00, lent 4.00; cash 50.00 − 8.00 = 42.00.
    await addExpense(h, f, 'eve', { description: 'Fictional tea', amount: '8.00', payers: [{ ref: f.refs.eve }], split: equal(f.refs.eve, f.refs.alice), ledger: { accountId: cash.id } });
    assert.equal(await balanceOf(h, f, 'eve', cash.id), '42.00');
    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.mid('Eve'), role: 'viewer' } }));
    // Alice's bread 6.00 shared with Eve: Eve's 3.00 is spending and owed; no cash moves.
    await addExpense(h, f, 'alice', { description: 'Fictional bread', amount: '6.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.eve) });
    assert.equal((await view(h, f, 'eve')).myLedgers[0].reviewCount, 1);
    ok(await act(h, f, 'eve', 'ledger', { currency: 'EUR' }));
    // Spending 4 + 3 = 7; outstanding 4 − 3 = 1 = Eve's balance 8 − 4 − 3.
    assert.deepEqual(await ledgerOf(h, f, 'eve', cash.id), { cash: '42.00', spent: '7.00', advances: '4.00', payables: '3.00', reimbursed: '0.00', repaid: '0.00', receivable: '1.00' });
    assert.equal((await act(h, f, 'eve', 'ledger', { currency: 'EUR', accountId: cash.id })).status, 403, 'cannot start or move a link');
    ok(await act(h, f, 'eve', 'ledger', { currency: 'EUR', accountId: null }));
    assert.equal(await balanceOf(h, f, 'eve', cash.id), '50.00');
  });
});
