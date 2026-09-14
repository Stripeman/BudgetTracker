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

describe('N2: entries recorded from Shared expenses are changed only there', () => {
  // Bob records his part on his cash account (500.00). Alice pays a 160.00 dinner for Alice and Bob:
  // Bob's 80.00 share is spending (`expense` −80.00) and owed (`payable` +80.00); no money moves.
  async function bobsPart() {
    const h = harness();
    const f = await fixture(h);
    const cash = await account(h, f, 'bob', { name: 'Bob Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    const cat = ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories.find((c) => c.type !== 'income' && !c.archived);
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: cash.id }));
    const e = await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '160.00', categoryId: cat.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    const list = await entriesOf(h, f, 'bob', cash.id);
    return { h, f, cash, e, share: list.find((t) => t.kind === 'expense'), owed: list.find((t) => t.kind === 'payable') };
  }
  const bobsNumbers = async (x) => {
    const s = await summaryOf(x.h, x.f, 'bob', x.cash.id);
    return [await balanceOf(x.h, x.f, 'bob', x.cash.id), s.gross, s.payables, s.receivable];
  };

  test('amount, kind, dates, category, merchant and split lines are locked; notes, tags and status are not', async () => {
    const x = await bobsPart();
    assert.deepEqual(await bobsNumbers(x), ['500.00', '80.00', '80.00', '-80.00']);
    for (const [label, t, body] of [
      ['kind', x.owed, { kind: 'income' }],
      ['amount', x.owed, { amount: '1.00' }],
      ['date', x.share, { date: '2026-09-01' }],
      ['posted date', x.share, { postedDate: '2026-09-02' }],
      ['category', x.share, { categoryId: null }],
      ['split lines', x.share, { splits: [{ amount: '80.00' }] }],
    ]) {
      const res = await txPatch(x.h, x.f, 'bob', t, body);
      assert.equal(res.status, 409, label);
      assert.equal(res.body.error.code, 'shared_expense_locked', label);
      assert.match(res.body.error.message, /Shared expenses/, label);
    }
    // Unchanged: cash 500.00, spending 80.00, owed 80.00.
    assert.deepEqual(await bobsNumbers(x), ['500.00', '80.00', '80.00', '-80.00']);
    const edited = ok(await txPatch(x.h, x.f, 'bob', x.owed, { notes: 'Pay Alice on Friday', tags: ['dinner'], status: 'cleared' })).transactions[0];
    assert.deepEqual([edited.notes, edited.tags, edited.status], ['Pay Alice on Friday', ['dinner'], 'cleared']);
    assert.equal((await view(x.h, x.f, 'bob')).expenses[0].myLedger.needsReview, false, 'notes, tags and status need no update');
  });

  test('reversing or deleting them by hand is refused; the owner\'s own update still replaces them', async () => {
    const x = await bobsPart();
    const rev = await x.h.call('transactions', 'POST', { as: 'bob', query: { ...x.f.q, action: 'reverse' }, body: { transactionId: x.share.id, reason: 'Probe' } });
    assert.equal(rev.status, 409);
    assert.equal(rev.body.error.code, 'shared_expense_locked');
    const del = await x.h.call('transactions', 'DELETE', { as: 'bob', query: x.f.q, body: { transactionId: x.owed.id, revision: x.owed.revision, reason: 'Probe' } });
    assert.equal(del.status, 409);
    assert.equal(del.body.error.code, 'shared_expense_locked');
    assert.deepEqual(await bobsNumbers(x), ['500.00', '80.00', '80.00', '-80.00']);
    // Alice corrects the dinner to 200.00: Bob's share becomes 100.00; his update replaces his entries.
    ok(await G(x.h, x.f, 'alice', 'PATCH', { body: { expenseId: x.e.id, revision: x.e.revision, amount: '200.00', payers: [{ ref: x.f.refs.alice }], split: equal(x.f.refs.alice, x.f.refs.bob), reason: 'Tip added' } }));
    ok(await act(x.h, x.f, 'bob', 'ledger', { currency: 'EUR' }));
    assert.deepEqual(await bobsNumbers(x), ['500.00', '100.00', '100.00', '-100.00']);
  });
});

describe('R1: shared-expense recording never writes to an account that is not the person\'s own private account', () => {
  // Bob records his part on his wallet (100.00) and has a spare private account (50.00). He pays a
  // 40.00 pizza shared with Alice: share 20.00, lent 20.00; wallet 100.00 − 40.00 = 60.00.
  async function bobsWallet() {
    const h = harness();
    const f = await fixture(h);
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    const spare = await account(h, f, 'bob', { name: 'Bob Spare', type: 'cash', currency: 'EUR', openingBalance: '50.00' });
    const pizza = await addExpense(h, f, 'bob', { description: 'Fictional pizza', amount: '40.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.bob, f.refs.alice), ledger: { accountId: wallet.id } });
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '60.00');
    return { h, f, wallet, spare, pizza };
  }
  const shareWallet = async (x) => {
    const acc = ok(await x.h.call('accounts', 'GET', { as: 'bob', query: x.f.q })).accounts.find((a) => a.id === x.wallet.id);
    return ok(await x.h.call('accounts', 'PATCH', { as: 'bob', query: x.f.q, body: { accountId: x.wallet.id, revision: acc.revision, visibility: 'shared', confirmShare: true } }));
  };
  const taxi = (x) => addExpense(x.h, x.f, 'alice', { description: 'Fictional taxi', amount: '30.00', payers: [{ ref: x.f.refs.alice }], split: equal(x.f.refs.alice, x.f.refs.bob) });

  test('sharing the account ends the link in the same write, audited to its owner only; what is there stays as recorded', async () => {
    const x = await bobsWallet();
    await shareWallet(x);
    const { value: doc } = await x.h.storage.getJson(`workspaces/${x.f.ws.id}/workspace.json`);
    assert.equal(doc.groupLedgers.length, 1);
    assert.ok(doc.groupLedgers[0].endedAt, 'ended, kept');
    assert.match(doc.groupLedgers[0].endReason, /shared/i);
    assert.deepEqual(doc.audit.filter((a) => a.action === 'group.ledger.end').map((a) => [a.scope, a.targetId]), [['self:google:g-bob', doc.groupLedgers[0].id]]);
    const v = await view(x.h, x.f, 'bob');
    assert.equal(v.myLedgers, undefined);
    // The pizza is real cash history on the wallet: kept as recorded, nothing to update.
    assert.deepEqual([v.expenses[0].myLedger.kept, v.expenses[0].myLedger.needsReview], [true, false]);
    assert.equal(await balanceOf(x.h, x.f, 'alice', x.wallet.id), '60.00');
  });

  test('after sharing, others\' changes and the owner\'s updates write nothing there; relinking to another private account works', async () => {
    const x = await bobsWallet();
    await shareWallet(x);
    const before = (await entriesOf(x.h, x.f, 'alice', x.wallet.id)).length;
    // Alice adds a 30.00 taxi shared with Bob (his share 15.00, owed) and corrects the pizza to 50.00.
    await taxi(x);
    const p = (await view(x.h, x.f)).expenses.find((e) => e.id === x.pizza.id);
    ok(await G(x.h, x.f, 'alice', 'PATCH', { body: { expenseId: x.pizza.id, revision: p.revision, amount: '50.00', payers: [{ ref: x.f.refs.bob }], split: equal(x.f.refs.bob, x.f.refs.alice), reason: 'Receipt says 50' } }));
    ok(await act(x.h, x.f, 'bob', 'ledger', { currency: 'EUR' }));
    ok(await act(x.h, x.f, 'bob', 'ledger', { expenseId: x.pizza.id }));
    assert.equal((await entriesOf(x.h, x.f, 'alice', x.wallet.id)).length, before, 'nothing written to the shared wallet');
    assert.equal(await balanceOf(x.h, x.f, 'alice', x.wallet.id), '60.00');
    // The shared wallet cannot be linked again; the spare can, and takes only what is not recorded
    // anywhere yet: the taxi share. Spare: cash 50.00 (no money moved), spending 15.00, owes 15.00.
    assert.equal((await act(x.h, x.f, 'bob', 'ledger', { currency: 'EUR', accountId: x.wallet.id })).body.error.code, 'not_own_account');
    ok(await act(x.h, x.f, 'bob', 'ledger', { currency: 'EUR', accountId: x.spare.id }));
    const s = await summaryOf(x.h, x.f, 'bob', x.spare.id);
    assert.deepEqual([await balanceOf(x.h, x.f, 'bob', x.spare.id), s.gross, s.payables, s.receivable], ['50.00', '15.00', '15.00', '-15.00']);
    assert.equal((await entriesOf(x.h, x.f, 'alice', x.wallet.id)).length, before);
  });

  test('a link whose account stopped being its owner\'s private account writes nothing and asks for another account', async () => {
    const x = await bobsWallet();
    // The wallet becomes shared without the link being ended (data from before this rule).
    const name = `workspaces/${x.f.ws.id}/workspace.json`;
    const { value: doc } = await x.h.storage.getJson(name);
    const w = doc.accounts.find((a) => a.id === x.wallet.id);
    w.visibility = 'shared';
    w.ownerSubject = null;
    await x.h.storage.putJson(name, doc);
    const t = await taxi(x);
    const before = (await entriesOf(x.h, x.f, 'alice', x.wallet.id)).length;
    ok(await act(x.h, x.f, 'bob', 'ledger', { currency: 'EUR' }));
    const strict = await act(x.h, x.f, 'bob', 'ledger', { expenseId: t.id });
    assert.equal(strict.status, 409);
    assert.equal(strict.body.error.code, 'account_not_own');
    assert.equal((await entriesOf(x.h, x.f, 'alice', x.wallet.id)).length, before, 'nothing written');
    assert.equal((await view(x.h, x.f, 'bob')).myLedgers[0].needsAccount, true);
  });
});

