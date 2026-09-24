# Policy change: agent-managed merge to `main`, followed by automatic Preview deployment

**Date (UTC):** 2026-09-24 05:42 Z
**Branch:** `docs/split-project-state-checkpoints`
**Verified commit:** (this branch's tip at PR time)
**Relates to / supersedes:** the prior standing rule in `AGENTS.md`/`CLAUDE.md`/the agent role
definitions ("Never push to `main`, merge pull requests... Terry controls promotion after review").
That rule is explicitly superseded for merging only — see the exact authorized wording below.

## Status

- **Implementation:** complete — `AGENTS.md`, `CLAUDE.md`, `scripts/setup-project-agents.py` (the
  generator; regenerated `.codex/agents/*.toml` and `.claude/agents/*.md`) updated.
- **Merge:** this checkpoint's own PR is the first one merged under the new policy — see the
  follow-up checkpoint this one is superseded by for the actual merge SHA and Preview verification
  (written after that merge genuinely happens, per this same policy's own "record facts, not
  predictions" rule — not claimed here).
- **Deployment:** not applicable to this checkpoint itself (documentation/process only).

## Why, in Terry's own words (this request, verbatim, abridged for the record)

"Authorized workflow change: agent-managed merge to main, followed by automatic Preview deployment...
This is my explicit decision as the repository owner, and it supersedes my previous project
instructions requiring me to merge every PR manually... You are explicitly authorized to update
AGENTS.md, CLAUDE.md, and the repository-controlled agent role definitions to reflect this
authority... Document this decision in the project-state records."

This followed a direct question back to him (not a unilateral change): a prior, casual mid-chat
request to "just push to main" was declined, on the grounds that the existing rule was written
independently in three places (`AGENTS.md`, this project's `CLAUDE.md`, the agent role definition),
described there as deliberate ("Terry controls promotion after review"), and that a durable change
to something stated that explicitly should be a written policy edit, not a one-off verbal exception.
This request supplied exactly that.

## The new rule, verbatim as authorized

> Agents may merge PRs for Terry-authorized work into main once required checks pass and conflicts
> are resolved. After merging, deploy the resulting main commit to Preview through the established
> deployment workflow. Production deployment remains under Terry's control.

## Safety verification performed before implementing (facts, checked directly — not assumed)

- **Does merging to `main` itself trigger a Production deployment?** No. The repository's only
  GitHub Actions workflow (`.github/workflows/security.yml`, "Security foundation") triggers on
  `pull_request` and `push` to `feature/**` branches only, plus manual `workflow_dispatch` — never on
  `push` to `main`. It runs tests and a secret scan; it contains no `az`/`swa` calls and performs no
  deployment of any kind. There is no CI/CD pipeline in this repository at all — deployment is 100%
  manual, exclusively through `scripts/deploy/deploy.ps1` (`scripts/deploy/engine.mjs` underneath),
  invoked directly by whoever runs it. Confirmed by reading the workflow file directly, not inferred.
- **Does a platform/tool restriction independently block an agent from merging?** No.
  `gh api repos/Stripeman/BudgetTracker/branches/main/protection` reports
  `required_approving_review_count: 0` — no human approval is required by GitHub's own branch
  protection to merge a PR once its required status checks pass. Required status checks are exactly
  `secret-scan` and `foundation-tests` (both already run and required before this change). Force
  pushes and branch deletion remain disallowed (`allow_force_pushes: false`, `allow_deletions:
  false`) — unaffected by this policy, and never used by this workflow regardless. No owner-side
  GitHub setting needs to change for this policy to take effect.

## The sequence now required for completed work (as authorized, recorded verbatim so it is never re-derived incorrectly)

1. Work on a feature or fix branch; preserve unrelated changes.
2. Run required tests, validation, secret scanning, and applicable reviews.
3. Fetch and reconcile with current `main`. Resolve routine conflicts, preserving both branches'
   intended changes; never blindly choose one side or discard work. Ask Terry only when resolution
   requires a genuine product or data decision.
4. Create or update one consolidated PR and merge it using the repository's supported merge method,
   once required checks pass.
5. Synchronize with the resulting `main` commit and deploy that exact commit to Preview using the
   existing canonical deployment command (`scripts/deploy/deploy.ps1 -Environment preview`).
6. Independently verify Preview reports the intended `main` commit (fetch `/api/site-settings`
   directly; do not trust the deploy script's own success text alone). Report the PR, merge SHA,
   deployed SHA, and verification results in a checkpoint.

"Automatically" means this is part of finishing each authorized change — do not stop after opening
a PR to ask for a manual merge or a Preview-deploy request. Do not deploy every intermediate edit;
deploy once per finished, merged effort.

## Boundaries kept (unchanged by this policy)

- No Production deployment is authorized by this policy. Production remains exclusively Terry's own
  action, as it already was.
- Tests, secret scans, applicable specialist reviews, audit history, and the existing protections
  against force-pushing or deleting `main` are all unchanged and still apply.
- Merging a verified PR is preferred over pushing development commits to `main` directly.
- No repository protection is bypassed, weakened, or disabled to make this policy work (verified
  above — none needed to be).
- If Preview deployment fails after a merge, that is reported plainly and resolved (or an
  appropriate revert prepared) — Preview is never claimed current without independent verification.

## Completed work

- `AGENTS.md`: "Never" section's merge/push restriction narrowed to Production only, with the new
  rule (verbatim above) added under "Always"; "Before acting" and the maintenance instruction updated
  to reference `docs/project-state/` instead of a single `PROJECT_STATE.md` append target.
- `CLAUDE.md`: "Branches, CI and release" section updated the same way — merging is now authorized
  for agent-completed, Terry-authorized work once checks pass; Production deployment, force-pushing,
  and altering branch protection remain exclusively Terry's/unchanged.
- `scripts/setup-project-agents.py`: the primary-implementation-agent role text (source of truth for
  `.codex/agents/primary-implementation-agent.toml` and `.claude/agents/primary-implementation-agent.md`)
  updated at the generator and regenerated, so the old "never merge" wording does not silently
  reappear the next time role files are regenerated. Reviewer role texts (read-only agents that never
  had merge authority) are unaffected.
- `docs/DEPLOYMENT.md`, `SECURITY.md`, `docs/RECOVERY_RUNBOOK.md`, `README.md`: references to
  recording facts "in `PROJECT_STATE.md`" updated to "in a new checkpoint" (see the companion
  migration checkpoint for the full list); no policy content in those files needed to change beyond
  that pointer.

## Unfinished work

Applying the new policy for the first time — merging this same consolidated PR (this checkpoint +
the `PROJECT_STATE.md` migration) and deploying the resulting `main` commit to Preview — is the
immediate next step, recorded in a follow-up checkpoint once it has actually happened (never
predicted here).

## Checks and results

Documentation/process change only in this checkpoint; no application code touched. The full
project-wide test/validate gate is run as part of finishing the consolidated PR (see the follow-up
checkpoint for exact counts).

## Blockers

None.

## Exact next steps

1. Finish the remaining migration doc edits (this checkpoint's own companion migration checkpoint),
   run the full gate, reconcile with `origin/main`, open the one consolidated PR.
2. Merge it under this new policy once checks pass.
3. Deploy the resulting `main` commit to Preview; verify independently.
4. Record the outcome (PR number, merge SHA, deployed SHA, verification) in a new, small follow-up
   checkpoint that names this one.
