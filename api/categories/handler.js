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
const { roleAtLeast } = require('../_shared/authz');
const store = require('../_shared/store');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const colors = require('../_shared/colors');

const view = (c) => ({
  id: c.id, name: c.name, type: c.type, parentId: c.parentId || null, archived: !!c.archived,
  color: colors.effectiveColor(c), colorSource: c.color ? 'workspace' : 'default', defaultColor: colors.defaultColorFor(c),
});

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  return { body: { categories: (doc.categories || []).map(view), palette: colors.PALETTE } };
}

function checkParent(doc, parentId, selfId) {
  const id = fields.optionalId(parentId, 'Parent category');
  if (!id) return null;
  const parent = (doc.categories || []).find((c) => c.id === id);
  if (!parent || id === selfId) throw badRequest('Unknown parent category.', 'invalid_category');
  if (parent.parentId) throw badRequest('Subcategories can only be one level deep.', 'invalid_category');
  return id;
}

const colorOrNull = (value) => (value === null ? null : colors.validateColor(value, 'Colour'));

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['name', 'type', 'parentId', 'color']);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can change categories.');
    const nowIso = ctx.nowIso();
    const id = newId('cat');
    const name = fields.text(body.name, { field: 'Name', max: 60, required: true });
    const c = {
      id, name, type: fields.oneOf(body.type, ['expense', 'income'], 'Type', 'expense'), parentId: checkParent(doc, body.parentId), archived: false,
      color: body.color === undefined ? null : colorOrNull(body.color), defaultColor: colors.initialDefault(name, id),
      history: [{ at: nowIso, by: member.subject, changes: [{ field: 'create' }] }],
    };
    doc.categories = [...(doc.categories || []), c];
    audit.record(doc, { actor: member.subject, action: 'category.create', targetType: 'category', targetId: c.id, at: nowIso });
    return { category: view(c) };
  });
  return { status: 201, body: result };
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['categoryId', 'name', 'parentId', 'archived', 'color']);
  const id = requireId(body.categoryId, 'categoryId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can change categories.');
    const c = (doc.categories || []).find((x) => x.id === id);
    if (!c) throw notFound('Unknown category.');
    const changes = [];
    const set = (field, value) => {
      const from = c[field] === undefined ? null : c[field];
      if (JSON.stringify(from) === JSON.stringify(value)) return;
      changes.push({ field, from, to: value });
      c[field] = value;
    };
    if (body.name !== undefined) set('name', fields.text(body.name, { field: 'Name', max: 60, required: true }));
    if (body.parentId !== undefined) set('parentId', checkParent(doc, body.parentId, c.id));
    if (body.archived !== undefined) set('archived', fields.bool(body.archived, 'Archived'));
    if (body.color !== undefined) set('color', colorOrNull(body.color));
    if (changes.length) {
      const nowIso = ctx.nowIso();
      c.history = [...(c.history || []), { at: nowIso, by: member.subject, changes }];
      audit.record(doc, { actor: member.subject, action: 'category.update', targetType: 'category', targetId: c.id, at: nowIso, fields: changes.map((x) => x.field) });
    }
    return { category: view(c) };
  });
  return { body: result };
}

module.exports = { GET: list, POST: create, PATCH: patch };
