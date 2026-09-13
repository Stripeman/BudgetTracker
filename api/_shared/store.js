'use strict';
// Document access. A WORKSPACE is one JSON document: members, invitations, grants, contacts,
// ledger and audit. That makes every financial change, its linked records and its audit entry a
// single ETag-guarded write — atomic by construction. Known limit: document size; the
// partitioning plan must be recorded in an ADR before workspaces approach it.
//
// Storage layout (single source of truth):
//   workspaces/{wsId}/workspace.json          the workspace document
//   workspaces/{wsId}/attachments/{sha256}    receipt/attachment bytes (content-addressed)
//   users/{sha256(subject)}.json              one person's profile, preferences, private
//                                              contacts and derived workspace index
//   site/settings.json                        operational site settings (no financial data)
const { update } = require('./storage');
const { readDocument, stampDocument } = require('./schema');
const { notFound, conflict } = require('./http');
const { requireId, isIdempotencyKey } = require('./ids');
const { activeMember } = require('./authz');
const { userKey } = require('./identity');

const paths = Object.freeze({
  workspace: (wsId) => `workspaces/${requireId(wsId, 'workspaceId')}/workspace.json`,
  attachment: (wsId, sha) => `workspaces/${requireId(wsId, 'workspaceId')}/attachments/${sha}`,
  user: (subject) => `users/${userKey(subject)}.json`,
  site: () => 'site/settings.json',
});

const IDEMPOTENCY_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_WORKSPACE_BYTES = 12 * 1024 * 1024;

// Reads a workspace for an active member. A missing workspace, an archived-and-purged one and
// one the caller does not belong to are all the same 404 — no existence oracle.
async function loadWorkspace(ctx, wsId) {
  const { value, etag } = await ctx.storage.getJson(paths.workspace(wsId));
  const doc = readDocument('workspace', value);
  const member = doc && activeMember(doc, ctx.principal);
  if (!doc || !member) throw notFound('Unknown workspace.');
  return { doc, etag, member };
}

// Atomic mutation of one workspace. `fn(doc, member)` changes `doc` in place and returns the
// response result. It may re-run after a lost race, so it must derive everything from `doc`.
// Idempotency: a repeated key from the same person returns the first result and writes nothing.
async function mutateWorkspace(ctx, wsId, fn, { idempotencyKey, expectedEtag } = {}) {
  if (idempotencyKey !== undefined && idempotencyKey !== null && !isIdempotencyKey(idempotencyKey)) {
    throw conflict('The Idempotency-Key header is not valid.', 'invalid_idempotency_key');
  }
  let result;
  const nowMs = ctx.now();
  const out = await update(ctx.storage, paths.workspace(wsId), (value) => {
    const doc = readDocument('workspace', value);
    const member = doc && activeMember(doc, ctx.principal);
    if (!doc || !member) throw notFound('Unknown workspace.');
    const key = idempotencyKey ? `${member.subject}|${idempotencyKey}` : null;
    if (!doc.idempotency || typeof doc.idempotency !== 'object') doc.idempotency = {};
    if (key && Object.prototype.hasOwnProperty.call(doc.idempotency, key)) {
      result = { ...doc.idempotency[key].result, replayed: true };
      return undefined;
    }
    result = fn(doc, member);
    if (result === undefined) return undefined;
    for (const [k, v] of Object.entries(doc.idempotency)) {
      if (!v || typeof v.at !== 'string' || nowMs - Date.parse(v.at) > IDEMPOTENCY_TTL_MS) delete doc.idempotency[k];
    }
    if (key) doc.idempotency[key] = { at: new Date(nowMs).toISOString(), result };
    doc.revision = (Number.isSafeInteger(doc.revision) ? doc.revision : 0) + 1;
    doc.updatedAt = new Date(nowMs).toISOString();
    const stamped = stampDocument('workspace', doc);
    if (Buffer.byteLength(JSON.stringify(stamped)) > MAX_WORKSPACE_BYTES) {
      throw conflict('This workspace has reached its storage limit. Archive older data before adding more.', 'workspace_full');
    }
    return stamped;
  }, { expectedEtag });
  return { result, etag: out.etag, written: out.written };
}

function newUserDoc(principal, nowIso) {
  return stampDocument('user', {
    subject: principal.subject, email: principal.email, name: principal.name || '',
    createdAt: nowIso, updatedAt: nowIso, workspaceIds: [], preferences: {}, contacts: [], idempotency: {},
  });
}

// Creates the person's document on first use and keeps email/name current. Returns the doc.
async function ensureUser(ctx) {
  const nowIso = new Date(ctx.now()).toISOString();
  const out = await update(ctx.storage, paths.user(ctx.principal.subject), (value) => {
    const doc = readDocument('user', value);
    if (!doc) return newUserDoc(ctx.principal, nowIso);
    if (doc.subject !== ctx.principal.subject) throw conflict('Stored profile does not match this identity.', 'identity_mismatch');
    if (doc.email === ctx.principal.email && (doc.name || '') === (ctx.principal.name || '')) return undefined;
    return stampDocument('user', { ...doc, email: ctx.principal.email, name: ctx.principal.name || doc.name || '', updatedAt: nowIso });
  });
  return readDocument('user', out.value);
}

async function mutateUser(ctx, fn) {
  const nowIso = new Date(ctx.now()).toISOString();
  let result;
  await update(ctx.storage, paths.user(ctx.principal.subject), (value) => {
    const doc = readDocument('user', value) || newUserDoc(ctx.principal, nowIso);
    result = fn(doc);
    if (result === undefined) return undefined;
    doc.updatedAt = nowIso;
    return stampDocument('user', doc);
  });
  return result;
}

module.exports = { paths, loadWorkspace, mutateWorkspace, ensureUser, mutateUser, newUserDoc, MAX_WORKSPACE_BYTES };
