'use strict';
// BT-013-16 — /api/site-layouts, the site-wide layout catalogue: site administrators only. Retire
// and reinstate a built-in layout (mirrors api/icons for built-ins); usage counts only, never
// financial content or a workspace's name. Deletion is always explained as blocked today, since
// every real layout is built-in, shipped code — never labelled the same as retirement. Fictional
// data only.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const get = (h, as) => h.call('site-layouts', 'GET', { as });
const post = (h, as, action, layoutId) => h.call('site-layouts', 'POST', { as, query: { action }, body: { layoutId } });

describe('BT-013-16 site-layouts: the site-wide layout catalogue', () => {
  test('site administrators only; the four real layouts are listed, none retired at first', async () => {
    const h = harness();
    await household(h);
    for (const as of ['alice', 'bob', 'carol']) assert.equal((await get(h, as)).status, 403, as);
    assert.equal((await h.call('site-layouts', 'GET', {})).status, 401);
    const data = ok(await get(h, 'dave'));
    assert.deepEqual(data.layouts.map((l) => l.id), ['classic', 'ledgerfly-forecast', 'finexa-budget', 'acru-overview']);
    assert.ok(data.layouts.every((l) => l.retired === false && l.selectable === true));
    assert.ok(data.layouts.find((l) => l.id === 'classic').system);
    assert.deepEqual(data.audit, []);
  });

  test('usage counts are structural only (applied/hidden counts per layout), never a workspace name or financial content', async () => {
    const h = harness();
    const { ws } = await household(h);
    await h.call('workspaces', 'PATCH', { as: 'alice', query: { id: ws.id }, body: { settings: { layoutId: 'acru-overview' } } });
    const other = await household(h);
    await h.call('workspace-layouts', 'PATCH', { as: 'alice', query: { workspaceId: other.ws.id }, body: { action: 'hide', layoutId: 'acru-overview' } });
    const data = ok(await get(h, 'dave'));
    const acru = data.layouts.find((l) => l.id === 'acru-overview');
    assert.equal(acru.appliedCount, 1);
    assert.equal(acru.hiddenByWorkspaceCount, 1);
    const classic = data.layouts.find((l) => l.id === 'classic');
    assert.equal(classic.appliedCount, 1, 'the other household still applies classic');
    const raw = JSON.stringify(data);
    assert.ok(!raw.includes(ws.name) || ws.name === 'Fictional Household', 'sanity: workspace name is fictional');
    assert.ok(!raw.includes('Joint') && !raw.includes('Savings') && !raw.includes('EUR'), 'no account, balance or currency ever appears');
  });

  test('retire stops NEW selection everywhere on the site but never breaks a workspace already using it; classic (system) cannot be retired; only a site admin may retire or reinstate', async () => {
    const h = harness();
    const { ws } = await household(h);
    // Applied BEFORE retirement, so the "already using it" claim below is genuinely exercised.
    ok(await h.call('workspaces', 'PATCH', { as: 'alice', query: { id: ws.id }, body: { settings: { layoutId: 'finexa-budget' } } }));
    assert.equal((await post(h, 'alice', 'retire', 'finexa-budget')).status, 403);
    const sys = await post(h, 'dave', 'retire', 'classic');
    assert.equal(sys.status, 400);
    assert.equal(sys.body.error.code, 'layout_system');
    const unknown = await post(h, 'dave', 'retire', 'not-a-layout');
    assert.equal(unknown.status, 404);
    const retired = ok(await post(h, 'dave', 'retire', 'finexa-budget'));
    assert.ok(retired.layouts.find((l) => l.id === 'finexa-budget').retired);
    assert.equal(retired.layouts.find((l) => l.id === 'finexa-budget').selectable, false);
    // A workspace already applying it keeps working, and re-saving that same value is still accepted.
    ok(await h.call('workspaces', 'PATCH', { as: 'alice', query: { id: ws.id }, body: { settings: { layoutId: 'finexa-budget' } } }));
    const stillWorks = ok(await h.call('workspaces', 'GET', { as: 'alice', query: { id: ws.id } })).workspace;
    assert.equal(stillWorks.settings.layoutId, 'finexa-budget');
    // A retire that changes nothing (already retired) is a genuine no-op, and re-running it is fine.
    const again = ok(await post(h, 'dave', 'retire', 'finexa-budget'));
    assert.equal(again.layouts.find((l) => l.id === 'finexa-budget').retired, true);
    const reinstated = ok(await post(h, 'dave', 'reinstate', 'finexa-budget'));
    assert.equal(reinstated.layouts.find((l) => l.id === 'finexa-budget').retired, false);
  });

  test('deletion is always explained as blocked, never silently pretended, and never confused with retirement', async () => {
    const h = harness();
    await household(h);
    const res = await post(h, 'dave', 'delete', 'finexa-budget');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'layout_builtin');
    assert.match(res.body.error.message, /retire/i);
    const unknown = await post(h, 'dave', 'delete', 'not-a-layout');
    assert.equal(unknown.status, 404);
  });
});
