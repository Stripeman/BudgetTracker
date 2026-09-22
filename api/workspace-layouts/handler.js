'use strict';
// /api/workspace-layouts — the real, per-workspace Layout Picker (BT-013-16). Members only; this
// workspace's financial content is never read or returned here.
//   GET  ?workspaceId=                                    the real catalogue for this workspace: the
//        four real layouts (with retirement/selectability, this workspace's hidden state, current
//        applied id and each colour scheme), plus the remaining Gallery concepts labelled demo-only.
//   PATCH ?workspaceId= { action: 'hide', layoutId }      manager+: remove from this workspace's choices
//   PATCH ?workspaceId= { action: 'restore', layoutId }   manager+: bring a hidden layout back
//   PATCH ?workspaceId= { action: 'colors', layoutId, colors: {light,dark,preset}|null }
//        manager+: set (or, with `colors: null`, reset) this workspace's DEFAULT colour scheme for
//        one layout. A personal override stays the already-real `galleryDesignColors` preference
//        (api/preferences/handler.js) against the same layout ids — nothing new to fetch or store
//        for that; this route reports it back for convenience (`personalColors`) but never writes it.
//   PATCH ?workspaceId= { action: 'publish-personal-colors', layoutId }
//        manager+: an explicit, one-time copy of the caller's OWN personal colour choice for this
//        layout into the workspace default — never automatic, never silent (Terry: "Do not silently
//        publish someone's personal preferences as workspace defaults").
// Applying a layout itself is unchanged: `PATCH /api/workspaces?id=` with `settings.layoutId` — never
// duplicated here, so it stays one single audited settings-change mechanism.
const { readBody, query, forbidden, badRequest, notFound } = require('../_shared/http');
const { requireId } = require('../_shared/ids');
const { readDocument } = require('../_shared/schema');
const { roleAtLeast } = require('../_shared/authz');
const store = require('../_shared/store');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const workspaceSettings = require('../_shared/workspace-settings');
const layoutCatalog = require('../_shared/layout-catalog');
const { CONCEPTS } = require('../_shared/layouts');

async function ownGalleryColors(ctx) {
  const { value } = await ctx.storage.getJson(store.paths.user(ctx.principal.subject));
  const doc = readDocument('user', value);
  return (doc && doc.preferences && doc.preferences.galleryDesignColors) || {};
}

function demoConcepts() {
  return CONCEPTS.filter((c) => !layoutCatalog.BUILT_IN_IDS.includes(c.id))
    .map((c) => ({ id: c.id, name: c.name, tagline: c.tagline, accentLight: c.accentLight, accentDark: c.accentDark, demoOnly: true }));
}

async function get(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  const { catalog } = await layoutCatalog.readCatalog(ctx.storage);
  const personal = await ownGalleryColors(ctx);
  const currentLayoutId = workspaceSettings.get(doc, 'layoutId');
  const hidden = new Set(doc.hiddenLayouts || []);
  const workspaceColors = (doc.settings && doc.settings.layoutColors) || {};
  const canManage = roleAtLeast(member.role, 'manager');
  const layouts = layoutCatalog.catalogView(catalog).map((l) => ({
    ...l,
    current: l.id === currentLayoutId,
    hidden: hidden.has(l.id),
    colorable: layoutCatalog.COLORABLE_IDS.includes(l.id),
    workspaceColors: workspaceColors[l.id] || null,
    personalColors: personal[l.id] || null,
  }));
  return { body: { workspaceId: wsId, currentLayoutId, canApply: canManage, canManage, layouts, demoLayouts: demoConcepts() } };
}

// Every action this route offers needs manager+ (Terry: "Other members may preview available
// layouts without changing the shared default"). Checked BEFORE any action-specific business rule
// (matches icons.js's own `requireAdmin`-first ordering), then re-checked inside the write itself for
// correctness under a concurrent role change — belt and braces, never a race between the two.
async function requireManager(ctx, wsId) {
  const { member } = await store.loadWorkspace(ctx, wsId);
  if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can change this workspace’s layout choices.');
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['action', 'layoutId', 'colors']);
  const layoutId = fields.text(body.layoutId, { field: 'Layout', max: 80, required: true });
  await requireManager(ctx, wsId);

  if (body.action === 'hide' || body.action === 'restore') {
    const target = layoutCatalog.validateHideTarget(layoutId);
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can change this workspace’s layout choices.');
      const hidden = new Set(doc.hiddenLayouts || []);
      const wasHidden = hidden.has(target);
      if (body.action === 'hide' ? wasHidden : !wasHidden) return { hiddenLayouts: [...hidden].sort() };
      if (body.action === 'hide') hidden.add(target); else hidden.delete(target);
      doc.hiddenLayouts = [...hidden].sort();
      audit.record(doc, { actor: member.subject, action: `workspace.layout-${body.action}`, targetType: 'workspace', targetId: doc.id, at: ctx.nowIso(), fields: ['hiddenLayouts'] });
      return { hiddenLayouts: doc.hiddenLayouts };
    });
    return { body: result };
  }

  if (body.action === 'colors') {
    const target = layoutCatalog.validateLayoutId(layoutId);
    const entry = body.colors === null ? null : layoutCatalog.validateLayoutColorEntry(body.colors);
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can set this workspace’s default layout colours.');
      const before = (doc.settings && doc.settings.layoutColors) || {};
      if (entry === null) {
        if (!Object.prototype.hasOwnProperty.call(before, target)) return { layoutColors: before };
        const { [target]: _drop, ...rest } = before;
        doc.settings = { ...(doc.settings || {}), layoutColors: rest };
      } else {
        doc.settings = { ...(doc.settings || {}), layoutColors: { ...before, [target]: entry } };
      }
      audit.record(doc, { actor: member.subject, action: 'workspace.layout-colors', targetType: 'workspace', targetId: doc.id, at: ctx.nowIso(), fields: [`layoutColors.${target}`] });
      return { layoutColors: doc.settings.layoutColors };
    });
    return { body: result };
  }

  if (body.action === 'publish-personal-colors') {
    const target = layoutCatalog.validateLayoutId(layoutId);
    const personal = await ownGalleryColors(ctx);
    const mine = personal[target];
    if (!mine || !Object.keys(mine).length) throw badRequest('You have no personal colour choice for this layout to publish.', 'no_personal_colors');
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can set this workspace’s default layout colours.');
      doc.settings = doc.settings || {};
      doc.settings.layoutColors = { ...(doc.settings.layoutColors || {}), [target]: { ...mine } };
      audit.record(doc, { actor: member.subject, action: 'workspace.layout-colors-published', targetType: 'workspace', targetId: doc.id, at: ctx.nowIso(), fields: [`layoutColors.${target}`] });
      return { layoutColors: doc.settings.layoutColors };
    });
    return { body: result };
  }

  throw notFound();
}

module.exports = { GET: get, PATCH: patch };
