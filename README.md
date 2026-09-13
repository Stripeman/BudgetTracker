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
