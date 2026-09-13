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
const { requireId, isIdempotencyKey, sha256Hex } = require('./ids');
const { activeMember } = require('./authz');
const { userKey } = require('./identity');
const ledger = require('./ledger');

const paths = Object.freeze({
  workspace: (wsId) => `workspaces/${requireId(wsId, 'workspaceId')}/workspace.json`,
  attachment: (wsId, sha) => `workspaces/${requireId(wsId, 'workspaceId')}/attachments/${sha}`,
  user: (subject) => `users/${userKey(subject)}.json`,
  site: () => 'site/settings.json',
});

const IDEMPOTENCY_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_WORKSPACE_BYTES = 12 * 1024 * 1024;
// Writes that REMOVE access or data (member removal, grant revocation, deletion, archive) may use
// reserved headroom above the cap, so a full workspace can always be administered (security
// review finding 1). `BT_WORKSPACE_MAX_BYTES` exists only so tests can exercise the cap quickly.
const HEADROOM_BYTES = 512 * 1024;
// Only half of the headroom is open to anyone but an owner, so no manager or member can use it all
// up and leave the owner unable to demote, remove or archive (security recheck SEC-V1).
// `BT_WORKSPACE_HEADROOM_BYTES` may only lower it (tests).
const headroomFor = (env, member) => {
  const configured = Number(env && env.BT_WORKSPACE_HEADROOM_BYTES);
  const total = Number.isSafeInteger(configured) && configured > 0 && configured < HEADROOM_BYTES ? configured : HEADROOM_BYTES;
  return member && member.role === 'owner' ? total : Math.floor(total / 2);
};
const maxBytes = (env) => {
  const configured = Number(env && env.BT_WORKSPACE_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 && configured < MAX_WORKSPACE_BYTES ? configured : MAX_WORKSPACE_BYTES;
};

const sizeWithoutIdempotency = (doc) => Buffer.byteLength(JSON.stringify({ ...doc, idempotency: undefined }));

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
// The idempotency record is bound to the person, the operation (`idempotencyScope`) and a hash of
// the request body: a key reused for a different operation or a different body is refused with
// 409 instead of silently replaying an unrelated result (financial review finding 9).
async function mutateWorkspace(ctx, wsId, fn, { idempotencyKey, idempotencyScope = 'default', requestHash, expectedEtag, allowHeadroom = false } = {}) {
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
    // Expired retry records are dropped before anything is charged or replayed (security recheck L3).
    for (const [k, v] of Object.entries(doc.idempotency)) {
      if (!v || typeof v.at !== 'string' || nowMs - Date.parse(v.at) > IDEMPOTENCY_TTL_MS) delete doc.idempotency[k];
    }
    if (key && Object.prototype.hasOwnProperty.call(doc.idempotency, key)) {
      const prior = doc.idempotency[key];
      if (prior.scope !== idempotencyScope || (requestHash && prior.hash !== requestHash)) {
        throw conflict('This Idempotency-Key was already used for a different request. Use a new key.', 'idempotency_key_reused');
      }
      result = { ...prior.result, replayed: true };
      return undefined;
    }
    // A non-owner member is charged for ALL the growth their writes cause, whatever kind of record it
    // lands in — entries, contacts and their history, grants, audit entries — in a per-member usage
    // counter, so no handler can be a way around the allowance (security retests SEC-T2, SEC-U1).
    // Short-lived idempotency records are not counted; they expire. Writes that remove access or data
    // (headroom) are charged but never refused; the restore that would follow is refused.
    const charged = member.role !== 'owner';
    const sizeBefore = charged ? sizeWithoutIdempotency(doc) : 0;
    const chargeBefore = charged ? ledger.memberCharge(doc, member) : 0;
    result = fn(doc, member);
    if (result === undefined) return undefined;
    if (charged) {
      const growth = sizeWithoutIdempotency(doc) - sizeBefore;
      if (growth > 0) {
        const usage = doc.memberUsage && typeof doc.memberUsage === 'object' ? doc.memberUsage : {};
        const prior = Object.prototype.hasOwnProperty.call(usage, member.subject) && Number.isSafeInteger(usage[member.subject]) ? usage[member.subject] : 0;
        doc.memberUsage = { ...usage, [member.subject]: prior + growth };
      }
      const after = ledger.memberCharge(doc, member);
      if (!allowHeadroom && after > chargeBefore && after > ledger.quotaLimit(ctx.env, member)) throw ledger.quotaExceeded();
    }
    for (const [k, v] of Object.entries(doc.idempotency)) {
      if (!v || typeof v.at !== 'string' || nowMs - Date.parse(v.at) > IDEMPOTENCY_TTL_MS) delete doc.idempotency[k];
    }
    if (key) doc.idempotency[key] = { at: new Date(nowMs).toISOString(), scope: idempotencyScope, hash: requestHash || null, result };
    doc.revision = (Number.isSafeInteger(doc.revision) ? doc.revision : 0) + 1;
    doc.updatedAt = new Date(nowMs).toISOString();
    const stamped = stampDocument('workspace', doc);
    if (Buffer.byteLength(JSON.stringify(stamped)) > maxBytes(ctx.env) + (allowHeadroom ? headroomFor(ctx.env, member) : 0)) {
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

// A person's own document (profile, preferences, private contacts) is capped too (SEC-V4). Writes
// that do not grow it are always allowed.
const MAX_USER_BYTES = 1024 * 1024;
async function mutateUser(ctx, fn) {
  const nowIso = new Date(ctx.now()).toISOString();
  let result;
  await update(ctx.storage, paths.user(ctx.principal.subject), (value) => {
    const doc = readDocument('user', value) || newUserDoc(ctx.principal, nowIso);
    const before = Buffer.byteLength(JSON.stringify(doc));
    result = fn(doc);
    if (result === undefined) return undefined;
    doc.updatedAt = nowIso;
    const stamped = stampDocument('user', doc);
    const configured = Number(ctx.env && ctx.env.BT_USER_MAX_BYTES);
    const limit = Number.isSafeInteger(configured) && configured > 0 && configured < MAX_USER_BYTES ? configured : MAX_USER_BYTES;
    const after = Buffer.byteLength(JSON.stringify(stamped));
    if (after > before && after > limit) throw conflict('Your personal storage is full, so this change cannot be saved.', 'profile_full');
    return stamped;
  });
  return result;
}

const requestHash = (body) => sha256Hex(JSON.stringify(body));

// The document cap for writes that bypass mutateWorkspace (restore execution). A restore cannot
// be the way around the cap (security review SEC-R1).
function assertFits(ctx, doc, message = 'This workspace has reached its storage limit, so this restore cannot be written. Nothing was changed.') {
  if (Buffer.byteLength(JSON.stringify(doc)) > maxBytes(ctx.env)) throw conflict(message, 'workspace_full');
}

// Whether a small headroom write (an audit entry) by this member would still fit, checked BEFORE
// work that cannot be undone, such as writing a backup archive (SEC-V1).
function assertRoomForHeadroomWrite(ctx, doc, member, margin = 2048) {
  if (Buffer.byteLength(JSON.stringify(doc)) + margin > maxBytes(ctx.env) + headroomFor(ctx.env, member)) {
    throw conflict('This workspace has reached its storage limit. Nothing was changed.', 'workspace_full');
  }
}

// How many active workspaces one person may create (security review SEC-R5): sign-up is open to any
// Google account, so creation is bounded. Archived workspaces do not count. `BT_MAX_WORKSPACES`
// may only lower the limit (tests).
const MAX_WORKSPACES_PER_PERSON = 20;
async function assertCanCreateWorkspace(ctx) {
  const configured = Number(ctx.env && ctx.env.BT_MAX_WORKSPACES);
  const limit = Number.isSafeInteger(configured) && configured > 0 && configured < MAX_WORKSPACES_PER_PERSON ? configured : MAX_WORKSPACES_PER_PERSON;
  const user = await ensureUser(ctx);
  let created = 0;
  for (const id of user.workspaceIds || []) {
    const { value } = await ctx.storage.getJson(paths.workspace(id));
    const doc = readDocument('workspace', value);
    if (doc && doc.createdBy === ctx.principal.subject && doc.status !== 'archived') created += 1;
  }
  if (created >= limit) throw conflict(`You can have up to ${limit} active workspaces that you created. Archive one you no longer use to create another.`, 'workspace_limit');
}

// New workspaces per person per day, counted atomically inside the mutateUser that reserves the new
// id (security retest SEC-T4): archiving frees an active place, so the active limit alone does not
// bound creation. `BT_MAX_WORKSPACE_CREATIONS_PER_DAY` may only lower it (tests).
const MAX_CREATIONS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
function recordCreation(ctx, user, id) {
  const configured = Number(ctx.env && ctx.env.BT_MAX_WORKSPACE_CREATIONS_PER_DAY);
  const limit = Number.isSafeInteger(configured) && configured > 0 && configured < MAX_CREATIONS_PER_DAY ? configured : MAX_CREATIONS_PER_DAY;
  const nowMs = ctx.now();
  const recent = (user.workspaceCreations || []).filter((c) => nowMs - Date.parse(c.at) < DAY_MS).length;
  if (recent >= limit) throw conflict(`You can create up to ${limit} workspaces a day. Try again tomorrow.`, 'workspace_rate');
  user.workspaceCreations = [...(user.workspaceCreations || []), { id, at: new Date(nowMs).toISOString() }];
}

module.exports = { paths, loadWorkspace, mutateWorkspace, ensureUser, mutateUser, newUserDoc, requestHash, assertFits, assertRoomForHeadroomWrite, assertCanCreateWorkspace, recordCreation, MAX_WORKSPACE_BYTES, MAX_WORKSPACES_PER_PERSON };
