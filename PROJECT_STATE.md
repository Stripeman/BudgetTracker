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

## Checkpoint D — frontend shell, Appearance control, local runtime (2026-09-13)

**Built.**
- `index.html` and the four stylesheets: tokens ported from TaskTracker, with light-mode accent contrast overrides, plus base, layout and components (including the day/night block verbatim).
- The day/night Appearance control: a faithful port of TaskTracker's `daynight.js` with a `locked` adaptation, mounted in the account menu and My settings.
- `app/js/core` (api, errors, store, router, format, calc) and `app/js/ui` (dom port, theme port, shell, modal, components, views).
- The loopback dev server `scripts/dev/server.mjs` on port 4380, never 4280/7071/10000–10002, using file storage in `.local/` with fictional sign-in; the fictional seed; the headless-Edge screenshot tool.
- `validate.cjs` frontend checks.

**Evidence.**
- `npm test`: 7/7 repository, 75/75 API and 15/15 app tests. `npm run validate` ok.
- Real HTTP against the dev server: `/api/me` returns 401 signed out and 200 as fictional Alice; a POST without the CSRF header returns 403; Alice (owner) does not see Bob's private card.
- Headless Edge 153 screenshots (under the ignored `.local/shots`) for all views at desktop light, desktop dark and narrow width, plus the account menu and quick-entry suggestions. No console errors or exceptions when signed in; signed out, only the expected 401 from `/api/me`.
- Fixed from the screenshots: list indentation, a `[hidden]` override, suggestion hint placement with `aria-describedby`, and checkbox layout.

**Not verified.** Keyboard and screen-reader walkthroughs, and independent UX, usability and accessibility reviews. There is no deployed preview yet.

## Preview deployment (2026-09-13, authorized by Terry: preview only)

- **URL:** https://polite-plant-03bb7570f-preview.eastus2.3.azurestaticapps.net (named environment `preview` of SWA `budget-tracker`).
- **How it was deployed:** `scripts/deploy/deploy.ps1 -Environment preview`. The full test and validate gate passed, and the artifact came from the allowlist. The token was read from Azure into memory only.
- **Dirty-tree incident:** the first deploy was labelled `386543c` but included one uncommitted line (`platform.apiRuntime` in `staticwebapp.config.json`). The script now requires a clean tree for every environment, and preview is being redeployed from a clean commit. Check the latest deployed commit with `/api/me` (`app.commit`, once `BT_COMMIT` is set) or with the deployment record in this file.
- **Settings:** set by `configure-settings.ps1` — storage and backup connection strings, the App Insights connection, a newly generated preview backup key, environment `preview`, and site admins by Terry's email. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` were already present in the preview environment; they were not set by this session and their values were not read.
- **Verified live:**
  - `/` returns 200 with CSP, HSTS, `frame-ancestors 'none'` and no-referrer headers.
  - `/version.json` reports 0.1.0-alpha.1.
  - `/.auth/login/aad`, `github` and `twitter` return 404.
  - Anonymous `/api/me` and anonymous POST return 401.
  - Anonymous `/api/site-settings` returns 200 with no-store, so storage is reachable.
- **Not verified:** Google sign-in on preview. It needs Terry's OAuth client to list the preview callback URI. No signed-in API calls or UI checks have been run on preview yet.
- **Production:** not provisioned, not configured, not deployed. The `budget.remsik.org` DNS is unchanged.

## UX/UI review of 386543c (independent, read-only)

13 findings (UX-001 to UX-013), accepted. The high-severity ones:
- viewers see Add actions they cannot use
- a grantee cannot tell that a "Private" account is someone else's shared with them, and their net position includes it
- at 390px the amount columns scroll off-screen and the filters fill the first screen

The medium and low findings are numeric alignment, quick-entry field order and a sticky Save, stale suggestion hints, terminology, format preferences ignored, settings source labels, workspace-page states, onboarding for non-members, and menu ARIA roles. They will be remediated together with the accessibility review (pending) before the next UI checkpoint.

## Clean preview redeploy and review remediation (2026-09-13)

- **Clean redeploy:** preview was redeployed from `a3d8c16` with a clean tree; `/` returned 200 with CSP and anonymous `/api/me` returned 401. CI passed for `f9550f2`, `386543c` and `a3d8c16`. `deploy.ps1` now records `BT_COMMIT` after each successful deploy, and `/api/site-settings` exposes `app` (version, environment, commit) publicly for verification.
- **Accessibility review of 386543c:** 19 findings (A11Y-001 to A11Y-019), 15 of them confirmed in headless Edge. The five Serious ones:
  - a stale day/night switch
  - selects committing on every arrow key
  - the skip link navigating away
  - contrast
  - focus hidden under the header

  All 19 are addressed (see BT-004-03). Note for Terry: A11Y-001 (the day/night control not redrawing when the device scheme changes while "Use device setting" is on) may also affect TaskTracker's original `daynight.js`. It has not been checked there, and TaskTracker was not touched.
- **UX review:** all 13 findings are addressed.
- **Evidence:**
  - `npm test` passes: 8/8 repository, 78/78 API and 20/20 app tests. `npm run validate` is ok.
  - Headless-Edge runs as Bob and Carol showed no exceptions or console errors, and the screenshots confirm the owner-aware badges, the breakdown (−203.90 + 4,472.67 + 8,500.00 = 12,768.77), dark-mode button contrast, narrow card rows, the reordered quick entry and the viewer message.
  - The screenshot run also caught a frontend crash when the API lacked the new `breakdown` field. It was caused by a stale dev-server process, and the dashboard now tolerates the missing field.
- **Local dev server:** restarted by stopping only its own verified PID. Ports 4280, 7071 and 10000 were untouched.

## Checkpoint E — preview verified, retest, budgets/bills/forecast API, new requirements (2026-09-13)

- **Preview verified at `4ef49b8`:** `/api/site-settings` reports `app.commit` 4ef49b84…, `environment` preview. Google sign-in on preview is still unverified (Terry's OAuth redirect URI).
- **Independent retest of `4ef49b8`** (headless Edge, fictional users, every write blocked in the browser): 30 of 32 UX/accessibility findings PASS; A11Y-004 and A11Y-006 PARTIAL, plus four new small defects. Fixed after the retest:
  - dark-mode accent text now uses its own `--accent-text` token (≥ 4.5:1 on raised surfaces), and the rose/indigo dark hovers were lightened;
  - the skip link is inert behind dialogs;
  - raw error words ("network") replaced by `messageFor` sentences in every view;
  - masked amounts use the muted text colour.
  Not yet re-verified in a browser.
- **BT-008-01 budgets and forecast, BT-008-02 recurring costs and bills (API):** see the requirement register for scope. Bills are versioned (changes effective from a date, never rewriting recorded entries), with skips, pauses, reminders, overdue detection and a reviewable draft per occurrence. Budgets and bills are in backups and caller-scoped restores (owner: shared budgets and bills on shared accounts; member: own private).
- **Terry's new mandatory requirements (2026-09-13)** are registered as BT-008-02, BT-001-05 (no destructive deletion, immutable history), BT-007-01 (managed merchants), BT-011-03 (TaskTracker theme picker) and BT-011-04 (colour-coded expense types). Azure hosting already follows his instruction (one dedicated SWA with a preview environment; no Staging app; DNS and Production untouched).
- **Evidence:** `npm test` 8/8 repository, 105/105 API, 20/20 app; `npm run validate` ok (20 routes).

## Checkpoint F — managed merchants and the non-destructive audit (2026-09-13)

- **Committed before this:** `773c979` (budgets, bills, forecast API; retest fixes; new requirements). Pushed.
- **BT-007-01 merchants:** built in the API and UI (see the register). Breaking API change, deliberate and traced: `transactions` and `recurring` no longer accept free-text `payeeName`; merchants are created on `/api/payees` (inline from quick entry) and linked by `payeeId`. `payees` has no DELETE; `?action=archive|reopen` instead. All fixtures, tests and the dev seed were updated.
- **BT-001-05 audit:** `docs/reviews/2026-09-13-non-destructive-audit.md`. Remaining high items: history/audit caps (A1–A4), bill unskip/resume (A5–A6), restore replace (A7), transaction amendments (B1–B2), budget line versions (B13), the 12 MB cap (E1).
- **TaskTracker theme picker archaeology (for BT-011-03):** `T:` `main` `a1ec150` `app/js/ui/themepicker.js` — a toggle button with a swatch and the current name, opening an in-flow `role=listbox` of option buttons with swatch circles (`.menu__swatch` via `--menu-swatch` CSSOM var, `.themepick*` CSS). It has no arrow/Escape/focus-return handling; BudgetTracker's port will add those as documented adaptations. TaskTracker has 21 palettes; BudgetTracker has 8 of them (same ids and swatches).
- **Bills UI (BT-008-02):** new Bills tab — overdue / due soon / next-30-days cards, a "Needs attention" list with Review and record and Skip, all bills with schedule and next due, and dialogs for review-and-record (edit amount, date, merchant, category, notes for that payment only), skip, pause/resume, history (terms over time, skips with undo, pauses, changes) and the bill editor (term changes take effect from a chosen date; bills are ended, never deleted). Headless-Edge screenshots of Merchants, Bills and Transactions at desktop light/dark and narrow widths plus quick entry showed no console problems. Found and fixed from the screenshots: a stale dev-server process served the old payees handler (the Merchants tab appeared empty); the dev server was restarted by its own verified PID only, and the tab now treats a missing status as active.
- **Committed:** `e34c1ca` (merchants, Bills tab, theme picker, audit doc). Pushed.
- **Planning UI (BT-008-01):** new Planning tab — budgets (per-category planned, carried over, spent, still owed, available; decorative meters with every figure also as text; editor), cash flow (horizon, buffer, warnings naming the bills, expected/cautious/hopeful per account, assumptions) and what-if (one-off amount, changed or excluded bill; calculated on a copy, never saved, shown beside the baseline). The dashboard shows a Needs attention notice (overdue and due-soon bills, 30-day cash-flow warnings). Fixed from screenshots: liabilities no longer trigger below-zero warnings (tested); budget and merchant totals are neutral amounts, not the money-in colour.
- **Unexplained local change:** `README.md` has an uncommitted one-word edit ("TaskTracker rich text editor" → "rich text editor") that this session did not make. It is left unstaged for Terry.
- **Dev data:** the fictional seed now creates merchants, six bills (one overdue) and a shared budget. The previous fictional data was moved to `.local/dev-data-pre-merchants-20260913`, not deleted.
- **Evidence:** `npm test` 8/8 repository, 116/116 API, 25/25 app; `npm run validate` ok (20 routes).

## Checkpoint G — security review fixes, colour-coded categories, non-destructive fixes (2026-09-13)

- **Committed before this:** `b62c790` (Planning tab). Pushed.
- **Independent security review** of bills, budgets, forecast and merchants (`docs/reviews/2026-09-13-security-review-bills-merchants.md`): 1 High, 5 Medium, 5 Low, info; no cross-workspace or site-admin path to financial data. All fixed with regression tests in `api/test/security-b.test.js`: restores never leave dangling bill references and replace keeps directory records (SEC-B1, High); the forecast counts a bill only for viewers of its source account (B2); bill amount and count caps plus per-account/per-budget overflow containment (B3); schedules jump to the requested range and dates are limited to 1900–2200 (B4); the member quota counts merchants, bills and budgets (B5); one live recording per occurrence (B6); bills on deleted accounts are gone (B7); aliases only for fully visible merchants (B8); private budget counts stay in scope (B9); the merchant creator shortcut ends at first use (B10); sharing a merchant hides earlier history and account ids (B11); private transfer destinations are not identified and permission is checked before existence (B12).
- **BT-011-04 colours:** see the register. Also: `api/_shared/colors.js`, categories handler, preference validator, `app/js/core/categories.js`, pickers in My settings and Workspace.
- **BT-001-05 progress:** history/audit truncation removed; bill unskip/resume append-only; replace keeps categories and merchants. Committed as `ab27260`.
- **Transaction amendments (after `ab27260`):** before/after values with author, time and reason for every entry change; reasons required for financial corrections, un-reconciling and deletions; reversals for reconciled entries (idempotent); history endpoint and UI (Reason field, delete dialog, Reverse, History, Reversed/Reversal badges). Breaking API change, traced: DELETE and financial PATCH now need `reason`; all tests updated. ADR-003 (partitioning) proposed. Browser verification of the new dialogs waits for the UX/accessibility reviewer to finish with the dev server. Committed as `af52dba`.
- **Budget plan versions (audit B13)** and the governance update: CLAUDE.md, AGENTS.md, README.md and FOUNDATION_DESIGN.md (schema v1 additive changes) now state Terry's rules — no physical deletion, amendments, merchants by id, versioned bills, colours by id, the theme picker, and the single-SWA hosting constraints. The README commit includes the one-word edit that was already uncommitted in the working copy. Committed as `1de1b58`.
- **Account lifecycle (audit B8, B9, D1):** close/reopen actions with revision and reason; closed accounts refuse new entries, transfers in, bills and bill payments but stay listed with their history; removal needs a reason; every account edit keeps before/after values. Breaking API change, traced: `PATCH accounts` no longer accepts `status`; `DELETE accounts` needs `reason`. UI: Close/Reopen on the Accounts page; closed accounts are not offered in quick entry or the bill editor.
- **Evidence:** `npm test` 8/8 repository, 134/134 API, 35/35 app; `npm run validate` ok (20 routes).

## Checks run this checkpoint

- `node --test test/*.test.cjs`: 7 passed, 0 failed (Node v22.23.1).
- Scanner rules over all 49 tracked and untracked non-ignored files: 0 findings, after fixing 3 self-inflicted false positives in the scanner and its tests.
- `gitleaks git` over the full history: no leaks, 10 commits. `gitleaks dir` flagged only gitleaks' own README example strings in the ignored `.local/bin`; those vendor docs were then deleted.
- Python tomllib: all 9 TOMLs parse (8 read-only, 1 workspace-write).
- The staged scan, commit and push result are recorded in the handoff message and PR, not here; confirm with `git log origin/feature/project-foundation -1`.

## Unfinished work and blockers

- **Application status.** The API (20 routes), the frontend shell and the preview deployment exist; no real financial data may be used until Terry authorizes Production. The feature modules listed as Planned or Partial in `docs/REQUIREMENTS.md` remain.
- **Staging.** By Terry's instruction there is no separate Staging app yet; the design keeps it addable (named environments, per-environment settings and storage). Production storage, deployment and DNS need his explicit authorization.
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

Checkpoints B–E are done (see above). Keep the CI job names `secret-scan` and `foundation-tests`; branch protection requires them. Next, in order:

1. **BT-001-05 no destructive deletion** — apply the read-only deletion audit: amendments with actor, time and reason for financial corrections; void/archive/close states instead of deletion; no history/audit truncation without sealing; tests proving no physical-delete path.
2. **BT-007-01 managed merchants** — extend payees into the merchant directory (stable ids, normalization, duplicates, status, defaults, contact details); searchable merchant dropdown with inline creation in quick entry and bills; Merchants tab create/edit/archive/reopen/history.
3. **BT-011-03 theme picker** — port TaskTracker's canonical picker (archaeology of `T:` `main` in progress) into the account menu and My settings.
4. **BT-011-04 category colours** and **Bills / Planning UI** (BT-008-01/02), then an independent security review of the bills, budgets and forecast surfaces and a UX/accessibility retest.
5. Continue BT-009/010 → BT-011-02/012/007 imports, updating this file at each checkpoint.
