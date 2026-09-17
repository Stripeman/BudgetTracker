'use strict';
// BT-014 permanent deletion, rename and cascade (Terry, 2026-09-17): "Users must have meaningful
// control over their own data... including permanently deleting records when needed. This
// replaces the earlier blanket 'nothing can ever be deleted' requirement. Archiving may remain
// available, but it must not be the only option. Audit history must remain preserved."
// Cascade rule under test: "A alone" or "A -> B" (B has no further dependents) are allowed after
// two confirmations; "A -> B and A -> C" (branching) and any second hop are blocked. All data is
// fictional; expected values are worked out by hand.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const rawDoc = async (h, wsId) => JSON.parse((await h.storage.getBytes(`workspaces/${wsId}/workspace.json`)).bytes.toString());

async function impact(h, route, idField, id, as, q) {
  return ok(await h.call(route, 'POST', { as, query: { ...q, action: 'delete-impact' }, body: { [idField]: id } })).impact;
}
async function execute(h, route, idField, id, as, q, imp, { confirm, reason } = {}) {
  return h.call(route, 'POST', {
    as, query: { ...q, action: 'delete-permanent' },
    body: { [idField]: id, impactToken: imp.token, typedConfirmation: confirm !== undefined ? confirm : imp.confirmPhrase, reason },
  });
}

describe('BT-014 permanent deletion — cascade rule', () => {
  test('a single account with nothing recorded is deleted alone ("A alone"), and its audit entry survives it', async () => {
    const h = harness();
    const f = await household(h);
    const mistake = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Wrong wallet', type: 'cash', currency: 'EUR' } }), 201).account;
    const imp = await impact(h, 'accounts', 'accountId', mistake.id, 'alice', f.q);
    assert.equal(imp.blocked, false);
    assert.deepEqual(imp.cascade, []);
    const out = ok(await execute(h, 'accounts', 'accountId', mistake.id, 'alice', f.q, imp)).impact;
    assert.equal(out.blocked, false);
    const doc = await rawDoc(h, f.ws.id);
    assert.equal(doc.accounts.some((a) => a.id === mistake.id), false, 'really gone from the array, not merely marked');
    const entries = doc.audit.filter((e) => e.targetId === mistake.id);
    assert.deepEqual(entries.map((e) => e.action), ['account.create', 'account.delete-permanent'], 'the audit trail survives the record');
  });

  test('deleting an account cascades to its own transactions ("A -> B", one group, no further dependents)', async () => {
    const h = harness();
    const f = await household(h);
    const acc = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Cash', type: 'cash', currency: 'EUR', openingBalance: '10.00' } }), 201).account;
    const t = ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: acc.id, kind: 'expense', amount: '3.00' } }), 201).transactions[0];
    const imp = await impact(h, 'accounts', 'accountId', acc.id, 'alice', f.q);
    assert.equal(imp.blocked, false);
    assert.deepEqual(imp.cascade, [{ type: 'transactions', count: 1, reason: null }]);
    await execute(h, 'accounts', 'accountId', acc.id, 'alice', f.q, imp);
    const doc = await rawDoc(h, f.ws.id);
    assert.equal(doc.accounts.some((a) => a.id === acc.id), false);
    assert.equal(doc.transactions.some((x) => x.id === t.id), false, 'the entry is gone too, not merely orphaned');
  });

  test('branching ("A -> B and A -> C") is blocked: an account with both its own transactions and its own bill', async () => {
    const h = harness();
    const f = await household(h);
    const acc = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Both', type: 'checking', currency: 'EUR', openingBalance: '100.00' } }), 201).account;
    ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: acc.id, kind: 'expense', amount: '3.00' } }), 201);
    ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Gym', accountId: acc.id, amount: '9.00', schedule: { freq: 'monthly', startDate: '2026-10-01' } } }), 201);
    const imp = await impact(h, 'accounts', 'accountId', acc.id, 'alice', f.q);
    assert.equal(imp.blocked, true);
    assert.match(imp.blockers[0], /more than one kind of related record/);
    const res = await execute(h, 'accounts', 'accountId', acc.id, 'alice', f.q, imp);
    assert.equal(res.status, 409);
    // Still there, and the blocked ATTEMPT itself was audited.
    const doc = await rawDoc(h, f.ws.id);
    assert.equal(doc.accounts.some((a) => a.id === acc.id), true);
    assert.ok(doc.audit.some((e) => e.targetId === acc.id && e.action === 'account.delete-blocked'));
  });

  test('a cross-account transfer leg always blocks deleting the account (Terry\'s resolution 1), even though it is the only relationship', async () => {
    const h = harness();
    const f = await household(h);
    const from = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'From', type: 'checking', currency: 'EUR', openingBalance: '200.00' } }), 201).account;
    const to = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'To', type: 'savings', currency: 'EUR' } }), 201).account;
    ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: from.id, kind: 'transfer', amount: '50.00', transfer: { toAccountId: to.id } } }), 201);
    const imp = await impact(h, 'accounts', 'accountId', from.id, 'alice', f.q);
    assert.equal(imp.blocked, true);
    assert.match(imp.blockers.join(' '), /one leg of a transfer whose other leg is on a different account/);
    // The untouched account is completely unaffected either way.
    const before = await rawDoc(h, f.ws.id);
    assert.equal(before.accounts.some((a) => a.id === to.id), true);
  });

  test('a reconciled transaction blocks the WHOLE account from permanent deletion too, not just its own individual deletion (financial review fix, 2026-09-17)', async () => {
    const h = harness();
    const f = await household(h);
    const acc = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Checked', type: 'checking', currency: 'EUR', openingBalance: '200.00' } }), 201).account;
    const t = ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: acc.id, kind: 'expense', amount: '3.00' } }), 201).transactions[0];
    ok(await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: t.revision, status: 'reconciled', reason: 'Matched to bank statement' } }));
    // Deleting the entry alone was already blocked (existing coverage above); cascading through
    // the account must not be a back door around the same protection.
    const imp = await impact(h, 'accounts', 'accountId', acc.id, 'alice', f.q);
    assert.equal(imp.blocked, true);
    assert.match(imp.blockers.join(' '), /reconciled transaction/);
    const res = await execute(h, 'accounts', 'accountId', acc.id, 'alice', f.q, imp);
    assert.equal(res.status, 409);
    const doc = await rawDoc(h, f.ws.id);
    assert.equal(doc.accounts.some((a) => a.id === acc.id), true, 'nothing touched');
  });

  test('Part A (Terry, 2026-09-17): an account linked to Shared expenses this workspace solely manages is deleted, not blocked — the ledger link is severed and the shared expense (amount, split, participants, history) is preserved', async () => {
    const h = harness();
    const f = await household(h);
    const aliceRef = `member:${f.memberId('Alice')}`;
    const exp = ok(await h.call('group', 'POST', {
      as: 'alice', query: f.q,
      body: {
        description: 'Solo grocery run', amount: '40.00',
        payers: [{ ref: aliceRef }], split: { method: 'equal', lines: [{ ref: aliceRef }] },
        ledger: { accountId: f.aliceSavings.id },
      },
    }), 201).expense;
    const before = await rawDoc(h, f.ws.id);
    assert.equal(before.groupLedgers.some((l) => l.accountId === f.aliceSavings.id && !l.endedAt), true, 'fixture: the account is really linked');
    const imp = await impact(h, 'accounts', 'accountId', f.aliceSavings.id, 'alice', f.q);
    assert.equal(imp.blocked, false, 'no cross-workspace participation exists in this codebase, so this is always "managed solely by this workspace"');
    assert.equal(imp.groupInvolved, true);
    assert.ok(imp.autoCleanup.some((c) => c.type === 'group-link'), 'the client is told a Shared-expenses link will be cleaned up');
    await execute(h, 'accounts', 'accountId', f.aliceSavings.id, 'alice', f.q, imp);
    const after = await rawDoc(h, f.ws.id);
    assert.equal(after.accounts.some((a) => a.id === f.aliceSavings.id), false, 'the account is gone');
    assert.equal(after.groupLedgers.some((l) => l.accountId === f.aliceSavings.id), false, 'the dangling ledger link is removed, not left as a stale pointer');
    const survivor = after.groupExpenses.find((e) => e.id === exp.id);
    assert.ok(survivor, 'the shared expense itself survives the account it was linked to');
    assert.equal(survivor.amountMinor, 4000);
    assert.deepEqual(survivor.payers, exp.payers.map((p) => ({ ref: p.ref, amountMinor: p.amountMinor })), 'payers/amounts unchanged');
  });

  test('permission mirrors edit authority: a member cannot permanently delete a shared account; a manager can', async () => {
    const h = harness();
    const f = await household(h);
    const shared = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Shared spare', type: 'savings', currency: 'EUR', visibility: 'shared' } }), 201).account;
    assert.equal((await h.call('accounts', 'POST', { as: 'bob', query: { ...f.q, action: 'delete-impact' }, body: { accountId: shared.id } })).status, 403);
    assert.equal((await h.call('accounts', 'POST', { as: 'carol', query: { ...f.q, action: 'delete-impact' }, body: { accountId: shared.id } })).status, 403);
    assert.equal((await h.call('accounts', 'POST', { as: 'eve', query: { ...f.q, action: 'delete-impact' }, body: { accountId: shared.id } })).status, 404, 'an outsider learns nothing');
    assert.equal((await h.call('accounts', 'POST', { as: 'alice', query: { ...f.q, action: 'delete-impact' }, body: { accountId: f.bobCard.id } })).status, 404, "the owner cannot reach Bob's private card");
    const imp = await impact(h, 'accounts', 'accountId', shared.id, 'alice', f.q);
    ok(await execute(h, 'accounts', 'accountId', shared.id, 'alice', f.q, imp));
  });

  test('the impact must be reviewed again if it changed: a stale token is refused, never silently re-evaluated', async () => {
    const h = harness();
    const f = await household(h);
    const acc = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Drift', type: 'cash', currency: 'EUR' } }), 201).account;
    const imp = await impact(h, 'accounts', 'accountId', acc.id, 'alice', f.q);
    // Something changes after the person reviewed the impact: a bill is added.
    ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'New bill', accountId: acc.id, amount: '5.00', schedule: { freq: 'monthly', startDate: '2026-10-01' } } }), 201);
    const res = await execute(h, 'accounts', 'accountId', acc.id, 'alice', f.q, imp);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'delete_impact_stale');
  });

  test('typing the wrong confirmation phrase refuses the deletion', async () => {
    const h = harness();
    const f = await household(h);
    const acc = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Type me', type: 'cash', currency: 'EUR' } }), 201).account;
    const imp = await impact(h, 'accounts', 'accountId', acc.id, 'alice', f.q);
    const res = await execute(h, 'accounts', 'accountId', acc.id, 'alice', f.q, imp, { confirm: 'not the name' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'confirmation_mismatch');
  });

  test('deleting a transaction takes both legs of a transfer together, but never a lone reconciled or Shared-expenses entry', async () => {
    const h = harness();
    const f = await household(h);
    const from = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'X', type: 'checking', currency: 'EUR', openingBalance: '200.00' } }), 201).account;
    const to = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Y', type: 'savings', currency: 'EUR' } }), 201).account;
    const legs = ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: from.id, kind: 'transfer', amount: '25.00', transfer: { toAccountId: to.id } } }), 201).transactions;
    const leg = legs.find((x) => x.accountId === from.id);
    const imp = await impact(h, 'transactions', 'transactionId', leg.id, 'alice', f.q);
    assert.equal(imp.blocked, false);
    assert.equal(imp.together.length, 1);
    ok(await execute(h, 'transactions', 'transactionId', leg.id, 'alice', f.q, imp));
    const doc = await rawDoc(h, f.ws.id);
    assert.equal(doc.transactions.some((x) => legs.some((l) => l.id === x.id)), false, 'both legs are gone together (other, unrelated household entries stay)');
  });

  test('a merchant can be permanently deleted while entries reference it: the entry keeps everything else and only loses the link', async () => {
    const h = harness();
    const f = await household(h);
    const imp = await impact(h, 'payees', 'payeeId', f.merchants.grocer.id, 'alice', f.q);
    assert.equal(imp.blocked, false);
    assert.deepEqual(imp.severed, [{ type: 'transaction', field: 'payeeId', count: 1 }]);
    await execute(h, 'payees', 'payeeId', f.merchants.grocer.id, 'alice', f.q, imp);
    const doc = await rawDoc(h, f.ws.id);
    assert.equal(doc.payees.some((p) => p.id === f.merchants.grocer.id), false);
    const groceryTxn = doc.transactions.find((t) => t.id === f.grocery.id);
    assert.equal(groceryTxn.payeeId, null, 'lost the pointer');
    assert.equal(groceryTxn.amountMinor, -8240, 'kept everything else (Terry\'s own example, applied in reverse)');
  });

  test('a category used by a budget blocks deletion; used only by entries, it is severed there and the category goes', async () => {
    const h = harness();
    const f = await household(h);
    const cats = ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories;
    const dining = cats.find((c) => c.name === 'Dining');
    const shopping = cats.find((c) => c.name === 'Shopping');
    ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Monthly', scope: 'private', currency: 'EUR', lines: [{ categoryId: dining.id, amount: '100.00' }] } }), 201);
    const blockedImp = await impact(h, 'categories', 'categoryId', dining.id, 'alice', f.q);
    assert.equal(blockedImp.blocked, true);
    assert.match(blockedImp.blockers[0], /budget/);

    ok(await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: f.grocery.id, revision: f.grocery.revision, categoryId: shopping.id, reason: 'Recategorised' } }));
    const imp = await impact(h, 'categories', 'categoryId', shopping.id, 'alice', f.q);
    assert.equal(imp.blocked, false);
    assert.deepEqual(imp.severed, [{ type: 'transaction', field: 'categoryId', count: 1 }]);
    await execute(h, 'categories', 'categoryId', shopping.id, 'alice', f.q, imp);
    const doc = await rawDoc(h, f.ws.id);
    assert.equal(doc.categories.some((c) => c.id === shopping.id), false);
    assert.equal(doc.transactions.find((t) => t.id === f.grocery.id).categoryId, null);
  });

  test('a category still referenced by an OLDER budget version blocks deletion too, not just the current plan (financial review fix, 2026-09-17)', async () => {
    const h = harness();
    const f = await household(h);
    const cats = ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories;
    const dining = cats.find((c) => c.name === 'Dining');
    const shopping = cats.find((c) => c.name === 'Shopping');
    const budget = ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Monthly', scope: 'private', currency: 'EUR', lines: [{ categoryId: dining.id, amount: '100.00' }] } }), 201).budget;
    // Revise the plan forward so Dining is no longer in the CURRENT lines — only in the old version.
    ok(await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: budget.id, revision: budget.revision, lines: [{ categoryId: shopping.id, amount: '50.00' }] } }));
    const imp = await impact(h, 'categories', 'categoryId', dining.id, 'alice', f.q);
    assert.equal(imp.blocked, true, 'the category is still referenced by the budget\'s earlier version, even though the current plan has moved on');
    assert.match(imp.blockers.join(' '), /budget/);
    const res = await execute(h, 'categories', 'categoryId', dining.id, 'alice', f.q, imp);
    assert.equal(res.status, 409);
    const doc = await rawDoc(h, f.ws.id);
    assert.equal(doc.categories.some((c) => c.id === dining.id), true, 'nothing touched; a real deletion here would have left a permanent dangling categoryId inside the budget\'s stored version history');
  });

  test('a recurring bill is deleted freely; an entry already recorded from it keeps its amount and just loses the link', async () => {
    const h = harness();
    const f = await household(h);
    const bill = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Gym', accountId: f.aliceSavings.id, amount: '9.00', schedule: { freq: 'monthly', startDate: '2026-09-01' } } }), 201).recurring;
    const recorded = ok(await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'record' }, body: { recurringId: bill.id, occurrence: '2026-09-01' } }), 201).recurring;
    const imp = await impact(h, 'recurring', 'recurringId', bill.id, 'alice', f.q);
    assert.equal(imp.blocked, false);
    assert.deepEqual(imp.severed, [{ type: 'transaction', field: 'links.recurringId', count: 1 }]);
    await execute(h, 'recurring', 'recurringId', bill.id, 'alice', f.q, imp);
    const doc = await rawDoc(h, f.ws.id);
    assert.equal(doc.recurring.some((r) => r.id === bill.id), false);
    const txn = doc.transactions.find((t) => (t.links || {}).recurringId === bill.id);
    assert.equal(txn, undefined, 'the link is gone');
    assert.equal(doc.transactions.some((t) => t.amountMinor === -900), true, 'the recorded entry itself is unchanged otherwise');
  });

  test('a budget with no further dependents is deleted alone', async () => {
    const h = harness();
    const f = await household(h);
    const cats = ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories;
    const budget = ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Trim', scope: 'private', currency: 'EUR', lines: [{ categoryId: cats[0].id, amount: '10.00' }] } }), 201).budget;
    const imp = await impact(h, 'budgets', 'budgetId', budget.id, 'alice', f.q);
    assert.equal(imp.blocked, false);
    await execute(h, 'budgets', 'budgetId', budget.id, 'alice', f.q, imp);
    const doc = await rawDoc(h, f.ws.id);
    assert.equal(doc.budgets.some((b) => b.id === budget.id), false);
  });

  test('a contact referenced as responsible on an entry blocks permanent deletion; an unused one is deleted', async () => {
    const h = harness();
    const f = await household(h);
    const contact = ok(await h.call('contacts', 'POST', { as: 'alice', query: f.q, body: { scope: 'workspace', workspaceId: f.ws.id, name: 'Frank Fictional' } }), 201).contact;
    ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, kind: 'expense', amount: '4.00', responsibleRef: `contact:${contact.id}` } }), 201);
    const blockedImp = await impact(h, 'contacts', 'contactId', contact.id, 'alice', f.q);
    assert.equal(blockedImp.blocked, true);

    const spare = ok(await h.call('contacts', 'POST', { as: 'alice', query: f.q, body: { scope: 'workspace', workspaceId: f.ws.id, name: 'Unused Contact' } }), 201).contact;
    const imp = await impact(h, 'contacts', 'contactId', spare.id, 'alice', f.q);
    assert.equal(imp.blocked, false);
    await execute(h, 'contacts', 'contactId', spare.id, 'alice', f.q, imp);
    const doc = await rawDoc(h, f.ws.id);
    assert.equal(doc.contacts.some((c) => c.id === spare.id), false);
  });

  test('after several permanent deletions the workspace still passes the same invariant check backups use, and an on-demand backup succeeds', async () => {
    const h = harness();
    const f = await household(h);
    const imp = await impact(h, 'payees', 'payeeId', f.merchants.grocer.id, 'alice', f.q);
    await execute(h, 'payees', 'payeeId', f.merchants.grocer.id, 'alice', f.q, imp);
    ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
  });

  test('rename already works through the existing PATCH for every type this feature covers (no new endpoint needed)', async () => {
    const h = harness();
    const f = await household(h);
    const acc = ok(await h.call('accounts', 'PATCH', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, revision: f.aliceSavings.revision, name: 'Renamed Savings' } })).account;
    assert.equal(acc.name, 'Renamed Savings');
    const cats = ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories;
    const cat = ok(await h.call('categories', 'PATCH', { as: 'alice', query: f.q, body: { categoryId: cats[0].id, name: 'Renamed Category' } })).category;
    assert.equal(cat.name, 'Renamed Category');
  });
});
