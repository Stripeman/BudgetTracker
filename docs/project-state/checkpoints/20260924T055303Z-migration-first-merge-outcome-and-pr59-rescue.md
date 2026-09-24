# Outcome: PR #60 (checkpoint migration + merge policy) merged and deployed; PR #59's stranded record rescued

**Date (UTC):** 2026-09-24 05:53 Z
**Branch:** `docs/project-state-followup` (small, self-merged — see policy notes below)
**Verified commit:** `eb750a7d9674bba5055fa9fdaa5e42da38b8939d` (the commit this checkpoint's own
claims were checked against; itself a `main` commit at write time)
**Relates to / supersedes:** `docs/project-state/checkpoints/20260924T054048Z-migration-split-
project-state.md` (the migration) and `.../20260924T054237Z-agent-managed-merge-policy.md` (the
policy) — this is their first-execution outcome, recorded as a fact after it genuinely happened, not
predicted in either of those.

## Status

- **Implementation:** complete (this checkpoint plus the PR #59 rescue described below).
- **Merge:** PR #60 merged as `eb750a7d9674bba5055fa9fdaa5e42da38b8939d` — the FIRST merge performed
  under the new agent-managed-merge policy. Required checks (`secret-scan`, `foundation-tests`) both
  passed before merging; `gh pr view 60` reported `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`
  beforehand, confirmed directly, not assumed.
- **Deployment:** Preview deployed from that exact commit. Deploy receipt: `sha
  eb750a7d9674bba5055fa9fdaa5e42da38b8939d`, `result SUCCESS`, every gate `ok` (target, gitState,
  confirmation, azureResource, settings, test, validate, build, secretScan, upload, commitSetting,
  healthCheck). **Independently verified**, not trusted from the script's own output alone:
  `curl https://polite-plant-03bb7570f-preview.eastus2.3.azurestaticapps.net/api/site-settings` →
  `"commit":"eb750a7d9674bba5055fa9fdaa5e42da38b8939d"`, `"environment":"preview"` — matches exactly.
  Production untouched, not deployed, per the policy's own unchanged boundary.

## PR #59 rescue (a real gap found and closed, not left behind)

PR #59 (`chore/project-state-preview-bt029`, opened before this migration) recorded a genuine,
previously-unrecorded fact: a Preview deploy from `feature/dashboard-loading-indicators` at commit
`625d249d59d31bc446f0b0cc295c02f0bacb07b9` (PR #58's own pre-merge branch tip, at Terry's explicit
request "push to preview"), verified at the time via `/api/site-settings` reporting that exact
commit and `environment: preview`. Because that PR was still open, unmerged, when `PROJECT_STATE.md`
was restructured, its diff (an edit against the old monolithic file's exact tail) no longer applies
to the new structure and was never folded into anything. **Rescued here rather than silently lost in
a closed, unmerged PR:** the fact above is now the permanent record of that deploy. PR #59 itself is
closed as superseded by this checkpoint, not merged — its literal diff is obsolete, its actual
content is not.

## Completed work

- First real execution, end to end, of the agent-managed-merge policy: fetch/reconcile (already
  current with `origin/main`, no conflict to resolve), verified checks and mergeability, merged,
  deployed the resulting commit to Preview, verified independently.
- PR #59's stranded fact rescued into the permanent checkpoint record; PR #59 closed.

## Unfinished work

None from this specific outcome. The two genuinely open items already listed in the migration
checkpoint (BT-028 fresh-repro confirmation if it recurs; the reload-prompt feature decision) remain
exactly as recorded there — not repeated here to avoid two disagreeing copies.

## Checks and results

No application code changed in this checkpoint's own commit (a single new Markdown file). The
consolidated migration/policy PR (#60) itself already passed the full gate before merging (see the
policy checkpoint and PR #60's own CI: `foundation-tests` pass, `secret-scan` pass).

## Blockers

None.

## Exact next steps

None outstanding from this effort. Resume whichever of the two open items above Terry raises next.
