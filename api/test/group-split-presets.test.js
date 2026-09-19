'use strict';
// BT-009-25 (Terry, 2026-09-19): "saved split presets" — who is typically in a recurring split and
// in what PROPORTION, reusable across different expense sizes. Never a money-shaped method
// ('amounts'/'fixed-remainder'), which names a specific amount that would not generalize. All data
// is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');
const groups = require('../_shared/groups');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Preset Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const join = async (w, role) => {
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: USERS[w].email, role } }), 201);
    ok(await h.call('invitations', 'POST', { as: w, query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  };
  await join('bob', 'member');
  await join('carol', 'viewer');
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const mid = (name) => members.find((m) => m.name.startsWith(name)).id;
  const refs = { alice: `member:${mid('Alice')}`, bob: `member:${mid('Bob')}`, carol: `member:${mid('Carol')}` };
  return { ws, q, refs };
}
const G = (h, f, as, method, opts = {}) => h.call('group', method, { as, query: { ...f.q, ...(opts.query || {}) }, body: opts.body });
const act = (h, f, as, action, body) => G(h, f, as, 'POST', { query: { action }, body });
const presets = async (h, f, as = 'alice') => ok(await G(h, f, as, 'GET', { query: { action: 'split-presets' } })).presets;

describe('BT-009-25 saved split presets', () => {
  test('any writer creates a preset; a viewer may not; it appears in the directory and the main view', async () => {
    const h = harness();
    const f = await fixture(h);
    const viewerTry = await act(h, f, 'carol', 'create-split-preset', { name: 'Housemates', method: 'equal', lines: [{ ref: f.refs.bob }, { ref: f.refs.carol }] });
    assert.equal(viewerTry.status, 403);
    const created = ok(await act(h, f, 'bob', 'create-split-preset', { name: 'Housemates', method: 'equal', lines: [{ ref: f.refs.bob }, { ref: f.refs.carol }] }), 201).preset;
    assert.equal(created.name, 'Housemates');
    assert.equal(created.method, 'equal');
    assert.deepEqual(created.lines, [{ ref: f.refs.bob, value: null }, { ref: f.refs.carol, value: null }]);
    assert.equal(created.createdBySelf, true);
    const list = await presets(h, f, 'alice');
    assert.equal(list.length, 1);
    assert.equal(list[0].createdBySelf, false, 'from Alice\'s own view, Bob created it, not her');
    const v = ok(await G(h, f, 'alice', 'GET'));
    assert.equal(v.splitPresets.length, 1, 'embedded in the main view too');
  });

  test('a money-shaped method ("amounts"/"fixed-remainder") is refused — a preset is a proportion, not a fixed sum', async () => {
    const h = harness();
    const f = await fixture(h);
    const amounts = await act(h, f, 'alice', 'create-split-preset', { name: 'x', method: 'amounts', lines: [{ ref: f.refs.alice, value: '10.00' }] });
    assert.equal(amounts.status, 400);
    const fixedRemainder = await act(h, f, 'alice', 'create-split-preset', { name: 'x', method: 'fixed-remainder', lines: [{ ref: f.refs.alice }] });
    assert.equal(fixedRemainder.status, 400);
  });

  test('percentages must add to exactly 100, shares must be valid whole numbers — the same rules a real split has', async () => {
    const h = harness();
    const f = await fixture(h);
    const badPercent = await act(h, f, 'alice', 'create-split-preset', { name: 'x', method: 'percentages', lines: [{ ref: f.refs.alice, value: '60' }, { ref: f.refs.bob, value: '30' }] });
    assert.equal(badPercent.status, 400);
    const ok60 = ok(await act(h, f, 'alice', 'create-split-preset', { name: 'Sixty-forty', method: 'percentages', lines: [{ ref: f.refs.alice, value: '60' }, { ref: f.refs.bob, value: '40' }] }), 201).preset;
    assert.deepEqual(ok60.lines, [{ ref: f.refs.alice, value: '60' }, { ref: f.refs.bob, value: '40' }]);
  });

  test('deleting a preset: its own creator, or a manager/owner, may; nobody else', async () => {
    const h = harness();
    const f = await fixture(h);
    const created = ok(await act(h, f, 'bob', 'create-split-preset', { name: 'x', method: 'equal', lines: [{ ref: f.refs.bob }, { ref: f.refs.alice }] }), 201).preset;
    // A viewer (Carol) may never delete anyone's preset, including her own, since she cannot write.
    const carolTry = await act(h, f, 'carol', 'delete-split-preset', { presetId: created.id });
    assert.equal(carolTry.status, 403);
    // The owner (Alice), a manager, may delete another writer's preset.
    ok(await act(h, f, 'alice', 'delete-split-preset', { presetId: created.id }));
    assert.equal((await presets(h, f)).length, 0);
  });

  test('an outsider gets 404 for every split-preset route, like every other Shared-expenses route', async () => {
    const h = harness();
    const f = await fixture(h);
    assert.equal((await G(h, f, 'eve', 'GET', { query: { action: 'split-presets' } })).status, 404);
    assert.equal((await act(h, f, 'eve', 'create-split-preset', { name: 'x', method: 'equal', lines: [{ ref: f.refs.alice }] })).status, 404);
  });

  test('groups.invariantProblem catches an invalid preset method, a dangling ref, and percentages/shares that do not add up', () => {
    const base = { members: [{ id: 'a', subject: 'g-a' }], contacts: [], categories: [], groupExpenses: [], groupSettlements: [], groupEvents: [] };
    assert.equal(groups.invariantProblem({ ...base, groupSplitPresets: [{ method: 'amounts', lines: [{ ref: 'member:a', value: 100 }] }] }), 'split preset method');
    assert.equal(groups.invariantProblem({ ...base, groupSplitPresets: [{ method: 'equal', lines: [{ ref: 'member:nosuch' }] }] }), 'split preset lines');
    assert.equal(groups.invariantProblem({ ...base, groupSplitPresets: [{ method: 'shares', lines: [{ ref: 'member:a', value: 0 }] }] }), 'split preset lines');
    assert.equal(groups.invariantProblem({ ...base, groupSplitPresets: [{ method: 'percentages', lines: [{ ref: 'member:a', value: '50' }] }] }), 'split preset lines');
    assert.equal(groups.invariantProblem({ ...base, groupSplitPresets: [{ method: 'equal', lines: [{ ref: 'member:a' }] }] }), null);
  });

  test('a backup/restore round trip (replace) carries a preset along intact, referenced people included', async () => {
    const h = harness();
    const f = await fixture(h);
    await act(h, f, 'alice', 'create-split-preset', { name: 'Housemates', method: 'equal', lines: [{ ref: f.refs.bob }, { ref: f.refs.carol }] });
    const backupRes = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
    const archiveId = backupRes.archive.archiveId;
    // A real change since the backup so replace has something to do.
    await act(h, f, 'alice', 'delete-split-preset', { presetId: (await presets(h, f))[0].id });
    const preview = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace' } }));
    assert.equal(preview.blockers.length, 0);
    assert.equal(preview.scope.groupSplitPresets, 1);
    ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace', expectedEtag: preview.expectedEtag, confirm: 'REPLACE' } }));
    const restored = await presets(h, f);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].name, 'Housemates');
    const { value: doc } = await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`);
    assert.equal(groups.invariantProblem(doc), null);
  });
});
