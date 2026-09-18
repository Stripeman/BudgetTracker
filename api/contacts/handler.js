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
const { readBody, query, forbidden, notFound, conflict, badRequest } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { readDocument } = require('../_shared/schema');
const store = require('../_shared/store');
const workspaceSettings = require('../_shared/workspace-settings');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const deletion = require('../_shared/deletion');

const TRACKED = ['name', 'email', 'kind', 'notes'];

function view(c, scope, selfSubject, names) {
  return {
    id: c.id, scope, ref: `${scope === 'workspace' ? 'contact' : 'pcontact'}:${c.id}`, name: c.name, email: c.email || '',
    kind: c.kind || 'person', notes: c.notes || '', ownedBySelf: scope === 'private' || c.createdBy === selfSubject,
    archived: !!c.deletedAt,
    // BT-009-15: set once an invitation linked to this (workspace) contact is accepted — never on
    // a private contact, which invitations cannot reference at all.
    joinedMemberId: c.joinedMemberId || null,
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

// Permanent deletion (BT-014): WORKSPACE contacts, addressed by workspaceId + contactId like every
// other action on this route.
const permanentRoutes = deletion.makeRoutes({
  type: 'contact', idField: 'contactId',
  find: (doc, id) => (doc.contacts || []).find((c) => c.id === id) || null,
  authorize: (doc, member, c) => { if (c.createdBy !== member.subject && !workspaceSettings.managesSharedLists(doc, member)) throw forbidden('Only the creator or a manager can change this contact.'); },
});

// PRIVATE contact permanent deletion (BT-014 follow-up — closes a gap this file used to disclose
// as not built: "this build has no safe way to scan every workspace" for cross-workspace
// references). A private contact lives in the person's own document, but can be referenced (as
// `pcontact:<id>`, api/_shared/people.js: "usable only on their private records") only by ITS OWN
// OWNER, only on THEIR OWN records — which can be spread across every workspace they belong to.
// `deletion.js`'s `makeRoutes()` is built around one workspace document's own ETag-guarded
// read-modify-write, so it cannot express "scan every one of my own workspaces first, then write
// to my own document"; this is a parallel, smaller implementation of the SAME two-step contract
// (fresh recompute at execute time, a fingerprint that detects drift between review and
// confirmation, a typed confirmation), returned in the exact shape `deletion.toClientImpact`
// already returns, so the existing frontend dialog (app/js/ui/permanentdelete.js) drives both
// without needing to know the difference. Unlike a workspace contact, there is no per-user audit
// log construct in this codebase to record the deletion in (only workspace `doc.audit` and the
// whole-workspace `site/deletions.json`, neither of which fits a private, single-owner action) —
// a private contact's own history already disappears with it exactly like a workspace contact's
// does (`contactApply` above keeps no separate trail for the record either), so this adds no new
// audit mechanism rather than inventing one for a single-actor, self-only action.
// Shared expenses are never scanned here: `groups.participantChecker` (api/_shared/groups.js)
// already refuses a `pcontact:` ref outright at the point a shared expense is created or edited
// ("Private contacts cannot take part in shared expenses, because the other members cannot see
// them"), so a private contact's ref can never actually reach `doc.groupExpenses`/
// `doc.groupSettlements` in the first place — confirmed by reading that guard, not assumed.
async function privateContactBlockers(ctx, user, ref) {
  let entries = 0;
  for (const wsId of user.workspaceIds || []) {
    const { value } = await ctx.storage.getJson(store.paths.workspace(wsId));
    const doc = readDocument('workspace', value);
    if (!doc) continue;
    entries += (doc.transactions || []).filter((t) => t.responsibleRef === ref).length;
    entries += (doc.recurring || []).filter((r) => r.responsibleRef === ref).length;
  }
  const blockers = [];
  if (entries) blockers.push(`${entries} entr${entries === 1 ? 'y names' : 'ies name'} this contact as responsible for it. Change ${entries === 1 ? 'it' : 'them'} first.`);
  return blockers;
}
function privateImpact(contact, blockers) {
  const token = deletion.fingerprint({ type: 'pcontact', id: contact.id, blocked: blockers.length > 0, blockers });
  return {
    type: 'contact', id: contact.id, label: contact.name, confirmPhrase: contact.name,
    blocked: blockers.length > 0, blockers, cascade: [], together: [], severed: [], autoCleanup: [], groupInvolved: false, token,
  };
}
async function privateImpactRoute(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['scope', 'contactId']);
  const id = requireId(body.contactId, 'contactId');
  const user = await store.ensureUser(ctx);
  const contact = (user.contacts || []).find((c) => c.id === id);
  if (!contact) throw notFound('Unknown contact.');
  const blockers = await privateContactBlockers(ctx, user, `pcontact:${id}`);
  return { body: { impact: privateImpact(contact, blockers) } };
}
async function privatePermanentRoute(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['scope', 'contactId', 'impactToken', 'typedConfirmation', 'reason']);
  const id = requireId(body.contactId, 'contactId');
  const user = await store.ensureUser(ctx);
  const contact = (user.contacts || []).find((c) => c.id === id);
  if (!contact) throw notFound('Unknown contact.');
  // Recomputed fresh here, never trusting the client's earlier copy — the same "revalidate at
  // final confirmation" rule deletion.js's own execute() follows.
  const blockers = await privateContactBlockers(ctx, user, `pcontact:${id}`);
  const impact = privateImpact(contact, blockers);
  if (impact.blocked) throw conflict(`This cannot be permanently deleted yet: ${impact.blockers.join(' ')}`, 'delete_blocked');
  if (!body.impactToken || body.impactToken !== impact.token) {
    throw conflict('What this would affect has changed since you reviewed it. Review the impact again before confirming.', 'delete_impact_stale');
  }
  const expected = String(impact.confirmPhrase || '').trim().toLowerCase();
  const typed = String(body.typedConfirmation || '').trim().toLowerCase();
  if (!expected || typed !== expected) throw badRequest('Type the confirmation text exactly as shown to permanently delete this.', 'confirmation_mismatch');
  await store.mutateUser(ctx, (u) => {
    const c = (u.contacts || []).find((x) => x.id === id);
    if (!c) throw notFound('Unknown contact.');
    u.contacts = (u.contacts || []).filter((x) => x.id !== id);
    return { deleted: true };
  });
  return { body: { deleted: true, type: 'contact', id, impact } };
}

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === undefined) return create(ctx, req);
  if (action === 'restore') return change('restore')(ctx, req);
  if (action === 'delete-impact' || action === 'delete-permanent') {
    const scope = fields.oneOf(readBody(req).scope, ['workspace', 'private'], 'Scope', 'workspace');
    if (scope === 'private') return action === 'delete-impact' ? privateImpactRoute(ctx, req) : privatePermanentRoute(ctx, req);
    return action === 'delete-impact' ? permanentRoutes.impactRoute(ctx, req) : permanentRoutes.permanentRoute(ctx, req);
  }
  throw notFound();
}

module.exports = { GET: list, POST: post, PATCH: change('update'), DELETE: change('archive') };
