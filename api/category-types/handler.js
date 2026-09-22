'use strict';
// /api/category-types?workspaceId=   Workspace-scoped category TYPE definitions (BT-019-01): a name,
// an editable colour and an optional icon, each mapped to one of the two fixed category classes
// (`expense`/`income`) `api/categories/handler.js` already uses. The type is presentation only; a
// category's own `type` is what actually drives every income/expense rule elsewhere, kept strictly
// separate — renaming or recolouring a type never touches a single category (mirrors BT-019-02's
// account types exactly; see `api/_shared/category-types.js` for the full design comment).
//
//   GET  ?workspaceId=                        every type (system defaults always included, even
//                                             one not yet actually stored), retired ones too
//   POST { name, categoryClass, color?, icon? }   create a custom type; owners/managers (or a
//                                             member, when the workspace lets members manage
//                                             shared lists) — the same rule categories already use
//   PATCH { typeId, name?, color?, icon?, retired?, categoryClass? }   a system type's own
//                                             categoryClass can never change and it can never be
//                                             retired; a custom type's categoryClass can change
//                                             only while no category uses it yet
const { readBody, query, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const store = require('../_shared/store');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const colors = require('../_shared/colors');
const icons = require('../_shared/icons');
const workspaceSettings = require('../_shared/workspace-settings');
const categoryTypes = require('../_shared/category-types');
const deletion = require('../_shared/deletion');

const mayManage = (doc, member) => workspaceSettings.managesSharedLists(doc, member);
const catalogFor = async (ctx, body) => (body.icon !== undefined ? (await icons.readCatalog(ctx.storage)).catalog : null);
const colorOrNull = (value) => (value === null ? null : colors.validateColor(value, 'Colour'));

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const nowIso = ctx.nowIso();
  return { body: { types: categoryTypes.effectiveTypes(doc, nowIso).map((t) => categoryTypes.view(doc, t)), categoryClasses: categoryTypes.CATEGORY_CLASSES, palette: colors.PALETTE } };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['name', 'categoryClass', 'color', 'icon']);
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!mayManage(doc, member)) throw forbidden('Only owners and managers can create category types in this workspace.');
    const nowIso = ctx.nowIso();
    categoryTypes.ensureSystemTypes(doc, nowIso);
    const name = fields.text(body.name, { field: 'Name', max: 60, required: true });
    const categoryClass = fields.oneOf(body.categoryClass, categoryTypes.CATEGORY_CLASSES, 'Category class');
    const id = newId('ctype');
    const t = {
      id, name, categoryClass, color: body.color === undefined ? null : colorOrNull(body.color),
      defaultColor: colors.initialDefault(name, id), icon: body.icon === undefined ? null : icons.validateChoice(catalog, body.icon),
      defaultIcon: (icons.DEFAULTS.category && icons.DEFAULTS.category[categoryClass]) || null,
      system: false, retired: false, createdBy: member.subject, createdAt: nowIso,
      history: [{ at: nowIso, by: member.subject, changes: [{ field: 'create' }] }],
    };
    doc.categoryTypes.push(t);
    audit.record(doc, { actor: member.subject, action: 'category-type.create', targetType: 'category-type', targetId: t.id, at: nowIso });
    return { type: categoryTypes.view(doc, t) };
  });
  return { status: 201, body: result };
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['typeId', 'name', 'color', 'icon', 'retired', 'categoryClass']);
  const id = requireId(body.typeId, 'typeId');
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!mayManage(doc, member)) throw forbidden('Only owners and managers can change category types in this workspace.');
    const nowIso = ctx.nowIso();
    categoryTypes.ensureSystemTypes(doc, nowIso);
    const t = (doc.categoryTypes || []).find((x) => x.id === id);
    if (!t) throw notFound('Unknown category type.');
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
      if (t.system && retired) throw badRequest('A built-in category type cannot be retired — a workspace always keeps its basic set available.', 'system_type_locked');
      set('retired', retired);
    }
    if (body.categoryClass !== undefined && body.categoryClass !== t.categoryClass) {
      if (t.system) throw badRequest('A built-in category type\'s own income/expense behaviour can never change.', 'system_type_locked');
      const usage = categoryTypes.usageCount(doc, t.id);
      if (usage > 0) {
        throw conflict(`This type is already used by ${usage} categor${usage === 1 ? 'y' : 'ies'}. Changing its underlying income/expense behaviour would silently reinterpret their history, so it is refused — create a new type instead.`, 'category_type_in_use');
      }
      set('categoryClass', fields.oneOf(body.categoryClass, categoryTypes.CATEGORY_CLASSES, 'Category class'));
    }
    if (changes.length) {
      t.history = [...(t.history || []), { at: nowIso, by: member.subject, changes }];
      audit.record(doc, { actor: member.subject, action: 'category-type.update', targetType: 'category-type', targetId: t.id, at: nowIso, fields: changes.map((c) => c.field) });
    }
    return { type: categoryTypes.view(doc, t) };
  });
  return { body: result };
}

// Permanent deletion (BT-023): a built-in type can never be permanently deleted (mirrors "can never
// be retired"); a custom type in use is never blocked — every category carrying it is severed
// (`categoryTypeId` reset to null), never removed, since the link is only an optional label.
const permanentRoutes = deletion.makeRoutes({
  type: 'category-type', idField: 'typeId',
  find: (doc, id, ctx) => categoryTypes.findEffectiveType(doc, id, ctx.nowIso()),
  authorize: (doc, member) => { if (!mayManage(doc, member)) throw forbidden('Only owners and managers can change category types in this workspace.'); },
});

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === 'delete-impact') return permanentRoutes.impactRoute(ctx, req);
  if (action === 'delete-permanent') return permanentRoutes.permanentRoute(ctx, req);
  if (action !== undefined) throw notFound();
  return create(ctx, req);
}

module.exports = { GET: list, POST: post, PATCH: patch };
