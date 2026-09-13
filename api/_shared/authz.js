'use strict';
// THE authorization model (BT-001). Deny by default. Every financial read or write, and every
// derived surface (search, suggestions, totals, reports, exports, audit), asks these functions.
//
//  * Only an ACTIVE MEMBER of the workspace gets anything — owners of a private account too
//    (review finding 1: ownership alone never bypasses membership or the workspace boundary).
//  * SHARED resources: capabilities come from the member's workspace role preset.
//  * PRIVATE resources: the owning member, or an explicit, unexpired, unrevoked grant naming
//    this member, this resource and the capability. Workspace role is irrelevant — a workspace
//    owner cannot see another member's private account.
//  * Site administration is not an input anywhere in this file.
//  * `publish` is never granted by role or ownership alone; it needs the site to enable public
//    sharing and an explicit publication action (not yet implemented, so always denied).

const CAPABILITIES = Object.freeze(['view-balances', 'view-transactions', 'create', 'edit', 'delete',
  'comment', 'download-receipts', 'export', 'invite', 'change-permissions', 'publish']);
const CAPABILITY_SET = new Set(CAPABILITIES);

const ROLES = Object.freeze(['viewer', 'member', 'manager', 'owner']);

// Capabilities on SHARED resources, by workspace role. `edit`/`delete` for a plain member are
// limited to records they created (enforced by `canChangeRecord`).
const ROLE_PRESETS = Object.freeze({
  viewer: Object.freeze(['view-balances', 'view-transactions']),
  member: Object.freeze(['view-balances', 'view-transactions', 'create', 'edit', 'delete', 'comment', 'download-receipts']),
  manager: Object.freeze(['view-balances', 'view-transactions', 'create', 'edit', 'delete', 'comment', 'download-receipts', 'export', 'invite']),
  owner: Object.freeze(['view-balances', 'view-transactions', 'create', 'edit', 'delete', 'comment', 'download-receipts', 'export', 'invite', 'change-permissions']),
});

// What the owning member can do with their own private resource.
const PRIVATE_OWNER = Object.freeze(['view-balances', 'view-transactions', 'create', 'edit', 'delete', 'comment', 'download-receipts', 'export', 'change-permissions']);

// What may be granted to someone else on a private resource. Never change-permissions or publish.
const GRANTABLE = Object.freeze(['view-balances', 'view-transactions', 'create', 'edit', 'delete', 'comment', 'download-receipts', 'export']);

const own = (obj, key) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);

function activeMember(ws, principal) {
  if (!ws || !principal || typeof principal.subject !== 'string') return null;
  const members = Array.isArray(ws.members) ? ws.members : [];
  for (const m of members) {
    if (own(m, 'subject') && m.subject === principal.subject && own(m, 'status') && m.status === 'active' && ROLES.includes(m.role)) return m;
  }
  return null;
}

function roleAtLeast(role, minimum) {
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum) && ROLES.indexOf(minimum) >= 0;
}

function grantActive(grant, now) {
  if (!grant || typeof grant !== 'object') return false;
  if (!own(grant, 'revokedAt') || grant.revokedAt !== null) return false;
  if (!own(grant, 'expiresAt')) return false;
  if (grant.expiresAt === null) return true;
  return typeof grant.expiresAt === 'string' && Number.isFinite(Date.parse(grant.expiresAt)) && Date.parse(grant.expiresAt) > now;
}

// The full capability set this principal holds on one resource. Empty set = no access.
function capabilitiesFor(ws, principal, resource, now = Date.now()) {
  const out = new Set();
  const member = activeMember(ws, principal);
  if (!member || !resource || typeof resource !== 'object') return out;
  if (resource.visibility === 'shared') {
    for (const c of ROLE_PRESETS[member.role]) out.add(c);
    return out;
  }
  if (resource.visibility !== 'private') return out;
  if (own(resource, 'ownerSubject') && resource.ownerSubject === member.subject) {
    for (const c of PRIVATE_OWNER) out.add(c);
    return out;
  }
  const grants = Array.isArray(ws.grants) ? ws.grants : [];
  for (const g of grants) {
    if (own(g, 'subject') && g.subject === member.subject && own(g, 'resourceId') && g.resourceId === resource.id
        && g.resourceType === 'account' && grantActive(g, now) && Array.isArray(g.capabilities)) {
      for (const c of g.capabilities) if (GRANTABLE.includes(c)) out.add(c);
    }
  }
  return out;
}

function can(ws, principal, resource, capability, now = Date.now()) {
  if (!CAPABILITY_SET.has(capability) || capability === 'publish') return false;
  return capabilitiesFor(ws, principal, resource, now).has(capability);
}

// Workspace-level (non-resource) actions: inviting, managing members, shared settings.
function canWorkspace(ws, principal, capability) {
  const member = activeMember(ws, principal);
  if (!member || !CAPABILITY_SET.has(capability) || capability === 'publish') return false;
  return ROLE_PRESETS[member.role].includes(capability);
}

// A plain member may edit/delete only shared records they created; managers and owners any
// shared record; private-account owners and grantees per their capabilities.
function canChangeRecord(ws, principal, account, record, capability, now = Date.now()) {
  if (!can(ws, principal, account, capability, now)) return false;
  if (account.visibility !== 'shared') return true;
  const member = activeMember(ws, principal);
  if (member.role === 'member') return record && record.createdBy === member.subject;
  return true;
}

// THE derived-surface seams. Anything that lists, totals, suggests or exports goes through here.
function visibleAccounts(ws, principal, capability = 'view-transactions', now = Date.now()) {
  const accounts = Array.isArray(ws.accounts) ? ws.accounts : [];
  return accounts.filter((a) => !a.deletedAt && can(ws, principal, a, capability, now));
}

function visibleTransactions(ws, principal, now = Date.now()) {
  const ids = new Set(visibleAccounts(ws, principal, 'view-transactions', now).map((a) => a.id));
  const txns = Array.isArray(ws.transactions) ? ws.transactions : [];
  return txns.filter((t) => !t.deletedAt && ids.has(t.accountId));
}

module.exports = {
  CAPABILITIES, ROLES, ROLE_PRESETS, PRIVATE_OWNER, GRANTABLE, activeMember, roleAtLeast, grantActive,
  capabilitiesFor, can, canWorkspace, canChangeRecord, visibleAccounts, visibleTransactions,
};
