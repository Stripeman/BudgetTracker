'use strict';
// BT-009-25 (Terry, 2026-09-19): "Fixed allocations plus a split remainder" — some people's share
// of a shared expense is a fixed, named amount; everyone else splits whatever is left, equally,
// using the exact same deterministic largest-remainder allocation every other split method already
// uses (api/_shared/money.js `allocate`). All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');
const groups = require('../_shared/groups');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Split Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
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
const addExpense = async (h, f, as, body) => ok(await G(h, f, as, 'POST', { body }), 201).expense;

describe('BT-009-25 the "fixed-remainder" split method', () => {
  test('a fixed line keeps its exact amount; the remainder splits equally, with the largest-remainder rounding rule, among everyone else', async () => {
    const h = harness();
    const f = await fixture(h);
    // 100.00 total: Alice fixed at 30.00; Bob and Carol split the 70.00 remainder equally: 35.00 each.
    const e = await addExpense(h, f, 'alice', {
      description: 'Cabin weekend', amount: '100.00', payers: [{ ref: f.refs.alice }],
      split: { method: 'fixed-remainder', lines: [{ ref: f.refs.alice, value: '30.00' }, { ref: f.refs.bob }, { ref: f.refs.carol }] },
    });
    assert.equal(e.split.method, 'fixed-remainder');
    assert.deepEqual(e.shares.map((s) => [s.ref, s.amount]), [[f.refs.alice, '30.00'], [f.refs.bob, '35.00'], [f.refs.carol, '35.00']]);
  });

  test('an uneven remainder is allocated deterministically (largest remainder, ties to the first listed remainder person), never lost or duplicated', async () => {
    const h = harness();
    const f = await fixture(h);
    // 100.01 total, Alice fixed at 30.00: remainder 70.01 split between Bob and Carol -> 35.005 each,
    // rounds to 35.01 / 35.00 (the extra cent to whichever largest-remainder picks first).
    const e = await addExpense(h, f, 'alice', {
      description: 'Cabin weekend', amount: '100.01', payers: [{ ref: f.refs.alice }],
      split: { method: 'fixed-remainder', lines: [{ ref: f.refs.alice, value: '30.00' }, { ref: f.refs.bob }, { ref: f.refs.carol }] },
    });
    const total = e.shares.reduce((s, x) => s + Number(x.amount), 0);
    assert.equal(total.toFixed(2), '100.01', 'the shares always add up to exactly the expense, cent for cent');
    assert.deepEqual(e.shares.map((s) => s.amount).sort(), ['30.00', '35.00', '35.01'].sort());
  });

  test('fixed amounts adding up to more than the expense are refused', async () => {
    const h = harness();
    const f = await fixture(h);
    const res = await G(h, f, 'alice', 'POST', {
      body: { description: 'x', amount: '50.00', payers: [{ ref: f.refs.alice }], split: { method: 'fixed-remainder', lines: [{ ref: f.refs.alice, value: '30.00' }, { ref: f.refs.bob, value: '30.00' }, { ref: f.refs.carol }] } },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'split_amount_total');
  });

  test('with nobody left to share the remainder, the fixed amounts must add up to exactly the expense (like "amounts")', async () => {
    const h = harness();
    const f = await fixture(h);
    const short = await G(h, f, 'alice', 'POST', {
      body: { description: 'x', amount: '50.00', payers: [{ ref: f.refs.alice }], split: { method: 'fixed-remainder', lines: [{ ref: f.refs.alice, value: '20.00' }, { ref: f.refs.bob, value: '20.00' }] } },
    });
    assert.equal(short.status, 400);
    assert.equal(short.body.error.code, 'split_amount_total');
    const exact = await addExpense(h, f, 'alice', {
      description: 'x', amount: '50.00', payers: [{ ref: f.refs.alice }],
      split: { method: 'fixed-remainder', lines: [{ ref: f.refs.alice, value: '20.00' }, { ref: f.refs.bob, value: '30.00' }] },
    });
    assert.deepEqual(exact.shares.map((s) => s.amount), ['20.00', '30.00']);
  });

  test('correcting the amount without resubmitting the split is refused once the fixed lines no longer fit — the same rule "amounts" already has', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = await addExpense(h, f, 'alice', {
      description: 'Cabin weekend', amount: '100.00', payers: [{ ref: f.refs.alice }],
      split: { method: 'fixed-remainder', lines: [{ ref: f.refs.alice, value: '30.00' }, { ref: f.refs.bob }, { ref: f.refs.carol }] },
    });
    // Shrinking the total to less than the fixed amount alone must be refused, not silently make
    // the remainder negative.
    const shrunk = await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: e.revision, reason: 'typo', amount: '20.00', payers: [{ ref: f.refs.alice }] } });
    assert.equal(shrunk.status, 400);
    assert.equal(shrunk.body.error.code, 'split_amount_total');
    // Growing it is fine as long as the fixed line still fits; the remainder grows with it.
    const grown = ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: e.revision, reason: 'typo', amount: '160.00', payers: [{ ref: f.refs.alice }] } })).expense;
    assert.deepEqual(grown.shares.map((s) => s.amount), ['30.00', '65.00', '65.00']);
  });

  test('groups.invariantProblem recomputes fixed-remainder shares exactly like the server does, and catches a tampered stored value', () => {
    const doc = {
      members: [{ id: 'a', subject: 'g-a' }, { id: 'b', subject: 'g-b' }], contacts: [], categories: [],
      groupExpenses: [{
        currency: 'EUR', amountMinor: 10000, payers: [{ ref: 'member:a', amountMinor: 10000 }],
        split: { method: 'fixed-remainder', lines: [{ ref: 'member:a', value: 3000 }, { ref: 'member:b', value: null }] },
        shares: [{ ref: 'member:a', amountMinor: 3000 }, { ref: 'member:b', amountMinor: 7000 }],
      }],
      groupSettlements: [],
    };
    assert.equal(groups.invariantProblem(doc), null, 'a correctly computed fixed-remainder expense passes');
    const tampered = structuredClone(doc);
    tampered.groupExpenses[0].shares[1].amountMinor = 6999;
    assert.equal(groups.invariantProblem(tampered), 'group expense shares');
  });
});
