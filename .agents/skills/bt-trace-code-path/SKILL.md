---
name: bt-trace-code-path
description: Trace canonical BudgetTracker or potential TaskTracker reuse paths before implementation.
---

Use code-archaeologist read-only. Read project governance and `.codex/agents/README.md`. Inspect TaskTracker at Z:/repos/TaskTracker, falling back to T:/repos/TaskTracker only if unavailable; never modify it or read private configuration/history.

Trace UI events through selectors, actions, APIs, identity checks, schema/defaults, storage, readback and tests. Search synonyms and actual callers; classify canonical, legacy, generated, test-only and reachable alternatives. Do not equate similar names with safe reuse. Map existing models/helpers before recommending an abstraction, especially contacts versus members, financial owners, attachments, grants and historical currency rates.

Return BT requirement, source revision, file/symbol/caller map, tests, safe reuse seam, dangerous alternatives, gaps and implementation handoff. Preserve the required editor and moon/sun behavior; record mismatches instead of inventing source evidence.
