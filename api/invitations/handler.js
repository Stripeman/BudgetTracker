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
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, me) => {
    if (!canWorkspace(doc, ctx.principal, 'invite')) throw forbidden('Only owners and managers can invite people.');
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
  const inv = doc && findValid(doc, body.token, ctx.principal, ctx.now());
  if (!inv) throw notFound('This invitation is not valid for your account.');
  return { body: { workspace: { name: doc.name, kind: doc.kind }, role: inv.role, summary: ROLE_SUMMARY[inv.role], capabilities: ROLE_PRESETS[inv.role], expiresAt: inv.expiresAt } };
}

async function accept(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['workspaceId', 'token']);
  const wsId = requireId(body.workspaceId, 'workspaceId');
  let joined = null;
  // The caller is not yet a member, so this is the one write that bypasses mutateWorkspace's
  // membership check; the token + email match is the authorization.
  await update(ctx.storage, store.paths.workspace(wsId), (value) => {
    const doc = readDocument('workspace', value);
    if (!doc) throw notFound('This invitation is not valid for your account.');
    if (activeMember(doc, ctx.principal)) { joined = { already: true }; return undefined; }
    const inv = findValid(doc, body.token, ctx.principal, ctx.now());
    if (!inv) throw notFound('This invitation is not valid for your account.');
    const nowIso = ctx.nowIso();
    const existing = model.memberBySubject(doc, ctx.principal.subject);
    let member;
    if (existing) {
      existing.status = 'active'; existing.role = inv.role; existing.rejoinedAt = nowIso;
      existing.email = ctx.principal.email; existing.name = ctx.principal.name || existing.name;
      member = existing;
    } else {
      member = { id: newId('mem'), subject: ctx.principal.subject, email: ctx.principal.email, name: ctx.principal.name || '', role: inv.role, status: 'active', joinedAt: nowIso };
      doc.members.push(member);
    }
    inv.status = 'accepted';
    inv.closedAt = nowIso;
    inv.acceptedBy = member.id;
    audit.record(doc, { actor: ctx.principal.subject, action: 'invitation.accept', targetType: 'member', targetId: member.id, at: nowIso });
    doc.revision = (doc.revision || 0) + 1;
    doc.updatedAt = nowIso;
    joined = { memberId: member.id, role: member.role };
    return stampDocument('workspace', doc);
  });
  await store.mutateUser(ctx, (user) => {
    if ((user.workspaceIds || []).includes(wsId)) return undefined;
    user.workspaceIds = [...(user.workspaceIds || []), wsId];
    return true;
  });
  return { body: { workspaceId: wsId, ...joined } };
}

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === 'preview') return preview(ctx, req);
  if (action === 'accept') return accept(ctx, req);
  if (action !== undefined) throw notFound();
  return create(ctx, req);
}

module.exports = { GET: list, POST: post, DELETE: revoke };
