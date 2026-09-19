'use strict';
// BT-009-25 (Terry, 2026-09-19): itemized receipt allocation — "allocate individual lines to
// selected participants; support quantities, shared lines, tax, tip, discounts and fees. Show any
// unallocated remainder and require the final allocation to reconcile exactly to the receipt
// total." Worked example (a EUR 35.40 receipt) hand-computed in
// docs/BT-009-25-WORKED-EXAMPLES.md §2 before this was implemented. All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Itemized Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
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

describe('BT-009-25 itemized receipt allocation', () => {
  test('the worked example from docs/BT-009-25-WORKED-EXAMPLES.md §2, hand-computed and verified exactly: Burger(Alice)+Salad(Bob)+shared appetizer, tax/tip/discount allocated proportionally, reconciling exactly to 35.40', async () => {
    const h = harness();
    const f = await fixture(h);
    const body = {
      description: 'Fictional dinner receipt', amount: '35.40',
      payers: [{ ref: f.refs.alice }],
      itemization: {
        lines: [
          { description: 'Burger', quantity: 1, unitPriceMinor: 1200, refs: [f.refs.alice] },
          { description: 'Salad', quantity: 1, unitPriceMinor: 1000, refs: [f.refs.bob] },
          { description: 'Shared appetizer', quantity: 1, unitPriceMinor: 800, refs: [f.refs.alice, f.refs.bob, f.refs.carol] },
        ],
        taxMinor: 240, tipMinor: 600, discountMinor: 300, feeMinor: 0,
      },
    };
    const e = ok(await G(h, f, 'alice', 'POST', { body }), 201).expense;
    assert.equal(e.split.method, 'itemized');
    const shareOf = (ref) => e.shares.find((s) => s.ref === ref).amountMinor;
    // Exact figures from the worked-examples doc's hand-computed trace.
    assert.equal(shareOf(f.refs.alice), 1731, "Alice: 17.31");
    assert.equal(shareOf(f.refs.bob), 1495, "Bob: 14.95");
    assert.equal(shareOf(f.refs.carol), 314, "Carol: 3.14");
    const sum = e.shares.reduce((s, x) => s + x.amountMinor, 0);
    assert.equal(sum, 3540, "reconciles exactly to the 35.40 receipt total");
    // The itemization itself is returned for display/editing, purely descriptive.
    assert.equal(e.itemization.lines.length, 3);
    assert.equal(e.itemization.tax, '2.40');
    assert.equal(e.itemization.tip, '6.00');
    assert.equal(e.itemization.discount, '3.00');
  });

  test('an unallocated remainder (a forgotten line, or a mistyped receipt total) is refused with a clear message naming the exact gap, never silently spread across everyone', async () => {
    const h = harness();
    const f = await fixture(h);
    const short = await G(h, f, 'alice', 'POST', { body: {
      description: 'x', amount: '35.40', payers: [{ ref: f.refs.alice }],
      itemization: { lines: [{ description: 'Burger', quantity: 1, unitPriceMinor: 1200, refs: [f.refs.alice] }], taxMinor: 0, tipMinor: 0, discountMinor: 0, feeMinor: 0 },
    } });
    assert.equal(short.status, 400);
    assert.match(short.body.error.message, /23\.40.*not yet allocated/);
  });

  test('a total that exceeds the receipt is refused', async () => {
    const h = harness();
    const f = await fixture(h);
    const over = await G(h, f, 'alice', 'POST', { body: {
      description: 'x', amount: '10.00', payers: [{ ref: f.refs.alice }],
      itemization: { lines: [{ description: 'Burger', quantity: 1, unitPriceMinor: 1200, refs: [f.refs.alice] }], taxMinor: 0, tipMinor: 0, discountMinor: 0, feeMinor: 0 },
    } });
    assert.equal(over.status, 400);
    assert.match(over.body.error.message, /more than the expense's own/);
  });

  test('a quantity supports a genuine multi-unit line (2x Pizza)', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = ok(await G(h, f, 'alice', 'POST', { body: {
      description: 'x', amount: '20.00', payers: [{ ref: f.refs.alice }],
      itemization: { lines: [{ description: 'Pizza', quantity: 2, unitPriceMinor: 1000, refs: [f.refs.alice, f.refs.bob] }], taxMinor: 0, tipMinor: 0, discountMinor: 0, feeMinor: 0 },
    } }), 201).expense;
    const shareOf = (ref) => e.shares.find((s) => s.ref === ref).amountMinor;
    assert.equal(shareOf(f.refs.alice), 1000);
    assert.equal(shareOf(f.refs.bob), 1000);
  });

  test('sending split.method "itemized" directly (bypassing itemization) is refused — itemized is reachable only through real line-item data', async () => {
    const h = harness();
    const f = await fixture(h);
    const direct = await G(h, f, 'alice', 'POST', { body: {
      description: 'x', amount: '10.00', payers: [{ ref: f.refs.alice }],
      split: { method: 'itemized', lines: [{ ref: f.refs.alice, value: '10.00' }] },
    } });
    assert.equal(direct.status, 400);
  });

  test('a correction can change the itemization; moving away from itemized to a plain split clears it, never leaving it stale', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = ok(await G(h, f, 'alice', 'POST', { body: {
      description: 'x', amount: '20.00', payers: [{ ref: f.refs.alice }],
      itemization: { lines: [{ description: 'Item', quantity: 1, unitPriceMinor: 2000, refs: [f.refs.alice, f.refs.bob] }], taxMinor: 0, tipMinor: 0, discountMinor: 0, feeMinor: 0 },
    } }), 201).expense;
    assert.ok(e.itemization);
    const corrected = ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: e.revision, reason: 'switch to equal', split: { method: 'equal', lines: [{ ref: f.refs.alice }, { ref: f.refs.bob }] } } })).expense;
    assert.equal(corrected.split.method, 'equal');
    assert.equal(corrected.itemization, null, 'the stale itemization is cleared, never left behind');
  });

  test('groups.invariantProblem refuses a malformed itemization, or one present on a non-itemized split', () => {
    const groups = require('../_shared/groups');
    const base = { members: [{ id: 'a', subject: 's:a' }], contacts: [], categories: [], groupSettlements: [], groupRefunds: [] };
    const goodSplit = { method: 'itemized', lines: [{ ref: 'member:a', value: null }] };
    const goodShares = [{ ref: 'member:a', amountMinor: 1000 }];
    const goodItemization = { lines: [{ description: 'x', quantity: 1, unitPriceMinor: 1000, refs: ['member:a'] }], taxMinor: 0, tipMinor: 0, discountMinor: 0, feeMinor: 0 };
    // Craft the stored `split.lines[0].value` to match the expected computed share (1000).
    const expense = (itemization) => ({ id: 'gex_1', currency: 'EUR', amountMinor: 1000, payers: [{ ref: 'member:a', amountMinor: 1000 }], shares: goodShares, split: { method: 'itemized', lines: [{ ref: 'member:a', value: 1000 }] }, itemization });
    assert.equal(groups.invariantProblem({ ...base, groupExpenses: [expense(undefined)] }), 'group expense itemization');
    assert.equal(groups.invariantProblem({ ...base, groupExpenses: [expense({ ...goodItemization, lines: [] })] }), 'group expense itemization');
    assert.equal(groups.invariantProblem({ ...base, groupExpenses: [expense(goodItemization)] }), null);
    const nonItemized = { id: 'gex_2', currency: 'EUR', amountMinor: 1000, payers: [{ ref: 'member:a', amountMinor: 1000 }], shares: [{ ref: 'member:a', amountMinor: 1000 }], split: { method: 'equal', lines: [{ ref: 'member:a', value: null }] }, itemization: goodItemization };
    assert.equal(groups.invariantProblem({ ...base, groupExpenses: [nonItemized] }), 'group expense itemization');
    void goodSplit;
  });
});
