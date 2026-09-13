# BudgetTracker

Privacy-first budgeting service with accounts, debt tracking, forecasting, trip planning, shared expenses, and multiple currencies.

## Status

Project requirements and repository foundation are prepared. The application is not implemented or deployed yet. Security, restrictive permissions, encrypted backups, and tested restores are the first implementation milestone.

## Planned capabilities

- Personal, household, and trip workspaces with explicit sharing.
- Accounts, institutions, payees, contacts, and members.
- Fast expenditure entry with editable autofill and searchable contact/member selectors.
- Merchant history, filters, reports, imports, and reconciliation.
- Flexible budgets, savings goals, debt management, and cash-flow forecasting.
- Shared expenses, flexible splits, reimbursements, and settlement.
- Trip planning and dated currency conversion.
- Google sign-in, TaskTracker rich text editor, configurable settings, and the same moon/sun theme selector.

Reuse the verified TaskTracker stack and components after inspecting its repository. BudgetTracker has separate resources and financial data. The service offers budgeting functionality; product sales, eSIM offerings, and card issuance are excluded.

## Project documentation

- [Complete implementation brief](docs/PROJECT_BRIEF.md)
- [Requirement register](docs/REQUIREMENTS.md)
- [Project state and next steps](PROJECT_STATE.md)
- [Security and repository handling](SECURITY.md)
- [Agent instructions](AGENTS.md)

## Development and release

Feature branch → isolated Azure Staging → Terry’s review → approved Git merge → controlled Production release.

Agents must not push to main or deploy Production. Remote branch protection and environment controls still need configuration; documentation alone does not enforce them. Local start commands will be documented when the implementation exists.

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
npm test                   # repository tests plus API tests (permission matrix, ledger, money, storage)
npm run validate           # route registry, SWA config, versions, forbidden APIs, ignore rules
npm run generate:functions # regenerate api/<route>/function.json and index.js from the registry
```

**What the API covers so far.** Identity, workspaces, members, invitations, grants, contacts, people selectors, preferences, site settings, audit, accounts, payees, categories and transactions. The legacy `lib/foundation.cjs` prototype remains for reference only; the API supersedes it.

**What is not built yet.** Frontend, local dev server, backups and restores.

Never connect any of this to real financial data.

**Remote controls.** `main` is protected: a PR is required, the `secret-scan` and `foundation-tests` checks must pass, the rule is enforced for admins, and force-push and deletion are blocked. Dependabot security updates are enabled.

**Deployment.** See [Deployment](docs/DEPLOYMENT.md): one BudgetTracker Static Web App with an isolated preview environment. Production and the `budget.remsik.org` DNS require Terry's explicit authorization.

**Local runtime (fictional data only).**

```powershell
npm run seed:dev   # once: fictional household in .local/dev-data (refuses if data exists)
npm run dev        # http://127.0.0.1:4380 — pick a fictional user on the local sign-in page
node scripts/dev/screenshot.mjs --user alice --out .local/shots --interact menu,quick   # headless Edge evidence
```

The dev server binds 127.0.0.1 only and uses file storage under the ignored `.local/`. It refuses to start where Azure environment markers exist. Its sign-in page offers fictional identities and exists only locally; the API itself has no bypass. Never use or stop ports 4280, 7071 or 10000–10002: they belong to another local application. Set `BT_DEV_PORT` to use a different free port.

**Further documentation.** The [foundation design](docs/FOUNDATION_DESIGN.md), [recovery procedure](docs/RECOVERY_RUNBOOK.md), [TaskTracker inventory](docs/TASKTRACKER_REUSE.md) and [Word comparison](docs/BRIEF_RECONCILIATION.md) record decisions and gaps. See PROJECT_STATE.md for current status and next steps.
