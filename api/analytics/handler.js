'use strict';
// /api/analytics — site-admin-only usage dashboard data (BT-012-01, Terry 2026-09-14: "usage
// statistics ... what users, how many users, frequency of use, last log ins etc").
//
// HARD INVARIANT (AGENTS.md/SECURITY.md): site administration never sees financial records. This
// route returns USAGE/AGGREGATE data only — never an account name, balance, transaction, budget,
// merchant, category, or a workspace's name or contents. Workspace counts are counts only, by kind
// and status, read from each workspace document's `kind`/`status` fields alone.
const { readBody, query, forbidden, unauthorized, notFound, conflict } = require('../_shared/http');
const { requireId } = require('../_shared/ids');
const { readDocument } = require('../_shared/schema');
const usage = require('../_shared/usage');
const store = require('../_shared/store');
const fields = require('../_shared/fields');
const workspaceDeletion = require('../_shared/workspace-deletion');
const siteDeletions = require('../_shared/site-deletions');

const DAYS = 30;
const USER_LIST_CAP = 200;
const DIRECTORY_CAP_DEFAULT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
// `BT_DIRECTORY_CAP`/`BT_PENDING_CAP` may only LOWER these (tests only — see the same pattern in
// api/_shared/store.js). Response-size caps only; the enumeration itself is never capped (S4 fix).
const directoryCap = (env) => { const c = Number(env && env.BT_DIRECTORY_CAP); return Number.isSafeInteger(c) && c > 0 && c < DIRECTORY_CAP_DEFAULT ? c : DIRECTORY_CAP_DEFAULT; };

function lastNDays(n, nowMs) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(new Date(nowMs - i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

// Enumerates workspace documents to count them by kind and status. Reads only `kind` and `status`
// from each — never accounts, transactions, members or any other field — so this never becomes a
// path to financial or workspace content. A workspace document this cannot read (corrupt, or a
// race with its own deletion-that-never-happens) is left out of the counts rather than failing the
// whole page: an admin aggregate should not go dark because of one unreadable workspace.
async function countWorkspaces(storage) {
  const names = (await storage.list('workspaces/')).filter((n) => n.endsWith('/workspace.json'));
  const byKindStatus = {};
  let total = 0;
  for (const name of names) {
    try {
      const { value } = await storage.getJson(name);
      const doc = readDocument('workspace', value);
      if (!doc) continue;
      total += 1;
      const key = `${doc.kind}:${doc.status}`;
      byKindStatus[key] = (byKindStatus[key] || 0) + 1;
    } catch { /* skipped: see comment above */ }
  }
  return { total, byKindStatus };
}

async function usageDashboard(ctx) {
  const nowMs = ctx.now();
  const { usage: doc } = await usage.readUsage(ctx.storage);
  const days = lastNDays(DAYS, nowMs);
  const signInsPerDay = days.map((date) => ({ date, count: doc.signInsByDay[date] || 0 }));
  const newUsersPerDay = days.map((date) => ({ date, count: doc.newUsersByDay[date] || 0 }));
  const weekAgo = new Date(nowMs - 7 * DAY_MS).toISOString().slice(0, 10);
  const users = Object.entries(doc.users)
    .map(([subject, u]) => ({ subject, createdAt: u.createdAt, lastActiveAt: u.lastActiveAt }))
    .sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));
  const activeThisWeek = users.filter((u) => u.lastActiveAt.slice(0, 10) >= weekAgo).length;
  const { total: totalWorkspaces, byKindStatus } = await countWorkspaces(ctx.storage);
  return {
    body: {
      totals: { users: doc.totalUsers, activeThisWeek, workspaces: totalWorkspaces },
      signInsPerDay, newUsersPerDay,
      workspacesByKindStatus: byKindStatus,
      users: users.slice(0, USER_LIST_CAP),
      usersTruncated: users.length > USER_LIST_CAP,
    },
  };
}

// BT-014: "a new site-wide workspace directory a site admin can enumerate WITHOUT going through
// the member-gated activeMember/loadWorkspace path (workspace id, kind, created/last-active,
// member count, per-dataset record counts, storage usage — never amounts, names, notes, balances,
// attachments)". Built on the exact same `storage.list('workspaces/')` enumeration
// countWorkspaces() above already uses for the usage totals — every field read from each document
// is either structural (kind/status/timestamps) or a plain array length; nothing that could be a
// name, note, balance or account/merchant identity is ever read here. Deliberate exception, Terry,
// 2026-09-17: "the workspace listing needs to have the real persons email address shown" — each
// active member's own email (already stored on their member record for every workspace, and
// already shown to that workspace's own owners/managers, `workspace-model.js` `memberView`) is
// included here too. A workspace's name is still never read or returned.
//
// A `deleted-permanent` workspace's tombstone document (`workspace-deletion.js` `tombstoneOf`) is
// deliberately kept in storage forever, but excluded from THIS listing (bug, Terry, 2026-09-17: "i
// deleted the workspace permanently and while it removed the data.. it didnt remove the workspace"
// — the row stayed, with an active "Delete permanently" button offering to delete an already-empty
// document). The permanent record that a deletion happened lives in the outside audit log
// (`site-deletions.js`, `?action=deletions`), not in this live operational listing.
async function directory(ctx) {
  const names = (await ctx.storage.list('workspaces/')).filter((n) => n.endsWith('/workspace.json'));
  const out = [];
  // Security review S4 (2026-09-18): the enumeration itself is never capped before filtering — a
  // capped SCAN can silently hide real, non-tombstoned workspaces sitting behind many tombstones
  // (which this listing excludes), reporting a false "nothing beyond this point" (`truncated:
  // false`) even though genuine rows exist further along. Only the RESPONSE is capped, after every
  // name has been read and filtered.
  for (const name of names) {
    try {
      const { value } = await ctx.storage.getJson(name);
      const doc = readDocument('workspace', value);
      if (!doc || doc.status === 'deleted-permanent') continue;
      const activeMembers = (doc.members || []).filter((m) => m.status === 'active');
      out.push({
        id: doc.id, kind: doc.kind, status: doc.status, createdAt: doc.createdAt, updatedAt: doc.updatedAt || null,
        memberCount: activeMembers.length, memberEmails: activeMembers.map((m) => m.email).filter(Boolean),
        datasets: workspaceDeletion.datasetCounts(doc), approxBytes: Buffer.byteLength(JSON.stringify(doc)),
      });
    } catch { /* one unreadable workspace does not take down the whole directory */ }
  }
  const cap = directoryCap(ctx.env);
  return { body: { workspaces: out.slice(0, cap), truncated: out.length > cap } };
}

const PENDING_CAP_DEFAULT = 500;
const pendingCap = (env) => { const c = Number(env && env.BT_PENDING_CAP); return Number.isSafeInteger(c) && c > 0 && c < PENDING_CAP_DEFAULT ? c : PENDING_CAP_DEFAULT; };

// BT-014-17 (Terry, 2026-09-17: "a feature that the site admin can turn off or on that enables a
// request account feature that the site admin approves"). Unlike the workspace directory above,
// showing real identity here is the whole point — an approval queue is meaningless without knowing
// WHO is asking. Still never anything financial: only the account's own subject/email/name/dates.
async function pendingUsers(ctx) {
  const names = (await ctx.storage.list('users/')).filter((n) => n.endsWith('.json'));
  const out = [];
  // Security review S4 (2026-09-18): the enumeration itself is never capped before filtering — a
  // capped SCAN could silently hide a real pending request sitting behind many already-approved
  // profiles, reporting a false "nothing beyond this point" (`truncated: false`) while a request
  // stays invisible and unreviewable. Only the RESPONSE is capped, after every profile has been
  // read and filtered.
  for (const name of names) {
    try {
      const { value } = await ctx.storage.getJson(name);
      const doc = readDocument('user', value);
      if (!doc || doc.approvalStatus !== 'pending') continue;
      out.push({ subject: doc.subject, email: doc.email || '', name: doc.name || '', createdAt: doc.createdAt });
    } catch { /* one unreadable profile does not take down the whole queue */ }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const cap = pendingCap(ctx.env);
  return { body: { pending: out.slice(0, cap), truncated: out.length > cap } };
}

// Scope deliberately narrow: this approves or rejects a REQUEST, it never revokes an already-
// approved account (that would be a separate feature). A rejected request may still be approved
// later (an administrator reconsidering), but not the other way around once approved.
async function setApproval(ctx, req, approvalStatus) {
  const body = fields.onlyKeys(readBody(req), ['subject']);
  const subject = fields.text(body.subject, { field: 'Subject', max: 200, required: true });
  const { result } = await store.mutateUserAdmin(ctx, subject, (doc) => {
    if (doc.approvalStatus === 'approved') throw conflict('This account is already approved.', 'already_approved');
    if (doc.approvalStatus === approvalStatus) throw conflict('This account already has that status.', 'no_change');
    // Security review S5 (2026-09-18): who decided, when, and the before/after status, recorded
    // atomically with the decision itself (the same document write `mutateUserAdmin` already makes
    // — never a separate best-effort write). Kept on the person's own operational document, outside
    // every workspace, same as their `approvalStatus` itself.
    const entry = { id: `appr_${doc.subject}_${ctx.now()}`, at: ctx.nowIso(), by: ctx.principal.subject, from: doc.approvalStatus, to: approvalStatus };
    doc.approvalHistory = [...(doc.approvalHistory || []), entry];
    doc.approvalStatus = approvalStatus;
    return { subject: doc.subject, approvalStatus };
  });
  return { body: result };
}

// BT-014 administrative workspace deletion. Reuses the EXACT SAME impact/apply/log logic the
// owner uses (api/workspaces/handler.js), so a site administrator can never do anything different
// to a workspace than its own owner could — only WHICH workspaces they may target (any) and how
// the write reaches the document (store.mutateWorkspaceAdmin, the one documented bypass of the
// membership gate — see its comment in api/_shared/store.js) differ. `{ adminSafe: true }` is the
// security-review fix (2026-09-17): without it, the impact/confirm payload carried the workspace's
// own name as `label`/`confirmPhrase`, leaking private content to the site administrator — the
// admin path now confirms by typing the workspace's id (already legitimately known to the admin,
// same as ?action=directory returns) instead. Nothing here ever returns a name, note, balance,
// account, transaction, merchant, budget or contact — the impact payload is exactly the same
// counts-only shape the directory above returns.
async function adminDeleteImpact(ctx, req) {
  const id = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { value } = await ctx.storage.getJson(store.paths.workspace(id));
  const doc = readDocument('workspace', value);
  if (!doc) throw notFound('Unknown workspace.');
  return { body: { impact: workspaceDeletion.toClientImpact(workspaceDeletion.impact(doc, { adminSafe: true })) } };
}

async function adminDeleteExecute(ctx, req) {
  const id = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['impactToken', 'typedConfirmation', 'reason']);
  const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
  let preImpact;
  let preDoc;
  {
    const { value } = await ctx.storage.getJson(store.paths.workspace(id));
    preDoc = readDocument('workspace', value);
    if (!preDoc) throw notFound('Unknown workspace.');
    preImpact = workspaceDeletion.impact(preDoc, { adminSafe: true });
    if (preImpact.blocked) {
      await siteDeletions.recordWorkspaceDeletion(ctx.storage, {
        id: `wsdel_${id}_${ctx.now()}`, workspaceId: id, workspaceKind: preDoc.kind, at: ctx.nowIso(),
        actor: ctx.principal.subject, actorRole: 'site-admin', datasets: preImpact.datasets, reason: reason || null, outcome: 'blocked',
      });
      throw conflict(`This workspace cannot be permanently deleted yet: ${preImpact.blockers.join(' ')}`, 'delete_blocked');
    }
  }
  // Financial-review fix (2026-09-17): the outside log entry is now written BEFORE the wipe
  // commits, then updated to 'completed' after — never only-after, which left a real window where
  // a crash between the two writes destroyed the workspace (audit intentionally cleared with it)
  // with zero durable record of the deletion anywhere in the system. See the matching comment in
  // api/workspaces/handler.js's owner-side permanentDeleteExecute.
  const correlationId = `wsdel_${id}_${ctx.now()}`;
  await siteDeletions.recordWorkspaceDeletion(ctx.storage, {
    id: `${correlationId}#pending`, workspaceId: id, workspaceKind: preDoc.kind, at: ctx.nowIso(),
    actor: ctx.principal.subject, actorRole: 'site-admin', datasets: preImpact.datasets, reason: reason || null, outcome: 'pending',
  });
  let completedEntry = null;
  let result;
  try {
    ({ result } = await store.mutateWorkspaceAdmin(ctx, id, (doc) => {
      const before = workspaceDeletion.applyPermanentDelete(doc, {
        token: body.impactToken, typedConfirmation: body.typedConfirmation, actor: ctx.principal.subject, nowIso: ctx.nowIso(), adminSafe: true,
      });
      completedEntry = {
        id: `${correlationId}#completed`, workspaceId: id, workspaceKind: before.kind, at: ctx.nowIso(),
        actor: ctx.principal.subject, actorRole: 'site-admin', datasets: before.datasets, reason: reason || null, outcome: 'completed',
      };
      return { deleted: true, id, datasets: before.datasets };
    }));
  } catch (err) {
    // The wipe itself did not commit — this is a genuine failure; nothing was deleted.
    await siteDeletions.recordWorkspaceDeletion(ctx.storage, {
      id: `${correlationId}#failed`, workspaceId: id, workspaceKind: preDoc.kind, at: ctx.nowIso(),
      actor: ctx.principal.subject, actorRole: 'site-admin', datasets: preImpact.datasets, reason: reason || null,
      outcome: 'failed', errorCode: err && err.code ? err.code : null,
    });
    throw err;
  }
  // Security review S3 (2026-09-18): best-effort, retried attachment-blob cleanup after the wipe has
  // already committed — never turns an already-successful deletion into a reported failure.
  const purge = await workspaceDeletion.purgeAttachments(ctx.storage, id);
  completedEntry.attachmentsPurged = purge.purged;
  completedEntry.attachmentsFailed = purge.failed;
  try {
    // Security review S2 (2026-09-18): retried, and its failure is never reported as a failed
    // deletion — the deletion already committed above. See site-deletions.js's reconciled().
    await siteDeletions.recordWorkspaceDeletionWithRetry(ctx.storage, completedEntry);
  } catch (auditErr) {
    if (ctx.log) (ctx.log.error || ctx.log)(`deletion_audit_completion_write_failed ${id} ${(auditErr && auditErr.code) || 'unknown'}`);
  }
  return { body: result };
}

const DELETIONS_CAP = 500;

// BT-014: reads back the outside deletion log (api/_shared/site-deletions.js) — otherwise that log
// was write-only, which defeats its own purpose as an accountability record (security review
// finding, 2026-09-17). Already counts-only/operational content (see site-deletions.js's own
// comment); no new exposure is introduced by making it readable.
async function deletionsLog(ctx) {
  const entries = await siteDeletions.listWorkspaceDeletions(ctx.storage);
  // Security review S2 (2026-09-18): reconcile a stuck 'pending' row against the workspace's actual
  // state before showing it — the completion-log write can fail even though the deletion itself
  // already committed (see site-deletions.js's reconciled()).
  const reconciledEntries = await siteDeletions.reconciled(ctx.storage, entries);
  const sorted = [...reconciledEntries].sort((a, b) => (a.at < b.at ? 1 : -1));
  return { body: { deletions: sorted.slice(0, DELETIONS_CAP), truncated: sorted.length > DELETIONS_CAP } };
}

async function get(ctx, req) {
  if (!ctx.principal) throw unauthorized();
  if (!ctx.siteAdmin) throw forbidden('Only site administrators can see site usage.');
  const action = query(req, 'action');
  if (action === 'directory') return directory(ctx);
  if (action === 'deletions') return deletionsLog(ctx);
  if (action === 'pending-users') return pendingUsers(ctx);
  if (action !== undefined) throw notFound();
  return usageDashboard(ctx);
}

async function post(ctx, req) {
  if (!ctx.principal) throw unauthorized();
  if (!ctx.siteAdmin) throw forbidden('Only site administrators can manage workspaces.');
  const action = query(req, 'action');
  if (action === 'delete-impact') return adminDeleteImpact(ctx, req);
  if (action === 'delete-permanent') return adminDeleteExecute(ctx, req);
  if (action === 'approve-user') return setApproval(ctx, req, 'approved');
  if (action === 'reject-user') return setApproval(ctx, req, 'rejected');
  throw notFound();
}

module.exports = { GET: get, POST: post };
