'use strict';
// /api/invitations
//   GET    ?workspaceId=                 pending invitations (inviters only)
//   POST   ?workspaceId=  { email, role }       create; returns the one-time token
//   DELETE ?workspaceId=  { invitationId }      revoke
//   POST   ?action=preview { workspaceId, token }  non-mutating: what accepting would grant
//   POST   ?action=accept  { workspaceId, token }  join (the signed-in email must match)
//
// A token is shown once and stored only as a SHA-256 hash. An invitation is not membership.
// Accepting never restores grants from an earlier membership. Any invalid, expired, revoked or
// mismatched token is the same 404, so tokens and workspaces cannot be probed.
const { readBody, query, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId, newToken, sha256Hex } = require('../_shared/ids');
const { update } = require('../_shared/storage');
const { readDocument, stampDocument } = require('../_shared/schema');
const { ROLES, ROLE_PRESETS, roleAtLeast, canWorkspace, activeMember } = require('../_shared/authz');
const store = require('../_shared/store');
const model = require('../_shared/workspace-model');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const site = require('../_shared/site');
const ledger = require('../_shared/ledger');

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ROLE_SUMMARY = {
  viewer: 'Can view shared accounts and their transactions. Cannot see anyone\'s private accounts.',
  member: 'Can view and add to shared accounts and edit their own entries. Cannot see anyone\'s private accounts.',
  manager: 'Can manage shared accounts, export shared data and invite people. Cannot see anyone\'s private accounts.',
  owner: 'Can manage the workspace, its members and shared records. Cannot see anyone\'s private accounts.',
};

function invitationView(inv) {
  return { id: inv.id, email: inv.email, role: inv.role, status: inv.status, createdAt: inv.createdAt, expiresAt: inv.expiresAt };
}

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  if (!canWorkspace(doc, ctx.principal, 'invite')) throw forbidden('Only owners and managers can see invitations.');
  const now = ctx.now();
  const pending = (doc.invitations || []).filter((i) => i.status === 'pending' && Date.parse(i.expiresAt) > now);
  return { body: { invitations: pending.map(invitationView), inviterRole: member.role } };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['email', 'role']);
  const email = fields.email(body.email, 'Email', { required: true });
  const role = fields.oneOf(body.role, ROLES, 'Role', 'member');
  const token = newToken();
  const { site: siteDoc } = await site.readSite(ctx.storage);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, me) => {
    if (!canWorkspace(doc, ctx.principal, 'invite')) throw forbidden('Only owners and managers can invite people.');
    if (siteDoc.invitationPolicy === 'owners-only' && me.role !== 'owner') throw forbidden('Site policy allows only workspace owners to invite people.');
    // An inviter can offer at most their own role; only an owner can invite an owner.
    if (!roleAtLeast(me.role, role)) throw forbidden('You cannot invite someone with a higher role than your own.');
    if (model.activeMembers(doc).some((m) => m.email === email)) throw conflict('That person is already a member.', 'already_member');
    const nowIso = ctx.nowIso();
    for (const inv of doc.invitations || []) {
      if (inv.status === 'pending' && inv.email === email) { inv.status = 'replaced'; inv.closedAt = nowIso; }
    }
    const inv = { id: newId('inv'), email, role, tokenHash: sha256Hex(token), status: 'pending', createdAt: nowIso, createdBy: me.subject, expiresAt: new Date(ctx.now() + TTL_MS).toISOString() };
    doc.invitations = [...(doc.invitations || []), inv];
    audit.record(doc, { actor: me.subject, action: 'invitation.create', targetType: 'invitation', targetId: inv.id, at: nowIso });
    return { invitation: invitationView(inv), accessPreview: { role, summary: ROLE_SUMMARY[role], capabilities: ROLE_PRESETS[role] } };
  });
  // The token is returned only by the request that created it, never stored in plain text.
  return { status: 201, body: result.replayed ? result : { ...result, token } };
}

async function revoke(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['invitationId']);
  const invitationId = requireId(body.invitationId, 'invitationId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, me) => {
    if (!canWorkspace(doc, ctx.principal, 'invite')) throw forbidden('Only owners and managers can revoke invitations.');
    const inv = (doc.invitations || []).find((i) => i.id === invitationId && i.status === 'pending');
    if (!inv) throw notFound('Unknown invitation.');
    inv.status = 'revoked';
    inv.closedAt = ctx.nowIso();
    audit.record(doc, { actor: me.subject, action: 'invitation.revoke', targetType: 'invitation', targetId: inv.id, at: ctx.nowIso() });
    return { revoked: inv.id };
  });
  return { body: result };
}

function findValid(doc, token, principal, now) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const hash = sha256Hex(token);
  const inv = (doc.invitations || []).find((i) => i.tokenHash === hash);
  if (!inv || inv.status !== 'pending' || Date.parse(inv.expiresAt) <= now || inv.email !== principal.email) return null;
  return inv;
}

async function preview(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['workspaceId', 'token']);
  const wsId = requireId(body.workspaceId, 'workspaceId');
  const { value } = await ctx.storage.getJson(store.paths.workspace(wsId));
  const doc = readDocument('workspace', value);
  // A deleted (archived) workspace takes no one in: its invitations are not valid until it is brought back.
  const inv = doc && doc.status !== 'archived' && findValid(doc, body.token, ctx.principal, ctx.now());
  if (!inv) throw notFound('This invitation is not valid for your account.');
  return { body: { workspace: { name: doc.name, kind: doc.kind }, role: inv.role, summary: ROLE_SUMMARY[inv.role], capabilities: ROLE_PRESETS[inv.role], expiresAt: inv.expiresAt } };
}

async function accept(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['workspaceId', 'token']);
  const wsId = requireId(body.workspaceId, 'workspaceId');
  // BT-014-17: an account that is not (yet, or ever) approved cannot join a workspace (or create
  // one, see api/workspaces/handler.js) — the two ways to gain any financial-data access at all. A
  // site administrator is never blocked by their own approval status.
  const { site: siteDoc } = await site.readSite(ctx.storage);
  const existingUser = await store.ensureUser(ctx, { approvalStatus: site.initialApprovalStatus(siteDoc) });
  if (existingUser.approvalStatus && existingUser.approvalStatus !== 'approved' && !ctx.siteAdmin) {
    throw forbidden(existingUser.approvalStatus === 'rejected'
      ? 'Your account request was not approved. Contact a site administrator if you believe this is a mistake.'
      : 'Your account is waiting for a site administrator to approve it before you can join a workspace.');
  }
  let joined = null;
  // The person's own workspace list is updated FIRST, so a full personal document refuses the join
  // before any membership exists instead of leaving a member whose list lacks the workspace (security
  // recheck L7). A stray id there is harmless: the list re-checks membership for every workspace.
  let added = false;
  // The profile name is used when the provider sent none (the API never receives it).
  let profileName = '';
  await store.mutateUser(ctx, (user) => {
    profileName = user.name || '';
    if ((user.workspaceIds || []).includes(wsId)) return undefined;
    user.workspaceIds = [...(user.workspaceIds || []), wsId];
    added = true;
    return true;
  });
  try {
    await join(ctx, wsId, body, (value) => { joined = value; }, profileName);
  } catch (e) {
    // A failed join takes back the id it just added, so failed attempts leave nothing behind (LA4) —
    // unless the person is a member by now (a parallel accept with a good link, or a write that landed
    // before the error), whose list must keep it (security recheck LR1). If that cannot be checked,
    // the harmless stray id stays.
    let memberNow = true;
    try {
      const { value } = await ctx.storage.getJson(store.paths.workspace(wsId));
      const doc = readDocument('workspace', value);
      memberNow = !!(doc && activeMember(doc, ctx.principal));
    } catch { memberNow = true; }
    if (added && !memberNow) {
      await store.mutateUser(ctx, (user) => {
        if (!(user.workspaceIds || []).includes(wsId)) return undefined;
        user.workspaceIds = user.workspaceIds.filter((id) => id !== wsId);
        return true;
      });
    }
    throw e;
  }
  return { body: { workspaceId: wsId, ...joined } };
}

// The caller is not yet a member, so this is the one write that bypasses mutateWorkspace's
// membership check; the token + email match is the authorization.
async function join(ctx, wsId, body, setJoined, profileName = '') {
  let joined = null;
  await update(ctx.storage, store.paths.workspace(wsId), (value) => {
    const doc = readDocument('workspace', value);
    if (!doc || doc.status === 'archived') throw notFound('This invitation is not valid for your account.');
    if (activeMember(doc, ctx.principal)) { joined = { already: true }; return undefined; }
    const inv = findValid(doc, body.token, ctx.principal, ctx.now());
    if (!inv) throw notFound('This invitation is not valid for your account.');
    const nowIso = ctx.nowIso();
    const existing = model.memberBySubject(doc, ctx.principal.subject);
    let member;
    if (existing) {
      // A rejoin starts a new membership period; the earlier one stays in the history (audit B15).
      existing.history = [...(existing.history || []), { at: nowIso, by: ctx.principal.subject, event: 'rejoined', from: existing.role, to: inv.role, invitationId: inv.id }];
      existing.status = 'active'; existing.role = inv.role; existing.rejoinedAt = nowIso;
      // Nothing from an earlier membership comes back, including a storage allowance; the reset is
      // kept in the history (security check LA2).
      if (Number.isSafeInteger(existing.allowanceBytes)) {
        existing.history = [...existing.history, { at: nowIso, by: ctx.principal.subject, event: 'allowance', from: existing.allowanceBytes, to: ledger.quotaLimit(ctx.env, null) }];
        delete existing.allowanceBytes;
      }
      existing.email = ctx.principal.email; existing.name = ctx.principal.name || profileName || existing.name;
      member = existing;
    } else {
      member = { id: newId('mem'), subject: ctx.principal.subject, email: ctx.principal.email, name: ctx.principal.name || profileName || '', role: inv.role, status: 'active', joinedAt: nowIso };
      doc.members.push(member);
    }
    inv.status = 'accepted';
    inv.closedAt = nowIso;
    inv.acceptedBy = member.id;
    audit.record(doc, { actor: ctx.principal.subject, action: 'invitation.accept', targetType: 'member', targetId: member.id, at: nowIso });
    doc.revision = (doc.revision || 0) + 1;
    doc.updatedAt = nowIso;
    joined = { memberId: member.id, role: member.role };
    const stamped = stampDocument('workspace', doc);
    // Joining removes nothing, so it gets no headroom: accepted invitations can never push the
    // workspace into the space its owner needs to administer it (security recheck, invitation accept).
    store.assertFits(ctx, stamped, 'This workspace is full, so no one can join it until its owner makes room.');
    return stamped;
  });
  setJoined(joined);
}

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === 'preview') return preview(ctx, req);
  if (action === 'accept') return accept(ctx, req);
  if (action !== undefined) throw notFound();
  return create(ctx, req);
}

module.exports = { GET: list, POST: post, DELETE: revoke };
