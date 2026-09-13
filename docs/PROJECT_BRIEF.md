# Budget Tracker Project Creation Instructions

Prepared for Terry • 13 September 2026 • Version 1

Create a feature rich, privacy focused budgeting application for individuals, couples, households, and travel groups. Reuse the established TaskTracker technologies and proven components while building a separate financial application. This brief is the implementation instruction set for either Claude or Codex; it does not authorize a Production deployment.

### Service scope

Offer Budget Tracker itself as a service. Do not include product sales, affiliate offers, advertising of financial products, card issuance, or eSIM offerings. Optional integrations exist only to support the budgeting service. Service billing and pricing require a separate scope decision; do not invent a monetization model.

### Product outcome

Users must be able to record spending quickly, understand merchant history, manage accounts and debt, plan budgets and trips, split shared expenses, settle balances, and forecast future cash availability. Financial accuracy and restrictive permissions are release requirements.

### Mandatory instructions

- Store all project source code, configuration templates, infrastructure definitions, migrations, tests, build scripts, and project documentation in a dedicated Git repository. Git is the authoritative code store.

- Inspect TaskTracker before selecting dependencies. Reuse its actual frontend approach, Azure Static Web Apps, Functions/API patterns, Tiptap editor, settings, authentication, contacts, membership, attachment handling, and local development tooling where appropriate. Do not assume an unverified framework or copy financial access rules blindly.

- Use Google authentication. Keep Budget Tracker resources, credentials, financial records, and deployments separate from TaskTracker.

- Make every new financial record private by default. Public sharing can exist only as an explicitly enabled capability and explicit publication action.

- Implement the full agreed scope through manageable increments. An initial release is a delivery milestone, not permission to discard remaining requirements.

- Exclude eSIM offerings. Card issuance is not part of the project; optional bank or payment integrations are separate financial capabilities.

### First implementation deliverables

Create the repository scaffold, a TaskTracker reuse inventory, an architecture decision record, a canonical requirement register, a data and permission model, a phased implementation plan, and a running local application with fictional seed data. Confirm the target repository and Azure environment from available configuration; ask only for missing information that genuinely blocks the next action.

## Git and delivery controls

### Repository and project state

- Use a dedicated BudgetTracker repository. Do not repurpose or modify TaskTracker to host this application. If no remote is available, initialize local Git and identify the missing remote; never imply that local commits have been remotely backed up.

- Commit canonical requirements under docs/PROJECT_BRIEF.md and docs/REQUIREMENTS.md. Keep PROJECT_STATE.md current with the active branch, last completed work, open items, blockers, validation evidence, and exact next steps. Maintain CLAUDE.md and AGENTS.md with the same operational constraints.

- Assign a stable BT requirement identifier to every feature and significant defect. Record its acceptance criteria, dependencies, status, affected files, commit or PR, and verification. Mark partially implemented work accurately.

- Keep secrets, connection strings, actual financial exports, receipts, user information, backups, and generated runtime data out of Git. Include safe environment templates and ignore rules.

- Record schema versions, migration instructions, setup and local-start commands, architecture decisions, and recovery instructions in the repository. Keep this Word brief as a reference; update the canonical Git brief as decisions evolve.

### Release pathway

Work on feature branches and submit pull requests. Deploy the candidate branch to Azure Staging, allow Terry to review it, and promote through an approved Git merge and controlled deployment workflow. The implementation agent must not push to main or deploy Production. Terry controls the merge and release authorization.

- Protect main against direct pushes and require appropriate checks. Enforce protections through remote repository settings and deployment identities, not instructions alone.

- Keep Staging and Production storage, blobs, credentials, and data completely separate. Staging uses fictional data unless Terry explicitly authorizes a carefully controlled alternative.

- Tie every release to a Git commit and application version. Show the version and environment in the application. Define rollback and schema compatibility before release.

- Use narrowly scoped deployment permissions. If branch protection or environment setup is unavailable, report that enforcement is pending and do not describe it as completed.

### Autonomous implementation

Proceed with authorized local work, feature-branch development, reversible fixes, and appropriate validation without repeatedly requesting permission. Preserve the main and Production restrictions. Report a real blocker with its requirement identifier, the evidence, and the smallest action needed to resolve it. Run focused checks for the change; broader reviews are appropriate for financial calculations, permissions, migrations, and release milestones rather than every commit.

## Identity ownership and privacy

### Identity and people

Google sign-in establishes identity; it grants no access to another person’s finances. Identify members using verified provider identities. Keep user profiles, contacts, financial account owners, payees, and workspace members distinct. A contact or an unregistered trip participant can exist without gaining application access.

### Permission boundaries

- Support personal and shared workspaces. Within a household, allow private individual accounts and explicitly shared joint accounts or expenses. Workspace membership must not automatically expose private account balances or purchases.

- Define capabilities for viewing balances, viewing transactions, creating, editing, deleting, commenting, downloading receipts, exporting, inviting members, changing permissions, and publishing. Provide restrictive role presets and explicit account or resource grants.

- A workspace owner manages shared workspace records and membership; ownership must not silently grant access to separately private personal accounts. Site administrators manage the application without automatic financial access through application roles.

- Check permissions on every server request and background task. Apply the same scope to search, autocomplete, reports, aggregates, exports, notifications, deep links, attachment downloads, and offline synchronization.

- Provide a Who can see this view, invitation access preview, and audited permission changes. Revocation must block future retrieval and reject unauthorized queued writes when reconnecting. Warn that previously downloaded or exported copies cannot be remotely recalled.

- Shared expenses expose only the agreed group details; conceal private source-account identifiers, balances, unrelated transactions, and private notes. Never expose hidden spending through totals or suggestion lists.

### Security and data protection

- Use private attachment storage, authenticated access, encryption in transit and at rest, secure secrets management, and safe session handling. Sanitize and validate rich text on the server.

- Exclude financial details from routine logs and default email or push notifications. Prevent sensitive cross-user browser caching; clear locally cached data on sign-out and apply a documented device-storage policy.

- Make external AI, receipt processing, bank connections, and public publication opt-in. Explain what data is sent and to whom. Exchange-rate lookups need currency codes and dates, not transaction details.

- Separate application permissions from operator infrastructure access. Document the threat model and key ownership. If operator-blind storage is required, design client-controlled encryption and its effects on search, collaboration, recovery, and forecasting before promising it.

## Security backups and recovery foundation

### Build security before feature modules

Security is the primary foundation of this service. Implement the identity, authorization, secret management, data isolation, audit, backup, and restore controls in the first delivery phase. Do not defer recovery until after budgeting features or allow incomplete security controls into Production.

- Document threats and trust boundaries covering account takeover, malicious members, cross-workspace access, compromised devices, operator access, stolen backups, and destructive changes. Apply least privilege to users, service identities, deployment workflows, and backup operators.

- Validate trusted authentication claims server-side; do not trust browser-supplied roles or user identifiers. Protect sensitive actions with reauthentication where appropriate. Define session expiry, revocation, rate limits, and abuse controls.

- Use secure cookies and transport, request validation, upload size and type controls, safe rich-text rendering, dependency scanning, and automated secret scanning. Record actionable security events without logging financial content.

- Maintain a permission matrix and negative access tests as release gates. Require documented resolution of critical security defects before release.

### Backup requirements

- Automate versioned backups and offer authorized on-demand backups before destructive operations or migrations. Capture consistent financial data, attachments, permission grants, ownership, schema version, and required configuration metadata. Never put secret values into general exports.

- Encrypt backups and restrict access independently from ordinary application access. Maintain a separately protected recovery copy or immutable retention mechanism so deletion or compromise of live storage cannot erase every recovery point.

- Define configurable schedules, retention, recovery point objective, and recovery time objective. Record achieved values through restore drills rather than claiming targets have been met without evidence.

- Monitor backup completion, integrity, and attachment completeness. Alert authorized operators on failure and show last successful backup and recovery-test status without exposing financial details.

### Restore requirements

- Restore into an isolated environment first to validate archive integrity, schema compatibility, account balances, attachments, and permissions. Conduct periodic end-to-end recovery drills and record duration and results.

- Provide workspace-level recovery and service-level disaster recovery with distinct privileges. Restoring data must never resurrect revoked access silently or copy another workspace’s grants into a new owner’s workspace.

- Offer explicit create-new, merge, and replace operations where appropriate. Show a nonmutating preview of counts, conflicts, duplicate handling, permissions, and deletions. Require appropriate confirmation for destructive replacement and create a pre-restore recovery point.

- Use staged or recoverable restore execution. A failed restore must not leave an undisclosed partially overwritten workspace. Return clear in-modal errors and provide a safe restart path.

- Test corrupt archives, incompatible schemas, missing attachments, interrupted restores, malicious uploads, conflicting identifiers, expired grants, and full service recovery. Provide a Git-tracked recovery runbook.

## Accounts and everyday transactions

### Financial records

Support checking, savings, cash wallets, credit cards, loans, mortgages, merchant credit, investments, and custom account types. Model banks and lenders as institutions and merchants, utilities, landlords, and people as payees. A merchant is not automatically a financial account.

- Store account currency, ownership, opening balance and date, status, optional masked identifiers, and relevant type-specific fields. Credit cards need limits, statement dates, due dates, minimum payments, and promotional terms. Loans need principal, interest terms, payment schedule, and term.

- Payees need names and aliases, optional contacts, default category, permitted payment-account suggestions, notes, and relevant recurring arrangements. Restrict discovery and suggestions to authorized records.

- Transactions include original amount and currency, payee, purchase and posting dates, account, category and subcategory, tags, responsible person, status, notes, attachments, split allocations, and links to bills, debts, trips, or reimbursements.

- Support expenses, income, transfers, refunds, partial refunds, fees, reimbursements, advances, adjustments, and recurring entries. Track pending, cleared, and reconciled states.

### Fast expenditure entry

- Provide desktop and mobile quick entry, transaction duplication, templates, and an inline calculator. Select a payee to suggest category, account, currency, usual amount, tags, recurring schedule, and split presets.

- Explain autofill suggestions, keep every suggested value editable, and never silently save guesses. Use only authorized history.

- Allow split categories, split people, receipt attachment, and optional receipt extraction with a confirmation preview. Support merchant alias rules and automatic categorization with review and correction.

- Provide CSV and supported bank-file imports with column mapping, account selection, preview, validation, duplicate detection, and a clear in-modal error and retry path.

### Merchant history and retrieval

Every payee must have an authorized transaction history with dates, amounts, currencies, accounts, categories, refunds, notes, and receipts. Filter by merchant, person, account, category, tags, date range, amount range, trip, recurring status, and reconciliation state. Save views, sort results, and export only permitted data. Report gross purchases, refunds, and net spending separately.

## Budget debt and forecasting

### Budget methods

- Support category budgets, envelope or zero-based budgets, paycheck-based planning, weekly or custom periods, rollovers, sinking funds, savings goals, and irregular income.

- Compare planned, committed, and actual spending. Explain Available to spend using upcoming obligations, reserved savings, and the user’s safety buffer. Show the calculation and avoid counting commitments again after they become actual transactions.

- Offer dashboard customization, upcoming bills, category warnings, unusual charges, subscription renewals and increases, goal progress, and authorized household summaries.

### Debt management

- Track principal, interest, fees, payment history, remaining balance, minimum payments, promotional expiry, and planned extra payments. Support installment plans and loans owed to or by people.

- Compare snowball, avalanche, and custom payoff scenarios, including estimated payoff dates and interest saved. Show rate and schedule assumptions and reconcile projections with lender statements.

- Split loan payments into principal, interest, and fees. Treat principal reduction as debt movement and interest or fees as expenses. A credit-card purchase is spending; paying the card must not count as spending again.

### Forecast and scenarios

- Forecast account balances by date for 30, 60, 90 days and a year. Include current balances, expected income, bills, debt schedules, savings transfers, and planned purchases.

- Distinguish confirmed commitments, estimates, and discretionary scenarios. Show assumptions, last-updated dates, conservative and optimistic alternatives, and forecast versus actual results.

- Warn when projected balances fall below a configured buffer. Allow what-if changes to income, purchases, debt payments, trip costs, and exchange rates.

- Keep scenarios separate from actual records. Applying a scenario requires an explicit action and must not create duplicate transactions or commitments.

### Reporting

Include spending trends, income versus expenses, cash flow, category comparisons, recurring costs, unreimbursed expenses, debt progress, savings progress, account balances, and net worth. Provide drill-down to permitted source transactions and make exclusions or incomplete data clear.

## Shared expenses and settlement

### Tricount inspired feature baseline

Build collaborative group expense entry, unequal splitting, group balances, payment requests, multicurrency totals, receipt and photo attachments, optional offline entry, spending insights, an inline calculator, and import support for available Splitwise exports. Implement equivalent budgeting functions in the project’s own design. eSIM offerings are excluded. Financial-provider integrations remain separately tracked optional features.

### Flexible allocation

- Split equally, by percentages, fixed amounts, weighted shares, or receipt line items. Choose the beneficiaries for every expense and support multiple payers.

- Allow saved split presets, couples or families paying as a unit, and participant-specific exclusions. Grouping must not merge members’ identities or private finances.

- Allocate tax, tips, discounts, fees, and refunds. Validate allocations against the expense total and show deterministic rounding adjustments.

- Track shared income, prepaid contributions, advances, deposits, reimbursements, partial settlements, and payment methods. Preserve who paid, who benefited, and the allocation history.

### Balances and repayment

- Show each participant’s total paid, allocated share, amounts received or repaid, and remaining net balance. Offer an understandable breakdown of the source expenses.

- Suggest settlements that reduce payment count while preserving net balances. Allow users to retain direct creditor relationships instead of accepting redistributed settlements.

- Create payment requests and configurable reminders. Keep suggested, requested, reported-paid, confirmed, and disputed states distinct. A payment request or outgoing link is not proof that money moved.

- Support settlements in an agreed currency, partial payments, corrections, and an audit trail. Actual payment processing requires a separately authorized provider integration.

### Personal and group accounting

Example acceptance rule: Terry pays EUR 300 for a shared dinner and his allocated share is EUR 75. His cash account decreases by EUR 300, personal spending is EUR 75, and EUR 225 is recorded as owed back to him. The group records one EUR 300 expense. Repayment clears the amount owed without creating new spending or ordinary income.

### Offline behavior

Make offline storage an explicit device preference. Protect cached data, label unsynced transactions, retry safely, resolve edit conflicts, and prevent duplicate submissions. Recheck authorization when reconnecting. Offline access cannot instantly reflect a revocation, so define cache expiration and disclose that limitation.

## Trip planning and currencies

### Trip workspace

Create a trip budget and ledger with destination, dates, participants, reporting currency, notes, and status. Optionally link real accounts, travel cash wallets, or savings funds. A planning workspace must not invent a bank balance or imply that money has been deposited.

- Plan flights, accommodation, meals, transport, activities, insurance, and contingency. Track each participant’s contribution, spending limit, and expected share.

- Calculate savings needed per paycheck before departure. Track bookings, deposits, outstanding balances, due dates, refunds, and cancellation notes.

- Show planned versus actual costs, remaining daily allowance, expected final cost, and projected individual shares.

- Move a planned item to a booking or payment through linked states without duplicating costs. Include before-trip, during-trip, and final settlement views.

- Close and archive a trip with final totals, unresolved amounts, and receipts. Trip membership never exposes unrelated personal finances.

### Currency converter and transaction rates

- Provide a standalone currency converter, trip reporting currency, account currencies, and personal display currencies. Support automatic dated rates and manual rates for actual exchanges or agreed group calculations.

- Preserve original amount, original currency, rate source, effective date, rate convention, and converted amount. Historical transactions must not change when current rates refresh.

- Distinguish indicative conversions from actual bank-posted charges. Record exchange fees separately and avoid counting the same charge twice.

- Show stale or unavailable rates; allow explicit manual fallback. Record settlement currency and the rate agreed for that settlement.

- Use currency-specific precision, including currencies without two decimal places. Assign rounding residuals deterministically and visibly. Keep forecasting rate assumptions separate from recorded transaction rates.

### Integration boundaries

External exchange-rate services receive only the information required for rates. Bank synchronization, receipt scanning, imports, and payment links must have explicit permissions, provider configuration, failure handling, duplicate controls, and visible connection status. Do not imply support for an unavailable provider or import format.

## Site workspace and personal settings

### Site administration

- Provide a dedicated Site Administration area for branding, enabled modules, authentication configuration, invitation policy, public-sharing availability, security requirements, upload limits, retention defaults, exchange-rate provider, editor defaults, maintenance messages, and backup policies.

- Protect administrator capabilities on the server. Store secrets in secure configuration and never return existing secret values to browser forms. Audit consequential changes.

- Reuse site announcement behavior where suitable, including rich text, versioned messages, and seen-state reset when a message changes. Operational administration does not confer financial access.

### Workspace and trip settings

- Allow reporting currency, categories, budget period, rollover behavior, split presets, member roles and grants, transaction approval rules, receipt policy, and shared notification preferences.

- Show clear permission summaries before changing membership or publishing. Separate operational ownership from access to private financial records.

- For public reports, require an explicit scope selection and publication preview. Default to aggregate or sanitized information, prevent accidental receipt or identity publication, and allow immediate revocation of future access.

### Personal customization

- Reuse TaskTracker’s light and dark modes and the same moon and sun selector, with a site default and a saved personal preference. Allow language, time zone, date and number formats, preferred display currency, dashboard widgets, default filters, favorite payees, quick-entry defaults, balance masking, editor toolbar, and notification preferences.

- Retain Tiptap Simple, Advanced, and customizable toolbar groups. Hiding buttons must not destroy existing formatted content. Use rich text for transaction notes, trip plans, account notes, and debt agreements.

- Show whether settings are inherited, customized, or locked. Site security requirements and permission boundaries cannot be weakened through a personal preference.

- Support safe reauthentication and draft preservation with a clear local-storage policy. Provide session and device controls appropriate to financial data.

### Contacts and membership

New contacts and members must become selectable in relevant expenditure and planning dropdowns: payee, paid by, split participants, responsible person, reimbursement recipient, and trip participant. Support searchable selectors with type labels and stable references; allow a contact without an invitation or login. Filter each selector by authorization and field role. A contact selected as Paid by represents a recorded payer, not authority to access or debit their account. Merge duplicate identities explicitly without losing historical references.

Provide private contacts and scoped shared contacts, invitations, membership removal, and ownership transfer. Represent nonregistered participants without publishing their details. Deleting or removing a person must preserve necessary historical financial attribution while following a documented privacy and retention policy.

## Architecture validation and completion

### Financial integrity and storage

- Use precise decimal or integer monetary arithmetic and explicit currency precision. Avoid binary floating-point balance calculations. Preserve transaction links, stable identifiers, and schema versions.

- Evaluate TaskTracker’s JSON/blob storage against financial consistency needs. If retained, implement version checks, idempotency, safe concurrent updates, recovery, and reliable linked transfers. Document limitations; a database change requires an explicit recorded decision rather than a silent stack substitution.

- Maintain traceable balance movements and corrective history. Reconcile bank statements, prevent silent overwrites, and provide recoverable deletion with appropriate controls.

- Back up financial records, attachments, membership, and required settings. Test restore in isolation. Import or restore previews must make no changes; merge, replace, and create-new options must perform exactly the selected operation and display errors inside the active modal.

### Required acceptance evidence

- Privacy: test cross-user and cross-workspace access denial for direct IDs, search, autocomplete, totals, exports, receipts, deep links, notifications, and queued offline writes. Test site-admin separation and private account boundaries.

- Arithmetic: test equal and unequal splits, multiple payers, refunds, rounding, credit-card payments, loan principal and interest, partial repayments, cross-currency settlements, and forecast commitment transitions.

- Reliability: test double submission, imports containing duplicates, concurrent edits, interrupted saves, backup/restore, and preview actions that must not mutate data.

- Usability: validate mobile expenditure entry, merchant history filters, accessible forms, editable autofill, actionable in-modal errors, settings inheritance, and trip settlement explanations.

- Release: record passing checks, known limitations, requirement status, candidate commit and version, and Staging isolation. A feature is complete only when its acceptance criteria are met; mocks and unavailable integrations remain labeled.

### Delivery sequence and definition of done

Deliver security, permissions, automated backups, and tested restores first; then accounts and transactions; budgets, debt, and forecasting; shared expenses, trips, and currencies; settings, reporting, imports, and offline behavior; and optional financial integrations. Keep all remaining requirements in the Git register and continue across increments. At each milestone update project state and provide a reviewable Staging candidate. Completion requires the full agreed scope or an explicitly documented scope decision by Terry.

### Reference material

Tricount feature reference: https://tricount.com/expense-tracker-features. Its listed features inform the shared-expense baseline; additional splitting, planning, privacy, and integrity requirements above are Budget Tracker requirements, not claims about Tricount.

Authorization reference: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html. Apply deny-by-default permissions and server-side checks on every request.
