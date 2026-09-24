# BudgetTracker project state

This file is a **stable entry point**, not a log. It should not need an edit for a routine
checkpoint — only if this structure itself changes. Do not append checkpoint entries here; see
"Where state actually lives" below.

## Where state actually lives

- **`docs/project-state/checkpoints/`** — one Markdown file per checkpoint, named
  `YYYYMMDDThhmmssZ-short-slug.md` (a UTC timestamp followed by a short task/branch identifier).
  Filenames sort chronologically. There is no shared index file inside this directory and none
  should be added — two branches each adding their own timestamped checkpoint file merge without
  conflict by construction (proven in the migration checkpoint below). List the directory to
  discover checkpoints; do not expect this file to name them.
- **`docs/project-state/CHECKPOINT_TEMPLATE.md`** — the required shape for a new checkpoint: task,
  branch, the verified commit the checkpoint's claims were actually checked against, implementation
  status, merge status and deployment status stated separately, completed work, unfinished work,
  checks and results, blockers, exact next steps.
- **`docs/project-state/archive/`** — the complete prior `PROJECT_STATE.md` history (2026-09-13
  through the migration to this structure), preserved verbatim, unedited. Consult it for anything
  not repeated in a current checkpoint.
- **`docs/REQUIREMENTS.md`** — the authoritative, currently-maintained status for any individual
  `BT-` requirement. Trust this over an older checkpoint's own completion claim for the same item.

## Required reading order for a fresh session

1. Read this file (you just did).
2. Inspect actual Git state — `git status -sb`, `git log --oneline`, `git fetch origin` and compare
   before trusting any branch as current — and `docs/REQUIREMENTS.md` for the live status of any
   requirement in scope.
3. Discover and read recent checkpoints in `docs/project-state/checkpoints/` (sorted by filename —
   already chronological): the most recent few, plus any earlier ones relevant to the active work or
   an unresolved decision. Never assume the newest file alone contains every outstanding item — an
   item can still be open from several checkpoints back.
4. Consult `docs/project-state/archive/` when a checkpoint references something from before the
   migration, or when deeper history is genuinely needed.
5. Reconcile older completion claims against verified repository, PR and deployment evidence before
   relying on them — a checkpoint records what was true and verified when it was written, not a live
   status. Preserve recorded requirements and decisions unless explicitly superseded by a later
   checkpoint or by Terry.

## Writing a new checkpoint

Copy `docs/project-state/CHECKPOINT_TEMPLATE.md` into `docs/project-state/checkpoints/` under a new
timestamped filename at each meaningful stopping point (not for every intermediate edit). Once a
checkpoint has landed on `main`, it is never edited afterward — a correction or a later outcome
(merge result, deployment result, a finding that changes an earlier claim) goes in a **new**
checkpoint that names the one it corrects. Fold routine merge/deployment follow-up into the next
substantive checkpoint rather than opening a bookkeeping-only PR for it.

See `docs/project-state/checkpoints/20260924T054048Z-migration-split-project-state.md` for the
migration itself, including every item carried forward from the old single-file history, the
merge-conflict test that proves this structure works, and a full account of what changed and why.
