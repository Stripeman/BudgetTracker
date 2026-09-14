'use strict';
// Site-level usage/activity counters for the site-admin Usage page (BT-012-01, Terry 2026-09-14:
// "usage statistics ... what users, how many users, frequency of use, last log ins etc").
//
// HARD BOUNDARY: this document NEVER holds financial data. No account, balance, transaction,
// budget, merchant, category or workspace name/content — only a provider subject (already the
// person's own identity, never shown to anyone but them and, here, to a site administrator), and
// two timestamps. Never an IP address or device information.
//
// One denormalized document (like site/settings.json) instead of scanning every user document on
// every dashboard load. `touch()` is called once per boot (GET /api/me) and is a no-op for a
// returning person on a day they were already recorded, so an application under normal load
// writes this document at most once per person per day — not on every request.
const { update } = require('./storage');
const { readDocument, stampDocument } = require('./schema');
const { paths } = require('./store');

// Same defensive posture as the workspace/user document caps (store.js): a size limit that is
// refused-not-truncated. Reaching it only skips recording new activity for otherwise-unknown
// people; every person and count already recorded is kept (BT-001-05 spirit: never drop history
// to make room). Site administrators can see the count is capped from the response's `truncated`.
const MAX_USAGE_BYTES = 2 * 1024 * 1024;

const DEFAULT_USAGE = Object.freeze({ totalUsers: 0, users: {}, signInsByDay: {}, newUsersByDay: {} });

const dayOf = (iso) => String(iso).slice(0, 10);

function mergeDefaults(stored) {
  return { ...structuredClone(DEFAULT_USAGE), ...(stored || {}), users: { ...((stored && stored.users) || {}) }, signInsByDay: { ...((stored && stored.signInsByDay) || {}) }, newUsersByDay: { ...((stored && stored.newUsersByDay) || {}) } };
}

async function readUsage(storage) {
  const { value, etag } = await storage.getJson(paths.usage());
  const doc = readDocument('usage', value);
  return { usage: mergeDefaults(doc), etag, exists: !!doc };
}

// Records that `subject` is present today. Idempotent per calendar day (UTC, the same convention
// the rest of the application uses for "today"): a second call the same day writes nothing at all,
// which also keeps this shared document from being contended by every request of every person.
// Concurrent first-visits-of-the-day race safely through the ETag-guarded `update` retry loop: the
// loser re-reads after the winner's write and finds nothing left to record.
async function touch(ctx, principal) {
  const nowIso = ctx.nowIso();
  const today = dayOf(nowIso);
  await update(ctx.storage, paths.usage(), (value) => {
    const stored = readDocument('usage', value);
    const current = mergeDefaults(stored);
    const prior = current.users[principal.subject];
    const isNew = !prior;
    const signedInToday = isNew || prior.lastActiveDay !== today;
    if (!signedInToday) return undefined;
    const next = {
      ...current,
      totalUsers: current.totalUsers + (isNew ? 1 : 0),
      users: { ...current.users, [principal.subject]: { createdAt: isNew ? nowIso : prior.createdAt, lastActiveAt: nowIso, lastActiveDay: today } },
      signInsByDay: { ...current.signInsByDay, [today]: (current.signInsByDay[today] || 0) + 1 },
      newUsersByDay: isNew ? { ...current.newUsersByDay, [today]: (current.newUsersByDay[today] || 0) + 1 } : current.newUsersByDay,
    };
    const stamped = stampDocument('usage', next);
    // Full: the touch is skipped (never a half-written or truncated document) rather than refused
    // to the caller — this must never break sign-in or the boot payload (see api/me/handler.js).
    if (Buffer.byteLength(JSON.stringify(stamped)) > MAX_USAGE_BYTES) return undefined;
    return stamped;
  });
}

module.exports = { readUsage, touch, MAX_USAGE_BYTES };
