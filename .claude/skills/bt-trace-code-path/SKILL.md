---
name: bt-trace-code-path
description: Trace canonical BudgetTracker or potential TaskTracker reuse paths before implementation.
---

Use code-archaeologist read-only. Read project governance and `.codex/agents/README.md`. Inspect TaskTracker by comparing the committed main revision and date of Z:/repos/TaskTracker and T:/repos/TaskTracker, then reading the freshest with `git show main:<path>` and recording the revision (on 2026-09-13 Z: was stale beta.240 and T: main was beta.416). Uncommitted working-tree files are not canonical. Never modify either checkout or read private configuration/history.

Trace UI events through selectors, actions, APIs, identity checks, schema/defaults, storage, readback and tests. Search synonyms and actual callers; classify canonical, legacy, generated, test-only and reachable alternatives. Do not equate similar names with safe reuse. Map existing models/helpers before recommending an abstraction, especially contacts versus members, financial owners, attachments, grants and historical currency rates.

Return BT requirement, source revision, file/symbol/caller map, tests, safe reuse seam, dangerous alternatives, gaps and implementation handoff. Preserve the required editor and moon/sun behavior; record mismatches instead of inventing source evidence.
