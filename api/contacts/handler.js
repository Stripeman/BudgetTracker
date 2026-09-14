'use strict';
// /api/contacts
//   GET    ?workspaceId=&includeArchived=1   shared contacts of the workspace plus the caller's
//                                            private contacts (archived ones only when asked)
//   POST   { scope, workspaceId?, name, email?, kind?, notes? }
//   POST   ?action=restore { scope, workspaceId?, contactId, reason? }
//   PATCH  { scope, workspaceId?, contactId, reason?, ... }
//   DELETE { scope, workspaceId?, contactId, reason? }   archive: never erased; references keep a name
// A contact never has application access. Private contacts live in the person's own document
// and are never visible to anyone else, including workspace owners and site administrators.
// Nothing is deleted (BT-001-05): every change keeps its before and after values, author, time
// and reason in the contact's own history (for private contacts, visible only to their owner).
// Archived contacts are left out of people selectors but keep every historical reference.
const { readBody, query, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { readDocument } = require('../_shared/schema');
const store = require('../_shared/store');
const workspaceSettings = require('../_shared/workspace-settings');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');

const TRACKED = ['name', 'email', 'kind', 'notes'];

function view(c, scope, selfSubject, names) {
  return {
    id: c.id, scope, ref: `${scope === 'workspace' ? 'contact' : 'pcontact'}:${c.id}`, name: c.name, email: c.email || '',
    kind: c.kind || 'person', notes: c.notes || '', ownedBySelf: scope === 'private' || c.createdBy === selfSubject,
    archived: !!c.deletedAt,
    history: (c.history || []).map((h) => ({ at: h.at, by: scope === 'private' ? 'You' : (names && names.get(h.by)) || 'Former member', changes: h.changes, reason: h.reason || '' })),
  };
}

function input(body, existing = {}) {
  return {
    name: body.name !== undefined ? fields.text(body.name, { field: 'Name', max: 80, required: true }) : existing.name,
    email: body.email !== undefined ? fields.email(body.email, 'Email') : existing.email || '',
    kind: body.kind !== undefined ? fields.oneOf(body.kind, ['person', 'business'], 'Kind') : existing.kind || 'person',
    notes: body.notes !== undefined ? fields.text(body.notes, { field: 'Notes', max: 2000, multiline: true }) : existing.notes || '',
  };
}

function remember(c, by, at, changes, reason) {
  if (changes.length) c.history = [...(c.history || []), { at, by, changes, reason: reason || '' }];
}

function applyEdit(c, body) {
  const next = input(body, c);
  const changes = TRACKED.filter((f) => (c[f] || '') !== (next[f] || '')).map((f) => ({ field: f, from: c[f] || '', to: next[f] || '' }));
  Object.assign(c, next);
  return changes;
}

const memberNames = (doc) => new Map((doc.members || []).map((m) => [m.subject, m.name || 'Member']));

async function list(ctx, req) {
  const wsId = query(req, 'workspaceId');
  const includeArchived = query(req, 'includeArchived') === '1';
  const keep = (c) => includeArchived || !c.deletedAt;
  const shared = [];
  if (wsId) {
    const { doc } = await store.loadWorkspace(ctx, wsId);
    const names = memberNames(doc);
    for (const c of doc.contacts || []) if (keep(c)) shared.push(view(c, 'workspace', ctx.principal.subject, names));
  }
  const { value } = await ctx.storage.getJson(store.paths.user(ctx.principal.subject));
  const user = readDocument('user', value);
  const own = ((user && user.contacts) || []).filter(keep).map((c) => view(c, 'private', ctx.principal.subject));
  return { body: { shared, private: own } };
}

async function create(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['scope', 'workspaceId', 'name', 'email', 'kind', 'notes']);
  const scope = fields.oneOf(body.scope, ['workspace', 'private'], 'Scope', 'private');
  const data = input(body);
  if (scope === 'private') {
    const contact = await store.mutateUser(ctx, (user) => {
      const nowIso = ctx.nowIso();
      const c = { id: newId('pc'), ...data, createdAt: nowIso, deletedAt: null, history: [{ at: nowIso, by: ctx.principal.subject, changes: [{ field: 'create' }], reason: '' }] };
      user.contacts = [...(user.contacts || []), c];
      return c;
    });
    return { status: 201, body: { contact: view(contact, 'private', ctx.principal.subject) } };
  }
  const wsId = requireId(body.workspaceId, 'workspaceId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (member.role === 'viewer') throw forbidden('Viewers cannot add shared contacts.');
    const nowIso = ctx.nowIso();
    const c = { id: newId('con'), ...data, createdBy: member.subject, createdAt: nowIso, deletedAt: null, history: [{ at: nowIso, by: member.subject, changes: [{ field: 'create' }], reason: '' }] };
    doc.contacts = [...(doc.contacts || []), c];
    audit.record(doc, { actor: member.subject, action: 'contact.create', targetType: 'contact', targetId: c.id, at: nowIso });
    return { contact: view(c, 'workspace', member.subject, memberNames(doc)) };
  });
  return { status: 201, body: result };
}

// action: 'update' | 'archive' | 'restore'.
function change(action) {
  return async (ctx, req) => {
    const allowed = action === 'update' ? ['scope', 'workspaceId', 'contactId', 'reason', 'name', 'email', 'kind', 'notes'] : ['scope', 'workspaceId', 'contactId', 'reason'];
    const body = fields.onlyKeys(readBody(req), allowed);
    const scope = fields.oneOf(body.scope, ['workspace', 'private'], 'Scope');
    const id = requireId(body.contactId, 'contactId');
    const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
    const apply = (c, by, nowIso) => {
      if (action === 'update') {
        if (c.deletedAt) throw conflict('Restore this contact before changing it.', 'archived');
        remember(c, by, nowIso, applyEdit(c, body), reason);
        c.updatedAt = nowIso;
      } else if (action === 'archive') {
        if (c.deletedAt) return;
        c.deletedAt = nowIso;
        remember(c, by, nowIso, [{ field: 'archived', from: false, to: true }], reason);
      } else {
        if (!c.deletedAt) return;
        c.deletedAt = null;
        remember(c, by, nowIso, [{ field: 'archived', from: true, to: false }], reason);
      }
    };
    if (scope === 'private') {
      const out = await store.mutateUser(ctx, (user) => {
        const c = (user.contacts || []).find((x) => x.id === id);
        if (!c) throw notFound('Unknown contact.');
        apply(c, ctx.principal.subject, ctx.nowIso());
        return c;
      });
      return { body: { contact: view(out, 'private', ctx.principal.subject) } };
    }
    const wsId = requireId(body.workspaceId, 'workspaceId');
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      const c = (doc.contacts || []).find((x) => x.id === id);
      if (!c) throw notFound('Unknown contact.');
      // Its creator, or whoever manages the workspace's shared lists (workspace setting, Terry 2026-09-14).
      if (c.createdBy !== member.subject && !workspaceSettings.managesSharedLists(doc, member)) throw forbidden('Only the creator or a manager can change this contact.');
      const nowIso = ctx.nowIso();
      apply(c, member.subject, nowIso);
      const auditAction = { update: 'contact.update', archive: 'contact.delete', restore: 'contact.restore' }[action];
      audit.record(doc, { actor: member.subject, action: auditAction, targetType: 'contact', targetId: c.id, at: nowIso });
      return { contact: view(c, 'workspace', member.subject, memberNames(doc)) };
    });
    return { body: result };
  };
}

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === undefined) return create(ctx, req);
  if (action === 'restore') return change('restore')(ctx, req);
  throw notFound();
}

module.exports = { GET: list, POST: post, PATCH: change('update'), DELETE: change('archive') };
