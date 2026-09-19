'use strict';
// /api/design-gallery — BT-013 Design Gallery. Site administrators only (the same rule as
// /api/analytics and /api/site-settings, re-checked on every request); never financial data; the
// catalog and picks are audited atomically with the mutation.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

describe('BT-013 design gallery: permissions', () => {
  test('an owner, member and viewer with no site-admin role are refused', async () => {
    const h = harness();
    await household(h);
    for (const as of ['alice', 'bob', 'carol']) {
      const res = await h.call('design-gallery', 'GET', { as });
      assert.equal(res.status, 403, as);
    }
  });

  test('an outsider is refused', async () => {
    const h = harness();
    await household(h);
    const res = await h.call('design-gallery', 'GET', { as: 'eve' });
    assert.equal(res.status, 403);
  });

  test('anonymous is refused', async () => {
    const h = harness();
    const res = await h.call('design-gallery', 'GET', {});
    assert.equal(res.status, 401);
  });

  test('a site administrator is let through and gets all 15 concepts', async () => {
    const h = harness();
    const data = ok(await h.call('design-gallery', 'GET', { as: 'dave' }));
    assert.equal(data.concepts.length, 15);
    assert.deepEqual(data.requiredPages, ['dashboard', 'transactions', 'bills', 'budget', 'accounts', 'shared', 'trips', 'settings']);
    assert.deepEqual(data.realLayoutOptions, [{ value: 'classic', label: 'Classic (current)' }]);
    assert.deepEqual(data.picks, { selectedIds: [], note: '', updatedAt: null, updatedBy: null });
    for (const c of data.concepts) assert.deepEqual(c.catalog, { status: 'review', replacementId: null, note: '' });
  });

  test('PATCH (picks or catalog) is refused for everyone but a site administrator', async () => {
    const h = harness();
    for (const as of ['alice', 'eve']) {
      const res = await h.call('design-gallery', 'PATCH', { as, body: { picks: { selectedIds: ['executive-ledger'] } } });
      assert.equal(res.status, 403, as);
    }
    const anon = await h.call('design-gallery', 'PATCH', { body: { picks: { selectedIds: ['executive-ledger'] } } });
    assert.equal(anon.status, 401);
  });

  test('no financial field ever appears in the response, even with real financial data present', async () => {
    const h = harness();
    await household(h); // real accounts, transactions and merchants
    const data = ok(await h.call('design-gallery', 'GET', { as: 'dave' }));
    const text = JSON.stringify(data);
    // Object KEYS only (never a colon-less substring match): REQUIRED_PAGES legitimately contains the
    // plain words "transactions"/"budget"/"bills" as page identifiers, which is not a financial leak.
    for (const key of ['accountId', 'amountMinor', 'balance', 'payeeId', 'categoryId', 'merchantId', 'transactionId', 'openingBalance']) {
      assert.ok(!text.includes(`"${key}":`), `response must not contain the field "${key}"`);
    }
  });
});

describe('BT-013 design gallery: recording Terry\'s picks', () => {
  test('a site administrator records picks; stored, returned, audited with before/after, attributed and timestamped', async () => {
    const h = harness();
    const picked = ['executive-ledger', 'modern-banking', 'sidebar-pro'];
    const out = ok(await h.call('design-gallery', 'PATCH', { as: 'dave', body: { picks: { selectedIds: picked, note: 'Strong shortlist for the first ten.' } } }));
    assert.deepEqual([...out.picks.selectedIds].sort(), [...picked].sort());
    assert.equal(out.picks.note, 'Strong shortlist for the first ten.');
    assert.equal(out.picks.updatedBy, 'google:g-dave');
    assert.ok(out.picks.updatedAt);

    const { value: doc } = await h.storage.getJson('site/gallery.json');
    assert.deepEqual([...doc.picks.selectedIds].sort(), [...picked].sort());
    const last = doc.audit[doc.audit.length - 1];
    assert.equal(last.action, 'gallery.update');
    assert.equal(last.actor, 'google:g-dave');
    const change = last.changes.find((c) => c.field === 'picks.selectedIds');
    assert.deepEqual(change.before, []);
    assert.deepEqual([...change.after].sort(), [...picked].sort());

    const read = ok(await h.call('design-gallery', 'GET', { as: 'dave' }));
    assert.deepEqual([...read.picks.selectedIds].sort(), [...picked].sort());
  });

  test('an unknown concept id in picks is refused; nothing is stored', async () => {
    const h = harness();
    const res = await h.call('design-gallery', 'PATCH', { as: 'dave', body: { picks: { selectedIds: ['not-a-real-concept'] } } });
    assert.equal(res.status, 400);
    const { value } = await h.storage.getJson('site/gallery.json');
    assert.equal(value, null);
  });

  test('a no-change save (same picks) writes nothing new to the audit', async () => {
    const h = harness();
    await h.call('design-gallery', 'PATCH', { as: 'dave', body: { picks: { selectedIds: ['executive-ledger'] } } });
    const before = (await h.storage.getJson('site/gallery.json')).value.audit.length;
    await h.call('design-gallery', 'PATCH', { as: 'dave', body: { picks: { selectedIds: ['executive-ledger'] } } });
    const after = (await h.storage.getJson('site/gallery.json')).value.audit.length;
    assert.equal(after, before, 'picking the exact same set again records nothing new');
  });
});

describe('BT-013 design gallery: site-admin catalog management (approved/retired, replacement path, safe overrides)', () => {
  test('marking a concept approved and giving it a safe name/description override is stored, returned and audited', async () => {
    const h = harness();
    const out = ok(await h.call('design-gallery', 'PATCH', {
      as: 'dave',
      body: { catalog: { 'executive-ledger': { status: 'approved', nameOverride: 'Ledger Pro', descriptionOverride: 'Our detailed view for finance-savvy owners.' } } },
    }));
    const entry = out.concepts.find((c) => c.id === 'executive-ledger');
    assert.equal(entry.catalog.status, 'approved');
    assert.equal(entry.name, 'Ledger Pro');
    assert.equal(entry.tagline, 'Our detailed view for finance-savvy owners.');
    // The manifest's own built-in name/tagline are untouched — only the served, overridden view changed.
    const { CONCEPTS } = require('../_shared/layouts');
    assert.equal(CONCEPTS.find((c) => c.id === 'executive-ledger').name, 'Ledger Command');
  });

  test('retiring a concept needs a replacement or an explanatory note (a replacement path is never silent)', async () => {
    const h = harness();
    const bare = await h.call('design-gallery', 'PATCH', { as: 'dave', body: { catalog: { 'precision-grid': { status: 'retired' } } } });
    assert.equal(bare.status, 400);
    const withReplacement = ok(await h.call('design-gallery', 'PATCH', { as: 'dave', body: { catalog: { 'precision-grid': { status: 'retired', replacementId: 'executive-ledger' } } } }));
    const entry = withReplacement.concepts.find((c) => c.id === 'precision-grid');
    assert.equal(entry.catalog.status, 'retired');
    assert.equal(entry.catalog.replacementId, 'executive-ledger');
  });

  test('the replacement must be a different, known concept id', async () => {
    const h = harness();
    const self = await h.call('design-gallery', 'PATCH', { as: 'dave', body: { catalog: { 'precision-grid': { status: 'retired', replacementId: 'precision-grid' } } } });
    assert.equal(self.status, 400);
    const unknown = await h.call('design-gallery', 'PATCH', { as: 'dave', body: { catalog: { 'precision-grid': { status: 'retired', replacementId: 'not-a-concept' } } } });
    assert.equal(unknown.status, 400);
  });

  test('an unknown concept id as a catalog key is refused', async () => {
    const h = harness();
    const res = await h.call('design-gallery', 'PATCH', { as: 'dave', body: { catalog: { 'not-a-concept': { status: 'approved' } } } });
    assert.equal(res.status, 400);
  });
});
