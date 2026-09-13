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
