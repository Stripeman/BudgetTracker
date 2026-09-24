# Checkpoint template

Copy this into `docs/project-state/checkpoints/` as a new file named
`YYYYMMDDThhmmssZ-short-descriptive-slug.md` — a UTC timestamp (`date -u +%Y%m%dT%H%M%SZ`, or
`Get-Date` in UTC) followed by a short task/branch identifier. The timestamp makes filenames sort
chronologically and guarantees two checkpoints written concurrently on different branches never
collide or need the same line of a shared file — that collision is exactly what this structure
exists to remove. Never reuse or renumber a filename. Never add a shared sequential counter.

Fill in every section below with facts, not predictions. Delete this instructional paragraph and
the bracketed hints before committing; keep the section headings.

---

# `<Task or BT id>`: `<one-line description>`

**Date (UTC):** `<YYYY-MM-DD HH:MM Z>`
**Branch:** `<branch name>`
**Verified commit:** `<full SHA>` — the commit every claim below was actually checked against;
resolve with `git rev-parse HEAD` at write time, not copied from memory.
**Relates to / supersedes:** `<earlier checkpoint filename(s) or BT id(s), if any>` — a checkpoint
already on `main` is never edited after the fact; a correction or new outcome goes in a new
checkpoint that names the one it corrects.

## Status

State each independently — completing one never implies another:

- **Implementation:** `<not started | in progress | complete>` — `<evidence>`
- **Merge:** `<not opened | PR #N open, unmerged | PR #N merged as <SHA>>`
- **Deployment:** `<not deployed | Preview at <SHA>, verified <how> | Production — Terry's own action, not claimed here unless Terry performed and you independently verified it>`

Never predict another PR's outcome (e.g. never write "will merge cleanly" or "should deploy fine")
— state only what has actually happened and been verified by this point.

## Completed work

`<what was actually built/fixed, with file/function references>`

## Unfinished work

`<what remains, scoped precisely — or "None known" if genuinely nothing>`

## Checks and results

`<exact commands and exact results — test counts, exit codes, e2e pass/fail counts, validate output,
secret-scan result. Quote real numbers; never say "tests pass" without them>`

## Blockers

`<anything actually blocking progress, or "None">`

## Exact next steps

`<the precise next action, specific enough that a fresh session can start immediately>`
