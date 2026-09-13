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
const { readBody, query, header, badRequest, notFound, conflict } = require('../_shared/http');
const { newId, requireId, isIdempotencyKey } = require('../_shared/ids');
const { PreconditionFailed } = require('../_shared/storage');
const archive = require('../_shared/archive');
const backup = require('../_shared/backup');
const store = require('../_shared/store');
const fields = require('../_shared/fields');
const backups = require('../backups/handler');
const model = require('../_shared/workspace-model');

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
  const body = fields.onlyKeys(readBody(req), ['workspaceId', 'archiveId', 'mode']);
  const { mode, doc, etag, member, opened, archiveId } = await load(ctx, body);
  const { summary } = backup.plan({ current: doc, archived: opened.doc, mode, principal: ctx.principal, member, nowIso: ctx.nowIso(), newWorkspaceId: 'ws_preview' });
  return {
    body: {
      archive: { archiveId, createdAt: opened.header.createdAt, reason: opened.header.reason, schemaVersion: opened.header.schemaVersion },
      attachments: { total: opened.attachments.length, verified: opened.attachments.length },
      ...summary, expectedEtag: etag, canExecute: summary.blockers.length === 0,
      confirmation: mode === 'replace' ? 'Send confirm: "REPLACE" with expectedEtag to execute.' : undefined,
    },
  };
}

async function writeAttachments(ctx, wsId, attachments) {
  for (const a of attachments) {
    try { await ctx.storage.putBytes(store.paths.attachment(wsId, a.sha256), Buffer.from(a.base64, 'base64'), { ifNoneMatch: '*' }); } catch (e) {
      if (!(e instanceof PreconditionFailed)) throw e;
    }
  }
}

async function execute(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['workspaceId', 'archiveId', 'mode', 'expectedEtag', 'confirm']);
  const { wsId, archiveId, mode, doc, etag, member, opened } = await load(ctx, body);
  const nowIso = ctx.nowIso();

  if (mode === 'create-new') {
    const key = header(req, 'idempotency-key');
    if (key !== null && !isIdempotencyKey(key)) throw badRequest('The Idempotency-Key header is not valid.', 'invalid_idempotency_key');
    const newWsId = await store.mutateUser(ctx, (user) => {
      if (!user.idempotency || typeof user.idempotency !== 'object') user.idempotency = {};
      const k = key ? `restore|${key}` : null;
      if (k && user.idempotency[k]) return user.idempotency[k].id;
      const id = newId('ws');
      if (k) user.idempotency[k] = { id, at: nowIso };
      return id;
    });
    const { summary, next } = backup.plan({ current: doc, archived: opened.doc, mode, principal: ctx.principal, member, nowIso, newWorkspaceId: newWsId });
    backup.ensureRestorable(summary);
    const finalDoc = backup.finalize(next, { actor: ctx.principal.subject, nowIso, archiveId, mode });
    await writeAttachments(ctx, newWsId, opened.attachments);
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
  const { summary, next } = backup.plan({ current: doc, archived: opened.doc, mode, principal: ctx.principal, member, nowIso });
  backup.ensureRestorable(summary);
  // 1. Recovery point of the current state. If this fails, nothing else happens.
  const { entry, sourceEtag } = await backups.createBackup(ctx, wsId, { reason: 'pre-restore', actor: ctx.principal.subject });
  if (sourceEtag !== etag) throw conflict('The workspace changed while preparing the restore. Nothing was changed.', 'stale_preview');
  // 2. Attachments are immutable and content-addressed; writing them first changes no record.
  await writeAttachments(ctx, wsId, opened.attachments);
  // 3. One conditional write. A concurrent change makes it fail without effect.
  const finalDoc = backup.finalize(next, { actor: ctx.principal.subject, nowIso, archiveId, mode });
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
