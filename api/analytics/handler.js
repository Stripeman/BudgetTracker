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
const DIRECTORY_CAP = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

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
// name, note, balance or account/merchant/member identity is ever read here.
async function directory(ctx) {
  const names = (await ctx.storage.list('workspaces/')).filter((n) => n.endsWith('/workspace.json'));
  const out = [];
  for (const name of names.slice(0, DIRECTORY_CAP)) {
    try {
      const { value } = await ctx.storage.getJson(name);
      const doc = readDocument('workspace', value);
      if (!doc) continue;
      out.push({
        id: doc.id, kind: doc.kind, status: doc.status, createdAt: doc.createdAt, updatedAt: doc.updatedAt || null,
        memberCount: (doc.members || []).filter((m) => m.status === 'active').length,
        datasets: workspaceDeletion.datasetCounts(doc), approxBytes: Buffer.byteLength(JSON.stringify(doc)),
      });
    } catch { /* one unreadable workspace does not take down the whole directory */ }
  }
  return { body: { workspaces: out, truncated: names.length > DIRECTORY_CAP } };
}

// BT-014 administrative workspace deletion. Reuses the EXACT SAME impact/apply/log logic the
// owner uses (api/workspaces/handler.js), so a site administrator can never do anything different
// to a workspace than its own owner could — only WHICH workspaces they may target (any) and how
// the write reaches the document (store.mutateWorkspaceAdmin, the one documented bypass of the
// membership gate — see its comment in api/_shared/store.js) differ. Nothing here ever returns a
// name, note, balance, account, transaction, merchant, budget or contact — the impact payload is
// exactly the same counts-only shape the directory above returns.
async function adminDeleteImpact(ctx, req) {
  const id = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { value } = await ctx.storage.getJson(store.paths.workspace(id));
  const doc = readDocument('workspace', value);
  if (!doc) throw notFound('Unknown workspace.');
  return { body: { impact: workspaceDeletion.toClientImpact(workspaceDeletion.impact(doc)) } };
}

async function adminDeleteExecute(ctx, req) {
  const id = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['impactToken', 'typedConfirmation', 'reason']);
  const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
  {
    const { value } = await ctx.storage.getJson(store.paths.workspace(id));
    const doc = readDocument('workspace', value);
    if (!doc) throw notFound('Unknown workspace.');
    const imp = workspaceDeletion.impact(doc);
    if (imp.blocked) {
      await siteDeletions.recordWorkspaceDeletion(ctx.storage, {
        id: `wsdel_${id}_${ctx.now()}`, workspaceId: id, workspaceKind: doc.kind, at: ctx.nowIso(),
        actor: ctx.principal.subject, actorRole: 'site-admin', datasets: imp.datasets, reason: reason || null, outcome: 'blocked',
      });
      throw conflict(`This workspace cannot be permanently deleted yet: ${imp.blockers.join(' ')}`, 'delete_blocked');
    }
  }
  let logEntry = null;
  const { result } = await store.mutateWorkspaceAdmin(ctx, id, (doc) => {
    const before = workspaceDeletion.applyPermanentDelete(doc, {
      token: body.impactToken, typedConfirmation: body.typedConfirmation, actor: ctx.principal.subject, nowIso: ctx.nowIso(),
    });
    logEntry = {
      id: `wsdel_${id}_${ctx.now()}`, workspaceId: id, workspaceKind: before.kind, at: ctx.nowIso(),
      actor: ctx.principal.subject, actorRole: 'site-admin', datasets: before.datasets, reason: reason || null, outcome: 'completed',
    };
    return { deleted: true, id, datasets: before.datasets };
  });
  if (logEntry) await siteDeletions.recordWorkspaceDeletion(ctx.storage, logEntry);
  return { body: result };
}

async function get(ctx, req) {
  if (!ctx.principal) throw unauthorized();
  if (!ctx.siteAdmin) throw forbidden('Only site administrators can see site usage.');
  const action = query(req, 'action');
  if (action === 'directory') return directory(ctx);
  if (action !== undefined) throw notFound();
  return usageDashboard(ctx);
}

async function post(ctx, req) {
  if (!ctx.principal) throw unauthorized();
  if (!ctx.siteAdmin) throw forbidden('Only site administrators can manage workspaces.');
  const action = query(req, 'action');
  if (action === 'delete-impact') return adminDeleteImpact(ctx, req);
  if (action === 'delete-permanent') return adminDeleteExecute(ctx, req);
  throw notFound();
}

module.exports = { GET: get, POST: post };
