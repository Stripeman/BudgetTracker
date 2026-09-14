'use strict';
// BT-009 shared-expense model, tested on its pure functions with independently hand-computed values:
// deterministic splits and their rounding adjustment, balances whose nets sum to zero, suggestions
// that preserve every net balance, the direct (not redistributed) view and the personal-ledger
// entries the brief's EUR 300 dinner rule asks for.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const groups = require('../_shared/groups');

const split = (method, lines) => ({ method, lines });
const amounts = (r) => r.shares.map((s) => s.amountMinor);

describe('BT-009-02 splits', () => {
  test('equal: EUR 100.00 three ways is 33.34 / 33.33 / 33.33, the extra cent on the first listed', () => {
    const r = groups.computeShares(10000, split('equal', [{ ref: 'member:a', value: null }, { ref: 'member:b', value: null }, { ref: 'member:c', value: null }]));
    assert.deepEqual(amounts(r), [3334, 3333, 3333]);
    assert.deepEqual(r.shares.map((s) => s.adjustmentMinor), [1, 0, 0]);
    assert.equal(r.residualMinor, 1);
  });

  test('equal: an exact split has no rounding adjustment', () => {
    const r = groups.computeShares(30000, split('equal', ['a', 'b', 'c', 'd'].map((x) => ({ ref: `member:${x}`, value: null }))));
    assert.deepEqual(amounts(r), [7500, 7500, 7500, 7500]);
    assert.equal(r.residualMinor, 0);
  });

  test('percentages: 33.3333 / 33.3333 / 33.3334 of 100.00 gives 33.33 / 33.33 / 33.34', () => {
    // Units of 0.0001 %: 333333, 333333, 333334 of 1,000,000. 10000 × w / 1e6 = 3333.33, 3333.33, 3333.34;
    // floors 3333 each (9999); the one residual cent goes to the largest remainder (0.34, the third).
    const r = groups.computeShares(10000, split('percentages', [{ ref: 'member:a', value: '33.3333' }, { ref: 'member:b', value: '33.3333' }, { ref: 'member:c', value: '33.3334' }]));
    assert.deepEqual(amounts(r), [3333, 3333, 3334]);
    assert.deepEqual(r.shares.map((s) => s.adjustmentMinor), [0, 0, 1]);
  });

  test('shares: 2:1:1 of 100.00 is 50.00 / 25.00 / 25.00; 1:1:1 of 0.10 is 0.04 / 0.03 / 0.03', () => {
    assert.deepEqual(amounts(groups.computeShares(10000, split('shares', [{ ref: 'member:a', value: 2 }, { ref: 'member:b', value: 1 }, { ref: 'contact:c', value: 1 }]))), [5000, 2500, 2500]);
    const small = groups.computeShares(10, split('shares', [{ ref: 'member:a', value: 1 }, { ref: 'member:b', value: 1 }, { ref: 'member:c', value: 1 }]));
    assert.deepEqual(amounts(small), [4, 3, 3]);
    assert.equal(small.residualMinor, 1);
  });

  test('amounts are taken exactly, with no rounding', () => {
    const r = groups.computeShares(10000, split('amounts', [{ ref: 'member:a', value: 6000 }, { ref: 'member:b', value: 4000 }]));
    assert.deepEqual(amounts(r), [6000, 4000]);
    assert.equal(r.residualMinor, 0);
  });

  test('normalizeSplit refuses percentages that do not make exactly 100 and amounts that do not make the total', () => {
    const any = (ref) => ref;
    assert.throws(() => groups.normalizeSplit({ method: 'percentages', lines: [{ ref: 'member:a', value: '50' }, { ref: 'member:b', value: '40' }] }, 10000, 'EUR', any),
      (e) => e.code === 'split_percent_total' && /90%/.test(e.message));
    assert.throws(() => groups.normalizeSplit({ method: 'amounts', lines: [{ ref: 'member:a', value: '60.00' }, { ref: 'member:b', value: '30.00' }] }, 10000, 'EUR', any),
      (e) => e.code === 'split_amount_total' && /90\.00/.test(e.message) && /100\.00/.test(e.message));
    assert.throws(() => groups.normalizeSplit({ method: 'equal', lines: [{ ref: 'member:a' }, { ref: 'member:a' }] }, 10000, 'EUR', any), (e) => e.code === 'duplicate_participant');
    assert.throws(() => groups.normalizeSplit({ method: 'shares', lines: [{ ref: 'member:a', value: 0 }] }, 10000, 'EUR', any), (e) => e.code === 'invalid_split');
    assert.throws(() => groups.normalizeSplit({ method: 'amounts', lines: [{ ref: 'member:a', value: '100.001' }] }, 10000, 'EUR', any), (e) => e.code === 'invalid_precision');
    // Canonical percentages: "50.0" and "50" are the same value.
    assert.deepEqual(groups.normalizeSplit({ method: 'percentages', lines: [{ ref: 'member:a', value: '50.0' }, { ref: 'member:b', value: '50' }] }, 10000, 'EUR', any).lines.map((l) => l.value), ['50', '50']);
  });
});

// Three expenses among four people (hand computed):
//   E1 Alice pays 100.00, equal among Alice, Bob, Frank, Dana       → 25.00 each
//   E2 Bob pays 60.00, shares Bob 1 : Frank 2                         → Bob 20.00, Frank 40.00
//   E3 Dana pays 30.00, amounts Alice 10.00 / Dana 20.00
// Nets (paid − share): Alice 100 − 35 = +65, Bob 60 − 45 = +15, Frank 0 − 65 = −65, Dana 30 − 45 = −15.
const A = 'member:alice';
const B = 'member:bob';
const F = 'member:frank';
const D = 'contact:dana';
function sampleDoc() {
  const exp = (id, amountMinor, payers, shares, extra = {}) => ({ id, currency: 'EUR', amountMinor, date: '2026-09-01', description: id, payers, shares, voidedAt: null, ...extra });
  return {
    members: [{ id: 'alice', name: 'Alice', status: 'active', subject: 's-a' }, { id: 'bob', name: 'Bob', status: 'active', subject: 's-b' }, { id: 'frank', name: 'Frank', status: 'active', subject: 's-f' }],
    contacts: [{ id: 'dana', name: 'Dana' }],
    groupExpenses: [
      exp('E1', 10000, [{ ref: A, amountMinor: 10000 }], [A, B, F, D].map((ref) => ({ ref, amountMinor: 2500 }))),
      exp('E2', 6000, [{ ref: B, amountMinor: 6000 }], [{ ref: B, amountMinor: 2000 }, { ref: F, amountMinor: 4000 }]),
      exp('E3', 3000, [{ ref: D, amountMinor: 3000 }], [{ ref: A, amountMinor: 1000 }, { ref: D, amountMinor: 2000 }]),
      exp('VOID', 99999, [{ ref: F, amountMinor: 99999 }], [{ ref: A, amountMinor: 99999 }], { voidedAt: '2026-09-02T00:00:00.000Z' }),
    ],
    groupSettlements: [],
  };
}
const ORDER = [A, B, F, D];
const netOf = (b, ref) => b.rows.find((r) => r.ref === ref).netMinor;

describe('BT-009-04/05 balances and suggestions', () => {
  test('nets are paid − share, void expenses are left out, and the nets sum to zero', () => {
    const [b] = groups.balances(sampleDoc(), ORDER);
    assert.equal(b.currency, 'EUR');
    assert.deepEqual(ORDER.map((r) => netOf(b, r)), [6500, 1500, -6500, -1500]);
    const alice = b.rows.find((r) => r.ref === A);
    assert.deepEqual([alice.paidMinor, alice.shareMinor], [10000, 3500]);
    assert.deepEqual(alice.expenses.map((e) => [e.expenseId, e.paidMinor, e.shareMinor]), [['E1', 10000, 2500], ['E3', 0, 1000]]);
    assert.equal(b.rows.reduce((s, r) => s + r.netMinor, 0), 0);
  });

  test('suggestions: largest debtor pays largest creditor, and applying them clears every balance', () => {
    const [b] = groups.balances(sampleDoc(), ORDER);
    assert.deepEqual(b.suggestions, [{ from: F, to: A, amountMinor: 6500 }, { from: D, to: B, amountMinor: 1500 }]);
    const after = new Map(b.rows.map((r) => [r.ref, r.netMinor]));
    for (const s of b.suggestions) { after.set(s.from, after.get(s.from) + s.amountMinor); after.set(s.to, after.get(s.to) - s.amountMinor); }
    assert.ok([...after.values()].every((v) => v === 0));
  });

  test('confirmed settlements move the net; reported ones are pending and disputed ones are separate', () => {
    const doc = sampleDoc();
    const s = (id, from, to, amountMinor, status, extra = {}) => ({ id, from, to, amountMinor, currency: 'EUR', status, date: '2026-09-03', voidedAt: null, ...extra });
    doc.groupSettlements = [
      s('S1', F, A, 4000, 'confirmed'),
      s('S2', F, A, 2500, 'reported'),
      s('S3', D, B, 500, 'disputed'),
      s('S4', D, B, 1500, 'confirmed', { voidedAt: '2026-09-04T00:00:00.000Z' }),
    ];
    const [b] = groups.balances(doc, ORDER);
    // Frank: −6500 + 4000 paid out = −2500. Alice: +6500 − 4000 received = +2500.
    assert.deepEqual(ORDER.map((r) => netOf(b, r)), [2500, 1500, -2500, -1500]);
    const frank = b.rows.find((r) => r.ref === F);
    assert.deepEqual([frank.settledOutMinor, frank.pendingOutMinor, frank.disputedOutMinor], [4000, 2500, 0]);
    const bob = b.rows.find((r) => r.ref === B);
    assert.deepEqual([bob.settledInMinor, bob.pendingInMinor, bob.disputedInMinor], [0, 0, 500]);
    // Suggestions count reported payments as made, so nobody is asked to pay twice: Alice and Frank
    // are square once S2 is confirmed; Dana still owes Bob 15.00 (the disputed 5.00 is not counted).
    assert.deepEqual(b.suggestions, [{ from: D, to: B, amountMinor: 1500 }]);
    assert.equal(b.rows.reduce((sum, r) => sum + r.netMinor, 0), 0);
  });

  test('the direct view keeps who owes whom per expense and still adds up to each balance', () => {
    const doc = sampleDoc();
    doc.groupSettlements = [{ id: 'S1', from: F, to: A, amountMinor: 6500, currency: 'EUR', status: 'reported', date: '2026-09-03', voidedAt: null }];
    const [b] = groups.balances(doc, ORDER);
    // E1: Bob, Frank, Dana each owe Alice 25. E2: Frank owes Bob 40. E3: Alice owes Dana 10.
    // The reported 65 from Frank to Alice turns Alice–Frank round: Alice owes Frank 65 − 25 = 40.
    // Alice–Dana: Dana owes 25, Alice owes 10 → Dana owes Alice 15.
    assert.deepEqual(b.direct, [
      { from: A, to: F, amountMinor: 4000 },
      { from: B, to: A, amountMinor: 2500 },
      { from: F, to: B, amountMinor: 4000 },
      { from: D, to: A, amountMinor: 1500 },
    ]);
    const total = new Map(ORDER.map((r) => [r, 0]));
    for (const d of b.direct) { total.set(d.from, total.get(d.from) - d.amountMinor); total.set(d.to, total.get(d.to) + d.amountMinor); }
    for (const r of b.rows) assert.equal(total.get(r.ref), r.basisMinor, r.ref);
  });

  test('with several payers the direct view matches each share to payers in order, exactly', () => {
    const doc = { members: [], contacts: [], groupSettlements: [], groupExpenses: [
      { id: 'M', currency: 'EUR', amountMinor: 12000, date: '2026-09-01', description: 'M', voidedAt: null,
        payers: [{ ref: A, amountMinor: 8000 }, { ref: B, amountMinor: 4000 }], shares: [A, B, D].map((ref) => ({ ref, amountMinor: 4000 })) },
    ] };
    const [b] = groups.balances(doc, [A, B, D]);
    assert.deepEqual([A, B, D].map((r) => netOf(b, r)), [4000, 0, -4000]);
    assert.deepEqual(b.direct, [{ from: D, to: A, amountMinor: 4000 }]);
    assert.deepEqual(b.suggestions, [{ from: D, to: A, amountMinor: 4000 }]);
  });

  test('suggestions preserve net balances and never need more than n − 1 payments (generated cases)', () => {
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let run = 0; run < 300; run += 1) {
      const people = Array.from({ length: 2 + rnd(7) }, (_, i) => `member:p${i}`);
      const expenses = Array.from({ length: 1 + rnd(6) }, (_, i) => {
        const total = 1 + rnd(50000);
        const beneficiaries = people.filter(() => rnd(3) > 0);
        const who = beneficiaries.length ? beneficiaries : [people[0]];
        const r = groups.computeShares(total, { method: 'equal', lines: who.map((ref) => ({ ref, value: null })) });
        return { id: `x${i}`, currency: 'EUR', amountMinor: total, date: '2026-09-01', description: '', voidedAt: null, payers: [{ ref: people[rnd(people.length)], amountMinor: total }], shares: r.shares.map(({ ref, amountMinor }) => ({ ref, amountMinor })) };
      });
      const [b] = groups.balances({ members: [], contacts: [], groupExpenses: expenses, groupSettlements: [] }, people);
      const left = new Map(b.rows.map((r) => [r.ref, r.basisMinor]));
      for (const s of b.suggestions) {
        assert.ok(s.amountMinor > 0);
        left.set(s.from, left.get(s.from) + s.amountMinor);
        left.set(s.to, left.get(s.to) - s.amountMinor);
      }
      assert.ok([...left.values()].every((v) => v === 0), `run ${run}`);
      assert.ok(b.suggestions.length <= Math.max(0, b.rows.length - 1));
      const again = groups.balances({ members: [], contacts: [], groupExpenses: expenses, groupSettlements: [] }, people)[0].suggestions;
      assert.deepEqual(again, b.suggestions, 'deterministic');
    }
  });
});

// Terry's model (2026-09-14, financial review finding 2): for each record the entries add up to the cash
// the person moved, the `expense` entry is their share, and the non-spending entries are what they are
// owed (advance) or owe (payable).
describe('BT-009-06 personal ledger entries (the EUR 300 dinner rule)', () => {
  test('a payer is charged what they paid: their share as spending, the rest as money lent', () => {
    const dinner = { id: 'D', currency: 'EUR', amountMinor: 30000, date: '2026-09-05', categoryId: 'cat_dining', voidedAt: null,
      payers: [{ ref: A, amountMinor: 30000 }], shares: [A, B, F, D].map((ref) => ({ ref, amountMinor: 7500 })) };
    assert.deepEqual(groups.desiredEntries(dinner, 'expense', A), [
      { kind: 'expense', amountMinor: -7500, categoryId: 'cat_dining', date: '2026-09-05' },
      { kind: 'advance', amountMinor: -22500, categoryId: null, date: '2026-09-05' },
    ]);
    // Someone who shared but paid nothing: their 75.00 is spending and owed; no money moves (−75 + 75 = 0).
    assert.deepEqual(groups.desiredEntries(dinner, 'expense', B), [
      { kind: 'expense', amountMinor: -7500, categoryId: 'cat_dining', date: '2026-09-05' },
      { kind: 'payable', amountMinor: 7500, categoryId: null, date: '2026-09-05' },
    ]);
    assert.deepEqual(groups.desiredEntries(dinner, 'expense', 'member:nobody'), [], 'not in the expense');
    assert.deepEqual(groups.desiredEntries({ ...dinner, voidedAt: '2026-09-06T00:00:00.000Z' }, 'expense', A), [], 'void');
    // Paying less than one's share (50.00 of a 75.00 share): spending 75.00, owed 25.00; cash −50.00.
    // The other payer (250.00, share 75.00) lent 175.00; cash −250.00.
    const partly = { ...dinner, payers: [{ ref: A, amountMinor: 5000 }, { ref: B, amountMinor: 25000 }] };
    assert.deepEqual(groups.desiredEntries(partly, 'expense', A), [
      { kind: 'expense', amountMinor: -7500, categoryId: 'cat_dining', date: '2026-09-05' },
      { kind: 'payable', amountMinor: 2500, categoryId: null, date: '2026-09-05' },
    ]);
    assert.deepEqual(groups.desiredEntries(partly, 'expense', B), [
      { kind: 'expense', amountMinor: -7500, categoryId: 'cat_dining', date: '2026-09-05' },
      { kind: 'advance', amountMinor: -17500, categoryId: null, date: '2026-09-05' },
    ]);
  });

  test('a confirmed repayment is a reimbursement for the receiver and a repayment for the payer, never income or spending', () => {
    const s = { id: 'S', from: B, to: A, amountMinor: 7500, currency: 'EUR', status: 'confirmed', date: '2026-09-07', voidedAt: null };
    assert.deepEqual(groups.desiredEntries(s, 'settlement', A), [{ kind: 'reimbursement', amountMinor: 7500, categoryId: null, date: '2026-09-07' }]);
    assert.deepEqual(groups.desiredEntries(s, 'settlement', B), [{ kind: 'repayment', amountMinor: -7500, categoryId: null, date: '2026-09-07' }]);
    assert.deepEqual(groups.desiredEntries(s, 'settlement', F), [], 'not in the payment');
    // Not in the balance yet, so nothing is recorded for either side.
    for (const status of ['reported', 'disputed']) {
      assert.deepEqual(groups.desiredEntries({ ...s, status }, 'settlement', A), [], status);
      assert.deepEqual(groups.desiredEntries({ ...s, status }, 'settlement', B), [], status);
    }
    assert.deepEqual(groups.desiredEntries({ ...s, voidedAt: '2026-09-08T00:00:00.000Z' }, 'settlement', B), [], 'void');
  });
});
