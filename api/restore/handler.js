'use strict';
// POST /api/restore?action=preview|execute
//   body { workspaceId, archiveId, mode: 'create-new'|'merge'|'replace', expectedEtag?, confirm? }
//
// preview   NON-MUTATING. Decrypts and validates the archive in memory and returns counts, totals
//           for accounts the caller may manage, exclusions and blockers — never records or values
//           of anything outside the caller's scope. Returns the current document ETag.
// execute   create-new: a new workspace with the caller as sole owner and no grants.
//           merge:      adds in-scope records that do not exist now; conflicts are skipped.
//           replace:    requires confirm === 'REPLACE' and the ETag from preview. A pre-restore
//                       recovery point is written first; attachments are written create-only;
//                       then ONE conditional write swaps the document. Any failure before that
//                       write leaves the workspace exactly as it was.
// Scope: owners restore shared records plus their own private accounts; other members restore only
// their own private accounts. Site administrators have no route here.
const { readBody, query, header, badRequest, notFound, conflict, HttpError } = require('../_shared/http');
const { newId, requireId, isIdempotencyKey } = require('../_shared/ids');
const { roleAtLeast } = require('../_shared/authz');
const ledger = require('../_shared/ledger');
const { PreconditionFailed } = require('../_shared/storage');
const archive = require('../_shared/archive');
const backup = require('../_shared/backup');
const store = require('../_shared/store');
const fields = require('../_shared/fields');
const backups = require('../backups/handler');
const model = require('../_shared/workspace-model');
const workspaceSettings = require('../_shared/workspace-settings');

// Every merge or replace writes a full recovery-point archive first, and members below manager
// cannot create backups themselves, so their restores are limited per day (security review SEC-R2).
// Recovery points are written whatever the site's on-demand backup policy says: they are the
// safety net of the restore itself, not an on-demand backup. The number is the workspace setting
// "Merge or replace restores a member may make each day" (owners only, Terry 2026-09-14): 3 unless
// lowered, never above that ceiling (workspace-settings MEMBER_RESTORES_MAX).
const DAY_MS = 24 * 60 * 60 * 1000;
function assertRestoreAllowance(doc, member, nowMs) {
  if (roleAtLeast(member.role, 'manager')) return;
  const limit = Math.min(workspaceSettings.get(doc, 'memberRestoresPerDay'), workspaceSettings.MEMBER_RESTORES_MAX);
  const recent = (doc.restores || []).filter((r) => r.by === member.subject && nowMs - Date.parse(r.at) < DAY_MS).length;
  if (recent >= limit) throw new HttpError(429, 'restore_limit', `You can restore at most ${limit} ${limit === 1 ? 'time' : 'times'} a day in this workspace. Try again tomorrow or ask an owner.`);
}

// What a member below manager may ask for (workspace settings, owners only): merge and replace only
// while the daily number is above 0, and only the kinds of restore the owners allow. Checked in the
// preview too, so nothing is offered that would be refused. Never widens a member's scope, which stays
// their own private accounts (backup.plan).
const MODE_WORDS = { 'create-new': 'creating a new workspace from a backup', merge: 'merge', replace: 'replace' };
function assertMemberChoice(doc, member, mode, restoreDeleted) {
  if (roleAtLeast(member.role, 'manager')) return;
  const v = workspaceSettings.values(doc);
  if (mode !== 'create-new' && v.memberRestoresPerDay === 0) throw new HttpError(403, 'member_restores_off', 'The owners of this workspace have turned off merge and replace restores for members. Ask an owner if you need one.');
  if (!v.memberRestoreModes.includes(mode)) throw new HttpError(403, 'restore_mode_off', `The owners of this workspace do not let members use this kind of restore (${MODE_WORDS[mode]}). Ask an owner if you need one.`);
  if (restoreDeleted && !v.memberRestoreModes.includes('restore-deleted')) throw new HttpError(403, 'restore_mode_off', 'The owners of this workspace do not let members bring back deleted entries in a restore. Merge without it, or ask an owner.');
}
const changesAnything = (summary) => summary.changes.add + summary.changes.update + summary.changes.remove > 0 || (summary.excluded.setAside || 0) > 0;

async function load(ctx, body) {
  const wsId = requireId(body.workspaceId, 'workspaceId');
  const archiveId = requireId(body.archiveId, 'archiveId');
  const mode = fields.oneOf(body.mode, ['create-new', 'merge', 'replace'], 'Mode');
  const { doc, etag, member } = await store.loadWorkspace(ctx, wsId);
  if (member.role === 'viewer') throw notFound('Unknown backup.');
  const keyring = archive.loadKeys(ctx.env);
  const hit = await ctx.backupStorage().getBytes(backups.archivePath(wsId, archiveId));
  if (!hit) throw notFound('Unknown backup.');
  const opened = backup.openArchive(hit.bytes, keyring, wsId);
  return { wsId, archiveId, mode, doc, etag, member, opened };
}

async function preview(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['workspaceId', 'archiveId', 'mode', 'restoreDeleted']);
  const { mode, doc, etag, member, opened, archiveId } = await load(ctx, body);
  const restoreDeleted = mode === 'merge' && fields.bool(body.restoreDeleted, 'Bring back deleted entries') === true;
  assertMemberChoice(doc, member, mode, restoreDeleted);
  const { summary } = backup.plan({ current: doc, archived: opened.doc, mode, principal: ctx.principal, member, nowIso: ctx.nowIso(), newWorkspaceId: 'ws_preview', archiveId, restoreDeleted });
  // The preview says when a merge or replace would change nothing, so Restore is not offered for a
  // request execution would refuse (nothing_to_restore; Terry's preview check, 2026-09-13).
  const nothingToRestore = mode !== 'create-new' && !changesAnything(summary);
  return {
    body: {
      archive: { archiveId, createdAt: opened.header.createdAt, reason: opened.header.reason, schemaVersion: opened.header.schemaVersion },
      ...summary, expectedEtag: etag, canExecute: summary.blockers.length === 0 && !nothingToRestore, nothingToRestore,
      confirmation: mode === 'replace' ? 'Send confirm: "REPLACE" with expectedEtag to execute.' : undefined,
    },
  };
}

async function writeAttachments(ctx, wsId, attachments, referenced) {
  for (const a of attachments) {
    if (!referenced.has(a.sha256)) continue;
    try { await ctx.storage.putBytes(store.paths.attachment(wsId, a.sha256), Buffer.from(a.base64, 'base64'), { ifNoneMatch: '*' }); } catch (e) {
      if (!(e instanceof PreconditionFailed)) throw e;
    }
  }
}

async function execute(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['workspaceId', 'archiveId', 'mode', 'expectedEtag', 'confirm', 'restoreDeleted']);
  const { wsId, archiveId, mode, doc, etag, member, opened } = await load(ctx, body);
  const nowIso = ctx.nowIso();
  const restoreDeleted = mode === 'merge' && fields.bool(body.restoreDeleted, 'Bring back deleted entries') === true;
  assertMemberChoice(doc, member, mode, restoreDeleted);

  if (mode === 'create-new') {
    const key = header(req, 'idempotency-key');
    if (key !== null && !isIdempotencyKey(key)) throw badRequest('The Idempotency-Key header is not valid.', 'invalid_idempotency_key');
    // A new workspace counts toward the person's limit (SEC-R5); a retried request replays.
    const existing = await store.ensureUser(ctx);
    if (!(key && existing.idempotency && existing.idempotency[`restore|${key}`])) await store.assertCanCreateWorkspace(ctx);
    const newWsId = await store.mutateUser(ctx, (user) => {
      if (!user.idempotency || typeof user.idempotency !== 'object') user.idempotency = {};
      const k = key ? `restore|${key}` : null;
      if (k && user.idempotency[k]) return user.idempotency[k].id;
      const id = newId('ws');
      store.recordCreation(ctx, user, id);
      if (k) user.idempotency[k] = { id, at: nowIso };
      return id;
    });
    // The new owner's name comes from their profile when the provider sent none.
    const owner = { subject: ctx.principal.subject, email: ctx.principal.email, name: ctx.principal.name || existing.name || '' };
    const { summary, next, attachments } = backup.plan({ current: doc, archived: opened.doc, mode, principal: owner, member, nowIso, newWorkspaceId: newWsId });
    backup.ensureRestorable(summary);
    const finalDoc = backup.finalize(next, { actor: ctx.principal.subject, nowIso, archiveId, mode });
    store.assertFits(ctx, finalDoc);
    await writeAttachments(ctx, newWsId, opened.attachments, attachments);
    try { await ctx.storage.putJson(store.paths.workspace(newWsId), finalDoc, { ifNoneMatch: '*' }); } catch (e) { if (!(e instanceof PreconditionFailed)) throw e; }
    await store.mutateUser(ctx, (user) => {
      if ((user.workspaceIds || []).includes(newWsId)) return undefined;
      user.workspaceIds = [...(user.workspaceIds || []), newWsId];
      return true;
    });
    const loaded = await store.loadWorkspace(ctx, newWsId);
    return { status: 201, body: { mode, workspace: model.summary(loaded.doc, loaded.member), summary } };
  }

  if (typeof body.expectedEtag !== 'string' || body.expectedEtag !== etag) {
    throw conflict('The workspace changed since the preview. Preview again before restoring.', 'stale_preview');
  }
  if (mode === 'replace' && body.confirm !== 'REPLACE') throw badRequest('Replacing requires confirm: "REPLACE".', 'confirm_required');
  const { summary, next, attachments } = backup.plan({ current: doc, archived: opened.doc, mode, principal: ctx.principal, member, nowIso, archiveId, restoreDeleted });
  backup.ensureRestorable(summary);
  // A restore that changes nothing would still write an archive, a history entry and an audit entry.
  if (!changesAnything(summary)) throw conflict('This backup already matches what you can restore, so there is nothing to restore. Nothing was changed.', 'nothing_to_restore');
  assertRestoreAllowance(doc, member, ctx.now());
  const finish = (recoveryPoint) => backup.finalize(structuredClone(next), {
    actor: ctx.principal.subject, nowIso, archiveId, mode, recoveryPoint, setAside: summary.excluded.setAside || 0,
    auditScope: member.role === 'owner' ? undefined : `self:${member.subject}`,
  });
  // The document cap and the member's allowance apply to the result before anything is written:
  // set-aside records stay in the document for good (security review SEC-R1).
  const probe = finish(null);
  store.assertFits(ctx, probe);
  ledger.assertMemberQuota(probe, member, ctx.env);
  // Counted atomically in the backup index BEFORE the archive is written, and counted even if the
  // restore then fails, so parallel attempts cannot each write a recovery point (security retest SEC-T1).
  // Twice the restores the owners allow a member each day, as the fixed 6 was twice the ceiling of 3
  // (security review of eefd115, I-2).
  if (!roleAtLeast(member.role, 'manager')) {
    const allowed = Math.min(workspaceSettings.get(doc, 'memberRestoresPerDay'), workspaceSettings.MEMBER_RESTORES_MAX);
    await backups.reserveRecoveryPoint(ctx, wsId, member.subject, 2 * allowed);
  }
  // 1. Recovery point of the current state. If this fails, nothing else happens.
  const { entry, sourceEtag } = await backups.createBackup(ctx, wsId, { reason: 'pre-restore', actor: ctx.principal.subject });
  if (sourceEtag !== etag) throw conflict('The workspace changed while preparing the restore. Nothing was changed.', 'stale_preview');
  // 2. Attachments are immutable and content-addressed; writing them first changes no record.
  await writeAttachments(ctx, wsId, opened.attachments, attachments);
  // 3. One conditional write. A concurrent change makes it fail without effect.
  const finalDoc = finish(entry.archiveId);
  store.assertFits(ctx, finalDoc);
  try { await ctx.storage.putJson(store.paths.workspace(wsId), finalDoc, { ifMatch: etag }); } catch (e) {
    if (e instanceof PreconditionFailed) throw conflict('The workspace changed during the restore. Nothing was changed; a recovery point was kept.', 'stale_preview');
    throw e;
  }
  return { body: { mode, restored: true, recoveryPoint: entry.archiveId, summary } };
}

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === 'preview') return preview(ctx, req);
  if (action === 'execute') return execute(ctx, req);
  throw notFound();
}

module.exports = { POST: post };
