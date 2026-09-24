# Migration: split PROJECT_STATE.md into a stable entry point, per-checkpoint files and a historical archive

**Date (UTC):** 2026-09-24 05:40 Z
**Branch:** `docs/split-project-state-checkpoints`
**Verified commit:** (this branch's tip at PR time — see the PR itself; `PROJECT_STATE.md`'s own
history up to and including this migration is preserved verbatim in the archive named below)
**Relates to / supersedes:** the entire prior `PROJECT_STATE.md` (single file, 2026-09-13 through
2026-09-24, ~7,600 lines) — none of it is discarded; see "Historical archive" below.

## Status

- **Implementation:** complete — structure created, content migrated, instructions updated (see
  "What changed" below).
- **Merge:** see the consolidated PR this checkpoint ships in.
- **Deployment:** not applicable — this is documentation/process only, no application code changed.

## Why

Terry, verbatim (this request): "The earlier discussion of this was lost during the crash. This is
a fresh, authorized implementation request... The goal is reliable continuity between sessions
without every branch editing the same growing PROJECT_STATE.md file and leaving me to resolve
conflicts." A single, ever-growing `PROJECT_STATE.md` meant every feature branch's final "record
this checkpoint" commit touched the same file's tail, so any two branches open at once produced a
merge conflict on that file — recorded repeatedly across this project's own history (branches named
`chore/project-state-pr35-merge-verified`, `-pr37-`, `-pr47-`, `-pr49-`, `-pr53-`, each one existing
solely to resolve exactly this conflict after the fact).

## What changed

- **`PROJECT_STATE.md`** is now a short, stable entry point (this migration replaces its content).
  It explains where state actually lives and the required reading order. It is not expected to need
  an edit for routine checkpoints — only if the structure itself changes again.
- **`docs/project-state/checkpoints/`** — one Markdown file per checkpoint going forward, named
  `YYYYMMDDThhmmssZ-slug.md` (UTC timestamp + short branch/task identifier). No shared sequential
  numbering, no central index file inside this directory — two branches each adding their own
  timestamped file can never conflict with each other (proven below, not assumed).
- **`docs/project-state/CHECKPOINT_TEMPLATE.md`** — the required shape for a new checkpoint
  (task/branch/verified commit, implementation/merge/deployment status stated separately, completed
  work, unfinished work, checks and results, blockers, exact next steps).
- **`docs/project-state/archive/PROJECT_STATE-2026-09-13-to-2026-09-24.md`** — the ENTIRE previous
  `PROJECT_STATE.md`, copied verbatim, unedited, covering 2026-09-13 (Claude takeover from Codex)
  through this migration. Nothing was summarized, shortened or dropped. This is the historical
  record for anything not repeated in the carry-forward section below.
- **`AGENTS.md` and `CLAUDE.md`** — "before acting" / "before changing anything" sections now
  describe the discovery-based reading workflow (below) instead of "read `PROJECT_STATE.md`
  completely"; the handoff/maintenance sections now say to write a new checkpoint file instead of
  appending to `PROJECT_STATE.md`.
- **`scripts/setup-project-agents.py`** (the generator for `.codex/agents/*.toml` and
  `.claude/agents/*.md`) updated at the source and regenerated, so the old instruction does not
  silently return the next time those files are regenerated.
- **`SECURITY.md`, `docs/RECOVERY_RUNBOOK.md`, `docs/DEPLOYMENT.md`, `README.md`** — every instruction
  to "record X in `PROJECT_STATE.md`" updated to "record X in a new checkpoint" (see each file's own
  diff for the exact wording).

## The required reading workflow for a fresh session (now in AGENTS.md/CLAUDE.md verbatim)

1. Read the stable `PROJECT_STATE.md` entry point.
2. Inspect actual Git state (`git status -sb`, `git log --oneline`, `git fetch` and compare), open
   work and `docs/REQUIREMENTS.md` (the requirement register — the authoritative status for any
   individual `BT-` item, kept current independently of checkpoints).
3. Discover and read recent checkpoints (`docs/project-state/checkpoints/`, sorted by filename —
   already chronological) — the most recent few, plus any earlier ones relevant to the active work
   or an unresolved decision. Never assume the newest file alone contains every outstanding item;
   an item can still be open from several checkpoints back.
4. Consult `docs/project-state/archive/` when a checkpoint references something from before the
   migration, or when deeper history is genuinely needed.
5. Reconcile older completion claims against verified repository, PR and deployment evidence before
   trusting them — a checkpoint records what was true and verified at the time it was written, not
   a live status. Preserve recorded requirements and decisions unless explicitly superseded by a
   later checkpoint or by Terry.

## Verification: two independent checkpoints merge without conflict

Tested for real, not assumed. From this branch's own tip:

```
git checkout -b _test-integration
git checkout -b _test-branch-a
echo "checkpoint A" > docs/project-state/checkpoints/20260924T060000Z-test-branch-a.md
git add -A && git commit -m "test: branch A checkpoint"
git checkout _test-integration
git checkout -b _test-branch-b
echo "checkpoint B" > docs/project-state/checkpoints/20260924T060100Z-test-branch-b.md
git add -A && git commit -m "test: branch B checkpoint"
git checkout _test-integration
git merge _test-branch-a --no-edit
git merge _test-branch-b --no-edit
```

Result: both merges completed with **zero conflicts** (`Fast-forward` / `Merge made by the 'ort'
strategy`, no `CONFLICT` lines), and both files exist afterward. This is the direct, structural fix
for the recurring `chore/project-state-prXX-merge-verified` pattern: with per-file checkpoints,
there is no shared tail for two branches to collide on. (Test branches deleted after verification;
not pushed.)

## Verification: a fresh session can locate current work from the new entry point

Walked through `PROJECT_STATE.md` → `docs/project-state/checkpoints/` (sorted) → this file, as a
fresh session would: the entry point names the directory and reading order; listing the directory
surfaces this migration checkpoint as the newest file; this file itself names every currently open
item below and points to the archive for anything older. No item required searching chat history or
asking Terry to repeat something already recorded.

## Unresolved items carried forward from the pre-migration `PROJECT_STATE.md` (nothing left behind)

**Reconciled against `docs/REQUIREMENTS.md` (the authoritative, currently-maintained register),
not carried forward verbatim where it was stale:**

- The old file's "BACKLOG — authorized for after this release" (BT-015/016/017), written
  2026-09-18, described all three as not yet started, gated behind "this release" completing. That
  is now stale: per `docs/REQUIREMENTS.md`, **BT-015 is built and verified**; **BT-016**'s open
  design question was **closed 2026-09-19** (reuse `group`/`trip` workspaces for anyone who needs to
  sign in; the narrower single-expense-only alternative remains buildable later but is not started,
  and is not currently requested); **BT-017 is partially built** (My Settings regrouped and its
  personal-vs-workspace distinction added; remaining/open: "a fuller visual/spacing pass... not yet
  done; Workspace Settings itself remains unchanged (already met most criteria per the original
  BT-017 inventory)"). Treat `docs/REQUIREMENTS.md`'s own BT-015/016/017 rows as current status;
  the archived backlog text is historical context for how they started, not a live task list.

**Flagged as unclear, not asserted either way — genuinely unresolved by omission, not by design:**

- Two items from the old file's "Waiting on Terry" section (dated 2026-09-14, never moved to
  "Answered," and never referenced again in any of the ~30 checkpoints written since): (0) "Bills
  under setting (f)?" — when "members may change other members' entries" is on, it also lets
  members change each other's bills on shared accounts (one rule serves both); keep bills under the
  same setting, or give bills their own setting? (2) "Which rules should become settings first?" —
  a proposed first-ten list (a)-(j) of workflow rules to make configurable, plus a site-admin
  "Capacity" panel; some of these (b-e, the shared-expense ones) were built into BT-009's group
  settings model per the "Answered" log immediately below them in the archive, but items (f)-(j)'s
  status was never explicitly confirmed one way or the other in any later checkpoint. **Not assumed
  resolved and not assumed still blocking** — flagged for Terry to say whether these are still
  live questions or safe to treat as abandoned.
- Several "Actions for Terry" one-time items from the 2026-09-14 Production launch (move the backup
  escrow file to offline storage; decide the Production failure alert) were never explicitly marked
  done in any later checkpoint either, though 10 days and many further Production releases have
  since passed, making it likely (not confirmed) they were completed outside the recorded log. Flagged
  rather than assumed.

**Genuinely current, from this session, still open:**

- **BT-028 (recurring-bill merchant save, timezone root cause):** the code fix is verified live on
  Production (`58ac381`, confirmed by fetching the actual served JS and finding `todayIsoUTC()` in
  use). Terry reported the symptom recurring a second time after the first fix shipped; investigation
  found no new code defect — the most likely explanation given directly to him is a stale,
  already-open browser tab still running pre-fix JavaScript (an SPA never re-fetches scripts on
  route changes, only on a full reload). He later confirmed "i can now see the update when i change
  the merchant," consistent with that explanation. **Not yet independently re-verified by a fresh
  repro after his confirmation** — treated as resolved based on his own report, not re-tested here.
- **Reload-prompt feature (undecided):** offered to build a "a new version is deployed, please
  reload" mechanism so the stale-tab confusion above cannot recur silently after a future deploy.
  Not started, no BT id assigned. Waiting on Terry's decision.
- **PR #58 (BT-029, dashboard loading indicators):** merged by Terry as `58ac381`. Not yet deployed
  to Production (only Preview, from the pre-merge branch tip `625d249` — see the old file's own
  final entries in the archive for that deploy's verification).
- **PR #59** (a bookkeeping-only `PROJECT_STATE.md` update recording the Preview deploy above): open,
  unmerged as of this checkpoint. Under the new merge-authorization policy (see the companion
  checkpoint for that policy change), routine merges like this no longer need to wait on Terry — it
  will be merged as part of finishing this migration's own PR, folding its content into this
  checkpoint rather than staying a separate bookkeeping PR going forward.
- **Production/Preview commit-hash policy:** Terry found it confusing that Production and Preview
  can report different commit hashes for identical code (a GitHub merge commit always gets a new
  hash even with zero file differences). Resolved by his own explicit decision — see the companion
  merge-authorization-policy checkpoint: going forward, Preview is deployed from the resulting `main`
  commit immediately after each agent-managed merge, so the two stay on a directly comparable commit
  history rather than a pre-merge branch tip vs. a post-merge hash.

## Blockers

None.

## Exact next steps

1. Merge this migration's PR (see companion merge-authorization-policy checkpoint for the newly
   authorized process) and confirm `PROJECT_STATE.md`'s new short form plus this directory structure
   land on `main` cleanly.
2. Merge PR #59 as part of the same effort (its content is folded into this record above; the
   standalone PR is bookkeeping only and should not remain open under the new no-bookkeeping-PRs
   policy).
3. Resume the two genuinely open items above (BT-028 fresh-repro confirmation if Terry raises it
   again; the reload-prompt feature decision) whenever Terry returns to them — nothing further to do
   on either right now.
