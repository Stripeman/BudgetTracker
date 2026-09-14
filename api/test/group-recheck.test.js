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

// ---- group settings (Terry, 2026-09-14) ---------------------------------------------------------
const setSettings = (h, f, w, changes, reason) => act(h, f, w, 'settings', { changes, ...(reason ? { reason } : {}) });
const settle = async (h, f, w, body) => ok(await act(h, f, w, 'settle', body), 201).settlement;
const confirm = (h, f, w, s) => act(h, f, w, 'confirm', { settlementId: s.id, revision: s.revision });

describe('Group settings: one validated list, changed by owners and managers, with history and audit', () => {
  test('every member sees each setting with its default and explanation; only owners and managers change them', async () => {
    const h = harness();
    const f = await fixture(h);
    let v = await view(h, f, 'carol');
    assert.deepEqual(v.groupSettings.settings.map((s) => [s.key, s.type, s.value, s.default]), [['anyoneConfirms', 'boolean', true, true], ['ownedEntries', 'choice', 'shared-only', 'shared-only']]);
    for (const s of v.groupSettings.settings) assert.ok(s.label.length > 10 && s.explanation.length > 40, s.key);
    assert.deepEqual(v.groupSettings.settings[1].options.map((o) => o.value), ['shared-only', 'manual']);
    for (const w of ['bob', 'carol', 'eve']) assert.equal((await setSettings(h, f, w, { anyoneConfirms: false })).status, 403, w);
    for (const [changes, code] of [[{ nosuch: true }, 'unknown_setting'], [{ anyoneConfirms: 'no' }, 'invalid_setting'], [{ ownedEntries: 'sometimes' }, 'invalid_setting'], [{}, 'invalid_field']]) {
      const res = await setSettings(h, f, 'alice', changes);
      assert.equal(res.status, 400, JSON.stringify(changes));
      assert.equal(res.body.error.code, code);
    }
    ok(await setSettings(h, f, FRANK, { anyoneConfirms: false }, 'We keep it strict'));
    ok(await setSettings(h, f, 'alice', { ownedEntries: 'manual' }));
    // The same value again changes nothing and adds no history.
    ok(await setSettings(h, f, 'alice', { ownedEntries: 'manual', anyoneConfirms: false }));
    v = await view(h, f, 'bob');
    assert.deepEqual(v.groupSettings.settings.map((s) => s.value), [false, 'manual']);
    assert.deepEqual(v.groupSettings.history.map((x) => [x.by, x.key, x.from, x.to, x.reason]), [
      ['Frank Fictional', 'anyoneConfirms', true, false, 'We keep it strict'],
      ['Alice Fictional', 'ownedEntries', 'shared-only', 'manual', ''],
    ]);
    const { value: doc } = await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`);
    assert.deepEqual(doc.audit.filter((a) => a.action === 'group.settings.update').map((a) => a.fields), [['anyoneConfirms'], ['ownedEntries']]);
  });
});

describe('B: "Anyone in the group can confirm payments"', () => {
  test('on (the default): a member confirms their own payment or one to a contact, and the confirmation says who', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, eve, frank, dana, carol } = f.refs;
    // Bob says he paid Alice 25.00 and confirms it himself.
    const s1 = await settle(h, f, 'bob', { from: bob, to: alice, amount: '25.00' });
    const c1 = ok(await confirm(h, f, 'bob', s1)).settlement;
    assert.deepEqual([c1.status, c1.confirmation], ['confirmed', { by: 'Bob Fictional', relation: 'payer' }]);
    // Eve (member) confirms her own payment to Dana, a contact; Bob confirms one between Frank and Dana.
    const s2 = await settle(h, f, 'eve', { from: eve, to: dana, amount: '10.00' });
    assert.deepEqual(ok(await confirm(h, f, 'eve', s2)).settlement.confirmation, { by: 'Eve Outsider', relation: 'payer' });
    const s3 = await settle(h, f, FRANK, { from: frank, to: dana, amount: '5.00' });
    assert.deepEqual(ok(await confirm(h, f, 'bob', s3)).settlement.confirmation, { by: 'Bob Fictional', relation: 'other' });
    // Money Alice records as received is confirmed by its receiver.
    const s4 = await settle(h, f, 'alice', { from: bob, to: alice, amount: '7.00' });
    assert.deepEqual(s4.confirmation, { by: 'Alice Fictional', relation: 'receiver' });
    // Viewers still confirm only payments to themselves; disputes stay with the receiver; withdrawing a
    // confirmed payment stays with the receiver or a manager or owner (S6).
    const s5 = await settle(h, f, 'bob', { from: bob, to: alice, amount: '3.00' });
    assert.equal((await confirm(h, f, 'carol', s5)).status, 403);
    const s6 = await settle(h, f, 'alice', { from: alice, to: carol, amount: '2.00' });
    assert.equal(ok(await confirm(h, f, 'carol', s6)).settlement.status, 'confirmed');
    assert.equal((await act(h, f, 'eve', 'dispute', { settlementId: s5.id, revision: s5.revision, reason: 'Not mine' })).status, 403);
    assert.equal((await act(h, f, 'bob', 'void', { settlementId: s1.id, revision: c1.revision, reason: 'Oops' })).status, 403);
    // Everyone who may confirm sees the button: Bob on his own payment, Eve on someone else's.
    const s7 = await settle(h, f, 'bob', { from: bob, to: alice, amount: '1.00' });
    assert.equal((await view(h, f, 'bob')).settlements.find((x) => x.id === s7.id).canConfirm, true);
    assert.equal((await view(h, f, 'eve')).settlements.find((x) => x.id === s7.id).canConfirm, true);
    assert.equal((await view(h, f, 'carol')).settlements.find((x) => x.id === s7.id).canConfirm, false);
  });

  test('off: only the receiver confirms, a manager or owner for a contact, and never the payer', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, eve, dana } = f.refs;
    ok(await setSettings(h, f, 'alice', { anyoneConfirms: false }));
    const s1 = await settle(h, f, 'bob', { from: bob, to: alice, amount: '25.00' });
    assert.equal((await confirm(h, f, 'bob', s1)).status, 403);
    assert.equal((await confirm(h, f, 'eve', s1)).status, 403);
    assert.equal((await view(h, f, 'bob')).settlements[0].canConfirm, false);
    assert.deepEqual(ok(await confirm(h, f, 'alice', s1)).settlement.confirmation, { by: 'Alice Fictional', relation: 'receiver' });
    const s2 = await settle(h, f, 'eve', { from: eve, to: dana, amount: '10.00' });
    assert.equal((await confirm(h, f, 'eve', s2)).status, 403);
    assert.deepEqual(ok(await confirm(h, f, FRANK, s2)).settlement.confirmation, { by: 'Frank Fictional', relation: 'other' });
  });
});

describe('E: parallel requests end with one winner and a refusal or a replay, never a double record', () => {
  const post = (h, f, w, { action, body, key }) => h.call('group', 'POST', { ...who(w), query: { ...f.q, ...(action ? { action } : {}) }, body, headers: key ? { 'idempotency-key': key } : {} });
  test('two confirmations of one payment at once: one confirms it, the other is refused; the history holds one confirmation', async () => {
    const h = harness();
    const f = await fixture(h);
    const s = await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.alice, amount: '25.00' });
    const results = await Promise.all([confirm(h, f, 'alice', s), confirm(h, f, 'alice', s)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.ok(['already_confirmed', 'stale_revision'].includes(results.find((r) => r.status === 409).body.error.code));
    const hist = ok(await G(h, f, 'alice', 'GET', { query: { action: 'history', settlementId: s.id } })).history;
    assert.equal(hist.filter((x) => x.event === 'confirmed').length, 1);
  });

  test('two expense creates with one idempotency key make one expense; different keys make separate expenses', async () => {
    const h = harness();
    const f = await fixture(h);
    const body = { description: 'Fictional ferry', amount: '44.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) };
    const same = `k-${'fe'.repeat(16)}`;
    const [r1, r2] = await Promise.all([post(h, f, 'alice', { body, key: same }), post(h, f, 'alice', { body, key: same })]);
    assert.deepEqual([r1.status, r2.status], [201, 201]);
    assert.equal(r1.body.expense.id, r2.body.expense.id, 'the same expense');
    assert.equal((await view(h, f)).expenses.length, 1);
    const [r3, r4] = await Promise.all([post(h, f, 'alice', { body, key: `k-${'ab'.repeat(16)}` }), post(h, f, 'alice', { body, key: `k-${'cd'.repeat(16)}` })]);
    assert.notEqual(r3.body.expense.id, r4.body.expense.id);
    assert.equal((await view(h, f)).expenses.length, 3, 'two distinct requests are two expenses');
    // A payment reported twice at once with one key is one payment.
    const pay = { from: f.refs.bob, to: f.refs.alice, amount: '22.00' };
    const k = `k-${'pa'.repeat(16)}`;
    const [p1, p2] = await Promise.all([post(h, f, 'bob', { action: 'settle', body: pay, key: k }), post(h, f, 'bob', { action: 'settle', body: pay, key: k })]);
    assert.equal(p1.body.settlement.id, p2.body.settlement.id);
    assert.equal((await view(h, f)).settlements.length, 1);
  });

  test('two corrections of one expense at the same revision: one wins, the other is refused as stale', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = await addExpense(h, f, 'alice', { description: 'Fictional lunch', amount: '20.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    const edit = (w, description) => G(h, f, w, 'PATCH', { body: { expenseId: e.id, revision: e.revision, description, reason: 'Wording' } });
    const results = await Promise.all([edit('alice', 'Fictional lunch A'), edit(FRANK, 'Fictional lunch B')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(results.find((r) => r.status === 409).body.error.code, 'stale_revision');
    const now = (await view(h, f)).expenses[0];
    assert.equal(now.revision, 2, 'exactly one correction');
    assert.equal(now.description, results.find((r) => r.status === 200).body.expense.description);
  });
});

describe('E: no route other than Shared expenses sets shared-expense links', () => {
  test('bills refuse client-supplied links on create, record and edit; a recorded occurrence links only to its bill', async () => {
    const h = harness();
    const f = await fixture(h, { kind: 'household' });
    const joint = await account(h, f, 'alice', { name: 'Joint', type: 'checking', currency: 'EUR', visibility: 'shared', openingBalance: '1000.00' });
    const e = await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '40.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    const forged = { groupExpenseId: e.id };
    const bill = { name: 'Fictional internet', billType: 'utilities', accountId: joint.id, amount: '30.00', schedule: { freq: 'monthly', startDate: '2026-09-01' } };
    assert.equal((await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { ...bill, links: forged } })).status, 400, 'create');
    const r = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: bill }), 201).recurring;
    assert.equal((await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'record' }, body: { recurringId: r.id, occurrence: '2026-09-01', links: forged } })).status, 400, 'record');
    assert.equal((await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: r.id, revision: r.revision, links: forged } })).status, 400, 'edit');
    const recorded = ok(await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'record' }, body: { recurringId: r.id, occurrence: '2026-09-01' } }), 201);
    const entry = (await entriesOf(h, f, 'alice', joint.id)).find((t) => t.links && t.links.recurringId === r.id);
    assert.deepEqual(Object.keys(entry.links).sort(), ['occurrence', 'recurringId'], JSON.stringify(recorded));
  });
});

describe('S4 residual: a create-new restore carries nobody else\'s identity on any record', () => {
  test('other members\' subjects, member ids and private account ids appear nowhere in the new workspace, and grant nothing if they join it', async () => {
    const h = harness();
    const f = await fixture(h, { kind: 'household' });
    const q = f.q;
    const joint = await account(h, f, 'alice', { name: 'Joint', type: 'checking', currency: 'EUR', visibility: 'shared', openingBalance: '1000.00' });
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    // Bob's entry on the Joint, corrected by Frank (a manager).
    const [bobsEntry] = ok(await txPost(h, f, 'bob', { accountId: joint.id, kind: 'expense', amount: '12.00', notes: 'Fictional milk' }), 201).transactions;
    ok(await txPatch(h, f, FRANK, bobsEntry, { notes: 'Fictional oat milk' }));
    // A shared merchant Frank added and changed; a bill for which Bob is responsible; a shared budget.
    const bakery = ok(await h.call('payees', 'POST', { user: FRANK, query: q, body: { name: 'Fictional Bakery', visibility: 'shared' } }), 201).payee;
    ok(await h.call('payees', 'PATCH', { user: FRANK, query: q, body: { payeeId: bakery.id, revision: bakery.revision, icon: 'cart' } }));
    ok(await h.call('recurring', 'POST', { user: FRANK, query: q, body: { name: 'Fictional rent', billType: 'housing', accountId: joint.id, amount: '800.00', schedule: { freq: 'monthly', startDate: '2026-10-01' }, responsibleRef: f.refs.bob } }), 201);
    const cat = ok(await h.call('categories', 'GET', { as: 'alice', query: q })).categories.find((c) => c.type !== 'income' && !c.archived);
    ok(await h.call('budgets', 'POST', { user: FRANK, query: q, body: { name: 'Fictional food', scope: 'shared', currency: 'EUR', startDate: '2026-01-01', lines: [{ categoryId: cat.id, amount: '300.00' }] } }), 201);
    // Frank edits the shared contact and renames a category; Frank corrects a shared expense Alice paid
    // for Alice and Dana, and changes a group setting.
    ok(await h.call('contacts', 'PATCH', { user: FRANK, body: { scope: 'workspace', workspaceId: f.ws.id, contactId: f.dana.id, email: 'dana@example.com', reason: 'New email' } }));
    ok(await h.call('categories', 'PATCH', { user: FRANK, query: q, body: { categoryId: cat.id, name: 'Fictional groceries' } }));
    const e = await addExpense(h, f, 'alice', { description: 'Fictional picnic', amount: '20.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.dana) });
    ok(await G(h, f, FRANK, 'PATCH', { body: { expenseId: e.id, revision: e.revision, description: 'Fictional picnic (park)', reason: 'Clearer' } }));
    ok(await setSettings(h, f, FRANK, { anyoneConfirms: false }, 'Strict for now'));
    // Bob records the group on his private wallet.
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: wallet.id }));
    h.clock.advance(60000);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: q, body: {} }), 201).archive.archiveId;
    h.clock.advance(60000);
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }));
    assert.equal(pv.canExecute, true, JSON.stringify(pv.blockers));
    const created = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }), 201).workspace;
    const { value: doc } = await h.storage.getJson(`workspaces/${created.id}/workspace.json`);
    const text = JSON.stringify(doc);
    for (const [label, secret] of [
      ['Bob\'s subject', 'google:g-bob'], ['Frank\'s subject', 'google:g-frank'], ['Carol\'s subject', 'google:g-carol'], ['Eve\'s subject', 'google:g-eve'],
      ['Bob\'s member id', f.mid('Bob')], ['Frank\'s member id', f.mid('Frank')], ['Carol\'s member id', f.mid('Carol')], ['Eve\'s member id', f.mid('Eve')],
      ['Bob\'s wallet', wallet.id],
    ]) assert.equal(text.includes(secret), false, label);
    assert.ok(text.includes('google:g-alice'), 'the restorer keeps her own identity');
    // Carried records are still there: Bob's entry on the Joint, the merchant, the bill, the budget,
    // the shared expense and the setting.
    assert.ok(doc.transactions.some((t) => t.id === bobsEntry.id));
    assert.deepEqual([doc.payees.some((p) => p.id === bakery.id), doc.recurring.length, doc.budgets.length, doc.groupExpenses.length], [true, 1, 1, 1]);
    // If Bob joins the restored workspace, nothing of old counts as his: his old entry is not his, he
    // cannot edit it as a member, and its history shows a former member.
    const nq = { workspaceId: created.id };
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: nq, body: { email: USERS.bob.email, role: 'member' } }), 201);
    ok(await h.call('invitations', 'POST', { as: 'bob', query: { action: 'accept' }, body: { workspaceId: created.id, token: inv.token } }));
    const seen = ok(await h.call('transactions', 'GET', { as: 'bob', query: nq })).transactions.find((t) => t.id === bobsEntry.id);
    assert.equal(seen.createdBySelf, false);
    const edit = await h.call('transactions', 'PATCH', { as: 'bob', query: nq, body: { transactionId: seen.id, revision: seen.revision, notes: 'Mine again?' } });
    assert.equal(edit.status, 403);
    const hist = ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...nq, action: 'history', transactionId: seen.id } }));
    assert.equal(hist.createdBy, 'Former member');
  });
});

describe('C: "Owed-to-others and repayment entries"', () => {
  const MANUAL = ['expense', 'income', 'transfer', 'refund', 'fee', 'reimbursement', 'advance', 'adjustment', 'interest'];
  const kindsOffered = async (h, f) => ok(await h.call('transactions', 'GET', { as: 'alice', query: f.q })).entryKinds;
  async function aliceCash({ manual = true } = {}) {
    const h = harness();
    const f = await fixture(h);
    const cash = await account(h, f, 'alice', { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '400.00' });
    const cat = ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories.find((c) => c.type !== 'income' && !c.archived);
    if (manual) ok(await setSettings(h, f, 'alice', { ownedEntries: 'manual' }));
    return { h, f, cash, cat };
  }
  const numbers = async (x) => {
    const s = await summaryOf(x.h, x.f, 'alice', x.cash.id);
    return [await balanceOf(x.h, x.f, 'alice', x.cash.id), s.gross, s.payables, s.repayments, s.receivable];
  };
  // Alice owes Bob 60.00 for a dinner he paid outside the app.
  const owe = (x, amount = '60.00') => txPost(x.h, x.f, 'alice', { accountId: x.cash.id, kind: 'payable', amount, categoryId: x.cat.id, notes: 'Dinner Bob paid' });

  test('by default they are refused by hand and not offered; once allowed, an owed amount is recorded with its matching spending', async () => {
    const x = await aliceCash({ manual: false });
    assert.deepEqual(await kindsOffered(x.h, x.f), MANUAL);
    const refused = await owe(x);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, 'server_only_kind');
    ok(await setSettings(x.h, x.f, 'alice', { ownedEntries: 'manual' }));
    assert.deepEqual(await kindsOffered(x.h, x.f), [...MANUAL, 'payable', 'repayment']);
    const pair = ok(await owe(x), 201).transactions;
    assert.deepEqual(pair.map((t) => [t.kind, t.amount, t.categoryId]), [['expense', '-60.00', x.cat.id], ['payable', '60.00', null]]);
    assert.ok(pair[0].owedPairId && pair[0].owedPairId === pair[1].owedPairId, 'one pair');
    // No money moved: 400.00; spending 60.00; owed 60.00; outstanding −60.00.
    assert.deepEqual(await numbers(x), ['400.00', '60.00', '60.00', '0.00', '-60.00']);
    // She pays Bob back: money out 60.00 and nothing owed any more.
    ok(await txPost(x.h, x.f, 'alice', { accountId: x.cash.id, kind: 'repayment', amount: '60.00' }), 201);
    assert.deepEqual(await numbers(x), ['340.00', '60.00', '60.00', '60.00', '0.00']);
    // Hand entries carry no group link, so recording the group on this account touches none of them.
    const count = (await entriesOf(x.h, x.f, 'alice', x.cash.id)).length;
    ok(await act(x.h, x.f, 'alice', 'ledger', { currency: 'EUR', accountId: x.cash.id }));
    assert.equal((await entriesOf(x.h, x.f, 'alice', x.cash.id)).length, count);
  });

  test('a pair is corrected only as a pair: editing either half is refused, reversing one reverses both, deleting is refused', async () => {
    const x = await aliceCash();
    const [share, owed] = ok(await owe(x), 201).transactions;
    for (const [label, t, body] of [['amount of the share', share, { amount: '50.00' }], ['kind of the owed amount', owed, { kind: 'expense' }], ['date', share, { date: '2026-09-01' }]]) {
      const res = await txPatch(x.h, x.f, 'alice', t, body);
      assert.equal(res.status, 409, label);
      assert.equal(res.body.error.code, 'owed_pair_locked', label);
    }
    ok(await txPatch(x.h, x.f, 'alice', share, { notes: 'Bob paid at the harbour' }));
    const del = await x.h.call('transactions', 'DELETE', { as: 'alice', query: x.f.q, body: { transactionId: owed.id, revision: owed.revision, reason: 'Probe' } });
    assert.equal(del.status, 409);
    assert.equal(del.body.error.code, 'owed_pair_locked');
    const rev = ok(await x.h.call('transactions', 'POST', { as: 'alice', query: { ...x.f.q, action: 'reverse' }, body: { transactionId: owed.id, reason: 'Bob said I owe nothing' } }), 201);
    assert.equal(rev.transactions.length, 4, 'both halves and both reversals');
    // Both halves reversed: 400.00, spending 0.00, owed 0.00.
    assert.deepEqual(await numbers(x), ['400.00', '0.00', '0.00', '0.00', '0.00']);
  });

  test('switching back to "Created by Shared expenses only" refuses new hand entries and keeps those already made', async () => {
    const x = await aliceCash();
    ok(await owe(x), 201);
    ok(await setSettings(x.h, x.f, 'alice', { ownedEntries: 'shared-only' }));
    assert.equal((await owe(x)).status, 400);
    assert.equal((await txPost(x.h, x.f, 'alice', { accountId: x.cash.id, kind: 'repayment', amount: '1.00' })).status, 400);
    assert.deepEqual(await numbers(x), ['400.00', '60.00', '60.00', '0.00', '-60.00']);
  });

  test('the backup check refuses a broken pair', async () => {
    for (const [label, change] of [
      ['unequal halves', (d) => { d.transactions.find((t) => t.kind === 'payable').amountMinor = 5000; }],
      ['half without its partner', (d) => { d.transactions.find((t) => t.kind === 'expense').owedPairId = 'owe_other000000'; }],
    ]) {
      const x = await aliceCash();
      ok(await owe(x), 201);
      const name = `workspaces/${x.f.ws.id}/workspace.json`;
      const { value } = await x.h.storage.getJson(name);
      change(value);
      await x.h.storage.putJson(name, value);
      const res = await x.h.call('backups', 'POST', { as: 'alice', query: x.f.q, body: {} });
      assert.equal(res.status, 422, label);
      assert.match(res.body.error.message, /owed pair/, label);
    }
  });
});

