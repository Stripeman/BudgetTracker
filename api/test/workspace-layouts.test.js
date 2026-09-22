'use strict';
// BT-013-16 — /api/workspace-layouts, the real per-workspace Layout Picker: members read the real
// catalogue for their workspace; owners/managers hide/restore a choice and set the workspace-default
// colour scheme, or explicitly publish their own personal colour choice as that default. Members
// below manager may read but never change anything here. No financial data is ever touched or
// returned. Fictional data only.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const get = (h, as, wsId) => h.call('workspace-layouts', 'GET', { as, query: { workspaceId: wsId } });
const patch = (h, as, wsId, body) => h.call('workspace-layouts', 'PATCH', { as, query: { workspaceId: wsId }, body });
const setLayoutId = (h, as, wsId, layoutId) => h.call('workspaces', 'PATCH', { as, query: { id: wsId }, body: { settings: { layoutId } } });

describe('BT-013-16 workspace-layouts: the real Layout Picker data for one workspace', () => {
  test('members only; an outsider and anonymous are refused; every member reads the same real catalogue', async () => {
    const h = harness();
    const { ws } = await household(h);
    assert.equal((await get(h, 'eve', ws.id)).status, 404, 'an outsider gets the same not-found as an unknown workspace');
    assert.equal((await h.call('workspace-layouts', 'GET', { query: { workspaceId: ws.id } })).status, 401);
    const carol = ok(await get(h, 'carol', ws.id));
    assert.equal(carol.currentLayoutId, 'classic');
    assert.deepEqual(carol.layouts.map((l) => l.id), ['classic', 'ledgerfly-forecast', 'finexa-budget', 'acru-overview']);
    assert.ok(carol.layouts.find((l) => l.id === 'classic').current);
    assert.equal(carol.canApply, false, 'a viewer may not apply');
    assert.equal(carol.canManage, false);
    assert.equal(carol.demoLayouts.length, 12, 'the other twelve Gallery concepts appear as demo-only');
    assert.ok(carol.demoLayouts.every((d) => d.demoOnly === true));
    assert.ok(!carol.demoLayouts.some((d) => ['classic', 'ledgerfly-forecast', 'finexa-budget', 'acru-overview'].includes(d.id)));
    const alice = ok(await get(h, 'alice', ws.id));
    assert.equal(alice.canManage, true);
  });

  test('hide removes a layout from this workspace\'s choices only; restore brings it back; classic can never be hidden; members below manager are refused', async () => {
    const h = harness();
    const { ws } = await household(h);
    assert.equal((await patch(h, 'bob', ws.id, { action: 'hide', layoutId: 'finexa-budget' })).status, 403, 'a member may not manage the workspace\'s layout choices');
    const bad = await patch(h, 'alice', ws.id, { action: 'hide', layoutId: 'classic' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'layout_system');
    const hidden = ok(await patch(h, 'alice', ws.id, { action: 'hide', layoutId: 'finexa-budget' }));
    assert.deepEqual(hidden.hiddenLayouts, ['finexa-budget']);
    const afterHide = ok(await get(h, 'alice', ws.id));
    assert.ok(afterHide.layouts.find((l) => l.id === 'finexa-budget').hidden);
    // A second workspace never sees the hide — it is scoped to this one workspace only.
    const other = await household(h);
    const otherView = ok(await get(h, 'alice', other.ws.id));
    assert.ok(!otherView.layouts.find((l) => l.id === 'finexa-budget').hidden);
    const restored = ok(await patch(h, 'alice', ws.id, { action: 'restore', layoutId: 'finexa-budget' }));
    assert.deepEqual(restored.hiddenLayouts, []);
  });

  test('workspace-default colours: manager+ sets and resets a per-layout scheme, validated for contrast; classic has no colour scheme to set', async () => {
    const h = harness();
    const { ws } = await household(h);
    const bad = await patch(h, 'alice', ws.id, { action: 'colors', layoutId: 'classic', colors: { light: '#3b82f6' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'invalid_layout');
    const lowContrast = await patch(h, 'alice', ws.id, { action: 'colors', layoutId: 'acru-overview', colors: { light: '#fefefe' } });
    assert.equal(lowContrast.status, 400);
    assert.equal(lowContrast.body.error.code, 'color_contrast');
    assert.equal((await patch(h, 'bob', ws.id, { action: 'colors', layoutId: 'acru-overview', colors: { light: '#123456' } })).status, 403, 'a member may not set the workspace default');
    const set = ok(await patch(h, 'alice', ws.id, { action: 'colors', layoutId: 'acru-overview', colors: { light: '#123456', dark: '#89abcd', preset: 'ocean' } }));
    assert.deepEqual(set.layoutColors['acru-overview'], { light: '#123456', dark: '#89abcd', preset: 'ocean' });
    const seen = ok(await get(h, 'carol', ws.id)).layouts.find((l) => l.id === 'acru-overview').workspaceColors;
    assert.deepEqual(seen, { light: '#123456', dark: '#89abcd', preset: 'ocean' });
    const reset = ok(await patch(h, 'alice', ws.id, { action: 'colors', layoutId: 'acru-overview', colors: null }));
    assert.equal(reset.layoutColors['acru-overview'], undefined);
  });

  test('publishing a personal colour choice as the workspace default is explicit, never automatic, and never silent', async () => {
    const h = harness();
    const { ws } = await household(h);
    const noneYet = await patch(h, 'alice', ws.id, { action: 'publish-personal-colors', layoutId: 'ledgerfly-forecast' });
    assert.equal(noneYet.status, 400);
    assert.equal(noneYet.body.error.code, 'no_personal_colors');
    ok(await h.call('preferences', 'PUT', { as: 'alice', body: { galleryDesignColors: { 'ledgerfly-forecast': { light: '#1a4d7a', dark: '#5aa3e8', preset: 'navy' } } } }));
    // Setting one's own personal choice never, by itself, changes the workspace default.
    const stillNone = ok(await get(h, 'alice', ws.id)).layouts.find((l) => l.id === 'ledgerfly-forecast');
    assert.equal(stillNone.workspaceColors, null);
    assert.deepEqual(stillNone.personalColors, { light: '#1a4d7a', dark: '#5aa3e8', preset: 'navy' });
    assert.equal((await patch(h, 'bob', ws.id, { action: 'publish-personal-colors', layoutId: 'ledgerfly-forecast' })).status, 403, 'a member may not publish a workspace default');
    const published = ok(await patch(h, 'alice', ws.id, { action: 'publish-personal-colors', layoutId: 'ledgerfly-forecast' }));
    assert.deepEqual(published.layoutColors['ledgerfly-forecast'], { light: '#1a4d7a', dark: '#5aa3e8', preset: 'navy' });
  });

  test('applying a layout stays the existing workspace settings PATCH; this route never duplicates that mechanism', async () => {
    const h = harness();
    const { ws } = await household(h);
    ok(await setLayoutId(h, 'alice', ws.id, 'finexa-budget'));
    const view = ok(await get(h, 'alice', ws.id));
    assert.equal(view.currentLayoutId, 'finexa-budget');
    assert.ok(view.layouts.find((l) => l.id === 'finexa-budget').current);
    assert.ok(!view.layouts.find((l) => l.id === 'classic').current);
  });
});
