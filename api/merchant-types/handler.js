'use strict';
// /api/merchant-types?workspaceId=   Workspace-scoped merchant TYPE definitions (BT-019-03): a name,
// an editable colour and an optional icon, each mapped to one of the fixed merchant classes
// `api/_shared/merchants.js` already uses. Mirrors BT-019-02's account types and BT-019-01's
// category types exactly; see `api/_shared/merchant-types.js` for the full design comment.
//
//   GET  ?workspaceId=                        every type (system defaults always included, even
//                                             one not yet actually stored), retired ones too
//   POST { name, merchantClass, color?, icon? }   create a custom type; owners/managers (or a
//                                             member, when the workspace lets members manage
//                                             shared lists) — the same rule categories already use
//   PATCH { typeId, name?, color?, icon?, retired?, merchantClass? }   a system type can never be
//                                             retired and its own class never changes; a custom
//                                             type's class can change only while unused
const { readBody, query, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const store = require('../_shared/store');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const colors = require('../_shared/colors');
const icons = require('../_shared/icons');
const workspaceSettings = require('../_shared/workspace-settings');
const merchants = require('../_shared/merchants');
const merchantTypes = require('../_shared/merchant-types');
const deletion = require('../_shared/deletion');

const mayManage = (doc, member) => workspaceSettings.managesSharedLists(doc, member);
const catalogFor = async (ctx, body) => (body.icon !== undefined ? (await icons.readCatalog(ctx.storage)).catalog : null);
const colorOrNull = (value) => (value === null ? null : colors.validateColor(value, 'Colour'));

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const nowIso = ctx.nowIso();
  return { body: { types: merchantTypes.effectiveTypes(doc, nowIso).map((t) => merchantTypes.view(doc, t)), merchantClasses: merchants.MERCHANT_TYPES, palette: colors.PALETTE } };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['name', 'merchantClass', 'color', 'icon']);
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!mayManage(doc, member)) throw forbidden('Only owners and managers can create merchant types in this workspace.');
    const nowIso = ctx.nowIso();
    merchantTypes.ensureSystemTypes(doc, nowIso);
    const name = fields.text(body.name, { field: 'Name', max: 60, required: true });
    const merchantClass = fields.oneOf(body.merchantClass, merchants.MERCHANT_TYPES, 'Merchant class');
    const id = newId('mtype');
    const t = {
      id, name, merchantClass, color: body.color === undefined ? null : colorOrNull(body.color),
      defaultColor: colors.initialDefault(name, id), icon: body.icon === undefined ? null : icons.validateChoice(catalog, body.icon),
      defaultIcon: (icons.DEFAULTS.merchant && icons.DEFAULTS.merchant[merchantClass]) || null,
      system: false, retired: false, createdBy: member.subject, createdAt: nowIso,
      history: [{ at: nowIso, by: member.subject, changes: [{ field: 'create' }] }],
    };
    doc.merchantTypes.push(t);
    audit.record(doc, { actor: member.subject, action: 'merchant-type.create', targetType: 'merchant-type', targetId: t.id, at: nowIso });
    return { type: merchantTypes.view(doc, t) };
  });
  return { status: 201, body: result };
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['typeId', 'name', 'color', 'icon', 'retired', 'merchantClass']);
  const id = requireId(body.typeId, 'typeId');
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!mayManage(doc, member)) throw forbidden('Only owners and managers can change merchant types in this workspace.');
    const nowIso = ctx.nowIso();
    merchantTypes.ensureSystemTypes(doc, nowIso);
    const t = (doc.merchantTypes || []).find((x) => x.id === id);
    if (!t) throw notFound('Unknown merchant type.');
    const changes = [];
    const set = (field, value) => {
      const from = t[field] === undefined ? null : t[field];
      if (JSON.stringify(from) === JSON.stringify(value)) return;
      changes.push({ field, from, to: value });
      t[field] = value;
    };
    if (body.name !== undefined) set('name', fields.text(body.name, { field: 'Name', max: 60, required: true }));
    if (body.color !== undefined) set('color', colorOrNull(body.color));
    if (body.icon !== undefined) set('icon', icons.validateChoice(catalog, body.icon, { current: t.icon || null }));
    if (body.retired !== undefined) {
      const retired = fields.bool(body.retired, 'Retired');
      if (t.system && retired) throw badRequest('A built-in merchant type cannot be retired — a workspace always keeps its basic set available.', 'system_type_locked');
      set('retired', retired);
    }
    if (body.merchantClass !== undefined && body.merchantClass !== t.merchantClass) {
      if (t.system) throw badRequest('A built-in merchant type\'s own class can never change.', 'system_type_locked');
      const usage = merchantTypes.usageCount(doc, t.id);
      if (usage > 0) {
        throw conflict(`This type is already used by ${usage} merchant${usage === 1 ? '' : 's'}. Changing its class is refused — create a new type instead.`, 'merchant_type_in_use');
      }
      set('merchantClass', fields.oneOf(body.merchantClass, merchants.MERCHANT_TYPES, 'Merchant class'));
    }
    if (changes.length) {
      t.history = [...(t.history || []), { at: nowIso, by: member.subject, changes }];
      audit.record(doc, { actor: member.subject, action: 'merchant-type.update', targetType: 'merchant-type', targetId: t.id, at: nowIso, fields: changes.map((c) => c.field) });
    }
    return { type: merchantTypes.view(doc, t) };
  });
  return { body: result };
}

// Permanent deletion (BT-023): a built-in type can never be permanently deleted (mirrors "can never
// be retired"); a custom type in use is never blocked — every merchant carrying it is severed
// (`merchantTypeId` reset to null), never removed, since the link is only an optional label.
const permanentRoutes = deletion.makeRoutes({
  type: 'merchant-type', idField: 'typeId',
  find: (doc, id, ctx) => merchantTypes.findEffectiveType(doc, id, ctx.nowIso()),
  authorize: (doc, member) => { if (!mayManage(doc, member)) throw forbidden('Only owners and managers can change merchant types in this workspace.'); },
});

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === 'delete-impact') return permanentRoutes.impactRoute(ctx, req);
  if (action === 'delete-permanent') return permanentRoutes.permanentRoute(ctx, req);
  if (action !== undefined) throw notFound();
  return create(ctx, req);
}

module.exports = { GET: list, POST: post, PATCH: patch };
