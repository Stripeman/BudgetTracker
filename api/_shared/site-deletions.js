'use strict';
// The whole-workspace permanent-deletion log (BT-014). Lives OUTSIDE every workspace document, at
// `site/deletions.json`, so its record of a deletion survives the workspace it describes being
// wiped (Terry, 2026-09-17: "preserve the deletion audit record outside the deleted workspace").
// Append-only, and NEVER financial content — actor, time, workspace id/kind, dataset counts,
// backup/export choice and outcome only. Readable only by site administrators (api/analytics),
// exactly like every other site-admin surface (usage counts, workspace directory): operational
// metadata, never account, transaction, member, merchant, budget or contact content.
const { update } = require('./storage');
const { paths } = require('./store');
const { unavailable } = require('./http');

// Security review S6 (2026-09-18): this document now carries a schema version, and any EXISTING
// document whose shape is not exactly what this module wrote is refused rather than silently
// treated as an empty log — CLAUDE.md's "corrupt documents are refused, never treated as empty"
// applies here with extra force, since silently resetting this log would discard the only durable
// evidence that a permanent workspace deletion ever happened. A genuinely absent document (no prior
// deletion has ever been recorded) is the one legitimate "empty" case.
const SCHEMA_VERSION = 1;

function readEntries(value) {
  if (value === null || value === undefined) return [];
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.entries)
    && (value.schemaVersion === undefined || value.schemaVersion === SCHEMA_VERSION)) {
    return value.entries;
  }
  throw unavailable('deletion_log_corrupt', 'The workspace-deletion audit log could not be read in its expected shape. Nothing was changed or discarded; this needs a controlled repair, not an automatic reset.');
}

// Security review S2 (2026-09-18): never truncated (see the comment this replaces below), and now
// retried on a transient write failure — the wipe itself may already have committed by the time
// this write is attempted (see reconciled() below and the two callers in api/workspaces/handler.js
// and api/analytics/handler.js), so losing this specific write must never look like "nothing was
// recorded".
//
// Never truncated: CLAUDE.md §3 is explicit — "Never truncate history or audit arrays; size limits
// are solved by partitioning (ADR-003), never by deletion" — and that rule applies here with extra
// force, since a whole-workspace permanent deletion's outside log entry is often the ONLY surviving
// record that a workspace ever existed (its own internal audit is deliberately wiped with it).
// Whole-workspace permanent deletion is rare and this entry is small, so an unbounded array is not
// a near-term practical concern; if it ever needs a bound, the fix is date-based partitioning
// (ADR-003), never dropping old entries.
async function recordWorkspaceDeletion(storage, entry) {
  await update(storage, paths.deletionLog(), (value) => {
    const entries = readEntries(value);
    return { schemaVersion: SCHEMA_VERSION, entries: [...entries, entry] };
  });
}

// Retries a handful of times before giving up (security review S2): a completion entry failing to
// write must never be confused with the deletion itself failing — see the callers, which only fall
// back to logging-and-continuing (never reporting the already-successful deletion as failed) after
// this has been retried and still could not get through.
async function recordWorkspaceDeletionWithRetry(storage, entry, { attempts = 3, delayMs = 20 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try { await recordWorkspaceDeletion(storage, entry); return; } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

async function listWorkspaceDeletions(storage) {
  const { value } = await storage.getJson(paths.deletionLog());
  return readEntries(value);
}

// Security review S2 (2026-09-18): reconciles a stuck 'pending' entry (the wipe's own completion-log
// write failed, even after retries) against the workspace's ACTUAL current status, so the audit view
// never has to lie in either direction — it never claims an irreversible deletion failed when it
// actually succeeded, and it never claims one completed when it did not. This never rewrites the
// append-only log; it only affects what a reader (the site-admin deletions page) is shown. A
// correlation id groups an operation's #pending/#completed/#failed/#blocked rows together.
async function reconciled(storage, entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = String(e.id || '').replace(/#(pending|completed|failed|blocked)$/, '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const out = [];
  for (const group of groups.values()) {
    const pending = group.find((e) => e.outcome === 'pending');
    const resolved = group.filter((e) => e.outcome !== 'pending');
    if (pending && !resolved.length) {
      let deleted = false;
      try {
        const { value } = await storage.getJson(paths.workspace(pending.workspaceId));
        deleted = !!(value && value.status === 'deleted-permanent');
      } catch { /* cannot tell — leave it reported as pending for an operator to check */ }
      out.push(deleted
        ? { ...pending, outcome: 'completed', reconciledNote: 'The completion record failed to write, but the workspace was confirmed already deleted.' }
        : pending);
    } else {
      out.push(...group);
    }
  }
  return out;
}

module.exports = { recordWorkspaceDeletion, recordWorkspaceDeletionWithRetry, listWorkspaceDeletions, reconciled, SCHEMA_VERSION };
