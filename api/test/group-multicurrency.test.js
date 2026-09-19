'use strict';
// BT-009-13 (Terry's split-costs check, 2026-09-14): "an expense may be entered in a currency other
// than the group's; it keeps the original amount and currency, the rate, its source and date, and
// the converted amount in the group currency; shares, balances and settlement use the converted
// amount with deterministic rounding; changing rates later never changes a recorded expense."
// All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Currency Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: 'bob@example.com', role: 'member' } }), 201);
  ok(await h.call('invitations', 'POST', { as: 'bob', query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const aliceRef = `member:${members.find((m) => m.name.startsWith('Alice')).id}`;
  const bobRef = `member:${members.find((m) => m.name.startsWith('Bob')).id}`;
  return { ws, q, aliceRef, bobRef };
}
const G = (h, f, as, method, opts = {}) => h.call('group', method, { as, query: f.q, ...opts });
const view = async (h, f, as = 'alice') => ok(await G(h, f, as, 'GET'));
const row = (v, ref) => v.balances.find((b) => b.currency === 'EUR').rows.find((r) => r.ref === ref);

describe('BT-009-13 a shared expense in another currency, with its conversion rate', () => {
  test('a different currency without a rate is refused; an unsupported currency code is refused', async () => {
    const h = harness();
    const f = await fixture(h);
    const noRate = await G(h, f, 'alice', 'POST', { body: { description: 'x', amount: '10.00', currency: 'USD', payers: [{ ref: f.aliceRef }], split: equal(f.aliceRef) } });
    assert.equal(noRate.status, 400);
    assert.equal(noRate.body.error.code, 'missing_rate');
    const bogus = await G(h, f, 'alice', 'POST', { body: { description: 'x', amount: '10.00', currency: 'ZZZ', rate: '1', payers: [{ ref: f.aliceRef }], split: equal(f.aliceRef) } });
    assert.equal(bogus.status, 400);
    assert.equal(bogus.body.error.code, 'unsupported_currency');
  });

  test('a USD expense converts to EUR with the given rate; the original amount, currency, rate, source and date are all kept exactly; shares/balances use the CONVERTED amount', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = ok(await G(h, f, 'alice', 'POST', { body: {
      description: 'E2E fictional hotel', date: '2026-09-10', amount: '100.00', currency: 'USD', rate: '0.92', rateSource: 'provider', rateDate: '2026-09-09',
      payers: [{ ref: f.aliceRef, amount: '92.00' }], split: equal(f.aliceRef, f.bobRef),
    } }), 201).expense;
    assert.equal(e.currency, 'EUR', 'the record itself stays in the reporting currency');
    assert.equal(e.amount, '92.00', '100.00 USD at 0.92 converts to 92.00 EUR');
    assert.deepEqual(e.original, { amount: '100.00', amountMinor: 10000, currency: 'USD', rate: '0.92', rateSource: 'provider', rateDate: '2026-09-09' });
    assert.deepEqual(e.shares.map((s) => s.amount), ['46.00', '46.00'], 'shares split the CONVERTED 92.00, not the original 100.00');
    const v = await view(h, f);
    assert.equal(row(v, f.aliceRef).net, '46.00', '92.00 paid - 46.00 share');
    assert.equal(row(v, f.bobRef).net, '-46.00');
  });

  test('rateSource defaults to "manual" and rateDate defaults to the expense date when not given', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = ok(await G(h, f, 'alice', 'POST', { body: { description: 'x', date: '2026-09-11', amount: '50.00', currency: 'GBP', rate: '1.15', payers: [{ ref: f.aliceRef }], split: equal(f.aliceRef) } }), 201).expense;
    assert.equal(e.original.rateSource, 'manual');
    assert.equal(e.original.rateDate, '2026-09-11');
  });

  test('a mix of reporting-currency and foreign-currency expenses combine into one correct EUR balance', async () => {
    const h = harness();
    const f = await fixture(h);
    // A plain 40.00 EUR expense, and a 92.00-EUR-equivalent USD one, both paid by Alice and split evenly.
    await G(h, f, 'alice', 'POST', { body: { description: 'plain', amount: '40.00', payers: [{ ref: f.aliceRef }], split: equal(f.aliceRef, f.bobRef) } });
    await G(h, f, 'alice', 'POST', { body: { description: 'foreign', amount: '100.00', currency: 'USD', rate: '0.92', payers: [{ ref: f.aliceRef }], split: equal(f.aliceRef, f.bobRef) } });
    const v = await view(h, f);
    assert.equal(row(v, f.aliceRef).paid, '132.00', '40.00 + 92.00');
    assert.equal(row(v, f.aliceRef).net, '66.00', '132.00 paid - 66.00 share (half of 132.00)');
    assert.equal(row(v, f.bobRef).net, '-66.00');
  });

  test('correcting the amount reuses the same original currency and last rate unless a new one is given; the currency itself can never change; resubmitting only the rate (never the amount) changes nothing', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = ok(await G(h, f, 'alice', 'POST', { body: { description: 'x', amount: '100.00', currency: 'USD', rate: '0.90', payers: [{ ref: f.aliceRef, amount: '90.00' }], split: equal(f.aliceRef) } }), 201).expense;
    assert.equal(e.amount, '90.00');

    // Fixing a typo in the amount (still USD): the LAST rate (0.90) is reused automatically.
    const fixedAmount = ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: e.revision, reason: 'Typo', amount: '110.00', payers: [{ ref: f.aliceRef, amount: '99.00' }] } })).expense;
    assert.equal(fixedAmount.amount, '99.00', '110.00 USD at the same 0.90 rate');
    assert.equal(fixedAmount.original.amount, '110.00');
    assert.equal(fixedAmount.original.rate, '0.90');

    // Correcting with an explicitly different rate.
    const fixedRate = ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: fixedAmount.id, revision: fixedAmount.revision, reason: 'Better rate on record', amount: '110.00', rate: '0.95', payers: [{ ref: f.aliceRef, amount: '104.50' }] } })).expense;
    assert.equal(fixedRate.amount, '104.50', '110.00 USD at the corrected 0.95 rate');
    assert.equal(fixedRate.original.rate, '0.95');

    // The currency itself can never be changed on an existing expense.
    const changeCurrency = await G(h, f, 'alice', 'PATCH', { body: { expenseId: fixedRate.id, revision: fixedRate.revision, reason: 'Try to change currency', amount: '100.00', currency: 'GBP', rate: '1.15' } });
    assert.equal(changeCurrency.status, 400);
    assert.equal(changeCurrency.body.error.code, 'currency_locked');

    // "Changing rates later never changes a recorded expense": resubmitting ONLY a new rate, without
    // resubmitting the amount, is a no-op — nothing about the record changes at all.
    const untouched = ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: fixedRate.id, revision: fixedRate.revision, reason: 'Just a note', rate: '99.00', notes: 'A note' } })).expense;
    assert.equal(untouched.amount, '104.50', 'unaffected by the rate resubmitted alongside it');
    assert.equal(untouched.original.rate, '0.95', 'the recorded rate is untouched');
  });

  test('a plain reporting-currency expense can never be turned into a foreign one by correction, or the reverse — the currency is fixed at creation either way', async () => {
    const h = harness();
    const f = await fixture(h);
    const plain = ok(await G(h, f, 'alice', 'POST', { body: { description: 'x', amount: '50.00', payers: [{ ref: f.aliceRef }], split: equal(f.aliceRef) } }), 201).expense;
    assert.equal(plain.original, null);
    const toForeign = await G(h, f, 'alice', 'PATCH', { body: { expenseId: plain.id, revision: plain.revision, reason: 'Actually paid in USD', amount: '55.00', currency: 'USD', rate: '0.90' } });
    assert.equal(toForeign.status, 400);
    assert.equal(toForeign.body.error.code, 'currency_locked');

    const foreign = ok(await G(h, f, 'alice', 'POST', { body: { description: 'y', amount: '55.00', currency: 'USD', rate: '0.90', payers: [{ ref: f.aliceRef, amount: '49.50' }], split: equal(f.aliceRef) } }), 201).expense;
    const toPlain = await G(h, f, 'alice', 'PATCH', { body: { expenseId: foreign.id, revision: foreign.revision, reason: 'Actually in EUR all along', amount: '50.00', currency: 'EUR' } });
    assert.equal(toPlain.status, 400);
    assert.equal(toPlain.body.error.code, 'currency_locked');
  });

  test('the amendment history records the change to `original`, like any other tracked field', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = ok(await G(h, f, 'alice', 'POST', { body: { description: 'x', amount: '100.00', currency: 'USD', rate: '0.90', payers: [{ ref: f.aliceRef, amount: '90.00' }], split: equal(f.aliceRef) } }), 201).expense;
    const corrected = ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: e.revision, reason: 'Corrected rate', amount: '100.00', rate: '0.95', payers: [{ ref: f.aliceRef, amount: '95.00' }] } })).expense;
    const hist = ok(await G(h, f, 'alice', 'GET', { query: { ...f.q, action: 'history', expenseId: e.id } }));
    const last = hist.amendments[hist.amendments.length - 1];
    assert.ok(last.changes.some((c) => c.field === 'original'), 'the change to original is in the amendment trail');
    assert.equal(corrected.original.rate, '0.95');
  });
});
