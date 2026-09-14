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
    // Financial recheck F2 (decision 2026-09-14): the pizza now sits on an account that is no longer
    // Bob's own private account, so it needs review, says why, and has no account until Bob chooses one.
    const mine = v.expenses[0].myLedger;
    assert.deepEqual([mine.needsReview, mine.accountId, mine.formerAccount && mine.formerAccount.reason], [true, null, 'shared']);
    assert.match(mine.note, /Bob Wallet, which is now shared/);
    assert.equal(await balanceOf(x.h, x.f, 'alice', x.wallet.id), '60.00');
  });

  test('after sharing, nothing is written until Bob chooses another private account; then his part moves there (financial recheck F2)', async () => {
    const x = await bobsWallet();
    await shareWallet(x);
    const before = (await entriesOf(x.h, x.f, 'alice', x.wallet.id)).length;
    // Alice adds a 30.00 taxi shared with Bob (his share 15.00, owed) and corrects the pizza to 50.00.
    await taxi(x);
    const p = (await view(x.h, x.f)).expenses.find((e) => e.id === x.pizza.id);
    ok(await G(x.h, x.f, 'alice', 'PATCH', { body: { expenseId: x.pizza.id, revision: p.revision, amount: '50.00', payers: [{ ref: x.f.refs.bob }], split: equal(x.f.refs.bob, x.f.refs.alice), reason: 'Receipt says 50' } }));
    // Without an account to record on, an update touches nothing (reversing would record his part nowhere).
    ok(await act(x.h, x.f, 'bob', 'ledger', { currency: 'EUR' }));
    const strict = await act(x.h, x.f, 'bob', 'ledger', { expenseId: x.pizza.id });
    assert.deepEqual([strict.status, strict.body.error.code], [409, 'account_needed']);
    assert.equal((await entriesOf(x.h, x.f, 'alice', x.wallet.id)).length, before, 'nothing written to the shared wallet');
    assert.equal(await balanceOf(x.h, x.f, 'alice', x.wallet.id), '60.00');
    // The shared wallet cannot be linked again; the spare can. Bob's own pizza entries on the wallet are
    // reversed there (he created them) and everything the group now needs is recorded on the spare:
    //   pizza 50.00 paid by Bob, his share 25.00: spending 25.00, lent 25.00, cash −50.00;
    //   taxi 30.00 paid by Alice, his share 15.00: spending 15.00, owed 15.00, no money moved.
    // Spare: 50.00 − 50.00 = 0.00; spending 40.00; owed 15.00; receivable 25.00 − 15.00 = 10.00, which
    // is his group balance: paid 50.00 − shares 25.00 − 15.00 = 10.00. Wallet: back to 100.00, with the
    // two reversals added (never deleted).
    assert.equal((await act(x.h, x.f, 'bob', 'ledger', { currency: 'EUR', accountId: x.wallet.id })).body.error.code, 'not_own_account');
    ok(await act(x.h, x.f, 'bob', 'ledger', { currency: 'EUR', accountId: x.spare.id }));
    const s = await summaryOf(x.h, x.f, 'bob', x.spare.id);
    assert.deepEqual([await balanceOf(x.h, x.f, 'bob', x.spare.id), s.gross, s.payables, s.receivable], ['0.00', '40.00', '15.00', '10.00']);
    const bobRow = (await view(x.h, x.f)).balances.find((b) => b.currency === 'EUR').rows.find((r) => r.name === 'Bob Fictional');
    assert.equal(bobRow.net, '10.00');
    assert.deepEqual([await balanceOf(x.h, x.f, 'alice', x.wallet.id), (await entriesOf(x.h, x.f, 'alice', x.wallet.id)).length], ['100.00', before + 2]);
    assert.equal((await view(x.h, x.f, 'bob')).expenses.every((e) => !e.myLedger || !e.myLedger.needsReview), true, 'nothing left to review');
  });

  test('stopping recording reverses the person\'s own entries even where they sit on the now-shared account (financial recheck F2)', async () => {
    const x = await bobsWallet();
    await shareWallet(x);
    const before = (await entriesOf(x.h, x.f, 'bob', x.wallet.id)).length;
    // Bob stops recording EUR: his pizza entries on the wallet (share −20.00, lent −20.00) are reversed
    // there: 60.00 + 20.00 + 20.00 = 100.00, the opening balance; the two reversals are added.
    ok(await act(x.h, x.f, 'bob', 'ledger', { currency: 'EUR', accountId: null }));
    assert.deepEqual([await balanceOf(x.h, x.f, 'bob', x.wallet.id), (await entriesOf(x.h, x.f, 'bob', x.wallet.id)).length], ['100.00', before + 2]);
    assert.equal((await view(x.h, x.f, 'bob')).expenses[0].myLedger, undefined, 'nothing of his left to review');
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
    assert.deepEqual(v.groupSettings.settings.map((s) => [s.key, s.type, s.value, s.default]), [
      ['anyoneConfirms', 'boolean', true, true], ['ownedEntries', 'choice', 'shared-only', 'shared-only'],
      ['splitMethod', 'choice', 'equal', 'equal'], ['splitWho', 'choice', 'everyone', 'everyone'], ['paidBy', 'choice', 'me', 'me'],
      ['changeExpenses', 'choice', 'author-or-manager', 'author-or-manager'], ['withdrawPayments', 'choice', 'receiver-or-manager', 'receiver-or-manager'],
      ['disputePayments', 'choice', 'receiver', 'receiver'], ['settleDisputes', 'choice', 'receiver', 'receiver'], ['receiverConfirms', 'boolean', true, true], ['countReported', 'boolean', true, true],
    ]);
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
    assert.deepEqual(v.groupSettings.settings.map((s) => s.value), [false, 'manual', 'equal', 'everyone', 'me', 'author-or-manager', 'receiver-or-manager', 'receiver', 'receiver', true, true]);
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
    // L2 (security recheck of 47617b5): Bob moves 50.00 from the Joint to his private wallet; the Joint's
    // leg comes along, the wallet does not, so the leg must not keep the wallet's id.
    const [jointLeg] = ok(await txPost(h, f, 'bob', { accountId: joint.id, kind: 'transfer', amount: '50.00', transfer: { toAccountId: wallet.id } }), 201).transactions;
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
    // Per-person rights are keyed by member id: Bob's and Eve's must not come along either.
    ok(await setSettings(h, f, FRANK, { confirmOverrides: { [f.mid('Bob')]: 'yes', [f.mid('Eve')]: 'no' } }, 'Per person'));
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
    // The Joint's leg of Bob's transfer: kept (−50.00), marked as having its other side left behind, and no account id for it.
    const leg = doc.transactions.find((t) => t.id === jointLeg.id);
    assert.deepEqual([leg.amountMinor, leg.counterpartExcluded, leg.counterpartAccountId], [-5000, true, null]);
    // No account id that is not in the new workspace appears anywhere in it.
    const carriedAccounts = new Set(doc.accounts.map((a) => a.id));
    const accountIds = [...new Set(text.match(/\bacc_[A-Za-z0-9]+/g) || [])];
    assert.deepEqual(accountIds.filter((id) => !carriedAccounts.has(id)), [], 'every account id named is a carried account');
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

describe('B per person: "Can confirm payments" for each member (Terry, 2026-09-14)', () => {
  const setPerson = (h, f, w, overrides, reason) => setSettings(h, f, w, { confirmOverrides: overrides }, reason);

  test('group on, Bob set to No: Bob confirms only payments made to him; Eve, following the group, confirms her own', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, eve } = f.refs;
    ok(await setPerson(h, f, 'alice', { [f.mid('Bob')]: 'no' }));
    const own = await settle(h, f, 'bob', { from: bob, to: alice, amount: '10.00' });
    assert.equal((await confirm(h, f, 'bob', own)).status, 403, 'not his own payment');
    const others = await settle(h, f, 'eve', { from: eve, to: alice, amount: '4.00' });
    assert.equal((await confirm(h, f, 'bob', others)).status, 403, 'nor someone else\'s');
    const toBob = await settle(h, f, 'eve', { from: eve, to: bob, amount: '3.00' });
    assert.equal(ok(await confirm(h, f, 'bob', toBob)).settlement.confirmation.relation, 'receiver', 'a payment made to him');
    const eves = await settle(h, f, 'eve', { from: eve, to: alice, amount: '2.00' });
    assert.equal(ok(await confirm(h, f, 'eve', eves)).settlement.confirmation.relation, 'payer', 'Eve follows the group setting (on)');
    assert.equal((await view(h, f, 'bob')).settlements.find((s) => s.id === own.id).canConfirm, false);
  });

  test('group off, Bob set to Yes: Bob confirms his own payment and one to a contact; Eve, following the group, cannot', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, eve, dana } = f.refs;
    ok(await setSettings(h, f, 'alice', { anyoneConfirms: false }));
    ok(await setPerson(h, f, FRANK, { [f.mid('Bob')]: 'yes' }));
    const own = await settle(h, f, 'bob', { from: bob, to: alice, amount: '10.00' });
    assert.deepEqual(ok(await confirm(h, f, 'bob', own)).settlement.confirmation, { by: 'Bob Fictional', relation: 'payer' });
    const contact = await settle(h, f, 'eve', { from: eve, to: dana, amount: '6.00' });
    assert.deepEqual(ok(await confirm(h, f, 'bob', contact)).settlement.confirmation, { by: 'Bob Fictional', relation: 'other' });
    const eves = await settle(h, f, 'eve', { from: eve, to: alice, amount: '2.00' });
    assert.equal((await confirm(h, f, 'eve', eves)).status, 403);
  });

  test('without an override a member follows the group setting both ways, and "Use the group setting" returns to it', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    const bobConfirmsOwn = async () => (await confirm(h, f, 'bob', await settle(h, f, 'bob', { from: bob, to: alice, amount: '1.00' }))).status;
    assert.equal(await bobConfirmsOwn(), 200, 'group on');
    ok(await setSettings(h, f, 'alice', { anyoneConfirms: false }));
    assert.equal(await bobConfirmsOwn(), 403, 'group off');
    ok(await setPerson(h, f, 'alice', { [f.mid('Bob')]: 'yes' }));
    assert.equal(await bobConfirmsOwn(), 200, 'Bob set to Yes');
    ok(await setPerson(h, f, 'alice', { [f.mid('Bob')]: 'inherit' }));
    assert.equal(await bobConfirmsOwn(), 403, 'back to the group setting (off)');
  });

  test('a member demoted to viewer confirms only payments made to them, whatever the override', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, eve } = f.refs;
    ok(await setPerson(h, f, 'alice', { [f.mid('Bob')]: 'yes' }));
    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.mid('Bob'), role: 'viewer' } }));
    const others = await settle(h, f, 'eve', { from: eve, to: alice, amount: '4.00' });
    assert.equal((await confirm(h, f, 'bob', others)).status, 403);
    const toBob = await settle(h, f, 'eve', { from: eve, to: bob, amount: '3.00' });
    assert.equal(ok(await confirm(h, f, 'bob', toBob)).settlement.status, 'confirmed');
  });

  test('a removed member\'s override is ignored, cannot be set, and does not come back when they rejoin', async () => {
    const h = harness();
    const f = await fixture(h);
    const eveId = f.mid('Eve');
    ok(await setSettings(h, f, 'alice', { anyoneConfirms: false }));
    ok(await setPerson(h, f, 'alice', { [eveId]: 'yes' }));
    ok(await h.call('members', 'DELETE', { as: 'alice', query: f.q, body: { memberId: eveId, reason: 'Moved away' } }));
    const refused = await setPerson(h, f, 'alice', { [eveId]: 'no' });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, 'invalid_setting');
    assert.equal((await view(h, f)).groupSettings.members.some((m) => m.memberId === eveId), false, 'not listed while removed');
    // Eve rejoins: the same member record starts a new membership period, and nothing from the earlier one comes back.
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: USERS.eve.email, role: 'member' } }), 201);
    ok(await h.call('invitations', 'POST', { as: 'eve', query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: inv.token } }));
    const eves = await settle(h, f, 'eve', { from: f.refs.eve, to: f.refs.alice, amount: '2.00' });
    assert.equal((await confirm(h, f, 'eve', eves)).status, 403, 'the old Yes no longer applies; the group setting (off) does');
    assert.deepEqual((await view(h, f)).groupSettings.members.find((m) => m.memberId === eveId), { memberId: eveId, name: 'Eve Outsider', role: 'member', override: 'inherit', effective: false });
  });

  test('the model itself reads a removed member\'s override as "Use the group setting", and an active one\'s as set', () => {
    const settings = require('../_shared/group-settings');
    const m = { id: 'mem_fictional01', role: 'member', status: 'removed', history: [] };
    const doc = { members: [m], groupSettings: { values: { anyoneConfirms: false }, perMember: { confirmOverrides: { [m.id]: { value: 'yes', at: '2026-09-14T08:00:00.000Z', by: 'google:g-alice', period: 0 } } } } };
    assert.deepEqual([settings.overrideOf(doc, 'confirmOverrides', m), settings.confirmsAny(doc, m)], ['inherit', false], 'removed: the group setting (off)');
    m.status = 'active';
    assert.deepEqual([settings.overrideOf(doc, 'confirmOverrides', m), settings.confirmsAny(doc, m)], ['yes', true], 'active, same membership period: Yes');
  });

  test('owners and managers see everyone\'s setting and effective right; others see only their own; changes are validated and kept in the history', async () => {
    const h = harness();
    const f = await fixture(h);
    ok(await setPerson(h, f, FRANK, { [f.mid('Bob')]: 'no' }, 'Keeps his own accounts'));
    const managerView = (await view(h, f, 'alice')).groupSettings;
    // Group on: everyone who can add follows it and may confirm any payment; Bob is set to No; Carol is a viewer.
    assert.deepEqual(managerView.members.map((m) => [m.name, m.role, m.override, m.effective]), [
      ['Alice Fictional', 'owner', 'inherit', true], ['Bob Fictional', 'member', 'no', false], ['Carol Fictional', 'viewer', 'inherit', false],
      ['Frank Fictional', 'manager', 'inherit', true], ['Eve Outsider', 'member', 'inherit', true],
    ]);
    assert.deepEqual((await view(h, f, 'bob')).groupSettings.mine, { override: 'no', effective: false });
    assert.deepEqual((await view(h, f, 'eve')).groupSettings.mine, { override: 'inherit', effective: true });
    for (const w of ['bob', 'carol', 'eve']) assert.equal((await view(h, f, w)).groupSettings.members, undefined, `${w} sees nobody else's right`);
    // The history of per-person rights is for owners and managers, and for the person concerned.
    const personEntries = async (w) => (await view(h, f, w)).groupSettings.history.filter((x) => x.key === 'confirmOverrides').map((x) => x.member);
    assert.deepEqual([await personEntries('bob'), await personEntries('eve'), await personEntries('carol')], [['Bob Fictional'], [], []]);
    assert.equal((await setPerson(h, f, 'bob', { [f.mid('Eve')]: 'no' })).status, 403, 'members cannot change it');
    for (const [label, overrides] of [['unknown member', { mem_nosuch0000000: 'no' }], ['unknown value', { [f.mid('Bob')]: 'maybe' }], ['not an object', 'no']]) {
      const res = await setPerson(h, f, 'alice', overrides);
      assert.equal(res.status, 400, label);
    }
    const last = managerView.history[managerView.history.length - 1];
    assert.deepEqual([last.by, last.key, last.member, last.from, last.to, last.reason], ['Frank Fictional', 'confirmOverrides', 'Bob Fictional', 'inherit', 'no', 'Keeps his own accounts']);
  });
});

describe('F1 (financial recheck of 47617b5): a disputed payment is settled only as the group allows', () => {
  const dispute = (h, f, w, s) => act(h, f, w, 'dispute', { settlementId: s.id, revision: s.revision, reason: 'Never arrived' });
  const fresh = async (h, f, s, w = 'alice') => (await view(h, f, w)).settlements.find((x) => x.id === s.id);
  // Bob reports paying Alice; Alice disputes it.
  const disputed = async (h, f, amount = '20.00') => {
    const s = await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.alice, amount });
    ok(await dispute(h, f, 'alice', s));
    return fresh(h, f, s);
  };
  const nets = async (h, f) => { const rows = (await view(h, f)).balances.find((b) => b.currency === 'EUR').rows; return ['Alice Fictional', 'Bob Fictional'].map((n) => rows.find((r) => r.name === n).net); };
  const events = async (h, f, s) => ok(await G(h, f, 'alice', 'GET', { query: { action: 'history', settlementId: s.id } })).history.map((x) => x.event);

  test('default, with anyone able to confirm: neither the payer, a manager nor another member confirms over Alice\'s dispute; Alice does, marked as over a dispute, and only then does it count', async () => {
    const h = harness();
    const f = await fixture(h);
    const s = await disputed(h, f);
    for (const w of ['bob', FRANK, 'eve']) assert.equal((await confirm(h, f, w, s)).status, 403, typeof w === 'string' ? w : w.name);
    assert.deepEqual([(await fresh(h, f, s, 'bob')).canConfirm, (await fresh(h, f, s, FRANK)).canConfirm, (await fresh(h, f, s, 'eve')).canConfirm, (await fresh(h, f, s, 'alice')).canConfirm], [false, false, false, true]);
    // A disputed payment is not in the balances: no expenses, so Alice 0.00 and Bob 0.00.
    assert.deepEqual(await nets(h, f), ['0.00', '0.00']);
    const done = ok(await confirm(h, f, 'alice', s)).settlement;
    assert.deepEqual([done.status, done.confirmedOverDispute, done.confirmation], ['confirmed', true, { by: 'Alice Fictional', relation: 'receiver' }]);
    // Now it counts: Bob paid out 20.00 (+20.00), Alice received 20.00 (−20.00).
    assert.deepEqual(await nets(h, f), ['-20.00', '20.00']);
    assert.deepEqual(await events(h, f, s), ['reported', 'disputed', 'confirmed-over-dispute']);
    const doc = (await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`)).value;
    assert.deepEqual(doc.audit.filter((a) => a.action === 'group.settlement.confirm' && a.targetId === s.id).map((a) => a.fields), [['overDispute']]);
    // A plain confirmation of a reported payment is not marked.
    const plain = await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.alice, amount: '1.00' });
    assert.equal(ok(await confirm(h, f, 'bob', plain)).settlement.confirmedOverDispute, false);
  });

  test('"the person who received it, or a manager or owner": Frank settles it; the payer and Eve still cannot', async () => {
    const h = harness();
    const f = await fixture(h);
    ok(await setSettings(h, f, 'alice', { settleDisputes: 'receiver-or-manager' }));
    const s = await disputed(h, f);
    assert.equal((await confirm(h, f, 'bob', s)).status, 403);
    assert.equal((await confirm(h, f, 'eve', s)).status, 403);
    const done = ok(await confirm(h, f, FRANK, s)).settlement;
    assert.deepEqual([done.confirmedOverDispute, done.confirmation], [true, { by: 'Frank Fictional', relation: 'other' }]);
  });

  test('"anyone who can confirm payments": Eve and the payer may; a viewer who did not receive it, or someone set to No, may not', async () => {
    const h = harness();
    const f = await fixture(h);
    ok(await setSettings(h, f, 'alice', { settleDisputes: 'confirmers' }));
    const s1 = await disputed(h, f, '11.00');
    assert.equal(ok(await confirm(h, f, 'eve', s1)).settlement.confirmedOverDispute, true);
    const s2 = await disputed(h, f, '12.00');
    assert.equal((await confirm(h, f, 'carol', s2)).status, 403, 'a viewer');
    ok(await setSettings(h, f, 'alice', { confirmOverrides: { [f.mid('Eve')]: 'no' } }));
    assert.equal((await confirm(h, f, 'eve', s2)).status, 403, 'Eve set to No');
    assert.deepEqual(ok(await confirm(h, f, 'bob', s2)).settlement.confirmation, { by: 'Bob Fictional', relation: 'payer' });
  });

  test('with the group setting off, the default lets the receiver settle a dispute and no manager; the setting is validated and only managers change it', async () => {
    const h = harness();
    const f = await fixture(h);
    ok(await setSettings(h, f, 'alice', { anyoneConfirms: false }));
    const s = await disputed(h, f);
    assert.equal((await confirm(h, f, FRANK, s)).status, 403);
    assert.equal(ok(await confirm(h, f, 'alice', s)).settlement.confirmedOverDispute, true);
    assert.equal((await setSettings(h, f, 'alice', { settleDisputes: 'payer' })).status, 400);
    assert.equal((await setSettings(h, f, 'bob', { settleDisputes: 'confirmers' })).status, 403);
  });
});

describe('F2 (financial recheck of 47617b5): a part left on an account that is no longer one\'s own is reviewed and moved', () => {
  // Alice records the group on Alice Cash (500.00). A 120.00 dinner she paid, shared by Alice, Bob,
  // Carol and Eve: 30.00 each. Her entries: spending 30.00, lent 90.00; cash 380.00. Bob pays her 75.00
  // and she confirms it: repaid to her 75.00; cash 455.00. Outstanding 90.00 − 75.00 = 15.00, which is
  // her group balance: paid 120.00 − share 30.00 − received 75.00 = 15.00.
  async function alicesPart() {
    const h = harness();
    const f = await fixture(h);
    const cash = await account(h, f, 'alice', { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    const wallet = await account(h, f, 'alice', { name: 'Alice Wallet', type: 'cash', currency: 'EUR', openingBalance: '200.00' });
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR', accountId: cash.id }));
    const dinner = await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '120.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.carol, f.refs.eve) });
    const pay = await settle(h, f, 'bob', { from: f.refs.bob, to: f.refs.alice, amount: '75.00' });
    ok(await confirm(h, f, 'alice', pay));
    const s = await summaryOf(h, f, 'alice', cash.id);
    assert.deepEqual([await balanceOf(h, f, 'alice', cash.id), s.gross, s.receivable], ['455.00', '30.00', '15.00']);
    return { h, f, cash, wallet, dinner };
  }
  // Alice's own numbers across all her accounts (the list without an account filter) and on the wallet.
  const numbers = async (x) => {
    const all = ok(await x.h.call('transactions', 'GET', { as: 'alice', query: x.f.q })).summary.find((s) => s.currency === 'EUR');
    const w = await summaryOf(x.h, x.f, 'alice', x.wallet.id);
    return { spending: all.gross, outstanding: all.receivable, wallet: [await balanceOf(x.h, x.f, 'alice', x.wallet.id), w.gross, w.receivable] };
  };
  const correctThenVoid = async (x) => {
    // The dinner corrected to 200.00: 50.00 each. Spending 50.00; lent 150.00 − repaid 75.00 = 75.00.
    const d = (await view(x.h, x.f)).expenses.find((e) => e.id === x.dinner.id);
    ok(await G(x.h, x.f, 'alice', 'PATCH', { body: { expenseId: d.id, revision: d.revision, amount: '200.00', payers: [{ ref: x.f.refs.alice }], split: equal(x.f.refs.alice, x.f.refs.bob, x.f.refs.carol, x.f.refs.eve), reason: 'Wine added' } }));
    const corrected = await numbers(x);
    // Voided: no share and nothing lent; only the 75.00 Bob paid her remains, which she now owes back: −75.00.
    const d2 = (await view(x.h, x.f)).expenses.find((e) => e.id === x.dinner.id);
    ok(await act(x.h, x.f, 'alice', 'void', { expenseId: d2.id, revision: d2.revision, reason: 'Wrong group' }));
    return { corrected, voided: await numbers(x) };
  };

  test('share path: once Alice Cash is shared her part needs review and nothing moves until she chooses Alice Wallet; then her part is there and corrections keep it right', async () => {
    const x = await alicesPart();
    const acc = ok(await x.h.call('accounts', 'GET', { as: 'alice', query: x.f.q })).accounts.find((a) => a.id === x.cash.id);
    ok(await x.h.call('accounts', 'PATCH', { as: 'alice', query: x.f.q, body: { accountId: x.cash.id, revision: acc.revision, visibility: 'shared', confirmShare: true } }));
    let v = await view(x.h, x.f, 'alice');
    for (const rec of [v.expenses[0], v.settlements[0]]) {
      assert.deepEqual([rec.myLedger.needsReview, rec.myLedger.formerAccount.reason], [true, 'shared']);
      assert.match(rec.myLedger.note, /Alice Cash, which is now shared/);
    }
    const count = (await entriesOf(x.h, x.f, 'alice', x.cash.id)).length;
    ok(await act(x.h, x.f, 'alice', 'ledger', { currency: 'EUR' }));
    assert.equal((await act(x.h, x.f, 'alice', 'ledger', { expenseId: x.dinner.id })).body.error.code, 'account_needed');
    assert.equal((await entriesOf(x.h, x.f, 'alice', x.cash.id)).length, count, 'nothing moved without an account');
    // She chooses Alice Wallet: her three entries on Cash are reversed there (Cash back to 500.00) and her
    // part is recorded on the wallet: 200.00 − 120.00 + 75.00 = 155.00; spending 30.00; outstanding 15.00.
    ok(await act(x.h, x.f, 'alice', 'ledger', { currency: 'EUR', accountId: x.wallet.id }));
    assert.equal(await balanceOf(x.h, x.f, 'alice', x.cash.id), '500.00');
    assert.deepEqual(await numbers(x), { spending: '30.00', outstanding: '15.00', wallet: ['155.00', '30.00', '15.00'] });
    v = await view(x.h, x.f, 'alice');
    assert.deepEqual([v.expenses[0].myLedger.needsReview, v.settlements[0].myLedger.needsReview], [false, false]);
    const { corrected, voided } = await correctThenVoid(x);
    // Wallet after the correction: 200.00 − 200.00 + 75.00 = 75.00; after the void: 200.00 + 75.00 = 275.00.
    assert.deepEqual(corrected, { spending: '50.00', outstanding: '75.00', wallet: ['75.00', '50.00', '75.00'] });
    assert.deepEqual(voided, { spending: '0.00', outstanding: '-75.00', wallet: ['275.00', '0.00', '-75.00'] });
  });

  test('delete path: once Alice Cash is removed her part needs review; choosing Alice Wallet leaves the old entries where they are and records her whole part on the wallet', async () => {
    const x = await alicesPart();
    ok(await x.h.call('accounts', 'DELETE', { as: 'alice', query: x.f.q, body: { accountId: x.cash.id, reason: 'Closed at the bank' } }));
    let v = await view(x.h, x.f, 'alice');
    assert.deepEqual([v.expenses[0].myLedger.needsReview, v.expenses[0].myLedger.formerAccount.reason], [true, 'deleted']);
    assert.match(v.expenses[0].myLedger.note, /an account that no longer exists/);
    ok(await act(x.h, x.f, 'alice', 'ledger', { currency: 'EUR', accountId: x.wallet.id }));
    // Wallet: 200.00 − 120.00 + 75.00 = 155.00; spending 30.00; outstanding 15.00 (the removed account's
    // entries are not counted anywhere, and are kept, never deleted).
    assert.deepEqual(await numbers(x), { spending: '30.00', outstanding: '15.00', wallet: ['155.00', '30.00', '15.00'] });
    v = await view(x.h, x.f, 'alice');
    const mine = v.expenses[0].myLedger;
    assert.deepEqual([mine.needsReview, mine.formerAccount.reason, mine.formerAccount.left], [false, 'deleted', true]);
    assert.match(mine.note, /left on a former account/);
    const doc = (await x.h.storage.getJson(`workspaces/${x.f.ws.id}/workspace.json`)).value;
    assert.equal(doc.transactions.filter((t) => t.accountId === x.cash.id && !t.reversedBy && !t.deletedAt).length, 3, 'the old entries are kept as they were');
    const { corrected, voided } = await correctThenVoid(x);
    assert.deepEqual(corrected, { spending: '50.00', outstanding: '75.00', wallet: ['75.00', '50.00', '75.00'] });
    assert.deepEqual(voided, { spending: '0.00', outstanding: '-75.00', wallet: ['275.00', '0.00', '-75.00'] });
  });

  test('receivable counts the viewer\'s own private accounts only: Frank\'s 40.00 lent from the shared Joint is nobody\'s receivable; his own 10.00 is his', async () => {
    const h = harness();
    const f = await fixture(h, { kind: 'household' });
    const joint = await account(h, f, 'alice', { name: 'Joint', type: 'checking', currency: 'EUR', visibility: 'shared', openingBalance: '1000.00' });
    const franks = await account(h, f, FRANK, { name: 'Frank Cash', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    ok(await txPost(h, f, FRANK, { accountId: joint.id, kind: 'advance', amount: '40.00', notes: 'Lent to a neighbour' }), 201);
    ok(await txPost(h, f, FRANK, { accountId: franks.id, kind: 'advance', amount: '10.00', notes: 'Lent to a friend' }), 201);
    const all = async (w) => ok(await h.call('transactions', 'GET', { ...who(w), query: f.q })).summary.find((s) => s.currency === 'EUR');
    assert.deepEqual([(await all('alice')).receivable, (await all(FRANK)).receivable], ['0.00', '10.00']);
    // The Joint's own list still reports what was lent from it, but as nobody's receivable.
    const j = await summaryOf(h, f, 'alice', joint.id);
    assert.deepEqual([j.advances, j.receivable], ['40.00', '0.00']);
  });
});

describe('L3 (financial recheck of 47617b5): the backup check is as tolerant as reads and refuses only broken structure', () => {
  const docName = (f) => `workspaces/${f.ws.id}/workspace.json`;
  const edit = async (h, f, change) => { const { value: doc } = await h.storage.getJson(docName(f)); change(doc); await h.storage.putJson(docName(f), doc); };
  const backup = (h, f) => h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} });

  test('values a newer version could have stored read as their defaults, ordinary writes go on, and backups still succeed', async () => {
    const h = harness();
    const f = await fixture(h);
    ok(await setSettings(h, f, 'alice', { ownedEntries: 'manual' }));
    // As if written by a later version and then rolled back past it: a value this version does not know
    // for a known setting, an unknown option, an unknown key, and an override with an unknown value.
    await edit(h, f, (doc) => {
      Object.assign(doc.groupSettings.values, { anyoneConfirms: 'sometimes', settleDisputes: 'a-future-option', aFutureSetting: 7 });
      doc.groupSettings.perMember = { confirmOverrides: { [f.mid('Bob')]: { value: 'maybe', at: '2026-09-14T09:00:00.000Z', by: 'google:g-alice', period: 0 } } };
    });
    const gs = (await view(h, f)).groupSettings;
    assert.deepEqual(gs.settings.filter((s) => ['anyoneConfirms', 'ownedEntries', 'settleDisputes'].includes(s.key)).map((s) => s.value), [true, 'manual', 'receiver']);
    assert.equal(gs.members.find((m) => m.name === 'Bob Fictional').override, 'inherit');
    ok(await setSettings(h, f, FRANK, { ownedEntries: 'shared-only' }), 200);
    assert.equal((await backup(h, f)).status, 201, 'backups do not stop after a rollback');
  });

  test('broken structure is still refused: an object where a single value belongs, values that are a list, an override that is not an object, a history that is not a list', async () => {
    for (const [label, change] of [
      ['object as a value', (doc) => { doc.groupSettings.values.anyoneConfirms = { nested: true }; }],
      ['values as a list', (doc) => { doc.groupSettings.values = ['on']; }],
      ['override not an object', (doc) => { doc.groupSettings.perMember = { confirmOverrides: { mem_fictional01: 'no' } }; }],
      ['history not a list', (doc) => { doc.groupSettings.history = {}; }],
    ]) {
      const h = harness();
      const f = await fixture(h);
      ok(await setSettings(h, f, 'alice', { ownedEntries: 'manual' }));
      await edit(h, f, change);
      const res = await backup(h, f);
      assert.deepEqual([res.status, res.body.error && res.body.error.code], [422, 'backup_invalid'], label);
    }
  });
});

describe('L4 (financial recheck of 47617b5): a share someone else paid is marked as such, never as money out', () => {
  test('Bob\'s share of a dinner Alice paid, and the spending half of a hand-entered pair, are paid by someone else; Alice\'s own share and a part-payer\'s share are not', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    const bobCash = await account(h, f, 'bob', { name: 'Bob Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    const aliceCash = await account(h, f, 'alice', { name: 'Alice Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: bobCash.id }));
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR', accountId: aliceCash.id }));
    // 160.00 paid by Alice, shared by Alice and Bob: Bob's share 80.00 is spending with 80.00 owed and no
    // money moved; Alice's share 80.00 left her account with the rest (she lent 80.00).
    await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '160.00', payers: [{ ref: alice }], split: equal(alice, bob) });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    const flags = async (w, accountId) => (await entriesOf(h, f, w, accountId)).map((t) => [t.kind, t.amount, t.paidBySomeoneElse]);
    assert.deepEqual((await flags('bob', bobCash.id)).sort(), [['expense', '-80.00', true], ['payable', '80.00', false]]);
    assert.deepEqual((await flags('alice', aliceCash.id)).sort(), [['advance', '-80.00', false], ['expense', '-80.00', false]]);
    // 60.00 paid 40.00 by Alice and 20.00 by Bob, shared equally (30.00 each): Bob's share 30.00 is partly
    // his own cash (20.00 left his account), so it keeps its money arrow: owed only 10.00.
    await addExpense(h, f, 'alice', { description: 'Fictional lunch', amount: '60.00', payers: [{ ref: alice, amount: '40.00' }, { ref: bob, amount: '20.00' }], split: equal(alice, bob) });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    const lunch = (await flags('bob', bobCash.id)).filter(([k, a]) => (k === 'expense' && a === '-30.00') || (k === 'payable' && a === '10.00'));
    assert.deepEqual(lunch.sort(), [['expense', '-30.00', false], ['payable', '10.00', false]]);
    // A 60.00 brunch paid by Alice, shared equally: Bob's 30.00 is paid by someone else. Corrected to
    // 40.00 by Alice and 20.00 by Bob: his current share is partly his own cash (owed only 10.00), so it
    // keeps its arrow; his reversed original and its reversal stay marked (each matched in its own state).
    const brunch = await addExpense(h, f, 'alice', { description: 'Fictional brunch', amount: '60.00', payers: [{ ref: alice }], split: equal(alice, bob) });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: brunch.id, revision: brunch.revision, amount: '60.00', payers: [{ ref: alice, amount: '40.00' }, { ref: bob, amount: '20.00' }], split: equal(alice, bob), reason: 'Bob paid part' } }));
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    const brunchShares = (await entriesOf(h, f, 'bob', bobCash.id)).filter((t) => t.kind === 'expense' && t.links.groupExpenseId === brunch.id)
      .map((t) => [t.amount, !!t.reversedBy, !!t.links.reverses, t.paidBySomeoneElse]);
    assert.deepEqual(brunchShares.sort(), [['-30.00', false, false, false], ['-30.00', true, false, true], ['30.00', false, true, true]]);
    // A hand-entered amount owed of 12.00 (hand entry allowed): its spending half is paid by someone else.
    ok(await setSettings(h, f, 'alice', { ownedEntries: 'manual' }));
    const plain = await account(h, f, 'alice', { name: 'Alice Pocket', type: 'cash', currency: 'EUR', openingBalance: '50.00' });
    const pair = ok(await txPost(h, f, 'alice', { accountId: plain.id, kind: 'payable', amount: '12.00', notes: 'Bob paid for my ticket' }), 201).transactions;
    assert.deepEqual(pair.map((t) => [t.kind, t.paidBySomeoneElse]).sort(), [['expense', true], ['payable', false]]);
    // Its reversal: the reversed share is still marked, and so is the reversing entry.
    const [share] = pair.filter((t) => t.kind === 'expense');
    ok(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'reverse' }, body: { transactionId: share.id, reason: 'Entered twice' } }), 201);
    assert.deepEqual((await flags('alice', plain.id)).filter(([k]) => k === 'expense').map(([, a, p]) => [a, p]).sort(), [['-12.00', true], ['12.00', true]]);
  });
});

describe('L3 (security recheck of 47617b5): a transfer names the other account only to someone who may see it', () => {
  test('on the shared side of Bob\'s transfer to his private wallet, Alice, Carol, Eve and Frank get no account id; Bob does, and so does Eve once he lets her see the wallet', async () => {
    const h = harness();
    const f = await fixture(h, { kind: 'household' });
    const joint = await account(h, f, 'alice', { name: 'Joint', type: 'checking', currency: 'EUR', visibility: 'shared', openingBalance: '1000.00' });
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', type: 'cash', currency: 'EUR', openingBalance: '100.00' });
    const [out] = ok(await txPost(h, f, 'bob', { accountId: joint.id, kind: 'transfer', amount: '50.00', transfer: { toAccountId: wallet.id } }), 201).transactions;
    const counterpartFor = async (w) => {
      const t = (await entriesOf(h, f, w, joint.id)).find((x) => x.id === out.id);
      assert.ok(t, `${typeof w === 'string' ? w : w.name} sees the Joint's leg`);
      return t.counterpartAccountId;
    };
    assert.deepEqual([await counterpartFor('alice'), await counterpartFor('carol'), await counterpartFor('eve'), await counterpartFor(FRANK)], [null, null, null, null]);
    assert.equal(await counterpartFor('bob'), wallet.id);
    // Nor does the response to creating it, or any list without an account filter, name the wallet to others.
    for (const w of ['alice', 'carol', 'eve', FRANK]) {
      const all = ok(await h.call('transactions', 'GET', { ...who(w), query: f.q })).transactions;
      assert.equal(JSON.stringify(all).includes(wallet.id), false, `${typeof w === 'string' ? w : w.name}: no trace of the wallet`);
    }
    // Bob lets Eve see the wallet's balance: now the other account may be named to her.
    ok(await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: wallet.id, memberId: f.mid('Eve'), capabilities: ['view-balances'] } }), 201);
    assert.equal(await counterpartFor('eve'), wallet.id);
    assert.equal(await counterpartFor('alice'), null);
  });
});

describe('M1 (security recheck of 47617b5): several per-person rights saved in one request are all kept', () => {
  const setPerson = (h, f, w, overrides, reason) => setSettings(h, f, w, { confirmOverrides: overrides }, reason);
  const stored = async (h, f) => (await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`)).value;
  const rights = async (h, f) => (await view(h, f, 'alice')).groupSettings.members.map((m) => [m.name, m.override, m.effective]);
  const personHistory = async (h, f) => (await view(h, f, 'alice')).groupSettings.history.filter((x) => x.key === 'confirmOverrides').map((x) => [x.member, x.from, x.to]);

  test('two in one request: Bob and Eve are both set to No, both lose Confirm on their own payment, and history and audit say so once each', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, eve } = f.refs;
    ok(await setPerson(h, f, 'alice', { [f.mid('Bob')]: 'no', [f.mid('Eve')]: 'no' }, 'Both keep their own accounts'));
    // Group on (the default): everyone else follows it; Bob and Eve are No.
    assert.deepEqual(await rights(h, f), [
      ['Alice Fictional', 'inherit', true], ['Bob Fictional', 'no', false], ['Carol Fictional', 'inherit', false], ['Frank Fictional', 'inherit', true], ['Eve Outsider', 'no', false],
    ]);
    const doc = await stored(h, f);
    assert.deepEqual(Object.keys(doc.groupSettings.perMember.confirmOverrides).sort(), [f.mid('Bob'), f.mid('Eve')].sort(), 'both are stored');
    assert.equal((await confirm(h, f, 'bob', await settle(h, f, 'bob', { from: bob, to: alice, amount: '10.00' }))).status, 403);
    assert.equal((await confirm(h, f, 'eve', await settle(h, f, 'eve', { from: eve, to: alice, amount: '4.00' }))).status, 403);
    assert.deepEqual(await personHistory(h, f), [['Bob Fictional', 'inherit', 'no'], ['Eve Outsider', 'inherit', 'no']]);
    const audits = doc.audit.filter((a) => a.action === 'group.settings.update');
    assert.deepEqual(audits.map((a) => a.fields), [['confirmOverrides']], 'one audited change for the one request');
  });

  test('three in one request with the group setting turned off: every value is kept, and a repeated value records nothing', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, eve } = f.refs;
    ok(await setSettings(h, f, 'alice', { anyoneConfirms: false, confirmOverrides: { [f.mid('Bob')]: 'yes', [f.mid('Eve')]: 'yes', [f.mid('Frank')]: 'no' } }, 'New rules'));
    // Group off: Alice (no override) and Carol (viewer) cannot confirm any payment; Bob and Eve (Yes) can; Frank (No) cannot.
    assert.deepEqual(await rights(h, f), [
      ['Alice Fictional', 'inherit', false], ['Bob Fictional', 'yes', true], ['Carol Fictional', 'inherit', false], ['Frank Fictional', 'no', false], ['Eve Outsider', 'yes', true],
    ]);
    assert.equal((await confirm(h, f, 'bob', await settle(h, f, 'bob', { from: bob, to: alice, amount: '10.00' }))).status, 200);
    assert.equal((await confirm(h, f, 'eve', await settle(h, f, 'eve', { from: eve, to: alice, amount: '4.00' }))).status, 200);
    const all = (await view(h, f, 'alice')).groupSettings.history.map((x) => [x.key, x.member || null, x.from, x.to]);
    assert.deepEqual(all, [
      ['anyoneConfirms', null, true, false], ['confirmOverrides', 'Bob Fictional', 'inherit', 'yes'], ['confirmOverrides', 'Eve Outsider', 'inherit', 'yes'], ['confirmOverrides', 'Frank Fictional', 'inherit', 'no'],
    ]);
    // Bob again Yes (no change) and Eve to No: only Eve's change is kept and stored.
    ok(await setPerson(h, f, FRANK, { [f.mid('Bob')]: 'yes', [f.mid('Eve')]: 'no' }));
    assert.deepEqual((await rights(h, f)).filter(([n]) => n === 'Bob Fictional' || n === 'Eve Outsider'), [['Bob Fictional', 'yes', true], ['Eve Outsider', 'no', false]]);
    assert.deepEqual((await personHistory(h, f)).slice(3), [['Eve Outsider', 'yes', 'no']]);
    const doc = await stored(h, f);
    assert.deepEqual(Object.fromEntries(Object.entries(doc.groupSettings.perMember.confirmOverrides).map(([id, o]) => [id, o.value])),
      { [f.mid('Bob')]: 'yes', [f.mid('Eve')]: 'no', [f.mid('Frank')]: 'no' });
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

