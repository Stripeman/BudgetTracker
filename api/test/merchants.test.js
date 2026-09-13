'use strict';
// BT-007-01 managed merchant directory, and BT-001-05 for merchants (never deleted; every change
// keeps its before/after values, author, time and reason). All names are fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household, merchant } = require('./helpers');
const { normalizeName } = require('../_shared/merchants');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const post = (h, q, as, body, action) => h.call('payees', 'POST', { as, query: action ? { ...q, action } : q, body });
const listed = async (h, q, as) => ok(await h.call('payees', 'GET', { as, query: q })).payees;
async function categories(h, q) {
  return Object.fromEntries(ok(await h.call('categories', 'GET', { as: 'alice', query: q })).categories.map((c) => [c.name, c.id]));
}

describe('BT-007-01 normalization and duplicates', () => {
  test('names normalize for search and duplicate detection', () => {
    assert.equal(normalizeName('  The Café & Bar, Ltd. '), 'cafe and bar');
    assert.equal(normalizeName('POWER-AND-LIGHT CO'), 'power and light');
    assert.equal(normalizeName("Joe's Garage GmbH"), 'joes garage');
    assert.equal(normalizeName('Co'), 'co', 'a name that is only a suffix is kept');
  });

  test('an exact duplicate in the same scope is refused with the existing merchant; similar names are suggested', async () => {
    const h = harness();
    const f = await household(h);
    const res = await post(h, f.q, 'alice', { name: 'fictional grocer ltd', visibility: 'shared' });
    code(res, 409, 'duplicate_merchant');
    assert.equal(res.body.error.details.id, f.merchants.grocer.id);
    const check = ok(await h.call('payees', 'GET', { as: 'alice', query: { ...f.q, action: 'check', name: 'Fictional Grocers', visibility: 'shared' } }));
    assert.deepEqual(check.exact, []);
    assert.deepEqual(check.similar.map((m) => m.id), [f.merchants.grocer.id]);
    const second = ok(await post(h, f.q, 'alice', { name: 'Fictional Grocer', visibility: 'shared', allowDuplicate: true }), 201);
    assert.notEqual(second.payee.id, f.merchants.grocer.id);
  });

  test('the duplicate check never reveals another member\'s private merchant', async () => {
    const h = harness();
    const f = await household(h);
    const check = ok(await h.call('payees', 'GET', { as: 'alice', query: { ...f.q, action: 'check', name: 'Secret Jeweller', visibility: 'private' } }));
    assert.deepEqual([check.exact, check.similar], [[], []]);
    ok(await post(h, f.q, 'alice', { name: 'Secret Jeweller' }), 201);
  });
});

describe('BT-007-01 merchant records', () => {
  test('a merchant stores type, contact details, customer number, dates, defaults, tags and notes', async () => {
    const h = harness();
    const f = await household(h);
    const cats = await categories(h, f.q);
    const m = ok(await post(h, f.q, 'alice', {
      name: 'Fictional Power', visibility: 'shared', type: 'utility',
      contact: { website: 'https://power.example.com', address: '1 Fictional Road\nTestville', phone: '+1 (555) 010-0000', email: 'billing@example.com' },
      customerNumber: 'CUST-0042', openedOn: '2020-03-01', defaultCategoryId: cats.Utilities, defaultAccountId: f.joint.id,
      defaultCurrency: 'EUR', tags: ['Home', 'energy'], notes: 'Meter in the basement',
    }), 201).payee;
    assert.deepEqual(
      { type: m.type, contact: m.contact, customerNumber: m.customerNumber, openedOn: m.openedOn, status: m.status, defaultCategoryId: m.defaultCategoryId, defaultAccountId: m.defaultAccountId, defaultCurrency: m.defaultCurrency, tags: m.tags, notes: m.notes, normalizedName: m.normalizedName },
      { type: 'utility', contact: { website: 'https://power.example.com', address: '1 Fictional Road\nTestville', phone: '+1 (555) 010-0000', email: 'billing@example.com' }, customerNumber: 'CUST-0042', openedOn: '2020-03-01', status: 'active', defaultCategoryId: cats.Utilities, defaultAccountId: f.joint.id, defaultCurrency: 'EUR', tags: ['home', 'energy'], notes: 'Meter in the basement', normalizedName: 'fictional power' },
    );
  });

  test('invalid details are refused', async () => {
    const h = harness();
    const f = await household(h);
    code(await post(h, f.q, 'alice', { name: 'A', contact: { website: 'javascript:alert(1)' } }), 400, 'invalid_field');
    code(await post(h, f.q, 'alice', { name: 'B', contact: { phone: 'call me' } }), 400, 'invalid_field');
    code(await post(h, f.q, 'alice', { name: 'C', contact: { email: 'not-an-email' } }), 400, 'invalid_email');
    code(await post(h, f.q, 'alice', { name: 'D', type: 'casino' }), 400, 'invalid_field');
    code(await post(h, f.q, 'alice', { name: 'E', defaultCurrency: 'XYZ' }), 400, 'invalid_currency');
    code(await post(h, f.q, 'alice', { name: 'F', visibility: 'shared', defaultAccountId: f.aliceSavings.id }), 400, 'invalid_default_account');
  });

  test('renaming keeps the stable id, records before and after values with the reason, and refuses stale edits', async () => {
    const h = harness();
    const f = await household(h);
    const renamed = ok(await h.call('payees', 'PATCH', { as: 'alice', query: f.q, body: { payeeId: f.merchants.grocer.id, revision: 1, name: 'Fictional Grocer Market', reason: 'Rebranded' } })).payee;
    assert.equal(renamed.revision, 2);
    assert.deepEqual(renamed.history.at(-1).changes, [{ field: 'name', from: 'Fictional Grocer', to: 'Fictional Grocer Market' }]);
    assert.equal(renamed.history.at(-1).reason, 'Rebranded');
    assert.equal(renamed.history.at(-1).by, 'Alice Fictional');
    const t = ok(await h.call('transactions', 'GET', { as: 'alice', query: f.q })).transactions.find((x) => x.id === f.grocery.id);
    assert.deepEqual([t.payeeId, t.payeeName], [f.merchants.grocer.id, 'Fictional Grocer Market']);
    code(await h.call('payees', 'PATCH', { as: 'alice', query: f.q, body: { payeeId: f.merchants.grocer.id, revision: 1, notes: 'x' } }), 409, 'stale_revision');
  });

  test('merchant defaults fill suggestions only where there is no history, and only accounts the person can use', async () => {
    const h = harness();
    const f = await household(h);
    const cats = await categories(h, f.q);
    const gym = await merchant(h, f.q, 'alice', { name: 'Fictional Gym', visibility: 'shared', defaultCategoryId: cats.Health, defaultAccountId: f.joint.id, defaultCurrency: 'EUR' });
    const s = ok(await h.call('payees', 'GET', { as: 'alice', query: { ...f.q, action: 'suggest', payeeId: gym.id } })).suggestion;
    assert.deepEqual([s.categoryId, s.accountId, s.currency], [cats.Health, f.joint.id, 'EUR']);
    assert.match(s.accountReason, /default account/);
    const carol = ok(await h.call('payees', 'GET', { as: 'carol', query: { ...f.q, action: 'suggest', payeeId: gym.id } })).suggestion;
    assert.equal(carol.accountId, null, 'a viewer cannot add entries, so no account is suggested');
  });
});

describe('BT-007-01 closing and reopening (never deleted)', () => {
  test('a closed merchant is excluded from new entries and bills but keeps its history; reopening restores it', async () => {
    const h = harness();
    const f = await household(h);
    const id = f.merchants.grocer.id;
    const closed = ok(await post(h, f.q, 'alice', { payeeId: id, revision: 1, reason: 'Store closed', closedOn: '2026-09-12' }, 'archive')).payee;
    assert.deepEqual([closed.status, closed.closedOn, closed.closeReason], ['closed', '2026-09-12', 'Store closed']);
    code(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '5.00', payeeId: id } }), 400, 'merchant_closed');
    code(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Box', accountId: f.joint.id, amount: '5.00', schedule: { freq: 'monthly', startDate: '2026-10-01' }, payeeId: id } }), 400, 'merchant_closed');
    // History is intact: the old entry keeps its merchant and totals, and editing that entry while
    // keeping its merchant still works.
    assert.deepEqual(ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, payeeId: id } })).transactions.map((x) => x.id), [f.grocery.id]);
    ok(await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: f.grocery.id, revision: 1, notes: 'Last visit', payeeId: id } }));
    assert.equal((await listed(h, f.q, 'alice')).find((m) => m.id === id).stats[0].gross, '82.40');
    assert.deepEqual((await listed(h, { ...f.q, status: 'active' }, 'alice')).map((m) => m.id), [], 'closed merchants drop out of the active list');
    const people = ok(await h.call('people', 'GET', { as: 'alice', query: { ...f.q, field: 'payee' } })).options;
    assert.ok(!people.some((o) => o.label === 'Fictional Grocer'), 'closed merchants are not offered for new entries');
    code(await post(h, f.q, 'alice', { payeeId: id, revision: closed.revision }, 'archive'), 409, 'already_closed');
    const reopened = ok(await post(h, f.q, 'alice', { payeeId: id, revision: closed.revision, reason: 'Reopened' }, 'reopen')).payee;
    assert.deepEqual([reopened.status, reopened.closedOn], ['active', null]);
    assert.deepEqual(reopened.history.map((x) => x.changes.map((c) => c.field).join(',')), ['create', 'status,closedOn,closeReason', 'status,closedOn,closeReason']);
    ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '5.00', payeeId: id } }), 201);
  });

  test('there is no way to delete a merchant', async () => {
    const h = harness();
    const f = await household(h);
    assert.equal((await h.call('payees', 'DELETE', { as: 'alice', query: f.q, body: { payeeId: f.merchants.grocer.id } })).status, 405);
    assert.ok((await listed(h, f.q, 'alice')).some((m) => m.id === f.merchants.grocer.id));
  });
});

describe('BT-007-01 permissions and privacy', () => {
  test('private merchants stay off shared records; viewers cannot add shared merchants; members cannot change a shared one they did not create', async () => {
    const h = harness();
    const f = await household(h);
    const mine = await merchant(h, f.q, 'alice', { name: 'Alice Only' });
    code(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '1.00', payeeId: mine.id } }), 400, 'invalid_payee');
    ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, kind: 'expense', amount: '1.00', payeeId: mine.id } }), 201);
    code(await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '1.00', payeeId: f.merchants.jeweller.id } }), 400, 'invalid_payee');
    assert.equal((await post(h, f.q, 'carol', { name: 'Carol Shared', visibility: 'shared' })).status, 403);
    assert.equal((await h.call('payees', 'PATCH', { as: 'bob', query: f.q, body: { payeeId: f.merchants.grocer.id, revision: 1, notes: 'x' } })).status, 403);
    assert.equal((await post(h, f.q, 'bob', { payeeId: f.merchants.grocer.id, revision: 1 }, 'archive')).status, 403);
  });

  test('a merchant seen only through a shared entry shows its name but none of the owner\'s details or defaults', async () => {
    const h = harness();
    const f = await household(h);
    const cats = await categories(h, f.q);
    ok(await h.call('payees', 'PATCH', { as: 'bob', query: f.q, body: { payeeId: f.merchants.jeweller.id, revision: 1, defaultCategoryId: cats.Shopping, customerNumber: 'VIP-7', contact: { phone: '555 0100' } } }));
    ok(await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: f.memberId('Alice'), capabilities: ['view-transactions'] } }), 201);
    const seen = (await listed(h, f.q, 'alice')).find((m) => m.id === f.merchants.jeweller.id);
    assert.equal(seen.referenceOnly, true);
    assert.deepEqual([seen.defaultCategoryId, seen.customerNumber, seen.contact, seen.history], [null, undefined, undefined, undefined]);
    const s = ok(await h.call('payees', 'GET', { as: 'alice', query: { ...f.q, action: 'suggest', payeeId: f.merchants.jeweller.id } })).suggestion;
    assert.equal(s.categoryId, null, 'the owner\'s default category is not revealed through a suggestion');
  });
});
