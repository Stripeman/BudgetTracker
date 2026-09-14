'use strict';
// BT-006 ledger behavior with independent expected values: balances, transfers (card payments
// are not spending), splits, idempotency, stale-edit refusal, reconciliation locks, soft delete.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, merchant } = require('./helpers');

async function personal(h) {
  const ws = (await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Alice Personal', kind: 'personal', reportingCurrency: 'EUR' } })).body.workspace;
  const q = { workspaceId: ws.id };
  const acc = async (body) => (await h.call('accounts', 'POST', { as: 'alice', query: q, body })).body.account;
  const checking = await acc({ name: 'Checking', type: 'checking', currency: 'EUR', openingBalance: '1500.00', openingDate: '2026-09-01' });
  const card = await acc({ name: 'Card', type: 'credit-card', currency: 'EUR', terms: { creditLimit: '3000.00', dueDay: 25, apr: '19.99' } });
  const yen = await acc({ name: 'Travel Yen', type: 'cash', currency: 'JPY' });
  return { ws, q, checking, card, yen };
}

const balances = async (h, q) => Object.fromEntries((await h.call('accounts', 'GET', { as: 'alice', query: q })).body.accounts.map((a) => [a.name, a.balance]));

test('card purchase is spending; paying the card is a transfer, not spending again', async () => {
  const h = harness();
  const f = await personal(h);
  await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.card.id, kind: 'expense', amount: '120.00' } });
  const pay = await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.checking.id, kind: 'transfer', amount: '120.00', transfer: { toAccountId: f.card.id } } });
  assert.equal(pay.status, 201);
  assert.deepEqual(pay.body.transactions.map((t) => t.amount), ['-120.00', '120.00']);
  assert.deepEqual(await balances(h, f.q), { Checking: '1380.00', Card: '0.00', 'Travel Yen': '0' });
  const summary = (await h.call('transactions', 'GET', { as: 'alice', query: f.q })).body.summary;
  assert.deepEqual(summary, [{ currency: 'EUR', count: 1, gross: '120.00', refunds: '0.00', net: '120.00', income: '0.00', adjustments: '0.00', advances: '0.00', reimbursements: '0.00', payables: '0.00', repayments: '0.00', receivable: '0.00' }]);
});

test('cross-currency transfer keeps rate context and exact converted amount', async () => {
  const h = harness();
  const f = await personal(h);
  const res = await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.checking.id, kind: 'transfer', amount: '100.00', transfer: { toAccountId: f.yen.id, rate: '161.235' } } });
  const [out, into] = res.body.transactions;
  assert.equal(out.amount, '-100.00');
  assert.equal(into.amount, '16124');
  assert.equal(into.original.rate, '161.235');
  assert.equal(into.original.currency, 'EUR');
  assert.equal((await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.checking.id, kind: 'transfer', amount: '1.00', transfer: { toAccountId: f.yen.id } } })).status, 400);
});

test('splits must sum exactly to the amount', async () => {
  const h = harness();
  const f = await personal(h);
  const cats = (await h.call('categories', 'GET', { as: 'alice', query: f.q })).body.categories;
  const groceries = cats.find((c) => c.name === 'Groceries').id;
  const home = cats.find((c) => c.name === 'Housing').id;
  const bad = await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.checking.id, kind: 'expense', amount: '50.00', splits: [{ categoryId: groceries, amount: '30.00' }, { categoryId: home, amount: '19.99' }] } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'split_mismatch');
  const good = await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.checking.id, kind: 'expense', amount: '50.00', splits: [{ categoryId: groceries, amount: '30.00' }, { categoryId: home, amount: '20.00' }] } });
  assert.deepEqual(good.body.transactions[0].splits.map((s) => s.amount), ['-30.00', '-20.00']);
  const filtered = (await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, categoryId: home } })).body.total;
  assert.equal(filtered, 1, 'category filter matches split lines');
});

test('a repeated Idempotency-Key creates exactly one entry', async () => {
  const h = harness();
  const f = await personal(h);
  const body = { accountId: f.checking.id, kind: 'expense', amount: '9.99' };
  const headers = { 'Idempotency-Key': 'client-key-0001' };
  const first = await h.call('transactions', 'POST', { as: 'alice', query: f.q, body, headers });
  const second = await h.call('transactions', 'POST', { as: 'alice', query: f.q, body, headers });
  assert.equal(first.body.transactions[0].id, second.body.transactions[0].id);
  assert.equal(second.body.replayed, true);
  assert.equal((await h.call('transactions', 'GET', { as: 'alice', query: f.q })).body.total, 1);
});

test('stale edits are refused; reconciled entries lock amount and date; soft delete restores', async () => {
  const h = harness();
  const f = await personal(h);
  const t = (await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.checking.id, kind: 'expense', amount: '10.00' } })).body.transactions[0];
  assert.equal((await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: 1, amount: '11.00', reason: 'Typo' } })).status, 200);
  const stale = await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: 1, amount: '12.00' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'stale_revision');
  await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: 2, status: 'reconciled' } });
  assert.equal((await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: 3, amount: '1.00' } })).body.error.code, 'reconciled_locked');
  assert.equal((await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: 3 } })).body.error.code, 'reconciled_locked');
  await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: 3, status: 'cleared', reason: 'Statement corrected' } });
  assert.equal((await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: 4, reason: 'Duplicate' } })).status, 200);
  assert.equal((await balances(h, f.q)).Checking, '1500.00');
  assert.equal((await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'restore' }, body: { transactionId: t.id } })).status, 200);
  assert.equal((await balances(h, f.q)).Checking, '1489.00');
});

test('amounts respect currency precision and kinds decide direction', async () => {
  const h = harness();
  const f = await personal(h);
  assert.equal((await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.yen.id, kind: 'expense', amount: '100.5' } })).body.error.code, 'invalid_precision');
  assert.equal((await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.checking.id, kind: 'expense', amount: '-5.00' } })).status, 400);
  await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.checking.id, kind: 'income', amount: '2000.00' } });
  await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.checking.id, kind: 'refund', amount: '15.00' } });
  await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.checking.id, kind: 'adjustment', amount: '-0.50' } });
  // 1500.00 + 2000.00 + 15.00 - 0.50 = 3514.50
  assert.equal((await balances(h, f.q)).Checking, '3514.50');
});

test('autofill suggestions are explained, editable data and never saved', async () => {
  const h = harness();
  const f = await personal(h);
  const cats = (await h.call('categories', 'GET', { as: 'alice', query: f.q })).body.categories;
  const dining = cats.find((c) => c.name === 'Dining').id;
  const cafe = await merchant(h, f.q, 'alice', { name: 'Fictional Cafe' });
  for (const amount of ['4.50', '5.20']) {
    await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.card.id, kind: 'expense', amount, payeeId: cafe.id, categoryId: dining, tags: ['coffee'] } });
  }
  const payee = (await h.call('payees', 'GET', { as: 'alice', query: f.q })).body.payees.find((p) => p.name === 'Fictional Cafe');
  assert.deepEqual(payee.stats, [{ currency: 'EUR', count: 2, gross: '9.70', refunds: '0.00', net: '9.70', lastDate: '2026-09-13' }]);
  const before = (await h.call('transactions', 'GET', { as: 'alice', query: f.q })).body.total;
  const s = (await h.call('payees', 'GET', { as: 'alice', query: { ...f.q, action: 'suggest', payeeId: payee.id } })).body;
  assert.equal(s.suggestion.categoryId, dining);
  assert.equal(s.suggestion.accountId, f.card.id);
  assert.match(s.suggestion.categoryReason, /2 of your last 2/);
  assert.deepEqual(s.suggestion.tags, ['coffee']);
  assert.equal((await h.call('transactions', 'GET', { as: 'alice', query: f.q })).body.total, before, 'suggesting saved nothing');
});
