'use strict';
// /api/icons — the icon catalogue (BT-011-05). Signed-in people only; it holds no financial data.
//   GET                                  built-in icons (with whether each can be chosen), custom icons as
//                                        shape data, and the defaults by type
//   GET  ?workspaceId=                   also the workspace's type icons (members only; others get 404)
//   POST ?action=upload  { label, svg }  site admin: add a custom icon through the validated upload
//   POST ?action=retire  { iconId, reason? } | ?action=restore { iconId }   site admin, custom icons
//   POST ?action=disable { iconId } | ?action=enable { iconId }             site admin, built-in icons
//   PATCH { iconId, label }              site admin: rename a custom icon
//   PATCH ?workspaceId= { typeIcons }    owners and managers: icons for account, bill and merchant types
// Nothing is deleted. A retired or switched-off icon leaves the pickers but keeps drawing wherever it
// is already used. Site administration grants no access to any workspace: the workspace form of
// PATCH and GET is authorized by workspace membership alone.
const { readBody, query, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { update } = require('../_shared/storage');
const { readDocument } = require('../_shared/schema');
const { newId, requireId } = require('../_shared/ids');
const { roleAtLeast } = require('../_shared/authz');
const store = require('../_shared/store');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const icons = require('../_shared/icons');
const { parseIconSvg, IconError } = require('../_shared/icon-svg');

// `catalogEtag` identifies the catalogue version. A client that already holds that version sends it
// back as ?catalogEtag= and receives `catalog: null` instead of the whole catalogue again, so a
// workspace switch does not re-download it (security review SEC-I4). Administrators always get the
// full view, which carries history.
async function get(ctx, req) {
  const { catalog, etag } = await icons.readCatalog(ctx.storage);
  const catalogEtag = `${etag || 'none'}${ctx.siteAdmin ? ':admin' : ''}`;
  const unchanged = !ctx.siteAdmin && query(req, 'catalogEtag') === catalogEtag;
  const body = { catalog: unchanged ? null : icons.catalogView(catalog, { admin: !!ctx.siteAdmin }), catalogEtag, admin: !!ctx.siteAdmin };
  const wsId = query(req, 'workspaceId');
  if (wsId !== undefined) {
    const { doc, member } = await store.loadWorkspace(ctx, requireId(wsId, 'workspaceId'));
    body.typeIcons = (doc.settings && doc.settings.typeIcons) || {};
    body.canEditTypeIcons = roleAtLeast(member.role, 'manager');
  }
  return { body };
}

function requireAdmin(ctx) {
  if (!ctx.siteAdmin) throw forbidden('Only site administrators can change the icon catalogue.');
}

// One atomic change to the catalogue document, with an audit entry that is never truncated.
async function mutateCatalog(ctx, fn) {
  let result;
  await update(ctx.storage, icons.PATH, (value) => {
    const catalog = { disabled: [], custom: [], audit: [], ...(readDocument('site', value) || {}) };
    const out = fn(catalog);
    if (!out) { result = { catalog: icons.catalogView(catalog, { admin: true }) }; return undefined; }
    catalog.audit = [...(catalog.audit || []), { id: newId('aud'), at: ctx.nowIso(), actor: ctx.principal.subject, action: out.action, iconId: out.iconId }];
    result = { catalog: icons.catalogView(catalog, { admin: true }), iconId: out.iconId };
    const stamped = icons.stamp(catalog);
    // The catalogue is bounded like a workspace: at the cap it is refused, never trimmed (SEC-I4);
    // growth beyond it needs the partitioning in ADR-003.
    if (Buffer.byteLength(JSON.stringify(stamped)) > icons.MAX_CATALOG_BYTES) throw conflict('The icon catalogue has reached its storage limit.', 'catalog_full');
    return stamped;
  });
  return result;
}

const label = (value) => fields.text(value, { field: 'Icon name', max: 40, required: true });

async function upload(ctx, req) {
  requireAdmin(ctx);
  const body = fields.onlyKeys(readBody(req), ['label', 'svg']);
  const name = label(body.label);
  let parsed;
  try { parsed = parseIconSvg(body.svg); } catch (e) {
    if (e instanceof IconError) throw badRequest(e.message, 'invalid_icon');
    throw e;
  }
  const result = await mutateCatalog(ctx, (catalog) => {
    // Only icons on offer count toward the working limit, so retiring one frees a place (SEC-I2).
    if ((catalog.custom || []).filter((c) => c.status === 'active').length >= icons.MAX_CUSTOM) throw conflict(`The catalogue already offers ${icons.MAX_CUSTOM} custom icons. Retire icons you no longer need.`, 'too_many_icons');
    if ((catalog.custom || []).length >= icons.MAX_STORED) throw conflict(`The catalogue has stored ${icons.MAX_STORED} custom icons, the most it can keep.`, 'catalog_full');
    const id = newId('ico');
    const nowIso = ctx.nowIso();
    catalog.custom = [...(catalog.custom || []), {
      id, label: name, shapes: parsed.shapes, status: 'active', createdAt: nowIso, createdBy: ctx.principal.subject,
      history: [{ at: nowIso, by: ctx.principal.subject, action: 'upload' }],
    }];
    return { action: 'icon.upload', iconId: id };
  });
  return { status: 201, body: result };
}

function customChange(action) {
  return async (ctx, req) => {
    requireAdmin(ctx);
    const body = fields.onlyKeys(readBody(req), action === 'retire' ? ['iconId', 'reason'] : ['iconId']);
    const id = fields.text(body.iconId, { field: 'Icon', max: 80, required: true });
    const result = await mutateCatalog(ctx, (catalog) => {
      const c = icons.customById(catalog, id);
      if (!c) throw notFound('Unknown custom icon.');
      const to = action === 'retire' ? 'retired' : 'active';
      if (c.status === to) return null;
      // Offering an icon again counts toward the working limit like a new upload (SEC-I2).
      if (to === 'active' && (catalog.custom || []).filter((x) => x.status === 'active').length >= icons.MAX_CUSTOM) {
        throw conflict(`The catalogue already offers ${icons.MAX_CUSTOM} custom icons. Retire another icon first.`, 'too_many_icons');
      }
      c.history = [...(c.history || []), { at: ctx.nowIso(), by: ctx.principal.subject, action, from: c.status, to, reason: fields.text(body.reason, { field: 'Reason', max: 200 }) }];
      c.status = to;
      return { action: `icon.${action}`, iconId: id };
    });
    return { body: result };
  };
}

function builtInChange(action) {
  return async (ctx, req) => {
    requireAdmin(ctx);
    const body = fields.onlyKeys(readBody(req), ['iconId']);
    const id = fields.text(body.iconId, { field: 'Icon', max: 80, required: true });
    if (!icons.BUILT_IN_IDS.has(id)) throw notFound('Unknown built-in icon.');
    if (icons.SYSTEM.has(id)) throw badRequest('This icon is used by the app itself and cannot be switched off.', 'icon_system');
    const result = await mutateCatalog(ctx, (catalog) => {
      const disabled = new Set(catalog.disabled || []);
      if ((action === 'disable') === disabled.has(id)) return null;
      if (action === 'disable') disabled.add(id); else disabled.delete(id);
      catalog.disabled = [...disabled].sort();
      return { action: `icon.${action}`, iconId: id };
    });
    return { body: result };
  };
}

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === 'upload') return upload(ctx, req);
  if (action === 'retire' || action === 'restore') return customChange(action)(ctx, req);
  if (action === 'disable' || action === 'enable') return builtInChange(action)(ctx, req);
  throw notFound();
}

async function patch(ctx, req) {
  const wsId = query(req, 'workspaceId');
  if (wsId !== undefined) return patchTypeIcons(ctx, req, requireId(wsId, 'workspaceId'));
  requireAdmin(ctx);
  const body = fields.onlyKeys(readBody(req), ['iconId', 'label']);
  const id = fields.text(body.iconId, { field: 'Icon', max: 80, required: true });
  const name = label(body.label);
  const result = await mutateCatalog(ctx, (catalog) => {
    const c = icons.customById(catalog, id);
    if (!c) throw notFound('Unknown custom icon.');
    if (c.label === name) return null;
    c.history = [...(c.history || []), { at: ctx.nowIso(), by: ctx.principal.subject, action: 'rename', from: c.label, to: name }];
    c.label = name;
    return { action: 'icon.rename', iconId: id };
  });
  return { body: result };
}

async function patchTypeIcons(ctx, req, wsId) {
  const body = fields.onlyKeys(readBody(req), ['typeIcons']);
  const { catalog } = await icons.readCatalog(ctx.storage);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can choose icons for the workspace\'s types.');
    doc.settings = doc.settings || {};
    const before = doc.settings.typeIcons || {};
    const next = icons.validateTypeIcons(catalog, body.typeIcons, before);
    const changes = [...new Set([...Object.keys(before), ...Object.keys(next)])]
      .filter((k) => before[k] !== next[k]).map((k) => ({ field: k, from: before[k] || null, to: next[k] || null }));
    if (!changes.length) return { typeIcons: before };
    const nowIso = ctx.nowIso();
    doc.settings.typeIcons = next;
    // Before and after values are kept (BT-001-05); never truncated.
    doc.settings.typeIconHistory = [...(doc.settings.typeIconHistory || []), { at: nowIso, by: member.subject, changes }];
    audit.record(doc, { actor: member.subject, action: 'workspace.type-icons', targetType: 'workspace', targetId: doc.id, at: nowIso, fields: changes.map((c) => c.field) });
    return { typeIcons: next };
  });
  return { body: result };
}

module.exports = { GET: get, POST: post, PATCH: patch };
