# BudgetTracker project state

## Checkpoint

- **Date and scope.** 2026-09-13, Claude takeover from Codex.
- **Branch.** `feature/project-foundation`, tracking `origin/feature/project-foundation`.
- **Origin.** https://github.com/Stripeman/BudgetTracker.git (public).
- **Checkpoint commit.** The commit containing this file; resolve it with `git log -1 --format=%H`.
- **PR #1.** Merged as `ebc45f8` (2026-09-14, one-time authorization). PR #2 (the deploy-script fix) merged as `31b17b1`, deployed to Production and verified — see "PRODUCTION DEPLOYED" below and Checkpoint R. Preview tracks `feature/project-foundation`, currently well ahead of `31b17b1`; the next Production release needs a new PR from the feature branch, merged after all checks and reviews pass (Terry: standing permission for the agent to merge, he runs the deploy — see "Answered").

## Waiting on Terry (keep current; repeat open items in every status update)

Terry asked (2026-09-14) for one list of what he still has to answer or do, so he never has to search the chat. Move an item to "Answered" with the date and his decision; never delete it.

**Open questions**
0. **Bills under setting (f)?** When "Members may change other members' entries" is turned on, it currently also lets members change each other's bills on shared accounts (one rule serves both). Keep bills under the same setting, or give bills their own setting? (asked 2026-09-14)
1. (answered 2026-09-14 — see Answered: per group and per person.) **Settings (a)–(j) below: build all ten?** Terry said he lacked context; re-explained in plain terms as "today's fixed rule → would become", each keeping today's behaviour as its default. Awaiting yes / no / which.

2. **Which rules should become settings first?** (inventory of hard-coded rules, 2026-09-14: about 40 workflow rules could be settings, about 20 capacity limits only the site administrator should tune, the rest are fixed protections.) Proposed first ten, each keeping today's behaviour as the default: (a) Shared expenses on or off per workspace; (b) default split — method, who is included, who paid; (c) who may correct or void shared expenses; (d) payment rules — who confirms payments to contacts, who may withdraw a confirmation, whether the receiver's own report counts as confirmed; (e) count reported payments in suggestions, and each person's preferred balance view; (f) whether members may change other people's entries on shared accounts; (g) who manages shared lists (accounts, budgets, categories, merchants, contacts); (h) member restores — how many a day and which modes; (i) budget period and week start (these settings exist but are ignored today — a bug) and whether budgets may be backdated; (j) bill defaults — reminder days and the date used for a late bill. Plus one "Capacity" panel for the site administrator (workspace limits, backups a day, storage sizes). Also found: the site's module switches (Shared expenses, trips, forecasting, imports) and backup retention days are stored but do nothing yet; households get the Shared expenses page but not its dashboard summary. (asked 2026-09-14)

**PRODUCTION DEPLOYED (2026-09-14) — first release live at https://budget.remsik.org.** Deployed by the agent under Terry's explicit one-time authorization, from a fresh clone of `main` at `31b17b1` in the scratchpad (clean tree; the script's gate re-ran every test): "Deploying to environment: production", "Project deployed", commit `31b17b1`. Verified separately: `/api/site-settings` on both `budget.remsik.org` and the Azure host reports environment `production`, commit `31b17b1…`, version `0.1.0-alpha.1`; anonymous `/api/workspaces` and `/api/me` 401 on the custom domain (the Azure host 301-redirects to `https://budget.remsik.org/...`); the Azure placeholder page is gone and BudgetTracker is served; security headers present (CSP with `frame-ancestors 'none'`, which replaces X-Frame-Options; HSTS; nosniff; Referrer-Policy; COOP); Google sign-in reaches accounts.google.com with `redirect_uri=https://budget.remsik.org/.auth/login/google/callback` (already registered by Terry); GitHub sign-in 404. **Terry's signed-in session verified (2026-09-14):** his Production `/api/me` shows `siteAdmin: true`, environment `production`, commit `31b17b1…`, one personal workspace he owns, preferences loading (his subject and email are kept out of Git; the subject lives only in the ignored `.local/deploy-target.json`). His display name is empty — to set in My settings. **B3 backup-key drill on a Production archive: PASSED (2026-09-14).** Terry took an on-demand backup of his workspace in Production (archive `bak_mu18lp87d8a425d630bf`, 12,704 bytes, 12:46 UTC). The agent listed and downloaded it read-only from `stbudgetbkprd01` (account-key auth, because Terry's login has no blob-data role), loaded the escrowed keys from `.local/escrow/` into the drill process only (never printed), and ran `scripts/recovery/drill.cjs` into an empty isolated folder: key id `prd1`, schema 1, checks header.workspace-matches, decrypt-and-validate, attachments-complete, balances-match-manifest and counts-match-manifest all ok, counts 2 accounts / 2 entries / 1 merchant / 17 categories / 1 member, restore 5 ms, verify 1.4 ms, recovery point 0.1 h old, result passed. The downloaded archive and the decrypted copy were then deleted from the PC. **Next for Terry: move the escrow file (`.local/escrow/production-backup-keys-*.env`) to offline storage**; real records may be used. Until the next release: do not pick "Owed to others" by hand and do not use "Also record my part on my own account" (fixed on the feature branch, not in `31b17b1`).

**Release status (2026-09-14):** PR #1 merged as `ebc45f8`; the deploy script sent every deploy to preview (`--api-version 22--env`, missing space since `d0b08cc`), fixed with Terry's authorization in `f827181`, proven by the CLI's `--dry-run` ("production") and a preview deploy ("Deploying to environment: preview", preview reports `e405856`); PR #2 merged as `31b17b1` (tree identical to `e405856`, CI green). Production (`polite-plant-03bb7570f.3.azurestaticapps.net`, custom domain `budget.remsik.org` attached, DNS unchanged) had nothing deployed (404) — waiting for Terry's deploy from a fresh clone of `main` at `31b17b1`.

**Actions for Terry (not questions)**
- **Now that Production is live (2026-09-14):** (1) DONE 2026-09-14 — signed in; `/api/me` shows `siteAdmin: true` on environment production, commit `31b17b1`; display name set by Terry; (2) DONE 2026-09-14 — backup taken and the B3 drill PASSED (see "PRODUCTION DEPLOYED"); (3) STILL TO DO — move the escrow file offline. Original steps: (2) for the B3 key drill, create a workspace with fictional data only, add one entry and take one on-demand backup (Workspace page → Backups), then tell the agent — the agent downloads that archive into the ignored `.local/`, runs `scripts/recovery/drill.cjs` with the escrowed `prd1` key and records the result; (3) after a passing drill, move the escrow file from `.local/escrow/` to offline storage. Real records only after the drill passes.
- (Done 2026-09-14: the Production deploy itself — see "PRODUCTION DEPLOYED" below.)
- Save his display name in My settings on preview.
- Finish the preview smoke test (B1), once the shared-expense fixes pass their rechecks; until then do not use "Also record my part on my own account" on preview.
- Production release steps when everything passes (see "Exact next steps"): remove the merged agent worktrees or use a fresh clone, add the Production redirect URI, run the Production deploy, the B3 key drill and move the escrow file offline, decide the Production failure alert.
- Optional: a non-admin GitHub identity for agents (branch protection is not enforced against his admin token).

**Requested features not yet built**
- (none open — the staging link below is built)

- **Remove an account created by mistake (Terry, 2026-09-14):** "i need a way to delete an account if there are no transactions against it" / "i just created the wrong one and now i cant remove it". Found: the API already has a soft remove (`DELETE /api/accounts`, reason required, recoverable, history and audit — BT-001-05) and restore, but the Accounts page offered only Close/Reopen, so it was unreachable in the UI (also in Production `31b17b1`). Being built by an agent on `feature/remove-account` (from `c68a7e5`): a Remove action (empty accounts: one-step confirmation with the reason pre-filled "Created by mistake"; accounts with entries: explained, with "Close instead"), a "Removed accounts" list with "Bring back". Never a physical delete.

- **Move an entry to another account (Terry, 2026-09-14):** "on a transaction i should be able to move a transaction from one account to the next if i accidently choose the wrong account in the first place.. what impact would that have". Found: an entry's account cannot be changed today (`accountId` is not in the transactions PATCH keys). Impact explained to Terry: both balances correct themselves (and everything derived from them); the move is one amendment with from/to account, who, when and why, visible in both accounts' history; privacy — moving between a private and a shared account changes who can see the entry, so the move needs rights on both accounts and the dialog says so; spending by category unchanged; refused with plain reasons for different currencies, reconciled, reversed, Shared-expense-created and owed-pair entries, and closed/removed destinations; transfer legs re-point atomically; bill-recorded entries keep their bill link. Being built by an agent on `feature/move-entry` (from `c62ed49`).

- **Delete a workspace (Terry, 2026-09-14):** first "as a site admin i should be able to force delete a workspace.. esp if im doing it for testing"; after the conflict with his own rules was explained (site administration never touches financial records; nothing is physically deleted; Production backups are immutable for 35 days), he decided: "a site admin shouldnt see private data.. but the workspace owner should be able to delete their own workspace(s)". So: no site-administrator delete; owners get "Delete workspace" (the existing recoverable archive — everyone loses access, nothing erased) with a typed-name confirmation and a "Deleted workspaces" list with "Bring back" in My settings. The API already had owner archive/restore but no button; added to the settings-card agent's work on `fix/workspace-settings-ux`.

- **Edit more account fields (Terry, 2026-09-14):** "yea i should be able to edit account entries too. very little is editable. i need to be able to change values in the fiends like account opening balance, opening date and institution name and account number, icon and type and currency" / "i also need the ability to modify account info". Found: the API already accepts opening balance, opening date, institution, masked account number and icon (`EDITABLE` in api/accounts/handler.js, locked only once an account has reconciled entries) — but the Edit dialog on the Accounts page only exposes Name and icon, so the rest is unreachable. Type and currency are NOT editable server-side, deliberately: every recorded amount and category rule assumes the account's currency and type, so changing either after entries exist would silently corrupt history; kept as create-time-only fields, with the wording explaining why (close it and create a new one for those two). Being built by an agent on `feature/edit-account` (from the foundation tip).
- **Site-admin usage statistics (Terry, 2026-09-14):** "i would like to add a usage statistics on the site for the site admin... users, how many users, frequency of use, last log ins etc. should use nice graphics." A site-admin-only page: user counts and growth, sign-in frequency, last-sign-in times, active workspaces — never account balances, entries, names or any financial content (site administration never touches financial records, per BT-001-01/CLAUDE.md — this is aggregate/usage data only, not workspace contents). Being designed and built by an agent on `feature/site-analytics` (from the foundation tip).

**Built on request (2026-09-14)**
- **Staging link in the account menu (BT-011-06), merged as `d363eff`.** Terry: "include … a link to staging!! so i can get to it" / "make it a field that can be updated" / "make the link in the users drop down profile menu actually. but be sure it can be edited and looks good". "Staging site" in the header account menu (new tab, `rel="noopener noreferrer"`, external-link icon, styled like the other menu items in light, dark and all palettes, 390 px checked) with "Edit" beside it; "Add staging link…" when empty; a "Staging link" card in My settings; a site default that the site administrator sets once and each person may override or the site may lock. Validation `fields.webAddress` (https only, printable ASCII, max 300, hidden characters refused), re-checked in the browser; anonymous visitors never receive the default and a site administrator cannot read personal links. The real preview address is in no committed file — Terry enters it in My settings. Gate on the merge: 14/14 repository, 366/366 API, 227/227 app, validate ok; `npm run e2e` 161 passed, 0 failed (23 new staging checks: add, edit, refuse http, remove, new tab, Bob never sees Alice's link). **Preview deployed at `eb29260`** (after DNS steadied; "Project deployed", `/api/site-settings` commit `eb29260…` environment preview, `staginglink.js` byte-identical to the artifact, no staging address in anonymous site settings). Independent security review of `d363eff`: **PASS WITH LOWS** — no script, disguised-host, open-redirect or tabnabbing path; 57 hostile addresses gave identical server and browser verdicts; Lows: the site default reaches every signed-in Google account, locking without a default leaves an unsavable state, the site-default audit lacks before/after; being fixed on `feature/staging-link-local` together with local http. **Follow-up merged as `4b2dee6` and on preview:** local http staging links accepted only for `127.0.0.1`, `[::1]` and `localhost` in the local dev environment (preview and Production stay https-only); the site default goes only to active workspace members and site administrators (not to outsiders such as eve); a locked link is reported as locked and a person may always clear their own; the site-default audit records before and after; `@`, `%`, port 0 and unusual IP forms in the address are refused and the address is stored normalised (`4641bd6`, `cd315d3`, `1ffaf7a`; the agent stopped at the usage limit after committing everything). Gate on the merge: 14/14 repository, 389/389 API, 288/288 app, validate ok; `npm run e2e` **195 passed, 0 failed** (staging scenario now also runs as eve); preview verified at `4b2dee6` ("Project deployed", `/api/site-settings` commit `4b2dee6…`, `links.js` byte-identical to the artifact).

**Answered (kept for the record)**
- 2026-09-14 — **Build all ten settings (a)–(j).** Each keeps today's behaviour as its default. Shared-expense ones (b default split, c who corrects/voids, d payment rules, e counting reported payments and each person's balance view) go to the BT-009 implementation agent after M1/L2/L3, in the group settings model; workspace ones (a Shared expenses on/off per workspace with the site switch as upper bound, f editing others' entries on shared accounts, g who manages shared lists, h member restores, i the existing budget period/week start made to work plus backdating, j bill defaults) to a new agent on `feature/workspace-settings` (from `6f5d57e`).
- 2026-09-14 — **Production deploy: one-time authorization for the agent** ("i authorized you to push to production / a one time push"; "and not there yet so authorization stands"). Deploying `main` at `31b17b1` from a fresh clone in the scratchpad (the working folder holds agent worktrees, so the script's clean-tree check needs a clean clone).
- 2026-09-14 — **Google redirect confirmed present:** Terry's OAuth client already lists `https://budget.remsik.org/.auth/login/google/callback` (and the preview callback). Nothing to add unless he wants to sign in through the raw Azure address `https://polite-plant-03bb7570f.3.azurestaticapps.net`, which would need its own `/.auth/login/google/callback` entry.
- 2026-09-14 — **"What DNS am I changing?"** None of his domains or records. The "DNS" was his PC's name lookup through the Wi-Fi router (192.168.86.1), which failed on and off during the session and interrupted pushes, deploys and agents. Checked afterwards: 20/20 lookups succeeded, so no change is needed; only if the dropouts return would restarting the router or setting the PC's Wi-Fi DNS to 1.1.1.1 help.
- 2026-09-14 — **Confirm-payments setting: per group AND per person.** "Add this as a configuration option for the whole group or each person." Group setting "Anyone in the group can confirm payments" (default ON) plus a per-member override set by owners/managers ("Use the group setting / Yes / No"); sent to the fix/bt009-recheck agent.
- 2026-09-14 — **Staging link: allow local http when running locally** (loopback hosts only, local dev environment only; preview and Production stay https-only); sent to the staging-link agent with the link's security-review Lows (site default only to workspace members or site admins; a locked link reported as locked and a person may always clear their own; audit before/after of the site default; stricter address forms, stored normalised).
- 2026-09-14 — **Google redirect:** only one is needed, the full callback `https://budget.remsik.org/.auth/login/google/callback` under Authorized redirect URIs (`budget.remsik.org` is a CNAME to the Production host and already answers 200; the azurestaticapps callback is needed only if signing in through that address).
- 2026-09-14 — **"Why is Production blocked?"** Nothing in the code: the deploy is Terry's step by his own rule, and his router's DNS keeps failing (the deploy needs GitHub and Azure during the run) — restart the router or set Wi-Fi DNS to 1.1.1.1 / 8.8.8.8.
- 2026-09-14 — **First Production release: now**, with the known issues avoided until the next release (do not pick "Owed to others" by hand; do not use "Also record my part on my own account"). PR #1 merged by the agent as `ebc45f8` (one-time authorization; tree identical to the CI-green `59c23d0`).
- 2026-09-14 — **Later releases:** standing permission for the agent to merge a release PR into `main` after all checks and reviews pass; Terry still runs every Production deploy himself.
- 2026-09-14 — Payer confirming their own payment / single-owner contact payments (S5): a group setting "Anyone in the group can confirm payments", default ON, with an explanation; OFF keeps the strict rules.
- 2026-09-14 — Hand entry of "Owed to others" and "Repayment" (R2/N1): a group setting, default "Created by Shared expenses only", with an explanation; when allowed, an owed-to-others entry is always paired with its share as spending.
- 2026-09-14 — No-money-moved lines (N3): an icon of two parallel lines without heads (|==|) beside the words.
- 2026-09-14 — Create-new restores keeping other members' identities (S4 residual): fix it across all carried records.
- 2026-09-14 — Testing: verify in real browsers on localhost with several fake users and parallel requests (a multi-user harness is being built).
- 2026-09-14 — Screenshots of another app: add only features that do not exist; presentation later.
- 2026-09-14 — **Design principle: configurable over hard rules.** "The application shouldnt set hard rules that a person shouldnt otherwise be able to have as a configuration… the user should be able to decide about things that can be configurable." Workflow and policy choices become settings (site admin, workspace owners/managers, or each person) with today's behaviour as the default and a plain explanation; only the security and integrity gates stay fixed (private by default, server-side authorization, site admin never sees financial records, nothing deleted, atomic audit, integer money, no silent overwrite, restores never resurrect access). An inventory of hard-coded rules that could become settings is being compiled for Terry to choose from; the shared-expense settings are built as an extensible settings model.

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
- **Account lifecycle (audit B8, B9, D1):** close/reopen actions with revision and reason; closed accounts refuse new entries, transfers in, bills and bill payments but stay listed with their history; removal needs a reason; every account edit keeps before/after values. Breaking API change, traced: `PATCH accounts` no longer accepts `status`; `DELETE accounts` needs `reason`. UI: Close/Reopen on the Accounts page; closed accounts are not offered in quick entry or the bill editor. Committed as `a9e2b5b`.
- **UX/accessibility review 2** (`docs/reviews/2026-09-13-ux-a11y-review-2.md`) of Bills, Planning, Merchants and the pickers: 1 Serious (focus lost after dialog actions), 11 Moderate/Minor accessibility and 17 usability findings; all fixed except UX2-008 (partial). Evidence: `app/test/modalfocus.test.js`; headless-Edge screenshots after the fixes.
- **New requirement BT-011-05 (contextual icons, Terry 2026-09-13)** registered; TaskTracker icon archaeology in progress.
- **Contact lifecycle (audit B12):** archive and restore (reason optional) instead of deletion; before/after history on shared and private contacts, private history visible only to its owner; archived contacts out of selectors and the default list (`includeArchived=1` shows them).
- **Evidence:** `npm test` 8/8 repository, 134/134 API, 35/35 app; `npm run validate` ok (20 routes).

## Checkpoint H — preview verified at 579568c, contextual icons (2026-09-13)

- **Preview verified:** `deploy.ps1 -Environment preview` of `579568c` exited 0; `/api/site-settings` on the preview host reports `app.commit` `579568c534d7962fe8b47eb39fce4ca8ae68b770`, environment `preview`; the root serves the CSP; anonymous `/api/me` is 401.
- **BT-011-05 contextual icons (Partial; see the register):** server catalogue `api/_shared/icons.js` (57 stable ids, defaults by type, choice validation, `site/icons.json` with switched-off built-ins and custom icons), validated upload `api/_shared/icon-svg.js` (shape data only, re-checked before serving), route `/api/icons` (21 routes); icon fields on categories (with `defaultIcon`), accounts, merchants, bills, budgets; workspace type icons; personal `categoryIcons`. Client registry `app/js/ui/icons.js` (TaskTracker `icon()` conventions, fallback instead of throw, custom shapes re-validated), icon picker on the theme-picker pattern (`app/js/ui/iconpicker.js`), icons across Dashboard, Transactions (direction icons), Bills, Planning, Accounts (new Edit dialog: name and icon), Merchants, the merchant picker, Workspace (category icons, Icons for types) and My settings (personal category icons; the site catalogue for site administrators, reachable without a workspace). Archaeology recorded in `docs/TASKTRACKER_REUSE.md`; schema additions in `docs/FOUNDATION_DESIGN.md`; rules in CLAUDE.md and AGENTS.md.
- **Dev tooling:** `scripts/dev/screenshot.mjs` gained `--full 1` (whole page) and `--interact iconpick`.
- **Evidence:** `npm test` 8/8 repository, 163/163 API, 47/47 app; `npm run validate` ok (21 routes); headless-Edge screenshots (light, dark, 390 px) of every view as Alice and of My settings as the site administrator, no console errors.
- **Known limits:** native selects (category/account fields, filter options) cannot show icons; debt, trips, reports, exports and charts do not exist yet, so icons there wait for those features.
- **Committed and pushed as `4bddb78`.** Then the independent security review (`docs/reviews/2026-09-13-security-review-icons.md`): no Critical/High/Medium. Fixed with tests: SEC-I1 prototype-named categories (own-property lookups in `icons.js` and `colors.js`, which also fixes a pre-existing 500 when creating a category named "constructor"), SEC-I2 retired icons no longer use up the working limit (offering one again counts; 500 stored in total), SEC-I3 type icons cleared synchronously on workspace switch, SEC-I5 stricter validator; SEC-I4 partly (6 MB catalogue cap, refused not trimmed). Open: SEC-I4 catalogue ETag/partitioning; SEC-I7 question for Terry — should personal display preferences (colours, icons) keep a change history under BT-001-05?
- **Evidence after the fixes:** `npm test` 8/8 repository, 166/166 API, 48/48 app; `npm run validate` ok (21 routes).
- **Preview verified at `f6e1cec`:** `deploy.ps1 -Environment preview` exited 0; `/api/site-settings` reported `f6e1cecba3cb90521a4334f7541d9ce5f14ef771` about 30 s after the static files updated (the API lags the static content briefly); anonymous `/api/icons` is 401; `app/js/ui/icons.js` is served. Signed-in checks on the preview still need the Google redirect URI (Terry).

## Checkpoint I — restore replace never drops records (BT-001-05 A7, 2026-09-13)

- **Behaviour:** a replace restore still makes the lists match the backup inside the caller's scope, but every current record it replaces with a different backup version, or that did not exist when the backup was made, is moved whole into the workspace's append-only `superseded` collection with `collection`, `reason` (`replaced-by-backup` / `not-in-backup`), `archiveId`, `at` and `by`. Identical records are untouched. Every replace or merge appends to `restores[]` with its recovery point and the number set aside. The preview reports `excluded.setAside` and says records are set aside and kept, not removed. No route exposes `superseded` yet; an authorized history view is a follow-up.
- **Files:** `api/_shared/backup.js` (`plan`, `finalize`), `api/restore/handler.js`, `app/js/ui/views/workspace.js` (preview wording), `api/test/backup.test.js`, audit row A7, register BT-001-05, schema additions table.
- **Evidence:** `npm test` 8/8 repository, 167/167 API, 48/48 app; `npm run validate` ok (21 routes).

## Checkpoint J — lifecycle and history for bills, budgets, members and workspaces (BT-001-05, 2026-09-13)

- **B14 bills:** detail edits (name, type, notes, due-soon window, end date, icon) keep before/after `changes` in the bill history; the Bills history dialog shows them.
- **Budgets:** `DELETE` archives with an optional reason (history, `deletedBy`, `archiveReason`); `GET ?includeArchived=1` lists archived budgets; `POST ?action=restore` restores (revision-checked). Name and icon edits keep before/after with an optional reason.
- **B15 members:** append-only member history of role changes, removals (optional reason), departures and rejoins (from the invitation accept); `GET members?includeFormer=1` for owners and managers lists former members with their history (403 for others).
- **B16 workspaces:** name and settings edits keep before/after with an optional reason (an unchanged save records nothing); archive and restore append to `lifecycle` with who, when and reason; owners and managers see both on `GET ?id=`.
- **B11** was already fixed by the category colour/icon work (audit row updated).
- **Evidence:** `api/test/lifecycle-b.test.js` (4); `npm test` 8/8 repository, 171/171 API, 48/48 app; `npm run validate` ok (21 routes).
- **Open:** UI for archived budgets, former members and workspace history; ADR-003; A8 ruling; preference history (awaiting Terry, SEC-I7).

## Checkpoint K — icon UX/accessibility review fixed (BT-011-05, 2026-09-13)

- Independent review `docs/reviews/2026-09-13-ux-a11y-review-icons.md`: UXI-1 (Serious: Escape in a picker inside a dialog closed the dialog) fixed — `escapeBelongsToControl()` in `app/js/ui/modal.js`, Escape on an open picker toggle — and verified with a real key press in Edge (`scripts/dev/screenshot.mjs --interact iconpickesc`). UXI-2 type-ahead and paging in the shared picker; UXI-3 compact grouped category rows on full-width cards with colour-tinted icon previews; UXI-4 refund/reversal text for screen readers (`amountWithDirection` moved to `components.js`); UXI-5 focus restore and a named fieldset in the site catalogue; UXI-6, UXI-8 (artwork and labels; Transport merchant default Train), UXI-9 fixed; UXI-7 and UXI-10 accepted with reasons; UXI-11 partly.
- **Evidence:** `npm test` 8/8 repository, 171/171 API, 52/52 app; `npm run validate` ok (21 routes); full-page screenshots of Workspace, My settings and Dashboard.
- **Preview verified at `bce2e1a`** (includes checkpoints I–K): `deploy.ps1 -Environment preview` exited 0; `/api/site-settings` reports `bce2e1a1e493634438cebd74fe0cbd4cc4bced32`; anonymous `/api/icons` is 401. Signed-in checks still wait for the preview Google redirect URI (Terry).

## Checkpoint L — lifecycle UI (BT-001-05, 2026-09-13)

- Planning: Archive on each editable budget (optional reason, confirmation that the plan and history stay) and an "Archived budgets" section that lists archived budgets with date and reason and restores them.
- Workspace: "Former members" (membership history of each former member: role changes, removal or departure with reason, rejoins) and "Workspace changes" (name and settings before/after, archive and restore) for owners and managers; others see a short explanation. Activity labels for budget archive and restore.
- **Evidence:** `npm test` 8/8 repository, 171/171 API, 52/52 app; `npm run validate` ok (21 routes); full-page screenshots of Planning and Workspace, no console errors.

## Checkpoint M — restore history (BT-001-05 A7 follow-up, 2026-09-13)

- `GET /api/backups?workspaceId=&action=history` for anyone who may restore (viewers, outsiders and site administrators get 404): the restore log and the records each replace set aside. A set-aside record is listed only if the caller could see it (entries and bills through their account, accounts by their access rule, merchants and budgets when shared or their own); only summaries are returned; a restore's count is shown only to the person who ran it. Workspace → Backups has "Restore history and records set aside", loaded when opened.
- **Evidence:** new test in `api/test/backup.test.js` (owner, member, viewer, site administrator, outsider); `npm test` 8/8 repository, 172/172 API, 52/52 app; `npm run validate` ok (21 routes).
- **Preview verified at `cb2f168`** (includes checkpoints L and M): `deploy.ps1 -Environment preview` exited 0; `/api/site-settings` reports `cb2f16884aaffb5b8ad8288cb72fd4e7ccba27e2`; anonymous `/api/icons` is 401.
- **SEC-I4 (mostly fixed):** `GET /api/icons` returns `catalogEtag`; the store sends back the version it holds and reuses its copy when the answer is `catalog: null`, so switching workspaces no longer re-downloads the catalogue; administrators always get the full view. Open: partition the catalogue's audit/history. Evidence: new test in `api/test/icons.test.js`; `npm test` 8/8 repository, 173/173 API, 52/52 app; `npm run validate` ok (21 routes).
- **Preview verified at `df61ec0`:** `deploy.ps1 -Environment preview` exited 0; `/api/site-settings` reports `df61ec024125b2fe0808d118564656c33021260f`.
- **Terry's decisions (2026-09-13):** (1) money-direction arrows show only money in (↑) or out (↓), never both ways — transfer legs now use their own sign and read "Transfer to/from <account>" with that account's icon; (2) personal display preferences (colours, icons, settings) need no change history — SEC-I7, A9 and the preference part of B18 are resolved; (3) the preview's Google redirect URI has been added — verified anonymously: `/.auth/login/google` on the preview hands off to `accounts.google.com/o/oauth2/v2/auth` with `redirect_uri` `https://polite-plant-03bb7570f-preview.eastus2.3.azurestaticapps.net/.auth/login/google/callback` (a client must keep the SWA nonce cookie, or it loops on `/.auth/login/google`). Completing a sign-in needs Terry's own Google account.
- **Transfer arrows (Terry's decision 1):** `directionOf` no longer returns the two-way icon; `transferLabel` in `app/js/ui/components.js` names the other account ("Transfer to/from …", "another account" when hidden) with its icon, in Transactions and on the Dashboard; tested (`app/test/icons.test.js`) and seen in headless Edge.
- **BT-011-02 archaeology done:** `docs/reviews/2026-09-13-editor-archaeology.md` (stored format, rendering, hardening, CSP, vendoring and licences, validator conflict, recommended reduced schema and plan).
- **Preview verified at `2ec9c10`:** `deploy.ps1 -Environment preview` exited 0; `/api/site-settings` reports `2ec9c105464abc3f9971b047a69b6c31d574448f` (in/out-only direction arrows live).
- **BT-011-02 step 1 — server rich-text validator:** `api/_shared/richtext.js` (envelope `{format:"tiptap", v:1, doc}`; reduced closed schema: doc, paragraph, heading 1–3, bullet/ordered/task lists, blockquote, horizontal rule, hard break, text; marks bold, italic, underline, strike, link; per-node content model; declared attributes with closed values and canonical defaults; marks only on text, once each; non-empty text without control characters; links http/https/mailto stored exactly as cleaned, ≤ 2,048; ≤ 64 KiB, depth 12, 2,000 parts, the field's character limit; refuse, never strip; canonical rebuild; `plainText()` for search and limits) and `fields.richText()` (plain strings unchanged via `text()`, empty document stored as `''`). Not wired into any handler until the client can display documents. Evidence: `api/test/richtext.test.js` (9); `npm test` 8/8 repository, 182/182 API, 53/53 app; `npm run validate` ok (21 routes).
- **New workspace… (Terry's question, 2026-09-13):** the API always supported several workspaces, but the UI offered creation only when a person had none. The account menu now has "New workspace…": a dialog with the same fields as the first-workspace page (shared `workspaceFields()` in `app/js/ui/views/landing.js`), defaulting to Personal, one idempotency key per opening, errors inside the dialog, and the new workspace becomes the current one. Evidence: `app/test/newworkspace.test.js` (2; the DOM double gained `contains()`); headless-Edge screenshots of the menu and dialog (`--interact newws`); `npm test` 8/8 repository, 182/182 API, 55/55 app; `npm run validate` ok (21 routes).
- **Raw control characters:** five source files held raw control or invisible characters meant as escapes (three showed as binary in Git); now escapes, and `scripts/validate.cjs` rule 9 forbids them (committed `e52d266`).
- **Local dev data note:** two large fictional entries dated 2026-09-13 in the local "Fictional Household" were added through the app as the dev user Alice at 15:43–15:44 UTC (ordinary use of the local server, not by an agent). Offer to Terry: move the dev data aside and reseed.
- **Next increment started:** BT-011-02 Tiptap editor — TaskTracker `T:` `main` is still `a1ec150` (freshest; `Z:` `main` is `40ced2a`, 2026-08-26); read-only archaeology of its editor modules, vendoring and tests is in progress.

## Checkpoint N — first Production release in progress (2026-09-13)

- **Terry's instructions (2026-09-13):** "push to staging and then production". "Staging" means the existing **preview** environment (no separate staging; saved as a standing preference). Terry granted a **one-time** authorization to merge PR #1 (feature/project-foundation → main) for this release — not a standing permission — and authorized provisioning Production storage and settings, with the Production backup key saved under the ignored `.local/` for his offline escrow.
- **Built since Checkpoint M:** "New workspace…" (`156b6e2`); BT-011-02 step 2 — vendored Tiptap bundle from exact pins with licence notices (33 packages, all MIT), `validate.cjs` rule 10 registering it (`8c1aa27`); the generator moved to `scripts/vendor-tiptap.mjs` because `.gitignore`'s `build/` rule had kept `scripts/build/` out of the commit and CI failed (`56497d8`); `scripts/scan-staged.cjs` allows an address only on a copyright line in a vendored bundle's opening comment (tested); no focus ring on page titles after refresh (Terry's report): focus moves to the heading only on in-app navigation, and programmatically focused headings show no ring.
- **Release gates so far:** `npm test` 9/9 repository, 182/182 API, 57/57 app; `npm run validate` ok (21 routes); CI `foundation-tests` and `secret-scan` pass on `56497d8`; PR #1 marked ready (merge state clean). Independent release-readiness review of `56497d8` requested.
- **Production steps:** (1) Terry runs `provision.ps1 -Environment production -AuthorizedProduction` (typed confirmation); (2) `configure-settings.ps1 -Environment production -AuthorizedProduction` with the key escrowed to `.local/`; (3) merge PR #1; (4) Terry runs `deploy.ps1 -Environment production -AuthorizedProduction` from `main` (typed confirmation); (5) verify separately. Terry sets the Production `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and redirect URI; DNS unchanged; WORM retention on Production backups still needs his decision.

- **Release-readiness review of `56497d8` (independent): NOT READY** for Production with real data. Code gates green. Blockers: B1 no signed-in check on any deployed environment (Terry's preview smoke test needed); B2 candidate not on preview — **resolved** (preview verified at `56497d8`, code identical to `bd80d3e`); B3 no tested backup-key escrow (read the key back to `.local/` and prove it with `scripts/recovery/drill.cjs` on a Production archive, then move it offline); B4 no automated backups — **accepted by Terry for launch** (on-demand backups plus the pre-restore recovery point; scheduled backups next); B5 no independent security/financial review of recent features — **Terry: run full reviews first** (both launched on `bd80d3e`); B6 no rollback procedure — **written** (`docs/DEPLOYMENT.md`, "Rollback and schema compatibility"). Deploy-time conditions noted: site admins must be listed by Google user id (the roles lookup matches subjects, not email) — add Terry's id from `/api/me` after first sign-in; decide shared Application Insights and OAuth client; add a Production failure alert; check Azure's Node runtime (config says node:20, which is past upstream end of life); open sign-up has no rate limiting.
- **Terry's decisions (2026-09-13, second round):** full independent reviews before Production; accept on-demand backups for the first release.
- **Independent reviews of `bd80d3e` (2026-09-13).** Security: no Critical/High; SEC-R1..R9 fixed with tests on this branch (restore size cap and set-aside records counted in member allowances; no-change restores refused and members limited to 3 restores a day; archive ids in restore history only for managers or the restorer and non-owner restores audited privately; replace keeps contacts; 20 active created workspaces per person; staged-scan banner exemption narrowed; vendored folder may hold only generated files and CI rebuilds the bundle byte-for-byte; rich text refuses invisible/bidi characters and links with credentials; hidden-character rule covers agent folders and hooks). SEC-R10 (site admins by email) is a configuration item: preview's `BT_SITE_ADMINS` still holds an email, so Production must use Terry's provider subject from `/api/me`. Financial: 3 High, 6 Medium, lows. FIN-R5 (replace dropped a record shared after the backup), FIN-R17 (blocker names the failing rule), FIN-R15 in backup balances and the FIN-R2 invariant (a reversal and its original share deletion state) fixed here; FIN-R1..R4, R6..R9, R11..R16 are being fixed by a separate implementation agent in an isolated worktree, to be merged and re-tested; FIN-R10 (two "current balance" definitions) deferred as known debt. Remaining rate-limiting gap recorded in `docs/DEPLOYMENT.md`.
- **Financial fixes merged (2026-09-13).** The implementation agent's `6347007` (FIN-R1..R4, R6..R9, R11..R16, 23 API and 5 app regression tests, each mutation-checked) was merged as `baebb08`; `ff5d9c5` finishes FIN-R4 (the backup occurrence invariant uses `bills.recordingCounts`, so a reversed bill occurrence can be recorded again once; the temporary `recording_reversed` guard is gone). Gate at `ff5d9c5`: 10/10 repository, 216/216 API, 62/62 app, validate ok; CI green on `6962bfa` and `ff5d9c5` (including the Linux rebuild of the Tiptap bundle, byte-identical).
- **Preview deployed at `ff5d9c5`** from a clean tree (deploy gate re-ran every test). Verified separately: `/api/site-settings` reports environment `preview`, commit `ff5d9c55dc21…`; anonymous `/api/icons` returns 401. Not yet verified: signed-in flows (B1, Terry's smoke test).
- **Independent retests of `ff5d9c5` running** (security and financial). Production still waits for: the retests and any fixes, Terry's preview smoke test and his Google user id for `BT_SITE_ADMINS` (SEC-R10), Production provisioning by Terry, key escrow with a recovery drill (B3), then the PR #1 merge and Terry's Production deploy. The merged agent worktree `.claude/worktrees/agent-afa1b4843db192131` (branch `fix/financial-accuracy-review`) is untracked and can be removed; nothing in it is unmerged.
- **Retests of `ff5d9c5` (2026-09-13).** Security: no Critical/High, privacy sound; SEC-R4/R6/R7 fixed, R1/R2/R3/R5/R8/R9 partial; new SEC-T1 (parallel restores each wrote a recovery point) and SEC-T2 (member delete/restore cycles grew the workspace past allowances) Medium, T3..T9 Low. Financial: NOT READY — FIN-R5 partial; new FIN-T1 High (replace-then-merge re-attached a reversal and could create money), FIN-T2 Medium (regression from the FIN-R15 backup change), FIN-T3/T4/T5 Medium, T6..T8 Low. **All fixed with tests** (BT-006-04; `api/test/security-retest.test.js`, `api/test/financial-retest.test.js`): gate 10/10 repository, 233/233 API, 62/62 app, validate ok. Preview was deployed at `1da7da6` and verified (`/api/site-settings` commit `1da7da67…`, environment preview; anonymous `/api/workspaces` 401); CI green.
- **Final retests of `1da7da6` (2026-09-13).** Security: no Critical/High, privacy invariants hold, 8 of 9 SEC-T fixes verified; SEC-U1 Medium (contacts, contact edits and grants not counted) plus Lows U2..U6. Financial: **ready for real money for the features that exist**; all FIN-T fixes mutation-checked; Lows FIN-U1..U3. All fixed with tests except SEC-U4 (accepted Low; see BT-006-04). Gate: 10/10 repository, 239/239 API, 62/62 app, validate ok. Preview then deployed and verified at `e00790c` (CI green). **Security recheck of `e00790c`:** no Critical/High, privacy held on every path; SEC-U1/U3/U5/U6 fixed, U2 partial; new SEC-V1 Medium (a manager could use up the headroom with on-demand backups and freeze the owner out) plus Lows V2..V6 — all fixed with tests except **SEC-V3, which needs Terry's decision** (member allowances only grow and cannot be raised; roughly 2,400 entries a year for a very active member). Fixes committed as `3474418` (gate 10/10 repository, 245/245 API, 62/62 app, validate ok; CI green); preview deployed and verified at `3474418` (`/api/site-settings` commit `34744188…`, environment preview; anonymous `/api/workspaces` 401). Terry paused work after this deploy; a narrow recheck of the SEC-V fixes was restarted on resume. **Recheck of `3474418`:** SEC-V1 only partial — uncapped invitation acceptance could still freeze the owner out (Medium) — plus Lows L1..L7; all fixed with tests except L1 (accepted Low; see BT-006-04). **Terry decided (2026-09-13): owners set each member's storage allowance** (SEC-V3; implemented with choices of 1, 2, 4, 8 or 12 MB). Terry's Google subject was received and is kept only in the ignored `.local/deploy-target.json` (personal identifier, never in Git); preview `BT_SITE_ADMINS` now holds the subject instead of the email (SEC-R10). Terry's preview `/api/me` shows an empty display name (Google sent none or it was refused); cosmetic. **Security check of `41ec172`: gate passes** (invitation cap and L2..L7 verified; allowance-feature Lows LA1..LA4 fixed with tests, LA5 cosmetic and accepted). Preview anomaly on the `41ec172` deploy: the new frontend was served and `BT_COMMIT` was set, but the API kept reporting `3474418` for over ten minutes and the SWA CLI printed no final success line — redeploy and verify the API directly (and treat a missing CLI success line as a failed deploy). The LA fixes were committed as `841d151` (gate 10/10 repository, 257/257 API, 62/62 app, validate ok; CI green) and preview was redeployed: the SWA CLI printed its success line, the API reported `841d151` within 15 seconds, the new frontend was served and anonymous `/api/workspaces` returned 401 — the anomaly did not recur. Remaining before Production: Terry's preview smoke test (B1) and his Google user id for `BT_SITE_ADMINS` (SEC-R10), Production provisioning by Terry, backup-key escrow with a recovery drill (B3), then the PR #1 merge and Terry's Production deploy. Known debt: FIN-R10 (two "current balance" definitions), request rate limiting, dates are UTC ("today" for someone in CEST between 00:00 and 02:00 is the previous day).
- **Clarifications (release readiness of `00aee87`).** "8 of 9 SEC-T fixes verified" means SEC-T2 was only partial; its remaining gap became SEC-U1, fixed in `e00790c` and verified. SEC-U2 ("U2 partial") is closed: its remaining gaps (display names and emails) were fixed as SEC-V2 in `3474418` and verified by the check of that commit, with the control-character part as L5/L6 in `41ec172`.
- **Release readiness of `00aee87` (independent): ready after the listed steps.** Code gates green; hygiene clean (no provider subject or personal address in the tree or history). Findings acted on: D2 the reported commit came from a setting — now stamped into the artifact (`api/build.json`, `version.js`); B3 must follow the Production deploy (a Production archive is needed) and gate real data, not the deploy; D1 the Production deploy requires `git status --porcelain` empty and a local `main`, so the merged agent worktree `.claude/worktrees/` must be removed (or a fresh clone used) before Terry deploys.
- **Terry's decisions (2026-09-13, third round):** Node 22; Production shares Application Insights and the Google OAuth client with preview for now; version-level WORM, 35 days, unlocked, on the Production backups container; the listed limits accepted for the first release (BT-003-05).
- **Production infrastructure (2026-09-13).** Terry ran `provision.ps1 -Environment production -AuthorizedProduction`: `stbudgetprd01` (data) and `stbudgetbkprd01` (backups) created; verified read-only: StorageV2, Standard_LRS, TLS 1.2, HTTPS only, no public blob access, no cross-tenant replication, versioning, soft delete 14/35 days. `configure-settings.ps1 -Environment production -AuthorizedProduction` run by the agent: `BT_ENVIRONMENT=production`, `BT_SITE_ADMINS` equals Terry's subject, storage and backups point at the Production accounts, backup key `prd1` generated (never printed); Google settings were already present (shared client). Key escrowed with `escrow-keys.ps1` to the ignored `.local/escrow/` (key id `prd1`, fingerprint `690c7a6d38e4ac1c`); the drill on a Production archive and moving the file offline follow the Production deploy. `backups` container created with version-level immutability and a 35-day unlocked default policy (verified).
- **Recheck of `841d151` (LA fixes): security gate PASS.** LR1 fixed with a test (`37ea7aa`); LR2 cosmetic and accepted (BT-006-04). CI green on `d0b08cc`.
- **Terry's preview smoke test (B1, 2026-09-13/14), in progress on `539231c`.** The stale edit in a second tab was refused (as designed). Found and fixed (BT-002-04): "New workspace" was hard to find (now also beside the workspace picker); Restore was disabled without explanation (written hint and styled hover tooltip); a merge after deleting one entry and adding another reported no changes — correct, because nothing is ever deleted and merge adds only missing records, but unexplained — so the preview now reports differing records, keeps Restore unavailable when nothing would change, and merge offers "Also bring back entries deleted since this backup" (unticked by default). Own backups show as "You". Terry's display name is empty on preview; to check `/.auth/me` claim types. B1 continues on the next preview deploy.
- **Terry's decision (2026-09-14): build shared expenses (BT-009) BEFORE the first Production release.** Trigger: he created a workspace of kind `group` and was told to add an account first ("if its a shared expense group.. so i really need an account?"). Increment 1, in progress by an implementation agent in a worktree: participants (members and workspace contacts), group expenses with multiple payers and equal/amount/percentage/share splits (deterministic rounding), void/edit with history, settlements (reported → confirmed, disputed), derived balances with pending amounts, suggested and direct settlements, and the brief's EUR 300 dinner rule as an optional same-workspace ledger link (own share as spending, the rest as an advance; repayment as a reimbursement). Pending increments are listed in BT-009 rows. Full security and financial reviews again before Production. Also in progress: TaskTracker's command picker for the workspace dropdown and other selects (Terry: "i want all my apps to have the same look and feel"). Meanwhile preview was verified at `b46baa5` (entries message fix: a new workspace without accounts now says "Add an account first" instead of calling its owner a viewer).
- **Financial recheck of `00aee87`: ready for real money** for the features that exist; FIN-U1..U3 verified and mutation-checked; Lows FIN-W1..W3 accepted (BT-006-04). Both review gates now pass; what remains is Terry's preview smoke test and the release steps below.
- **Process note (2026-09-13).** The `d0b08cc` preview deploy ran while tracked files were being edited for LR1. `deploy.ps1` checks for a clean tree only when it starts and then builds the artifact from disk, so that preview build may have included the uncommitted LR1 change under the `d0b08cc` label. It is superseded by the next preview deploy from a clean commit. **Never edit tracked files while a deploy runs.**

## Checkpoint O — TaskTracker's command picker for the workspace dropdown (BT-004-04, 2026-09-14)

- **Terry's request (2026-09-14):** "why dont we do like we do on the tasktracker.. im all for consistency" (the workspace dropdown with a pinned "+ New workspace"), widened to "use the same component. and any drop down that possible to use, can use that too" / "i want all my apps to have the same look and feel". Done in order: step 1 (the workspace picker) is committed on its own; step 2 (the other dropdowns) follows as separate commits.
- **Where:** built on branch `feature/workspace-picker` in the agent worktree `.claude/worktrees/agent-a8b61420a3f6b4baf`; fast-forwarded into `feature/project-foundation` as `2ccc5a3` (2026-09-14), pushed, gate re-run on the merged tree (10/10, 266/266, 131/131, validate ok) and deployed to preview: the SWA CLI printed "Project deployed", `/api/site-settings` reported commit `2ccc5a3…`, and the picker files served by preview are byte-identical to the artifact.
- **Source:** TaskTracker `T:` `main` `fb24a41`, read with `git show` only. Dependency mapping and deviations: `docs/TASKTRACKER_REUSE.md` ("Command picker and workspace picker").
- **Built:** `app/js/core/popover.js` and `app/js/ui/popup.js` (ported unchanged), `app/js/ui/commandpicker.js` (ported with adaptations A1–A3: hidden select out of the tab order, combobox with an id-based active descendant, keyboard-operable pinned create button; a height cap only when the panel does not fit), `app/js/ui/workspacepicker.js` (O = owner, M = any other role, the exact role spelled out; no G/S; archived kept as "(archived)"; re-choosing the current workspace does nothing, as the old select), the CSS, and the shell: the header is built once and refreshed in place, choosing goes through `store.actions.selectWorkspace`, "+ New workspace" opens `openNewWorkspace({ store, name })` with the search text, the separate button from `7b6d1c2` is gone, and "New workspace…" stays in the account menu. `scripts/dev/screenshot.mjs` gained `--interact wspick|wspickdark|wspicknarrow|wspicksearch|wspickkeys`.
- **Found and fixed during verification:** a one-row list showed a scrollbar (the rounded height cap; seen in headless Edge); choosing the current workspace again would have reset and reloaded every slice (caught reviewing the tests); the test double stopped bubbling when a handler removed its element, which made the Escape test unable to fail (it now fixes the propagation path first, as the DOM does); assertions that handed double nodes to `assert` hung instead of failing (now boolean identity checks).
- **Evidence:** rebased onto `origin/feature/project-foundation` `39ed5e0` (upstream's three commits touched no file of this change except one separate line in this file); on the rebased tree `npm test` 10/10 repository, 266/266 API, 131/131 app (exit 0) and `npm run validate` ok, 21 routes (exit 0); 18 mutants in a scratchpad copy all killed by failing tests (owner letter, archived mark, announcement, spoken role, re-choose guard, the shell's selectWorkspace call, built-once header, name pre-fill, A1, A2, A3 twice, Escape propagation, select-on-move, search, height cap, outside press). Headless Edge 153 against a worktree dev server on 127.0.0.1:4381 (fictional seed): Alice (owner, O) and Bob (member, M) at desktop light, desktop dark and 390 px — panel inside the viewport, no horizontal overflow, no console problems; real key presses: Enter opens onto the search box, Escape closes with focus on the trigger, Tab reaches "+ New workspace", Enter opens the New workspace dialog with focus in its name field, Escape returns focus to the trigger.
- **Not verified:** a real screen reader (NVDA/JAWS/Narrator), Windows High Contrast, touch devices, preview.
- **Tooling debt:** on Windows `scripts/dev/screenshot.mjs` leaves its headless Edge running after `edge.kill()` (the debugging port stays taken); this session stopped only its own Edge processes, verified by their profile path under the worktree.

## Checkpoint P — shared expenses without accounts (BT-009 increment 1, 2026-09-14)

- **Built** by an implementation agent on `feature/shared-expenses` (worktree `.claude/worktrees/agent-adf107eba59d928e2`): `743c1a4` API, model, backup and restore, API tests; `c20a445` Shared expenses view, dashboard and empty states, app tests, fictional seed; `b340064` layout fixes and docs; `f3ce009` merge of `feature/project-foundation` at `2ccc5a3` (two append conflicts in `components.css` and `screenshot.mjs`, both sides kept; `shellworkspacepicker.test.js`'s fake store gained `refreshGroup`, no assertion changed). Key files: `api/_shared/groups.js`, `api/_shared/entries.js` (reversal helper shared with transactions), `api/group/handler.js`, `app/js/core/split.js`, `app/js/ui/views/group.js`. Design and rules: `docs/FOUNDATION_DESIGN.md`, BT-009 rows in `docs/REQUIREMENTS.md`.
- **Rules in brief:** net = paid − share − received + paid out, confirmed payments only, nets per currency sum to zero; reported payments pending, disputed shown apart; suggestions count reported payments as made. The receiving member confirms or disputes (a manager or owner confirms payments to a contact); a payment recorded by its receiver starts confirmed; anything can be voided with a reason and stays listed. The optional own-account link (the brief's EUR 300 dinner rule) is visible to and written by its owner only; others' changes show "needs review". Reporting currency only in this increment. Shared expenses appear for group, trip and household workspaces.
- **Merged** into `feature/project-foundation` by fast-forward (`f3ce009`), pushed. Gate on the merged tree: `npm test` 10/10 repository, 302/302 API, 141/141 app (exit 0); `npm run validate` ok, 22 routes (exit 0). Headless-Edge screenshots (Alice, household workspace, desktop light/dark, 390 px, Add expense dialog with the three-way rounding) with no console problems — after restarting the local dev server (PID 53160 → 87524, verified by command line): the old process predated the new `/api/group` route and answered 404, which first looked like a page error.
- **Preview deployed at `f3ce009`** from a clean tree: "Project deployed" printed; `/api/site-settings` reports commit `f3ce0094…`, environment preview; anonymous `/api/group` 401; `views/group.js` byte-identical to the artifact.
- **Independent reviews of `f3ce009` (2026-09-14).** Financial: **NOT READY** — group arithmetic, rounding, nets and the EUR 300 dinner are correct, but the optional own-account link is wrong in two High cases (two payers on one shared account corrupt its balance; debts cleared by netting stay "owed" and spending is understated) plus a Medium (changing the reporting currency strands open balances while the page says "settled up") and Lows (client-set `links.groupExpenseId`, a pending over-payment claim drives suggestions, the integrity check accepts splits the API refuses, "fewest payments" not minimal). Security: **FAIL, no Critical/High**, privacy and site-admin/owner boundaries held; Medium S1 (a restore brings back an ended personal link, and the next edit writes to the member's private account again), S2 (the "own account" link accepted shared accounts and other people's private accounts while saying "Only you see which account"), S3 (a member can forge a group link on an ordinary entry and lock the linker out); Lows S4–S8 (create-new copies other members' identifiers; a manager confirms a contact payment alone; one side voids a confirmed payment; payments to a viewer can never be confirmed; the integrity check ignores links).
- **Decisions for the fixes (agent, 2026-09-14):** own-account entries are derived per person from the whole group — cash = the cash that person moved, spending = the sum of their shares of every expense whoever paid, outstanding = their group balance — with outgoing repayments recordable; links only to the caller's own private account and marked with their owner; group link keys server-only; restores never take links from an archive; create-new maps other members to "Former member"; the reporting currency cannot change while a group balance is open, and settlements are accepted and shown in any currency with an open balance; the payer never confirms their own payment and a reporter's confirmation is shown as such; after confirmation only the receiver or a manager voids ("confirmation withdrawn"); a viewer may confirm or dispute payments to themselves and manage their own link. Being implemented by an agent on `fix/bt009-review` (from `448da89`); then both reviewers recheck.
- **Also in progress:** dropdown conversion (picker step 2) by an implementation agent in a worktree on `feature/picker-dropdowns` (shared adapter first, one view per commit, Shared expenses last). **Until the fixes land, do not use "Also record what I paid on my account" on preview.**
- **Not verified:** UX, usability and accessibility reviews of Shared expenses; multiple payers and the direct view in a browser; a real screen reader. Known gaps (BT-009-11): someone who paid less than their share has only what they paid recorded as spending; an outgoing repayment cannot yet be recorded on one's own account; multi-currency groups, receipts, offline, imports, payment requests, split presets.

## Checkpoint Q — recovery after an unexpected PC reboot; every dropdown on the command picker (2026-09-14)

- **Recovered state (verified with Git, nothing reset, cleaned or recreated):** `feature/project-foundation` at `55b1ce4`, equal to origin after `git fetch`, only `.claude/worktrees/` untracked. Agent worktrees: `agent-a10427d47f45d3105` (`feature/picker-dropdowns`, 10 commits on `f3ce009`, clean) and `agent-a6d739a7c88fba6e7` (`fix/bt009-review`, 5 commits on `448da89` — `dcbd44e` finding 4/S3, `993b872` finding 6, `3048502` findings 5 and 7, `2e2a077` finding 8, `501f2ff` finding 3 — plus about 670 uncommitted lines in 12 files: the own-account rework and restore/permission fixes in progress). A patch of that uncommitted work and its status were saved to the ignored `.local/recovery/` before anything resumed. Older merged worktrees (`agent-a8b61420…`, `agent-adf107eb…`, `agent-afa1b484…`) and the placeholder `worktree-agent-*` branches are kept. Both agents were resumed from their saved transcripts in their existing worktrees.
- **Dropdowns (BT-004-05) — done and merged.** The agent finished: the adapter `app/js/ui/selectpicker.js` and one commit per view, 12 commits in all (`0b0b8d1`…`6b37823`). 56 selects in 9 views now use the command picker (landing 2, Accounts 4, Merchants 5, My settings 4, Workspace 4, Transactions 10, Bills 11, Planning 8, Shared expenses 8); none left native besides the hidden selects inside the pickers themselves; the colour-aware theme/category pickers, the icon picker and the moon/sun control are unchanged. Categories, accounts, merchants and types now show their colour or icon in lists. Agent evidence: 60 new app tests, 106 of 107 mutants killed (the survivor is caught by the adapter's own test), 21 headless-Edge screenshots with no defects. Merged as `be25017`; gate on the merged tree 10/10 repository, 302/302 API, 201/201 app (exit 0), validate ok (22 routes); pushed. **Preview deployed at `be25017`:** "Project deployed" printed, `/api/site-settings` commit `be25017…` environment preview, `selectpicker.js` byte-identical to the artifact, anonymous `/api/workspaces` 401. Independent UX and accessibility reviews of the pickers are running.
- **Shared-expense fixes (`fix/bt009-review`) — done and merged, rechecks running.** The resumed agent found its uncommitted work intact and finished: 10 commits on `448da89` (`dcbd44e` 4/S3, `993b872` 6, `3048502` 5+7, `2e2a077` 8, `501f2ff` 3, `f53dd6c` 1+2+S2 the per-person ledger model, `2136fe8` S1+S4 restores, `10c0a8d` S8, `9a771da` S5–S7, `1560587` docs incl. BT-009-12). Model (in `docs/FOUNDATION_DESIGN.md`): one link per person and currency in `doc.groupLedgers`, only to the caller's own private account; entries per expense = own share as `expense`, paid beyond it as `advance`, a share not paid as new kind `payable`; confirmed payments = `reimbursement` (receiver) and new kind `repayment` (payer); only entries the caller created are compared or reversed; advances − reimbursements − payables + repayments = the person's group net (the transactions summary reports it as `receivable`); additive, `schemaVersion` stays 1. Agent evidence: 40/40 mutants killed; hand-computed walkthrough (dinner 300 split 4 paid by Alice + taxi 100 split Alice/Bob paid by Bob, then 75/75/25 to Alice: both end with cash 375, spending 125, nothing owed). Merged as `e747d5e`: one conflict in `app/js/ui/views/group.js` resolved by hand (the fixes' own-account wording and layout with the command picker); `app/test/pickergroup.test.js` fixture account marked as the person's own private account and the new checkbox label, assertions unchanged. Gate on the merge: 10/10 repository, 335/335 API, 209/209 app (exit 0), validate ok (22 routes); staged scan clean (21 files); pushed. **Preview deployed at `e747d5e`:** "Project deployed", `/api/site-settings` commit `e747d5e…` environment preview, `views/group.js` byte-identical to the artifact, anonymous `/api/group` 401. Local dev server restarted on the merged code (PID 66460 → 49428, verified by command line). **Independent security and financial rechecks of `e747d5e` are running; until both pass, keep the preview warning: do not use "Also record my part on my own account".** Open question for Terry (from S5): in a group with a single owner, a payment the owner makes to a contact can never be confirmed — allow the owner to confirm it, given contacts cannot sign in?
- **Rechecks of `e747d5e` (2026-09-14).** Security: **PASS WITH LOWS** — S1, S2, S3, S5–S8 fixed (probed: every non-own-private link refused; forged link keys 400; viewers act only on their own payments and link; no other member's account in 14 GET routes × 5 people); S4 partial (create-new still carries other people's subjects on non-group records such as transactions and bills — predates BT-009); new R1 Low (a group ledger link keeps writing after its account is shared) and R2 Info (the new kinds can be entered by hand). Financial: **NOT READY, one new Medium** — all 8 findings fixed and verified with 51 independent hand-computed checks (dinner and taxi netting, voids, corrections, partial payers, stop/relink, withdrawn confirmation, currency lock, fewest payments = 4 on the review's case); every consumer of `payable`/`repayment` correct; new N1 Medium ("Owed to others" can be chosen in quick entry and raises cash with no money received), N2 Low (group-created entries editable on Transactions), N3 Low (a payable shows a money-in arrow). **Being fixed** by the same implementation agent on `fix/bt009-recheck` (from `92b5a45`): payable and repayment become server-only kinds (refused on `/api/transactions`, left out of manual Kind choices), financial fields of group-created entries locked, no arrow for a payable ("No money moved"), sharing an account ends group ledger links to it and every sync requires the caller's own private account, create-new maps every other subject and member reference to "Former member" across all carried records. S5 single-owner contact payments left unchanged pending Terry. Then both reviewers recheck N1–N3, R1 and S4.
- **BT-009 recheck fixes and Terry's decisions — merged (`47617b5`) and on preview; independent rechecks running.** Branch `fix/bt009-recheck` (the agent was stopped twice, by the DNS outage and by the usage limit, and resumed with its work intact each time): N1 `payable`/`repayment` refused on `/api/transactions` create, edit and kind changes, the Kind picker a server-sent allowlist (`ab2cc71`); N2 financial fields of group-created entries locked (`409 shared_expense_locked`), reverse and delete refused (`d6fe27a`); N3 the `no-money-moved` |==| mark with the words "No money moved" in both icon registries (`c8a44ac`, `906a448`); R1 sharing an account ends its group links in the same audited write (`9cbc163`); group settings model with "Anyone in the group can confirm payments", default on, audited with history, every confirmation attributed (`ac51c32`); "Owed-to-others and repayment entries", default Shared expenses only, hand-entered owed amounts always an atomic pair (`409 owed_pair_locked`) (`d945b2f`); S4 residual — create-new maps every other subject and member reference on every record and drops other members' overrides (`e270d2c`); parallel-request and bill-link tests (`b47a835`); the per-person override "Use the group setting / Yes / No" set by owners/managers, viewers capped at payments to themselves, overrides valid only within a membership period (`dded737`); the recheck browser scenario (`f588552`, `e6f6bb8`) and the per-person pickers' labels, found by it (`41645e0`); docs incl. BT-009-16 (`20abbb8`). Agent evidence: 50 mutants, all killed. Gate on the merge: 14/14 repository, 415/415 API, 300/300 app, validate ok; **`npm run e2e` 218 passed, 0 failed** (seven scenarios; recheck 23 checks as Alice, Bob and Carol). **Preview deployed and verified at `47617b5`** ("Project deployed" on the first attempt; `/api/site-settings` commit `47617b5…`; `views/group.js` byte-identical to the artifact). Not verified: R1's share step runs through the API (the Accounts page has no control to share an existing account). A manager set to "No" still confirms payments to contacts under the strict rule, as decided. **The preview warning stands until both rechecks pass.** **Security recheck of `47617b5`: FAIL on one new Medium** — verified: R1, N1/C (hand entry only when allowed, always paired, `owedPairId` not client-settable), N2, settings permissions (owners/managers only; site admin 404; viewer 403), audit and history, override privacy (only owners/managers see the per-person list; Carol, Eve and Dave see no settings card in real browsers), confirm-by-anyone writes nothing to the receiver's account and is attributed, viewers capped, removed/rejoined overrides dropped, 15 malformed settings requests refused; `npm test` and `npm run e2e` 218/218 re-run by the reviewer plus its own five-user browser script. New: **M1 Medium** — saving several per-person overrides at once stores only the last while history and audit record all (`api/_shared/group-settings.js:142-147`; reachable from one Save in the UI; the existing test sent two but never asserted both were stored); **L2 Low** — a create-new copy keeps another member's private account id at `counterpartAccountId` on a transfer (`backup.js:329-333`); **L3 Low, pre-existing since `04f6bf9`** — the shared side of a transfer returns the other member's private account id unmasked (`ledger.js:230`). All three sent to the implementation agent on `fix/bt009-recheck2` (from `bae6286`). **Financial recheck of `47617b5`: NOT READY on one new Medium** — verified with independent values in the API and real browsers: N1 (hand entry refused by default; balance unchanged), hand-entry pairs (balance unchanged, spending and receivable exact, reversal reverses both, corrections refused), N2 (18 financial-field changes refused), N3 arrows and |==|, confirm-by-anyone amounts, the dinner+taxi netting and the brief's EUR 300 dinner entered through the browser (Alice 1000 → 700 → 925, spending 75, income 0, receivable 0), schemaVersion. New: **F1 Medium** — with the default "anyone can confirm", a payment the receiver disputed can be confirmed by its payer or any member, erasing the dispute from balances; **F2 Low** (Medium once the UI can share an account) — entries left on an account that is no longer the person's own private account are frozen, so later corrections leave their totals wrong (delete path: recorded nowhere, no needs-review); **L3 Low** — backups refuse unknown setting values that reads accept; **L4 Low** — the share of something someone else paid shows ↓ although no cash moved. Decisions sent to the same agent (before settings b–e): F1 → a new group setting "Who can settle a disputed payment", default the receiver (a manager or owner for a contact), and any confirmation over a dispute visibly marked; F2 → needs-review for entries on a former account, the owner's update reverses what it may and records the current position on the new account, and `receivable` counts only the viewer's own private accounts; L3 → tolerant integrity check; L4 → |==| with "Paid by someone else" instead of an arrow.
- **Workspace settings (a), (f)–(j) — merged (`eefd115`) and on preview; security and UX/accessibility reviews running.** Branch `feature/workspace-settings` (`9dcfc60` model, route, card and backup check; `bb71244` budgets; `6667d4c` bills; `9daa4ba` editing others' entries; `6e4a337` shared lists; `2eedae5` member restores; `99cbc5d` Shared expenses on/off; `543376a` e2e `settings` scenario; `1b35ecb` a stale "off" message; `9cf7b3a` docs, rows BT-011-07..13). Every default is today's behaviour; owners and managers change them ((h) owners only), with history and audit in the same write. (a) Shared expenses on/off per workspace — default by kind (group, trip, household on; personal off), the site module switch now the upper bound, every `/api/group` route 403 `shared_expenses_off`, nav, page and dashboard summary follow one rule (households now get the dashboard summary too); (f) members may change others' entries on shared accounts (also covers bills — question 1 to Terry); (g) who manages shared lists; (h) member restores 0–3 a day and allowed kinds; (i) the workspace budget period and week start now used as defaults, "custom" refused, backdating "Only after confirming" / "Never"; (j) due-soon days and the date for a late bill. Agent evidence: 29 API and 14 app tests, 35/36 mutants (the survivor equivalent). Gate on the merge: 14/14 repository, 444/444 API, 314/314 app, validate ok; **`npm run e2e` 226 passed, 0 failed** (new `settings` scenario with three browsers). **Preview verified at `eefd115`** (the first deploy attempt hit "Could not load StaticSitesClient metadata" — a network blip; the retry printed "Project deployed" and `/api/site-settings` reports `eefd115…`). Behaviour changes to note: personal workspaces now refuse `/api/group` by default until Shared expenses is turned on there; weekly budgets sent without a start date start on the week-start day. Not verified: an interface for the site module switch (API only), members have no restore screen (so (h) applies through the API), a Shared-expenses toggle racing a write already in progress.
- **BT-009 recheck round 2 and shared-expense settings (b)–(e) — merged (`53cf181`) and on preview; independent security and financial rechecks of `53cf181` running.** Branch `fix/bt009-recheck2` (from `bae6286`, with `eefd115` merged in): M1 several per-person rights saved together are all stored and "Settings saved" only when the server kept every value (`6792683`); L2 a create-new copy clears the counterpart id of a transfer leg whose other account stays behind (`919ffc2`); L3 a transfer's other account is identified only to someone with view-balances on it (`dd5b111`); F1 new group setting "Who can settle a disputed payment", default the receiver (a manager or owner for a contact), confirming no longer settles a dispute, "Confirmed over a dispute by X" in view, history and audit (`1693074`); F2 parts left on an account no longer the person's own private account show "needs review" and move when they choose a private account, entries on a removed or unreachable account left and marked, `receivable` counts only the viewer's own private accounts (`c4d189e`); tolerant backup integrity for unknown well-formed setting values (`12bee63`); L4 a share someone else paid shows |==| "Paid by someone else" (`97450cf`); settings (b)–(e) in one commit — default split, payer and who shares (server-applied, with personal defaults in a "Your own defaults" card), who may correct or void, who may withdraw or dispute and whether the receiver's own record confirms, whether suggestions count reported payments, and a personal balance view (`48c2c62`); browser checks, docs (BT-009-17) and the group card following the workspace card's pattern (`75722d6`). Agent evidence: 45/45 mutants killed; N2 lock still holds with (f) "Any entry". Gate on the merge: 14/14 repository, 469/469 API, 322/322 app, validate ok; **`npm run e2e` 232 passed, 0 failed** (8 scenarios); **preview verified at `53cf181`**. Noted by the agent: moving a part off a now-shared account moves its cash effect to the new account; a closed account blocks the move and asks to be reopened; personal defaults apply across all of a person's groups. **Security recheck of `53cf181`: PASS WITH LOWS** — M1, L2, L3 fixed; F1, F2, settings (b)–(e), server-applied defaults (no private contact or account can enter a record), Shared expenses off on every group action, and (f) with the N2 lock all hold; 475 parallel GETs across five users and five browsers showed no leak. New Low R3-1: an owner or manager who paid could settle a dispute over their own payment under two non-default settings (payer check missing on the dispute path). Info → decided to fix: R3-2 a payer could re-report a disputed payment and confirm it under "anyone can confirm" — a new report between the same two people while a dispute is open is now marked "Reported again after a dispute" and confirming it counts as settling that dispute; R3-3 the shared side of a transfer made from a bill may show another member's private bill id in `links` — link ids only when the viewer can see the linked record. Sent to the implementation agent on `fix/bt009-recheck3` (from `84c2af0`). **Financial recheck of `53cf181`: READY WITH LOWS** — F1 (each option, with nets and own accounts following only real confirmations), F2 spending and outstanding (share and delete paths: after correcting the dinner to 200 spending 50.00 / outstanding 75.00; voided 0.00 / −75.00), L3, L4 (marks and arrows per kind in the browser), (b) server defaults equal explicit equal splits incl. residuals (EUR, JPY, KWD), (d), (e), (f) with the N2 lock, (i) weekly/two-weekly periods and week starts with independent dates, (j) late-bill dates without double recording, the EUR 300 dinner and the dinner+taxi netting in real browsers — all verified with hand-computed values. New Lows: **N-1** moving a part off a now-shared account also moved real cash entries (both account balances off by 225.00; spending/outstanding right; not reachable from the UI yet) → cash stays on the account it used, only non-cash entries move, and the own-account invariants count the person's own group-linked entries wherever they are; **N-2** a person who can see but not write a former account had spending counted twice → such entries are excluded from their totals; **N-3** "Keep who owes whom" counted an unconfirmed payment in full → same cap as suggestions; **N-4** payer settling a dispute under an option → covered by R3-1, and the "anyone" option says it includes the payer. Notes → fixes: personal defaults applied on the server too; "Never" backdating also refuses new budgets that start before the current period (sent to the workspace-settings agent).
- **UX/accessibility review of the workspace settings card (`eefd115`): PASS WITH FINDINGS**, nothing critical; the six settings and related forms verified in real browsers (8/8 official settings checks plus the reviewer's own 5-check scenario; names, tab order, focus after save, contrast 6.25:1+, no overflow at 390 px or 320×256). Medium: save errors look like help text and nothing is marked invalid; the card is 2–3 screens long with full-width controls; no "Undo changes" and unsaved edits vanish silently; confusing wording (e.g. "Members may change other members' entries: Only their own entries"). Lows: a 61-row list for due-soon days, the read-only view, inverted heading sizes, member restores are API-only, no way back from the "off" page, forms apply defaults silently, the group card differs. Being fixed by the same agent on `fix/workspace-settings-ux` (from `53cf181`) in BOTH cards, with the reviewer's proposed wording. Agent decisions (Terry may overrule): members and viewers can see settings history read-only; On/Off settings stay command pickers for consistency.
- **Security review of the workspace settings (`eefd115`): FAIL on one Medium**, no Critical/High — no other member's private account readable or writable through any setting, viewers never gained a write, site admin and outsiders 404; (a) gate, (g), (h) (member restore scope, limits, parallel replaces), (i) verified in real browsers with five users and parallel calls; 33 hostile settings payloads refused or no-op. **M-1 Medium:** with (f) "Any entry" a plain member could change, pause or end a bill that transfers money into another member's private account (bills checked only the source account; managers could already do this before the settings) — decided as a privacy invariant, fixed for members AND managers: changing a transfer bill needs rights on both accounts. **L-1** backups refuse unknown well-typed workspace setting values that reads accept (same issue as group-settings L3) → tolerant check; **L-2** the Shared expenses on/off gate is checked before, not inside, each write → re-check inside the write; **L-3** Transactions offers Edit/Delete on a transfer the server refuses → flags use the both-sides rule. Info: `__proto__`-only bodies are a 200 no-op; member recovery points stay capped at 6 a day (to follow the owners' setting); while Shared expenses is off, owner restore previews still count shared records (acceptable). Sent to the agent on `fix/workspace-settings-ux`.
- **UX review of the pickers at `be25017`: PASS WITH FINDINGS** (nothing lost from native selects). Medium: an open list does not follow scroll or resize; on touch every data list opens on its search box and raises the keyboard even for 3 items. Lows: closed-trigger keys, the icon picker's older trigger style beside the new ones, a search hint on locked fields, "Choose to account…" wording, a latent focus target after navigation. Decisions sent to the picker fix agent (`fix/picker-a11y`): reposition on scroll/resize/keyboard (close if the trigger leaves the viewport); search only above 12 items and, on a coarse pointer, open on the list; letters and ArrowUp open a closed trigger; the icon/theme picker triggers match the command-picker trigger's size and style inside form fields (behaviour unchanged); no hint on disabled triggers; natural placeholders; focus after navigation skips hidden selects.
- **Multi-user real-browser harness (BT-004-06) — merged (`df29c86`).** Built by an implementation agent on `feature/browser-harness` (`64f85c8`, `858a475`) after Terry's instruction to test in real browsers on localhost with several fake users. `npm run e2e` (not part of `npm test`; needs Edge) starts its own dev server on a free port with fresh fictional data under `.local/e2e/<run>/` (`BT_DEV_DATA_ROOT`, must be inside `.local/`), opens one headless Edge per user (alice owner, bob member, carol viewer, dave site admin, eve outsider) at once, has a per-user API client for parallel requests, and stops only its own processes (PID re-read before killing, profile-path match; the same cleanup now in `scripts/dev/screenshot.mjs`). Scenarios: privacy, shared, concurrency, guards, dropdown. The generator's role text now tells every role to verify UI and multi-user flows with it. Gate on the merge: 14/14 repository, 335/335 API, 209/209 app, validate ok; **`npm run e2e` on the merged tree: 138 passed, 0 failed, 0 skipped (exit 0)** — privacy across all five users in API and UI, a three-person expense and payment seen in each browser with hand-computed balances, parallel confirms/creates/edits (one winner, 409 or idempotent replay, nothing duplicated), group link keys refused on transactions, bills and group routes, and the command picker with real key presses in a dialog. The three running agents were told to extend it for their changes.
- **Command picker review fixes (BT-004-07) — merged (`69133a1`) and on preview.** The picker fix agent (`fix/picker-a11y`, stopped once by the DNS outage and resumed with its work intact) fixed all 7 accessibility and 7 UX findings: full-height panel at 400 % zoom and hints hidden on short screens (`215b8c7`); focus returns to the trigger after a press on something unfocusable (`467a3df`, `aa59777`); a polite status region announces result counts and "Nothing matches" (`a341eeb`); inside a dialog the panel lives in the dialog (`f01ebc6`); the panel follows scroll, resize and on-screen-keyboard changes and closes when its trigger scrolls away (`60c991b`); the trigger is a select-only combobox named by its label with value, instructions, required and error exposed (`453b4c7`); native keys (ArrowUp/letters open, multi-letter type-ahead, PageUp/PageDown, Space, Home/End in the search box) (`4927610`); a search box only above 12 options and, on touch screens, lists open on the list so no keyboard appears unasked (`0389abd`); icon and colour pickers in form fields match the trigger's size and style (`db6f586`); no hint on disabled triggers (`a0686b8`); natural empty-field text (`0d7216f`); focus after navigation skips hidden selects (`daf083e`, whose first version crashed every view in a real browser and was fixed by `65796c5` before any push); no one-frame jump with reduced motion (`a5123bd`, found by `npm run e2e`). Agent evidence: 39/40 mutants killed (the survivor removes only one of two duplicate Tab guards), 34/34 own browser checks. Gate on the merge: 14/14 repository, 366/366 API, 282/282 app, validate ok; **`npm run e2e` 180 passed, 0 failed** (dropdown scenario 29 checks incl. 400 %, 390×600 and touch). **Preview deployed and verified at `69133a1`** ("Project deployed" on the first attempt; `/api/site-settings` commit `69133a1…`; `commandpicker.js` byte-identical to the artifact). Worth porting back to TaskTracker (not modified here): everything except the 12-option search threshold and the form-row trigger style; details in `docs/TASKTRACKER_REUSE.md`. Not verified: a real screen reader, Windows High Contrast, a physical phone.
- **Command picker accessibility review of `be25017`:** partial, nothing critical — serious: at 400% zoom the list shows no option; moderate: an outside press drops focus out of the dialog, no announcement of results or "nothing matches", the panel sits outside the `aria-modal` dialog (VoiceOver risk, unverified); minor: the panel drifts on scroll, the trigger is a button rather than a combobox, some native keys missing. Being fixed by an implementation agent on `fix/picker-a11y` (from `e747d5e`); the UX review of the pickers is still running and its findings go to the same agent.
- **Terry's feature check against a split-costs app (2026-09-14) and his rule:** "add the feature only if it dont exist… it can look different or be presented another way; we can work on look and feel after". Already present (no duplicates to be added): who paid (several payers), split equally/amounts/percentages/shares with per-person amounts, people without accounts (contacts), balances per person, who owes whom and how much (Settle up: fewest payments or keep who owes whom), settling each debt (the per-row "Record payment", then confirmation). Genuinely missing, to add after the fixes: expenses in another currency with a conversion rate in a group (BT-009-13); a receipt photo on an expense (BT-009-14, with receipts); a contact who later joins taking over their shared-expense history (BT-009-15 — verified absent: invitations know nothing of contacts, `api/_shared/people.js` resolves `contact:` and `member:` separately).

## Checkpoint R — recheck rounds 3–4, four new features, all merged onto `feature/project-foundation` (2026-09-14/15)

Session interrupted several times overnight (a usage-limit reset and general network slowness); every agent resumed from its saved work with nothing lost. Eight branches merged in sequence, each with its own gate and, at the end, one combined multi-user browser run.

- **BT-009 security recheck round 3 (`fix/bt009-recheck3`) — merged as `ba7f344`.** R3-1 payer excluded from settling a dispute except under "Anyone who can confirm payments"; R3-2 a payment reported again while a dispute is open is marked "Reported again after a dispute" and settling it follows the dispute-settling rule; R3-3 a bill's or shared expense's id in `links` is shown only to someone who can see the linked record (new `fromSharedExpense` flag keeps the N2 lock working without revealing ids). Merge conflict in `api/group/handler.js` (the new `confirmBackdated` variable vs. the settings-card branch's `mutateGroup` wrapper) resolved by combining both. Full independent security recheck of `41494d1` (before this merge): **PASS**, no findings of any severity, verified with fresh five-user probes plus 826 tests and two full `npm run e2e` runs.
- **BT-009 financial recheck round 4 (`fix/bt009-recheck4`) — merged as `ba7f344` (same commit).** FA-1 a first link that would backdate confirmed cash entries onto the newly linked account now needs `confirmBackdated: true`, with the count and total shown first (`409 confirm_backdated` otherwise); FA-2 the Remove-account dialog says when an account is still linked in Shared expenses; FA-3 a "Shared expenses needs your attention" notice appears on the Dashboard whenever any of the signed-in person's linked currencies needs review, not only inside Shared expenses. Full independent financial recheck of `41494d1` (before this merge): **READY WITH LOWS** → exactly these four findings, all now fixed.
- **Remove an account (BT-006-05) — merged as `3d59154`** (combined with the settings-card merge below). A Remove action on the Accounts page (empty accounts: one-step confirmation, reason pre-filled "Created by mistake"; accounts with entries: explained, with "Close instead"), a "Removed accounts" list with "Bring back". The underlying soft-remove already existed in the API; only the UI was missing.
- **Settings-card UX fixes, M-1/L-1..L-3, Delete workspace (`fix/workspace-settings-ux`) — merged as `3d59154`.** Usability fixes to both the workspace and shared-expense settings cards (clear error styling, shorter card with disclosures, "Undo changes", plainer wording, a number field for due-soon days, settings history visible read-only to members, a way back from the "off" page). Security fixes: M-1 a transfer bill into another member's private account can no longer be changed by anyone but that account's own people, for members and managers alike; L-1 the workspace-settings backup check is now tolerant of unknown well-formed values (matching the group-settings fix); L-2 the Shared-expenses on/off gate is now re-checked inside the write, not only before it; L-3 Transactions no longer offers Edit/Delete on a transfer the server would refuse. New: **Delete workspace** for owners (BT-001-06) — "Delete workspace" with a typed-name confirmation, recoverable from "Deleted workspaces" in My settings, and the server now refuses every route for a deleted workspace (previously only status-flagged). Merge conflict in `scripts/dev/e2e/run.mjs` (both branches registering a new scenario) resolved by combining both. Gate after this merge: 513 API, 369 app; `npm run e2e` 244 passed.
- **Move a transaction to another account (BT-006-05) — merged as `2cf9260`.** `POST /api/transactions?action=move`: needs the change right on the current account and the create right on the destination, same currency only, refused for reconciled/reversed/shared-expense-locked/owed-pair entries with a plain reason shown as a disabled button with a tooltip, one leg of a transfer re-points atomically with the other leg's counterpart. Found and fixed in the same round: moving one leg of a transfer needs the right on **both** legs (matching the L-3 fix above), merged into one combined check. Merge conflict in `api/transactions/handler.js` resolved by combining the both-sides-of-a-transfer check with the move logic. One stale test (a move-entry test creating a backdated budget without the new `confirmBackdate` flag from the settings-card merge) fixed in `680783e` — not an application defect. Gate after this merge: 532 API, 376 app.
- **Editable account fields (BT-006-06) — merged as `03ab6b4`.** The Edit-account dialog now exposes institution, account number, opening balance and date, icon, notes, and the full set of loan/credit-card terms — all of which the API already accepted but the dialog never showed. Type and currency stay fixed at creation (shown read-only with an explanation); changing either after entries exist would corrupt history. Merge conflicts in `scripts/dev/e2e/run.mjs` and `README.md` (scenario list) resolved by combining. Gate after this merge: 545 API, 393 app.
- **Site-admin usage dashboard (BT-012-01) — merged as `704c073`.** A new "Usage" page, reachable only by a site administrator (in the account menu, since a site admin is usually not a member of any workspace), showing user counts, sign-ins per day, last-active times and workspace counts by kind/status — never any account, balance, entry, budget, merchant or workspace content (checked by a test that asserts a list of financial field names never appears in the response). Storage: a new `site/usage.json` document, touched once per UTC day per person from `GET /api/me`, corrupt-refusing and ETag-guarded like every other document; a recording failure is swallowed so it can never break sign-in. Merge conflicts in `scripts/dev/e2e/run.mjs`, `docs/REQUIREMENTS.md` and `app/js/ui/shell.js` (the nav-hiding condition: combined the Delete-workspace branch's `openWorkspaces()` archived-filter with this branch's new `analytics` route exception) resolved by combining. Final gate: **14/14 repository, 554/554 API, 403/403 app, validate ok (23 routes)**.
- **Full `npm run e2e` on the final merged tree (`704c073`): 303 of 304 passed.** The one failure (`accounts` scenario, `409 workspace_rate`) is a known, understood test-corpus artifact, not a product defect: with 13 scenarios now registered, the ones that run before `accounts` in one shared isolated server use up the test user's daily 10-new-workspaces safety limit (`store.js` `MAX_CREATIONS_PER_DAY`, itself a real protection, SEC-T4 — its env override can only *lower* the limit, never raise it, so it was deliberately left untouched). Confirmed by re-running `accounts` alone on its own fresh server: 5/5 pass, twice. **Tooling debt to fix later:** spread workspace creation more thinly across scenarios (reuse seeded workspaces, as the recheck-4 agent already did for one case) so the full suite stays green without relying on this explanation.
- **Preview deployed and verified at `704c073`** (the actual deploy gate, `npm test`, is unaffected by the e2e note above). All of the above is on preview; **none of it is in Production**, which still runs `31b17b1`. Until a new release: keep avoiding "Also record my part on my own account" and hand-picked "Owed to others" in Production (both fixed on the feature branch only).
- **Not yet done:** an independent security and financial review of everything merged in this checkpoint (recheck rounds 3–4 were reviewed before their own merge, but Remove-account, Delete-workspace's server-side unreachability change, Move-entry, editable account fields and the usage dashboard have not had a dedicated independent pass yet). Recommended before the next Production release.

## Checks run this checkpoint

- `node --test test/*.test.cjs`: 7 passed, 0 failed (Node v22.23.1).
- Scanner rules over all 49 tracked and untracked non-ignored files: 0 findings, after fixing 3 self-inflicted false positives in the scanner and its tests.
- `gitleaks git` over the full history: no leaks, 10 commits. `gitleaks dir` flagged only gitleaks' own README example strings in the ignored `.local/bin`; those vendor docs were then deleted.
- Python tomllib: all 9 TOMLs parse (8 read-only, 1 workspace-write).
- The staged scan, commit and push result are recorded in the handoff message and PR, not here; confirm with `git log origin/feature/project-foundation -1`.

## Unfinished work and blockers

- **Application status.** The API (21 routes), the frontend shell and the preview deployment exist; no real financial data may be used until Terry authorizes Production. The feature modules listed as Planned or Partial in `docs/REQUIREMENTS.md` remain.
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

Checkpoints B–N are done or in progress (see above). Keep the CI job names `secret-scan` and `foundation-tests`; branch protection requires them.

**First Production release, in order** (owner in brackets):
0. [agent] Act on the security and financial reviews of `f3ce009` (BT-009 and the picker); merge the dropdown conversion after its gate; UX/accessibility review of Shared expenses and the pickers; redeploy preview and verify; then a release-readiness audit of the final head. Terry: save his name in My settings on preview and try Shared expenses.
1. [agent] Done at every preview deploy since `841d151`: verify `app.commit` equals the deployed commit and the CLI printed its success line.
2. [Terry] **B1** signed-in smoke test on preview (workspace, account, transaction, a stale edit refused, backup, restore preview, merge restore; ideally a second fictional account to confirm private-account denial).
3. [agent] Merge PR #1 (one-time authorization) once checks pass on the final head; record the merge SHA.
4. [Terry] Remove the merged agent worktree (`git worktree remove .claude/worktrees/agent-afa1b4843db192131`) or use a fresh clone; switch to `main` tracking `origin/main`; `git status --porcelain` must be empty.
5. [Terry] Add the Production redirect URI to the shared Google OAuth client; run `deploy.ps1 -Environment production -AuthorizedProduction` (typed confirmation). A missing "Project deployed" line means the deploy failed.
6. [agent + Terry] Verify separately: `/version.json`, `/api/site-settings` (environment production, the merge commit), anonymous 401s, security headers, only Google sign-in, Terry gets the site-admin role, no preview data.
7. [Terry, then agent] **B3** create a fictional workspace and a backup in Production; the agent downloads the archive into `.local/` and runs `scripts/recovery/drill.cjs` with the escrowed keys; record the result; Terry moves the escrow file offline.
8. [Terry] A Production failure alert, or accept it as pending. Only then real data. DNS stays a separate authorization.

**After the release, in order:**

1. **BT-011-05 follow-up** — apply the independent security review of the icon catalogue and upload; a UX/accessibility pass over the icon picker and the Icons for types card in a real browser; redeploy preview and verify `app.commit`.
2. **BT-001-05 remainder** — (restore history and lifecycle UI are done) remaining lifecycle states for budgets, members and workspaces; implement ADR-003; idempotency ruling (A8); backup retention/immutability (A11/A12, infrastructure, needs Terry).
3. **BT-011-02 Tiptap editor** (archaeology of `T:` `main` first), then receipts/attachments, imports and reconciliation.
4. **BT-009 shared expenses and settlement, BT-010 trips and currency** (icons for trips and trip accounts follow), debt planning, goals and alerts.
5. **BT-012 reports and exports** (icons in reports, legends and exports follow), site settings UI, offline, rate limiting, scheduled backups and Key Vault, the remaining 13 TaskTracker palettes.
6. **Needs Terry:** signed-in checks on the preview need Terry's own Google sign-in (the redirect URI is added); any Production, DNS or Staging decision.

## Checkpoint S — deployment process consolidation (BT-003-05, 2026-09-16)

**Terry's instruction (2026-09-16):** one supported deployment entry point, `.\deploy.ps1`, adapted
from TaskTracker's proven structure; no other script, CLI command or workflow may bypass it; do not
deploy Production while implementing this; Preview may be exercised once all gates pass, to prove
the consolidated path works end to end. Built by an agent in an isolated worktree
(`.claude/worktrees/agent-aff6b4659f1315364`, branch `feature/deploy-consolidation`, based on
`origin/feature/project-foundation` at `3a79693`).

**Found (before changing anything).** BudgetTracker's `deploy.ps1` (72 lines) had every rule
inline — tenant check, clean-tree/branch checks, the typed production confirmation, the
`npm test`/`npm run validate` gate, the artifact build and the `swa deploy` call — with nothing
separately invocable or unit-testable, no automated post-deploy health check (it said "now verify
the running application separately" and stopped), no secret-scan step in the deploy path itself,
and no structured receipt. `-SubscriptionId`/`-TenantId` were Mandatory PowerShell parameters, so
every documented `deploy.ps1 -Environment preview` command line in this file and in
`docs/REQUIREMENTS.md` was already incomplete — real deploys always also passed the ids, supplied
by hand. TaskTracker's own `deploy.ps1` is a thin wrapper over a Node engine
(`scripts/deploy/engine/`, `cli.js`, `operations.js`, `environments.js`, `gateevidence.js`, …) that
enforces every rule identically whether called via `deploy.ps1` or the engine's CLI directly — read
read-only via `git -C T:/repos/TaskTracker show main:<path>`, nothing copied. Full inventory of
every pre-existing path that could reach Azure (`deploy.ps1` itself; manual `az`/`swa` commands by
an operator with Azure access, which no script can close; `build-artifact.mjs` + a manual `swa
deploy`; `provision.ps1`/`configure-settings.ps1`, which never ship code but were not clearly
distinguished from "the deployment process" in prose; no CI deploy path) is recorded in
`docs/DEPLOYMENT.md`, "Deployment path inventory and TaskTracker comparison".

**Built.** `scripts/deploy/engine.mjs` (new): the sole implementation of every deployment rule —
`resolveTarget` (explicit flags, else the gitignored `.local/deploy-target.json`, else fail closed:
no environment default, nothing inferred from ambient `az` context), `checkGitState` (clean tree,
named branch, production only on `main` equal to `origin/main`), `checkProductionConfirmation`
(typed Static Web App name, required every time, never suspended — a deliberate divergence from
TaskTracker's own `deploy.ps1`, which currently suspends its interactive prompt "for the beta
development phase"; recorded as a "do not copy" in `docs/TASKTRACKER_REUSE.md`), `verifyIsolatedSettings`
(the target environment's application settings are complete and its data/backup connection strings
differ), `evaluateHealth` (the live `/version.json` and `/api/site-settings` must report the exact
deployed commit and the target environment before a deploy counts as healthy), and the `runDeploy`
orchestrator tying them to real `git`/`az`/`npm`/`swa`/`fetch` calls through an injectable `io`
adapter — real by default, faked in tests, so the tests never touch a real subscription, the real
Git remote or the network. `scripts/deploy/deploy.ps1` is now a ~55-line interface: it parses
PowerShell flags, resolves `.local/deploy-target.json` for anything not passed explicitly, and
delegates to `node scripts/deploy/engine.mjs`, returning its exit code unchanged (interactive
production confirmation happens inside the engine via `readline`, sharing the console PowerShell
already gives the child process). No flag anywhere skips a gate — there is no `-SkipTests` or
`-SkipLiveCheck`, unlike TaskTracker, because Terry's instruction requires the complete gate every
time. `scripts/scan-staged.cjs` now exports `gitleaksBinary` (previously internal) so the engine's
deploy-time secret scan (`gitleaks dir` over the **built artifact**, not just the staged diff) uses
the same binary discovery as the pre-commit hook; preview warns and proceeds if gitleaks is not
installed locally (CI's `secret-scan` job remains the enforced layer), **production refuses
outright** if gitleaks is unavailable. `scripts/deploy/provision.ps1`,
`scripts/deploy/configure-settings.ps1` and `scripts/build-artifact.mjs` gained a one-line "NOT A
DEPLOYMENT SCRIPT" note each; their behavior is unchanged.

**Guards against another path, and the tests proving them (`scripts/deploy/test/engine.test.mjs`,
25 tests, added to `npm run test:repo`).** Structural: `scripts/deploy/engine.mjs` is asserted to be
the only tracked, non-documentation file containing the SWA CLI's `"swa", "deploy"` invocation
(grepped over `git ls-files`); `deploy.ps1` is asserted to contain no `az`/`swa` calls of its own,
only the delegation; no `npm` script in `package.json` performs a deploy; the engine's Git adapter
is asserted to expose no `push`/`merge`/`commit` capability. Behavioral: production without
`-AuthorizedProduction`, or with a wrong typed confirmation, is refused before the fake
`deployArtifact`/`test`/`setCommit` are ever called; preview never prompts for or checks a
production confirmation, and passing `-AuthorizedProduction` on a preview deploy has no effect
(Preview authorization is never Production authorization); a dirty tree, a non-`main` production
branch, HEAD not equal to `origin/main`, a tenant mismatch, a missing Azure resource, incomplete or
non-isolated application settings, a failing test/validate/build gate, and a secret-scan finding
each refuse before upload, with the fakes proving no Azure call happened; a full successful run
calls the gates and the upload exactly once and produces a receipt; an upload that succeeds while
the health check fails is reported as `uploaded: true, healthy: false` (exit code `2`), never
folded into a single false "success".

**Evidence.** `npm test`: **39/39 repository tests** (was 14; +25 new engine tests), **554/554 API
tests**, **417/417 app tests**, exit 0. `npm run validate`: ok, 23 routes, exit 0. Staged-content
scan (`node scripts/scan-staged.cjs`) over the 5 changed/added files: clean (gitleaks itself is not
installed on this machine — `.local/bin` and PATH both checked — so only the custom path/content
rules ran; CI's `secret-scan` job remains the enforced layer for the actual commit). `git config
core.hooksPath` confirmed set to `.githooks`.

**Not run: a real Preview deploy.** Exercising `.\deploy.ps1 -Environment preview` end to end needs
either `.local/deploy-target.json` or explicit `-SubscriptionId`/`-TenantId`. This agent's role
instructions say not to inspect credentials or local configuration, and `.local/deploy-target.json`
lives only in Terry's own checkout (confirmed to exist there by directory listing only — its
contents were never read). No subscription or tenant id was read or used. **Terry or the
coordinator should run `.\deploy.ps1 -Environment preview` from a normal checkout** (not an agent
worktree) to prove the consolidated path against the real preview environment; expect the new
target block, the automated health check against the live site, and the deployment receipt in the
output, in addition to everything the old script already showed.

**Files touched.** New: `scripts/deploy/engine.mjs`, `scripts/deploy/test/engine.test.mjs`.
Rewritten: `scripts/deploy/deploy.ps1` (thin wrapper). Small edits: `scripts/scan-staged.cjs`
(export `gitleaksBinary`), `scripts/deploy/provision.ps1`, `scripts/deploy/configure-settings.ps1`,
`scripts/build-artifact.mjs` (one-line "not a deployment script" notes), `package.json`
(`test:repo` glob). Docs: `docs/DEPLOYMENT.md` (new "Deployment path inventory and TaskTracker
comparison" section; rewrote "Deployment procedure"; updated "Residual risks"), `docs/REQUIREMENTS.md`
(BT-003-05 row), `docs/TASKTRACKER_REUSE.md` (new "Deployment: thin interface over a shared engine"
section), `README.md` ("Development and release", "Deployment" bullet), `CLAUDE.md` (§6),
`AGENTS.md` ("Never" list), this file. `docs/RECOVERY_RUNBOOK.md` was read and left unchanged — it
documents `scripts/recovery/*` (a different, recovery-operator concern) and never referenced
`deploy.ps1`.

**Not done / left for Terry.** The Preview run above. A pre-existing, unrelated defect noticed while
reading `docs/REQUIREMENTS.md`: two different rows are both labelled `BT-003-05` (the release
decisions row and the deployment-workflow row); not touched here, flagged for a future cleanup pass
since it was not part of this task's scope. Whether `deploy.ps1`'s optional `-SubscriptionId`/
`-TenantId` parameters (now falling back to `.local/deploy-target.json`) should also validate the
file's shape more strictly (e.g. reject extra unknown keys) — left permissive, matching this
repository's existing "tolerant of unknown well-formed values" convention elsewhere
(`docs/FOUNDATION_DESIGN.md`, findings L-1/L-2/L-3).

## Checkpoint T — BT-013 Design Gallery: 20 layout-theme concepts for Terry's review (2026-09-16)

**Terry's design brief (2026-09-16, verbatim in the task).** A 20-concept, genuinely-distinct
workspace layout gallery for his review, from which he will choose 10 to permanently implement.
Explicit separation: this checkpoint is the REVIEW deliverable, not the permanent 10-layout
implementation — "wait for my selection before permanently adding the chosen 10." Layout, palette
and appearance mode stay three independent settings; palette and mode reuse the existing
themepicker/daynight controls verbatim; the Gallery must never expose real financial data and must
not be reachable as an unprotected surface. Built by an agent in the isolated worktree
`.claude/worktrees/agent-a3aaecdbb0a7ae8cf`, branch `feature/layout-gallery`, based on
`origin/feature/project-foundation` at `3a79693`, merged with the branch's later tip (`1ddc2c7`,
the deploy-consolidation work) before this checkpoint.

**Architecture (the point of the exercise: reusable, not 20 mockups).** `api/_shared/layouts.js`
holds the 20 concept manifests as METADATA AND COMPOSITION PARAMETERS ONLY (name, tagline,
direction, what is genuinely distinct, audience, strengths, tradeoffs, accessibility notes, and
five composition axes: `navStyle` top/rail/sidebar/sidebar-right/command, `density`
spacious/comfortable/compact/ultra-compact, `dashboardPattern` one of twelve, `cardStyle`,
`chartEmphasis`) plus `REAL_LAYOUT_OPTIONS` (today's one real, selectable layout, `classic` — none
of the 20 are in it). `app/js/ui/gallery/compose.js` is the ONE shared renderer every concept goes
through: the Dashboard gets one of twelve genuinely distinct hero compositions (metric-grid,
chart-first, table-first, timeline, card-stack, goal-progress, merchant-feed, envelope-grid,
command-console, split-focus, story-flow, adaptive — each a real function, reused across the
concepts that choose it, never duplicated per concept); the other six required pages (Transactions,
Bills, Budget, Shared expenses, Trips, Settings) share one responsive template driven by the
concept's own nav/density/card parameters. Both reuse the real shared components (`money`,
`categoryLabel`, `icon`/`withIcon`, `badge`) and one canonical fictional fixture set
(`app/js/ui/gallery/fixtures.js`) — the Gallery calls no workspace API, so it structurally cannot
expose a real workspace's data.

**Site-admin surface.** `GET/PATCH /api/design-gallery` (`api/_shared/gallery.js` +
`api/design-gallery/handler.js`, new document `site/gallery.json`, same schema-refusal rules as
every other document): serves the 20 manifests merged with a site-admin catalog (approve/retire —
retiring needs a replacement concept or an explanatory note, "a replacement path for retired
layouts" — and safe name/description overrides) and Terry's recorded implementation picks, both
audited atomically, before/after, in the same write. `app/js/ui/views/gallery.js` is the Gallery
page: gated exactly like Usage (BT-012-01) — fetches and renders nothing for anyone who is not a
site administrator, both server-side (401/403) and in the client (no nav/account-menu entry). Live
thumbnails (real rendered frames, never a static image) for all 20 concepts, a full preview with a
page/viewport switch, Compare mode (two concepts side by side), a comparison-matrix table sourced
from the same API response, per-concept "Mark for implementation" checkboxes, and the palette/mode
controls reused verbatim.

**Workspace `layoutId` setting — the real plumbing, deliberately not wired to the 20 concepts yet.**
Added to `api/_shared/workspace-settings.js` following the EXACT existing model (stable id, default
= today's behaviour, owners/managers change it, audited with before/after, returned in the workspace
GET, tolerant of a future unknown value on restore) — no new mechanism. Its `options` are
`REAL_LAYOUT_OPTIONS` (today just `classic`), so the full schema/API/audit/permission mechanism is
proven and testable now, while no Gallery concept is selectable on any real workspace until Terry
picks the 10 to keep — matching his explicit instruction.

**Real multi-user browser verification (BT-004-06).** `scripts/dev/e2e/gallery.mjs`: the permission
matrix, all 20 cards render with live thumbnails and no console errors, a sample deep walk across
every distinct `navStyle` family through all 7 required pages, Compare mode, 320px/834px widths with
no horizontal overflow, a sampled light/dark × 3-palette contrast check (reusing
`scripts/dev/e2e/login.mjs`'s pattern), reduced motion, and the workspace `layoutId` setting shown
for real. Two real defects found and fixed, each verified by a clean rerun: Focus Mode's manifest
said `navStyle: 'top'` while its own description called for `command` (never exercised until this
scenario walked it — fixed in `layouts.js`); a genuine, reproducible contrast-check false positive
diagnosed with a throwaway script (setting theme/mode attributes and reading computed contrast in
two separate CDP round-trips sometimes read the scaled preview thumbnails' deeply nested,
custom-property-driven background before Edge finished recomputing style — fixed by combining the
attribute change and the contrast read into one `evaluate()` call with an explicit layout flush; a
test-methodology fix, not a product change, confirmed by 3 clean reruns afterward). Also fixed, found
from a screenshot: the Trips page showed each trip's name twice.

**Evidence.** `npm test` on the merged tree: 39/39 repository (25 of these are the just-merged
deploy-engine tests, not this checkpoint's), 579/579 API, 431/431 app, exit 0. `npm run validate`
ok, 24 routes. `npm run e2e -- --only gallery`: 106 passed, 0 failed, 0 skipped, exit 0, confirmed on
4 separate runs (2 before the last product fix, 2 clean after), full cleanup verified every time. A
full `npm run e2e` (all 15 scenarios): 467/468 checks pass; the one failure (`accounts`, `409
workspace_rate`) is the pre-existing, already-documented artifact from Checkpoint R (alice's daily
10-new-workspace limit shared across scenarios in one isolated server); `accounts` runs before
`gallery` in the registration order, so this addition did not cause it; confirmed by rerunning
`accounts` alone (5/5 pass). Screenshots (ignored, not committed) under the last kept run's
`.local/e2e/<run>/shots/`: the full 20-concept grid, a complete 7-page walk-through of Executive
Ledger (the table-first/sidebar flagship), Compare mode, 320px and 834px widths, and four
palette/mode combinations (midnight and forest, light and dark).

**Recommended top 10 (this session's judgement, for Terry's actual decision — marked
`recommended: true` in the manifests and shown as a label in the Gallery, changes nothing
server-side):** Executive Ledger, Modern Banking, Financial Command Center, Calm Budget, Wealth
Overview, Cash-Flow Studio, Envelope Planner, Travel Ledger, Analyst Workspace, Sidebar Pro. Seven of
these (Executive Ledger, Modern Banking, Financial Command Center, Calm Budget, Wealth Overview,
Analyst Workspace, Sidebar Pro) are also `fidelity: 'flagship'` — they and Precision Grid received no
extra hand-tuning beyond the shared template in this session; "flagship" here means their Dashboard
composition was designed first and used to validate the pattern the others reuse, not that they have
additional bespoke pages. Every concept, flagship or not, gets a real composed Dashboard and the
real shared template on the other six required pages — see BT-013-02's test evidence (140
concept×page combinations render without throwing) and the honesty note below.

**Honest fully-realized-vs-inherited accounting (asked for explicitly in the task).** Dashboard: all
20 concepts get a genuinely distinct, hand-designed composition (one of twelve real functions, never
a recolour). Transactions/Bills/Budget/Shared expenses/Trips/Settings: all 20 concepts render
through ONE shared, real, responsive template whose nav position, density and card treatment come
from that concept's own parameters — a real structural difference (confirmed in the browser: sidebar
vs rail vs top vs sidebar-right vs command all render distinctly), but not individually hand-tuned
page-by-page content per concept. Nothing here is a static mockup or a placeholder image at any
level. Trips is explicitly illustrative (BT-010 is not a real feature yet), stated in the page
itself.

**Not done / explicitly out of reach this session.**
- **No deploy.** `scripts/deploy/deploy.ps1 -Environment preview` was not run: this worktree has no
  `.local/deploy-target.json` (absent here; it is a machine/session-specific ignored file this
  worktree was never given), and Terry's/AGENTS.md's rule against inferring a deployment target from
  ambient Azure CLI state means this is a hard stop, not a judgement call — the agent will not guess
  tenant/subscription ids. Terry's brief conditionally authorized a preview deploy once the gate is
  green; the gate IS green (see Evidence above), but the deploy step itself needs that file, which
  this worktree does not have.
- **No independent security or financial review** of this branch. The new surface is read-only about
  fictional data (site-admin gated, no financial field ever in the response — tested), and the new
  workspace setting changes nothing financial (tested: byte-identical accounts before/after), but
  this repository's own convention runs security/financial review at "major milestones and before
  release" (AGENTS.md/CLAUDE.md §8); recommended before Terry's eventual selection is wired to real
  workspaces (BT-013-01/02 note this in the register).
- **Not exhaustive, by design and stated honestly in the register:** 5 of 20 concepts walked through
  all 7 pages in a real browser (the rest verified headlessly against the same composition engine,
  140/140 combinations, no throw); 3 of 8 palettes contrast-sampled in the browser (all 8 are used by
  every concept through the same token system already verified elsewhere in this repository, e.g.
  `app/test/appearance.test.js`); no real screen reader, Windows High Contrast or physical touch
  device check.
- **A new open item for Terry** (not added to "Waiting on Terry" above — this checkpoint is
  append-only per this session's instructions; a future session should move it there): please review
  the 20 concepts in the Gallery (site-admin sign-in required, `#/gallery`) and record your picks
  (or tell the agent which 10, and it will record them for you) — see the recommended top 10 above
  for a starting point, not a decision.

**Files touched/added.** New: `api/_shared/layouts.js`, `api/_shared/gallery.js`,
`api/design-gallery/{function.json,handler.js,index.js}`, `app/js/ui/gallery/{compose.js,
fixtures.js}`, `app/js/ui/views/gallery.js`, `app/styles/gallery.css`, `scripts/dev/e2e/gallery.mjs`,
`api/test/layouts.test.js`, `api/test/design-gallery.test.js`, `app/test/gallery.test.js`. Edited:
`api/_shared/{schema.js,store.js,workspace-settings.js,routes.js}`, `app/js/core/{api.js,router.js}`,
`app/js/ui/shell.js`, `index.html`, `scripts/dev/e2e/run.mjs`, `README.md`, `docs/REQUIREMENTS.md`
(BT-013 summary row and four child rows), this file.

**Branch state.** `feature/layout-gallery`, 6 commits, already merged with
`origin/feature/project-foundation` at `1ddc2c7` (clean auto-merge, no conflicts — the deploy-
consolidation branch touched entirely different regions of the shared files). Not yet pushed to
`origin/feature/project-foundation`; not merged to `main`; nothing deployed. Because this environment
has no Git CLI access outside the agent's own tool calls, Terry's local Git output remains
authoritative for whether/when this lands on `origin/feature/project-foundation`.

**Exact next steps.**
1. [agent or Terry] Push `feature/layout-gallery`'s current tip to `origin/feature/project-foundation`
   (a fast-forward; re-fetch and re-merge first if it has moved again) — or open it as its own
   reviewable unit, Terry's choice.
2. [Terry] Sign in as a site administrator and review the Gallery (`#/gallery`); record picks.
3. [agent, once Terry has picked] Wire the chosen concepts' ids into `REAL_LAYOUT_OPTIONS`
   (`api/_shared/layouts.js`) and `layoutId`'s options (`api/_shared/workspace-settings.js`) — no
   schema change, per BT-013-03's design; run independent security/financial review at that point,
   per house convention.
4. [Terry] Run `scripts/deploy/deploy.ps1 -Environment preview` from a checkout that has
   `.local/deploy-target.json`, once satisfied with the merged tree, to see the Gallery on Preview.
## Checkpoint U — permanent deletion, rename and cascade, backend (BT-014, 2026-09-17)

**Terry's instruction (2026-09-17), verbatim in part:** "Users must have meaningful control over
their own data... They must be able to clean up their workspace, including permanently deleting
records when needed. This replaces the earlier blanket 'nothing can ever be deleted' requirement.
Archiving may remain available, but it must not be the only option. Audit history must remain
preserved." Plus a detailed cascade rule (a record alone, or one dependent relationship with no
further dependents, may be permanently deleted after two confirmations; branching to more than one
relationship, or a second hop, is refused), explicit resolutions for cross-account transfer legs
and Shared-expenses involvement, whole-workspace permanent deletion as an explicit exception to the
cascade restriction (owners, and administratively site administrators without financial-content
visibility), and instructions not to defer the site-admin half. Built by an agent in an isolated
worktree (`.claude/worktrees/agent-a1b37f2b7041dfce6`, branch `feature/record-deletion`).

**Base-commit discrepancy found and worked around, not silently ignored.** The dispatch said to
base this work on `feature/project-foundation` at `0e43e86` (which the outer session's `git log`
showed, including `BT-013` Design Gallery commits). This worktree's actual `HEAD` was `fe48b15`
("Merge pull request #4 from Stripeman/feature/project-foundation") — earlier than `0e43e86` by
this file's own history for `docs/REQUIREMENTS.md` (`git log --oneline -1 -- docs/REQUIREMENTS.md`
gives `3ad6001`, the deploy-consolidation commit, not the later BT-013 registration commit
`e77afc9`, even though `e77afc9` and `0e43e86` both exist somewhere in this repository's history
per `git log --all`). In other words: BT-013 (Design Gallery) work appears to live on a separate,
not-yet-merged branch (`feature/layout-gallery`, per the outer session's own `git status`) and was
never visible inside this worktree. Rather than either guessing that `BT-013` was free to reuse, or
stalling the whole feature on a branch reconciliation this agent has no authority to perform,
**BT-014 was used instead of BT-013** for every new identifier in this work, specifically to avoid
a future id collision once the branches merge. **Flagged for Terry/the coordinator:** reconcile
`feature/layout-gallery` and `feature/record-deletion` against the true tip of
`feature/project-foundation` before merging either, and confirm/renumber if needed — do not assume
BT-014 is uncontested either, only that BT-013 was known-taken and BT-014 was not, as of this
worktree's base.

**Built (backend only — see "Deliberately not built" below for the frontend and other honest
scope-downs).**

1. **`api/_shared/deletion.js`** — the one cascade/impact engine for per-record permanent
   deletion, used identically by seven record types (accounts, transactions, merchants/payees,
   categories, recurring bills, budgets, workspace contacts): `computeImpact` (what would cascade,
   what would only be severed/lose a pointer, what blocks it, fingerprinted into a short-lived
   token), `execute` (recomputes fresh, refuses on drift or a wrong typed confirmation, applies the
   removal/severance and writes one atomic audit entry, then re-validates the result with the exact
   invariant checker `api/_shared/backup.js` already uses for backups — so a bug here can never
   ship a dangling reference), and `makeRoutes` (the `?action=delete-impact` /
   `?action=delete-permanent` pair each handler wires in, keeping every handler's own addition to
   ~10–20 lines while authorization stays exactly where each handler already had it, mirroring
   existing edit authority rather than inventing a new permission model).
2. Wired into `api/accounts`, `api/transactions`, `api/payees` (gained permanent deletion for the
   first time; its header comment "There is NO DELETE" is now historical and was corrected),
   `api/categories`, `api/recurring`, `api/budgets`, `api/contacts` (workspace-scoped contacts
   only — see limitation below).
3. **`api/_shared/workspace-deletion.js` + `api/_shared/site-deletions.js`** — whole-workspace
   permanent deletion, an explicit exception to the per-record cascade restriction. Owners reach it
   through `api/workspaces` (`?action=delete-impact` / `delete-permanent`, never confused with the
   existing `DELETE` archive action, which is unchanged and still called "Delete workspace" in the
   app today — a terminology collision flagged for whoever builds the UI, see below). The summary
   audit record (actor, time, workspace id/kind, dataset counts, outcome) is written to a new,
   small, bounded, append-only `site/deletions.json` OUTSIDE the workspace before/around the wipe,
   so it survives the workspace's own audit trail being cleared with everything else.
4. **`store.mutateWorkspaceAdmin`** (`api/_shared/store.js`) — documented as the ONLY
   site-administration bypass of the membership gate anywhere in this authorization model, used
   exclusively by the one new administrative-deletion route below, never exported for anything
   else. **`api/analytics`** (the existing BT-012-01 site-admin usage page) gained `GET
   ?action=directory` (enumerates every workspace via `storage.list('workspaces/')`, exactly the
   technique the usage dashboard's own workspace counts already used — id, kind, status,
   timestamps, active member count, the same dataset counts as `delete-impact`, approximate size;
   never a name, balance or any financial content) and `POST ?action=delete-impact /
   delete-permanent&workspaceId=` reusing the EXACT SAME impact/apply/log logic the owner's route
   uses, so a site administrator can never do anything different to a workspace than its owner
   could, only reach workspaces they are not a member of.
5. Rename needed no new work for any of the seven per-record types: each already accepts a `name`
   change through its existing PATCH route (verified with a dedicated test), so "authority mirrors
   edit authority" falls out automatically.
6. **Docs:** `CLAUDE.md` §3's BT-001-05 bullet rewritten to Terry's 2026-09-17 wording (archiving
   stays, permanent deletion is added, corrections-as-amendments stays true); `AGENTS.md`'s "Never"
   list updated to match; `docs/REQUIREMENTS.md` gained BT-014 and four child rows (BT-014-01
   through 04, the last being the frontend, not built).

**Evidence.** `api/test/deletion.test.js` (15 tests) and `api/test/workspace-deletion.test.js` (5
tests), both new. `npm --prefix api test`: **574/574**, exit 0. `npm run validate`: ok, 23 routes,
exit 0. Both quoted directly from real runs, not summarized from memory. `git status`/`branch`/`log`
were read before every batch of edits; no file outside this feature's own scope was modified except
the two governance documents and the requirement register, all explicitly in scope per the dispatch.

**Deliberately not built this session (scoped down, not silently dropped — see BT-014-01/02/03/04
in `docs/REQUIREMENTS.md` for the full detail per item):**
- **The full Shared-expenses download/sever/preserve flow** (Terry's resolution 2: offer a
  PDF/CSV/XLSX download of the departing workspace's authorized data, sever only its own connection
  for a cross-workspace shared expense, preserve names/history for the other side, resolve a
  sole-manager handoff first). Any account, transaction or whole workspace with ANY Shared-expenses
  involvement is hard-BLOCKED with an explanatory message instead — safe, but not the full feature.
  No PDF/CSV/XLSX/JSON export infrastructure exists anywhere in this codebase yet (confirmed by
  search before starting); building it was out of this session's reach without either a large scope
  increase or a new dependency, and CLAUDE.md says not to add one lightly.
- **Private contacts** (a person's own cross-workspace address book) keep archive-only; this build
  has no safe way to scan every workspace they might be referenced in.
- **The site-admin workspace directory PAGE.** The API (`?action=directory`) is built and tested;
  no frontend surface was added. The recent design-gallery work's small site-admin surface
  (`app/js/ui/shell.js`, the account-menu "Usage" entry) is the natural place to extend, per Terry's
  own instruction to extend rather than duplicate navigation — not touched this session.
- **All frontend UI** for every part of this feature: impact-review dialogs, the two-step
  confirm/type-the-name flow, rename affordances (the backend already accepts them via PATCH), the
  site-admin Workspaces tab. None of it could be honestly claimed tested in a real browser
  (CLAUDE.md §8, the multi-user harness requirement) without existing, so none of it was built
  half-finished. This is the single largest remaining gap before this feature is usable by anyone.
- **Independent security and financial review.** This agent's own tool set in this session had no
  way to invoke `security-privacy-reviewer` or `financial-accuracy-reviewer` as separate
  subagents (no Agent/Task-style tool was available) — this is flagged plainly rather than
  fabricated. A self-review against both lenses was done instead (see the coordinator report), but
  a real independent pass by both reviewer roles is strongly recommended before any Preview
  deployment of this branch, given it touches BT-001-05 and financial data across most record
  types.

**Terminology risk to fix in the UI (flagged, not fixed — no frontend touched this session):** the
app already calls the existing recoverable workspace action "Delete workspace" (My settings →
Deleted workspaces → Bring back). The new PERMANENT action needs unmistakably distinct wording
(e.g. "Permanently delete workspace" vs "Delete workspace"/"Archive workspace") wherever both are
ever shown together, or a person could pick the wrong one expecting to be able to undo it.

**Waiting on Terry / the coordinator:**
- Reconcile `feature/record-deletion` (this branch) against the true, current tip of
  `feature/project-foundation` (and against `feature/layout-gallery`'s BT-013 work) before any
  merge; confirm or renumber BT-014.
- Decide whether the Shared-expenses download/sever flow and export formats are a follow-up
  increment of BT-014 or of BT-012 (Reporting), since both would need the same
  PDF/CSV/XLSX-generation infrastructure this codebase does not have yet.
- Preview deploy: gate is green (`npm test`, `npm run validate` both exit 0) but
  `.local/deploy-target.json` does not exist in this worktree (confirmed by directory listing only;
  its contents were never read, matching this agent's role instructions), so no deploy was
  attempted. Run `.\deploy.ps1 -Environment preview` from a normal checkout once ready.
- Dispatch `security-privacy-reviewer` and `financial-accuracy-reviewer` on this branch before
  Preview or Production, per CLAUDE.md §8 — not run this session for the tool-availability reason
  above.

## Checkpoint V — BT-014 independent review, and fixes (2026-09-17)

The two reviews Checkpoint U flagged as not-yet-run were dispatched (`security-privacy-reviewer`,
`financial-accuracy-reviewer`, both against commit `c016876`, the reconciled merge of BT-014's
backend with BT-013's Design Gallery). Both found real, independent-of-each-other defects. Fixed
directly by the coordinator (not delegated) since the frontend-UI build (Checkpoint W, if it lands
after this one) depends on the exact same routes.

**HIGH, security — workspace name leaked to the site administrator.** `workspace-deletion.js`'s
`toClientImpact` returned `label`/`confirmPhrase` sourced from `doc.name` unconditionally; the
site-admin route (`api/analytics/handler.js`) passed this straight through with no stripping,
directly contradicting the feature's own promise ("without gaining visibility into private
financial content") and its own code comment claiming no name/note/balance ever leaks. The
feature's own test asserted the leak as *expected* rather than catching it. **Fixed:** `impact()`/
`applyPermanentDelete()` take an `adminSafe` option; the admin path now omits `label` entirely and
confirms by the workspace's own id (already legitimately known to the admin from `?action=directory`
and from the id they supplied to call the route) instead of its name. Test corrected to assert the
name's absence.

**HIGH, found independently by BOTH reviewers — whole-workspace deletion's outside audit record was
not atomic with the wipe.** `site/deletions.json` was written only AFTER `store.mutateWorkspace`/
`mutateWorkspaceAdmin` committed the wipe (which deliberately clears the workspace's own internal
`audit` array). A crash, timeout or storage failure in the window between the two writes left a
permanently, irreversibly wiped workspace with **zero durable record anywhere** that it ever
existed — exactly the failure mode CLAUDE.md §3's "audited atomically, never best-effort" rule
exists to prevent, for the single most destructive action this app has. **Fixed** in both
`api/workspaces/handler.js` (owner) and `api/analytics/handler.js` (site-admin): a `pending` log
entry is now written BEFORE the wipe, updated to `completed` after it commits, or `failed` (with
the caught error's code) if the write throws — so even a mid-operation crash leaves durable
evidence an attempt was made, never nothing. Trade-off accepted: a rejected confirmation (wrong
phrase, stale token) now also writes a `pending`+`failed` pair instead of zero entries — judged
worth it for closing the catastrophic case.

**HIGH, financial — a category could be permanently deleted while still referenced by an OLDER,
superseded budget version.** `categoryImpact` and `backup.js`'s `checkInvariants` both checked only
a budget's CURRENT `lines` for a `categoryId` reference; BT-008's budget versioning keeps every past
plan in `budget.versions[]`, each with its own `lines[].categoryId`, which neither check read.
Reproducible: create a budget with a category in its plan, revise the plan to drop that category
(a normal operation — the category simply moves out of `lines` into a superseded `versions[]`
entry), then the category showed zero blocking budgets and could be deleted, leaving a permanent
dangling `categoryId` inside stored version history that no future backup would catch either.
**Fixed:** both now scan `budget.versions[].lines[]` too. New regression test added
(`api/test/deletion.test.js`).

**MEDIUM, financial — the reconciled-transaction protection had a back door via account-level
cascade.** A single reconciled transaction correctly refuses individual permanent deletion
("Reverse the entry instead"); `accountImpact`'s cascade to an account's own transactions applied
no equivalent check, so the same reconciled entries could be swept away by deleting the whole
account instead. **Fixed:** `accountImpact` now blocks while any transaction it would cascade-delete
is reconciled. New regression test added.

**LOW/minor, also fixed while in this code:** the per-record impact token omitted `doc.revision`
(the workspace-level token already included it) — added for consistency/defense-in-depth against a
content-only edit inside an unchanged cascade group. `site/deletions.json` silently dropped entries
past 5000 (a literal truncation of an audit array, against CLAUDE.md §3's explicit rule) — removed,
now unbounded (ADR-003 partitioning is the documented future answer if this ever needs a bound,
which is unlikely given how rare whole-workspace permanent deletion is). The log was write-only
(`listWorkspaceDeletions` existed, nothing called it) — `GET /api/analytics?action=deletions` now
reads it back, site-admin-gated.

**Not fixed, judged acceptable, documented debt:** a narrower TOCTOU gap the security reviewer also
found — a per-record deletion that becomes blocked only in the exact window between the outer
pre-check and the real `mutateWorkspace` call is not itself audited, because the write that would
record it also aborts it (needs a genuine concurrent write racing the delete call; low severity,
narrow).

**Evidence:** `npm test` 39/601/431 (up from 39/599/431 — two new regression tests), `npm run
validate` ok (24 routes), both exit 0. Not independently re-reviewed after these fixes — a third
review pass was judged unnecessary for this scope; flagged here for transparency rather than
silently treated as fully closed. `docs/REQUIREMENTS.md` gained BT-014-05.

**Not deployed.** Still gated behind the frontend UI work (no UI exists to actually reach these
routes yet) before any Preview deploy makes sense to review. Committed to `feature/project-foundation`
locally; not yet pushed at the time this checkpoint was written — see the exact next step below.

**Exact next step:** push this commit to `origin/feature/project-foundation`; when the
frontend-UI/Shared-expenses-severance agent (dispatched separately, worktree
`agent-a19d8b99ede0b2ea2`, branch suggested `feature/record-deletion-ui`) reports back, merge it in,
re-gate, and only then consider a Preview deploy — Terry explicitly wants all three surfaces (member
deletion, whole-workspace deletion, site-admin management) verified on Preview together before any
Production discussion.
## Checkpoint W — BT-014 Part A (shared-expenses-aware deletion, CSV/JSON export) and BT-014-04 (full frontend UI) (2026-09-17)

**Base and branch.** `feature/project-foundation` at `c016876` (the merged BT-014 backend from
Checkpoint U); worked in a fresh worktree, on a new branch `feature/record-deletion-ui`. Commits so
far: `e7447fc` (Part A backend), `3495cf2` (frontend UI), `9ddd1fd` (real-browser e2e, two real bugs
found and fixed), plus this docs commit. Not pushed, not merged, not deployed.

**Part A — the shared-expenses-aware deletion Checkpoint U deliberately deferred, now built.**
Terry's exact rule (2026-09-17) has two branches — "managed solely by this workspace" (cascade/
delete it) versus "shared with another workspace" (sever only this workspace's connection, preserve
for the other side, resolve a sole-manager handoff first). Before writing any code, searched the
whole repository for any field that could represent a shared expense's involvement with ANOTHER
workspace — none exists: every participant is either an active member of THIS workspace or a
contact recorded IN this workspace's own `contacts[]` (`api/_shared/groups.js`
`participantChecker` already refuses a private, cross-workspace contact outright). BT-009's Shared
expenses feature has no cross-workspace participation model at all yet (BT-010, trip/multicurrency,
remains planned). So every shared expense in this codebase today is, by construction, "managed
solely by this workspace" — the sever/preserve/handoff branch is not reachable YET. Documented this
finding as `groups.foreignWorkspaceIds(doc)` (always returns `[]` today, with a long comment
explaining why and giving that branch exactly one place to become real later) rather than silently
assuming it away at each call site, and implemented accordingly:
- `api/_shared/deletion.js` `accountImpact`/`accountApply`: an account linked to Shared expenses is
  no longer hard-blocked. Its `groupLedgers` entry (and any legacy `ledgerLinks` entry) is REMOVED
  (not merely marked `endedAt`, because `groups.js` `invariantProblem` requires every such entry's
  `accountId` to resolve to a real account, ended or not — an "ended" pointer at a deleted account
  would itself be the dangling reference this deletion must never ship) as a non-branching
  auto-cleanup step, exactly like the pre-existing grants cleanup; the shared expense's amounts,
  splits, payers, shares, settlements and history are untouched. The impact token's fingerprint now
  also covers `autoCleanup` (previously it did not, for grants either — a small, strictly-stricter
  fix to the existing staleness check, not a new gap).
- `api/_shared/workspace-deletion.js` `impact()`: a workspace with Shared-expenses records is no
  longer hard-blocked; the existing `DATASET_KEYS`/tombstone wipe already correctly cleared them
  once the blocker was relaxed. Blocks only if `foreignWorkspaceIds` ever finds a real foreign id
  (never, today). Both impacts now expose `groupInvolved` for the client's download offer.
- `api/_shared/sharedexport.js` (new) + `api/group/handler.js` `?action=export&format=csv|json`:
  the authorized Shared-expenses report (participants, dates, descriptions, currencies, amounts,
  splits, settlements, outstanding balances) Terry's spec requires be offered before deletion/
  disconnection — read-only, member-authorized, proven never to mutate the workspace document.
  **XLSX/PDF deliberately NOT built**: no export infrastructure of any kind existed in this
  codebase before this change; CSV/JSON needed no dependency, but a correct XLSX or PDF writer by
  hand is real engineering risk (a subtly wrong file is the realistic failure mode, not an obvious
  test failure) — flagged as a case where CLAUDE.md's "don't add a dependency lightly" is judged NOT
  to clearly apply, with a small vetted dependency recommended to whoever picks this up, not added
  unilaterally.
- `api/test/deletion.test.js`, `api/test/workspace-deletion.test.js` (one pre-existing test rewritten
  to match the new, correct behaviour — not weakened, the assertions got MORE specific), `api/test/
  sharedexport.test.js` (new). `npm --prefix api test`: 603/603, exit 0.

**BT-014-04 — the frontend, the single largest remaining gap Checkpoint U flagged, now built.**
`app/js/ui/permanentdelete.js`: one reusable impact-review/double-confirmation dialog
(`openDeleteDialog`) used identically by every record type with an existing management view
(accounts, merchants, recurring bills, budgets, transactions — delete-only, no name field) and, via
`openWorkspacePermanentDeleteDialog`, the whole-workspace case (owner and, through
`adminworkspaces.js`, site administrator). Flow: fetch impact → plain-language summary, no enabled
path forward while blocked → (if `groupInvolved`) offer "Download as CSV"/"Download as JSON"/
"Continue without downloading", never itself deleting, kept open on a failed download for retry →
re-fetch fresh right before the destructive step → type the exact confirmation phrase → execute; a
stale-token refusal re-reviews the impact automatically with a plain explanation rather than a
generic error. Rename needed no new UI for any of the five types above — their existing Edit
dialogs already expose `name` via the pre-existing PATCH routes (verified, not assumed). The whole-
workspace flow is a NEW card in Settings/Workspace, deliberately styled and worded to be
unmistakably distinct from the existing recoverable "Delete workspace" card (different heading
"Permanently delete workspace (cannot be undone)", a warning icon, an extra `.card--danger-
permanent` CSS class with a thicker double border and a tinted background) — the exact terminology-
confusion risk Checkpoint U flagged. A new site-admin "Workspaces" tab (`adminworkspaces.js`, route
`admin-workspaces`) extends the existing Usage/Design Gallery site-admin surface in `shell.js`/
`router.js` (same account-menu entry, same nav-when-signed-in-as-admin pattern, same onboarding-
guard exemption) rather than inventing new navigation, lists the directory (`?action=directory`,
counts only — id, kind, status, timestamps, member count, dataset counts, approximate size, never a
name or balance) and runs the identical impact/confirm/execute flow by workspace id.

**Two real bugs found by real-browser testing, not by reading the code** (both fixed in the same
session): `offerGroupDownload` was an unnecessary `async function` — its returned Promise was
handed to the DOM `mount()` helper instead of a node, silently wedging the dialog on "Checking once
more before continuing…" forever whenever a Shared-expenses-linked deletion was continued; and
`impactBody()` assumed every impact carries `cascade`/`severed`/`autoCleanup` arrays, true for a
per-record impact but not the whole-workspace one (dataset COUNTS by key instead), crashing step 1
of the workspace-deletion dialog — a dedicated `workspaceImpactBody()` was added. The same review
also noticed the dialog moved no focus between its steps and added explicit focus management (the
newly shown primary action, or the group-offer's first button, receives focus at every transition)
— a real accessibility gap, fixed rather than left for a future pass.

**Real-browser evidence (CLAUDE.md §8; `scripts/dev/e2e/permanentdelete.mjs`, new).** Isolated dev
server, fresh fictional seed, real headless Edge (not simulated): an account with one entry (impact
dialog, wrong-then-right confirmation phrase, real permanent deletion, verified via the API
afterwards); a branching account (its own transactions AND its own bill) shows the blocked dialog
with no enabled delete action and no confirmation field, closed with a real Escape keypress, nothing
changed; an account linked to a solely-owned Shared expense shows the download offer, "Continue
without downloading" advances it, the account is really gone and the shared expense survives with
its exact amount (40.00) and payers unchanged; both workspace-deletion cards present with different
headings and the extra style class, a plain member sees neither; the permanent flow's backup offer,
then (since the workspace still holds that one surviving Shared expense) the SAME download offer,
then real confirmation, then the workspace is gone for its owner AND a member with no reload needed;
the site-admin Workspaces directory lists a second throwaway workspace by id only (its name is
proven absent from the page text) and administratively permanently deletes it, after which its
owner loses access too. **12/12 checks passed, exit 0, no console errors or failed requests, clean
process cleanup** (proved by the harness's own end-of-run accounting). Workspaces in this scenario
are deliberately owned by `carol`/`bob`, never `alice` — she already owns or co-owns several
throwaway workspaces across the rest of the suite and workspace creation is bounded to 10/day per
person (SEC-R5); this was a deliberate design choice after finding the risk, not an accident.

A full `npm run e2e` (all 16 scenarios, one run): **479 passed, 1 failed** — `scripts/dev/e2e/
accounts.mjs` hits the pre-existing `workspace_rate` 10/day cap for `alice`, caused by workspace
creation in `privacy`/`shared`/`concurrency`/`guards`/`recheck`/`settings` (all of which run BEFORE
`accounts` in the scenario list and none of which this session touched); confirmed unrelated by
inspection (this session's own new scenario creates its workspaces as carol/bob specifically to
avoid contributing to that count) — a pre-existing, order-dependent fragility of running the full
suite in one fictional day, not fixed here, flagged for whoever next touches scenario ordering or
the rate limit itself. One PRE-EXISTING e2e assertion (`recheck.mjs` "N2", an exact row-button-list
check) needed updating for the new, correctly-enabled "Delete permanently" button on a Shared-
expenses-recorded entry's row (it is the impact dialog that explains the block, never the row
itself) — updated, not weakened; the underlying N2 behaviour (Move disabled and explained) is
unchanged and still asserted.

**Gate.** `npm test` (repo+api+app): all green, exit 0 (432/432 app, 603/603 api). `npm run
validate`: ok, 24 routes, exit 0. `npm run e2e -- --only permanentdelete`: 12/12, exit 0.

**Deliberately not built, flagged plainly rather than guessed at:**
- **Rename/permanent-delete affordances for categories and workspace contacts.** Neither has an
  existing frontend management surface to extend: categories have no add/rename UI anywhere in this
  codebase (only personal colour/icon overrides in Settings, and `api/categories` GET is the only
  category call in `app/js/core/api.js`); workspace-scoped contacts have no list page either — the
  "Private contacts" card in Settings is a different, cross-workspace, user-level concept BT-014-01
  deliberately excludes from permanent deletion. Building that base management UI first was judged
  out of this feature's honest scope rather than rushed in; flagged for whoever picks this up next.
- **XLSX/PDF export formats** — see Part A above (BT-014-06).
- **The full cross-workspace sever/preserve/sole-manager-handoff flow** — architecturally
  unreachable today (see Part A above); `groups.foreignWorkspaceIds` is the one place it needs to
  plug in once a real cross-workspace participation model exists (BT-010 or a BT-009 increment).
- **Independent security, financial and accessibility/UX review by a separate reviewer subagent.**
  This session's own tool set had no Agent/Task-style dispatch tool available (confirmed, the same
  finding Checkpoint U reported) — flagged plainly rather than fabricated. A careful self-review
  against all three lenses was done instead:
  - *Security:* every new route reuses the EXISTING `authorize()` function for its type (mirrors
    edit authority, unchanged by this session); the export and directory routes are read-only GETs
    (no CSRF surface); the site-admin directory and export never return a name, balance or content,
    proven by tests; all new UI builds DOM nodes through `el()` (no `innerHTML`); the CSV writer
    escapes quotes/commas/newlines; the download uses a same-origin Blob URL, revoked after use, with
    a filename derived only from the workspace's own internal id (no injection surface).
  - *Financial:* the account-severance test proves the shared expense's amounts/splits/payers survive
    byte-for-byte; the workspace-wipe test proves it (and its groupExpenses) are actually gone; the
    export module formats money only through the canonical `money.toDecimal` (no new arithmetic); the
    fingerprint/staleness check got strictly stricter, not weaker.
  - *Accessibility/UX:* the dialog reuses the existing `openModal` (focus trap, `aria-modal`, inert
    background, Escape handling — all inherited); new buttons carry descriptive `aria-label`s; the
    confirm-phrase field uses the shared `field()` helper with `aria-invalid` on mismatch; explicit
    focus management was added between steps (see "two real bugs" above). **Not verified:** a real
    screen reader (NVDA/JAWS/Narrator), Windows High Contrast, 400% zoom reflow, a physical touch
    device — consistent with every prior BT-014/BT-004 session's own disclosed gaps.
  A real independent pass by `security-privacy-reviewer`, `financial-accuracy-reviewer` and an
  accessibility/UX reviewer is still recommended before any Preview or Production deploy of this
  branch, per CLAUDE.md §8, given the scope (destructive, irreversible financial-record actions).

**Deploy status.** Gate is green but `.local/deploy-target.json` does not exist in this worktree
(confirmed by directory listing only, contents never read, matching this agent's role
instructions) — no deploy was attempted, none should be inferred. Never pushed to `main`, never
merged, never deployed.

**Waiting on Terry / the coordinator:**
- Reconcile and merge `feature/record-deletion-ui` into `feature/project-foundation` when ready.
- Decide whether categories/workspace-contacts management UI (a prerequisite for their BT-014
  rename/delete affordances) is a follow-up of BT-014, or of BT-007 (merchant/category directory)
  and BT-009 (Shared expenses) respectively, since both already own the closest existing surfaces.
- Decide the XLSX/PDF dependency question (BT-014-06) — recommended but not added unilaterally.
- Dispatch `security-privacy-reviewer`, `financial-accuracy-reviewer` and an accessibility/UX
  reviewer on this branch before Preview or Production, per CLAUDE.md §8 — not run this session for
  the tool-availability reason above.
- Run `.\deploy.ps1 -Environment preview` from a normal checkout (with `.local/deploy-target.json`
  present) once the above are satisfied.

## Checkpoint X — BT-014-07: review of BT-014-04/06, and fixes (2026-09-17)

Three independent reviews (`security-privacy-reviewer`, `financial-accuracy-reviewer`,
`accessibility-reviewer`) ran against `87d6768` (the reconciled merge of Checkpoint W's frontend UI
onto Checkpoint V's earlier backend fixes). All three found real defects; all fixed directly by the
coordinator. Full detail in `docs/REQUIREMENTS.md` BT-014-07. Summary:

- **HIGH security:** CSV/formula injection in `sharedexport.js`'s CSV writer — fixed with a leading
  apostrophe on any cell starting with `=+-@` or a tab/CR; regression test added.
- **MEDIUM financial:** an ENDED Shared-expenses ledger link was silently erased on account
  deletion with no impact-preview disclosure and no audit trace — fixed (`accountImpact` now
  counts ended links too); regression test added.
- **LOW financial (informational):** `sharedexport.js` didn't pass the workspace's `countReported`
  setting to `groups.balances()` — currently harmless, fixed for future-proofing.
- **Two SERIOUS accessibility findings, both fixed:** `permanentdelete.js`'s `renderFoot([])` never
  moved focus, dropping it to `<body>` (permanently, in the blocked-record case) — fixed. The
  confirm-phrase mismatch error lacked `aria-errormessage`, unlike 10+ other sites in this app —
  fixed to match the existing pattern.
- **Deliberately not fixed:** the accessibility reviewer's lower-priority Finding 3 (impact-review
  content isn't in a live region on the initial, non-blocked screen) — a common step-dialog
  trade-off, left open by choice.

**Evidence:** `npm test` 39/607/432, `npm run validate` ok (24 routes), both exit 0.

**Not done:** a fourth review pass after these fixes (judged unnecessary for this scope); real
screen reader / High Contrast / 400% zoom / touch-device testing (none of the three reviews ran
one). XLSX/PDF export — Terry explicitly approved adding a small vetted dependency for this
(2026-09-17), not yet implemented; tracked as the next piece of work.

**Exact next step:** commit and push this checkpoint's fixes to `feature/project-foundation`,
then pursue the XLSX/PDF export addition (new scope, needs a dependency choice) as its own unit of
work before a Preview deploy, since Terry wants member deletion, whole-workspace deletion and
site-admin management all verified together on Preview.

## Checkpoint Y — BT-014-06: XLSX and PDF Shared-expenses export (2026-09-17)

Built on a fresh worktree from `origin/feature/project-foundation` at `8d48b27` (Checkpoint X's
tip), branch `feature/shared-expenses-export-formats`. Terry explicitly approved adding a small,
well-known, narrowly-scoped dependency for each format (2026-09-17), closing the gap Checkpoint X
left open.

**Built.** `exceljs` 4.4.0 (XLSX) and `pdfkit` 0.20.2 (PDF) added to `api/package.json` as exact
production dependencies; `jszip` 3.10.2 added as a `devDependency` (test-only OOXML-package
inspection; also pulled in anyway as exceljs's own runtime dependency, so nothing new ships).
`api/_shared/sharedexport.js`'s `FORMATS` registry gained `xlsx` (one workbook, one worksheet per
table: Participants, Expenses, Expense shares, Settlements, Outstanding balances) and `pdf` (a
sectioned, readable document mirroring the same structure), both reusing the exact same
`buildReport()` output CSV/JSON already use — never re-derived. `render()` is now async and returns
an `encoding` field (`"text"` or `"base64"`) alongside `content`, since the shared HTTP responder
(`api/_shared/http.js`) always JSON-encodes its body; `api/group/handler.js`'s `exportReport` now
awaits `render()` and passes `encoding` through. `app/js/ui/permanentdelete.js`'s
`offerGroupDownload` gained "Download as XLSX" and "Download as PDF" buttons; `downloadFile` now
decodes base64 (`atob`) back to raw bytes for binary formats before building the `Blob`, unchanged
for text. No changes were needed to `scripts/build-artifact.mjs`, `staticwebapp.config.json` or
`api/_shared/routes.js` — verified, not assumed: the artifact was actually built
(`node scripts/build-artifact.mjs`) and `sharedexport.js` was required from inside it, confirming
`npm ci --omit=dev` (already the artifact's existing dependency step) correctly installs the new
production deps and correctly excludes the `devDependency`-only `jszip` from what ships (`jszip`
still lands anyway, as exceljs's own dependency — expected and fine).

**Dependency sanity check (not taken on faith).** Neither package is deprecated. `npm audit` found
one moderate, transitive, inapplicable advisory: `uuid` GHSA-w5hq-g745-h8pq (a bounds check
missing only when a caller passes an explicit output `buf` to its v3/v5/v6 functions) — exceljs's
own only use of `uuid` calls `uuidv4()` with no arguments, so this advisory cannot reach through
this dependency. `npm --prefix api list exceljs pdfkit jszip` shows a clean tree, no
peer-dependency conflicts.

**CSV-injection lesson, carried forward and verified (not assumed).** For XLSX: read exceljs's own
source (`lib/doc/cell.js`) — a plain JS string always resolves to `Cell.Types.String` before the
formula check ever runs; a formula cell is reachable only via an explicit `{ formula: '...' }`
object, which this module never constructs. Proven two ways in
`api/test/sharedexport.test.js`: object-model (round-tripped through
`ExcelJS.Workbook().xlsx.load()`, cell type is String, `cell.formula` is `undefined`) and file-level
(the OOXML package is unzipped with `jszip` and every worksheet XML is confirmed to contain no
`<f>` element anywhere). The CSV file's leading-apostrophe neutralization is deliberately NOT
reapplied for XLSX — confirmed unneeded, and it would visibly alter the stored text for no
protective benefit. For PDF: generated an actual file and inspected its bytes directly — pdfkit
draws text runs as hex-encoded strings (`<...> Tj`), so raw characters (including `(`, `)`, `\`, a
leading `=`) never appear in the content stream at all, only inert hex byte codes that cannot be
parsed as PDF syntax; had pdfkit instead used literal `(...)` strings, its own
`escapable`/`escapableRe` table already escapes them. `toPdf()` sets `compress: false` deliberately
so this is directly inspectable (and testable) without first inflating the stream.

**Evidence.** `api/test/sharedexport.test.js`: 8/8 (all four formats: content, mime, filename,
encoding, authorization matching CSV/JSON exactly; the existing CSV neutralization test unchanged;
new XLSX formula-safety tests at both levels above; a new PDF hex-encoding safety test; the
existing read-only/outsider/unsupported-format tests, the last one re-pointed at `xml`/`doc` since
`pdf` is now a valid format). `npm --prefix api test`: 611/611. `npm test` (repo+api+app):
39/611/432, all green. `npm run validate`: ok, 24 routes. All exit 0.

**Real-browser e2e.** `npm run e2e -- --only permanentdelete` extended: the account-deletion step
now clicks "Download as XLSX" for real (previously it only clicked "Continue without downloading");
the workspace-deletion step now clicks "Download as PDF" for real. Both are followed by an
independent re-fetch of the same export (a plain API call, not through the browser) to inspect the
actual bytes: real ZIP/OOXML (`PK` header) and real PDF (`%PDF-` header, `%%EOF` trailer) with the
correct mime and `encoding: "base64"`. The button-presence check was extended to require all four
"Download as …" buttons plus "Continue without downloading". **Result: 9 of the scenario's own
checks pass** (everything through the site-admin Workspaces directory listing, including both new
real-download checks). **The scenario cannot complete end-to-end in this environment**: its last
step (Dave's administrative permanent deletion of a second workspace, step 5) times out waiting for
the typed-confirmation field to appear. **Confirmed pre-existing and unrelated to this change**: the
exact unmodified `8d48b27` scenario file was restored into the worktree and rerun in isolation —
it times out at the identical step with the identical error message, with none of this session's
edits present. Restored to the edited version afterward (`git diff --stat` confirms only the
intended +31/-5 change remains). Not investigated further (out of scope: unrelated to Shared-expenses
export, and CLAUDE.md's "keep the change limited to the user's request"); flagged below as a known
gap for whoever picks up BT-014-03/04 next.

**Not done / not verified this session.** No independent security/financial review of the new XLSX/PDF
code by a separate reviewer subagent (none was available in this session, same limitation as
Checkpoints U–X) — the injection-safety reasoning above is thorough but self-reviewed, and a real
independent pass is recommended before Preview/Production, per CLAUDE.md §8. No Preview deploy was
attempted: `.local/deploy-target.json` is absent from this worktree (consistent with every prior
BT-014 worktree session) — merge-ready, not deployed.

**KNOWN BUGS / TECHNICAL DEBT (new).** `scripts/dev/e2e/permanentdelete.mjs` step 5 (Dave's
administrative permanent deletion of a workspace he was never a member of) reliably times out
waiting for the typed-confirmation field in this environment, on the unmodified `8d48b27` baseline
as well as on this branch — a pre-existing bug or environment-specific flake in BT-014-03's admin
deletion flow (or the harness), not yet root-caused. Two consecutive `POST /api/analytics` calls
(200 each) precede the timeout in the server log, so the impact fetch itself succeeds; the failure
looks front-end/rendering-side. Needs investigation by whoever next touches
`app/js/ui/views/adminworkspaces.js` or the admin permanent-delete wiring in `permanentdelete.js`.

**Exact next step:** merge `feature/shared-expenses-export-formats` into `feature/project-foundation`
once reviewed; root-cause the pre-existing `admin-workspaces` e2e timeout above (separate from this
feature); then pursue a Preview deploy of the accumulated BT-014 work, since Terry wants member
deletion, whole-workspace deletion, site-admin management and now the full four-format Shared-expenses
export all verified together on Preview.

**Update (2026-09-17, coordinator):** merged (clean fast-forward, `ef7fccc`). The gate initially
failed after merging — `exceljs`/`pdfkit` weren't installed in the coordinator's checkout (the
merge brings `package.json` but nothing runs `npm install` automatically); fixed with `npm install`
in `api/`, then gate passed clean (39/611/432, validate ok 24 routes). The "pre-existing
`admin-workspaces` e2e timeout" flagged above turned out to be a stale TEST, not a product bug: the
security review's earlier `adminSafe` fix correctly changed the site-admin confirmation phrase from
the workspace's name to its id, but `scripts/dev/e2e/permanentdelete.mjs`'s admin step was never
updated to match, so it waited forever for text (`Type "<name>" to confirm`) that could never
appear. Fixed the test to expect the id and added an explicit check that the name never appears in
that step. Re-ran the real-browser scenario end to end: **14/14 passed, exit 0**, including a real
XLSX download verified as a well-formed ZIP/OOXML file and a real PDF download verified as a
well-formed PDF, both via base64-decoded bytes fetched independently after the click — not just a
button-exists check. Clean process cleanup, no console errors across all three browser sessions.
BT-014 (deletion, rename, cascade, whole-workspace deletion, site-admin management, Shared-expenses
severance and four-format export) is now feature-complete, gated, and verified end-to-end in a real
browser. Not yet pushed to origin or deployed to Preview as of this note — see the exact next step
immediately following.

## Checkpoint Z — tooltip fix, merchant-linking fix, production deploy, Gallery cut (2026-09-17)

**Catching up an under-logged stretch.** Several PRs landed on `main` in this session without a
PROJECT_STATE update at the time; recorded here together, after the fact, from Git history and
`docs/REQUIREMENTS.md`.

- **BT-014-12** (`279d191`, PR #5 area): the "Record next" tooltip on All bills was clipped by
  `.table-wrap`'s `overflow-x: auto` (which forces `overflow-y` to clip too — CSS spec, not a bug in
  the table). Terry caught this in a real browser after it shipped without one ("you would have seen
  this had you tested it on localhost"). Fixed by rebuilding `infoTip()` (`app/js/ui/components.js`)
  as a JS-positioned floating box appended to `document.body`, immune to any ancestor's `overflow`.
  New permanent regression scenario `scripts/dev/e2e/bills.mjs`.
- **`fix/deploy-confirm-flag`** (`6a27206`, PR #6, merged `0a5e4c5`): `deploy.ps1` had no way to answer
  the Production typed-confirmation prompt non-interactively, blocking this non-interactive session
  from deploying Production at all. Terry explicitly chose (via `AskUserQuestion`) to add a `-Confirm
  <name>` parameter — it still requires `-AuthorizedProduction` and an exact name match; it only
  removes the interactive-stdin blocker, not the authorization requirement.
- **Production deploy of `0a5e4c5`** (the tooltip fix + deploy-confirm flag): run from a fresh scratch
  clone with `.local/deploy-target.json` and `.local/bin/gitleaks.exe` copied in (never their contents
  read/printed). Verified independently via `GET /api/site-settings` on `https://budget.remsik.org`
  matching `app.commit: 0a5e4c5...`.
- **BT-014-13** (`edcf51b`, PR #7, merged `6a12dd0`): "Add as merchant" (BT-014-11) linked using
  `bill.nextDue` as `effectiveFrom`, which is almost always in the future relative to today, so
  `termsAt` (`api/_shared/bills.js`) never selected the new version — the merchant never showed up on
  an already-started bill, and "Bills without a merchant" (`app/js/ui/views/payees.js`) kept
  re-offering it forever. Root-caused by reading the raw `workspace.json` from a kept e2e data
  directory, proving the PATCH succeeded server-side but was invisible client-side. Fixed
  `effectiveFrom` to use today (or the bill's own `schedule.startDate` if that's later), and added a
  client-side `recentlyLinked` Set so the list stops re-offering a bill even when its own
  `schedule.startDate` is still in the future (a bill that hasn't started yet structurally cannot have
  anything "in effect" before its start date — that limitation is real and disclosed in the
  confirmation message, not hidden).
- **Production deploy of `6a12dd0`** (merged PR #7): first two attempts correctly refused —
  dependencies (`npm ci` for both root and `api/`) were never installed in the fresh scratch clone, so
  `exceljs` (used by BT-014-06's export) and the SWA CLI (`npx --no-install swa`) were both missing.
  Not a code bug — the gate fail-closed exactly as designed. Fixed by running `npm ci` (root and
  `api/`) in the scratch clone; third attempt succeeded. Verified independently via
  `GET https://budget.remsik.org/api/site-settings` matching `app.commit: 6a12dd0...`.
- **BT-013-05** (Design Gallery, 5 of 20 concepts cut to 15 — see `docs/REQUIREMENTS.md` for full
  detail): Terry reviewed real rendered screenshots and disliked (a) the "filled-tint" card style's
  brown/mustard wash under the Solar/Amber palettes (Cash-Flow Studio, Envelope Planner, Visual
  Finance) and (b) a genuine broken icon-rail rendering bug in Timeline Finance and Adaptive Overview
  (confirmed against Financial Command Center, same `navStyle: 'rail'`, rendering correctly). Terry
  asked for removal over a root-cause fix. All five removed from `api/_shared/layouts.js`; every
  hardcoded "20"/"10" count updated across `api/test/layouts.test.js`, `api/test/design-gallery.test.js`,
  `app/js/ui/views/gallery.js`, `scripts/dev/e2e/gallery.mjs`. Terry was explicit: do not touch the
  real `classic` layout as part of this. **Evidence:** `npm test` 39/611/442 (exit 0); `npm run
  validate` ok; `npm run e2e -- --only gallery` 106/106 (exit 0). Not yet committed/pushed as of this
  checkpoint — see exact next step.

**BT-014-14 (done this checkpoint): real Dashboard — coloured category icons, nav polish, 3 new
widgets.** Terry's ask (approved explicitly via `AskUserQuestion`: "Real app, now" / "Yes, build all
three") — see `docs/REQUIREMENTS.md` BT-014-14 for full detail. Summary: investigated first (neither
"Executive Ledger" nor "Modern Banking" had a real coded feature to port — both were the shared
`categoryLabel()` component and the existing top nav, respectively, just more prominent in one
concept's composition); shipped icon+label nav items (`ROUTES` gained an `icon` field, `shell.js`
`renderNav` wraps labels in `withIcon()`, active-state `[aria-current="page"]` styling untouched); a
coloured category chip on Recent entries; and three genuinely new widgets — a spending-by-category
donut (new `app/js/ui/charts.js`, the real app's first pie/donut primitive, same accessible pattern as
`analytics.js`'s bar/line charts), Top merchants ranked by spend (reuses the Merchants page's existing
per-payee `stats`, just sorted differently — no new calculation), and a this-week income/expense
recap. Added an additive `byCategory` field to `GET /api/transactions`'s existing `summary` (exact
minor-unit server arithmetic, never summed client-side) and two new store slices
(`weekActivity`/`monthActivity`, deliberately separate from `transactions` so "Recent entries" keeps
its own true-most-recent-8 behaviour). **Evidence:** `npm test` 39/612/457 (exit 0); `npm run
validate` ok; `scripts/dev/e2e/dashboard.mjs` (new) 13/13 in real Edge, screenshot-verified. Nine
existing test files needed `refreshWeekActivity`/`refreshMonthActivity` no-op mocks added so
Dashboard's new mount-time fetches didn't throw against their hand-built stores. Not committed/pushed
as of this checkpoint note — see exact next step.

**BT-014-15 (done this checkpoint): Site Settings nav grouping.** Terry: "create a tab for Site
Settings and MOVE Workspaces, Design Gallery and Usage under the new Site Settings, each with their
own sub tab." Navigation-only — see `docs/REQUIREMENTS.md` BT-014-15 for full detail. The three
routes/views/URLs/tests are unchanged; the main nav now shows one "Site Settings" entry, and a new
`app__nav--sub` row (site-admin only, shown only on one of the three routes) holds the real sub-tab
links. Both BT-014-14 and BT-014-15 are on the SAME branch/PR (`feature/dashboard-widgets-BT-014-14`,
PR #9 — BT-014-15 depends on BT-014-14's `ROUTES` icon field and `navLink`/`withIcon` nav rendering,
so stacking it as a second commit on the same not-yet-merged branch was simpler than a dependent PR).
**Evidence:** `npm test` 39/612/457 (exit 0); `npm run e2e -- --only gallery,analytics,permanentdelete`
139/139 in real Edge. The account menu's three existing direct links were deliberately left flat, not
also nested under Site Settings — worth confirming with Terry.

**BT-014-16 (done): admin-directory tombstone bug + member emails.** Both of Terry's reports fixed
together on `fix/admin-directory-tombstone-and-email` (PR #10) — see `docs/REQUIREMENTS.md` BT-014-16.
The permanently-deleted-workspace row that never disappeared, and the dead "Delete permanently" button
on it, are both fixed (`directory()` excludes `deleted-permanent`; `impact()` blocks a repeat delete on
one). Each active member's real email now shows in the directory, a deliberate stated exception to that
listing's "no name or email" rule. PR #10 initially showed a merge conflict against `main` (opened
before PR #9 merged, both touched `docs/REQUIREMENTS.md`'s same insertion point) — resolved by merging
`origin/main` into the branch and reconciling the two additions in numeric order; confirmed `MERGEABLE`
after pushing the fix.

**BT-014-17 (done): account-request approval, the last queued item.** Terry: "a feature that the site
admin can turn off or on that enables a request account feature that the site admin approves." Built on
`feature/account-requests-BT-014-17` (stacked on top of PR #9 and PR #10 via a local merge, since it
extends both `shell.js`'s Site Settings grouping and `api/analytics/handler.js`'s admin actions) — see
`docs/REQUIREMENTS.md` BT-014-17 for full detail: a site-wide `accountRequestsEnabled` toggle (off by
default, never retroactive either direction), a brand-new account starts `pending` and is refused at
the two places that grant any financial-data access (create workspace, accept invitation), a new
"Account requests" admin page (the fourth Site Settings sub-tab) with the toggle and an approve/reject
queue showing real email/name (deliberately, unlike the Workspaces directory), and a new blocking
"Waiting for approval"/"Account request not approved" screen for anyone not yet let through. A site
administrator is explicitly exempted from ever being blocked by their own approval status.

Real-browser testing surfaced a genuine test-infrastructure gap, not a product bug: none of the five
standing fictional identities (alice/bob/carol/dave/eve) could stand in for a "brand-new signup" —
eve is touched by the harness's own dev-server readiness probe (`scripts/dev/harness/devserver.mjs`
signs in as eve to check the server is up) and bob/carol are invited into alice's household by the
general fictional seed (`scripts/dev/seed.mjs`) — all before any scenario's own code runs. Found by
direct diagnosis (a raw `GET /api/me` for eve, before her browser ever opened, already showed
`pendingApproval: false`), not by guessing. Fixed by adding two new fictional identities, Frank and
Grace, to `scripts/dev/server.mjs` (additive only — also available from Terry's own regular local dev
server's sign-in page, harmless either way).

**Evidence:** `npm test` 39/626/469 (exit 0); `npm run validate` ok; `npm run e2e -- --only
accountrequests` 14/14 in real headless Edge, screenshot-verified; `npm run e2e -- --only
gallery,analytics,permanentdelete` 121/121 after updating `gallery.mjs`'s sub-tab-count assertion from
three to four. All three of Terry's queued items from this checkpoint are now done.

**Branch/PR state as of this checkpoint:**
- PR #8 (`fix/gallery-remove-brown-and-broken-nav`, BT-013-05) — merged.
- PR #9 (`feature/dashboard-widgets-BT-014-14`, BT-014-14/15) — merged.
- PR #10 (`fix/admin-directory-tombstone-and-email`, BT-014-16) — open, conflict resolved, confirmed
  `MERGEABLE`, awaiting Terry's merge.
- PR not yet opened: `feature/account-requests-BT-014-17` (BT-014-17) — committed and gated green
  locally, built on top of PR #9 (merged) and PR #10 (not yet merged); opening its PR should target
  `main` once PR #10 merges, to avoid carrying PR #10's diff into it.

**Exact next step:** push `feature/account-requests-BT-014-17` and open its PR (base `main`, or
`fix/admin-directory-tombstone-and-email` if PR #10 is still unmerged when this is picked up — retarget
to `main` once #10 merges). No further items are queued from Terry as of this checkpoint; the Design
Gallery layout selection (Terry's eventual pick of which of the 15 remaining concepts to keep) remains
the one long-standing open item from earlier in this session, still awaiting his decision.

## Checkpoint AA — new-session takeover: security review fixes, Bills→Merchant, DEMO seed, curved
## accent, two-column settings, Gallery secondary pages (2026-09-18)

**Recovery.** Took over in a fresh conversation. PR #9, #10, #11, #12 (dashboard widgets, Site
Settings grouping, admin-directory/email fix, account requests) were already merged into `main` at
`c4baed3` by the time this session started — `feature/account-requests-BT-014-17`'s tip (`c914bb7`)
was exactly `main`'s merge-base, confirmed by an empty `git diff HEAD origin/main`, so nothing from
the prior session was lost or redone. Terry supplied three local files (`docs/Claude-handoff.md`,
`docs/BudgetTracker-review.md` — an independent source review pinned at `c4baed3` — and
`docs/BudgetTracker-references.html`, seven screenshots): added to `.gitignore` immediately and
confirmed never tracked/staged (they contain Terry's email and a real financial screenshot).

**Six independent units of work, each on its own feature branch off `main`, each with a full test
gate and real-browser evidence, each as an open PR awaiting Terry's review — none merged, per the
agent's standing instruction to never merge to `main`:**

1. **PR #13 `fix/security-review-2026-09-18` — S1 (High) and S2–S6 (Medium) from the independent
   review.** S1: `api/_shared/store.js`'s `ensureUser`/`mutateUser` now resolve the site's
   `accountRequestsEnabled` policy internally for every brand-new profile (a new
   `resolveInitialApprovalStatus`), instead of relying on each caller to pass it in — only `/api/me`
   did before this, so `/api/preferences`, `/api/contacts` and anything else that could create a
   profile first could permanently mark a new account "approved" regardless of site policy. New
   `store.assertApproved()` used consistently by workspace creation, invitation acceptance and
   create-new restore. S2: a completion-audit write failing AFTER a permanent deletion already
   committed no longer reports/logs the deletion as failed — retried
   (`recordWorkspaceDeletionWithRetry`), and a stuck "pending" row is reconciled against the
   workspace's actual tombstoned state when the admin deletions log is read (never rewriting the
   append-only log itself). S3: permanent deletion now purges attachment blobs (new `storage.js`
   `delete()` on all three backends; `workspace-deletion.js` `purgeAttachments()`) — previously only
   the JSON document was wiped, leaving receipts behind. S4: the pending-user queue and workspace
   directory no longer cap the enumeration before filtering (a capped scan could hide a real match
   sitting behind many non-matching records); only the response is capped now
   (`BT_PENDING_CAP`/`BT_DIRECTORY_CAP` for tests). S5: approving/rejecting an account request now
   records an attributable, atomic history entry on the person's own document. S6:
   `site/deletions.json` fails closed on a malformed existing document instead of silently
   resetting to empty. New `api/test/security-review-2026-09-18.test.js` (13 tests) reproduces each
   finding against the fix. **Evidence:** `npm test` 39/639/469 (exit 0); `npm run validate` ok (24
   routes); real headless Edge — `npm run e2e -- --only accountrequests,dashboard,gallery` 134/134
   and `--only permanentdelete` 17/17, both exit 0, confirming S1's and S2/S3's fixes hold under
   real multi-user browser conditions, not just unit tests.

2. **PR #14 `fix/bills-merchant-2026-09-18` — Bills → Merchant end to end**, the confirmed defect
   from the review ("bill 'September internet' typed merchant 'Northstar Fiber' must show
   'Northstar Fiber', never 'September internet'"). Bill versions gain `payeeDraftName`
   (`api/recurring/handler.js`), a validated field kept separate from the bill's title and from
   `payeeId`; linking or creating a real merchant always resolves (clears) it. Flows through
   create/patch/draft/view projections, so it survives in the version history exactly like every
   other term field. `app/js/ui/merchantpicker.js`: the combobox now also opens on click/focus
   (review finding: it previously opened only while typing or on ArrowDown). `app/js/ui/views/
   bills.js`: both merchant pickers show the pending typed name when nothing is linked, offer inline
   "Add … as a new merchant", and save an unmatched typed name as `payeeDraftName` instead of
   silently dropping it. `app/js/ui/views/payees.js`: "Bills without a merchant" is now "Pending
   merchants" — shows the TYPED name (grouped, so one name typed on several bills appears once with
   every bill listed under it), never the bill's title; a bill with no typed name at all gets its
   own section asking for correction, with no guessed name and no "Add as merchant". New
   `api/test/bills-merchant-draft.test.js` (11 tests). **Evidence:** `npm test` 39/637/472 (exit 0);
   real headless Edge `npm run e2e -- --only bills` 25/25 (exit 0), including the exact "September
   internet"/"Northstar Fiber" scenario end to end against a real dev server.

3. **PR #15 `feature/demo-preview-seed` — one fictional DEMO workspace, seeded into REAL Preview
   infrastructure**, per Terry's explicit authorization (preview only). New operator script
   `scripts/dev/seed-demo-preview.mjs`: resolves Terry's real, verified identity
   (`google:107097548657992699592`, matching `.local/deploy-target.json`'s recorded
   `siteAdminSubject` and Preview's own `BT_SITE_ADMINS` app setting — never invented) from runtime
   environment variables, never hardcoded; reuses the real API route handlers directly
   (`api/_shared/runtime.js`'s `invoke()`, the same technique `api/test/helpers.js` and
   `scripts/dev/seed.mjs` already use) against Preview's real Azure Blob container via an
   operator-supplied connection string (the same kind of infrastructure-level access
   `scripts/recovery/drill.cjs` already uses for backup drills — never the deployed HTTPS
   endpoint/a forged session). **Safety, all verified, not assumed:** refuses unless the storage
   account name starts `stbudgetpv` (Preview's data account — Production is `stbudgetprd01`, a
   completely different name); refuses unless a live `GET <site>/api/site-settings` reports
   `environment: "preview"` (confirmed live: commit `1a7594d…`); idempotent (an existing "DEMO"
   owned by the same identity is reported and left untouched, never duplicated — proven by running
   it twice; `--reset` would permanently delete first, through the app's own audited deletion flow,
   never a raw wipe — not exercised this session, no need to reset a freshly seeded workspace).
   **Actually run against real Preview** (a dry run against in-memory storage caught two real bugs
   first — a missing `trackFrom` override needed to demonstrate an overdue bill against a bill
   default that deliberately avoids flooding new bills with "missed" items, and a same-currency
   requirement for the recurring-transfer bill — both fixed before touching real infrastructure):
   workspace `ws_mu6odsq5be9c70fd24d0` created, then independently read back via the real API
   (accounts/balances/bills/budget/shared-expense balances all reconcile). Demonstrates multiple
   account types/currencies (EUR/USD, checking/savings/credit-card/loan-with-debt-terms), 8
   merchants (7 active, 1 closed) with defaults/aliases, income/expense/refund/transfer entries, a
   shared budget with rollover, 7 bills covering overdue/due-soon/variable/already-recorded/transfer
   cases (including one still-pending on a typed-but-unmatched merchant name — exercising PR #14's
   `payeeDraftName` against real infrastructure), and shared expenses with equal/shares/exact-amount
   splitting plus a reported settlement using private contacts as guest participants (never invented
   signed-in members, never a real invitation sent). **Explicitly NOT seeded, documented rather than
   fabricated:** rich-text notes (Tiptap is vendored, `app/js/vendor/tiptap/`, but not wired into any
   editable note field anywhere in the app today) and record attachments (no UI or API field exists
   to attach a receipt to any record today — `paths.attachment`/backup plumbing exists, but nothing
   populates it from a normal create/update call). Personal appearance settings (theme/palette) were
   deliberately left alone — Terry's own choice, not workspace content.
   **⚠ Follow-up for Terry:** retrieving the Preview connection string via `az storage account
   show-connection-string` for this seed printed the full account keys (both `stbudgetpv01` and
   `stbudgetbkpv01`) into this session's tool output/transcript. They were never written to any
   repository file, but out of caution, consider rotating both Preview storage account keys
   (`az storage account keys renew`) and updating the SWA app settings afterward.

4. **PR #16 `feature/callout-popover-accent` — the reference screenshot's curved amber left-edge
   accent**, applied once as a shared CSS treatment (never per-screen), reused automatically by the
   existing `.notice` callout class (already used by Dashboard/Planning/Workspace/etc.),
   `.floating-tip` (the existing hover/focus tooltip), and a new `.popover__panel`. New
   `createHelpPopover()` (`app/js/ui/components.js`) for explanatory content that needs a REAL
   interactive link/button — which a plain tooltip must never hold, per the review — applied to a
   real case: the new-bill "Show as due soon" field's workspace-default explanation, now a popover
   with a working "Go to Workspace settings" button (previously inert parenthetical text). **Two
   real bugs found only by real-browser e2e, neither reproducible in the DOM-double unit suite,
   both fixed and now covered by a DOM-double regression test that reproduces the exact sequence
   (`app/test/helppopover.test.js`):** (a) `modal.js`'s `escapeBelongsToControl()` didn't know about
   the new popover, so Escape while it held focus closed the WHOLE dialog underneath it instead of
   just the popover; (b) the popover's own `close()` removed its panel from the DOM before nulling
   its internal state, so the synchronous `focusout` a real browser fires when a focused element is
   removed re-entered `close()` and tried to remove the same node twice ("NotFoundError: node no
   longer a child"). **Evidence:** `npm test` 39/626/480 (exit 0); real headless Edge `npm run e2e
   -- --only bills` 17/17 (exit 0) with screenshots of the popover open (curved accent, working
   button) and of the Dashboard's existing "Needs attention" panel picking up the same treatment
   with zero per-screen changes.

5. **PR #17 `feature/workspace-settings-two-column` — responsive two-column Workspace/Shared-
   expenses settings layout.** `settingsform.js`/`components.css`'s shared settings card (used by
   both the Workspace page and Shared-expenses settings) now lays settings out in a CSS Grid,
   two columns at ≥900px, collapsing to one column below that — CSS Grid's own row-major
   auto-placement, never a manual split of the list at its midpoint, so keyboard/tab/screen-reader
   order is exactly the unchanged DOM order. Wide/complex content (read-only description lists,
   group notices, a checkbox-set control, the per-member permission list in Shared-expenses
   settings) explicitly spans both columns via a new `.setting--wide` marker. **Evidence:** `npm
   test` 39/626/469 (exit 0); real headless Edge `npm run e2e -- --only settings` 23/23 (exit 0)
   with actual computed-style checks at 1280px (two real 583.5px columns) and 390px (one column, no
   overflow), plus two screenshots — one showing two short settings genuinely side by side, the
   other showing a notice and a checkbox-set control correctly spanning full width beneath them.

6. **PR #18 `feature/design-gallery-secondary-pages` — Design Gallery: genuinely distinct secondary
   pages, plus the missing Accounts/Merchants page.** The review's exact finding, confirmed by
   reading `compose.js` directly: only the Dashboard had genuine per-concept variety (12 hero
   patterns); Transactions/Bills/Budget/Shared expenses/Trips/Settings all shared ONE template per
   page across all 15 concepts. Also confirmed: Accounts/Merchants, named in the design brief as a
   required coordinated view, was not a Gallery page at all. **This is a real, substantial fix —
   NOT the full from-scratch 15-concepts-times-every-page screenshot-grade redesign Terry's brief
   describes; that remains a much larger body of work than one session can responsibly deliver, and
   is disclosed as not done, not silently skipped.** Five new pattern axes in
   `api/_shared/layouts.js` (`transactionsPattern` ×5, `billsPattern` ×4, `budgetPattern` ×3,
   `accountsPattern` ×3, `settingsPattern` ×2), each concept assigned a persona-appropriate
   combination (never arbitrary — e.g. Executive Ledger's dense/authoritative identity gets a dense
   transactions table and a compact bills table; Modern Banking's calm banking-app identity gets a
   transactions card grid). `compose.js` gained 17 new renderer functions, each dispatched by
   pattern name exactly like the existing `DASHBOARD_RENDERERS`, plus a new `renderAccounts()`
   pairing the account list with the managed merchant directory. The comparison matrix
   (`gallery.js`) gained columns for the new axes. New `app/test/gallerypatterns.test.js` (8 tests,
   against the REAL manifest through the REAL engine, never a decoupled fixture) proves every axis
   value is genuinely used and that different patterns produce structurally different DOM for
   identical data. **Evidence:** `npm test` 39/627/477 (exit 0); real headless Edge `npm run e2e --
   only gallery` (extended) 123/123 (exit 0) confirming 15×8 pages (up from 15×7) plus dedicated
   structural-proof checks with screenshots (a real `<table>` vs. a card grid for the same
   Transactions data; three kanban columns vs. one timeline for the same Bills data; real account
   and merchant names on the new page).

**Full gate, every branch, independently confirmed:** `npm test` (repo/API/app counts vary slightly
per branch depending which of the six is checked out — each PR's own commit message quotes its
exact numbers) and `npm run validate` (ok, 24 routes) both exit 0 on every one of the six branches
before its commit. Six real-headless-Edge `npm run e2e` runs (bills ×2 sequential — once for PR #14,
again after PR #16's fixes layered on top of PR #14's own branch tip during verification —
settings, gallery, accountrequests/dashboard/gallery, permanentdelete) all exit 0.

**Git hygiene.** Each of the six units of work was branched fresh off `origin/main` (not stacked on
each other), so every PR is independently mergeable and independently revertable; `git checkout -b
<branch> origin/main` while carrying uncommitted changes for a DIFFERENT branch's work required a
`git stash push -u` / pop around the checkout twice (components.css and gallery-related files had
uncommitted edits for two different pieces of work at once) — confirmed clean afterward each time
via `git diff --stat` showing only the intended files. All nine staged-content scans
(`scripts/scan-staged.cjs`) passed clean before every commit.

**Known gaps, stated plainly (see each PR's own "not done" section for full detail):**
- The Design Gallery is a real, evidenced improvement, not the full "at least 15 fully bespoke,
  screenshot-grade designs across every page" the brief describes — Shared expenses and Trips still
  use one shared template each, and no concept was hand-redesigned beyond its Dashboard and the new
  pattern axes.
- The Preview storage account keys were displayed in this session's tool output while seeding DEMO
  (never written to any file) — flagged above for Terry to consider rotating, out of caution.
- None of the six PRs is merged, pushed to `main`, or deployed to Preview/Production — per the
  agent's standing instruction, only Terry merges and deploys. Preview's live commit is still
  `1a7594d…` (from before this session); merging any of these six PRs and redeploying is Terry's
  decision.
- No independent security/financial/UX/accessibility reviewer subagent was available this session
  (same limitation as prior checkpoints); the security-fix and financial-model reasoning above is
  thorough but self-reviewed by the same agent that wrote the fix — a genuinely independent pass is
  recommended before merging PR #13 in particular, given its scope (account-approval bypass).

**Waiting on Terry:**
- Review and merge order for PRs #13–#18 (#13, security, is the highest-priority to review first).
- Whether to rotate the Preview storage keys (see the ⚠ note under PR #15).
- His final selection of which of the 15 Gallery concepts to keep, now with real secondary-page
  variety to compare, not just the Dashboard.
- Whether to expand the two-column settings layout or the curved-accent popover pattern to any
  other screen, beyond the one real case each was applied to in this session.

## Checkpoint AB — combined all six PRs and deployed to Preview (2026-09-18, same session, Terry's
## explicit request: "combine all and push to preview")

**What was combined.** A new local branch `integration/preview-2026-09-18`, branched fresh off
`origin/main`, merging PR #13–#18 in sequence (`fix/security-review-2026-09-18` →
`fix/bills-merchant-2026-09-18` → `feature/demo-preview-seed` → `feature/callout-popover-accent` →
`feature/workspace-settings-two-column` → `feature/design-gallery-secondary-pages` →
`docs/session-2026-09-18-checkpoint`). All six merges were clean auto-merges except one: both the
Bills→Merchant and the curved-accent branches added new checks to the END of the same e2e file
(`scripts/dev/e2e/bills.mjs`) — resolved by keeping both additions, one after the other. Pushed to
`origin/integration/preview-2026-09-18` for traceability (not a PR to `main` — the deployed commit
just needs to be visible in git history; merging still needs Terry's review of the six PRs
individually).

**Two REAL regressions found only by running the full 19-scenario `npm run e2e` (not just each
branch's own `--only` scenario) before deploying — exactly why this step matters, not a formality:**

1. **`app/js/ui/merchantpicker.js`'s "opens on focus" (from PR #14) broke a dialog elsewhere in the
   app.** Root-caused with a real bisect (checked out each of the six merge commits in a scratch
   worktree, `git worktree add`, and reran the failing scenario at each point — passed through PR
   #13, failed starting at PR #14) plus direct DOM diagnostics (dumped `#app.inert`, whether the
   modal was still present, and the exact focused element right after the failing click — not
   guessed at). The bug: `openModal()` auto-focuses a dialog's first focusable control on open;
   quick entry's merchant field is sometimes that control; a bare `focus` listener cannot tell that
   apart from a genuine user click, so it force-opened the FULL merchant list immediately on nearly
   every "Add expense" dialog open, pushing the dialog's own Cancel/Save footer out of the modal's
   visible area. The next scripted click (aimed at "Cancel") then landed on the backdrop instead —
   which correctly does nothing by design ("a click on the backdrop does not close it") — leaving
   the dialog open and `#app` stuck `inert` for the rest of that browser session, breaking an
   unrelated settings interaction much later in the same scenario. **Fixed**: dropped the `focus`
   listener, kept only `click` (a real click/tap still opens it, satisfying the original review
   finding; ArrowDown/typing already cover keyboard-only use). New direct regression test in
   `app/test/merchantpicker.test.js` asserts a plain `focus` event never opens the list. Committed
   to `fix/bills-merchant-2026-09-18` (now `d8e3111`, pushed — PR #14 updated) and re-merged.
2. **A pre-existing e2e check (`scripts/dev/e2e/settings.mjs`'s "finding 10" bill check) still
   looked for text that PR #16 moved behind its new accessible popover.** This file isn't part of
   PR #16's own scenario (`bills.mjs`, which WAS updated correctly at the time) and was missed.
   Fixed to open the popover first, then read its own text (with the extra Escape press
   `escapeBelongsToControl` now requires). Committed to `feature/callout-popover-accent` (now
   `39e2b70`, pushed — PR #16 updated) and re-merged.

**Full verification after both fixes, on the combined branch:**
- `npm test`: 39/651/492, exit 0. `npm run validate`: ok, 24 routes, exit 0.
- Real headless Edge, full 19-scenario `npm run e2e` (twice, once per fix): the ONLY failures
  remaining are the pre-existing, already-documented `409 workspace_rate` artifact (alice's daily
  10-workspace creation quota exhausted by cumulative scenario runs sharing one dev-server instance
  within a single full-suite invocation — see Checkpoint Y/Z; not a regression, and every one of
  those scenarios (`accounts`, `bills`, `dashboard`) passes 100% clean when run in isolation, each
  independently re-verified this session).
- A final targeted real-browser run of the 8 most relevant scenarios together
  (`settings,recheck,bills,accounts,dashboard,gallery,accountrequests,permanentdelete`): **264
  passed, 0 failed, exit 0** — clean confirmation before deploying.

**Deployed to Preview** via the one supported entry point, `scripts/deploy/deploy.ps1
-Environment preview` (never the engine or `az` directly) — the gate re-ran everything (test,
validate, build, secret-scan) inside the script itself and passed again. Deployment receipt:
```
target  : budget-tracker / budget-tracker (preview)
url     : https://polite-plant-03bb7570f-preview.eastus2.3.azurestaticapps.net
sha     : 5939e6a6fe4e93fc67508c2781eaac4af7ae13db
version : 0.1.0-alpha.1
checks  : ok target, ok gitState, ok confirmation, ok azureResource, ok settings, ok test,
          ok validate, ok build, ok secretScan, ok upload, ok commitSetting, ok healthCheck
result  : SUCCESS
```
Independently verified live, separately from the script's own receipt: `GET
.../api/site-settings` reports `environment: "preview"`, `commit:
"5939e6a6fe4e93fc67508c2781eaac4af7ae13db"` (exact match); `GET /` returns 200; anonymous `GET
/api/me` returns 401 (auth still enforced). Preview's DEMO workspace (PR #15, seeded earlier this
session under the same commit lineage) is unaffected by this deploy — it lives in Blob storage, not
in the deployed code artifact.

**Still true:** nothing has been merged, pushed to `main`, or deployed to Production. PRs #13–#19
are still open, each independently reviewable; only the ARTIFACT built from their combination is
now live on Preview, not their merge into `main`. Terry's review/merge order for the six PRs is
still his decision; if he wants a different combination on Preview (e.g., merges only some of the
six), the next deploy will need combining again from whatever he picks.

**Exact next step:** none queued. Preview reflects all six PRs' combined work as of commit
`5939e6a`. The next session should check whether Terry has reviewed/merged any of PR #13–#19,
rebase/re-verify the others if `main` has moved, and pick up his feedback — including on the live
Preview build itself now that it's actually reachable.

## Checkpoint AC — Design Gallery: closed the Shared expenses/Trips gap, redeployed to Preview
## (2026-09-18, same session, Terry's explicit instruction: "continue working on the complete
## gallery as told", then "then you shouldnt be stopping")

**What this closes.** Checkpoint AB's own honest disclosure named Shared expenses and Trips as the
two required Gallery pages still sharing one template across all 15 concepts, after Transactions/
Bills/Budget/Accounts/Settings had already been fixed (PR #18 / BT-013-06). This checkpoint closes
that specific, previously-disclosed gap — it is not the full from-scratch "15 fully bespoke,
screenshot-grade designs" the original brief describes, and that larger scope is still not done
(see "Known gaps" below, carried forward honestly rather than re-declared complete).

**BT-013-07**, on `feature/design-gallery-secondary-pages` (commit `261d015`, pushed): two new
pattern axes in `api/_shared/layouts.js` — `sharedPattern` (`balance-list` / `ledger-table` /
`settlement-focus`) and `tripsPattern` (`card-grid` / `list` / `timeline`) — each of the 15
concepts assigned a persona-appropriate value (e.g. Executive Ledger's dense/authoritative identity
gets `ledger-table` shared expenses and a plain `list` of trips; Financial Command Center's
command-console identity gets `settlement-focus`, leading with "Settle up" suggestions). Applying
the 15×2 field assignments hit a real environment limitation worth recording: the planned approach
(`python3 -c "..."` to edit specific lines) failed outright — `python3` is not available in this
Git Bash environment (exit 127/49, Windows Store app-execution-alias redirect) — fixed by using
`node -e "..."` instead (Node.js is confirmed available), reading the file, asserting each target
line's exact expected content before editing it, and writing back; verified after with
`node --check` and a `grep -c` count. A first pass mechanically assigned `sharedPattern: 'card-grid'`
to four concepts (Modern Banking, Household Hub, Merchant Insights, Card Workspace) — `'card-grid'`
is a valid `tripsPattern` value but NOT a valid `sharedPattern` value (which only has
`balance-list`/`ledger-table`/`settlement-focus`); caught immediately by the new
`api/test/layouts.test.js` assertion failing (`modern-banking sharedPattern`), never shipped or
deployed — corrected to a balanced 5/5/5 split across the three real values before continuing.

`app/js/ui/gallery/compose.js` gained `sharedBalanceList`/`sharedLedgerTable`/
`sharedSettlementFocus` behind a `SHARED_RENDERERS` dispatch map and `renderShared(concept)`, and
`tripsCardGrid`/`tripsList`/`tripsTimeline` behind a `TRIPS_RENDERERS` map and
`renderTrips(concept)` — keyed exactly like every other pattern axis (`DASHBOARD_RENDERERS`,
`TRANSACTIONS_RENDERERS`, etc.), never a per-concept branch. The Trips page's illustrative-only
disclosure (BT-010 is not yet a real feature) is preserved unconditionally across all three
patterns — verified by a dedicated test, not assumed. `api/_shared/layouts.js`'s own header comment
(which previously said Shared expenses/Trips/Settings all "still use one template each") was
corrected to say only the read-only Settings summary still does, by design (a label-value list),
not oversight.

**Evidence, all real, all rerun after the fix above:**
- New assertions in `api/test/layouts.test.js` and `app/test/gallerypatterns.test.js`: every
  concept declares a valid value for both new axes; all 3 values of each are genuinely used (not
  just declared); a `ledger-table` shared concept renders a real `<table>` and no "Settle up" text;
  a `settlement-focus` concept renders a literal "Settle up" heading and no table; a `balance-list`
  concept renders neither; a `timeline` trips concept renders one `ol.gtimeline` and no card grid; a
  `card-grid`/`list` concept renders a card grid or plain list instead; every trips pattern keeps
  the illustrative-only disclosure regardless of pattern.
- `npm test` 39/627/481, exit 0. `npm run validate` ok, 24 routes, exit 0.
- Real headless Edge, `npm run e2e -- --only gallery` (extended with dedicated structural-proof
  checks for the two new axes, screenshots included): **128 passed, 0 failed, 0 skipped, exit 0**,
  cleanup verified (no dev server, Edge process or profile of the run left behind). Confirms live in
  a real browser: Executive Ledger's Shared expenses page is a real ledger table with no "Settle
  up" text; Financial Command Center's leads with "Settle up" and no table, for the identical
  fictional data; Wealth Overview's Trips page is one chronological ordered list with the
  disclosure still present; Modern Banking's is a card grid instead.
- `docs/REQUIREMENTS.md` gained a new `BT-013-07` row; `BT-013-06`'s own "not yet done" cell was
  corrected to say this gap was closed the same session, rather than left stale.

**Re-combined and redeployed to Preview.** Merged `feature/design-gallery-secondary-pages`
(`261d015`) into `integration/preview-2026-09-18` (clean merge, no conflicts), pushed to
`origin/integration/preview-2026-09-18` (`b987c75`), full gate rerun on the combined tree (`npm
test` 39/651/496 (repo/API/app) exit 0; `npm run validate` ok, 24 routes,
exit 0), then deployed via the one supported entry point, `scripts/deploy/deploy.ps1 -Environment
preview`:
```
target  : budget-tracker / budget-tracker (preview)
url     : https://polite-plant-03bb7570f-preview.eastus2.3.azurestaticapps.net
sha     : b987c7575d5d93b1e55a2ff2eec16d8dfd2fd638
version : 0.1.0-alpha.1
checks  : ok target, ok gitState, ok confirmation, ok azureResource, ok settings, ok test,
          ok validate, ok build, ok secretScan, ok upload, ok commitSetting, ok healthCheck
result  : SUCCESS
```
Independently verified live, separately from the script's own receipt: `GET .../api/site-settings`
reports `environment: "preview"`, `commit: "b987c7575d5d93b1e55a2ff2eec16d8dfd2fd638"` (exact
match); `GET /` returns 200; anonymous `GET /api/me` returns 401 (auth still enforced).

**Git hygiene.** Also noticed and fixed while working on this branch: `.gitignore` did not actually
contain the three ignore rules for `docs/Claude-handoff.md`, `docs/BudgetTracker-review.md` and
`docs/BudgetTracker-references.html` that Checkpoint AA's own text claimed were "added to
`.gitignore` immediately" — `git status -sb` still showed them as untracked (`??`) at the start of
this checkpoint's work. Added now, confirmed with `git check-ignore -v` against all three paths, and
confirmed `git status` no longer lists them. They were never staged or committed at any point
(verified with `git log --all --full-history -- docs/Claude-handoff.md` etc. returning nothing), so
this was a documentation/gitignore-completeness gap, not an actual leak — but worth flagging plainly
rather than silently fixing without a note, since a prior checkpoint's text had overstated the
state.

**Known gaps, stated plainly, carried forward:**
- Still true from BT-013-06/Checkpoint AB: the Design Gallery is a real, evidenced improvement, not
  the full "at least 15 fully bespoke, screenshot-grade designs across every page" the original
  brief describes. This checkpoint closes the LAST page-level "one shared template" gap (Shared
  expenses, Trips) — every required page except the read-only Settings summary (by design) now has
  genuine per-concept structural variety — but no concept has bespoke hand-crafted art direction
  beyond pattern composition; this is still fifteen compositions of shared building blocks, not
  fifteen independently designed interfaces.
- None of PR #13–#19 is merged to `main` or deployed to Production. Preview's live commit is now
  `b987c75` (this checkpoint's combined work); Terry's review/merge order for the individual PRs is
  still his decision.
- No independent security/financial/UX/accessibility reviewer subagent was available this session
  (same limitation as prior checkpoints).

**Waiting on Terry:**
- Everything already listed under Checkpoint AA/AB's "Waiting on Terry" (PR review/merge order,
  Preview storage key rotation, his final Gallery concept selection, whether to expand the
  two-column settings layout or curved-accent popover pattern elsewhere).
- Whether the remaining Gallery scope (bespoke art direction beyond composition, if he wants it) is
  worth pursuing further, given how large the original "15 fully bespoke designs" ask is.

**Exact next step:** none queued. Preview reflects all six PRs plus this checkpoint's Gallery
follow-up, combined, as of commit `b987c75`. The next session should check whether Terry has
reviewed/merged any of PR #13–#19, rebase/re-verify the others if `main` has moved, and pick up his
feedback — including on the live Preview build itself.

## Checkpoint AD — Bills → Merchant: fixed a REAL regression Terry found on Preview, redeployed
## (2026-09-18, same session, Terry's explicit report: "The Bills → Merchant workflow is still
## incorrect. Treat this as an unfinished requirement and regression, not a new feature request.")

**Terry's report, verbatim in substance:** the exact "September internet" / "Northstar Fiber"
acceptance scenario from the original review still failed on the live Preview build (deployed at
Checkpoint AB's `5939e6a`, still live at Checkpoint AC's `b987c75` when this report arrived) — a
bill's saved-but-unlinked typed merchant name went blank in places it should have shown, even
though PR #14 (`fix/bills-merchant-2026-09-18`, Checkpoint AA) had already shipped real, tested
work on this exact feature.

**First step, as explicitly instructed: checked the actual Preview build against the branch before
touching anything**, to know whether this was missing code, incorrect code, or an outdated
deployment. Traced every consumer of `payeeId`/`payeeName`/`payeeDraftName` across
`api/recurring/handler.js` and `app/js/ui/views/bills.js`. Verdict: **incorrect code, already
deployed** — not missing, not stale. The server's `termsView()` projection already returned
`payeeDraftName` correctly on every bill and every version (confirmed by reading the handler
directly); the bill editor's own Merchant picker already read it correctly as `current`. The real
bug was narrower and specific: **two READ-ONLY display sites in `bills.js` checked only
`payeeName`, with no fallback to `payeeDraftName`:**
1. The All-bills list row's merchant sub-line (`b.payeeName ? el(...) : null` — showed nothing at
   all once a merchant record didn't exist yet for the typed name).
2. The bill's own "Terms over time" history table (`v.payeeName || "—"` — showed an em dash for
   any version that only ever had a typed, unmatched name).

Both were real, both matched Terry's report exactly, and both are now `payeeName || payeeDraftName`
fallbacks — the two values are mutually exclusive by construction (the server clears the draft the
moment a real merchant is linked), so this is a fallback, never a merge of two live values. Also,
while tracing every acceptance-scenario detail literally against the current code: renamed the
Pending-merchants section's button from "Add as merchant" to the exact label **"Add merchant"**
Terry's report specified (same action, wording only), and added a real-browser check that an
already-resolved merchant is selectable on a BRAND NEW bill by typing part of its name and choosing
it from the filtered list — the literal last line of Terry's acceptance scenario ("Add another
bill: 'Northstar Fiber' is now selectable in the Merchant dropdown, which behaves like Category"),
which nothing before this session had actually exercised end to end.

**New regression coverage, both layers:**
- `app/test/pickerbills.test.js`: 4 new DOM-double tests against the REAL `createView`/`bills.js`
  (a typed-but-unlinked name shows on the list row and in "Terms over time"; a linked merchant's
  real name is shown, not a stale draft; a bill with neither shows no merchant line at all, nothing
  guessed from its own title). One real test-authoring bug caught and fixed while writing these,
  before it ever reached the browser: this DOM-double's `querySelectorAll` only supports simple
  compound selectors (`tag.class[attr]`), never a descendant combinator like `"tbody tr"` — it
  silently matches nothing rather than erroring, which the first draft of these tests didn't
  realize until they failed for the wrong reason. Fixed to `"tr"` plus a `.find()` filter.
- `app/test/pickerviews.test.js`: existing "Add as merchant" assertions renamed to "Add merchant"
  (same behavior, matching the label change).
- `scripts/dev/e2e/bills.mjs` (real headless Edge): extended with the exact same list-row and
  history-table checks against a REAL running server and REAL browser DOM, plus the new-bill
  merchant-search-and-select check. **This real-browser run caught two genuine test-authoring bugs
  of its own that the unit tests could not have caught, since they depend on real seeded data
  interacting across two separate tables on the same page:**
  1. The list-row checks initially used a bare `document.querySelectorAll("tbody tr")` text search
     — a real browser DOES support that selector (unlike the DOM double above), but the SAME bill
     text also legitimately appears in the separate "Needs attention" table above (since the test's
     bills are due soon/overdue on purpose), which has no merchant column at all; `.find()` matched
     that row first and failed. Fixed by requiring a `td[data-label="Schedule"]` cell too — a
     column only the "All bills" table has.
  2. The "Terms over time" check initially read version row index `[0]` — but versions are appended
     chronologically (`r.versions.push(version)`, server-side), so index 0 is the bill's ORIGINAL
     version from creation (correctly "—", nothing was ever typed on it); the version that gained
     the typed name is the LAST row. Fixed to read the last cell, not the first.
  Both were caught and root-caused by actually reading the failing checks' own reported actual
  values (not assumed), then verified fixed by a clean rerun — exactly the kind of thing real
  seeded data with multiple genuinely different bills exposes that a single hand-built DOM-double
  fixture does not.

**Evidence, most recent, all real:**
- `npm test` 500/500 app-suite count on the fix branch (477/477 in isolation before combining, then
  500/500 again after re-merging into the six-PR integration branch), exit 0 both times.
- `npm run validate` ok, 24 routes, exit 0.
- Real headless Edge, `npm run e2e -- --only bills`: 30/30 on the fix branch alone (no popover
  section — that belongs to a different PR), then **36/36 on the full six-PR combination** (bills +
  the BT-011-09 popover/curved-accent checks together, since both branches touch the same e2e
  file), exit 0 both times, cleanup verified.
- A broader real-browser sanity pass on the combined tree before redeploying:
  `npm run e2e -- --only settings,accountrequests,gallery,permanentdelete` — **182 passed, 0
  failed, exit 0** — confirms the `payees.js` button-rename didn't disturb anything else that
  touches that page.

**Git hygiene.** Fixed on `fix/bills-merchant-2026-09-18` (PR #14's own branch — the natural home
for a fix to that PR's own feature, never a new branch for what is clearly a continuation of the
same unit of work), commit `cd9e745`, pushed. Re-merged into `integration/preview-2026-09-18`
(`fe57d15`) with one real merge conflict in `scripts/dev/e2e/bills.mjs` (both this fix and PR #16's
popover work independently added checks after the same "a real merchant, once linked" line) —
resolved by keeping both, in two separate "Add bill" dialog openings (one for the merchant-search
proof, one for the popover proof), verified with `node --check` and the full real-browser rerun
above, not just a clean git merge.

**Redeployed to Preview**, same one supported entry point:
```
target  : budget-tracker / budget-tracker (preview)
url     : https://polite-plant-03bb7570f-preview.eastus2.3.azurestaticapps.net
sha     : fe57d157cba78ef27b975a663deed45336c2cbab
version : 0.1.0-alpha.1
checks  : ok target, ok gitState, ok confirmation, ok azureResource, ok settings, ok test,
          ok validate, ok build, ok secretScan, ok upload, ok commitSetting, ok healthCheck
result  : SUCCESS
```
Independently verified live, separately from the script's own receipt: `GET .../api/site-settings`
reports `commit: "fe57d157cba78ef27b975a663deed45336c2cbab"` (exact match); `GET /` returns 200;
anonymous `GET /api/me` returns 401 (auth still enforced).

**What was preserved, as instructed:** no persisted-data shape changed (`payeeDraftName` already
existed and was already being written and read correctly server-side); this checkpoint fixed only
how two READ-ONLY views render an existing field, so older bills' real data is unaffected. Where an
older bill genuinely never had a typed name stored (created before PR #14 shipped, or via direct
API without one), nothing is invented or guessed from its title — confirmed by a dedicated test
("a bill with neither a linked merchant nor a typed name shows no merchant line at all").

**Known gaps, stated plainly:** everything already listed under Checkpoint AB/AC's own "Known gaps"
sections is still true and not repeated here. This checkpoint is scoped narrowly to the one
regression Terry reported; it does not re-review the rest of Bills → Merchant beyond what his exact
report named.

**Waiting on Terry:** everything already listed under Checkpoint AA/AB/AC's "Waiting on Terry",
plus: confirmation that the exact acceptance scenario now holds on the redeployed Preview build
(`fe57d15`) from his own browser, not just this session's automated evidence.

**Terry's own follow-up (2026-09-18, verbatim):** "ok its not exaclty what i asked for but it
works." Accepted as working but flagged as not an exact match to what he pictured — he did not yet
say which part. Asked him directly which of the following (or something else) it is, rather than
guessing and polishing the wrong thing: the "Add merchant" button's exact wording/placement, the
merchant picker's interaction feel versus Category's own dropdown (built as a separate but
similarly-behaving `combo__*` component, never literally swapped to reuse `pickerSelect` itself —
that could be the actual gap if he meant "the same component", not just "the same pattern"), how
the list row or history now shows the pending name, or something else in the overall flow. Do not
close this until his answer arrives; do not silently mark Bills → Merchant fully resolved based on
"it works" alone.

**Exact next step:** none queued. Preview reflects all six PRs, the Gallery Shared/Trips follow-up,
and this Bills → Merchant display fix, combined, as of commit `fe57d15`. The next session should
check whether Terry has reviewed/merged any of PR #13–#19, rebase/re-verify the others if `main`
has moved, and pick up his feedback on the live Preview build.

## Checkpoint AE — Bills → Merchant: the Merchant field is now the SAME dropdown component as
## Category, not a lookalike (2026-09-18, same session, Terry's follow-up: "what i did ask for was
## the drop down to look like that of the category field ... I KEEP CALLING FOR CONSISTENCY")

**What Checkpoint AD actually got wrong.** Terry confirmed the FUNCTIONAL flow (Checkpoint AD)
matched what he wanted, then named the real remaining gap precisely: the Merchant field's dropdown
was a bespoke ARIA combobox (`merchantpicker.js`, its own `.combo__*` markup and styling) — it
behaved correctly but looked like nothing else in the app, when every other dropdown (Category,
Account, Status, Workspace, member roles, …) is the SAME shared "TaskTracker command picker"
(`commandpicker.js`, `.cmdpick__*`). This is the third time in this app's history Terry has stated
this exact principle (2026-09-14, twice, per commandpicker.js's own header comment) — a durable
preference, not a one-off ask.

**Root fix, in the shared component, not a Merchant-only patch.** The tension: a fixed picklist
(Category, Account) never needs typed text that matches nothing to become a real value, but the
Merchant field's whole point (BT-014-11) is exactly that — type a name, leave it, resolve later.
Added ONE opt-in extension to `commandpicker.js` itself, `allowCustom` (documented as "A16" beside
the component's existing A1–A15 adaptations), used by nothing else — every existing picker is
provably unaffected (all 67 pre-existing `commandpicker.test.js` tests still pass unmodified,
proving Category/Account/Status/Workspace/etc. behave exactly as before). When `allowCustom` is on:
typed text matching no real option is kept as a single reusable synthetic `<option>` (prefixed with
an exported `TYPED_OPTION_PREFIX` so a consumer can tell "a real option was chosen" from "this was
typed and nothing matched" without a second channel), committed on Enter (nothing highlighted), Tab
out of the panel in either direction, or an outside click/dismissal — deliberately NEVER on Escape,
which stays "never mind" exactly like every other picker. Choosing a REAL option afterward removes
the abandoned synthetic draft so it can never linger as a phantom "existing merchant" in the list.
A caller may also SEED an initial typed value (a bill reopened with a saved, still-unlinked name) by
placing an option with that same prefix in the select before construction; the picker adopts it.

**New `app/js/ui/merchantselect.js`** replaces the retired `merchantpicker.js` entirely (deleted,
along with its own test file). `createMerchantSelect()` builds the Merchant field the exact same
way `pickerSelect()` builds Category/Account — a plain `<select>` handed to `field()`, nothing
bespoke — with `allowCustom: true` for a bill's own term (`openBillEditor`, `openRecord`'s "review
and record" dialog reads `readMerchantSelect().payeeId` and ignores a draft there, since recording
an actual payment always needs a real merchant, unlike the bill's own term) and `allowCustom: false`
plus a `create: { label: "Add merchant", onPick }` pinned action (the exact same "+ New account"
pattern already used elsewhere) for `transactions.js`'s quick-entry, which always needs a real
merchant (BT-007-01) — its own existing inline "New merchant" fieldset is unchanged, only the
DROPDOWN above it is now the shared component. The Transactions Merchant FILTER was already this
same picker, unaffected. `setMerchantOptions()` replaces the merchant list on an account change
(surgically, keeping any live typed-draft option's own DOM node intact) exactly like the old
`.setItems()` did; `selectMerchant()` replaces `.select()`.

**Real, environment-specific bugs found and fixed while verifying in an actual browser (not
guessed, not something a unit test could have caught, since they depend on real focus/DOM-event
sequencing):**
1. A raw JS `dispatchEvent(new MouseEvent("click"))` used by an EARLIER check (testing "opens on
   click") opened the picker's panel and then called `.focus()` on the TRIGGER directly — never
   moving real browser focus into the search box the way a genuine click does (`show()`'s own
   `holder.focus()`). A later step's `Input.insertText` then landed in whatever WAS actually
   focused (the bill's own Name field), not the Merchant search box at all. Fixed by having the
   e2e helper always click the SEARCH BOX directly once the panel is confirmed open, never assuming
   focus followed a panel-open state.
2. A short merchant list (under the twelve-option `SEARCH_THRESHOLD`) got no search box at all —
   correct default behaviour for a closed picklist (Category/Account), but WRONG for Merchant,
   whose whole purpose is typing free text regardless of list size; a short list's type-ahead-only
   trigger has no surface for that at all. Fixed by having `createMerchantSelect()` always pass
   `search: true`, never "auto" — Merchant is now always searchable no matter how few merchants
   exist yet.
3. Committing a typed draft by clicking a "neutral" point (the dialog's own title) was unreliable:
   if the panel happened to open UPWARD and visually overlap the title, the click would land on the
   panel itself (which does not count as "outside", so nothing commits). Fixed by committing via
   Shift+Tab out of the search box instead (commandpicker.js's own "first element, backward"
   edge — works identically whether or not a "+ Add merchant" pinned action is also present, unlike
   a plain forward Tab which would first land ON that pinned button).
4. The pinned action's rendered label uses curly quotes (“ ”), not straight ones (") — a
   copy-paste assumption in the first draft of the e2e check, corrected against the actual
   `commandpicker.js` template string.
None of these were product defects in the FINAL shipped code — all four were caught and fixed
during verification, before anything reached a commit.

**Evidence:**
- `app/test/commandpicker.test.js`: 9 new tests for `allowCustom` (A16) appended after all 67
  pre-existing ones, which are unmodified and still pass — direct proof no other picker changed
  behaviour. Covers: default (no `allowCustom`) commits nothing; Enter commits; Tab-out commits
  without stealing focus back to the trigger; a click outside commits; Escape does NOT commit;
  typing the exact name of a real option selects that option instead of duplicating it; editing an
  already-typed value reuses the same synthetic option; choosing a real option afterward removes
  the abandoned draft; a caller-seeded initial typed value is adopted, not duplicated.
- `app/test/pickerbills.test.js` and `app/test/pickertransactions.test.js`: updated to reflect
  Merchant now appearing as a real picker in `pickerLabels()`, with its own spoken value/instructions
  matching Category's own pattern exactly; `pickertransactions.test.js`'s merchant-suggestion test
  rewritten to use the same `chooseOption()` helper every other picker test already uses, instead of
  driving a now-nonexistent bespoke `input[role="combobox"]` directly.
- `npm test` 39/651/502 (exit 0); `npm run validate` ok, 24 routes (exit 0).
- Real headless Edge, `npm run e2e -- --only bills`: 37/37 passed (exit 0) on the fully combined
  six-PR tree, including a NEW dedicated check with a screenshot confirming Merchant's trigger is
  literally the same `.cmdpick__trigger` component as Category (same tag, same class, no `.combo`/
  `.combo__*` markup anywhere on the page) — real DOM proof, not just matching behaviour. The
  screenshot shows the open Merchant panel with the identical search-row/list/pinned-action/
  key-hints chrome every other picker in the app already has.
- A broad real-browser regression pass beyond bills itself, confirming the shared-component change
  touched nothing else: `npm run e2e -- --only move,remove,shared,accounts,dashboard` (57/57),
  `npm run e2e -- --only recheck` (38/38, exercises the Transactions quick-entry form's own "Add
  expense" flow repeatedly without a dedicated merchant-specific scenario file — see "Known gaps"),
  `npm run e2e -- --only dropdown,settings,accountrequests,gallery,permanentdelete,recheck` (249/249)
  — all exit 0.

**Git hygiene.** Committed to `fix/bills-merchant-2026-09-18` (PR #14's own branch, the natural
continuation of the same unit of work), commit `66a5fae`, pushed. Re-merged into
`integration/preview-2026-09-18` (`f42e95d`) — a CLEAN merge, no conflicts. Redeployed to Preview:
```
target  : budget-tracker / budget-tracker (preview)
url     : https://polite-plant-03bb7570f-preview.eastus2.3.azurestaticapps.net
sha     : f42e95d681be2142521d50a592480a52ba007fc0
version : 0.1.0-alpha.1
checks  : ok target, ok gitState, ok confirmation, ok azureResource, ok settings, ok test,
          ok validate, ok build, ok secretScan, ok upload, ok commitSetting, ok healthCheck
result  : SUCCESS
```
Independently verified live: `GET .../api/site-settings` reports `commit:
"f42e95d681be2142521d50a592480a52ba007fc0"` (exact match); `GET /` returns 200; anonymous `GET
/api/me` returns 401.

**Known gaps, stated plainly:**
- No DEDICATED new e2e scenario file was added for the Transactions quick-entry Merchant field
  specifically (Terry's own words only ever named the BILL's merchant field; converting
  transactions.js too was this session's own extension for full consistency, not something he
  explicitly asked for). Confidence there rests on `pickertransactions.test.js`'s existing 22 unit
  tests (all passing, rewritten to use the shared `chooseOption()` helper) plus `recheck.mjs`'s
  existing, unrelated 38-check real-browser coverage of the same "Add expense" dialog continuing to
  pass unmodified — real but indirect evidence, not a purpose-built proof the way bills.mjs now has.
- Everything already listed under Checkpoint AA/AB/AC/AD's own "Known gaps" is still true.

**Waiting on Terry:** everything already listed under Checkpoint AA–AD's "Waiting on Terry", plus:
confirmation that THIS is what he meant by "look like Category" — the live Preview build now shows
an actually identical dropdown, not just a similar one, and whether he wants the same purpose-built
real-browser depth extended to the Transactions quick-entry Merchant field specifically.

**Exact next step:** none queued. Preview reflects all six PRs, the Gallery Shared/Trips follow-up,
and both Bills → Merchant fixes (display fallback, then component consistency), combined, as of
commit `f42e95d`. The next session should check whether Terry has reviewed/merged any of PR
#13–#19, rebase/re-verify the others if `main` has moved, and pick up his feedback on the live
Preview build — starting with whether the Merchant field now genuinely matches what he pictured.

## Checkpoint AF — the Transactions quick-entry Merchant field, dedicated real-browser proof, and a
## real bug it found (2026-09-18, same session, Terry: "yes, build the transactions e2e check too.
## after you done, merge commits if needed, and push to preview")

**What Checkpoint AE left open.** AE's own "Known gaps" said plainly: no dedicated e2e scenario
existed for the Transactions quick-entry form's Merchant field specifically — only indirect evidence
(existing unit tests, and `recheck.mjs`'s incidental use of the same "Add expense" dialog for an
unrelated purpose). Terry asked directly for the same purpose-built depth bills.mjs already has.

**New `scripts/dev/e2e/transactions.mjs`** (registered in `run.mjs`, plus a few missing scenario
names added to its `ALIASES` and to README's own scenario list, which was already stale before this
— `bills`/`dashboard`/`accountrequests` were missing from it too). Mirrors bills.mjs's own rigor for
the Transactions "Add expense" form: a screenshot-backed structural check that Merchant's trigger is
the literal same `.cmdpick__trigger` component as Category (no bespoke `.combo`/`.combo__*` markup
anywhere); searching for and selecting an existing merchant; typing a brand-new name offering the
same "+ Add merchant" pinned action the Account picker's own "+ New account" already uses, opening
the form's EXISTING inline "New merchant" fieldset — never a left-as-typed draft, since a real
transaction always needs a real merchant (BT-007-01), unlike a bill's own term (BT-014-11); saving
and verifying the link directly against the API; the existing duplicate-merchant "Use X" / "Add as a
separate merchant" recovery path (exercises the SAME pinned action this fix rewired, so it is real
regression coverage of code this session touched, not an unrelated feature check); and — the check
that actually found something — switching to an account that cannot use the currently-chosen
merchant clearing it, with the same accessible announcement as before.

**A real, previously undetected bug, found by that last check, not guessed.** `setMerchantOptions()`
(the account-change handler that rebuilds the choosable merchant list) removed the currently-selected
`<option>` and then appended the new choosable ones — but a real `<select>` element, once its
selected option is removed and options are re-added with nothing explicitly selected, AUTO-SELECTS
whichever ends up first. Both the "still valid, keep it" and "no longer valid, clear it" checks were
reading `select.value` AFTER this auto-select already happened, so a private merchant, cleared as
intended when switching to an incompatible account, silently came back as whatever the FIRST
remaining option happened to be instead of staying cleared — invisible to every unit test (the DOM
double does not simulate native `<select>` auto-select behaviour) and to bills.mjs (which never
exercises an account-change-clears-the-merchant path, since a bill's account is locked once created).
Fixed by capturing `select.value` ONCE, before any option is touched, and deciding the restore/clear
against that captured value only, then explicitly restoring or clearing rather than trusting whatever
the browser landed on mid-rebuild.

**Evidence:**
- `npm test` 39/651/502 (exit 0); `npm run validate` ok, 24 routes (exit 0).
- Real headless Edge: `npm run e2e -- --only transactions` 13/13 (exit 0) standalone (first run caught
  the `setMerchantOptions` bug directly — "switching to a shared account clears a private merchant"
  failed with the stale merchant still shown; fixed, then a clean rerun); `npm run e2e -- --only
  bills,transactions` 44/44 together (exit 0) on the fix branch, 50/50 (exit 0) on the fully combined
  six-PR integration tree — proving the fix and the new scenario coexist cleanly with everything else
  built this session.
- `docs/REQUIREMENTS.md` gained BT-014-18, consolidating both this session's Merchant fixes
  (Checkpoint AD's display fallback and Checkpoint AE's component-consistency fix) into one entry,
  since they are the same regression thread, not two separate requirements.

**Git hygiene.** Committed to `fix/bills-merchant-2026-09-18` (still the same PR's own branch — this
is the third checkpoint continuing that one unit of work, never a new branch for what is clearly the
same thread), commit `b707aca`, pushed. Re-merged into `integration/preview-2026-09-18` (`75577c9`)
— a clean merge, no conflicts. Redeployed to Preview:
```
target  : budget-tracker / budget-tracker (preview)
url     : https://polite-plant-03bb7570f-preview.eastus2.3.azurestaticapps.net
sha     : 75577c98422ce9ddcccc3b2197e3ce476d81795b
version : 0.1.0-alpha.1
checks  : ok target, ok gitState, ok confirmation, ok azureResource, ok settings, ok test,
          ok validate, ok build, ok secretScan, ok upload, ok commitSetting, ok healthCheck
result  : SUCCESS
```
Independently verified live: `GET .../api/site-settings` reports `commit:
"75577c98422ce9ddcccc3b2197e3ce476d81795b"` (exact match); anonymous `GET /api/me` returns 401.

**Known gaps, stated plainly:** everything already listed under Checkpoint AA–AE's own "Known gaps"
is still true; this checkpoint specifically closes AE's own disclosed gap (no dedicated Transactions
Merchant e2e coverage) and found a real bug while doing so, rather than merely adding a check that
happened to pass.

**Waiting on Terry:** everything already listed under Checkpoint AA–AE's "Waiting on Terry" — nothing
new this checkpoint besides confirmation the fix is what he wanted.

**Exact next step:** none queued. Preview reflects all six PRs, the Gallery Shared/Trips follow-up,
and all three Bills/Transactions → Merchant fixes (display fallback, component consistency, the
account-change-clear bug), combined, as of commit `75577c9`. The next session should check whether
Terry has reviewed/merged any of PR #13–#19, rebase/re-verify the others if `main` has moved, and
pick up his feedback on the live Preview build.

## Checkpoint AG — NO DROPDOWN MAY SHIFT SURROUNDING CONTENT (BT-004-08), a new requirement from
## Terry's screenshots, fixed at the root in the shared picker component (2026-09-18, same session)

**What Terry reported.** Screenshots of Add Bill, Add Budget, Add Account and Add Merchant: opening
the Icon dropdown "creates a large gap and pushes subsequent fields down" — unacceptable throughout
the app. His instruction was explicit: fix the shared components, then audit every usage; do not
apply four isolated CSS patches and leave the same defect elsewhere. He also authorized continuing
every other open thread (Design Gallery, Bills/Merchant, review findings) without pausing to ask,
and separately said not to touch the storage-key rotation.

**Root cause, confirmed by reading the code, not guessed.** `createThemePicker`
(`app/js/ui/themepicker.js`) — the ONE shared control behind the Icon picker (`iconpicker.js`, used
by Accounts, Bills, Planning, Payees — exactly Terry's four named forms), the Colour-palette picker
(My settings, Workspace, the account-menu header, the Design Gallery preview) and the category
Colour picker — rendered its option list as a plain normal-flow sibling of its own toggle, with no
`position` rule at all. `core/popover.js`'s own header comment already named this precisely as
pre-existing, unfixed debt: "the theme and icon pickers open in normal flow." The command picker
(Category/Account/Status/Merchant/Workspace/Type) had ALREADY solved this correctly with a
`position: fixed`, viewport-aware, dialog-portaled overlay (BT-004-04/05/07) — the theme/icon/colour
family had simply never been brought up to the same standard.

**The fix, at the root, once.** `app/js/ui/overlay.js` (new) extracts the command picker's own
private placement engine — `overlayHost`, `coarsePointer`, `viewportOf`, `triggerVisible`,
`placePanel`, `usefulHeight`, `followTrigger` — into a shared module with no behaviour change
(`commandpicker.js` now imports it instead of keeping a private copy; its own 76/76 unit tests and
real-browser `dropdown.mjs` 29/29 passed unmodified, proving the extraction was faithful).
`themepicker.js`'s list now opens through the exact same engine: portaled to the nearest
`aria-modal` dialog or `document.body`, positioned and kept anchored on scroll/resize by
`placePanel`/`followTrigger`, dismissed through the shared `registerPopup` registry (so outside-click
and rival-popup closing work identically to the command picker), `position: fixed` in
`components.css` reusing the same `--pop-top`/`--pop-left`/`--pop-max-height`/`--pop-min-width`
custom properties. `modal.js`'s `escapeBelongsToControl` (so Escape closes the list before the
dialog) and its Tab-trap `inPanel` helper both updated to recognise `.themepick__list` as a floating
panel, matching the existing `.cmdpick__panel`/`.popover__panel` pattern. Every
`createIconPicker`/`createThemePicker` call site was audited (`accounts.js`, `bills.js`,
`planning.js`, `payees.js`, `settings.js`, `workspace.js`, `shell.js`, `gallery.js`) — one fix in the
shared component reaches all of them; `daynight.js` has no dropdown of its own and needed nothing.

**Downstream test fixes, all mechanical, none behavioural.** Because the list only exists in the
document while open, and lives on `document.body`/the dialog rather than under the picker's own
element, four test files needed updating to open the picker before querying its list, and to query
from `document` rather than the picker's own subtree: `accounteditor.test.js`, `colours.test.js`,
`icons.test.js` (4 tests). `themepicker.test.js` was rewritten with dedicated no-reflow regression
tests (the list is never a child of the picker's own element even while open; closing removes it
from the document entirely, not just hides it; a later field never moves when the list opens or
closes).

**New dedicated real-browser proof, exactly what Terry asked to see verified.**
`scripts/dev/e2e/overlay.mjs` (`npm run e2e -- --only overlay`), 25/25 passed, exit 0:
- Add Account, Add Bill, Add Budget, Add Merchant: the dialog's own primary Save/Create button and
  its footer (`.modal__foot`) are at the pixel-identical position before and after opening the Icon
  list, and the dialog's own height is unchanged; the open panel's computed `position` is `fixed`.
- The 50+-entry Icon list scrolls inside its own height-capped panel, fully inside the viewport
  (`overflow-y: auto`, a real `max-height`).
- At a 1024×420 short viewport the list opens upward and stays fully visible — never clipped off
  the bottom of the screen.
- At a 390×844 phone layout the same no-reflow proof holds, and the panel stays fully inside the
  viewport.
- ArrowDown still moves focus among real, focusable options inside the floated panel; Escape closes
  only the list (the dialog stays open); a click on the dialog's own title dismisses the panel
  without closing the dialog (outside-click dismissal).
- The non-modal My-Settings "Colour palette" picker (same shared component, no dialog involved at
  all) does not move the next card ("Display and privacy") either before or after, and is also
  `position: fixed`.
- No console exceptions, errors or failed requests.

**Evidence.**
- `npm test` 39/651/505 (repo/api/app), exit 0. `npm run validate` ok, 24 routes, exit 0.
- `npm run e2e -- --only overlay` 25/25, exit 0 (standalone, isolated fresh seed).
- `npm run e2e -- --only dropdown,accounts,bills,settings,gallery,overlay` 247/247, exit 0 — a
  combined regression check of every scenario that touches a modal, a command picker or the
  theme/icon picker family together, proving the shared-engine refactor coexists cleanly.
- A full, unfiltered `npm run e2e` (all 21 scenarios, no `--only`) reported 523 passed, 5 failed,
  exit 1 — but every one of the 5 failures is the SAME pre-existing cause, reproduced starting at the
  9th scenario (`accounts`), long before `overlay` (the 21st/last) even runs: the fictional `alice`
  identity's `workspace_rate` limit (10 workspace creations/day, `api/_shared/store.js`) is exhausted
  by the cumulative `createWorkspace` calls across the growing scenario suite (11 scenarios default
  to owner `alice`) when they all run back-to-back in one calendar day against one seed. This is a
  pre-existing e2e-harness scaling gap, not a regression this change introduces — confirmed because
  the SAME failure mode appears at `accounts`/`bills`/`dashboard`/`transactions` (none of which this
  session touched) before `overlay` is even reached. Left open as a known gap (see below); the
  properly scoped combined run above is the real regression evidence for this specific change.
- `docs/REQUIREMENTS.md` gains **BT-004-08**.

**Git hygiene.** Committed directly to `integration/preview-2026-09-18` (the branch already
contained checkpoints AE/AF from earlier this same session; continuing on it rather than opening a
new branch for the same continuing session of work), commit `2f2bea5`, pushed to origin.

**Known gaps, stated plainly.** Everything already listed under Checkpoints AA–AF's own "Known
gaps" is still true. New from this checkpoint: (1) the e2e harness's `workspace_rate` scaling limit
described above — running the FULL suite unfiltered now needs either a higher
`BT_MAX_WORKSPACE_CREATIONS_PER_DAY` for local/e2e runs, spreading scenarios' `createWorkspace`
calls across more fictional owners, or running the suite in a few `--only` batches — not fixed here,
out of scope for BT-004-08; (2) a real screen reader over the floated theme/icon list specifically
was not checked (the command picker's own screen-reader gap is already tracked under BT-004-07 and
applies here too); (3) Windows High Contrast and a physical touch device remain unverified (touch
was emulated); (4) not yet deployed to Preview as of this checkpoint's own commit — see next step.

**Waiting on Terry:** everything already listed under Checkpoints AA–AF's "Waiting on Terry."
Additionally, this session received a direct contradiction on deployment scope that has NOT been
acted on either way and needs his explicit word before anything touches `main` or Production: his
main instruction for this unit of work ended with "No main merge or Production deployment is
authorized," but a mid-session follow-up said "when all that is complete push to main, preview and
then production." Per `AGENTS.md`/`CLAUDE.md` (never push to `main`/master, merge PRs or deploy
Production without Terry's explicit, unambiguous authorization — "Terry controls promotion after
review") and given the two instructions directly conflict, this session is treating Preview-only as
the safe, authorized action and is NOT merging to `main` or deploying Production. This needs Terry's
explicit clarification, not a judgment call, before either happens.

**Exact next step:** deploy this commit (`2f2bea5`, `integration/preview-2026-09-18`) to Preview via
`scripts/deploy/deploy.ps1 -Environment preview` and independently verify the live commit sha and
anonymous 401, per the established pattern; then continue straight into the Bills/Merchant
completeness review and the Design Gallery bespoke-design continuation Terry re-authorized in the
same instruction, without pausing to ask permission at each step; then get Terry's explicit word on
the main/Production contradiction above before doing anything in that direction.
