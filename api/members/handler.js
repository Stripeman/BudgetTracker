'use strict';
// /api/members?workspaceId=
//   GET                         active members (names/roles; emails for self, managers, owners)
//   PATCH  { memberId, role?, allowanceMb? }   change a role and/or a member's storage allowance
//                               (owners only; only an owner grants owner)
//   DELETE { memberId }         remove a member (owner) or leave (self)
//
// Removal revokes every grant held by the removed person AND every grant others hold on the
// removed person's private accounts. Their records stay for historical attribution but become
// inaccessible. Rejoining later never restores revoked grants. A workspace always keeps at
// least one active owner.
const { readBody, query, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { requireId } = require('../_shared/ids');
const { ROLES } = require('../_shared/authz');
const store = require('../_shared/store');
const model = require('../_shared/workspace-model');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const ledger = require('../_shared/ledger');

// Storage allowances an owner may give a member, in MB (Terry, 2026-09-13; security recheck
// SEC-V3). Owners have none: the workspace limit applies to them.
const ALLOWANCE_MB = Object.freeze([1, 2, 4, 8, 12]);
const MB = 1024 * 1024;

// A member's allowance is shown to owners (who set it) and to the member. How much they use is
// shown to the member alone: it reflects their private records too.
function view(doc, m, viewer, env) {
  const out = model.memberView(m, viewer);
  if (m.role !== 'owner' && (out.self || viewer.role === 'owner')) out.allowanceBytes = ledger.quotaLimit(env, m);
  if (m.role !== 'owner' && out.self) out.usedBytes = ledger.memberCharge(doc, m);
  // BT-009-15: a member who was invited by linking to an existing workspace contact — shown to
  // anyone who can already see this member (never a secret; it is the same relationship the
  // shared-expense balances/history already combine), so people recognize someone they may have
  // known first as a contact.
  const fromContact = (doc.contacts || []).find((c) => c.joinedMemberId === m.id);
  if (fromContact) out.joinedFromContactName = fromContact.name;
  return out;
}

// includeFormer=1 (owners and managers) adds former members with their membership history, so
// removals and role changes stay visible (BT-001-05, audit B15/D6).
async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  const members = model.activeMembers(doc).map((m) => view(doc, m, member, ctx.env));
  if (query(req, 'includeFormer') !== '1') return { body: { members } };
  if (member.role !== 'owner' && member.role !== 'manager') throw forbidden('Only owners and managers can see former members.');
  const names = new Map((doc.members || []).map((m) => [m.subject, m.name || 'Member']));
  // Allowance sizes are for owners, who set them; managers see only that one changed (security check LA1).
  const historyOf = (m) => (m.history || []).map((h) => (h.event === 'allowance' && member.role !== 'owner'
    ? { at: h.at, event: h.event, by: names.get(h.by) || 'Former member' }
    : { ...h, by: names.get(h.by) || 'Former member' }));
  return {
    body: {
      members: members.map((v) => ({ ...v, history: historyOf(model.findMember(doc, v.id)) })),
      former: (doc.members || []).filter((m) => m.status !== 'active').map((m) => ({ ...model.memberView(m, member), removedAt: m.removedAt || null, history: historyOf(m) })),
    },
  };
}

// Membership history, append-only: role changes, removals, departures and rejoins.
function addHistory(m, entry) {
  m.history = [...(m.history || []), entry];
}

async function changeMember(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['memberId', 'role', 'allowanceMb']);
  const memberId = requireId(body.memberId, 'memberId');
  if (body.role === undefined && body.allowanceMb === undefined) throw badRequest('Send a role or a storage allowance to change.', 'missing_field');
  const role = body.role === undefined ? undefined : fields.oneOf(body.role, ROLES, 'Role');
  const allowanceMb = body.allowanceMb === undefined ? undefined : fields.oneOf(body.allowanceMb, ALLOWANCE_MB, 'Allowance (MB)');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, me) => {
    if (me.role !== 'owner') throw forbidden(role !== undefined ? 'Only an owner can change member roles.' : 'Only an owner can change storage allowances.');
    const target = model.findMember(doc, memberId);
    if (!target || target.status !== 'active') throw notFound('Unknown member.');
    const nowIso = ctx.nowIso();
    if (role !== undefined && target.role !== role) {
      if (target.role === 'owner' && role !== 'owner' && model.activeOwners(doc).length <= 1) {
        throw conflict('A workspace must keep at least one owner. Make someone else an owner first.', 'last_owner');
      }
      addHistory(target, { at: nowIso, by: me.subject, event: 'role', from: target.role, to: role });
      target.role = role;
      audit.record(doc, { actor: me.subject, action: 'member.role', targetType: 'member', targetId: target.id, at: nowIso, fields: ['role'] });
    }
    if (allowanceMb !== undefined) {
      // Not even an owner demoting themselves in the same request (security check LA3).
      if (target.subject === me.subject) throw conflict('You cannot set your own storage allowance.', 'own_allowance');
      if (target.role === 'owner') throw conflict('Owners have no storage allowance; the workspace limit applies to them.', 'owner_allowance');
      const to = allowanceMb * MB;
      const from = ledger.quotaLimit(ctx.env, target);
      if (target.allowanceBytes !== to) {
        // Kept in the membership history with before and after values (BT-001-05).
        addHistory(target, { at: nowIso, by: me.subject, event: 'allowance', from, to });
        target.allowanceBytes = to;
        audit.record(doc, { actor: me.subject, action: 'member.allowance', targetType: 'member', targetId: target.id, at: nowIso, fields: ['allowance'] });
      }
    }
    return { member: view(doc, target, me, ctx.env) };
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
  const body = fields.onlyKeys(readBody(req), ['memberId', 'reason']);
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
    addHistory(target, { at: nowIso, by: me.subject, event: self ? 'left' : 'removed', role: target.role, reason: fields.text(body.reason, { field: 'Reason', max: 200 }) });
    target.status = 'removed';
    target.removedAt = nowIso;
    target.removedBy = me.subject;
    const revoked = revokeFor(doc, target.subject, nowIso, me.subject);
    audit.record(doc, { actor: me.subject, action: self ? 'member.leave' : 'member.remove', targetType: 'member', targetId: target.id, at: nowIso });
    return { removed: target.id, grantsRevoked: revoked };
  }, { allowHeadroom: true });
  return { body: result };
}

module.exports = { GET: list, PATCH: changeMember, DELETE: remove, ALLOWANCE_MB };
