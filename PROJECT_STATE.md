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

## Checkpoint B — BT-001 API foundation and BT-006 ledger core (2026-09-13)

**Built.** An Azure Functions v3 API under `api/`, with 15 routes generated from `api/_shared/routes.js`:
- me, workspaces, members, invitations, grants
- accounts, transactions, payees, categories
- contacts, people, preferences, audit
- site-settings, roles

**Design.** ADR-002 in `docs/FOUNDATION_DESIGN.md`:
- single trusted identity adapter
- CSRF header
- corrupt-refusing storage (memory, file and blob backends)
- one workspace per document with atomic ETag writes and idempotency keys
- record revisions
- a site-admin-free authorization model with expiring, revocable grants on private accounts
- ISO 4217 integer money

**Review findings applied.** Prototype findings 1 (membership required even for owners; ownership maps to a capability set; publish never granted) and 6 (null-prototype frozen principal; own-property checks; safe JSON parsing). Finding 4 applies to money: server-side precision table, `typeof` before regex, `-0` normalized, bounded magnitude.

**Tooling.**
- `staticwebapp.config.json`: Google only, rolesSource, fail-closed `/api/*`, strict CSP and security headers
- root `package.json` scripts
- `scripts/validate.cjs`
- the CI `foundation-tests` job now runs `npm ci --prefix api`, `npm test` and `npm run validate`, with the job name unchanged
- `@azure/storage-blob` 12.33.0: `npm audit` found 0 vulnerabilities

**Results.**
- `npm test`: 7/7 repository tests and 41/41 API tests, exit 0
- `npm run validate`: ok (15 routes), exit 0

**Mutation checks** (a scratchpad copy; the repository was never mutated):

| Mutant | Result |
|---|---|
| workspace owner sees private accounts | killed (5 failures) |
| grant expiry ignored | killed (1) |
| membership skipped in authz | killed (4, after adding `authz.test.js`) |
| own-property check removed | killed (1) |
| explicit publish guard removed | survived as an equivalent mutant: publish is in no capability set |

**Not verified.**
- No real Azure Functions host, SWA or Google sign-in has been run. `func` and `swa` are not installed.
- The blob adapter has not been exercised against Azure or Azurite.
- No independent security or financial review of checkpoint B yet; schedule both at the end of the BT-002 milestone.

## Checkpoint C — BT-002 encrypted backups and tested restores (2026-09-13)

**Built.**
- `api/_shared/archive.js`: archive format v1. The header (workspace, archive id, schema, time, key id, reason) is authenticated as AES-256-GCM AAD. Each workspace has its own HKDF-derived key. The workspace is checked before decryption. Keys come from `BT_BACKUP_KEYS` and `BT_BACKUP_ACTIVE_KEY` and can be rotated.
- `api/_shared/backup.js`: financial invariants, a manifest, validation of the serialized bytes followed by a test decrypt, and caller-scoped restore planning for create-new, merge and replace.
- Routes: `/api/backups` (list and create; owners and managers; never downloadable) and `/api/restore` (preview and execute).
- A backup-storage dependency that must be separate from data storage.
- The operator drill `scripts/recovery/drill.cjs`.
- An executable `docs/RECOVERY_RUNBOOK.md`.

**Review findings applied.** Prototype findings 2 (authenticated header and per-workspace keys), 3 (validate the bytes that are encrypted, then test-decrypt), 5 (summary-only preview), 7 (size limits and indexed checks) and 8 (generic errors).

**Results.**
- `npm test`: 7/7 repository tests and 55/55 API tests.
- `npm run validate`: ok (17 routes).
- Mutation checks in a scratchpad copy killed six mutants: resurrecting grants, skipping the workspace pre-check, a scope that ignores ownership, no recovery point, no preview-ETag check, and no final `ifMatch`. The last one is killed by the concurrent-edit race test.

**Not operational (pending Staging).** Scheduled backups, immutable retention, Key Vault custody, monitoring and alerts, a measured RPO/RTO drill, and service-level disaster restore into live storage.

## Milestone reviews and remediation (2026-09-13)

Independent read-only reviews of `be22642`:
- **Security:** PARTIAL. No path was found to another workspace's data or to another member's private records. Nine findings.
- **Financial:** PARTIAL. The money arithmetic was verified with 20,000 random allocation cases and precision checks. Twelve findings, plus an informational note on allocation.

All findings are fixed with regression tests in `api/test/remediation.test.js`, and they are recorded in `docs/REQUIREMENTS.md` as BT-001-04 and BT-006-02:
- Security S1–S9: per-member quota plus headroom for administrative writes, restores limited to referenced attachments, count-free listings and previews, manager-only backup audit, grantee visibility, enforced site policies, subject-only roles endpoint, cross-scope transfer blocker, name-only payee references with no ownership transfer.
- Financial F1–F12.
- F13 (strict percentage allocation, fair residuals, multiple payers) is deferred to BT-009.

Result: `npm test` 7/7 repository tests plus 75/75 API tests; `npm run validate` ok (17 routes).

## Azure (Terry's decisions, 2026-09-13)

**Terry's choices.**
- One BudgetTracker Static Web App: TerryRemsiksSubscription, resource group `budget-tracker`, East US 2.
- A preview environment is allowed. Production stays empty until he explicitly authorizes it.
- `budget.remsik.org` is to be documented only.
- Do not touch the other app's local ports (4280, 7071, 10000–10002).

**Provisioned** with `scripts/deploy/provision.ps1` (explicit tenant check, idempotent, deletes nothing):
- SWA `budget-tracker` (Standard)
- Log Analytics `log-budget-tracker`
- Application Insights `appi-budget-tracker`
- preview storage `stbudgetpv01` (data) and `stbudgetbkpv01` (backup), both StorageV2 / LRS, TLS 1.2, HTTPS only, no public blob access, with versioning and soft delete

Resource providers `Microsoft.OperationalInsights` and `Microsoft.Insights` were registered in the subscription as part of this. The IDs live only in the ignored `.local/deploy-target.json`. Design and procedures are in `docs/DEPLOYMENT.md`.

**Not done.**
- No application deployed and no app settings configured.
- Production storage not created and DNS not changed.
- Google OAuth client pending: Terry must create BudgetTracker's own client and set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` himself (see `docs/DEPLOYMENT.md`). Until then, preview sign-in fails closed.

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

1. **Checkpoint B: done** (see above). Keep the CI job names `secret-scan` and `foundation-tests`; branch protection requires them.
2. **Checkpoint C: done.** Run independent security-privacy and financial-accuracy reviews of commits `04f6bf9` and the checkpoint C commit (the BT-001/BT-002 milestone). Apply accepted findings with retests.
3. **Checkpoint D: BT-004 and BT-011-01.** Local dev server, frontend shell following TaskTracker's core patterns, the faithful day/night Appearance control port with its tests, and a fictional seed. Obtain UX and accessibility review.
4. Continue BT-006 → BT-008 → BT-009/010 → BT-011/012/007 in brief order, updating this file at each checkpoint.
