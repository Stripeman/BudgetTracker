'use strict';
// /api/site-layouts — the site-wide layout catalogue (BT-013-16). Site administrators only, mirroring
// api/icons for built-ins: retire (leaves every picker for NEW selection; keeps rendering wherever a
// workspace already applies it) and reinstate. No genuine physical deletion exists yet — every real
// layout today is built-in, shipped code (api/_shared/layouts.js) — so ?action=delete always explains
// the blocker rather than silently pretending to succeed (Terry: "Explain blockers... Do not label
// retirement as permanent deletion").
//
// HARD INVARIANT (AGENTS.md/SECURITY.md): site administration never sees financial records. Usage
// counts here are counts only, read from each workspace document's `settings.layoutId` and
// `hiddenLayouts` fields alone — never a workspace's name or any financial content, the same pattern
// api/analytics/handler.js's directory() already uses.
const { readBody, query, forbidden, badRequest, notFound } = require('../_shared/http');
const { readDocument } = require('../_shared/schema');
const { update } = require('../_shared/storage');
const { newId } = require('../_shared/ids');
const fields = require('../_shared/fields');
const workspaceSettings = require('../_shared/workspace-settings');
const layoutCatalog = require('../_shared/layout-catalog');

function requireAdmin(ctx) {
  if (!ctx.siteAdmin) throw forbidden('Only site administrators can change the layout catalogue.');
}

// Structure-only enumeration (never financial content), matching api/analytics/handler.js directory().
async function usageCounts(storage) {
  const names = (await storage.list('workspaces/')).filter((n) => n.endsWith('/workspace.json'));
  const applied = Object.fromEntries(layoutCatalog.BUILT_IN_IDS.map((id) => [id, 0]));
  const hidden = Object.fromEntries(layoutCatalog.BUILT_IN_IDS.map((id) => [id, 0]));
  for (const name of names) {
    try {
      const { value } = await storage.getJson(name);
      const doc = readDocument('workspace', value);
      if (!doc || doc.status === 'deleted-permanent') continue;
      const id = workspaceSettings.get(doc, 'layoutId');
      if (Object.prototype.hasOwnProperty.call(applied, id)) applied[id] += 1;
      for (const h of doc.hiddenLayouts || []) if (Object.prototype.hasOwnProperty.call(hidden, h)) hidden[h] += 1;
    } catch { /* one unreadable workspace does not take down the whole catalogue */ }
  }
  return { applied, hidden };
}

async function get(ctx) {
  requireAdmin(ctx);
  const { catalog } = await layoutCatalog.readCatalog(ctx.storage);
  const { applied, hidden } = await usageCounts(ctx.storage);
  const layouts = layoutCatalog.catalogView(catalog).map((l) => ({ ...l, appliedCount: applied[l.id] || 0, hiddenByWorkspaceCount: hidden[l.id] || 0 }));
  return { body: { layouts, audit: catalog.audit || [] } };
}

async function mutateCatalog(ctx, fn) {
  let result;
  await update(ctx.storage, layoutCatalog.PATH, (value) => {
    const catalog = { retired: [], audit: [], ...(readDocument('site', value) || {}) };
    const out = fn(catalog);
    if (!out) { result = { layouts: layoutCatalog.catalogView(catalog) }; return undefined; }
    catalog.audit = [...(catalog.audit || []), { id: newId('aud'), at: ctx.nowIso(), actor: ctx.principal.subject, action: out.action, layoutId: out.layoutId }];
    result = { layouts: layoutCatalog.catalogView(catalog), layoutId: out.layoutId };
    return layoutCatalog.stamp(catalog);
  });
  return result;
}

async function retireChange(ctx, action, layoutId) {
  if (!layoutCatalog.BUILT_IN_IDS.includes(layoutId)) throw notFound('Unknown layout.');
  if (layoutCatalog.SYSTEM.has(layoutId)) throw badRequest('Classic is the application’s own layout and cannot be retired.', 'layout_system');
  return mutateCatalog(ctx, (catalog) => {
    const retired = new Set(catalog.retired || []);
    if ((action === 'retire') === retired.has(layoutId)) return null;
    if (action === 'retire') retired.add(layoutId); else retired.delete(layoutId);
    catalog.retired = [...retired].sort();
    return { action: `layout.${action}`, layoutId };
  });
}

async function post(ctx, req) {
  requireAdmin(ctx);
  const action = query(req, 'action');
  const body = fields.onlyKeys(readBody(req), ['layoutId']);
  const layoutId = fields.text(body.layoutId, { field: 'Layout', max: 80, required: true });
  if (action === 'retire' || action === 'reinstate') {
    const result = await retireChange(ctx, action === 'reinstate' ? 'reinstate' : 'retire', layoutId);
    return { body: result };
  }
  if (action === 'delete') {
    if (!layoutCatalog.BUILT_IN_IDS.includes(layoutId)) throw notFound('Unknown layout.');
    // Every real layout today is built-in, shipped application code (api/_shared/layouts.js): there
    // is nowhere to remove its definition FROM short of a code change. Retirement (above) is the
    // real, available action; this always explains that rather than pretending to delete something.
    throw badRequest('This layout is built into the application. Retire it to stop new selection everywhere on the site; removing its definition needs a later code change, and only once no workspace applies it.', 'layout_builtin');
  }
  throw notFound();
}

module.exports = { GET: get, POST: post };
