'use strict';
// /api/grants?workspaceId=
//   GET    &accountId=    "Who can see this": everyone with access to the account and why
//   POST   { accountId, memberId, capabilities, expiresAt? }   grant on a PRIVATE account
//   DELETE { grantId }    revoke (the account owner) or renounce (the grantee)
//
// Only the owning member of a private account can grant access to it. Workspace ownership does
// not confer that power. Grants never include change-permissions or publish. Shared accounts
// are governed by workspace roles, so grants on them are refused.
const { readBody, query, badRequest, forbidden, notFound } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { GRANTABLE, ROLE_PRESETS, capabilitiesFor, can } = require('../_shared/authz');
const store = require('../_shared/store');
const model = require('../_shared/workspace-model');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');

function findAccount(doc, principal, accountId, now) {
  const account = (doc.accounts || []).find((a) => a.id === accountId);
  // An account the caller cannot see is indistinguishable from one that does not exist.
  if (!account || capabilitiesFor(doc, principal, account, now).size === 0) throw notFound('Unknown account.');
  return account;
}

async function whoCanSee(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const accountId = requireId(query(req, 'accountId'), 'accountId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  const now = ctx.now();
  const account = findAccount(doc, ctx.principal, accountId, now);
  const manage = can(doc, ctx.principal, account, 'change-permissions', now);
  const people = [];
  for (const m of model.activeMembers(doc)) {
    const caps = [...capabilitiesFor(doc, { subject: m.subject }, account, now)].sort();
    if (!caps.length) continue;
    let source = 'grant';
    if (account.visibility === 'shared') source = `role:${m.role}`;
    else if (account.ownerSubject === m.subject) source = 'owner';
    // A grantee of a private account sees the owner and their own access, not other grantees
    // (security review finding 5). Shared-account access follows visible workspace roles.
    if (account.visibility === 'private' && !manage && source === 'grant' && m.subject !== ctx.principal.subject) continue;
    people.push({ member: model.memberView(m, member), source, capabilities: caps });
  }
  const grants = manage
    ? (doc.grants || []).filter((g) => g.resourceId === account.id).map((g) => ({
      id: g.id, memberId: (model.memberBySubject(doc, g.subject) || {}).id || null, capabilities: g.capabilities,
      expiresAt: g.expiresAt, revokedAt: g.revokedAt, grantedAt: g.grantedAt,
    }))
    : undefined;
  return {
    body: {
      account: { id: account.id, name: account.name, visibility: account.visibility }, people, grants,
      notice: 'People who previously viewed, downloaded or exported this data may keep their copies; revoking access only blocks future retrieval.',
      rolePresets: account.visibility === 'shared' ? ROLE_PRESETS : undefined,
    },
  };
}

async function grant(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['accountId', 'memberId', 'capabilities', 'expiresAt']);
  const accountId = requireId(body.accountId, 'accountId');
  const memberId = requireId(body.memberId, 'memberId');
  if (!Array.isArray(body.capabilities) || body.capabilities.length === 0 || !body.capabilities.every((c) => GRANTABLE.includes(c))) {
    throw badRequest(`Capabilities must be chosen from: ${GRANTABLE.join(', ')}.`, 'invalid_capabilities');
  }
  const capabilities = [...new Set(body.capabilities)].sort();
  let expiresAt = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt))) throw badRequest('Expiry must be an ISO date-time.', 'invalid_date');
    if (Date.parse(body.expiresAt) <= ctx.now()) throw badRequest('Expiry must be in the future.', 'invalid_date');
    expiresAt = new Date(Date.parse(body.expiresAt)).toISOString();
  }
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, me) => {
    const now = ctx.now();
    const account = findAccount(doc, ctx.principal, accountId, now);
    if (account.visibility !== 'private') throw badRequest('Shared accounts follow workspace roles; grants apply to private accounts.', 'not_private');
    if (account.ownerSubject !== me.subject) throw forbidden('Only the owner of a private account can share it.');
    const target = model.findMember(doc, memberId);
    if (!target || target.status !== 'active') throw notFound('Unknown member.');
    if (target.subject === me.subject) throw badRequest('You already own this account.', 'self_grant');
    const nowIso = ctx.nowIso();
    // One active grant per person per account: a new grant supersedes the old one.
    for (const g of doc.grants || []) {
      if (g.resourceId === account.id && g.subject === target.subject && g.revokedAt === null) { g.revokedAt = nowIso; g.revokedBy = me.subject; }
    }
    const g = { id: newId('grt'), subject: target.subject, resourceType: 'account', resourceId: account.id, capabilities, expiresAt, revokedAt: null, grantedBy: me.subject, grantedAt: nowIso };
    doc.grants = [...(doc.grants || []), g];
    audit.record(doc, { actor: me.subject, action: 'grant.create', targetType: 'account', targetId: account.id, scope: `account:${account.id}`, at: nowIso, fields: capabilities });
    return { grant: { id: g.id, memberId: target.id, capabilities, expiresAt } };
  });
  return { status: 201, body: result };
}

async function revoke(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['grantId']);
  const grantId = requireId(body.grantId, 'grantId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, me) => {
    const g = (doc.grants || []).find((x) => x.id === grantId);
    if (!g) throw notFound('Unknown grant.');
    const account = (doc.accounts || []).find((a) => a.id === g.resourceId);
    const isOwner = account && account.ownerSubject === me.subject;
    if (!isOwner && g.subject !== me.subject) throw notFound('Unknown grant.');
    if (g.revokedAt !== null) return { revoked: g.id };
    g.revokedAt = ctx.nowIso();
    g.revokedBy = me.subject;
    audit.record(doc, { actor: me.subject, action: 'grant.revoke', targetType: 'account', targetId: g.resourceId, scope: `account:${g.resourceId}`, at: ctx.nowIso() });
    return { revoked: g.id };
  }, { allowHeadroom: true });
  return { body: result };
}

module.exports = { GET: whoCanSee, POST: grant, DELETE: revoke };
