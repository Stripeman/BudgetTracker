'use strict';
// BT-001-05 contacts are never deleted: edits keep before/after values, archiving and restoring are
// recorded with their reason, archived contacts leave people selectors but keep every reference,
// and private contacts keep a history only their owner can see. All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

describe('BT-001-05 contact lifecycle', () => {
  test('a shared contact keeps before/after values, can be archived with a reason and restored', async () => {
    const h = harness();
    const f = await household(h);
    const c = ok(await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'workspace', workspaceId: f.ws.id, name: 'Fictional Plumber' } }), 201).contact;
    ok(await h.call('contacts', 'PATCH', { as: 'alice', body: { scope: 'workspace', workspaceId: f.ws.id, contactId: c.id, email: 'plumber@example.com', reason: 'New email' } }));
    ok(await h.call('contacts', 'DELETE', { as: 'alice', body: { scope: 'workspace', workspaceId: f.ws.id, contactId: c.id, reason: 'Retired' } }));
    const people = ok(await h.call('people', 'GET', { as: 'alice', query: { ...f.q, field: 'participant' } })).options;
    assert.ok(!people.some((o) => o.label === 'Fictional Plumber'), 'archived contacts leave people selectors');
    assert.deepEqual(ok(await h.call('contacts', 'GET', { as: 'alice', query: f.q })).shared.map((x) => x.name), [], 'hidden from the default list');
    const archived = ok(await h.call('contacts', 'GET', { as: 'alice', query: { ...f.q, includeArchived: '1' } })).shared.find((x) => x.id === c.id);
    assert.equal(archived.archived, true);
    const restored = ok(await h.call('contacts', 'POST', { as: 'alice', query: { action: 'restore' }, body: { scope: 'workspace', workspaceId: f.ws.id, contactId: c.id } })).contact;
    assert.equal(restored.archived, false);
    assert.deepEqual(restored.history.map((x) => [x.by, x.changes.map((ch) => `${ch.field}:${ch.from}->${ch.to}`).join(','), x.reason]), [
      ['Alice Fictional', 'create:undefined->undefined', ''],
      ['Alice Fictional', 'email:->plumber@example.com', 'New email'],
      ['Alice Fictional', 'archived:false->true', 'Retired'],
      ['Alice Fictional', 'archived:true->false', ''],
    ]);
  });

  test('a private contact keeps its own history, visible only to its owner, and can be restored', async () => {
    const h = harness();
    await household(h);
    const c = ok(await h.call('contacts', 'POST', { as: 'bob', body: { scope: 'private', name: 'Fictional Aunt' } }), 201).contact;
    ok(await h.call('contacts', 'PATCH', { as: 'bob', body: { scope: 'private', contactId: c.id, name: 'Fictional Aunt May' } }));
    ok(await h.call('contacts', 'DELETE', { as: 'bob', body: { scope: 'private', contactId: c.id } }));
    const restored = ok(await h.call('contacts', 'POST', { as: 'bob', query: { action: 'restore' }, body: { scope: 'private', contactId: c.id } })).contact;
    assert.deepEqual(restored.history.map((x) => x.changes[0].field), ['create', 'name', 'archived', 'archived']);
    assert.equal(restored.history[1].changes[0].from, 'Fictional Aunt');
    assert.deepEqual(ok(await h.call('contacts', 'GET', { as: 'alice' })).private, [], 'never visible to anyone else');
  });

  test('only the creator or a manager can archive a shared contact', async () => {
    const h = harness();
    const f = await household(h);
    const c = ok(await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'workspace', workspaceId: f.ws.id, name: 'Fictional Builder' } }), 201).contact;
    assert.equal((await h.call('contacts', 'DELETE', { as: 'bob', body: { scope: 'workspace', workspaceId: f.ws.id, contactId: c.id } })).status, 403);
  });
});
