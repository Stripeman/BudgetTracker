'use strict';
// Whole-workspace permanent deletion (BT-014). Terry, 2026-09-17: an explicit EXCEPTION to the
// per-record cascade restriction — "An owner must be able to permanently delete their own
// workspace, including its contained datasets. Site administrators must also be able to perform
// administrative workspace deletion without gaining visibility into private financial content.
// This supersedes the earlier archive-only workspace rule. Archiving may remain a separate
// option." Both roles go through the SAME impact/confirm/audit logic here
// (api/workspaces/handler.js for owners, api/analytics/handler.js for administrative deletion);
// only who may call it and how the write reaches the document differ.
//
// SCOPE NOTE (read before extending): Shared expenses this workspace manages for or with ANOTHER
// workspace need the full flow Terry described — offer the deleting workspace's authorized data
// for download (PDF/CSV/XLSX), sever only its own connection, preserve history and names for the
// other side, resolve a sole-manager handoff first. That flow (and the CSV/JSON/XLSX/PDF export
// formats generally) is NOT built in this version: a workspace with any Shared-expenses record —
// expense, settlement or personal-ledger link — is refused rather than guessed at. A restorable
// backup remains available first through the existing /api/backups (api/_shared/archive.js /
// backup.js), which this deletion never touches or requires — Terry's spec offers it, it does not
// gate deletion on it.
const { createHash } = require('node:crypto');
const { conflict, badRequest } = require('./http');
const groups = require('./groups');
const { paths } = require('./store');

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

const DATASET_KEYS = ['accounts', 'transactions', 'payees', 'categories', 'recurring', 'budgets',
  'contacts', 'grants', 'invitations', 'groupExpenses', 'groupSettlements', 'groupLedgers'];

function datasetCounts(doc) {
  const counts = {};
  for (const k of DATASET_KEYS) counts[k] = Array.isArray(doc[k]) ? doc[k].length : 0;
  counts.members = (doc.members || []).filter((m) => m.status === 'active').length;
  return counts;
}

// Impact never carries a name, balance, note or any other financial value — only counts, so it is
// exactly as safe in the site administrator's hands as in the owner's (BT-014's site-admin rule).
//
// `adminSafe` (security review finding, 2026-09-17): the OWNER already has the workspace's name —
// it's their own workspace, shown in their own Settings — so the owner path may use it as the
// typed-confirmation phrase. A SITE ADMINISTRATOR must never learn it: `label`/`confirmPhrase`
// would otherwise leak `doc.name` (a private, user-chosen identifier) through this exact route,
// contradicting the one promise this whole feature makes ("without gaining visibility into private
// financial content"). When `adminSafe` is true, `label` is omitted and `confirmPhrase` is the
// workspace's own id instead — information the admin already legitimately has (it's the id they
// supplied to call this route, and the same id the ?action=directory listing already returns).
//
// Terry, 2026-09-17: "The behavior depends on whether the shared expense involves another
// workspace. If it is managed solely by this workspace ... delete the shared expense as part of
// the cleanup, subject to the cascade rules and double confirmation ... If it is shared with
// another workspace, sever only the deleting workspace's connection." groups.foreignWorkspaceIds
// documents why every shared expense in this codebase is managed solely by one workspace today
// (no cross-workspace participation model exists yet): so a workspace with Shared-expenses
// records is allowed to proceed — those records are wiped with everything else, exactly like
// every other dataset (`DATASET_KEYS` below already includes them) — and is refused only in the
// (today unreachable) case a foreign workspace id is actually found, rather than guessing at the
// sever/preserve/sole-manager-handoff flow that branch would then require.
function impact(doc, { adminSafe = false } = {}) {
  const shared = (doc.groupExpenses || []).length + (doc.groupSettlements || []).length + (doc.groupLedgers || []).length;
  const foreign = groups.foreignWorkspaceIds(doc);
  const blockers = [];
  // Bug (Terry, 2026-09-17): a permanently-deleted workspace's tombstone document still exists (by
  // design — see tombstoneOf's comment), so a repeat call here must refuse rather than silently
  // re-wiping an already-empty document, which would otherwise look like a harmless no-op.
  if (doc.status === 'deleted-permanent') {
    blockers.push('This workspace has already been permanently deleted. There is nothing left to remove.');
  } else if (shared && foreign.length) {
    blockers.push(`This workspace's Shared expenses involve ${foreign.length} other workspace${foreign.length === 1 ? '' : 's'}. Deleting it needs the full download/sever/preserve flow, which is not available in this version. Resolve or remove that involvement in Shared expenses first.`);
  }
  const datasets = datasetCounts(doc);
  const target = adminSafe
    ? { type: 'workspace', id: doc.id, label: null, confirmPhrase: doc.id }
    : { type: 'workspace', id: doc.id, label: doc.name, confirmPhrase: doc.name };
  const out = { target, kind: doc.kind, status: doc.status, blocked: blockers.length > 0, blockers, datasets, groupInvolved: shared > 0 && !blockers.length };
  out.token = fingerprint({ id: doc.id, blocked: out.blocked, blockers: out.blockers, datasets, revision: doc.revision || 0 });
  return out;
}

function toClientImpact(imp) {
  return { type: 'workspace', id: imp.target.id, label: imp.target.label, confirmPhrase: imp.target.confirmPhrase,
    kind: imp.kind, status: imp.status, blocked: imp.blocked, blockers: imp.blockers, datasets: imp.datasets, token: imp.token,
    // BT-014, Terry 2026-09-17: true when this workspace has Shared-expenses records that will be
    // permanently deleted along with it, so the client offers "Download before continuing" first.
    groupInvolved: !!imp.groupInvolved };
}

// A tombstone: no financial content, no members, unreachable to anyone from this point on
// (store.loadWorkspace/mutateWorkspace both require an active member, and there are none left).
// `doc.audit` is cleared too — deliberately: it is workspace content, and its OWN summary record
// is what site/deletions.json (outside the workspace) exists to preserve, not the full log.
function tombstoneOf(doc, actor, nowIso) {
  const wiped = { id: doc.id, name: '[permanently deleted workspace]', kind: doc.kind, status: 'deleted-permanent',
    createdAt: doc.createdAt, createdBy: doc.createdBy, deletedAt: nowIso, deletedBy: actor, updatedAt: nowIso,
    revision: (Number.isSafeInteger(doc.revision) ? doc.revision : 0) + 1, settings: {} };
  for (const k of DATASET_KEYS) wiped[k] = [];
  wiped.members = [];
  wiped.audit = [];
  wiped.idempotency = {};
  return wiped;
}

// Recomputes the impact FRESH (never trusts the caller's copy), refuses if blocked or if the
// impact drifted since it was reviewed, requires the workspace name typed back exactly, then wipes
// the document in place — synchronous and side-effect-free besides mutating `doc`, so it is safe
// to call from inside either store.mutateWorkspace's or store.mutateWorkspaceAdmin's callback,
// which is what makes the wipe atomic (one ETag-guarded write) regardless of which route calls it.
// Returns the pre-wipe impact (for the response and for the caller to log outside the workspace
// AFTER this write commits — see api/_shared/site-deletions.js).
function applyPermanentDelete(doc, { token, typedConfirmation, actor, nowIso, adminSafe = false }) {
  const before = impact(doc, { adminSafe });
  if (before.blocked) throw conflict(`This workspace cannot be permanently deleted yet: ${before.blockers.join(' ')}`, 'delete_blocked');
  if (!token || token !== before.token) {
    throw conflict('What this would affect has changed since you reviewed it. Review the impact again before confirming.', 'delete_impact_stale');
  }
  const expected = String(before.target.confirmPhrase || '').trim().toLowerCase();
  const typed = String(typedConfirmation || '').trim().toLowerCase();
  const mismatchMessage = adminSafe
    ? 'Type the workspace id exactly as shown to permanently delete it.'
    : 'Type the workspace name exactly as shown to permanently delete it.';
  if (!expected || typed !== expected) throw badRequest(mismatchMessage, 'confirmation_mismatch');
  const wiped = tombstoneOf(doc, actor, nowIso);
  for (const k of Object.keys(doc)) delete doc[k];
  Object.assign(doc, wiped);
  return before;
}

// Security review S3 (2026-09-18): permanent deletion wiped the workspace JSON document but left
// its separate, content-addressed attachment blobs (receipts) in storage — retained data, not
// merely "no longer reachable through the API". Called AFTER the wipe write has committed (the
// document is the source of truth for "this workspace is deleted"; attachments are a best-effort,
// retried cleanup of storage that the deleted document can no longer reference). Idempotent: a
// retried purge (or one run twice) simply finds nothing left to delete the second time. Returns
// counts only — operational metadata, never a name, sha or any attachment content — safe to record
// in the outside deletion log next to the dataset counts.
async function purgeAttachments(storage, wsId, { attempts = 3 } = {}) {
  const prefix = paths.attachmentsPrefix(wsId);
  let names;
  try { names = await storage.list(prefix); } catch { return { purged: 0, failed: 0, total: 0, listFailed: true }; }
  let purged = 0;
  let failed = 0;
  for (const name of names) {
    let done = false;
    for (let i = 0; i < attempts && !done; i += 1) {
      try { await storage.delete(name); done = true; } catch { /* retry */ }
    }
    if (done) purged += 1; else failed += 1;
  }
  return { purged, failed, total: names.length };
}

module.exports = { impact, toClientImpact, applyPermanentDelete, datasetCounts, purgeAttachments };
