'use strict';
// BT-011-04 colour-coded expense types: accessible palette, defaults by stable id, permission-
// controlled workspace colours, personal colours in preferences, server-side validation, reset.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');
const colors = require('../_shared/colors');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const cats = async (h, q, as) => ok(await h.call('categories', 'GET', { as, query: q }));
const patch = (h, q, as, body) => h.call('categories', 'PATCH', { as, query: q, body });

describe('BT-011-04 category colours', () => {
  test('every palette colour is visible as a swatch on the light, dark and raised dark surfaces', () => {
    for (const p of colors.PALETTE) for (const s of colors.SURFACES) assert.ok(colors.contrast(p.hex, s) >= 3, `${p.id} on ${s}: ${colors.contrast(p.hex, s).toFixed(2)}`);
    assert.equal(new Set(colors.PALETTE.map((p) => p.hex)).size, colors.PALETTE.length, 'palette colours are distinct');
  });

  test('built-in categories get distinct defaults; a rename keeps the colour because it is stored by id', async () => {
    const h = harness();
    const f = await household(h);
    const { categories, palette } = await cats(h, f.q, 'alice');
    assert.equal(palette.length, colors.PALETTE.length, 'the palette comes from the server');
    const groceries = categories.find((c) => c.name === 'Groceries');
    assert.deepEqual([groceries.color, groceries.colorSource, groceries.defaultColor], ['#16a34a', 'default', '#16a34a']);
    assert.equal(new Set(categories.map((c) => c.color)).size, categories.length);
    const renamed = ok(await patch(h, f.q, 'alice', { categoryId: groceries.id, name: 'Food shopping' })).category;
    assert.deepEqual([renamed.name, renamed.color], ['Food shopping', '#16a34a']);
    const created = ok(await h.call('categories', 'POST', { as: 'alice', query: f.q, body: { name: 'Pets' } }), 201).category;
    assert.ok(colors.PALETTE.some((p) => p.hex === created.color), 'a new category gets a palette default');
  });

  test('workspace colours are for managers and owners, validated server-side, and reset to the default', async () => {
    const h = harness();
    const f = await household(h);
    const groceries = (await cats(h, f.q, 'alice')).categories.find((c) => c.name === 'Groceries');
    assert.equal((await patch(h, f.q, 'bob', { categoryId: groceries.id, color: '#dc2626' })).status, 403);
    assert.equal((await patch(h, f.q, 'carol', { categoryId: groceries.id, color: '#dc2626' })).status, 403);
    code(await patch(h, f.q, 'alice', { categoryId: groceries.id, color: 'blue' }), 400, 'invalid_color');
    code(await patch(h, f.q, 'alice', { categoryId: groceries.id, color: '#ffff00' }), 400, 'color_contrast');
    code(await patch(h, f.q, 'alice', { categoryId: groceries.id, color: '#111111' }), 400, 'color_contrast');
    const set = ok(await patch(h, f.q, 'alice', { categoryId: groceries.id, color: '#DC2626' })).category;
    assert.deepEqual([set.color, set.colorSource], ['#dc2626', 'workspace']);
    assert.equal((await cats(h, f.q, 'bob')).categories.find((c) => c.id === groceries.id).color, '#dc2626', 'every member sees the workspace colour');
    const reset = ok(await patch(h, f.q, 'alice', { categoryId: groceries.id, color: null })).category;
    assert.deepEqual([reset.color, reset.colorSource], ['#16a34a', 'default']);
  });

  test('personal colours live in preferences, are validated, and never change anyone else\'s view', async () => {
    const h = harness();
    const f = await household(h);
    const groceries = (await cats(h, f.q, 'bob')).categories.find((c) => c.name === 'Groceries');
    const bob = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { categoryColors: { [groceries.id]: '#6366f1' } } }));
    assert.deepEqual([bob.effective.categoryColors, bob.sources.categoryColors], [{ [groceries.id]: '#6366f1' }, 'personal']);
    assert.deepEqual(ok(await h.call('preferences', 'GET', { as: 'alice' })).effective.categoryColors, {});
    assert.equal((await cats(h, f.q, 'alice')).categories.find((c) => c.id === groceries.id).color, '#16a34a', 'the workspace colour is unchanged');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { categoryColors: { [groceries.id]: '#fff' } } }), 400, 'invalid_color');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { categoryColors: { [groceries.id]: '#fefefe' } } }), 400, 'color_contrast');
    // Only category ids are accepted as keys (the platform's safe JSON parsing already drops __proto__).
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { categoryColors: { acc_123: '#dc2626' } } }), 400, 'invalid_id');
    const reset = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { categoryColors: null } }));
    assert.deepEqual([reset.effective.categoryColors, reset.sources.categoryColors], [{}, 'default']);
  });
});

describe('BT-013-15 personal Design Gallery colour customization', () => {
  const { CONCEPT_IDS } = require('../_shared/layouts');

  test('each design\'s light/dark override is validated against its OWN mode\'s real surface, stored only in the caller\'s own preferences, and never affects anyone else', async () => {
    const h = harness();
    const f = await household(h);
    const id = CONCEPT_IDS[0];
    const bob = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { galleryDesignColors: { [id]: { light: '#1a2a7a', dark: '#8fa0f5', preset: 'navy' } } } }));
    assert.deepEqual(bob.effective.galleryDesignColors, { [id]: { light: '#1a2a7a', dark: '#8fa0f5', preset: 'navy' } });
    assert.equal(bob.sources.galleryDesignColors, 'personal');
    // Alice's own preferences, and the workspace itself, are completely untouched.
    assert.deepEqual(ok(await h.call('preferences', 'GET', { as: 'alice' })).effective.galleryDesignColors, {});
    // A light-mode colour is checked against the light surface, a dark-mode colour against the dark
    // surface — NEVER both against the same one, since each is only ever drawn in its own mode.
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { galleryDesignColors: { [id]: { light: '#fefefe' } } } }), 400, 'color_contrast');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { galleryDesignColors: { [id]: { dark: '#141a24' } } } }), 400, 'color_contrast');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { galleryDesignColors: { [id]: { light: 'blue' } } } }), 400, 'invalid_color');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { galleryDesignColors: { 'not-a-real-concept': { light: '#1a2a7a' } } } }), 400, 'invalid_id');
    const reset = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { galleryDesignColors: null } }));
    assert.deepEqual([reset.effective.galleryDesignColors, reset.sources.galleryDesignColors], [{}, 'default']);
  });
});
