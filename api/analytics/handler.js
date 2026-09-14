'use strict';
// /api/analytics — site-admin-only usage dashboard data (BT-012-01, Terry 2026-09-14: "usage
// statistics ... what users, how many users, frequency of use, last log ins etc").
//
// HARD INVARIANT (AGENTS.md/SECURITY.md): site administration never sees financial records. This
// route returns USAGE/AGGREGATE data only — never an account name, balance, transaction, budget,
// merchant, category, or a workspace's name or contents. Workspace counts are counts only, by kind
// and status, read from each workspace document's `kind`/`status` fields alone.
const { forbidden, unauthorized } = require('../_shared/http');
const { readDocument } = require('../_shared/schema');
const usage = require('../_shared/usage');

const DAYS = 30;
const USER_LIST_CAP = 200;
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

async function get(ctx) {
  if (!ctx.principal) throw unauthorized();
  if (!ctx.siteAdmin) throw forbidden('Only site administrators can see site usage.');
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

module.exports = { GET: get };
