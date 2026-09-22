'use strict';
// BT-024 (Terry, 2026-09-23): personal colours and icons for account types and merchant types,
// mirroring BT-011-04/05's existing personal category colours/icons exactly — same mechanism, same
// validation, same "never anyone else's view, never the workspace's own record" guarantee, just for
// the other two workspace-scoped type registries (BT-019-02/03). All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const acctTypes = async (h, q, as) => (ok(await h.call('account-types', 'GET', { as, query: q }))).types;
const merchTypes = async (h, q, as) => (ok(await h.call('merchant-types', 'GET', { as, query: q }))).types;

describe('BT-024 personal account/merchant type colours and icons', () => {
  test('personal account type colours live in preferences, are validated, and never change the workspace record or anyone else\'s view', async () => {
    const h = harness();
    const f = await household(h);
    const checking = (await acctTypes(h, f.q, 'bob')).find((t) => t.accountingClass === 'checking');
    const bob = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { accountTypeColors: { [checking.id]: '#6366f1' } } }));
    assert.deepEqual([bob.effective.accountTypeColors, bob.sources.accountTypeColors], [{ [checking.id]: '#6366f1' }, 'personal']);
    assert.deepEqual(ok(await h.call('preferences', 'GET', { as: 'alice' })).effective.accountTypeColors, {});
    assert.equal((await acctTypes(h, f.q, 'alice')).find((t) => t.id === checking.id).color, checking.color, 'the workspace type is unchanged');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { accountTypeColors: { [checking.id]: '#fff' } } }), 400, 'invalid_color');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { accountTypeColors: { [checking.id]: '#fefefe' } } }), 400, 'color_contrast');
    // Only account type ids are accepted as keys — a category id, say, is refused.
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { accountTypeColors: { cat_123: '#dc2626' } } }), 400, 'invalid_id');
    const reset = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { accountTypeColors: null } }));
    assert.deepEqual([reset.effective.accountTypeColors, reset.sources.accountTypeColors], [{}, 'default']);
  });

  test('personal account type icons live in preferences, are validated, and never change anyone else\'s view', async () => {
    const h = harness();
    const f = await household(h);
    const checking = (await acctTypes(h, f.q, 'bob')).find((t) => t.accountingClass === 'checking');
    const bob = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { accountTypeIcons: { [checking.id]: 'coffee' } } }));
    assert.deepEqual([bob.effective.accountTypeIcons, bob.sources.accountTypeIcons], [{ [checking.id]: 'coffee' }, 'personal']);
    assert.deepEqual(ok(await h.call('preferences', 'GET', { as: 'alice' })).effective.accountTypeIcons, {});
    assert.equal((await acctTypes(h, f.q, 'alice')).find((t) => t.id === checking.id).icon, checking.icon);
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { accountTypeIcons: { [checking.id]: 'nope' } } }), 400, 'invalid_icon');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { accountTypeIcons: { cat_123: 'coffee' } } }), 400, 'invalid_id');
    const reset = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { accountTypeIcons: null } }));
    assert.deepEqual([reset.effective.accountTypeIcons, reset.sources.accountTypeIcons], [{}, 'default']);
  });

  test('personal merchant type colours live in preferences, are validated, and never change the workspace record or anyone else\'s view', async () => {
    const h = harness();
    const f = await household(h);
    const retailer = (await merchTypes(h, f.q, 'bob')).find((t) => t.merchantClass === 'retailer');
    const bob = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { merchantTypeColors: { [retailer.id]: '#6366f1' } } }));
    assert.deepEqual([bob.effective.merchantTypeColors, bob.sources.merchantTypeColors], [{ [retailer.id]: '#6366f1' }, 'personal']);
    assert.deepEqual(ok(await h.call('preferences', 'GET', { as: 'alice' })).effective.merchantTypeColors, {});
    assert.equal((await merchTypes(h, f.q, 'alice')).find((t) => t.id === retailer.id).color, retailer.color, 'the workspace type is unchanged');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { merchantTypeColors: { [retailer.id]: '#fff' } } }), 400, 'invalid_color');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { merchantTypeColors: { acc_123: '#dc2626' } } }), 400, 'invalid_id');
    const reset = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { merchantTypeColors: null } }));
    assert.deepEqual([reset.effective.merchantTypeColors, reset.sources.merchantTypeColors], [{}, 'default']);
  });

  test('personal merchant type icons live in preferences, are validated, and never change anyone else\'s view', async () => {
    const h = harness();
    const f = await household(h);
    const retailer = (await merchTypes(h, f.q, 'bob')).find((t) => t.merchantClass === 'retailer');
    const bob = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { merchantTypeIcons: { [retailer.id]: 'coffee' } } }));
    assert.deepEqual([bob.effective.merchantTypeIcons, bob.sources.merchantTypeIcons], [{ [retailer.id]: 'coffee' }, 'personal']);
    assert.deepEqual(ok(await h.call('preferences', 'GET', { as: 'alice' })).effective.merchantTypeIcons, {});
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { merchantTypeIcons: { [retailer.id]: 'nope' } } }), 400, 'invalid_icon');
    code(await h.call('preferences', 'PUT', { as: 'bob', body: { merchantTypeIcons: { acc_123: 'coffee' } } }), 400, 'invalid_id');
    const reset = ok(await h.call('preferences', 'PUT', { as: 'bob', body: { merchantTypeIcons: null } }));
    assert.deepEqual([reset.effective.merchantTypeIcons, reset.sources.merchantTypeIcons], [{}, 'default']);
  });
});
