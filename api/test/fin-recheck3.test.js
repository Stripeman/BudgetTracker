'use strict';
// Financial recheck of 53cf181 (N-1 to N-4 and the personal-defaults note). Every expected value is
// computed by hand in the comments. All people, accounts and amounts are fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const FRANK = Object.freeze({ userId: 'g-frank', email: 'frank@example.com', name: 'Frank Fictional' });
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const who = (w) => (typeof w === 'string' ? { as: w } : { user: w });

// Alice owner, Bob member, Carol viewer, Frank manager, Eve member, Dana a shared contact.
async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Recheck Three', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
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

describe('N-4: "Anyone who can confirm payments" says plainly that it includes the person who paid', () => {
  test('both settings that offer it return the option\'s explanation "This includes the person who paid."; no other option carries one', async () => {
    const h = harness();
    const f = await fixture(h);
    const settings = (await view(h, f)).groupSettings.settings;
    const explained = settings.flatMap((s) => (s.options || []).filter((o) => o.explanation).map((o) => [s.key, o.value, o.explanation]));
    assert.deepEqual(explained, [
      ['withdrawPayments', 'confirmers', 'This includes the person who paid.'],
      ['settleDisputes', 'confirmers', 'This includes the person who paid.'],
    ]);
  });
});

const act = (h, f, w, action, body) => G(h, f, w, 'POST', { query: { action }, body });
const setSettings = (h, f, w, changes) => act(h, f, w, 'settings', { changes });
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });
const addExpense = async (h, f, w, body) => ok(await G(h, f, w, 'POST', { body }), 201).expense;
const settle = async (h, f, w, body) => ok(await act(h, f, w, 'settle', body), 201).settlement;

describe('N-3: "Keep who owes whom" counts a reported payment only up to what is owed, like the suggestions', () => {
  // 90.00 paid by Alice, shared by Alice, Bob and Carol: 30.00 each. Bob owes Alice 30.00, Carol 30.00.
  async function dinner() {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, carol } = f.refs;
    await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '90.00', payers: [{ ref: alice }], split: equal(alice, bob, carol) });
    return { h, f, alice, bob, carol };
  }
  const tables = async (x) => { const t = (await view(x.h, x.f)).balances.find((b) => b.currency === 'EUR'); const pairs = (l) => l.map((p) => [p.from, p.to, p.amount]); return { direct: pairs(t.direct), suggestions: pairs(t.suggestions) }; };

  test('Bob reports 50.00 against his 30.00 debt: both views show only Carol pays Alice 30.00, never Alice pays Bob', async () => {
    const x = await dinner();
    await settle(x.h, x.f, 'bob', { from: x.bob, to: x.alice, amount: '50.00' });
    assert.deepEqual(await tables(x), { direct: [[x.carol, x.alice, '30.00']], suggestions: [[x.carol, x.alice, '30.00']] });
  });

  test('a report below the debt counts in full; two reports count in order, the second only up to what is left', async () => {
    const x = await dinner();
    await settle(x.h, x.f, 'bob', { from: x.bob, to: x.alice, amount: '10.00' });
    // 30.00 − 10.00 = 20.00 left from Bob; Carol 30.00.
    assert.deepEqual((await tables(x)).direct, [[x.bob, x.alice, '20.00'], [x.carol, x.alice, '30.00']]);
    const y = await dinner();
    await settle(y.h, y.f, 'bob', { from: y.bob, to: y.alice, amount: '20.00' });
    await settle(y.h, y.f, 'bob', { from: y.bob, to: y.alice, amount: '20.00' });
    // 20.00 counts in full, the second only up to the 10.00 left: Bob owes nothing more.
    assert.deepEqual((await tables(y)).direct, [[y.carol, y.alice, '30.00']]);
  });

  test('with reported payments not counted (setting e off), the direct view counts confirmed payments only', async () => {
    const x = await dinner();
    await settle(x.h, x.f, 'bob', { from: x.bob, to: x.alice, amount: '50.00' });
    ok(await setSettings(x.h, x.f, 'alice', { countReported: false }));
    assert.deepEqual((await tables(x)).direct, [[x.bob, x.alice, '30.00'], [x.carol, x.alice, '30.00']]);
  });
});

const account = async (h, f, w, body) => ok(await h.call('accounts', 'POST', { ...who(w), query: f.q, body: { type: 'cash', currency: 'EUR', ...body } }), 201).account;
const accountNow = async (h, f, w, id) => ok(await h.call('accounts', 'GET', { ...who(w), query: f.q })).accounts.find((a) => a.id === id);
const summary = async (h, f, w, accountId) => {
  const s = ok(await h.call('transactions', 'GET', { ...who(w), query: { ...f.q, ...(accountId ? { accountId } : {}) } })).summary.find((x) => x.currency === 'EUR');
  return s ? { spending: s.gross, outstanding: s.receivable } : { spending: '0.00', outstanding: '0.00' };
};
const netOf = async (h, f, name) => (await view(h, f)).balances.find((b) => b.currency === 'EUR').rows.find((r) => r.name === name).net;

describe('N-2: entries the person can no longer change but still sees are left and kept out of their totals', () => {
  test('Bob, made a viewer on his former purse, brings his part up to date on his Tin: his 30.00 share counts once', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, carol } = f.refs;
    // Bob records on his purse (100.00). 90.00 paid by Alice, shared by Alice, Bob and Carol: Bob's share
    // 30.00 is spending, owed 30.00, no money moved.
    const purse = await account(h, f, 'bob', { name: 'Bob Purse', openingBalance: '100.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: purse.id }));
    await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '90.00', payers: [{ ref: alice }], split: equal(alice, bob, carol) });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    // He shares the purse; Alice closes it; Bob chooses his Tin (50.00) while it is closed, so nothing moves.
    ok(await h.call('accounts', 'PATCH', { as: 'bob', query: f.q, body: { accountId: purse.id, revision: (await accountNow(h, f, 'bob', purse.id)).revision, visibility: 'shared', confirmShare: true } }));
    ok(await h.call('accounts', 'POST', { as: 'alice', query: { ...f.q, action: 'close' }, body: { accountId: purse.id, revision: (await accountNow(h, f, 'alice', purse.id)).revision, reason: 'Closing' } }));
    const tin = await account(h, f, 'bob', { name: 'Bob Tin', openingBalance: '50.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: tin.id }));
    // Alice makes Bob a viewer and reopens the purse: Bob still sees it but can no longer change it.
    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.mid('Bob'), role: 'viewer' } }));
    ok(await h.call('accounts', 'POST', { as: 'alice', query: { ...f.q, action: 'reopen' }, body: { accountId: purse.id, revision: (await accountNow(h, f, 'alice', purse.id)).revision } }));
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    // His part is now on the Tin (share 30.00, owed 30.00); the purse keeps its two entries, left there.
    // Counted once: spending 30.00; outstanding −30.00, his group balance.
    assert.deepEqual(await summary(h, f, 'bob'), { spending: '30.00', outstanding: '-30.00' });
    assert.equal(await netOf(h, f, 'Bob Fictional'), '-30.00');
    const mine = (await view(h, f, 'bob')).expenses[0].myLedger;
    assert.deepEqual([mine.needsReview, mine.formerAccount.reason, mine.formerAccount.left], [false, 'read-only', true]);
    assert.equal((await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`)).value.transactions.filter((t) => t.accountId === purse.id && !t.reversedBy && !t.links.reverses).length, 2, 'kept, never deleted');
  });

  test('entries the person can still change keep counting, even on an account that is now shared: Bob\'s 30.00 share on his shared wallet', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, carol } = f.refs;
    const wallet = await account(h, f, 'bob', { name: 'Bob Wallet', openingBalance: '100.00' });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR', accountId: wallet.id }));
    await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '90.00', payers: [{ ref: alice }], split: equal(alice, bob, carol) });
    ok(await act(h, f, 'bob', 'ledger', { currency: 'EUR' }));
    ok(await h.call('accounts', 'PATCH', { as: 'bob', query: f.q, body: { accountId: wallet.id, revision: (await accountNow(h, f, 'bob', wallet.id)).revision, visibility: 'shared', confirmShare: true } }));
    // Bob is still a member who may change his own entries there: his 30.00 share is still his spending.
    assert.equal((await summary(h, f, 'bob')).spending, '30.00');
  });
});

describe('N-1: entries that moved real cash stay on the account the money used; only entries that moved no cash follow the link', () => {
  const share = async (h, f, w, id) => ok(await h.call('accounts', 'PATCH', { ...who(w), query: f.q, body: { accountId: id, revision: (await accountNow(h, f, w, id)).revision, visibility: 'shared', confirmShare: true } }));
  const balance = async (h, f, id) => (await accountNow(h, f, 'alice', id)).balance;

  test('the reviewer\'s dinner: after Alice shares her card and chooses a new wallet, the card keeps 775.00 and the wallet 100.00; corrections land where the money went', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, carol, dana } = f.refs;
    // Alice records on her card (1000.00). A 300.00 dinner she paid, shared by Alice, Bob, Carol and Dana:
    // 75.00 each. Card: −75.00 (her share) −225.00 (lent) = 700.00. Bob pays her 75.00 back: 775.00.
    // Spending 75.00; outstanding 225.00 − 75.00 = 150.00 (her group balance: 300 − 75 − 75).
    const card = await account(h, f, 'alice', { name: 'Alice Card', openingBalance: '1000.00' });
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR', accountId: card.id }));
    const dinner = await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '300.00', payers: [{ ref: alice }], split: equal(alice, bob, carol, dana) });
    await settle(h, f, 'alice', { from: bob, to: alice, amount: '75.00' });
    assert.deepEqual([await balance(h, f, card.id), await summary(h, f, 'alice')], ['775.00', { spending: '75.00', outstanding: '150.00' }]);
    // She shares the card and chooses a new wallet (100.00): nothing that moved cash moves.
    await share(h, f, 'alice', card.id);
    const wallet = await account(h, f, 'alice', { name: 'Alice Wallet', openingBalance: '100.00' });
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR', accountId: wallet.id }));
    assert.deepEqual([await balance(h, f, card.id), await balance(h, f, wallet.id), await summary(h, f, 'alice')], ['775.00', '100.00', { spending: '75.00', outstanding: '150.00' }]);
    const v = await view(h, f, 'alice');
    assert.deepEqual([v.expenses[0].myLedger.needsReview, v.settlements[0].myLedger.needsReview], [false, false], 'kept where the money moved, nothing to review');
    // Bob sees the shared card, but its amounts are Alice's: his outstanding stays 0.00 (F2 privacy).
    assert.equal((await summary(h, f, 'bob')).outstanding, '0.00');
    // Corrected to 200.00 (50.00 each): the card, where the money went, now shows 1000 − 200 + 75 = 875.00.
    // Spending 50.00; outstanding 150.00 − 75.00 = 75.00.
    const d1 = (await view(h, f)).expenses.find((e) => e.id === dinner.id);
    ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: d1.id, revision: d1.revision, amount: '200.00', payers: [{ ref: alice }], split: equal(alice, bob, carol, dana), reason: 'Bill was 200' } }));
    assert.deepEqual([await balance(h, f, card.id), await balance(h, f, wallet.id), await summary(h, f, 'alice')], ['875.00', '100.00', { spending: '50.00', outstanding: '75.00' }]);
    // Voided: the card is 1000 + 75 = 1075.00; spending 0.00; outstanding −75.00 (she owes Bob's 75.00 back).
    const d2 = (await view(h, f)).expenses.find((e) => e.id === dinner.id);
    ok(await act(h, f, 'alice', 'void', { expenseId: d2.id, revision: d2.revision, reason: 'Duplicate' }));
    assert.deepEqual([await balance(h, f, card.id), await balance(h, f, wallet.id), await summary(h, f, 'alice')], ['1075.00', '100.00', { spending: '0.00', outstanding: '-75.00' }]);
    assert.deepEqual([await netOf(h, f, 'Alice Fictional'), await netOf(h, f, 'Bob Fictional')], ['-75.00', '75.00']);
  });

  test('a share someone else paid moved no cash, so it follows the link: Alice\'s 20.00 share of Bob\'s taxi moves to her wallet', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    // 40.00 paid by Bob, shared by Alice and Bob: Alice's share 20.00 is spending, owed 20.00, no money moved.
    const card = await account(h, f, 'alice', { name: 'Alice Card', openingBalance: '1000.00' });
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR', accountId: card.id }));
    await addExpense(h, f, 'bob', { description: 'Fictional taxi', amount: '40.00', payers: [{ ref: bob }], split: equal(alice, bob) });
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR' }));
    await share(h, f, 'alice', card.id);
    assert.equal((await view(h, f, 'alice')).expenses[0].myLedger.needsReview, true, 'needs an account of her own until she chooses one');
    const wallet = await account(h, f, 'alice', { name: 'Alice Wallet', openingBalance: '100.00' });
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR', accountId: wallet.id }));
    // The pair is reversed on the card and recorded on the wallet: both balances unchanged (1000.00, 100.00).
    const onWallet = ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: wallet.id } })).transactions.map((t) => [t.kind, t.amount]).sort();
    assert.deepEqual(onWallet, [['expense', '-20.00'], ['payable', '20.00']]);
    assert.deepEqual([await balance(h, f, card.id), await balance(h, f, wallet.id), await summary(h, f, 'alice')], ['1000.00', '100.00', { spending: '20.00', outstanding: '-20.00' }]);
    assert.equal((await view(h, f, 'alice')).expenses[0].myLedger.needsReview, false);
  });
});

describe('Note on incomplete figures: until an account is chosen, a part the totals leave out says so', () => {
  test('Alice removes her card before choosing a new one: her dinner needs review, the note says her totals leave it out, and they read 0.00', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, carol, dana } = f.refs;
    const card = await account(h, f, 'alice', { name: 'Alice Card', openingBalance: '1000.00' });
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR', accountId: card.id }));
    await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '300.00', payers: [{ ref: alice }], split: equal(alice, bob, carol, dana) });
    ok(await h.call('accounts', 'DELETE', { as: 'alice', query: f.q, body: { accountId: card.id, reason: 'Card cancelled' } }));
    const mine = (await view(h, f, 'alice')).expenses[0].myLedger;
    assert.equal(mine.needsReview, true);
    assert.match(mine.note, /an account that no longer exists\. Choose a private account of yours to record it there\. Until you do, your totals leave this part out\./);
    // The removed card counts nowhere: spending 0.00, outstanding 0.00 until she chooses an account.
    assert.deepEqual(await summary(h, f, 'alice'), { spending: '0.00', outstanding: '0.00' });
  });

  test('a part that still counts, on a card Alice shared, needs an account but does not say the totals leave it out: spending 20.00, outstanding −20.00', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    const card = await account(h, f, 'alice', { name: 'Alice Card', openingBalance: '1000.00' });
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR', accountId: card.id }));
    // 40.00 paid by Bob, shared by Alice and Bob: her share 20.00, owed 20.00, no money moved.
    await addExpense(h, f, 'bob', { description: 'Fictional taxi', amount: '40.00', payers: [{ ref: bob }], split: equal(alice, bob) });
    ok(await act(h, f, 'alice', 'ledger', { currency: 'EUR' }));
    ok(await h.call('accounts', 'PATCH', { as: 'alice', query: f.q, body: { accountId: card.id, revision: (await accountNow(h, f, 'alice', card.id)).revision, visibility: 'shared', confirmShare: true } }));
    const mine = (await view(h, f, 'alice')).expenses[0].myLedger;
    assert.equal(mine.needsReview, true);
    assert.doesNotMatch(mine.note, /totals leave/);
    assert.deepEqual(await summary(h, f, 'alice'), { spending: '20.00', outstanding: '-20.00' });
  });
});

describe('Personal defaults on the server: a request without payer or split takes the caller\'s own defaults, else the group\'s', () => {
  const prefs = (h, w, body) => h.call('preferences', 'PUT', { ...who(w), body });
  const amounts = (e) => [e.payers.map((p) => [p.ref, p.amount]), e.shares.map((s) => [s.ref, s.amount])];

  test('Bob\'s own "Only me": his 60.00 is his alone; Alice, with no defaults of her own, splits 60.00 among all six (10.00 each)', async () => {
    const h = harness();
    const f = await fixture(h);
    ok(await prefs(h, 'bob', { groupSplitWho: 'me' }));
    const mine = await addExpense(h, f, 'bob', { description: 'Fictional snack', amount: '60.00' });
    assert.deepEqual(amounts(mine), [[[f.refs.bob, '60.00']], [[f.refs.bob, '60.00']]]);
    // Six active people (Alice, Bob, Carol, Frank, Eve and Dana): 60.00 / 6 = 10.00 each, paid by Alice.
    const hers = await addExpense(h, f, 'alice', { description: 'Fictional lunch', amount: '60.00' });
    assert.deepEqual(amounts(hers), [[[f.refs.alice, '60.00']], Object.values(f.refs).map((ref) => [ref, '10.00'])]);
  });

  test('Bob\'s own "nobody paid" or "by shares" refuses a request that leaves the payer or the split out, although the group\'s defaults would not', async () => {
    const h = harness();
    const f = await fixture(h);
    ok(await prefs(h, 'bob', { groupPaidBy: 'nobody' }));
    assert.equal((await G(h, f, 'bob', 'POST', { body: { description: 'Fictional tea', amount: '6.00' } })).status, 400);
    assert.equal((await G(h, f, 'bob', 'POST', { body: { description: 'Fictional tea', amount: '6.00', payers: [{ ref: f.refs.bob }] } })).status, 201, 'with a payer given it is accepted');
    ok(await prefs(h, 'bob', { groupPaidBy: null, groupSplitMethod: 'shares' }));
    assert.equal((await G(h, f, 'bob', 'POST', { body: { description: 'Fictional tea', amount: '6.00' } })).status, 400);
  });

  test('Eve\'s own "everyone" wins over the group\'s "only the person adding it"; Bob, with none of his own, follows the group', async () => {
    const h = harness();
    const f = await fixture(h);
    ok(await setSettings(h, f, 'alice', { splitWho: 'me' }));
    ok(await prefs(h, 'eve', { groupSplitWho: 'everyone' }));
    const eves = await addExpense(h, f, 'eve', { description: 'Fictional cake', amount: '60.00' });
    assert.deepEqual(amounts(eves)[1], Object.values(f.refs).map((ref) => [ref, '10.00']));
    const bobs = await addExpense(h, f, 'bob', { description: 'Fictional juice', amount: '60.00' });
    assert.deepEqual(amounts(bobs)[1], [[f.refs.bob, '60.00']]);
  });
});
