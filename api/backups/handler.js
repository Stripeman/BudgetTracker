'use strict';
// /api/backups?workspaceId=
//   GET    backup metadata for the workspace (owners and managers). No archive bytes, no values.
//   POST   { reason? }  create an on-demand encrypted backup (owners and managers)
// Archives are never downloadable: they contain every member's private records, which no single
// member may read. Restores go through /api/restore, limited to the caller's scope.
const { readBody, query, forbidden } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { update } = require('../_shared/storage');
const { readDocument } = require('../_shared/schema');
const { roleAtLeast } = require('../_shared/authz');
const archive = require('../_shared/archive');
const backup = require('../_shared/backup');
const store = require('../_shared/store');
const model = require('../_shared/workspace-model');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const site = require('../_shared/site');

const indexPath = (wsId) => `workspaces/${wsId}/index.json`;
const archivePath = (wsId, archiveId) => `workspaces/${wsId}/${archiveId}.btbk`;

// Creates an archive of the CURRENT stored document. Used by the POST route and by restore
// (pre-restore recovery point). The caller has already authorized the workspace.
async function createBackup(ctx, wsId, { reason, actor }) {
  const keyring = archive.loadKeys(ctx.env);
  const { value, etag } = await ctx.storage.getJson(store.paths.workspace(wsId));
  const doc = readDocument('workspace', value);
  const attachments = await backup.readAttachments(ctx.storage, wsId);
  const archiveId = newId('bak');
  const createdAt = ctx.nowIso();
  const built = backup.buildArchive({ doc, attachments, keyring, archiveId, createdAt, reason });
  const target = ctx.backupStorage();
  await target.putBytes(archivePath(wsId, archiveId), built.bytes, { ifNoneMatch: '*' });
  const entry = { archiveId, createdAt, reason, createdBy: actor, bytes: built.bytes.length, keyId: keyring.active, schemaVersion: doc.schemaVersion, sourceRevision: doc.revision, counts: built.manifest.counts };
  await update(target, indexPath(wsId), (idx) => ({ archives: [...((idx && idx.archives) || []), entry] }));
  return { entry, sourceEtag: etag };
}

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can see backups.');
  const { value } = await ctx.backupStorage().getJson(indexPath(wsId));
  const archives = ((value && value.archives) || []).slice().reverse().map((e) => {
    const by = model.memberBySubject(doc, e.createdBy);
    // No record counts: whole-workspace counts would reveal other members' private activity
    // (security review finding 3).
    return { archiveId: e.archiveId, createdAt: e.createdAt, reason: e.reason, createdBy: by ? by.name || 'Member' : 'Former member' };
  });
  return { body: { archives, policy: 'Backups are encrypted, kept in separate storage and never downloadable. Restores are limited to what you may manage.' } };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['reason']);
  const reason = fields.oneOf(body.reason, ['on-demand', 'before-change'], 'Reason', 'on-demand');
  const { member } = await store.loadWorkspace(ctx, wsId);
  if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can create backups.');
  const { site: siteDoc } = await site.readSite(ctx.storage);
  if (siteDoc.backupPolicy && siteDoc.backupPolicy.onDemand === false) throw forbidden('On-demand backups are disabled by the site administrator.');
  const { entry } = await createBackup(ctx, wsId, { reason, actor: member.subject });
  await store.mutateWorkspace(ctx, wsId, (doc, me) => {
    audit.record(doc, { actor: me.subject, action: 'backup.create', targetType: 'backup', targetId: entry.archiveId, scope: 'managers', at: ctx.nowIso() });
    return { ok: true };
  }, { allowHeadroom: true });
  return { status: 201, body: { archive: { archiveId: entry.archiveId, createdAt: entry.createdAt, reason: entry.reason } } };
}

module.exports = { GET: list, POST: create, createBackup, archivePath, indexPath };
