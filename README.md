# BudgetTracker

Privacy-first budgeting service with accounts, debt tracking, forecasting, trip planning, shared expenses, and multiple currencies.

## Status

Alpha, in active development on `feature/project-foundation`. Built and tested so far: the security and permission foundation, encrypted backups with tested restores, accounts and entries (with amendments, reasons and reversals — nothing is ever deleted), the managed merchant directory, recurring bills, budgets, the cash-flow forecast with what-if, colour-coded categories, contextual icons (a central registry, money-direction icons, and custom icons only through a validated upload), and the web app with TaskTracker's day/night control, theme picker and searchable workspace picker (its command picker). A preview deployment exists for review; Production is not deployed. The [requirement register](docs/REQUIREMENTS.md) says exactly what is complete and what is partial.

## Planned capabilities

- Personal, household, and trip workspaces with explicit sharing.
- Accounts, institutions, payees, contacts, and members.
- Fast expenditure entry with editable autofill and searchable contact/member selectors.
- Merchant history, filters, reports, imports, and reconciliation.
- Flexible budgets, savings goals, debt management, and cash-flow forecasting.
- Shared expenses, flexible splits, reimbursements, and settlement.
- Trip planning and dated currency conversion.
- Google sign-in, rich text editor, configurable settings, and the same moon/sun theme selector.

Reuse the verified TaskTracker stack and components after inspecting its repository. BudgetTracker has separate resources and financial data. The service offers budgeting functionality; product sales, eSIM offerings, and card issuance are excluded.

## Project documentation

- [Complete implementation brief](docs/PROJECT_BRIEF.md)
- [Requirement register](docs/REQUIREMENTS.md)
- [Project state and next steps](PROJECT_STATE.md)
- [Security and repository handling](SECURITY.md)
- [Agent instructions](AGENTS.md)

## Development and release

Feature branch → the BudgetTracker Static Web App's isolated `preview` environment → Terry’s review → approved Git merge → controlled Production release. A separate Staging app will be added later; Production and the `budget.remsik.org` DNS change only with Terry's explicit authorization.

Agents must not push to main, merge, or deploy Production. Local commands are below.

## Public repository and private data

This repository contains code and safe documentation. Credentials, real financial records, receipts, exports, backups, and runtime data must never be committed. Maintain [.gitignore](.gitignore), inspect staged changes, and implement automated secret scanning before application development. Ignored files can still be force-added, and ignore rules do not remove tracked files or Git history.

## Documentation maintenance

Update this README and PROJECT_STATE.md when behavior, setup, validation, or deployment changes. Keep planned features distinct from implemented ones. Maintain .gitignore when tooling or data paths change, and keep the GitHub About description aligned with the service’s actual scope.

Suggested GitHub About description:

> Privacy-first budgeting service with accounts, debt tracking, forecasting, trip planning, shared expenses, and multiple currencies.

## Local foundation checkpoint

**Agents.** Nine role definitions are generated from `scripts/setup-project-agents.py`, for both Codex (`.codex/agents/`) and Claude (`.claude/agents/`), together with five supporting procedures. See [.codex/agents/README.md](.codex/agents/README.md) and the [validation evidence](docs/AGENT_VALIDATION.md).

**One-time setup per clone.** Enable the staged-content scan:

```powershell
git config core.hooksPath .githooks
```

The hook runs `node scripts/scan-staged.cjs`, which checks staged paths and content and runs gitleaks when it finds it in `.local/bin` or on PATH.

**Commands** (Node 22):

```powershell
npm ci --prefix api        # install API dependencies
npm test                   # repository, API and app tests
npm run validate           # route registry, SWA config, versions, forbidden APIs, ignore rules
npm run generate:functions # regenerate api/<route>/function.json and index.js from the registry
```

**What is built so far.** API: identity, workspaces, members, invitations, grants, contacts, people selectors, preferences, site settings, audit, accounts, merchants, categories (with colours), transactions (amendments and reversals), recurring bills, budgets, forecast and what-if, backups and restores, and workspace settings (policy choices such as Shared expenses on or off, who may change others' entries or manage shared lists, member restores, and budget and bill defaults — each defaulting to the earlier fixed behaviour; BT-011-07..13). Web app: dashboard, transactions, bills, planning, accounts, merchants, workspace and settings, and a staging (preview) link in the account menu whose address each person sets in My settings or inherits from the site (BT-011-06; the app never hard-codes the address; https only, plus http to 127.0.0.1, [::1] or localhost when running locally). The legacy `lib/foundation.cjs` prototype remains for reference only; the API supersedes it.

**What is not built yet.** The Tiptap editor, receipts and attachments, imports and reconciliation, shared expenses and settlement, trips and currency conversion, debt planning, goals and alerts, reports and exports, offline use, scheduled backups, and the partitioning in ADR-003. See the requirement register.

Never connect any of this to real financial data.

**Remote controls.** `main` is protected: a PR is required, the `secret-scan` and `foundation-tests` checks must pass, the rule is enforced for admins, and force-push and deletion are blocked. Dependabot security updates are enabled.

**Deployment.** See [Deployment](docs/DEPLOYMENT.md): one BudgetTracker Static Web App with an isolated preview environment. Production and the `budget.remsik.org` DNS require Terry's explicit authorization.

**Local runtime (fictional data only).**

```powershell
npm run seed:dev   # once: fictional household in .local/dev-data (refuses if data exists)
npm run dev        # http://127.0.0.1:4380 — pick a fictional user on the local sign-in page
node scripts/dev/screenshot.mjs --user alice --out .local/shots --interact menu,quick   # headless Edge evidence
```

The dev server binds 127.0.0.1 only and uses file storage under the ignored `.local/`. It refuses to start where Azure environment markers exist. Its sign-in page offers fictional identities and exists only locally; the API itself has no bypass. Never use or stop ports 4280, 7071 or 10000–10002: they belong to another local application. Set `BT_DEV_PORT` to use a different free port, and `BT_DEV_DATA_ROOT` (a directory inside `.local/`) to give a server and the seed their own data.

**Multi-user browser tests (BT-004-06, fictional data only).** `npm run e2e` starts its OWN dev server on a free port with freshly seeded fictional data under `.local/e2e/<run>/`, opens one headless Microsoft Edge per fictional user at the same time (alice owner, bob member, carol viewer, dave site administrator, eve outsider; each with its own throwaway profile, debugging port and sign-in), runs the scenarios and prints PASS, FAIL or SKIP for every check with the expected and actual values. Screenshots, `server.log`, `seed.log` and `results.json` stay in `.local/e2e/<run>/`; the browser profiles and the run's data are removed, and the run reports every PID it started and proves none is still running. It exits non-zero on any failure or incomplete cleanup. It needs Edge (set `BT_EDGE_PATH` if it is installed elsewhere), so it is not part of `npm test`.

```powershell
npm run e2e                             # every scenario
npm run e2e -- --only privacy,shared    # privacy, shared (or group), concurrency, guards, dropdown, staging, recheck, settings, move
npm run e2e -- --list                   # what each scenario checks
npm run e2e -- --keep-data              # keep .local/e2e/<run>/data for inspection
```

Scenarios live in `scripts/dev/e2e/`, the library in `scripts/dev/harness/`: a session per user with a small page API (open, goto, reload, useWorkspace, click by role and name or by text, fill by label, real key presses, choose in a command picker, read text and the accessibility tree, screenshots, console errors and failed requests) and a direct API client per user that sends the app's CSRF header and Idempotency-Key, for firing parallel requests. It never uses ports 4280, 4380, 7071 or 10000–10002 and never reads or writes Terry's `.local/dev-data`. Reviewers and implementers verify interface and multi-user claims with it on their own isolated server.

**Further documentation.** The [foundation design](docs/FOUNDATION_DESIGN.md), [recovery procedure](docs/RECOVERY_RUNBOOK.md), [TaskTracker inventory](docs/TASKTRACKER_REUSE.md) and [Word comparison](docs/BRIEF_RECONCILIATION.md) record decisions and gaps. See PROJECT_STATE.md for current status and next steps.
