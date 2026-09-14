'use strict';
// BT-001-05 account lifecycle: closing needs a reason, keeps the account and its history visible and
// refuses new entries, transfers in, bills and bill payments; reopening allows them again; removing
// an account needs a reason; every edit keeps its before and after values. All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const act = (h, q, as, action, body) => h.call('accounts', 'POST', { as, query: { ...q, action }, body });
const accountsOf = async (h, q, as) => ok(await h.call('accounts', 'GET', { as, query: q })).accounts;
const rawDoc = async (h, wsId) => JSON.parse((await h.storage.getBytes(`workspaces/${wsId}/workspace.json`)).bytes.toString());

describe('BT-001-05 account lifecycle', () => {
  test('closing needs a reason and stops new entries, transfers in and bills; history stays; reopening allows them again', async () => {
    const h = harness();
    const f = await household(h);
    const acc = (await accountsOf(h, f.q, 'alice')).find((a) => a.name === 'Alice Savings');
    code(await act(h, f.q, 'alice', 'close', { accountId: acc.id, revision: acc.revision }), 400, 'reason_required');
    const closed = ok(await act(h, f.q, 'alice', 'close', { accountId: acc.id, revision: acc.revision, reason: 'Moved to another bank', closedOn: '2026-09-12' })).account;
    assert.equal(closed.status, 'closed');
    code(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: acc.id, kind: 'expense', amount: '1.00' } }), 409, 'account_closed');
    code(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'transfer', amount: '1.00', transfer: { toAccountId: acc.id } } }), 409, 'account_closed');
    code(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Gym', accountId: acc.id, amount: '1.00', schedule: { freq: 'monthly', startDate: '2026-10-01' } } }), 409, 'account_closed');
    assert.equal((await accountsOf(h, f.q, 'alice')).find((a) => a.id === acc.id).balance, '5000.00', 'still listed with its balance');
    code(await act(h, f.q, 'alice', 'close', { accountId: acc.id, revision: closed.revision, reason: 'again' }), 409, 'already_closed');
    code(await h.call('accounts', 'PATCH', { as: 'alice', query: f.q, body: { accountId: acc.id, revision: closed.revision, status: 'open' } }), 400, 'unknown_field');
    const reopened = ok(await act(h, f.q, 'alice', 'reopen', { accountId: acc.id, revision: closed.revision, reason: 'Came back' })).account;
    assert.equal(reopened.status, 'open');
    ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: acc.id, kind: 'expense', amount: '1.00' } }), 201);
    const stored = (await rawDoc(h, f.ws.id)).accounts.find((a) => a.id === acc.id);
    assert.deepEqual(stored.history.map((x) => [x.changes[0].field, x.changes[0].from, x.changes[0].to, x.reason]), [['status', 'open', 'closed', 'Moved to another bank'], ['status', 'closed', 'open', 'Came back']]);
    assert.equal(stored.closedOn, '2026-09-12');
  });

  test('a bill on a closed account cannot be recorded', async () => {
    const h = harness();
    const f = await household(h);
    const bill = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Rent', accountId: f.joint.id, amount: '800.00', schedule: { freq: 'monthly', startDate: '2026-10-01' } } }), 201).recurring;
    const joint = (await accountsOf(h, f.q, 'alice')).find((a) => a.id === f.joint.id);
    ok(await act(h, f.q, 'alice', 'close', { accountId: joint.id, revision: joint.revision, reason: 'Joint account ended' }));
    code(await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'record' }, body: { recurringId: bill.id, occurrence: '2026-10-01' } }), 409, 'account_closed');
  });

  test('removing an account needs a reason; every edit keeps its before and after values', async () => {
    const h = harness();
    const f = await household(h);
    code(await h.call('accounts', 'DELETE', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id } }), 400, 'reason_required');
    ok(await h.call('accounts', 'DELETE', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, reason: 'Duplicate account' } }));
    ok(await h.call('accounts', 'POST', { as: 'alice', query: { ...f.q, action: 'restore' }, body: { accountId: f.aliceSavings.id } }));
    const acc = (await accountsOf(h, f.q, 'alice')).find((a) => a.id === f.aliceSavings.id);
    ok(await h.call('accounts', 'PATCH', { as: 'alice', query: f.q, body: { accountId: acc.id, revision: acc.revision, institution: 'Fictional Bank', reason: 'Bank renamed' } }));
    const card = (await accountsOf(h, f.q, 'bob')).find((a) => a.id === f.bobCard.id);
    ok(await h.call('accounts', 'PATCH', { as: 'bob', query: f.q, body: { accountId: card.id, revision: card.revision, terms: { creditLimit: '2500.00' } } }));
    const doc = await rawDoc(h, f.ws.id);
    const savings = doc.accounts.find((a) => a.id === f.aliceSavings.id);
    assert.deepEqual(savings.history.map((x) => x.changes.map((c) => c.field).join(',')), ['deleted', 'deleted', 'institution']);
    assert.deepEqual([savings.history[0].reason, savings.history[2].changes[0].from, savings.history[2].changes[0].to, savings.history[2].reason], ['Duplicate account', '', 'Fictional Bank', 'Bank renamed']);
    const termsChange = doc.accounts.find((a) => a.id === f.bobCard.id).history[0].changes[0];
    assert.equal(termsChange.field, 'terms');
    assert.notDeepEqual(termsChange.from, termsChange.to, 'the earlier credit terms are kept');
  });

  test('only the owner of a private account, or a manager for a shared one, can close it', async () => {
    const h = harness();
    const f = await household(h);
    const joint = (await accountsOf(h, f.q, 'bob')).find((a) => a.id === f.joint.id);
    assert.equal((await act(h, f.q, 'bob', 'close', { accountId: joint.id, revision: joint.revision, reason: 'x' })).status, 403);
    assert.equal((await act(h, f.q, 'carol', 'close', { accountId: joint.id, revision: joint.revision, reason: 'x' })).status, 403);
    assert.equal((await act(h, f.q, 'alice', 'close', { accountId: f.bobCard.id, revision: 1, reason: 'x' })).status, 404);
  });

  test('BT-006-06 type and currency stay fixed after creation: a PATCH naming either is refused, even together with an allowed field', async () => {
    const h = harness();
    const f = await household(h);
    code(await h.call('accounts', 'PATCH', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, revision: 1, type: 'checking' } }), 400, 'unknown_field');
    code(await h.call('accounts', 'PATCH', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, revision: 1, currency: 'USD' } }), 400, 'unknown_field');
    code(await h.call('accounts', 'PATCH', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, revision: 1, name: 'Renamed', type: 'checking' } }), 400, 'unknown_field');
    const unchanged = (await accountsOf(h, f.q, 'alice')).find((a) => a.id === f.aliceSavings.id);
    assert.deepEqual([unchanged.type, unchanged.currency, unchanged.revision], ['savings', 'EUR', 1], 'refused as a whole; nothing was applied');
  });

  test('BT-006-06 opening date, account number and notes round-trip; reconciledLocked is reported before it is enforced', async () => {
    const h = harness();
    const f = await household(h);
    const before = (await accountsOf(h, f.q, 'alice')).find((a) => a.id === f.aliceSavings.id);
    assert.equal(before.reconciledLocked, false, 'no reconciled entry yet');
    const edited = ok(await h.call('accounts', 'PATCH', {
      as: 'alice', query: f.q,
      body: { accountId: before.id, revision: before.revision, openingDate: '2026-02-01', maskedNumber: '7777', notes: 'Fictional note.', reason: 'Corrected details' },
    })).account;
    assert.deepEqual([edited.openingDate, edited.maskedNumber, edited.notes], ['2026-02-01', '7777', 'Fictional note.']);
    const doc = await rawDoc(h, f.ws.id);
    const stored = doc.accounts.find((a) => a.id === before.id);
    const entry = stored.history.at(-1);
    assert.deepEqual(entry.fields.sort(), ['maskedNumber', 'notes', 'openingDate']);
    assert.deepEqual(entry.changes.find((c) => c.field === 'openingDate'), { field: 'openingDate', from: before.openingDate, to: '2026-02-01' });
    assert.deepEqual(entry.changes.find((c) => c.field === 'maskedNumber'), { field: 'maskedNumber', from: '', to: '7777' });
    assert.deepEqual(entry.changes.find((c) => c.field === 'notes'), { field: 'notes', from: '', to: 'Fictional note.' });
    assert.equal(entry.reason, 'Corrected details');
    assert.deepEqual(entry.before, { openingBalanceMinor: before.openingBalanceMinor, openingDate: before.openingDate });
    assert.deepEqual(entry.after, { openingBalanceMinor: before.openingBalanceMinor, openingDate: '2026-02-01' });
    assert.equal(doc.audit.at(-1).action, 'account.update');
    assert.deepEqual(doc.audit.at(-1).fields.sort(), ['maskedNumber', 'notes', 'openingDate']);
    const t = ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: before.id, kind: 'expense', amount: '5.00' } }), 201).transactions[0];
    ok(await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: 1, status: 'reconciled' } }));
    const locked = (await accountsOf(h, f.q, 'alice')).find((a) => a.id === before.id);
    assert.equal(locked.reconciledLocked, true, 'shown before Save, not only discovered by a failed one');
    code(await h.call('accounts', 'PATCH', { as: 'alice', query: f.q, body: { accountId: before.id, revision: locked.revision, openingDate: '2020-01-01' } }), 409, 'reconciled_locked');
  });

  test('BT-006-06 credit terms are returned as decimal amounts alongside the minor units, ready to display and edit', async () => {
    const h = harness();
    const f = await household(h);
    const card = (await accountsOf(h, f.q, 'bob')).find((a) => a.id === f.bobCard.id);
    assert.deepEqual([card.terms.creditLimit, card.terms.creditLimitMinor], ['2000.00', 200000]);
  });
});
