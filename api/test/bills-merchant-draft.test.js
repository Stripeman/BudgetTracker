'use strict';
// Bills → Merchant fix (security/UX review, 2026-09-18, "confirmed bill/merchant defect"): a bill
// can now be saved with a typed-but-unmatched merchant name, kept in `payeeDraftName` — a field
// separate from the bill's own title (`name`) and from the canonical `payeeId` — instead of either
// refusing the save or silently guessing the bill's own name as the merchant. Selecting or creating
// a real merchant always resolves (clears) the pending name. All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household, merchant } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const monthly = (startDate) => ({ freq: 'monthly', startDate });
const create = (h, q, as, body) => h.call('recurring', 'POST', { as, query: q, body });
const list = async (h, q, as) => ok(await h.call('recurring', 'GET', { as, query: q }));
const find = async (h, q, as, id) => (await list(h, q, as)).recurring.find((r) => r.id === id);
const draftAction = (h, q, as, recurringId, occurrence) => h.call('recurring', 'GET', { as, query: { ...q, action: 'draft', recurringId, occurrence } });

describe('Bills → Merchant: a typed, unmatched merchant name is preserved (never guessed from the bill title)', () => {
  test('creating a bill with an unmatched typed merchant name saves it separately from the bill title, with no payeeId', async () => {
    const h = harness();
    const f = await household(h);
    const bill = ok(await create(h, f.q, 'alice', {
      name: 'September internet', billType: 'utilities', accountId: f.joint.id, amount: '45.00',
      schedule: monthly('2026-10-01'), payeeDraftName: 'Northstar Fiber',
    }), 201).recurring;
    assert.equal(bill.name, 'September internet', 'the bill title is untouched');
    assert.equal(bill.payeeId, null);
    assert.equal(bill.payeeName, '', 'no real merchant is linked, so the resolved name is empty');
    assert.equal(bill.payeeDraftName, 'Northstar Fiber', 'the typed name is kept as entered — never the bill title');
    assert.equal(bill.versions[0].payeeDraftName, 'Northstar Fiber');
  });

  test('selecting a real merchant instead of typing leaves no pending name', async () => {
    const h = harness();
    const f = await household(h);
    const isp = await merchant(h, f.q, 'alice', { name: 'Real ISP Co', visibility: 'shared' });
    const bill = ok(await create(h, f.q, 'alice', {
      name: 'September internet', billType: 'utilities', accountId: f.joint.id, amount: '45.00',
      schedule: monthly('2026-10-01'), payeeId: isp.id, payeeDraftName: 'ignored because a real merchant was chosen',
    }), 201).recurring;
    assert.equal(bill.payeeId, isp.id);
    assert.equal(bill.payeeName, 'Real ISP Co');
    assert.equal(bill.payeeDraftName, '', 'a resolved merchant always wins; the draft text is never kept alongside it');
  });

  test('later linking a real merchant to a pending bill resolves the pending state', async () => {
    const h = harness();
    const f = await household(h);
    const bill = ok(await create(h, f.q, 'alice', {
      name: 'September internet', billType: 'utilities', accountId: f.joint.id, amount: '45.00',
      schedule: monthly('2026-10-01'), payeeDraftName: 'Northstar Fiber',
    }), 201).recurring;
    const northstar = await merchant(h, f.q, 'alice', { name: 'Northstar Fiber', visibility: 'shared' });
    const patched = ok(await h.call('recurring', 'PATCH', {
      as: 'alice', query: f.q, body: { recurringId: bill.id, revision: bill.revision, effectiveFrom: '2026-10-01', payeeId: northstar.id },
    })).recurring;
    // effectiveFrom (2026-10-01) is after the harness's "today" (2026-09-13), so the TOP-LEVEL
    // current terms still show the earlier (pending) version — the same "not yet in effect" rule
    // every other term field already follows (api/_shared/bills.js termsAt); the new version itself
    // (always the latest one added) is where the resolved link actually is.
    const latest = patched.versions.at(-1);
    assert.equal(latest.payeeId, northstar.id);
    assert.equal(latest.payeeName, 'Northstar Fiber');
    assert.equal(latest.payeeDraftName, '', 'resolved — no longer pending');
  });

  test('patching only the draft name (no real merchant yet) keeps the bill pending and versions the change', async () => {
    const h = harness();
    const f = await household(h);
    const bill = ok(await create(h, f.q, 'alice', {
      name: 'September internet', billType: 'utilities', accountId: f.joint.id, amount: '45.00', schedule: monthly('2026-10-01'),
    }), 201).recurring;
    assert.equal(bill.payeeDraftName, '', 'no name typed yet');
    const patched = ok(await h.call('recurring', 'PATCH', {
      as: 'alice', query: f.q, body: { recurringId: bill.id, revision: bill.revision, effectiveFrom: '2026-10-01', payeeDraftName: 'Northstar Fiber' },
    })).recurring;
    assert.equal(patched.versions.length, 2, 'a new version was created for the term change');
    const latest = patched.versions.at(-1);
    assert.equal(latest.payeeId, null);
    assert.equal(latest.payeeDraftName, 'Northstar Fiber');
  });

  test('a duplicate typed name across two different bills is allowed — each bill keeps its own pending name', async () => {
    const h = harness();
    const f = await household(h);
    const a = ok(await create(h, f.q, 'alice', { name: 'Bill A', billType: 'custom', accountId: f.joint.id, amount: '10.00', schedule: monthly('2026-10-01'), payeeDraftName: 'Same Name Co' }), 201).recurring;
    const b = ok(await create(h, f.q, 'alice', { name: 'Bill B', billType: 'custom', accountId: f.joint.id, amount: '20.00', schedule: monthly('2026-10-01'), payeeDraftName: 'Same Name Co' }), 201).recurring;
    assert.equal(a.payeeDraftName, 'Same Name Co');
    assert.equal(b.payeeDraftName, 'Same Name Co');
    assert.notEqual(a.id, b.id);
  });

  test('a closed merchant cannot be newly linked to a bill, but a bill already linked to one keeps showing it', async () => {
    const h = harness();
    const f = await household(h);
    const shop = await merchant(h, f.q, 'alice', { name: 'Closing Soon Co', visibility: 'shared' });
    const bill = ok(await create(h, f.q, 'alice', {
      name: 'Subscription', billType: 'subscription', accountId: f.joint.id, amount: '9.99', schedule: monthly('2026-10-01'), payeeId: shop.id,
    }), 201).recurring;
    ok(await h.call('payees', 'POST', { as: 'alice', query: { ...f.q, action: 'archive' }, body: { payeeId: shop.id, revision: shop.revision } }));
    const stillShows = await find(h, f.q, 'alice', bill.id);
    assert.equal(stillShows.payeeId, shop.id, 'an already-linked closed merchant is kept, not silently dropped');
    // A DIFFERENT, brand-new bill cannot newly choose the now-closed merchant.
    const res = await create(h, f.q, 'alice', { name: 'Another bill', billType: 'subscription', accountId: f.joint.id, amount: '5.00', schedule: monthly('2026-10-01'), payeeId: shop.id });
    code(res, 400, 'merchant_closed');
  });

  test('a plain member without edit rights on someone else\'s shared bill cannot set a draft name', async () => {
    const h = harness();
    const f = await household(h);
    const bill = ok(await create(h, f.q, 'alice', { name: 'Alice\'s bill', billType: 'custom', accountId: f.joint.id, amount: '10.00', schedule: monthly('2026-10-01') }), 201).recurring;
    const res = await h.call('recurring', 'PATCH', { as: 'bob', query: f.q, body: { recurringId: bill.id, revision: bill.revision, effectiveFrom: '2026-10-01', payeeDraftName: 'Should be refused' } });
    assert.equal(res.status, 403);
  });

  test('a transfer bill refuses a draft merchant name, like it refuses a category or payee', async () => {
    const h = harness();
    const f = await household(h);
    const res = await create(h, f.q, 'alice', {
      name: 'Move to savings', billType: 'custom', kind: 'transfer', accountId: f.joint.id, toAccountId: f.aliceSavings.id,
      amount: '100.00', schedule: monthly('2026-10-01'), payeeDraftName: 'Should be refused',
    });
    code(res, 400, 'invalid_transfer');
  });

  test('the draft merchant name is length-validated like any other text field', async () => {
    const h = harness();
    const f = await household(h);
    const res = await create(h, f.q, 'alice', {
      name: 'Bill', billType: 'custom', accountId: f.joint.id, amount: '10.00', schedule: monthly('2026-10-01'),
      payeeDraftName: 'x'.repeat(200),
    });
    assert.equal(res.status, 400);
  });

  test('the review-before-record draft (GET ?action=draft) shows the pending name too', async () => {
    const h = harness();
    const f = await household(h);
    const bill = ok(await create(h, f.q, 'alice', {
      name: 'September internet', billType: 'utilities', accountId: f.joint.id, amount: '45.00',
      schedule: monthly('2026-10-01'), payeeDraftName: 'Northstar Fiber',
    }), 201).recurring;
    const d = ok(await draftAction(h, f.q, 'alice', bill.id, '2026-10-01')).draft;
    assert.equal(d.payeeId, null);
    assert.equal(d.payeeDraftName, 'Northstar Fiber');
  });

  test('a stale revision on a PATCH that only changes the draft name is still refused (concurrency is unaffected)', async () => {
    const h = harness();
    const f = await household(h);
    const bill = ok(await create(h, f.q, 'alice', { name: 'Bill', billType: 'custom', accountId: f.joint.id, amount: '10.00', schedule: monthly('2026-10-01') }), 201).recurring;
    const res = await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: bill.id, revision: bill.revision + 1, effectiveFrom: '2026-10-01', payeeDraftName: 'Stale' } });
    code(res, 409, 'stale_revision');
  });
});
