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

// Security-review fix (2026-09-17): this array is never truncated. CLAUDE.md §3 is explicit —
// "Never truncate history or audit arrays; size limits are solved by partitioning (ADR-003), never
// by deletion" — and that rule applies here with extra force, since a whole-workspace permanent
// deletion's outside log entry is often the ONLY surviving record that a workspace ever existed
// (its own internal audit is deliberately wiped with it). Whole-workspace permanent deletion is
// rare and this entry is small, so an unbounded array is not a near-term practical concern; if it
// ever needs a bound, the fix is date-based partitioning (ADR-003), never dropping old entries.
async function recordWorkspaceDeletion(storage, entry) {
  await update(storage, paths.deletionLog(), (value) => {
    const entries = Array.isArray(value && value.entries) ? value.entries : [];
    return { entries: [...entries, entry] };
  });
}

async function listWorkspaceDeletions(storage) {
  const { value } = await storage.getJson(paths.deletionLog());
  return Array.isArray(value && value.entries) ? value.entries : [];
}

module.exports = { recordWorkspaceDeletion, listWorkspaceDeletions };
