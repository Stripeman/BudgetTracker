# BudgetTracker project state

## Checkpoint

- **Date and scope.** 2026-09-13, Claude takeover from Codex.
- **Branch.** `feature/project-foundation`, tracking `origin/feature/project-foundation`.
- **Origin.** https://github.com/Stripeman/BudgetTracker.git (public).
- **Checkpoint commit.** The commit containing this file; resolve it with `git log -1 --format=%H`.
- **Draft PR #1.** Open (feature/project-foundation → main), with no merge. Nothing has been deployed.

## Verified at takeover (2026-09-13)

- **Git.** Local `HEAD` equalled `origin/feature/project-foundation` at `2360b79` after `git fetch`, and the tree was clean. `origin/main` is `a2d9c46`, unchanged. The only ignored untracked file is `Budget_Tracker_Project_Instructions.docx`, and it is preserved.
- **Word brief.** SHA-256 `CE7EB5FE…317EC`, matching `docs/BRIEF_RECONCILIATION.md`. A fresh extraction gave 161 nonempty paragraphs, all present in `docs/PROJECT_BRIEF.md`, with no differences either way.
- **Codex claims.** They matched the repository. Four Node tests passed. CI (`secret-scan`, `foundation-tests`) passed remotely on both the push and PR runs for `2360b79`.
- **Correction to the Codex record.** Its TaskTracker inventory read the stale `Z:` checkout (beta.240). Current TaskTracker (`T:` `main` `a1ec150`, beta.416) **does** have the Tiptap editor and the moon/sun day/night Appearance control (Terry confirmed this with a screenshot). See `docs/TASKTRACKER_REUSE.md`.
- **TaskTracker is in active use.** Another session is working on it; its `T:` working tree has 22 uncommitted files. Read committed `main` only, and never fetch, switch or write it.

## Completed in this checkpoint

1. **Repository controls** (BT-003-03), all through the GitHub API with Terry's token:
   - `main` protection: PR required with 0 approvals, required checks `secret-scan` and `foundation-tests`, conversation resolution, `enforce_admins=true`, no force-push, no deletion.
   - Dependabot vulnerability alerts and automated security fixes enabled.
   - Verified by reading the settings back through the API.
2. **Staged scan** (BT-003-04). `scripts/scan-staged.cjs`, `.githooks/pre-commit` and `test/scan-staged.test.cjs`. The local clone now has `core.hooksPath=.githooks`. gitleaks 8.30.1 was installed to the ignored `.local/bin` after a SHA-256 match with the release checksums.
3. **Agents** (BT-003-02). The generator now emits nine roles as Codex TOML and Claude Markdown. It adds `regression-false-green-auditor` and `release-readiness-auditor`, both adapted from TaskTracker without its unsafe assumptions, and mirrors the skills to `.claude/skills/`.
4. **Governance.** `CLAUDE.md` (full standard) and `AGENTS.md` (short contract) were rewritten consistently. They adapt TaskTracker patterns (source-of-truth order, requirement→test→implementation, truthful reporting, ETag concurrency, schema-version refusal, stale-response guards, explicit deployment targets) and record the BudgetTracker departures:
   - no site-admin financial access
   - atomic, not best-effort, audit
   - recoverable deletion
   - corrupt documents are refused
   - no archived-grant resurrection
5. **Independent review** of `lib/foundation.cjs`: verdict PARTIAL. The findings are recorded in `docs/FOUNDATION_DESIGN.md` and must be fixed in the production port.
6. **Reuse inventory corrected** (BT-004-01), plus new child requirements BT-011-01 (day/night Appearance control, reuse required) and BT-011-02 (Tiptap editor).

## Checks run this checkpoint

- `node --test test/*.test.cjs`: 7 passed, 0 failed (Node v22.23.1).
- Scanner rules over all 49 tracked and untracked non-ignored files: 0 findings, after fixing 3 self-inflicted false positives in the scanner and its tests.
- `gitleaks git` over the full history: no leaks, 10 commits. `gitleaks dir` flagged only gitleaks' own README example strings in the ignored `.local/bin`; those vendor docs were then deleted.
- Python tomllib: all 9 TOMLs parse (8 read-only, 1 workspace-write).
- The staged scan, commit and push result are recorded in the handoff message and PR, not here; confirm with `git log origin/feature/project-foundation -1`.

## Unfinished work and blockers

- **No application yet.** There is no API, frontend, identity adapter, durable store, backup or restore. The prototype must not touch real data.
- **Staging target not established.** No Azure tenant, subscription or resources have been selected for BudgetTracker, and none may be inferred from `az` context. This blocks only the Staging deployment. It needs Terry to name the target, or to authorize provisioning in a named subscription.
- **Agents use Terry's admin token**, so branch protection is not technically enforced against agents. A non-admin bot identity is recommended (Terry's action).
- **Unverified rows in the reuse inventory.** The attachments, people picker, settings and local-runtime rows still need re-verification against `T:` `main`.
- **Native Claude subagent loading** has not been validated. A fresh session is needed, because this one predates `.claude/agents`.

## Planned design for the next increments (not yet implemented)

- **Hosting.** Azure Static Web Apps with managed Azure Functions (v3, CommonJS), following the TaskTracker stack.
- **Identity.** The SWA principal header is the only identity source, read by a single adapter. Only allowlisted providers are accepted (`google`). The subject is `provider:userId`, and the adapter returns frozen plain values.
  - Local development uses a loopback-only dev server that injects a fictional principal. The API has no bypass, and the dev server refuses to run when Azure environment markers are present.
- **Storage.** One storage interface with three implementations: memory (tests), a file store under the ignored `.local/data` (local dev), and Azure Blob (deployed).
  - Corrupt JSON is refused.
  - Each workspace is one JSON document containing members, grants, contacts, ledger and audit. This makes linked financial writes, audit and replace-restore atomic within a single ETag write, and makes the document the atomic unit.
  - Known limit: document size. Record a threshold and a partitioning migration in an ADR before it is reached.
  - Attachments are content-addressed blobs.
- **Authorization.** Capabilities: view-balances, view-transactions, create, edit, delete, comment, download-receipts, export, invite, change-permissions, publish.
  - Membership roles apply to shared resources only.
  - Private accounts require the owner (who must be an active member) or an explicit, unexpired, unrevoked grant.
  - Site admins get nothing financial.
  - Non-members get not-found.
  - Every derived surface filters through one `visibleAccounts` / `visibleTransactions` seam.
- **Money.** Integer minor units, with a safe-integer bound, an ISO 4217 precision table and BigInt for conversions. Rates are decimal strings with stored source and date. Largest-remainder rounding is deterministic.
- **Backups.** The AAD binds a header (workspaceId, schema, archiveId, createdAt, keyId). Validation runs on serialized bytes and is followed by a test decrypt. The preview is non-mutating and summary-only. Restore supports create-new, merge and replace; replace takes a pre-restore snapshot and swaps the document atomically, and archived grants are never restored.
  - Scheduled backups: SWA managed functions cannot host timers. Planned: Azure Backup operational backup with blob versioning and soft delete (infrastructure), plus an HTTP backup endpoint for an external scheduler. Record this in an ADR.

## Exact next steps

1. **Checkpoint B: BT-001 API foundation.**
   - Create `package.json`, `api/` with `host.json`, `_shared/` (http, ids, identity, storage adapters, schema, money, authz, audit, workspace store) and a validator script.
   - Implement workspace, member, invitation, contact, grant and preferences routes.
   - Write a negative permission-matrix test suite covering direct ids, cross-workspace access, a site admin, a workspace owner against a private account, and revoked or expired grants.
   - Apply review findings 1 and 6.
   - Add CI running `npm test`, keeping the job names `secret-scan` and `foundation-tests` because branch protection depends on them.
2. **Checkpoint C: BT-002.** Encrypted workspace backup and restore (review findings 2–5, 7–9), tests covering corruption, interruption, attachments, balances and revoked grants, and a runbook update. Obtain security and financial reviews.
3. **Checkpoint D: BT-004 and BT-011-01.** Local dev server, frontend shell following TaskTracker's core patterns, the faithful day/night Appearance control port with its tests, and a fictional seed. Obtain UX and accessibility review.
4. Continue BT-006 → BT-008 → BT-009/010 → BT-011/012/007 in brief order, updating this file at each checkpoint.
