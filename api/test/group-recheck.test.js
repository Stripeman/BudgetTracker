'use strict';
// BT-009 recheck of e747d5e: regression tests for the independent financial and security rechecks
// (N1, N2, R1 and the S4 residual). Every expected value is computed by hand in the comments. All
// people, accounts and amounts are fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');
const { newEntry } = require('../_shared/entries');

const FRANK = Object.freeze({ userId: 'g-frank', email: 'frank@example.com', name: 'Frank Fictional' });
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const who = (w) => (typeof w === 'string' ? { as: w } : { user: w });

// Alice owner, Bob member, Carol viewer, Frank manager, Eve member, Dana a shared contact (no login).
async function fixture(h, { kind = 'group' } = {}) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Recheck Club', kind, reportingCurrency: 'EUR' } }), 201).workspace;
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
  return { ws, q, refs, mid, dana };
}

const G = (h, f, w, method, { query = {}, body } = {}) => h.call('group', method, { ...who(w), query: { ...f.q, ...query }, body });
const act = (h, f, w, action, body) => G(h, f, w, 'POST', { query: { action }, body });
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });
const addExpense = async (h, f, w, body) => ok(await G(h, f, w, 'POST', { body }), 201).expense;
const view = async (h, f, w = 'alice') => ok(await G(h, f, w, 'GET'));
const account = async (h, f, w, body) => ok(await h.call('accounts', 'POST', { ...who(w), query: f.q, body }), 201).account;
const balanceOf = async (h, f, w, id) => ok(await h.call('accounts', 'GET', { ...who(w), query: f.q })).accounts.find((a) => a.id === id).balance;
const entriesOf = async (h, f, w, accountId) => ok(await h.call('transactions', 'GET', { ...who(w), query: { ...f.q, accountId } })).transactions;
const summaryOf = async (h, f, w, accountId) => ok(await h.call('transactions', 'GET', { ...who(w), query: { ...f.q, accountId } })).summary.find((s) => s.currency === 'EUR');
const txPost = (h, f, w, body) => h.call('transactions', 'POST', { ...who(w), query: f.q, body });
const txPatch = (h, f, w, t, body) => h.call('transactions', 'PATCH', { ...who(w), query: f.q, body: { transactionId: t.id, revision: t.revision, reason: 'Probe', ...body } });

describe('N1: payable and repayment are recorded only from Shared expenses', () => {
  test('creating one by hand is refused and changes nothing; lending outside a group stays manual', async () => {
    const h = harness();
    const f = await fixture(h);
    const cash = await account(h, f, 'alice', { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '400.00' });
    for (const kind of ['payable', 'repayment']) {
      const res = await txPost(h, f, 'alice', { accountId: cash.id, kind, amount: '100.00' });
      assert.equal(res.status, 400, kind);
      assert.equal(res.body.error.code, 'server_only_kind', kind);
      assert.match(res.body.error.message, /Shared expenses/, kind);
    }
    // Nothing written: still 400.00 with no entries (a manual payable of 100.00 would have made it 500.00).
    assert.equal(await balanceOf(h, f, 'alice', cash.id), '400.00');
    assert.equal((await entriesOf(h, f, 'alice', cash.id)).length, 0);
    // Money lent outside a group and paid back: −30.00 + 30.00 = 400.00.
    ok(await txPost(h, f, 'alice', { accountId: cash.id, kind: 'advance', amount: '30.00' }), 201);
    ok(await txPost(h, f, 'alice', { accountId: cash.id, kind: 'reimbursement', amount: '30.00' }), 201);
    assert.equal(await balanceOf(h, f, 'alice', cash.id), '400.00');
  });

  test('an entry cannot be changed to or from them by hand', async () => {
    const h = harness();
    const f = await fixture(h);
    const cash = await account(h, f, 'alice', { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '400.00' });
    const [t] = ok(await txPost(h, f, 'alice', { accountId: cash.id, kind: 'expense', amount: '50.00' }), 201).transactions;
    for (const kind of ['payable', 'repayment']) {
      const res = await txPatch(h, f, 'alice', t, { kind });
      assert.equal(res.status, 400, kind);
      assert.equal(res.body.error.code, 'server_only_kind', kind);
    }
    // Still an expense of 50.00: 400.00 − 50.00 = 350.00 (as a payable it would have been 450.00).
    assert.equal(await balanceOf(h, f, 'alice', cash.id), '350.00');
    // A payable of 20.00 made by hand before this rule cannot be turned into something else either.
    const name = `workspaces/${f.ws.id}/workspace.json`;
    const { value: doc } = await h.storage.getJson(name);
    doc.transactions.push(newEntry({ accountId: cash.id, currency: 'EUR', kind: 'payable', amountMinor: 2000, date: '2026-09-12', by: 'google:g-alice', at: '2026-09-13T10:00:00.000Z' }));
    await h.storage.putJson(name, doc);
    const old = (await entriesOf(h, f, 'alice', cash.id)).find((x) => x.kind === 'payable');
    const res = await txPatch(h, f, 'alice', old, { kind: 'expense' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'server_only_kind');
    // 350.00 + 20.00 = 370.00, unchanged by the refused edit.
    assert.equal(await balanceOf(h, f, 'alice', cash.id), '370.00');
  });
});

