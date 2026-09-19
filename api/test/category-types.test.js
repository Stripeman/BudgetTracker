'use strict';
// BT-019-01 (Terry, 2026-09-19): workspace-scoped category TYPE definitions — a name, an editable
// colour and an optional icon, mapped to one of the two fixed category classes (expense/income) this
// codebase already has. The type is presentation; the class drives every income/expense rule
// elsewhere, kept strictly separate — renaming or recolouring a type never touches a single
// category, and a category's own fixed `type` can never be silently reinterpreted through it. All
// data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const types = async (h, q, as = 'alice') => ok(await h.call('category-types', 'GET', { as, query: q })).types;
const createType = (h, q, as, body) => h.call('category-types', 'POST', { as, query: q, body });
const patchType = (h, q, as, body) => h.call('category-types', 'PATCH', { as, query: q, body });
const createCat = (h, q, as, body) => h.call('categories', 'POST', { as, query: q, body });
const patchCat = (h, q, as, body) => h.call('categories', 'PATCH', { as, query: q, body });

describe('BT-019-01 category types', () => {
  test('both fixed category classes (expense, income) have a real, named, coloured, iconed system default, even before any real write', async () => {
    const h = harness();
    const f = await household(h);
    const list = await types(h, f.q);
    assert.deepEqual(list.map((t) => t.categoryClass).sort(), ['expense', 'income']);
    for (const t of list) {
      assert.equal(t.system, true);
      assert.equal(t.retired, false);
      assert.match(t.color, /^#[0-9a-f]{6}$/);
      assert.ok(t.icon);
    }
    assert.equal(list.find((t) => t.categoryClass === 'expense').name, 'Expense');
  });

  test('a viewer may not create or change a category type; owners and managers may', async () => {
    const h = harness();
    const f = await household(h);
    code(await createType(h, f.q, 'carol', { name: 'Essential', categoryClass: 'expense' }), 403, 'forbidden');
    const t = ok(await createType(h, f.q, 'alice', { name: 'Essential', categoryClass: 'expense' }), 201).type;
    code(await patchType(h, f.q, 'carol', { typeId: t.id, name: 'x' }), 403, 'forbidden');
    const renamed = ok(await patchType(h, f.q, 'alice', { typeId: t.id, name: 'Essential spending' })).type;
    assert.equal(renamed.name, 'Essential spending');
  });

  test('a system type can never be retired, and its own class can never change; a custom type\'s class can change only while unused', async () => {
    const h = harness();
    const f = await household(h);
    const expense = (await types(h, f.q)).find((t) => t.categoryClass === 'expense');
    code(await patchType(h, f.q, 'alice', { typeId: expense.id, retired: true }), 400, 'system_type_locked');
    code(await patchType(h, f.q, 'alice', { typeId: expense.id, categoryClass: 'income' }), 400, 'system_type_locked');
    const t = ok(await createType(h, f.q, 'alice', { name: 'Passive income', categoryClass: 'income' }), 201).type;
    const changed = ok(await patchType(h, f.q, 'alice', { typeId: t.id, categoryClass: 'expense' })).type;
    assert.equal(changed.categoryClass, 'expense');
    const cat = ok(await createCat(h, f.q, 'alice', { name: 'Fictional Category', categoryTypeId: t.id }), 201).category;
    assert.equal(cat.type, 'expense');
    code(await patchType(h, f.q, 'alice', { typeId: t.id, categoryClass: 'income' }), 409, 'category_type_in_use');
    // Renaming/recolouring the same, now-in-use type is unaffected, and the category's own type is untouched.
    const recoloured = ok(await patchType(h, f.q, 'alice', { typeId: t.id, name: 'Everyday', color: '#16a34a' })).type;
    assert.deepEqual([recoloured.name, recoloured.categoryClass], ['Everyday', 'expense']);
    const catAfter = (await h.call('categories', 'GET', { as: 'alice', query: f.q })).body.categories.find((c) => c.id === cat.id);
    assert.equal(catAfter.type, 'expense', 'the category\'s own canonical class never moved');
    assert.deepEqual([catAfter.categoryType.name, catAfter.categoryType.color], ['Everyday', '#16a34a']);
  });

  test('creating a category from a real categoryTypeId derives and validates its class; a mismatched or retired type is refused', async () => {
    const h = harness();
    const f = await household(h);
    const income = (await types(h, f.q)).find((t) => t.categoryClass === 'income');
    const cat = ok(await createCat(h, f.q, 'alice', { name: 'Fictional Bonus', categoryTypeId: income.id }), 201).category;
    assert.equal(cat.type, 'income');
    assert.equal(cat.categoryTypeId, income.id);
    code(await createCat(h, f.q, 'alice', { name: 'Bad', categoryTypeId: income.id, type: 'expense' }), 400, 'category_type_mismatch');
    code(await createCat(h, f.q, 'alice', { name: 'Bad', categoryTypeId: 'ctype_nosuch' }), 400, 'invalid_category_type');
    const t = ok(await createType(h, f.q, 'alice', { name: 'Side hustle', categoryClass: 'income' }), 201).type;
    ok(await patchType(h, f.q, 'alice', { typeId: t.id, retired: true }));
    code(await createCat(h, f.q, 'alice', { name: 'Bad', categoryTypeId: t.id }), 400, 'invalid_category_type');
  });

  test('a category\'s own fixed type can never be reinterpreted through categoryTypeId: attaching a type of the wrong class is refused', async () => {
    const h = harness();
    const f = await household(h);
    const cat = ok(await createCat(h, f.q, 'alice', { name: 'Fictional Rent', type: 'expense' }), 201).category;
    const income = (await types(h, f.q)).find((t) => t.categoryClass === 'income');
    code(await patchCat(h, f.q, 'alice', { categoryId: cat.id, categoryTypeId: income.id }), 400, 'category_type_mismatch');
    const expense = (await types(h, f.q)).find((t) => t.categoryClass === 'expense');
    const patched = ok(await patchCat(h, f.q, 'alice', { categoryId: cat.id, categoryTypeId: expense.id })).category;
    assert.equal(patched.categoryTypeId, expense.id);
    assert.equal(patched.type, 'expense');
  });

  test('plain `type` with no categoryTypeId still works exactly as before, and shows no resolved category type', async () => {
    const h = harness();
    const f = await household(h);
    const cat = ok(await createCat(h, f.q, 'alice', { name: 'Fictional Legacy', type: 'income' }), 201).category;
    assert.equal(cat.type, 'income');
    assert.equal(cat.categoryTypeId, null);
    assert.equal(cat.categoryType, null);
  });

  test('category types survive a backup and a create-new restore', async () => {
    const h = harness();
    const f = await household(h);
    ok(await createType(h, f.q, 'alice', { name: 'Essential', categoryClass: 'expense', color: '#8b5cf6' }), 201);
    const backup = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
    const archiveId = backup.archive.archiveId;
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }));
    const res = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new', expectedEtag: pv.expectedEtag } }), 201);
    const newQ = { workspaceId: res.workspace.id };
    const restoredTypes = await types(h, newQ, 'alice');
    const restoredCustom = restoredTypes.find((x) => x.name === 'Essential');
    assert.ok(restoredCustom, 'the custom type survived the restore');
    assert.equal(restoredCustom.color, '#8b5cf6');
  });
});
