'use strict';
// /api/members?workspaceId=
//   GET                         active members (names/roles; emails for self, managers, owners)
//   PATCH  { memberId, role }   change a role (owners only; only an owner grants owner)
//   DELETE { memberId }         remove a member (owner) or leave (self)
//
// Removal revokes every grant held by the removed person AND every grant others hold on the
// removed person's private accounts. Their records stay for historical attribution but become
// inaccessible. Rejoining later never restores revoked grants. A workspace always keeps at
// least one active owner.
const { readBody, query, forbidden, notFound, conflict } = require('../_shared/http');
const { requireId } = require('../_shared/ids');
const { ROLES } = require('../_shared/authz');
const store = require('../_shared/store');
const model = require('../_shared/workspace-model');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  return { body: { members: model.activeMembers(doc).map((m) => model.memberView(m, member)) } };
}

async function changeRole(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['memberId', 'role']);
  const memberId = requireId(body.memberId, 'memberId');
  const role = fields.oneOf(body.role, ROLES, 'Role');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, me) => {
    if (me.role !== 'owner') throw forbidden('Only an owner can change member roles.');
    const target = model.findMember(doc, memberId);
    if (!target || target.status !== 'active') throw notFound('Unknown member.');
    if (target.role === role) return { member: model.memberView(target, me) };
    if (target.role === 'owner' && role !== 'owner' && model.activeOwners(doc).length <= 1) {
      throw conflict('A workspace must keep at least one owner. Make someone else an owner first.', 'last_owner');
    }
    target.role = role;
    audit.record(doc, { actor: me.subject, action: 'member.role', targetType: 'member', targetId: target.id, at: ctx.nowIso(), fields: ['role'] });
    return { member: model.memberView(target, me) };
  }, { allowHeadroom: true });
  return { body: result };
}

function revokeFor(doc, subject, nowIso, actor) {
  const ownedAccounts = new Set((doc.accounts || []).filter((a) => a.visibility === 'private' && a.ownerSubject === subject).map((a) => a.id));
  let count = 0;
  for (const g of doc.grants || []) {
    if (g.revokedAt === null && (g.subject === subject || ownedAccounts.has(g.resourceId))) {
      g.revokedAt = nowIso;
      g.revokedBy = actor;
      count += 1;
    }
  }
  return count;
}

async function remove(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['memberId']);
  const memberId = requireId(body.memberId, 'memberId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, me) => {
    const target = model.findMember(doc, memberId);
    if (!target || target.status !== 'active') throw notFound('Unknown member.');
    const self = target.subject === me.subject;
    if (!self && me.role !== 'owner') throw forbidden('Only an owner can remove other members.');
    if (target.role === 'owner' && model.activeOwners(doc).length <= 1) {
      throw conflict('A workspace must keep at least one owner. Transfer ownership first.', 'last_owner');
    }
    const nowIso = ctx.nowIso();
    target.status = 'removed';
    target.removedAt = nowIso;
    target.removedBy = me.subject;
    const revoked = revokeFor(doc, target.subject, nowIso, me.subject);
    audit.record(doc, { actor: me.subject, action: self ? 'member.leave' : 'member.remove', targetType: 'member', targetId: target.id, at: nowIso });
    return { removed: target.id, grantsRevoked: revoked };
  }, { allowHeadroom: true });
  return { body: result };
}

module.exports = { GET: list, PATCH: changeRole, DELETE: remove };
