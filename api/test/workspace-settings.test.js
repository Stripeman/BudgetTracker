'use strict';
// Workspace settings (Terry, 2026-09-14: "the user should be able to decide", then "build all 10").
// One validated list in the workspace document; every default is today's behaviour. Expected values
// here are written out by hand, never computed with the code under test. Fictional data only.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const docPath = (id) => `workspaces/${id}/workspace.json`;
const readDoc = async (h, id) => (await h.storage.getJson(docPath(id))).value;
async function editDoc(h, id, fn) {
  const { value } = await h.storage.getJson(docPath(id));
  fn(value);
  await h.storage.putJson(docPath(id), value);
}
const getWs = (h, as, id) => h.call('workspaces', 'GET', { as, query: { id } });
const patchSettings = (h, as, id, settings, reason) => h.call('workspaces', 'PATCH', { as, query: { id }, body: { settings, ...(reason ? { reason } : {}) } });
const valueOf = (ws, key) => { const s = ws.settingsList.find((x) => x.key === key); return s ? s.value : undefined; };

async function setup() {
  const h = harness();
  const f = await household(h);
  return { h, f, id: f.ws.id };
}

describe('Workspace settings: one list, today\'s behaviour by default', () => {
  test('every member gets every setting from the one list with a label, a plain explanation and its default; only owners and managers may change them', async () => {
    const { h, f, id } = await setup();
    const alice = ok(await getWs(h, 'alice', id)).workspace;
    const keys = alice.settingsList.map((s) => s.key);
    assert.ok(keys.includes('budgetPeriod') && keys.includes('weekStart'), keys.join(','));
    for (const s of alice.settingsList) {
      assert.ok(s.label.length > 5, `${s.key} label`);
      assert.ok(s.explanation.length > 40, `${s.key} explanation`);
      assert.deepEqual(s.value, s.default, `${s.key}: a new workspace has the default`);
    }
    assert.equal(valueOf(alice, 'budgetPeriod'), 'monthly');
    assert.equal(valueOf(alice, 'weekStart'), 1);
    // Only what budgets support is offered (the workspace used to accept "custom", which budgets refuse).
    assert.deepEqual(alice.settingsList.find((s) => s.key === 'budgetPeriod').options.map((o) => o.value), ['monthly', 'weekly', 'biweekly']);
    assert.deepEqual(alice.settingsList.find((s) => s.key === 'weekStart').options.map((o) => o.value), [1, 0, 6]);
    assert.ok(alice.settingsList.every((s) => s.canChange === true), 'the owner may change every setting');
    const bob = ok(await getWs(h, 'bob', id)).workspace;
    const carol = ok(await getWs(h, 'carol', id)).workspace;
    assert.ok(bob.settingsList.every((s) => s.canChange === false), 'a member sees them but cannot change them');
    assert.ok(carol.settingsList.every((s) => s.canChange === false), 'a viewer sees them but cannot change them');
    // The site administrator and an outsider learn nothing, not even that the workspace exists.
    assert.equal((await getWs(h, 'dave', id)).status, 404);
    assert.equal((await getWs(h, 'eve', id)).status, 404);
    void f;
  });

  test('the workspace summary carries the current values, so the app knows them without another request', async () => {
    const { h, id } = await setup();
    const listed = ok(await h.call('workspaces', 'GET', { as: 'bob' })).workspaces.find((w) => w.id === id);
    assert.equal(listed.settingValues.budgetPeriod, 'monthly');
    assert.equal(listed.settingValues.weekStart, 1);
    const me = ok(await h.call('me', 'GET', { as: 'carol' })).workspaces.find((w) => w.id === id);
    assert.equal(me.settingValues.budgetPeriod, 'monthly');
  });

  test('an owner\'s change is stored, kept in the workspace history with before, after, who and why, and audited in the same write; an unchanged save records nothing', async () => {
    const { h, id } = await setup();
    ok(await patchSettings(h, 'alice', id, { budgetPeriod: 'weekly', weekStart: 0 }, 'We plan by the week'));
    const doc = await readDoc(h, id);
    assert.equal(doc.settings.budgetPeriod, 'weekly');
    assert.equal(doc.settings.weekStart, 0);
    const last = doc.history[doc.history.length - 1];
    assert.deepEqual(last.changes, [{ field: 'settings.budgetPeriod', from: 'monthly', to: 'weekly' }, { field: 'settings.weekStart', from: 1, to: 0 }]);
    assert.equal(last.reason, 'We plan by the week');
    assert.equal(last.by, 'google:g-alice');
    const audits = doc.audit.filter((a) => a.action === 'workspace.update');
    assert.deepEqual(audits[audits.length - 1].fields, ['settings.budgetPeriod', 'settings.weekStart']);
    const historyLength = doc.history.length;
    const revision = doc.revision;
    ok(await patchSettings(h, 'alice', id, { budgetPeriod: 'weekly' }));
    const again = await readDoc(h, id);
    assert.equal(again.history.length, historyLength, 'no history entry for a save that changes nothing');
    assert.equal(again.revision, revision, 'nothing written');
    const seen = ok(await getWs(h, 'bob', id)).workspace;
    assert.equal(valueOf(seen, 'budgetPeriod'), 'weekly');
    assert.equal(valueOf(seen, 'weekStart'), 0);
  });

  test('members and viewers cannot change settings; the site administrator and outsiders get not found; nothing is written', async () => {
    const { h, id } = await setup();
    const before = (await readDoc(h, id)).revision;
    assert.equal((await patchSettings(h, 'bob', id, { budgetPeriod: 'weekly' })).status, 403);
    assert.equal((await patchSettings(h, 'carol', id, { budgetPeriod: 'weekly' })).status, 403);
    assert.equal((await patchSettings(h, 'dave', id, { budgetPeriod: 'weekly' })).status, 404);
    assert.equal((await patchSettings(h, 'eve', id, { budgetPeriod: 'weekly' })).status, 404);
    assert.equal((await readDoc(h, id)).revision, before);
  });

  test('unknown settings and values that are not allowed are refused and nothing is written', async () => {
    const { h, id } = await setup();
    const before = (await readDoc(h, id)).revision;
    const refused = [
      [{ budgetPeriod: 'custom' }, 'invalid_setting'], // accepted before, but budgets never supported it
      [{ budgetPeriod: 'daily' }, 'invalid_setting'],
      [{ weekStart: 3 }, 'invalid_setting'],
      [{ weekStart: '1' }, 'invalid_setting'],
      [{ noSuchSetting: true }, 'unknown_setting'],
      [{ budgetPeriod: 'weekly', noSuchSetting: 1 }, 'unknown_setting'],
    ];
    for (const [settings, code] of refused) {
      const res = await patchSettings(h, 'alice', id, settings);
      assert.equal(res.status, 400, JSON.stringify(settings));
      assert.equal(res.body.error.code, code, JSON.stringify(settings));
    }
    assert.equal((await readDoc(h, id)).revision, before);
  });
});

describe('Workspace settings: older documents, backups and restores', () => {
  test('a document without the settings reads the defaults; a stored "custom" budget period reads as monthly and still backs up', async () => {
    const { h, id } = await setup();
    await editDoc(h, id, (doc) => { delete doc.settings.budgetPeriod; delete doc.settings.weekStart; });
    let ws = ok(await getWs(h, 'alice', id)).workspace;
    assert.equal(valueOf(ws, 'budgetPeriod'), 'monthly');
    assert.equal(valueOf(ws, 'weekStart'), 1);
    await editDoc(h, id, (doc) => { doc.settings.budgetPeriod = 'custom'; });
    ws = ok(await getWs(h, 'alice', id)).workspace;
    assert.equal(valueOf(ws, 'budgetPeriod'), 'monthly');
    ok(await h.call('backups', 'POST', { as: 'alice', query: { workspaceId: id }, body: {} }), 201);
    // Choosing Monthly then stores it and records what was there before.
    ok(await patchSettings(h, 'alice', id, { budgetPeriod: 'monthly' }));
    const doc = await readDoc(h, id);
    assert.equal(doc.settings.budgetPeriod, 'monthly');
    assert.deepEqual(doc.history[doc.history.length - 1].changes, [{ field: 'settings.budgetPeriod', from: 'custom', to: 'monthly' }]);
  });

  test('a backup refuses a document whose settings hold a value no version accepted', async () => {
    const { h, id } = await setup();
    await editDoc(h, id, (doc) => { doc.settings.weekStart = 'someday'; });
    const res = await h.call('backups', 'POST', { as: 'alice', query: { workspaceId: id }, body: {} });
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /workspace settings/);
    await editDoc(h, id, (doc) => { doc.settings = ['not', 'an', 'object']; });
    assert.equal((await h.call('backups', 'POST', { as: 'alice', query: { workspaceId: id }, body: {} })).status, 422);
  });

  test('a create-new restore carries the settings like other workspace data; merge keeps the settings the workspace has now', async () => {
    const { h, id } = await setup();
    ok(await patchSettings(h, 'alice', id, { budgetPeriod: 'biweekly', weekStart: 6 }));
    h.clock.advance(60000);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: { workspaceId: id }, body: {} }), 201).archive.archiveId;
    h.clock.advance(60000);
    const created = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: id, archiveId, mode: 'create-new' } }), 201).workspace;
    const copy = ok(await getWs(h, 'alice', created.id)).workspace;
    assert.equal(valueOf(copy, 'budgetPeriod'), 'biweekly');
    assert.equal(valueOf(copy, 'weekStart'), 6);
    // Changed after the backup: a merge brings back missing records, never older settings.
    ok(await patchSettings(h, 'alice', id, { budgetPeriod: 'monthly' }));
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: id, archiveId, mode: 'merge' } }));
    if (pv.canExecute) ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: id, archiveId, mode: 'merge', expectedEtag: pv.expectedEtag } }));
    assert.equal(valueOf(ok(await getWs(h, 'alice', id)).workspace, 'budgetPeriod'), 'monthly');
  });
});
