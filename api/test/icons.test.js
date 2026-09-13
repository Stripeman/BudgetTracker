'use strict';
// BT-011-05 contextual icons: one catalogue of stable ids, site-admin management through a
// validated upload, permission-controlled choices stored by id, defaults by type, nothing deleted.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');
const icons = require('../_shared/icons');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 12h16"/><circle cx="12" cy="12" r="4"/></svg>';
const upload = (h, as, body = { label: 'Boat', svg: SVG }) => h.call('icons', 'POST', { as, query: { action: 'upload' }, body });
const cats = async (h, q, as) => ok(await h.call('categories', 'GET', { as, query: q })).categories;
const catPatch = (h, q, as, body) => h.call('categories', 'PATCH', { as, query: q, body });

describe('BT-011-05 the icon catalogue', () => {
  test('signed-in people read the catalogue; every built-in id is unique and the app\'s own icons are always on', async () => {
    const h = harness();
    await household(h);
    code(await h.call('icons', 'GET', {}), 401, 'unauthenticated');
    const { catalog, admin } = ok(await h.call('icons', 'GET', { as: 'bob' }));
    assert.equal(admin, false);
    assert.equal(new Set(catalog.builtIn.map((i) => i.id)).size, catalog.builtIn.length);
    for (const id of ['fallback', 'money-in', 'money-out', 'transfer', 'reversal']) assert.ok(catalog.builtIn.find((i) => i.id === id).system);
    assert.deepEqual(catalog.custom, []);
    assert.equal(catalog.fallback, 'fallback');
  });

  test('only site administrators add custom icons, and only through the validated upload', async () => {
    const h = harness();
    await household(h);
    assert.equal((await upload(h, 'alice')).status, 403, 'a workspace owner is not a site administrator');
    code(await upload(h, 'dave', { label: 'Bad', svg: '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>' }), 400, 'invalid_icon');
    code(await upload(h, 'dave', { label: 'Big', svg: `<svg viewBox="0 0 24 24"><path d="M0 0 ${'L1 1 '.repeat(2000)}"/></svg>` }), 400, 'invalid_icon');
    assert.deepEqual(ok(await h.call('icons', 'GET', { as: 'dave' })).catalog.custom, [], 'nothing is stored for a refused upload');
    const out = ok(await upload(h, 'dave'), 201);
    const boat = out.catalog.custom.find((c) => c.id === out.iconId);
    assert.deepEqual([boat.label, boat.status, boat.shapes.length], ['Boat', 'active', 2]);
    assert.ok(icons.CUSTOM_RE.test(out.iconId));
    const seen = ok(await h.call('icons', 'GET', { as: 'carol' })).catalog.custom;
    assert.deepEqual(seen.map((c) => c.id), [out.iconId], 'everyone signed in can draw it');
    assert.equal(seen[0].history, undefined, 'only administrators see who changed the catalogue');
  });

  test('custom icons are retired, never deleted; a retired icon keeps drawing where it is used', async () => {
    const h = harness();
    const f = await household(h);
    const { iconId } = ok(await upload(h, 'dave'), 201);
    const groceries = (await cats(h, f.q, 'alice')).find((c) => c.name === 'Groceries');
    ok(await catPatch(h, f.q, 'alice', { categoryId: groceries.id, icon: iconId }));
    assert.equal((await upload(h, 'alice')).status, 403);
    assert.equal((await h.call('icons', 'POST', { as: 'alice', query: { action: 'retire' }, body: { iconId } })).status, 403);
    const retired = ok(await h.call('icons', 'POST', { as: 'dave', query: { action: 'retire' }, body: { iconId, reason: 'Replaced' } }));
    assert.equal(retired.catalog.custom[0].status, 'retired');
    assert.equal((await h.call('icons', 'DELETE', { as: 'dave', body: { iconId } })).status, 405, 'there is no way to delete an icon');
    assert.equal((await cats(h, f.q, 'bob')).find((c) => c.id === groceries.id).icon, iconId, 'the category keeps its icon');
    const dining = (await cats(h, f.q, 'alice')).find((c) => c.name === 'Dining');
    code(await catPatch(h, f.q, 'alice', { categoryId: dining.id, icon: iconId }), 400, 'icon_unavailable');
    ok(await catPatch(h, f.q, 'alice', { categoryId: groceries.id, icon: iconId, name: 'Food' }), 200);
    const restored = ok(await h.call('icons', 'POST', { as: 'dave', query: { action: 'restore' }, body: { iconId } }));
    assert.deepEqual(restored.catalog.custom[0].history.map((x) => x.action), ['upload', 'retire', 'restore']);
    ok(await catPatch(h, f.q, 'alice', { categoryId: dining.id, icon: iconId }));
    ok(await h.call('icons', 'PATCH', { as: 'dave', body: { iconId, label: 'Sailing' } }));
    assert.equal(ok(await h.call('icons', 'GET', { as: 'bob' })).catalog.custom[0].label, 'Sailing');
  });

  test('built-in icons can be switched off for new choices, except the app\'s own; switching back on works', async () => {
    const h = harness();
    const f = await household(h);
    const entertainment = (await cats(h, f.q, 'alice')).find((c) => c.name === 'Entertainment');
    assert.equal(entertainment.icon, 'film');
    code(await h.call('icons', 'POST', { as: 'dave', query: { action: 'disable' }, body: { iconId: 'money-out' } }), 400, 'icon_system');
    ok(await h.call('icons', 'POST', { as: 'dave', query: { action: 'disable' }, body: { iconId: 'film' } }));
    assert.equal(ok(await h.call('icons', 'GET', { as: 'bob' })).catalog.builtIn.find((i) => i.id === 'film').enabled, false);
    assert.equal((await cats(h, f.q, 'alice')).find((c) => c.id === entertainment.id).icon, 'film', 'a default already in use keeps drawing');
    const dining = (await cats(h, f.q, 'alice')).find((c) => c.name === 'Dining');
    code(await catPatch(h, f.q, 'alice', { categoryId: dining.id, icon: 'film' }), 400, 'icon_unavailable');
    ok(await h.call('icons', 'POST', { as: 'dave', query: { action: 'enable' }, body: { iconId: 'film' } }));
    ok(await catPatch(h, f.q, 'alice', { categoryId: dining.id, icon: 'film' }));
  });

  test('stored catalogue data that is not safe shape data is never served', async () => {
    const h = harness();
    await household(h);
    await h.storage.putJson(icons.PATH, icons.stamp({ disabled: [], audit: [], custom: [{ id: 'ico_tampered01', label: 'X', status: 'active', shapes: [{ type: 'script', attrs: {} }] }] }));
    assert.deepEqual(ok(await h.call('icons', 'GET', { as: 'bob' })).catalog.custom, []);
  });
});

describe('BT-011-05 security review remediation', () => {
  test('SEC-I1 category names such as constructor or __proto__ never reach the object prototype', async () => {
    const h = harness();
    const f = await household(h);
    for (const name of ['constructor', 'toString']) {
      const c = ok(await h.call('categories', 'POST', { as: 'alice', query: f.q, body: { name } }), 201).category;
      assert.deepEqual([typeof c.icon, c.icon, c.defaultIcon], ['string', 'tag', 'tag'], name);
      assert.match(c.color, /^#[0-9a-f]{6}$/);
    }
    // A category stored before icons existed, with a prototype-like name and a corrupted icon.
    const path = `workspaces/${f.ws.id}/workspace.json`;
    const { value } = await h.storage.getJson(path);
    value.categories.push({ id: 'cat_legacyproto1', name: '__proto__', type: 'expense', archived: false, color: null, icon: { x: 1 } });
    await h.storage.putJson(path, value);
    const legacy = (await cats(h, f.q, 'bob')).find((c) => c.id === 'cat_legacyproto1');
    assert.deepEqual([legacy.icon, legacy.iconSource, legacy.defaultIcon], ['tag', 'default', 'tag']);
    const patched = ok(await catPatch(h, f.q, 'alice', { categoryId: 'cat_legacyproto1', name: 'Pets' })).category;
    assert.deepEqual([patched.icon, patched.defaultIcon], ['tag', 'tag'], 'the pinned default is a string id');
  });

  test('SEC-I2 retiring a custom icon frees a place in the working limit; nothing is deleted', async () => {
    const h = harness();
    await household(h);
    let last = null;
    for (let i = 0; i < icons.MAX_CUSTOM; i += 1) last = ok(await upload(h, 'dave', { label: `Icon ${i}`, svg: SVG }), 201).iconId;
    code(await upload(h, 'dave', { label: 'One more', svg: SVG }), 409, 'too_many_icons');
    ok(await h.call('icons', 'POST', { as: 'dave', query: { action: 'retire' }, body: { iconId: last } }));
    const out = ok(await upload(h, 'dave', { label: 'One more', svg: SVG }), 201);
    assert.equal(out.catalog.custom.length, icons.MAX_CUSTOM + 1, 'the retired icon is still stored');
    code(await h.call('icons', 'POST', { as: 'dave', query: { action: 'restore' }, body: { iconId: last } }), 409, 'too_many_icons');
  });
});

describe('BT-011-05 choosing icons', () => {
  test('categories: defaults by stable id; managers and owners choose; rename and archive keep the icon; null resets', async () => {
    const h = harness();
    const f = await household(h);
    const list = await cats(h, f.q, 'alice');
    const groceries = list.find((c) => c.name === 'Groceries');
    assert.deepEqual([groceries.icon, groceries.iconSource, groceries.defaultIcon], ['cart', 'default', 'cart']);
    assert.equal(list.find((c) => c.name === 'Salary').icon, 'briefcase');
    assert.equal((await catPatch(h, f.q, 'bob', { categoryId: groceries.id, icon: 'bag' })).status, 403);
    assert.equal((await catPatch(h, f.q, 'carol', { categoryId: groceries.id, icon: 'bag' })).status, 403);
    code(await catPatch(h, f.q, 'alice', { categoryId: groceries.id, icon: '<svg>' }), 400, 'invalid_icon');
    code(await catPatch(h, f.q, 'alice', { categoryId: groceries.id, icon: 'no-such-icon' }), 400, 'invalid_icon');
    code(await catPatch(h, f.q, 'alice', { categoryId: groceries.id, icon: 'ico_doesnotexist' }), 400, 'invalid_icon');
    const set = ok(await catPatch(h, f.q, 'alice', { categoryId: groceries.id, icon: 'bag' })).category;
    assert.deepEqual([set.icon, set.iconSource], ['bag', 'workspace']);
    const renamed = ok(await catPatch(h, f.q, 'alice', { categoryId: groceries.id, name: 'Food shopping', archived: true })).category;
    assert.deepEqual([renamed.name, renamed.archived, renamed.icon], ['Food shopping', true, 'bag']);
    const reset = ok(await catPatch(h, f.q, 'alice', { categoryId: groceries.id, icon: null })).category;
    assert.deepEqual([reset.icon, reset.iconSource], ['cart', 'default'], 'reset returns to the default it was created with, not one from the new name');
    const pets = ok(await h.call('categories', 'POST', { as: 'alice', query: f.q, body: { name: 'Pets', icon: 'paw' } }), 201).category;
    assert.deepEqual([pets.icon, pets.defaultIcon], ['paw', 'tag']);
    const bonus = ok(await h.call('categories', 'POST', { as: 'alice', query: f.q, body: { name: 'Bonus', type: 'income' } }), 201).category;
    assert.equal(bonus.icon, 'coins');
  });

  test('personal category icons live in the person\'s own preferences and never change anyone else\'s view', async () => {
    const h = harness();
    const f = await household(h);
    const groceries = (await cats(h, f.q, 'bob')).find((c) => c.name === 'Groceries');
    const bob = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { categoryIcons: { [groceries.id]: 'coffee' } } }));
    assert.deepEqual([bob.effective.categoryIcons, bob.sources.categoryIcons], [{ [groceries.id]: 'coffee' }, 'personal']);
    assert.deepEqual(ok(await h.call('preferences', 'GET', { as: 'alice' })).effective.categoryIcons, {});
    assert.equal((await cats(h, f.q, 'alice')).find((c) => c.id === groceries.id).icon, 'cart');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { categoryIcons: { [groceries.id]: 'nope' } } }), 400, 'invalid_icon');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { categoryIcons: { acc_123: 'coffee' } } }), 400, 'invalid_id');
    const reset = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { categoryIcons: null } }));
    assert.deepEqual([reset.effective.categoryIcons, reset.sources.categoryIcons], [{}, 'default']);
  });

  test('accounts: default by type; the owner of a private account chooses; changes keep before and after', async () => {
    const h = harness();
    const f = await household(h);
    const accounts = async (as) => ok(await h.call('accounts', 'GET', { as, query: f.q })).accounts;
    const card = (await accounts('bob')).find((a) => a.id === f.bobCard.id);
    assert.deepEqual([card.icon, card.iconSource], ['credit-card', 'default']);
    assert.equal((await accounts('alice')).find((a) => a.id === f.joint.id).icon, 'bank');
    const patch = (as, body) => h.call('accounts', 'PATCH', { as, query: f.q, body: { accountId: f.bobCard.id, revision: card.revision, ...body } });
    assert.equal((await patch('alice', { icon: 'wallet' })).status, 404, 'another member\'s private account stays invisible');
    assert.equal((await patch('dave', { icon: 'wallet' })).status, 404, 'a site administrator has no access');
    const changed = ok(await patch('bob', { icon: 'wallet' })).account;
    assert.deepEqual([changed.icon, changed.iconSource], ['wallet', 'record']);
    const created = ok(await h.call('accounts', 'POST', { as: 'bob', query: f.q, body: { name: 'Pocket', type: 'cash', currency: 'EUR', icon: 'coins' } }), 201).account;
    assert.equal(created.icon, 'coins');
    code(await h.call('accounts', 'POST', { as: 'bob', query: f.q, body: { name: 'Bad', type: 'cash', currency: 'EUR', icon: 'javascript:x' } }), 400, 'invalid_icon');
  });

  test('merchants, bills and budgets: defaults by type, chosen by whoever may edit them', async () => {
    const h = harness();
    const f = await household(h);
    const grocer = ok(await h.call('payees', 'GET', { as: 'alice', query: f.q })).payees.find((p) => p.id === f.merchants.grocer.id);
    assert.equal(grocer.icon, 'store');
    const shop = ok(await h.call('payees', 'POST', { as: 'alice', query: f.q, body: { name: 'Fictional Power', type: 'utility', visibility: 'shared' } }), 201).payee;
    assert.equal(shop.icon, 'bolt');
    const edited = ok(await h.call('payees', 'PATCH', { as: 'alice', query: f.q, body: { payeeId: shop.id, revision: shop.revision, icon: 'flame' } })).payee;
    assert.equal(edited.icon, 'flame');
    assert.deepEqual(edited.history.at(-1).changes, [{ field: 'icon', from: null, to: 'flame' }]);
    assert.equal((await h.call('payees', 'PATCH', { as: 'bob', query: f.q, body: { payeeId: shop.id, revision: edited.revision, icon: 'cart' } })).status, 403);
    // A merchant seen only through a shared entry shows a generic icon, never the owner's choice.
    ok(await h.call('payees', 'PATCH', { as: 'bob', query: f.q, body: { payeeId: f.merchants.jeweller.id, revision: 1, icon: 'diamond' } }));
    const bill = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Rent', billType: 'housing', accountId: f.joint.id, amount: '900.00', schedule: { freq: 'monthly', interval: 1, startDate: '2026-10-01' } } }), 201).recurring;
    assert.equal(bill.icon, 'home');
    const billChanged = ok(await h.call('recurring', 'PATCH', { as: 'alice', query: f.q, body: { recurringId: bill.id, revision: bill.revision, icon: 'building' } })).recurring;
    assert.deepEqual([billChanged.icon, billChanged.history.at(-1).fields], ['building', ['icon']]);
    assert.equal((await h.call('recurring', 'PATCH', { as: 'carol', query: f.q, body: { recurringId: bill.id, revision: billChanged.revision, icon: 'home' } })).status, 403);
    const categoryId = (await cats(h, f.q, 'alice')).find((c) => c.name === 'Groceries').id;
    const budget = ok(await h.call('budgets', 'POST', { as: 'bob', query: f.q, body: { name: 'Mine', lines: [{ categoryId, amount: '100' }] } }), 201).budget;
    assert.equal(budget.icon, 'target');
    const budgetChanged = ok(await h.call('budgets', 'PATCH', { as: 'bob', query: f.q, body: { budgetId: budget.id, revision: budget.revision, icon: 'piggy-bank' } })).budget;
    assert.equal(budgetChanged.icon, 'piggy-bank');
  });

  test('workspace type icons: owners and managers choose; members, outsiders and site administrators cannot', async () => {
    const h = harness();
    const f = await household(h);
    const q = f.q;
    const read = ok(await h.call('icons', 'GET', { as: 'bob', query: q }));
    assert.deepEqual([read.typeIcons, read.canEditTypeIcons], [{}, false]);
    assert.equal((await h.call('icons', 'GET', { as: 'eve', query: q })).status, 404);
    assert.equal((await h.call('icons', 'GET', { as: 'dave', query: q })).status, 404, 'site administration gives no workspace access');
    assert.equal((await h.call('icons', 'PATCH', { as: 'bob', query: q, body: { typeIcons: { 'account.checking': 'cash' } } })).status, 403);
    assert.equal((await h.call('icons', 'PATCH', { as: 'dave', query: q, body: { typeIcons: { 'account.checking': 'cash' } } })).status, 404);
    code(await h.call('icons', 'PATCH', { as: 'alice', query: q, body: { typeIcons: { 'account.spaceship': 'cash' } } }), 400, 'invalid_field');
    code(await h.call('icons', 'PATCH', { as: 'alice', query: q, body: { typeIcons: { 'account.checking': 'nope' } } }), 400, 'invalid_icon');
    assert.deepEqual(ok(await h.call('icons', 'PATCH', { as: 'alice', query: q, body: { typeIcons: { 'account.checking': 'cash', 'bill.housing': 'building' } } })).typeIcons, { 'account.checking': 'cash', 'bill.housing': 'building' });
    const joint = ok(await h.call('accounts', 'GET', { as: 'bob', query: q })).accounts.find((a) => a.id === f.joint.id);
    assert.deepEqual([joint.icon, joint.iconSource], ['cash', 'type']);
    assert.deepEqual(ok(await h.call('icons', 'PATCH', { as: 'alice', query: q, body: { typeIcons: { 'account.checking': null } } })).typeIcons, { 'bill.housing': 'building' });
    assert.equal(ok(await h.call('accounts', 'GET', { as: 'bob', query: q })).accounts.find((a) => a.id === f.joint.id).icon, 'bank');
  });
});
