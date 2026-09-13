'use strict';
// /api/contacts
//   GET    ?workspaceId=     shared contacts of the workspace plus the caller's private contacts
//   POST   { scope, workspaceId?, name, email?, kind?, notes? }
//   PATCH  { scope, workspaceId?, contactId, ... }
//   DELETE { scope, workspaceId?, contactId }   soft delete: historical references keep a name
// A contact never has application access. Private contacts live in the person's own document
// and are never visible to anyone else, including workspace owners and site administrators.
const { readBody, query, forbidden, notFound } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { readDocument } = require('../_shared/schema');
const { roleAtLeast } = require('../_shared/authz');
const store = require('../_shared/store');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');

const view = (c, scope, selfSubject) => ({
  id: c.id, scope, ref: `${scope === 'workspace' ? 'contact' : 'pcontact'}:${c.id}`, name: c.name, email: c.email || '',
  kind: c.kind || 'person', notes: c.notes || '', ownedBySelf: scope === 'private' || c.createdBy === selfSubject,
});

function input(body, existing = {}) {
  return {
    name: body.name !== undefined ? fields.text(body.name, { field: 'Name', max: 80, required: true }) : existing.name,
    email: body.email !== undefined ? fields.email(body.email, 'Email') : existing.email || '',
    kind: body.kind !== undefined ? fields.oneOf(body.kind, ['person', 'business'], 'Kind') : existing.kind || 'person',
    notes: body.notes !== undefined ? fields.text(body.notes, { field: 'Notes', max: 2000, multiline: true }) : existing.notes || '',
  };
}

async function list(ctx, req) {
  const wsId = query(req, 'workspaceId');
  const shared = [];
  if (wsId) {
    const { doc } = await store.loadWorkspace(ctx, wsId);
    for (const c of doc.contacts || []) if (!c.deletedAt) shared.push(view(c, 'workspace', ctx.principal.subject));
  }
  const { value } = await ctx.storage.getJson(store.paths.user(ctx.principal.subject));
  const user = readDocument('user', value);
  const own = ((user && user.contacts) || []).filter((c) => !c.deletedAt).map((c) => view(c, 'private', ctx.principal.subject));
  return { body: { shared, private: own } };
}

async function create(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['scope', 'workspaceId', 'name', 'email', 'kind', 'notes']);
  const scope = fields.oneOf(body.scope, ['workspace', 'private'], 'Scope', 'private');
  const data = input(body);
  if (scope === 'private') {
    const contact = await store.mutateUser(ctx, (user) => {
      const c = { id: newId('pc'), ...data, createdAt: ctx.nowIso(), deletedAt: null };
      user.contacts = [...(user.contacts || []), c];
      return c;
    });
    return { status: 201, body: { contact: view(contact, 'private', ctx.principal.subject) } };
  }
  const wsId = requireId(body.workspaceId, 'workspaceId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (member.role === 'viewer') throw forbidden('Viewers cannot add shared contacts.');
    const c = { id: newId('con'), ...data, createdBy: member.subject, createdAt: ctx.nowIso(), deletedAt: null };
    doc.contacts = [...(doc.contacts || []), c];
    audit.record(doc, { actor: member.subject, action: 'contact.create', targetType: 'contact', targetId: c.id, at: ctx.nowIso() });
    return { contact: view(c, 'workspace', member.subject) };
  });
  return { status: 201, body: result };
}

function change(deleting) {
  return async (ctx, req) => {
    const body = fields.onlyKeys(readBody(req), ['scope', 'workspaceId', 'contactId', 'name', 'email', 'kind', 'notes']);
    const scope = fields.oneOf(body.scope, ['workspace', 'private'], 'Scope');
    const id = requireId(body.contactId, 'contactId');
    if (scope === 'private') {
      const out = await store.mutateUser(ctx, (user) => {
        const c = (user.contacts || []).find((x) => x.id === id && !x.deletedAt);
        if (!c) throw notFound('Unknown contact.');
        if (deleting) c.deletedAt = ctx.nowIso(); else Object.assign(c, input(body, c), { updatedAt: ctx.nowIso() });
        return c;
      });
      return { body: deleting ? { removed: out.id } : { contact: view(out, 'private', ctx.principal.subject) } };
    }
    const wsId = requireId(body.workspaceId, 'workspaceId');
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      const c = (doc.contacts || []).find((x) => x.id === id && !x.deletedAt);
      if (!c) throw notFound('Unknown contact.');
      if (c.createdBy !== member.subject && !roleAtLeast(member.role, 'manager')) throw forbidden('Only the creator or a manager can change this contact.');
      if (deleting) c.deletedAt = ctx.nowIso(); else Object.assign(c, input(body, c), { updatedAt: ctx.nowIso() });
      audit.record(doc, { actor: member.subject, action: deleting ? 'contact.delete' : 'contact.update', targetType: 'contact', targetId: c.id, at: ctx.nowIso() });
      return deleting ? { removed: c.id } : { contact: view(c, 'workspace', member.subject) };
    });
    return { body: result };
  };
}

module.exports = { GET: list, POST: create, PATCH: change(false), DELETE: change(true) };
