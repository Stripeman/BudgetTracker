'use strict';
// BT-006-05 Move an entry to another account (Terry, 2026-09-14: "i should be able to move a transaction
// from one account to the next if i accidently choose the wrong account in the first place").
// `POST /api/transactions?action=move { transactionId, revision, toAccountId, reason }` re-points ONE
// entry (or one leg of a transfer, with the other leg's counterpart) in one ETag-guarded write, keeping
// an amendment with before/after, who, when and why (BT-001-05). Every expected value below is worked
// out by hand in the comments. All people, accounts and amounts are fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household, merchant } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected, JSON.stringify(res.body)); return res.body; };
const move = (h, q, as, body) => h.call('transactions', 'POST', { as, query: { ...q, action: 'move' }, body });
const moveOf = (t, toAccountId, extra = {}) => ({ transactionId: t.id, revision: t.revision, toAccountId, reason: 'Wrong account', ...extra });
const account = async (h, q, as, body) => ok(await h.call('accounts', 'POST', { as, query: q, body }), 201).account;
const txs = async (h, q, as, body) => ok(await h.call('transactions', 'POST', { as, query: q, body }), 201).transactions;
const balances = async (h, q, as) => Object.fromEntries(ok(await h.call('accounts', 'GET', { as, query: q })).accounts.map((a) => [a.name, a.balance]));
const listOf = async (h, q, as, extra = {}) => ok(await h.call('transactions', 'GET', { as, query: { ...q, ...extra } }));
const historyOf = (h, q, as, id) => h.call('transactions', 'GET', { as, query: { ...q, action: 'history', transactionId: id } });
const auditOf = async (h, q, as) => ok(await h.call('audit', 'GET', { as, query: q })).entries;
const stored = async (h, wsId) => (await h.storage.getJson(`workspaces/${wsId}/workspace.json`)).value;
const categoryIds = async (h, q) => Object.fromEntries(ok(await h.call('categories', 'GET', { as: 'alice', query: q })).categories.map((c) => [c.name, c.id]));

// Alice's two private EUR accounts. The 40.00 expense went on Checking by mistake:
// Checking 540.00 − 40.00 = 500.00; Wallet 200.00.
async function wrongAccount(h) {
  const f = await household(h);
  const cats = await categoryIds(h, f.q);
  const checking = await account(h, f.q, 'alice', { name: 'Alice Checking', type: 'checking', currency: 'EUR', openingBalance: '540.00' });
  const wallet = await account(h, f.q, 'alice', { name: 'Alice Wallet', type: 'cash', currency: 'EUR', openingBalance: '200.00' });
  const [entry] = await txs(h, f.q, 'alice', { accountId: checking.id, kind: 'expense', amount: '40.00', categoryId: cats.Groceries, notes: 'Fictional groceries' });
  return { ...f, cats, checking, wallet, entry };
}

describe('BT-006-05 moving an entry: balances, totals, forecasts and budgets follow', () => {
  test('A 500.00 and B 200.00; moving the 40.00 expense from A to B gives A 540.00 and B 160.00', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    const before = await balances(h, f.q, 'alice');
    assert.deepEqual([before['Alice Checking'], before['Alice Wallet']], ['500.00', '200.00']);
    const out = ok(await move(h, f.q, 'alice', moveOf(f.entry, f.wallet.id)));
    assert.equal(out.transactions.length, 1);
    const moved = out.transactions[0];
    assert.deepEqual([moved.id, moved.accountId, moved.accountName, moved.amount, moved.revision, moved.amendmentCount], [f.entry.id, f.wallet.id, 'Alice Wallet', '-40.00', 2, 1]);
    const after = await balances(h, f.q, 'alice');
    // 500.00 + 40.00 = 540.00; 200.00 − 40.00 = 160.00. Joint and Alice Savings are untouched.
    assert.deepEqual([after['Alice Checking'], after['Alice Wallet'], after.Joint, after['Alice Savings']], ['540.00', '160.00', before.Joint, before['Alice Savings']]);
    assert.equal((await listOf(h, f.q, 'alice', { accountId: f.checking.id })).total, 0);
    assert.deepEqual((await listOf(h, f.q, 'alice', { accountId: f.wallet.id })).transactions.map((t) => t.id), [f.entry.id]);
  });

  test('spending totals and the category summary do not change; the forecast starts from the new balances', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    // Alice sees Joint's 82.40 grocery (no category) and her 40.00: spent 122.40; Groceries alone 40.00.
    const spent = async (extra = {}) => (await listOf(h, f.q, 'alice', extra)).summary.find((s) => s.currency === 'EUR').gross;
    assert.deepEqual([await spent(), await spent({ categoryId: f.cats.Groceries })], ['122.40', '40.00']);
    ok(await move(h, f.q, 'alice', moveOf(f.entry, f.wallet.id)));
    assert.deepEqual([await spent(), await spent({ categoryId: f.cats.Groceries })], ['122.40', '40.00']);
    const { forecast } = ok(await h.call('forecast', 'GET', { as: 'alice', query: { ...f.q, horizon: '30' } }));
    const start = (name) => forecast.accounts.find((a) => a.name === name).start;
    assert.deepEqual([start('Alice Checking'), start('Alice Wallet')], ['540.00', '160.00']);
  });

  test('budgets count the entry where it now is: a shared budget only while it is on a shared account', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    const lines = [{ categoryId: f.cats.Groceries, amount: '400.00' }];
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Shared food', scope: 'shared', currency: 'EUR', startDate: '2026-01-01', lines, confirmBackdate: true } }), 201);
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'My food', scope: 'private', currency: 'EUR', startDate: '2026-01-01', lines, confirmBackdate: true } }), 201);
    const actual = async () => Object.fromEntries(ok(await h.call('budgets', 'GET', { as: 'alice', query: f.q })).budgets.map((b) => [b.name, b.status.lines[0].actual]));
    // On Alice's private Checking: the shared budget (shared accounts only) 0.00; her own 40.00.
    assert.deepEqual(await actual(), { 'Shared food': '0.00', 'My food': '40.00' });
    const onJoint = ok(await move(h, f.q, 'alice', moveOf(f.entry, f.joint.id))).transactions[0];
    assert.deepEqual(await actual(), { 'Shared food': '40.00', 'My food': '40.00' });
    ok(await move(h, f.q, 'alice', moveOf(onJoint, f.wallet.id)));
    assert.deepEqual(await actual(), { 'Shared food': '0.00', 'My food': '40.00' });
  });
});

describe('BT-006-05 moving one leg of a transfer', () => {
  test('re-points the leg and the other leg\'s counterpart atomically; both keep the move in their history', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    const spare = await account(h, f.q, 'alice', { name: 'Alice Spare', type: 'savings', currency: 'EUR', openingBalance: '0.00' });
    // 100.00 from Checking meant for Spare went to Wallet: Checking 500 − 100 = 400, Wallet 300, Spare 0.
    const [legOut, legIn] = await txs(h, f.q, 'alice', { accountId: f.checking.id, kind: 'transfer', amount: '100.00', transfer: { toAccountId: f.wallet.id } });
    let b = await balances(h, f.q, 'alice');
    assert.deepEqual([b['Alice Checking'], b['Alice Wallet'], b['Alice Spare']], ['400.00', '300.00', '0.00']);
    const out = ok(await move(h, f.q, 'alice', moveOf(legIn, spare.id))).transactions;
    const [movedLeg, otherLeg] = [out.find((t) => t.id === legIn.id), out.find((t) => t.id === legOut.id)];
    assert.deepEqual([movedLeg.accountId, movedLeg.counterpartAccountId, movedLeg.revision], [spare.id, f.checking.id, 2]);
    assert.deepEqual([otherLeg.accountId, otherLeg.counterpartAccountId, otherLeg.revision], [f.checking.id, spare.id, 2]);
    b = await balances(h, f.q, 'alice');
    // Wallet 300 − 100 = 200; Spare 0 + 100 = 100; Checking stays 400.
    assert.deepEqual([b['Alice Checking'], b['Alice Wallet'], b['Alice Spare']], ['400.00', '200.00', '100.00']);
    const inHist = ok(await historyOf(h, f.q, 'alice', legIn.id)).amendments.at(-1);
    assert.deepEqual([inHist.reason, inHist.changes], ['Wrong account', [{ field: 'accountId', from: f.wallet.id, fromName: 'Alice Wallet', to: spare.id, toName: 'Alice Spare' }]]);
    const outHist = ok(await historyOf(h, f.q, 'alice', legOut.id)).amendments.at(-1);
    assert.deepEqual([outHist.reason, outHist.changes], ['Wrong account', [{ field: 'counterpartAccountId', from: f.wallet.id, fromName: 'Alice Wallet', to: spare.id, toName: 'Alice Spare' }]]);
    const doc = await stored(h, f.ws.id);
    for (const id of [legIn.id, legOut.id]) assert.deepEqual(doc.transactions.find((t) => t.id === id).history.at(-1).fields, ['move']);
    // A transfer needs two different accounts: the out leg cannot join the in leg on Spare.
    code(await move(h, f.q, 'alice', moveOf({ ...legOut, revision: 2 }, spare.id)), 400, 'invalid_transfer');
    ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
  });

  test('moving one leg also needs the change right on the OTHER leg\'s account, not only the moved one', async () => {
    const h = harness();
    const f = await household(h);
    const alice = f.memberId('Alice');
    // Bob lends Alice full rights on his card so she can create (and, for now, edit) a transfer to it.
    const g = ok(await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: alice, capabilities: ['view-transactions', 'create', 'edit'] } }), 201).grant;
    const [legOut, legIn] = ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, kind: 'transfer', amount: '20.00', transfer: { toAccountId: f.bobCard.id } } }), 201).transactions;
    // Bob narrows the grant to no longer include edit; Alice can still edit her OWN leg (she owns that
    // account outright), but the other leg is now his to change, not hers.
    ok(await h.call('grants', 'DELETE', { as: 'bob', query: f.q, body: { grantId: g.id } }));
    ok(await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: alice, capabilities: ['view-transactions', 'create'] } }), 201);
    const spare = await account(h, f.q, 'alice', { name: 'Alice Spare', type: 'savings', currency: 'EUR' });
    const r = code(await move(h, f.q, 'alice', moveOf(legOut, spare.id)), 403, 'forbidden');
    assert.match(r.error.message, /both sides/i);
    // Nothing moved: both legs stay exactly where they were.
    const doc = await stored(h, f.ws.id);
    assert.deepEqual([doc.transactions.find((t) => t.id === legOut.id).accountId, doc.transactions.find((t) => t.id === legIn.id).accountId], [f.aliceSavings.id, f.bobCard.id]);
  });
});

describe('BT-006-05 refusals, each with a plain reason', () => {
  test('different currency, same account, missing reason, stale or missing revision, unknown destination', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    const dollars = await account(h, f.q, 'alice', { name: 'Alice Dollars', type: 'checking', currency: 'USD', openingBalance: '0.00' });
    const cur = code(await move(h, f.q, 'alice', moveOf(f.entry, dollars.id)), 400, 'currency_mismatch');
    assert.match(cur.error.message, /Alice Dollars is in USD/);
    assert.match(cur.error.message, /enter it again on that account/);
    code(await move(h, f.q, 'alice', moveOf(f.entry, f.checking.id)), 400, 'same_account');
    code(await move(h, f.q, 'alice', moveOf(f.entry, f.wallet.id, { reason: '' })), 400, 'reason_required');
    code(await move(h, f.q, 'alice', moveOf(f.entry, f.wallet.id, { reason: '   ' })), 400, 'reason_required');
    code(await move(h, f.q, 'alice', moveOf(f.entry, f.wallet.id, { revision: 7 })), 409, 'stale_revision');
    code(await move(h, f.q, 'alice', { transactionId: f.entry.id, toAccountId: f.wallet.id, reason: 'x' }), 400, 'missing_revision');
    assert.equal((await move(h, f.q, 'alice', moveOf(f.entry, 'acc_doesnotexist'))).status, 404);
    // A move changes the account only: any other field is refused, never applied on the side.
    code(await move(h, f.q, 'alice', { ...moveOf(f.entry, f.wallet.id), amount: '1.00' }), 400, 'unknown_field');
    // Nothing changed through all of that.
    const b = await balances(h, f.q, 'alice');
    assert.deepEqual([b['Alice Checking'], b['Alice Wallet']], ['500.00', '200.00']);
    assert.equal((await stored(h, f.ws.id)).transactions.find((t) => t.id === f.entry.id).revision, 1);
  });

  test('reconciled entries, reversed entries and reversals, deleted entries', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    const rec = ok(await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: f.entry.id, revision: 1, status: 'reconciled' } })).transactions[0];
    const r = code(await move(h, f.q, 'alice', moveOf(rec, f.wallet.id)), 409, 'reconciled_locked');
    assert.match(r.error.message, /reconciled/i);
    const [second] = await txs(h, f.q, 'alice', { accountId: f.checking.id, kind: 'expense', amount: '5.00' });
    const rev = ok(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'reverse' }, body: { transactionId: second.id, reason: 'Duplicate' } }), 201).transactions;
    const [original, reversal] = [rev.find((t) => t.id === second.id), rev.find((t) => t.id !== second.id)];
    code(await move(h, f.q, 'alice', moveOf(original, f.wallet.id)), 409, 'reversal_locked');
    code(await move(h, f.q, 'alice', moveOf(reversal, f.wallet.id)), 409, 'reversal_locked');
    const [third] = await txs(h, f.q, 'alice', { accountId: f.checking.id, kind: 'expense', amount: '6.00' });
    ok(await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: third.id, revision: 1, reason: 'Entered twice' } }));
    code(await move(h, f.q, 'alice', moveOf({ ...third, revision: 2 }, f.wallet.id)), 409, 'deleted');
  });

  test('closed or removed destination, closed source account', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    const closed = await account(h, f.q, 'alice', { name: 'Alice Old Bank', type: 'checking', currency: 'EUR' });
    ok(await h.call('accounts', 'POST', { as: 'alice', query: { ...f.q, action: 'close' }, body: { accountId: closed.id, revision: closed.revision, reason: 'Moved banks' } }));
    const c = code(await move(h, f.q, 'alice', moveOf(f.entry, closed.id)), 409, 'account_closed');
    assert.match(c.error.message, /Alice Old Bank is closed/);
    const removed = await account(h, f.q, 'alice', { name: 'Alice Mistake', type: 'cash', currency: 'EUR' });
    ok(await h.call('accounts', 'DELETE', { as: 'alice', query: f.q, body: { accountId: removed.id, reason: 'Created by mistake' } }));
    code(await move(h, f.q, 'alice', moveOf(f.entry, removed.id)), 409, 'account_removed');
    // A closed account takes no NEW entries, but moving an entry OFF it is a correction like any other
    // edit already allowed there (PATCH does not block edits on a closed account either): the entry
    // simply stops counting on the closed account and starts counting on the destination.
    const gone = await account(h, f.q, 'alice', { name: 'Alice Closing', type: 'cash', currency: 'EUR', openingBalance: '10.00' });
    const [onGone] = await txs(h, f.q, 'alice', { accountId: gone.id, kind: 'expense', amount: '1.00' });
    const g = ok(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).accounts.find((a) => a.id === gone.id);
    ok(await h.call('accounts', 'POST', { as: 'alice', query: { ...f.q, action: 'close' }, body: { accountId: gone.id, revision: g.revision, reason: 'Done' } }));
    const movedOff = ok(await move(h, f.q, 'alice', moveOf(onGone, f.wallet.id))).transactions[0];
    assert.equal(movedOff.accountId, f.wallet.id);
    const b = await balances(h, f.q, 'alice');
    // The 1.00 expense no longer counts on Alice Closing, so it returns to its opening balance 10.00.
    // Wallet was untouched by the earlier (refused) moves, so 200.00 − 1.00 = 199.00.
    assert.deepEqual([b['Alice Closing'], b['Alice Wallet']], ['10.00', '199.00']);
  });

  test('a private merchant or private contact never lands on a shared account', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    const corner = await merchant(h, f.q, 'alice', { name: 'Alice Corner Shop' });
    const [withShop] = await txs(h, f.q, 'alice', { accountId: f.checking.id, kind: 'expense', amount: '3.00', payeeId: corner.id });
    const m = code(await move(h, f.q, 'alice', moveOf(withShop, f.joint.id)), 409, 'merchant_not_usable');
    assert.match(m.error.message, /Merchants/);
    ok(await move(h, f.q, 'alice', moveOf(withShop, f.wallet.id)), 200);
    const aunt = ok(await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'private', name: 'Fictional Aunt' } }), 201).contact;
    const [withAunt] = await txs(h, f.q, 'alice', { accountId: f.checking.id, kind: 'expense', amount: '4.00', responsibleRef: aunt.ref });
    code(await move(h, f.q, 'alice', moveOf(withAunt, f.joint.id)), 400, 'private_contact_on_shared');
    ok(await move(h, f.q, 'alice', moveOf(withAunt, f.wallet.id)), 200);
  });

  test('an amount owed entered by hand (owed pair) and an entry recorded from Shared expenses', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    ok(await h.call('group', 'POST', { as: 'alice', query: { ...f.q, action: 'settings' }, body: { changes: { ownedEntries: 'manual' } } }));
    const pair = await txs(h, f.q, 'alice', { accountId: f.checking.id, kind: 'payable', amount: '30.00' });
    assert.equal(pair.length, 2);
    for (const t of pair) code(await move(h, f.q, 'alice', moveOf(t, f.wallet.id)), 409, 'owed_pair_locked');
    // Bob records his part of Alice's 160.00 dinner on his own cash account (BT-009).
    const cash = await account(h, f.q, 'bob', { name: 'Bob Cash', type: 'cash', currency: 'EUR', openingBalance: '500.00' });
    ok(await h.call('group', 'POST', { as: 'bob', query: { ...f.q, action: 'ledger' }, body: { currency: 'EUR', accountId: cash.id } }));
    const refs = { alice: `member:${f.memberId('Alice')}`, bob: `member:${f.memberId('Bob')}` };
    ok(await h.call('group', 'POST', { as: 'alice', query: f.q, body: { description: 'Fictional dinner', amount: '160.00', categoryId: f.cats.Groceries, payers: [{ ref: refs.alice }], split: { method: 'equal', lines: [{ ref: refs.alice }, { ref: refs.bob }] } } }), 201);
    ok(await h.call('group', 'POST', { as: 'bob', query: { ...f.q, action: 'ledger' }, body: { currency: 'EUR' } }));
    const share = (await listOf(h, f.q, 'bob', { accountId: cash.id })).transactions.find((t) => t.kind === 'expense');
    assert.ok(share && share.links.groupExpenseId, 'the share was recorded from Shared expenses');
    const s = code(await move(h, f.q, 'bob', moveOf(share, f.bobCard.id)), 409, 'shared_expense_locked');
    assert.match(s.error.message, /Shared expenses/);
  });
});

describe('BT-006-05 permissions: change right on the entry AND add right on the destination', () => {
  test('owner of both; member own vs others\'; viewer; site admin and outsider; another member\'s private destination', async () => {
    const h = harness();
    const f = await household(h);
    // Alice owns both Joint (shared) and Alice Savings (private).
    const there = ok(await move(h, f.q, 'alice', moveOf(f.grocery, f.aliceSavings.id))).transactions[0];
    const back = ok(await move(h, f.q, 'alice', moveOf(there, f.joint.id))).transactions[0];
    assert.equal(back.revision, 3);
    // Bob may move his own Joint entry to his own card, but not Alice's entry (the default setting).
    const [bobs] = await txs(h, f.q, 'bob', { accountId: f.joint.id, kind: 'expense', amount: '10.00' });
    code(await move(h, f.q, 'bob', moveOf(back, f.bobCard.id)), 403, 'forbidden');
    // Another member's private account is not revealed: 404, with neither its name nor its id.
    for (const [as, t, to, hidden] of [['bob', bobs, f.aliceSavings, 'Alice Savings'], ['alice', back, f.bobCard, 'Bob Card']]) {
      const res = await move(h, f.q, as, moveOf(t, to.id));
      assert.equal(res.status, 404, JSON.stringify(res.body));
      assert.ok(!JSON.stringify(res.body).includes(hidden) && !JSON.stringify(res.body).includes(to.id), 'nothing about the private account');
    }
    ok(await move(h, f.q, 'bob', moveOf(bobs, f.bobCard.id)));
    // Carol (viewer) sees the Joint entry but may not change it; Dave (site admin) and Eve are not members.
    code(await move(h, f.q, 'carol', moveOf(back, f.aliceSavings.id)), 403, 'forbidden');
    for (const as of ['dave', 'eve']) assert.equal((await move(h, f.q, as, moveOf(back, f.joint.id))).status, 404, as);
    // Bob's own Bob Card entry: the secret 250.00 stays hidden from Alice through the move route too.
    assert.equal((await move(h, f.q, 'alice', moveOf(f.secret, f.joint.id))).status, 404);
    const b = await balances(h, f.q, 'alice');
    // Joint 1000.00 − 82.40 = 917.60 (Bob's 10.00 left for his card); Alice Savings 5000.00.
    assert.deepEqual([b.Joint, b['Alice Savings']], ['917.60', '5000.00']);
  });

  test('a grantee needs the add-entries right on the destination; "Any entry" lets a member move others\' shared entries', async () => {
    const h = harness();
    const f = await household(h);
    const alice = f.memberId('Alice');
    ok(await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: alice, capabilities: ['view-balances', 'view-transactions'] } }), 201);
    code(await move(h, f.q, 'alice', moveOf(f.grocery, f.bobCard.id)), 403, 'forbidden');
    ok(await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: alice, capabilities: ['view-transactions', 'create'] } }), 201);
    const moved = ok(await move(h, f.q, 'alice', moveOf(f.grocery, f.bobCard.id))).transactions[0];
    assert.equal(moved.accountId, f.bobCard.id);
    // Workspace setting (f): with "Any entry" a member who can add entries on Joint may change others'.
    const h2 = harness();
    const g = await household(h2);
    code(await move(h2, g.q, 'bob', moveOf(g.grocery, g.bobCard.id)), 403, 'forbidden');
    ok(await h2.call('workspaces', 'PATCH', { as: 'alice', query: { id: g.ws.id }, body: { settings: { memberEditsOthers: 'any' } } }));
    ok(await move(h2, g.q, 'bob', moveOf(g.grocery, g.bobCard.id)));
    // Carol stays a viewer: still refused.
    const [again] = await txs(h2, g.q, 'alice', { accountId: g.joint.id, kind: 'expense', amount: '2.00' });
    code(await move(h2, g.q, 'carol', moveOf(again, g.bobCard.id)), 403, 'forbidden');
  });

  test('two moves of the same revision at once: one wins, the other is told the entry changed', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    const spare = await account(h, f.q, 'alice', { name: 'Alice Spare', type: 'savings', currency: 'EUR' });
    const results = await Promise.all([move(h, f.q, 'alice', moveOf(f.entry, f.wallet.id)), move(h, f.q, 'alice', moveOf(f.entry, spare.id))]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(results.find((r) => r.status === 409).body.error.code, 'stale_revision');
    const b = await balances(h, f.q, 'alice');
    // The 40.00 is on exactly one of them: Wallet 200.00 − 40.00 = 160.00 (Spare 0.00), or Spare
    // 0.00 − 40.00 = −40.00 (Wallet 200.00). Checking 500.00 + 40.00 = 540.00 either way.
    const walletWon = results[0].status === 200;
    assert.deepEqual([b['Alice Checking'], b['Alice Wallet'], b['Alice Spare']], ['540.00', ...(walletWon ? ['160.00', '0.00'] : ['200.00', '-40.00'])]);
  });
});

describe('BT-006-05 history, audit and masking', () => {
  test('moving to the shared account: others see the entry, "moved in", and not the private account it came from', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    assert.ok(!(await listOf(h, f.q, 'bob')).transactions.some((t) => t.id === f.entry.id));
    ok(await move(h, f.q, 'alice', moveOf(f.entry, f.joint.id)));
    assert.ok((await listOf(h, f.q, 'bob')).transactions.some((t) => t.id === f.entry.id), 'Bob now sees it');
    const bobs = ok(await historyOf(h, f.q, 'bob', f.entry.id));
    assert.deepEqual(bobs.amendments.map((a) => [a.by, a.reason, a.changes]), [['Alice Fictional', 'Wrong account', [{ field: 'accountId', from: null, fromName: null, to: f.joint.id, toName: 'Joint' }]]]);
    assert.ok(!JSON.stringify(bobs).includes(f.checking.id) && !JSON.stringify(bobs).includes('Alice Checking'));
    const alices = ok(await historyOf(h, f.q, 'alice', f.entry.id));
    assert.deepEqual(alices.amendments[0].changes, [{ field: 'accountId', from: f.checking.id, fromName: 'Alice Checking', to: f.joint.id, toName: 'Joint' }]);
    const moves = (entries) => entries.filter((e) => e.targetId === f.entry.id && /^transaction\.move/.test(e.action)).map((e) => e.action).sort();
    assert.deepEqual(moves(await auditOf(h, f.q, 'bob')), ['transaction.move-in']);
    assert.deepEqual(moves(await auditOf(h, f.q, 'carol')), ['transaction.move-in']);
    assert.deepEqual(moves(await auditOf(h, f.q, 'alice')), ['transaction.move-in', 'transaction.move-out']);
    const doc = await stored(h, f.ws.id);
    const t = doc.transactions.find((x) => x.id === f.entry.id);
    assert.deepEqual(t.amendments.at(-1).changes, [{ field: 'accountId', from: f.checking.id, to: f.joint.id }]);
    assert.equal(t.amendments.at(-1).by, 'google:g-alice');
    assert.equal(t.updatedBy, 'google:g-alice');
    assert.deepEqual(doc.audit.filter((a) => a.targetId === f.entry.id && /move/.test(a.action)).map((a) => [a.action, a.scope]).sort(),
      [['transaction.move-in', `account:${f.joint.id}`], ['transaction.move-out', `account:${f.checking.id}`]]);
  });

  test('moving off the shared account: others keep only "moved out" and can no longer read the entry', async () => {
    const h = harness();
    const f = await household(h);
    const [bobs] = await txs(h, f.q, 'bob', { accountId: f.joint.id, kind: 'expense', amount: '10.00' });
    ok(await move(h, f.q, 'bob', moveOf(bobs, f.bobCard.id)));
    assert.ok(!(await listOf(h, f.q, 'alice')).transactions.some((t) => t.id === bobs.id));
    assert.equal((await historyOf(h, f.q, 'alice', bobs.id)).status, 404);
    const seen = (await auditOf(h, f.q, 'alice')).filter((e) => e.targetId === bobs.id).map((e) => e.action).sort();
    assert.deepEqual(seen, ['transaction.create', 'transaction.move-out']);
  });

  test('the list says which entries can move, and why not', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    const [rec] = await txs(h, f.q, 'alice', { accountId: f.checking.id, kind: 'expense', amount: '7.00' });
    ok(await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: rec.id, revision: 1, status: 'reconciled' } }));
    const byId = new Map((await listOf(h, f.q, 'alice')).transactions.map((t) => [t.id, t]));
    assert.deepEqual([byId.get(f.entry.id).canMove, byId.get(f.entry.id).moveBlockedReason], [true, null]);
    assert.equal(byId.get(rec.id).canMove, false);
    assert.match(byId.get(rec.id).moveBlockedReason, /reconciled/i);
    const carols = (await listOf(h, f.q, 'carol')).transactions.find((t) => t.id === f.grocery.id);
    assert.deepEqual([carols.canMove, carols.moveBlockedReason], [false, null]);
  });
});

describe('BT-006-05 entries from bills, backups and restores', () => {
  test('an entry recorded from a bill keeps its bill link and the occurrence stays recorded; the bill is unchanged', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    const gym = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Fictional Gym', billType: 'membership', accountId: f.checking.id, amount: '25.00', schedule: { freq: 'monthly', startDate: '2026-09-01' } } }), 201).recurring;
    const [paid] = ok(await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'record' }, body: { recurringId: gym.id, occurrence: '2026-09-01' } }), 201).transactions;
    const moved = ok(await move(h, f.q, 'alice', moveOf(paid, f.wallet.id))).transactions[0];
    assert.deepEqual([moved.accountId, moved.links.recurringId, moved.links.occurrence], [f.wallet.id, gym.id, '2026-09-01']);
    code(await h.call('recurring', 'GET', { as: 'alice', query: { ...f.q, action: 'draft', recurringId: gym.id, occurrence: '2026-09-01' } }), 409, 'already_recorded');
    const bill = ok(await h.call('recurring', 'GET', { as: 'alice', query: f.q })).recurring.find((r) => r.id === gym.id);
    assert.deepEqual([bill.accountId, bill.revision], [f.checking.id, gym.revision]);
    ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
  });

  test('backups accept moved entries; replace brings the entry back where the backup had it; merge changes nothing', async () => {
    const h = harness();
    const f = await wrongAccount(h);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    ok(await move(h, f.q, 'alice', moveOf(f.entry, f.wallet.id)));
    ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
    const preview = (mode) => h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode } });
    const merge = ok(await preview('merge'));
    assert.deepEqual(merge.blockers, []);
    const pv = ok(await preview('replace'));
    assert.deepEqual(pv.blockers, []);
    ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' } }));
    const b = await balances(h, f.q, 'alice');
    // Back as at the backup: Checking 500.00, Wallet 200.00; the moved version is set aside, not dropped.
    assert.deepEqual([b['Alice Checking'], b['Alice Wallet']], ['500.00', '200.00']);
    const doc = await stored(h, f.ws.id);
    assert.ok(doc.superseded.some((s) => s.record.id === f.entry.id && s.record.accountId === f.wallet.id));
  });

  test('a create-new copy never keeps the id of an account that stays behind in a move\'s history', async () => {
    const h = harness();
    const f = await household(h);
    const [bobs] = await txs(h, f.q, 'bob', { accountId: f.bobCard.id, kind: 'expense', amount: '10.00' });
    ok(await move(h, f.q, 'bob', moveOf(bobs, f.joint.id)));
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    const res = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }), 201);
    const copy = await stored(h, res.workspace.id);
    const t = copy.transactions.find((x) => x.id === bobs.id);
    assert.deepEqual(t.amendments.at(-1).changes, [{ field: 'accountId', from: null, to: f.joint.id }]);
    assert.ok(!JSON.stringify(copy).includes(f.bobCard.id), 'Bob Card\'s id is not in the copy');
  });
});
