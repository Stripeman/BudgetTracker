'use strict';
// BT-001-05 immutable financial history: amendments keep before/after values with who, when and
// why; financial corrections and deletions need a reason; a reversal corrects even a reconciled
// entry without touching it; backups accept reversals. Expected values are computed by hand.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const patch = (h, q, as, body) => h.call('transactions', 'PATCH', { as, query: q, body });
const historyOf = async (h, q, as, id) => ok(await h.call('transactions', 'GET', { as, query: { ...q, action: 'history', transactionId: id } }));

describe('BT-001-05 amendments', () => {
  test('a financial correction needs a reason and keeps the before and after values, author and time', async () => {
    const h = harness();
    const f = await household(h);
    code(await patch(h, f.q, 'alice', { transactionId: f.grocery.id, revision: 1, amount: '84.20' }), 400, 'reason_required');
    const edited = ok(await patch(h, f.q, 'alice', { transactionId: f.grocery.id, revision: 1, amount: '84.20', reason: 'Receipt showed 84.20' })).transactions[0];
    assert.deepEqual([edited.amount, edited.amendmentCount], ['-84.20', 1]);
    const hist = await historyOf(h, f.q, 'bob', f.grocery.id);
    assert.equal(hist.createdBy, 'Alice Fictional');
    assert.deepEqual(hist.amendments.map((a) => [a.by, a.reason, a.changes]), [['Alice Fictional', 'Receipt showed 84.20', [{ field: 'amountMinor', from: '-82.40', to: '-84.20' }]]]);
    // A note needs no reason, and is still recorded with its old value.
    ok(await patch(h, f.q, 'alice', { transactionId: f.grocery.id, revision: 2, notes: 'Weekly shop' }));
    assert.deepEqual((await historyOf(h, f.q, 'alice', f.grocery.id)).amendments[1].changes, [{ field: 'notes', from: '', to: 'Weekly shop' }]);
  });

  test('deleting needs a reason; the entry is kept and a restore keeps who deleted it', async () => {
    const h = harness();
    const f = await household(h);
    code(await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: f.grocery.id, revision: 1 } }), 400, 'reason_required');
    ok(await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: f.grocery.id, revision: 1, reason: 'Entered twice' } }));
    ok(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'restore' }, body: { transactionId: f.grocery.id } }));
    const [del, res] = (await historyOf(h, f.q, 'alice', f.grocery.id)).amendments;
    assert.deepEqual([del.reason, del.changes[0].field, del.changes[0].to], ['Entered twice', 'deleted', true]);
    assert.equal(res.changes[0].to, false);
    assert.ok(res.changes[0].previouslyDeletedAt, 'when it was deleted is kept');
  });

  test('a cross-currency transfer correction keeps the earlier exchange details', async () => {
    const h = harness();
    const f = await household(h);
    const yen = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Yen', type: 'cash', currency: 'JPY' } }), 201).account;
    const [out] = ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'transfer', amount: '50.00', transfer: { toAccountId: yen.id, rate: '160' } } }), 201).transactions;
    const edited = ok(await patch(h, f.q, 'alice', { transactionId: out.id, revision: 1, amount: '40.00', toAmount: '6400', reason: 'Bank statement' })).transactions;
    const incoming = edited.find((t) => t.accountId === yen.id);
    const change = (await historyOf(h, f.q, 'alice', incoming.id)).amendments[0].changes.find((c) => c.field === 'original');
    assert.equal(change.from.rate, '160', 'the manual rate recorded at entry is kept in the history');
  });
});

describe('BT-001-05 reversals', () => {
  test('a reconciled entry is corrected by a reversal that nets to zero and leaves the original untouched', async () => {
    const h = harness();
    const f = await household(h);
    ok(await patch(h, f.q, 'alice', { transactionId: f.grocery.id, revision: 1, status: 'reconciled' }));
    code(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'reverse' }, body: { transactionId: f.grocery.id } }), 400, 'reason_required');
    const [original, reversal] = ok(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'reverse' }, body: { transactionId: f.grocery.id, reason: 'Charged to the wrong card' } }), 201).transactions;
    assert.deepEqual([original.amount, original.status, original.reversedBy], ['-82.40', 'reconciled', reversal.id]);
    assert.deepEqual([reversal.amount, reversal.kind, reversal.links.reverses], ['82.40', 'expense', f.grocery.id]);
    // Joint: 1000.00 − 82.40 + 82.40 = 1000.00; spending at the merchant nets to zero.
    assert.equal(ok(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).accounts.find((a) => a.name === 'Joint').balance, '1000.00');
    const summary = ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: f.joint.id } })).summary[0];
    assert.equal(summary.gross, '0.00');
    code(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'reverse' }, body: { transactionId: f.grocery.id, reason: 'again' } }), 409, 'already_reversed');
    code(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'reverse' }, body: { transactionId: reversal.id, reason: 'undo' } }), 409, 'is_reversal');
    ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
  });

  test('only someone who may edit the entry can reverse it', async () => {
    const h = harness();
    const f = await household(h);
    assert.equal((await h.call('transactions', 'POST', { as: 'bob', query: { ...f.q, action: 'reverse' }, body: { transactionId: f.grocery.id, reason: 'x' } })).status, 403);
    assert.equal((await h.call('transactions', 'POST', { as: 'carol', query: { ...f.q, action: 'reverse' }, body: { transactionId: f.grocery.id, reason: 'x' } })).status, 403);
    assert.equal((await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'reverse' }, body: { transactionId: f.secret.id, reason: 'x' } })).status, 404);
  });
});
