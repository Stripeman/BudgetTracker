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
