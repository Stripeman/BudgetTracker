'use strict';
// BT-019-03 (Terry, 2026-09-19): workspace-scoped merchant TYPE definitions — a name, an editable
// colour and an optional icon, mapped to one of the fixed merchant classes this codebase already
// has, reusing the existing managed merchant directory (BT-007-01) rather than a second, incompatible
// merchant model. All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');
const merchants = require('../_shared/merchants');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const types = async (h, q, as = 'alice') => ok(await h.call('merchant-types', 'GET', { as, query: q })).types;
const createType = (h, q, as, body) => h.call('merchant-types', 'POST', { as, query: q, body });
const patchType = (h, q, as, body) => h.call('merchant-types', 'PATCH', { as, query: q, body });
const createMerch = (h, q, as, body) => h.call('payees', 'POST', { as, query: q, body });
const patchMerch = (h, q, as, body) => h.call('payees', 'PATCH', { as, query: q, body });

describe('BT-019-03 merchant types', () => {
  test('every fixed merchant class has a real, named, coloured, iconed system default, even before any real write', async () => {
    const h = harness();
    const f = await household(h);
    const list = await types(h, f.q);
    assert.equal(new Set(list.map((t) => t.merchantClass)).size, merchants.MERCHANT_TYPES.length);
    for (const c of merchants.MERCHANT_TYPES) {
      const t = list.find((x) => x.merchantClass === c);
      assert.ok(t, `system type for ${c}`);
      assert.equal(t.system, true);
      assert.equal(t.retired, false);
      assert.match(t.color, /^#[0-9a-f]{6}$/);
      assert.ok(t.icon, `${c} has a default icon`);
    }
  });

  test('a viewer may not create or change a merchant type; owners and managers may', async () => {
    const h = harness();
    const f = await household(h);
    code(await createType(h, f.q, 'carol', { name: 'Streaming', merchantClass: 'subscription' }), 403, 'forbidden');
    const t = ok(await createType(h, f.q, 'alice', { name: 'Streaming', merchantClass: 'subscription' }), 201).type;
    code(await patchType(h, f.q, 'carol', { typeId: t.id, name: 'x' }), 403, 'forbidden');
    const renamed = ok(await patchType(h, f.q, 'alice', { typeId: t.id, name: 'Streaming service' })).type;
    assert.equal(renamed.name, 'Streaming service');
  });

  test('a system type can never be retired, and its own class can never change; a custom type\'s class can change only while unused', async () => {
    const h = harness();
    const f = await household(h);
    const retailer = (await types(h, f.q)).find((t) => t.merchantClass === 'retailer');
    code(await patchType(h, f.q, 'alice', { typeId: retailer.id, retired: true }), 400, 'system_type_locked');
    code(await patchType(h, f.q, 'alice', { typeId: retailer.id, merchantClass: 'grocery' }), 400, 'system_type_locked');
    const t = ok(await createType(h, f.q, 'alice', { name: 'Streaming', merchantClass: 'subscription' }), 201).type;
    const changed = ok(await patchType(h, f.q, 'alice', { typeId: t.id, merchantClass: 'retailer' })).type;
    assert.equal(changed.merchantClass, 'retailer');
    const merch = ok(await createMerch(h, f.q, 'alice', { name: 'Fictional Streamer', merchantTypeId: t.id }), 201).payee;
    assert.equal(merch.type, 'retailer');
    code(await patchType(h, f.q, 'alice', { typeId: t.id, merchantClass: 'subscription' }), 409, 'merchant_type_in_use');
    const recoloured = ok(await patchType(h, f.q, 'alice', { typeId: t.id, name: 'Streaming Co', color: '#16a34a' })).type;
    assert.deepEqual([recoloured.name, recoloured.merchantClass], ['Streaming Co', 'retailer']);
    const merchAfter = (await h.call('payees', 'GET', { as: 'alice', query: f.q })).body.payees.find((p) => p.id === merch.id);
    assert.equal(merchAfter.type, 'retailer', 'the merchant\'s own canonical class never moved');
    assert.deepEqual([merchAfter.merchantType.name, merchAfter.merchantType.color], ['Streaming Co', '#16a34a']);
  });

  test('creating a merchant from a real merchantTypeId derives and validates its class; a mismatched or retired type is refused', async () => {
    const h = harness();
    const f = await household(h);
    const grocery = (await types(h, f.q)).find((t) => t.merchantClass === 'grocery');
    const merch = ok(await createMerch(h, f.q, 'alice', { name: 'Fictional Market', merchantTypeId: grocery.id }), 201).payee;
    assert.equal(merch.type, 'grocery');
    assert.equal(merch.merchantTypeId, grocery.id);
    code(await createMerch(h, f.q, 'alice', { name: 'Bad', merchantTypeId: grocery.id, type: 'retailer' }), 400, 'merchant_type_mismatch');
    code(await createMerch(h, f.q, 'alice', { name: 'Bad', merchantTypeId: 'mtype_nosuch' }), 400, 'invalid_merchant_type');
    const t = ok(await createType(h, f.q, 'alice', { name: 'Streaming', merchantClass: 'subscription' }), 201).type;
    ok(await patchType(h, f.q, 'alice', { typeId: t.id, retired: true }));
    code(await createMerch(h, f.q, 'alice', { name: 'Bad', merchantTypeId: t.id }), 400, 'invalid_merchant_type');
  });

  test('a plain `type` patch still works exactly as before, and clears any previously-chosen type record; picking a type by id updates type in one step', async () => {
    const h = harness();
    const f = await household(h);
    const grocery = (await types(h, f.q)).find((t) => t.merchantClass === 'grocery');
    const merch = ok(await createMerch(h, f.q, 'alice', { name: 'Fictional Store', merchantTypeId: grocery.id }), 201).payee;
    const retyped = ok(await patchMerch(h, f.q, 'alice', { payeeId: merch.id, revision: merch.revision, type: 'retailer' })).payee;
    assert.equal(retyped.type, 'retailer');
    assert.equal(retyped.merchantTypeId, null, 'setting the raw type directly clears the previously-chosen type record');
    const retailer = (await types(h, f.q)).find((t) => t.merchantClass === 'retailer');
    const reattached = ok(await patchMerch(h, f.q, 'alice', { payeeId: merch.id, revision: retyped.revision, merchantTypeId: retailer.id })).payee;
    assert.equal(reattached.merchantTypeId, retailer.id);
    assert.equal(reattached.type, 'retailer');
  });

  test('plain `type` with no merchantTypeId still works exactly as before, and shows no resolved merchant type', async () => {
    const h = harness();
    const f = await household(h);
    const merch = ok(await createMerch(h, f.q, 'alice', { name: 'Fictional Legacy', type: 'bank' }), 201).payee;
    assert.equal(merch.type, 'bank');
    assert.equal(merch.merchantTypeId, null);
    assert.equal(merch.merchantType, null);
  });

  test('merchant types survive a backup and a create-new restore', async () => {
    const h = harness();
    const f = await household(h);
    ok(await createType(h, f.q, 'alice', { name: 'Streaming', merchantClass: 'subscription', color: '#8b5cf6' }), 201);
    const backup = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
    const archiveId = backup.archive.archiveId;
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }));
    const res = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new', expectedEtag: pv.expectedEtag } }), 201);
    const newQ = { workspaceId: res.workspace.id };
    const restoredTypes = await types(h, newQ, 'alice');
    const restoredCustom = restoredTypes.find((x) => x.name === 'Streaming');
    assert.ok(restoredCustom, 'the custom type survived the restore');
    assert.equal(restoredCustom.color, '#8b5cf6');
  });
});
