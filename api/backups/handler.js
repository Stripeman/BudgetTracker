'use strict';
// /api/backups?workspaceId=
//   GET    backup metadata for the workspace (owners and managers). No archive bytes, no values.
//   GET    ?action=history   restores into this workspace and the records they set aside (BT-001-05
//          A7), for anyone who may restore; each set-aside record only if the caller could see it
//   POST   { reason? }  create an on-demand encrypted backup (owners and managers)
// Archives are never downloadable: they contain every member's private records, which no single
// member may read. Restores go through /api/restore, limited to the caller's scope.
const { readBody, query, forbidden, notFound, HttpError } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { update } = require('../_shared/storage');
const { readDocument } = require('../_shared/schema');
const { roleAtLeast, can, capabilitiesFor } = require('../_shared/authz');
const money = require('../_shared/money');
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
  await update(target, indexPath(wsId), (idx) => ({ ...(idx || {}), archives: [...((idx && idx.archives) || []), entry] }));
  return { entry, sourceEtag: etag };
}

// A member below manager may cause at most this many recovery points a day in one workspace. Each
// attempt is reserved in the backup index (one ETag-guarded update, so parallel requests are
// counted one by one) before its archive is written, and a failed restore still counts (security
// retest SEC-T1). Twice the completed-restore limit, so a few stale attempts do not lock anyone out.
const MEMBER_RECOVERY_POINTS_PER_DAY = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
async function reserveRecoveryPoint(ctx, wsId, subject) {
  const nowMs = ctx.now();
  await update(ctx.backupStorage(), indexPath(wsId), (idx) => {
    const value = idx || { archives: [] };
    const recent = (value.reservations || []).filter((r) => r.by === subject && nowMs - Date.parse(r.at) < DAY_MS).length;
    if (recent >= MEMBER_RECOVERY_POINTS_PER_DAY) throw new HttpError(429, 'restore_limit', 'You have tried to restore too many times today in this workspace. Try again tomorrow or ask an owner.');
    return { ...value, reservations: [...(value.reservations || []), { by: subject, at: new Date(nowMs).toISOString() }] };
  });
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
    // A restore by anyone but an owner is private to them (SEC-T5), so its recovery point is listed
    // without their name (security retest SEC-U3).
    const privateRestore = e.reason === 'pre-restore' && e.createdBy !== ctx.principal.subject && !(by && by.role === 'owner');
    return { archiveId: e.archiveId, createdAt: e.createdAt, reason: e.reason, createdBy: privateRestore ? 'A member (private restore)' : by ? by.name || 'Member' : 'Former member' };
  });
  return { body: { archives, policy: 'Backups are encrypted, kept in separate storage and never downloadable. Restores are limited to what you may manage.' } };
}

// The records a replace restore set aside are kept whole in the workspace (never deleted). Each is
// shown only if the caller could see that record: entries and bills through their account,
// accounts through their own access rule, merchants and budgets when shared or the caller's own.
// Only summaries are returned, and a restore's count is shown only to the person who ran it, since
// it can include their private records (security review finding 3).
async function history(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  if (member.role === 'viewer') throw notFound('Unknown backup.');
  const now = ctx.now();
  const subject = ctx.principal.subject;
  const nameOf = (s) => { const m = model.memberBySubject(doc, s); return m ? m.name || 'Member' : 'Former member'; };
  // Current account records take precedence over set-aside copies (current grants apply).
  const accounts = new Map([
    ...(doc.superseded || []).filter((s) => s.collection === 'accounts' && s.record).map((s) => [s.record.id, s.record]),
    ...(doc.accounts || []).map((a) => [a.id, a]),
  ]);
  const visible = (s) => {
    const r = s.record || {};
    switch (s.collection) {
      case 'accounts': return capabilitiesFor(doc, ctx.principal, accounts.get(r.id) || r, now).size > 0;
      case 'transactions':
      case 'recurring': { const a = accounts.get(r.accountId); return !!a && can(doc, ctx.principal, a, 'view-transactions', now); }
      case 'payees': return r.visibility === 'shared' || r.ownerSubject === subject;
      case 'budgets': return r.scope === 'shared' || r.ownerSubject === subject;
      case 'categories':
      case 'contacts': return true;
      default: return false;
    }
  };
  const summary = (s) => {
    const r = s.record || {};
    if (s.collection === 'transactions') return { date: r.date, amount: money.toDecimal(r.amountMinor, r.currency), currency: r.currency };
    return { name: r.name || '' };
  };
  // Archive ids only for people who may list backups, or for the person who ran that restore: a
  // member cannot list backups, so history must not become their list (security review SEC-R3).
  const seesArchives = roleAtLeast(member.role, 'manager');
  const archiveOf = (by, id) => (seesArchives || by === subject ? id || null : null);
  return {
    body: {
      // A restore by someone other than an owner touched only their own records: like its audit
      // entry, it is shown to them alone (security retest SEC-T5).
      restores: (doc.restores || []).filter((r) => !r.private || r.by === subject).map((r) => ({
        archiveId: archiveOf(r.by, r.archiveId), mode: r.mode, at: r.at, by: nameOf(r.by), recoveryPoint: archiveOf(r.by, r.recoveryPoint),
        setAside: r.by === subject ? r.setAside : null,
      })),
      setAside: (doc.superseded || []).filter(visible).map((s) => ({
        id: s.id, collection: s.collection, reason: s.reason, archiveId: archiveOf(s.by, s.archiveId), at: s.at, by: nameOf(s.by), recordId: (s.record || {}).id, summary: summary(s),
      })),
    },
  };
}

async function get(ctx, req) {
  const action = query(req, 'action');
  if (action === 'history') return history(ctx, req);
  if (action !== undefined) throw notFound();
  return list(ctx, req);
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

module.exports = { GET: get, POST: create, createBackup, reserveRecoveryPoint, archivePath, indexPath };
