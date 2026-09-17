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

const MAX_ENTRIES = 5000;

async function recordWorkspaceDeletion(storage, entry) {
  await update(storage, paths.deletionLog(), (value) => {
    const entries = Array.isArray(value && value.entries) ? value.entries : [];
    // A bounded ring, never a silent unbounded array (ADR-003's own rule for every array applies
    // here too: partition/bound, never delete history to make room) — this log is metadata-only
    // and small per entry, so a generous bound is enough headroom for years of real use.
    const next = entries.length >= MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES + 1) : entries;
    return { entries: [...next, entry] };
  });
}

async function listWorkspaceDeletions(storage) {
  const { value } = await storage.getJson(paths.deletionLog());
  return Array.isArray(value && value.entries) ? value.entries : [];
}

module.exports = { recordWorkspaceDeletion, listWorkspaceDeletions };
