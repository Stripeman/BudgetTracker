'use strict';
// /api/categories?workspaceId=   Shared category list. Managers and owners maintain it.
// Categories are archived, never deleted, so historical entries keep their meaning.
//
// COLOURS (BT-011-04): each category has a colour stored with its stable id, so a rename keeps it.
// The workspace colour is permission-controlled (managers and owners); `color: null` resets it to
// the category's default. Personal colours live in each person's own preferences
// (`categoryColors`) and never change what anyone else sees. Every colour is validated here,
// including contrast. GET also returns the palette so the client never keeps its own copy.
// Every change keeps its before and after values, author and time.
const { readBody, query, badRequest, forbidden, notFound } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const store = require('../_shared/store');
const workspaceSettings = require('../_shared/workspace-settings');
// The category list is a shared list: managers and owners maintain it, or members too when the
// workspace setting "Who manages shared lists" says so (Terry, 2026-09-14). Never viewers.
const mayManage = (doc, member) => workspaceSettings.managesSharedLists(doc, member);
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const colors = require('../_shared/colors');
const icons = require('../_shared/icons');
const deletion = require('../_shared/deletion');
const categoryTypes = require('../_shared/category-types');

// ICONS (BT-011-05) follow the same rules as colours: stored by id with the default the category
// was created with (`defaultIcon`), the workspace icon for managers and owners (`icon: null`
// resets it), personal icons in each person's own preferences (`categoryIcons`).
const view = (doc, c) => {
  const { icon, iconSource } = icons.effective('category', c);
  return {
    id: c.id, name: c.name, type: c.type, parentId: c.parentId || null, archived: !!c.archived,
    color: colors.effectiveColor(c), colorSource: c.color ? 'workspace' : 'default', defaultColor: colors.defaultColorFor(c),
    icon, iconSource: iconSource === 'record' ? 'workspace' : 'default', defaultIcon: icons.effective('category', { ...c, icon: null }).icon,
    // BT-019-01: the workspace's own named/coloured/iconed type this category was created from, if
    // any (legacy categories predating this feature simply have neither) — purely additional
    // presentation; `type` above is always the category's own canonical income/expense class, never
    // re-derived from this at read time.
    categoryTypeId: c.categoryTypeId || null,
    categoryType: (() => {
      const t = (doc.categoryTypes || []).find((x) => x.id === c.categoryTypeId);
      return t ? { id: t.id, name: t.name, color: t.color || t.defaultColor, icon: t.icon || t.defaultIcon || null, retired: !!t.retired } : null;
    })(),
  };
};

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  return { body: { categories: (doc.categories || []).map((c) => view(doc, c)), palette: colors.PALETTE } };
}

const catalogFor = async (ctx, body) => (body.icon !== undefined ? (await icons.readCatalog(ctx.storage)).catalog : null);

function checkParent(doc, parentId, selfId) {
  const id = fields.optionalId(parentId, 'Parent category');
  if (!id) return null;
  const parent = (doc.categories || []).find((c) => c.id === id);
  if (!parent || id === selfId) throw badRequest('Unknown parent category.', 'invalid_category');
  if (parent.parentId) throw badRequest('Subcategories can only be one level deep.', 'invalid_category');
  return id;
}

const colorOrNull = (value) => (value === null ? null : colors.validateColor(value, 'Colour'));

// BT-019-01: resolves an optional `categoryTypeId` to a real, non-retired type and returns its
// `categoryClass` — never re-read again after the caller uses it once to derive `type`.
function resolveCategoryType(doc, categoryTypeId, nowIso) {
  const id = fields.optionalId(categoryTypeId, 'Category type');
  if (!id) return null;
  categoryTypes.ensureSystemTypes(doc, nowIso);
  const t = categoryTypes.findEffectiveType(doc, id, nowIso);
  if (!t || t.retired) throw badRequest('Unknown or retired category type.', 'invalid_category_type');
  return t;
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['name', 'type', 'categoryTypeId', 'parentId', 'color', 'icon']);
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!mayManage(doc, member)) throw forbidden('Only owners and managers can change categories in this workspace.');
    const nowIso = ctx.nowIso();
    const id = newId('cat');
    const name = fields.text(body.name, { field: 'Name', max: 60, required: true });
    const chosenType = resolveCategoryType(doc, body.categoryTypeId, nowIso);
    if (chosenType && body.type !== undefined && body.type !== chosenType.categoryClass) {
      throw badRequest('The chosen category type does not match the given type.', 'category_type_mismatch');
    }
    const type = fields.oneOf(body.type, ['expense', 'income'], 'Type', chosenType ? chosenType.categoryClass : 'expense');
    const c = {
      id, name, type, categoryTypeId: chosenType ? chosenType.id : null, parentId: checkParent(doc, body.parentId), archived: false,
      color: body.color === undefined ? null : colorOrNull(body.color), defaultColor: colors.initialDefault(name, id),
      icon: body.icon === undefined ? null : icons.validateChoice(catalog, body.icon), defaultIcon: icons.initialCategoryIcon(name, type),
      history: [{ at: nowIso, by: member.subject, changes: [{ field: 'create' }] }],
    };
    doc.categories = [...(doc.categories || []), c];
    audit.record(doc, { actor: member.subject, action: 'category.create', targetType: 'category', targetId: c.id, at: nowIso });
    return { category: view(doc, c) };
  });
  return { status: 201, body: result };
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['categoryId', 'name', 'categoryTypeId', 'parentId', 'archived', 'color', 'icon']);
  const id = requireId(body.categoryId, 'categoryId');
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!mayManage(doc, member)) throw forbidden('Only owners and managers can change categories in this workspace.');
    const c = (doc.categories || []).find((x) => x.id === id);
    if (!c) throw notFound('Unknown category.');
    // A category created before icons existed gets its default pinned now, so a rename keeps it.
    if (!c.defaultIcon) c.defaultIcon = icons.initialCategoryIcon(c.name, c.type);
    const nowIso = ctx.nowIso();
    const changes = [];
    const set = (field, value) => {
      const from = c[field] === undefined ? null : c[field];
      if (JSON.stringify(from) === JSON.stringify(value)) return;
      changes.push({ field, from, to: value });
      c[field] = value;
    };
    if (body.name !== undefined) set('name', fields.text(body.name, { field: 'Name', max: 60, required: true }));
    if (body.categoryTypeId !== undefined) {
      const chosenType = resolveCategoryType(doc, body.categoryTypeId, nowIso);
      // The category's own `type` (income/expense) is fixed for good at creation (never patchable) —
      // a type may only be attached here when its class already matches, so a categoryTypeId can
      // never be used as a back door to silently reinterpret the category's own behaviour.
      if (chosenType && chosenType.categoryClass !== c.type) {
        throw badRequest(`This category is ${c.type}; only a ${c.type} category type can be attached to it.`, 'category_type_mismatch');
      }
      set('categoryTypeId', chosenType ? chosenType.id : null);
    }
    if (body.parentId !== undefined) set('parentId', checkParent(doc, body.parentId, c.id));
    if (body.archived !== undefined) set('archived', fields.bool(body.archived, 'Archived'));
    if (body.color !== undefined) set('color', colorOrNull(body.color));
    if (body.icon !== undefined) set('icon', icons.validateChoice(catalog, body.icon, { current: c.icon || null }));
    if (changes.length) {
      c.history = [...(c.history || []), { at: nowIso, by: member.subject, changes }];
      audit.record(doc, { actor: member.subject, action: 'category.update', targetType: 'category', targetId: c.id, at: nowIso, fields: changes.map((x) => x.field) });
    }
    return { category: view(doc, c) };
  });
  return { body: result };
}

// Permanent deletion (BT-014): categories were archived-only ("never deleted") until now. A
// budget that still uses this category, or a subcategory under it, blocks the operation rather
// than being silently rewritten; transactions, splits and merchant defaults keep everything else
// and just lose the category.
const permanentRoutes = deletion.makeRoutes({
  type: 'category', idField: 'categoryId',
  find: (doc, id) => (doc.categories || []).find((c) => c.id === id) || null,
  authorize: (doc, member) => { if (!mayManage(doc, member)) throw forbidden('Only owners and managers can change categories in this workspace.'); },
});

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === 'delete-impact') return permanentRoutes.impactRoute(ctx, req);
  if (action === 'delete-permanent') return permanentRoutes.permanentRoute(ctx, req);
  if (action !== undefined) throw notFound();
  return create(ctx, req);
}

module.exports = { GET: list, POST: post, PATCH: patch };
