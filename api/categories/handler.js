'use strict';
// /api/categories?workspaceId=   Shared category list. Managers and owners maintain it.
// Categories are archived, never deleted, so historical entries keep their meaning.
const { readBody, query, badRequest, forbidden, notFound } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { roleAtLeast } = require('../_shared/authz');
const store = require('../_shared/store');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');

const view = (c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId || null, archived: !!c.archived });

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  return { body: { categories: (doc.categories || []).map(view) } };
}

function checkParent(doc, parentId, selfId) {
  const id = fields.optionalId(parentId, 'Parent category');
  if (!id) return null;
  const parent = (doc.categories || []).find((c) => c.id === id);
  if (!parent || id === selfId) throw badRequest('Unknown parent category.', 'invalid_category');
  if (parent.parentId) throw badRequest('Subcategories can only be one level deep.', 'invalid_category');
  return id;
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['name', 'type', 'parentId']);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can change categories.');
    const c = { id: newId('cat'), name: fields.text(body.name, { field: 'Name', max: 60, required: true }), type: fields.oneOf(body.type, ['expense', 'income'], 'Type', 'expense'), parentId: checkParent(doc, body.parentId), archived: false };
    doc.categories = [...(doc.categories || []), c];
    audit.record(doc, { actor: member.subject, action: 'category.create', targetType: 'category', targetId: c.id, at: ctx.nowIso() });
    return { category: view(c) };
  });
  return { status: 201, body: result };
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['categoryId', 'name', 'parentId', 'archived']);
  const id = requireId(body.categoryId, 'categoryId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can change categories.');
    const c = (doc.categories || []).find((x) => x.id === id);
    if (!c) throw notFound('Unknown category.');
    const changed = [];
    if (body.name !== undefined) { c.name = fields.text(body.name, { field: 'Name', max: 60, required: true }); changed.push('name'); }
    if (body.parentId !== undefined) { c.parentId = checkParent(doc, body.parentId, c.id); changed.push('parentId'); }
    if (body.archived !== undefined) { c.archived = fields.bool(body.archived, 'Archived'); changed.push('archived'); }
    if (changed.length) audit.record(doc, { actor: member.subject, action: 'category.update', targetType: 'category', targetId: c.id, at: ctx.nowIso(), fields: changed });
    return { category: view(c) };
  });
  return { body: result };
}

module.exports = { GET: list, POST: create, PATCH: patch };
