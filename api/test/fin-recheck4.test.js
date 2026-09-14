'use strict';
// Financial recheck of 41494d1 (FA-1 to FA-3, and the four caveats flagged in the prior report). Every
// expected value is computed by hand in the comments. All people, accounts and amounts are fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const FRANK = Object.freeze({ userId: 'g-frank', email: 'frank@example.com', name: 'Frank Fictional' });
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const who = (w) => (typeof w === 'string' ? { as: w } : { user: w });

// Alice owner, Bob member, Carol viewer, Frank manager, Eve member, Dana a shared contact.
async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Recheck Four', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
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
const view = async (h, f, w = 'alice') => ok(await G(h, f, w, 'GET'));
const act = (h, f, w, action, body) => G(h, f, w, 'POST', { query: { action }, body });
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });
const addExpense = async (h, f, w, body) => ok(await G(h, f, w, 'POST', { body }), 201).expense;
const settle = async (h, f, w, body) => ok(await act(h, f, w, 'settle', body), 201).settlement;
const confirm = (h, f, w, s) => act(h, f, w, 'confirm', { settlementId: s.id, revision: s.revision });
const account = async (h, f, w, body) => ok(await h.call('accounts', 'POST', { ...who(w), query: f.q, body: { type: 'cash', currency: 'EUR', ...body } }), 201).account;
const balanceOf = async (h, f, w, id) => (await ok(await h.call('accounts', 'GET', { ...who(w), query: f.q }))).accounts.find((a) => a.id === id).balance;

describe('FA-1: a first link that would backdate confirmed cash entries needs confirmation first', () => {
  test('Bob\'s hotel share (150.00) confirmed-repaid with no account linked yet: linking a new account with 60.00 refuses without confirmBackdated and describes the amount; confirming lands it at -90.00', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    // 300.00 hotel paid by Alice, split equally: Bob's share 150.00. Bob pays it back and Alice confirms.
    await addExpense(h, f, 'alice', { description: 'Fictional hotel', amount: '300.00', payers: [{ ref: alice }], split: equal(alice, bob) });
    const s = await settle(h, f, 'bob', { from: bob, to: alice, amount: '150.00' });
    ok(await confirm(h, f, 'alice', s));
    // Bob has never linked an account: nothing of his is recorded anywhere yet.
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', openingBalance: '60.00' });
    const refused = await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: wallet.id });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'confirm_backdated');
    assert.match(refused.body.error.message, /1 cash entry totaling -150\.00/);
    assert.deepEqual(refused.body.error.details, { count: 1, amount: '-150.00', amountMinor: -15000, currency: 'EUR' });
    // Nothing changed: the wallet is untouched at 60.00.
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '60.00');
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: wallet.id, confirmBackdated: true }));
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '-90.00');
  });

  test('with only non-cash entries pending (an unpaid share, not yet settled) the first link needs no confirmation', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    // 90.00 dinner paid by Alice, split equally: Bob's share 45.00, nothing settled yet — a payable, not cash.
    await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '90.00', payers: [{ ref: alice }], split: equal(alice, bob) });
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', openingBalance: '60.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: wallet.id }));
    // No cash moved: the wallet keeps its opening balance (share -45.00 and payable +45.00 net to zero).
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '60.00');
  });

  test('several pending cash entries are all counted and summed; confirming records them all', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, carol } = f.refs;
    // Two confirmed payments with nothing linked yet: Bob paid Alice 30.00 (a repayment, confirmed by
    // Alice), and Carol paid Bob 10.00 (recorded by Bob himself, so confirmed at once — a reimbursement).
    const s1 = await settle(h, f, 'bob', { from: bob, to: alice, amount: '30.00' });
    ok(await confirm(h, f, 'alice', s1));
    const s2 = await settle(h, f, 'bob', { from: carol, to: bob, amount: '10.00' });
    assert.equal(s2.status, 'confirmed', 'recorded by its own receiver, confirmed at once');
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', openingBalance: '100.00' });
    const refused = await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: wallet.id });
    assert.equal(refused.status, 409);
    // repayment -30.00 + reimbursement +10.00 = 2 entries, net -20.00.
    assert.deepEqual(refused.body.error.details, { count: 2, amount: '-20.00', amountMinor: -2000, currency: 'EUR' });
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '100.00', 'untouched by the refusal');
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: wallet.id, confirmBackdated: true }));
    // 100.00 - 30.00 + 10.00 = 80.00.
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '80.00');
  });

  test('relinking to a different account, or bringing entries up to date without choosing an account, is never blocked by this', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    await addExpense(h, f, 'alice', { description: 'Fictional hotel', amount: '300.00', payers: [{ ref: alice }], split: equal(alice, bob) });
    const s = await settle(h, f, 'bob', { from: bob, to: alice, amount: '150.00' });
    ok(await confirm(h, f, 'alice', s));
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', openingBalance: '60.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: wallet.id, confirmBackdated: true }));
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '-90.00');
    // Switching to a second account: the repayment already moved real cash, so it stays anchored on the
    // wallet (financial recheck N-1) — it does not follow the link, and needs no confirmation either way.
    const spare = await account(h, f, 'bob', { name: 'Bob Spare', openingBalance: '0.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: spare.id }));
    assert.deepEqual([await balanceOf(h, f, 'bob', wallet.id), await balanceOf(h, f, 'bob', spare.id)], ['-90.00', '0.00']);
    // Bringing an existing record up to date, or refreshing the whole currency, needs no confirmation either.
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
  });

  test('creating a cash-moving expense with an inline ledger is the caller\'s own current action, not a surprise: no confirmation needed', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', openingBalance: '80.00' });
    // 50.00 paid by Bob, split equally with Alice: his share 25.00, lent 25.00 (an advance, cash) —
    // linked for the first time in the same request that creates it.
    const e = await addExpense(h, f, 'bob', { description: 'Fictional cab', amount: '50.00', payers: [{ ref: bob }], split: equal(bob, alice), ledger: { accountId: wallet.id } });
    assert.equal(e.myLedger.accountId, wallet.id);
    // 80.00 - 25.00 (share) - 25.00 (lent) = 30.00.
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '30.00');
    // Confirming an existing reported payment with an inline ledger works the same way.
    const s = await settle(h, f, 'alice', { from: alice, to: bob, amount: '10.00' });
    ok(await act(h, f, 'bob', 'confirm', { settlementId: s.id, revision: s.revision, ledger: { accountId: wallet.id } }));
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '40.00');
    // Naming a specific record's id on the general ledger action is the same: Bob explicitly asks for
    // this expense's part to go on a (still unlinked-for-EUR) new account, so it is exempt too.
    const spare = await account(h, f, 'bob', { name: 'Bob Spare', openingBalance: '0.00' });
    ok(await act(h, f, 'bob', 'ledger', { expenseId: e.id, accountId: spare.id }));
  });

  test('cash already recorded through an increment-1 per-record link is not new backdating: the first currency-wide link excludes it', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', openingBalance: '80.00' });
    const e = await addExpense(h, f, 'alice', { description: 'Fictional cab', amount: '50.00', payers: [{ ref: bob }], split: equal(bob, alice) });
    // Plant the entries exactly as an increment-1 per-record link would have written them: Bob paid
    // 50.00, his share is 25.00 — expense -25.00, advance -25.00, already live on his wallet.
    const name = `workspaces/${f.ws.id}/workspace.json`;
    const { value: doc } = await h.storage.getJson(name);
    const { newEntry } = require('../_shared/entries');
    const at = '2026-01-01T00:00:00.000Z';
    const rec = doc.groupExpenses.find((x) => x.id === e.id);
    rec.ledgerLinks = [{ subject: 'google:g-bob', accountId: wallet.id, linkedAt: at, endedAt: null }];
    doc.transactions.push(
      newEntry({ accountId: wallet.id, currency: 'EUR', kind: 'expense', amountMinor: -2500, date: rec.date, links: { groupExpenseId: e.id }, by: 'google:g-bob', at }),
      newEntry({ accountId: wallet.id, currency: 'EUR', kind: 'advance', amountMinor: -2500, date: rec.date, links: { groupExpenseId: e.id }, by: 'google:g-bob', at }),
    );
    await h.storage.putJson(name, doc);
    // Bob has never set up a currency-wide link. His first one, to a DIFFERENT account, is not blocked
    // by this record: it already has live entries (from the legacy link), so nothing new backdates. The
    // cash already moved through the wallet, so it stays anchored there (financial recheck N-1) rather
    // than following the new link — the wallet is unchanged at 30.00 and the spare stays untouched.
    const spare = await account(h, f, 'bob', { name: 'Bob Spare', openingBalance: '0.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: spare.id }));
    assert.deepEqual([await balanceOf(h, f, 'bob', wallet.id), await balanceOf(h, f, 'bob', spare.id)], ['30.00', '0.00']);
  });

  test('once a currency is already linked, other pending unsynced cash never blocks a further relink (the check is only for a first link)', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    const walletA = await account(h, f, 'bob', { name: 'Bob Wallet A', openingBalance: '0.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: walletA.id }));
    // Alice reports and confirms (she is the receiver, so it is confirmed at once) a payment from Bob;
    // only Alice's own entries are synced by her call, so Bob's repayment sits unsynced (zero live
    // entries of his), even though his currency is already linked.
    const s = await settle(h, f, 'alice', { from: bob, to: alice, amount: '15.00' });
    assert.equal(s.status, 'confirmed');
    const bobsView = (await view(h, f, 'bob')).settlements.find((x) => x.id === s.id);
    assert.deepEqual([bobsView.myLedger.needsReview, bobsView.myLedger.entries], [true, []], 'nothing of Bob\'s recorded for it yet');
    // Bob relinks to a different account: since he already has an active link, this is not treated as a
    // first link, and this unrelated pending repayment does not block it.
    const walletB = await account(h, f, 'bob', { name: 'Bob Wallet B', openingBalance: '0.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: walletB.id }));
    // The repayment is brand new to Bob's ledger and follows the currently linked account: -15.00.
    assert.equal(await balanceOf(h, f, 'bob', walletB.id), '-15.00');
  });

  test('an inline ledger on create, settle or confirm can still surface OTHER pre-existing pending cash, and confirmBackdated on the same request resolves it', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    // An unrelated confirmed repayment from Bob to Alice, before Bob has ever linked an account.
    const older = await settle(h, f, 'bob', { from: bob, to: alice, amount: '12.00' });
    ok(await confirm(h, f, 'alice', older));
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', openingBalance: '90.00' });
    // Creating a brand-new expense with an inline ledger: its own share is exempt, but the older
    // repayment is not — refused without confirmBackdated, accepted with it.
    const body = { description: 'Fictional snack', amount: '10.00', payers: [{ ref: bob }], split: equal(bob, alice), ledger: { accountId: wallet.id } };
    const refused = await G(h, f, 'bob', 'POST', { body });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'confirm_backdated');
    assert.deepEqual(refused.body.error.details, { count: 1, amount: '-12.00', amountMinor: -1200, currency: 'EUR' });
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '90.00', 'nothing written by the refused create');
    const e = ok(await G(h, f, 'bob', 'POST', { body: { ...body, confirmBackdated: true } }), 201).expense;
    // 90.00 - 5.00 (his own share) - 5.00 (lent for Alice's share) - 12.00 (the older repayment) = 68.00.
    assert.equal(await balanceOf(h, f, 'bob', wallet.id), '68.00');
    assert.equal(e.myLedger.accountId, wallet.id);
  });
});

describe('FA-2 (ties into BT-006-05): Remove says when an account is linked in Shared expenses', () => {
  test('groupLedgerLinked is true only for the owner, only while the link is active, and false once stopped; nobody else ever sees it', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet' });
    const accountsOf = async (w) => ok(await h.call('accounts', 'GET', { ...who(w), query: f.q })).accounts;
    // Before any link: not flagged, though the account already has an opening balance (BT-006-05's
    // hasEntries covers more than a Shared-expenses link).
    const before = (await accountsOf('bob')).find((a) => a.id === wallet.id);
    assert.equal(before.groupLedgerLinked, false);
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: wallet.id }));
    const linked = (await accountsOf('bob')).find((a) => a.id === wallet.id);
    assert.equal(linked.groupLedgerLinked, true);
    // Alice (a manager elsewhere in this workspace) never learns that Bob's private account is linked.
    assert.equal(ok(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).accounts.some((a) => a.id === wallet.id), false, 'not even visible to her');
    // Even someone Bob grants view-transactions on the SAME account sees its entries, but not this.
    ok(await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: wallet.id, memberId: f.mid('Alice'), capabilities: ['view-transactions'] } }), 201);
    const granted = ok(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).accounts.find((a) => a.id === wallet.id);
    assert.deepEqual([granted.hasEntries, granted.groupLedgerLinked], [true, undefined], 'has entries is a general fact; groupLedgerLinked is private to the owner');
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: null }));
    const stopped = (await accountsOf('bob')).find((a) => a.id === wallet.id);
    assert.equal(stopped.groupLedgerLinked, false, 'the link is ended, not merely dormant');
  });

  test('the Remove dialog data: an account with an active link is flagged; one that never linked, or whose link has ended, is not', async () => {
    const h = harness();
    const f = await fixture(h);
    const linked = await account(h, f, 'bob', { name: 'Bob Wallet' });
    const never = await account(h, f, 'bob', { name: 'Bob Spare' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: linked.id }));
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: null }));
    const accountsOf = async () => ok(await h.call('accounts', 'GET', { as: 'bob', query: f.q })).accounts;
    const list = await accountsOf();
    assert.deepEqual([list.find((a) => a.id === linked.id).groupLedgerLinked, list.find((a) => a.id === never.id).groupLedgerLinked], [false, false]);
    // Now genuinely active, on the spare account.
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: never.id }));
    assert.equal((await accountsOf()).find((a) => a.id === never.id).groupLedgerLinked, true);
  });
});
