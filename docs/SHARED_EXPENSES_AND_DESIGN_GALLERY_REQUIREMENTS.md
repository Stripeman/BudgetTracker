# Expanded Shared Expenses and Design Gallery requirements

**Source:** Terry, verbatim instruction delivered directly in a work session, 2026-09-19.
Recorded here in full so this scope does not depend on chat history and is never again
reported as missing (it had been asked for, unanswered, across six checkpoints — AM through
AR — before this message arrived). This document is the canonical reference; `docs/REQUIREMENTS.md`
tracks the stable `BT-` identifiers this scope is broken into and their status, and links back
here rather than repeating the full text.

Nothing in this document authorizes resuming BT-007 or BT-010 while they are ON HOLD.
Existing reusable currency primitives (`api/_shared/money.js`) may be used without implementing
the held trip-planning module (BT-010).

This message also authorized the described implementation and Preview verification within the
implementing agent's permitted role. It does **not** authorize a new `main` merge or Production
deployment, nor bypass any tool-enforced restriction (merging PRs and deploying Production remain
Terry's own actions).

---

## 0. Reconciliation instruction

Main was independently inspected at `ec9de2969d470a16483eb37eaea7b9911f896e42` (merges PR #32).
No open GitHub PRs or issues were found at that check. Already implemented on that `main` and
**not to be rebuilt**:

- BT-018: "Add as bill" from a transaction.
- BT-016: "Add person" from the shared-expense dialog.
- BT-009-15: contact-to-member continuation, including the frontend.
- BT-015: compact four-dot action menus.
- BT-009-13: multi-currency expense **backend**, but NOT the complete user-facing feature.
- BT-017: partial settings improvements.
- BT-013: the existing gallery and earlier composition, typography and chart improvements —
  not the replacement design work specified in section 5 below.

Verify and preserve these, complete their actual remaining gaps, and keep independent-review
gaps visible rather than claiming a review happened when it did not.

## 1. Immediate priority: finish multi-currency safely

Before considering BT-009-13 complete, a specific source-level concern had to be investigated
and regression-tested:

> The shared-expense editor in `app/js/ui/views/group.js` initialized its amount from
> `expense.amount` and its currency from `expense.currency` — the converted reporting
> figures — and submitted that amount when saving a correction. The `expenseMoney` logic in
> `api/group/handler.js` interprets a submitted correction amount in `rec.original.currency`
> when `original` exists, reusing the original rate. Consequently, a USD 100 expense converted
> to EUR 92 was capable of being resubmitted as 92 USD and converted again, even when the user
> only intended to change its description. Multiple-payer and exact-split cases could instead
> fail validation.

This had to be reproduced through the real UI and fixed **at its root contract**, tested for:
description-only corrections, unchanged amounts, intentional amount changes, multiple payers,
and every split method. No correction may silently convert an already-converted amount again.

Then, to actually complete BT-009-13 as a user-facing feature (not just a backend capability):

- Original-currency amount entry, currency selection, exchange rate, rate source and effective
  date, in the actual expense dialog.
- Clearly labelled original and reporting amounts in forms, details, history and relevant
  exports.
- Correct payer/split units and an understandable converted-share preview.
- Historical rate preservation; later rate changes never silently revalue recorded expenses.
- Safe corrections using the original values.
- Dedicated browser tests and financial review.

Expense conversion and settlement in a different currency are explicitly separate capabilities.
Both are not "complete" merely because expense conversion exists. Multi-currency settlement
(`settlementCurrency()`) already accepted the reporting currency or any currency with an open
balance before this work and is a pre-existing, separate capability.

Preview's actual deployed commit must be verified directly (`GET /api/site-settings`'s public
`app.commit` field, or the deploy engine's own health check), never assumed from stale
`PROJECT_STATE.md` wording. The established `deploy.ps1` workflow is the only supported way to
redeploy; a known financial regression is never deployed, even to Preview.

## 2. Work sequence and completion discipline

After the immediate multi-currency fix:

1. Resolve the multi-currency integration concern and finish BT-009-13 end to end.
2. Finish remaining unblocked work from the previously authorized batch: BT-017 and outstanding
   BT-009, BT-011, BT-013, BT-014 and BT-015 requirements.
3. For Shared Expenses, reconcile BT-009-11 and BT-009-14 with the expanded requirements in
   section 4 below. Implement the event foundation (section 4) before extensions that would
   otherwise need rework.
4. Complete the replacement Design Gallery described in section 5.

BT-009-11 and BT-009-14 are not to be re-asked about; use dependency order, record the chosen
order, and proceed. Broad umbrella rows (like the original BT-009-11) are split into testable
sub-items instead of being treated as one undefined block of scope.

A genuinely blocked dependency (BT-007, BT-010 on hold) does not stop unrelated authorized work.
Held items stay held; specific blockers are explained without discarding the requirements they
block.

**"Backend built," "tests pass," "merged," "deployed," "browser verified," and "accepted by
Terry" are different states, tracked separately** — never collapsed into a single "done."

## 3. Shared Expenses: a flagship feature

The current single workspace-wide ledger is not the finished product. The target: **multiple
named events running concurrently within an appropriate workspace**, with a clear way to finish
and retain each event.

### Events and lifecycle

- An event directory with search, filters and Active/Closed/Archived views.
- Each event has its own stable ID, name, description, icon/colour, participants, expenses,
  settlements, reporting currency and relevant dates. An overview plus clearly organized
  expense, participant, balance, settlement and history views.
- **Active:** new expenses and settlements allowed according to permissions.
- **Closed:** no new expenses; outstanding balances remain visible; settlement/dispute
  resolution remains possible.
- **Archived:** read-only and searchable; history and outstanding balances retained.
- Reopening/restoring requires the appropriate permission and is an audited action. Expense
  corrections on a closed event require reopening it first.
- "Settled" is a balance condition, never a substitute for event status.
- Closing or archiving never forgives debt, erases history, or forces balances to zero.
- No new workspace is required for every dinner, outing or event.
- Templates may copy reusable setup and split preferences, but must never duplicate financial
  records or silently recreate invitations and access grants.

### Participants and access

- Reuse the existing Add person/contact flow and contact-to-member continuation (BT-016,
  BT-009-15). Preserve previously entered form data when adding someone inline.
- Distinguish three different things clearly, everywhere:
  1. A contact included in calculations without a login.
  2. An invited person authorized to view shared information.
  3. An authenticated contributor authorized to add or change records.
- A name or email alone grants no access and sends no invitation.
- For external collaborators who need to sign in, use (or offer creation of) an appropriate
  dedicated `group`/`trip` workspace. Never invite them into a personal banking workspace as a
  shortcut.
- Multiple events within one workspace are organizational boundaries, **not automatically
  separate security boundaries**. The real visibility scope must be explained before inviting
  someone. If existing workspace membership exposes every event, that must be said clearly —
  never implying event-only access unless it is actually enforced on every backend path.
- Invitations must be identity-bound, expiring and revocable. Contact history and balances are
  preserved when someone joins. Never expose unrelated private accounts, contacts, transactions
  or other workspaces.

### Expense entry and splitting

Preserve existing capabilities (BT-009-01 through -10, -12, -13) and complete the remaining
applicable BT-009 requirements:

- Equal, exact-amount, percentage and weighted-share splits (already built).
- Multiple payers and selected participant subsets (already built).
- Fixed allocations plus a split remainder.
- Saved split presets and couples/families paying as a unit.
- Itemized receipt allocation, tax, tips, discounts and fees.
- Refunds linked to the original expense.
- Shared income, prepaid contributions and deposits with clear accounting.
- Merchant references, categories, dates, notes and securely authorized receipts.
- Editable defaults, clear validation, and a preview showing that allocations reconcile exactly
  (already built for the existing split methods).
- Deterministic rounding with visible residual allocation (already built).
- Duplicate/retry protection (already built — idempotency keys).

Reuse established merchant handling and stable IDs (BT-007-01); never invent a second,
incompatible merchant model. Respect the BT-007 hold otherwise.

Complete receipt support through the existing attachment architecture where suitable; never
merely add a file control without secure storage, retrieval, export and deletion handling.

Retain offline entry, import, reminders, payment requests and group insights as explicit
tracked requirements. Implement where authorized and unblocked; identify dependencies rather
than silently dropping them.

### Balances, settlement and personal accounting

- Show what each participant paid, their share, reimbursements and remaining balance, scoped to
  the event and currency.
- Support partial settlements, reported/confirmed/disputed/voided states, and understandable
  minimized-payment suggestions (all already built at the workspace-wide level; needs
  event-scoping). Never automatically net unrelated events together.
- Record payment date, method and reference where appropriate. Recording a settlement is never
  the same as processing a payment.
- For currency conversion, preserve original amount, currency, rate, source and date (BT-009-13).
  Clearly distinguish reporting conversion (an expense recorded in a foreign currency) from
  settlement conversion (paying off a balance in a different currency, already built,
  `settlementCurrency()`). Use existing manual/agreed-rate infrastructure while BT-010 stays held.
- Optional private-account integration must keep cash paid, personal spending, advances,
  payables and repayments correct without double counting. Never mutate another person's private
  ledger.

### Migration and data safety

- Migrate existing workspace-wide shared-expense records into one clearly identified
  legacy/default event per workspace. Never guess historical event boundaries.
- Preserve amounts, participants, amendments, settlement states and private-ledger relationships.
  The migration must be versioned, idempotent, tested and recoverable.
- Never allow moving records between events to break settlements, participant history or ledger
  links. Explain and block unsafe moves.
- Preserve existing permanent-deletion safeguards and audit requirements (BT-014); event
  lifecycle work must never weaken them.

### Exports and recovery

Authorized event exports: PDF report; CSV (packaged as separate dataset files where necessary);
XLSX with separate worksheets per relevant dataset; versioned JSON. (The existing
`api/_shared/sharedexport.js`, BT-014-06, already provides all four formats at the workspace
level — this scopes the same capability per event.)

Reports are not automatically restorable backups. Any backup/restore capability must validate
relationships, amounts, attachments and schema compatibility, and must never reactivate old
invitations or revoked permissions.

### Planning scope

Event metadata and organizational features stay distinct from BT-010 trip planning.
Planned-versus-actual budgets, commitments and trip-planning extensions are tracked, but any
work belonging to held BT-010 stays on hold. Ordinary event creation and lifecycle must never be
blocked on trip planning.

## 4. Design Gallery: replacement designs, not another claim that the old gallery is finished

The existing 15 concepts are **not accepted as completion** of the requested redesign.

The existing gallery's useful infrastructure and real structural variety are preserved, but the
deliverable is **at least 15 substantially redesigned, polished, visually and functionally
distinct options**, based on Terry's reference screenshots (`docs/BudgetTracker-references.html`
and the other supplied local documents — gitignored, local-only, never committed; if a
reference is genuinely unavailable, the exact missing file must be identified rather than
guessed around).

Shared components are welcome; fifteen separate codebases are not required. Recombining the
same patterns, changing palettes, or assigning different fonts does **not** by itself satisfy
this request. Each option needs deliberate art direction: navigation and information hierarchy;
page composition and density; typography and spacing; colour and contrast; meaningful charts,
metrics and graphics; clear primary actions and comfortable mobile interaction.

### Required page coverage

Each design must work coherently beyond its dashboard: Dashboard; Transactions; Bills; Budgets;
Accounts; Merchants; Shared-expense event directory and event detail; My Settings and Workspace
Settings.

Trips may remain clearly labelled illustrative content while BT-010 is held — never implement
the held module merely to populate a gallery page.

Settings require real, usable layouts and representative controls — not a generic read-only
label/value summary presented as the finished design.

Show realistic synthetic data, meaningful empty states, long labels, validation errors, overdue
states and mobile layouts. Demonstrate important interactions using isolated sample state.
Buttons must either work within the prototype or be explicitly identified as unavailable — no
silent no-op "Add expense" controls.

All dropdowns and action menus must overlay without pushing surrounding content. Preserve the
four-dot action pattern (BT-015), accessible keyboard behavior, the moon/sun appearance control
(BT-011-01), colour/icon pickers (BT-011-03/04/05) and curved-left-accent information styling.

### Review and selection

Keep the gallery private and synthetic-data-only. Preserve comparison, favourites and selection
functionality. Inspect any existing saved selections without assuming they were lost or
approved. A materially redesigned concept needs a clear version/identity; an old favourite must
never silently become approval of a replacement.

For each design: desktop/mobile and light/dark previews, a concise explanation of its
differences, and representative working interactions. A comparison matrix demonstrating
substantial differences in navigation, composition, density, visual identity and task flow —
not merely different names and colours.

Verify all 15 across the required pages in a real browser, including accessibility checks and
an independent design/accessibility review when available. Automated structural checks do not
establish that a design looks polished.

Classic stays intact. Actual workspace layout settings currently offer only Classic; gallery
selection is not the same as applying a layout. After Terry chooses which completed designs to
keep, integrate those choices into the real workspace setting while preserving every feature and
permission. His final selection is an expected user decision, not permission to stop before
producing the choices.

## 5. Settings and regression acceptance

Complete BT-017's remaining visual work. My Settings and Workspace Settings should be
task-oriented, professional and easy to scan: clearly separated personal versus workspace scope;
two columns where useful on desktop, one on mobile; full-width treatment for complex controls;
consistent labels, spacing, help and save/error states; findable sections and a separate
destructive-actions area; no lost settings, permission changes or inaccessible controls.

Preserve and regression-test the Bills merchant flow: searchable existing merchants, persistence
of manually entered merchant names, pending merchants listed by merchant name rather than bill
title, and "Add merchant" opening the existing modal prefilled and linking the resulting record.

## 6. Evidence, documentation and release boundaries

For completion at any checkpoint, report: requirements completed and genuinely remaining;
relevant commits and PRs; tests executed and actual results; browser evidence for complete user
workflows; independent review findings and unresolved risks; verified Preview commit and
deployment status.

Preserve the public-repository secret/privacy safeguards. Never commit Terry's private
screenshots, identity or financial data. Use only the established `deploy.ps1` workflow and the
existing Preview environment; never create another Static Web App.
