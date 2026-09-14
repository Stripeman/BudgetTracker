# Foundation design — BT-001-01 / BT-002-01

Status: local prototype design; no application authentication, database or Azure resource is operational.

## ADR-001: reuse and consistency

Retain the verified browser ES-module and Node/CommonJS API approach from TaskTracker. Do not copy its administrator elevation, invalid-JSON fallback or archive grant restoration. Defer the durable datastore choice until transactional linked writes, idempotency, corruption refusal and consistent snapshots are demonstrated. No silent SQL substitution. Prototype recovery uses an already consistent snapshot supplied by the caller; it cannot establish consistency across live blobs.

## ADR-002: API foundation and financial persistence (accepted 2026-09-13, BT-001/BT-006)

- **Runtime.** Azure Static Web Apps with managed Azure Functions (v3 function.json model, CommonJS), as TaskTracker does. `api/_shared/routes.js` is the route registry; `scripts/generate-functions.cjs` generates the bindings; `scripts/validate.cjs` checks registry, bindings, SWA config, versions and forbidden APIs.
- **Identity.** `api/_shared/identity.js` is the only adapter. It trusts only the SWA `x-ms-client-principal` header from allowlisted providers (`google` by default). It requires the `authenticated` role, a valid user id and email. It outputs a frozen null-prototype principal whose subject is `provider:userId`. Site administration comes from `BT_SITE_ADMINS`, is re-read per request, and never feeds financial authorization. State-changing requests require `X-BT-Request: 1` as the CSRF defense.
- **Storage.** One interface with memory (tests), file (local development only; refused when Azure markers are present) and Azure Blob (deployed) backends. Unparseable JSON is refused (`storage_corrupt`), unlike TaskTracker, and parsing drops prototype keys.
- **Consistency unit.** Each workspace is one JSON document: members, invitations, grants, contacts, accounts, payees, categories, transactions and audit. Every change, its linked records (both legs of a transfer) and its audit entries commit in one ETag-guarded write with retry. Financial creates accept `Idempotency-Key`. Record edits carry the record `revision`, so a stale edit returns 409 `stale_revision`. Reconciled entries lock amount, date and kind.
- **Limitation.** Document size is capped at 12 MB (`workspace_full`). A partitioning migration (for example, transactions by year) must be designed and recorded before any workspace nears the cap. This is not a silent substitution: SQL was not adopted, and adopting it later would need its own ADR.
- **Money.** Integer minor units bounded at 10^15. Precision comes from ISO 4217. Rates are decimal strings converted with BigInt and half-even rounding. Allocation uses largest remainder with lowest-index tie-breaks.
- **Authorization.** `api/_shared/authz.js` (below). The store requires an active member before any handler logic, and authz requires it again independently.

## ADR-003: partition the workspace so the size cap never forces deletion (proposed 2026-09-13, BT-001-05)

**Context.** Each workspace is one JSON document (ADR-002) capped at 12 MB. Nothing may ever be deleted (Terry, 2026-09-13): history, amendments, audit entries, closed merchants and voided entries all stay. The document therefore only grows, and when it reaches the cap every write fails with `workspace_full` — the only way out would be deletion, which is forbidden (audit finding E1).

**Decision (proposed, not yet implemented).**
- Keep **current state** in the workspace document: settings, members, grants, invitations, accounts, categories, merchants, bills, budgets, and the ledger for the open period.
- Move **closed history** into immutable, sealed segment documents: `workspaces/{id}/ledger/{yyyy}.json` for entries of closed years (with their amendments), `workspaces/{id}/audit/{yyyy-mm}.json` for audit months. A segment is written once with create-only semantics and never edited; corrections to a sealed year are new entries (reversals, adjustments) in the open period that reference the sealed entry by id.
- **Sealing** is an explicit, audited operation (owner or scheduled), run when the document passes 50 % of its cap or at year end; it writes the segment first (create-only, verified by re-read and hash), then removes the sealed records from the open document in one conditional write that also records the segment's hash. Nothing is lost: the records move, and the segment is referenced from the document.
- **Reads** that need history (reports, merchant history, audit, restore) read the segment index plus the relevant segments; balances use a per-segment closing balance recorded at sealing and verified on read.
- **Backups** include every segment (the manifest lists them with hashes); restores never rewrite a sealed segment.
- The member quota applies to the open document only; the cap becomes per document.

**Consequences.** Multi-document reads for history; sealing must be crash-safe (segment first, document second, idempotent by segment hash). Until this is implemented the cap remains a documented operational limit, and PROJECT_STATE tracks it as a release risk.

## Schema v1: additive changes since ADR-002 (no migration required)

All changes so far only add optional fields and collections to the version-1 workspace document, so `schemaVersion` stays 1 and older documents are read tolerantly. Recorded here so a future migration knows what "absent" means:

| Added | Meaning when absent (older documents) |
|---|---|
| `recurring[]` (bills with `versions`, `skips`, `pauses`, `resumes`, `history`) and `budgets[]` | No bills or budgets |
| Bill `skips[].withdrawnAt`, `resumes[]` | A skip without `withdrawnAt` is active; no resumes |
| Merchant fields on `payees[]`: `normalizedName`, `type`, `contact`, `customerNumber`, `openedOn`, `closedOn`, `closeReason`, `status`, `defaultAccountId`, `defaultCurrency`, `tags`, `revision`, `history`, `sharedAt` | Computed or default on read: normalized from the name, type `other`, status `active`, revision 1, empty history |
| Category `color`, `defaultColor`, `history` | No workspace colour; the default is chosen from the palette by category id |
| Transaction `amendments[]`, `reversedBy`, `links.reverses`, `links.recurringId`/`occurrence` | No amendments; not reversed; not from a bill |
| User preference `categoryColors` | No personal colours |
| `icon` on categories (with `defaultIcon`), accounts, merchants, bills (with `iconHistory`) and budgets (with `iconHistory`); workspace `settings.typeIcons` and `settings.typeIconHistory` | No chosen icon: a category uses the default for its original name or type (pinned on its next edit), other records the workspace's icon for their type or the built-in default |
| User preference `categoryIcons` | No personal icons |
| Workspace `superseded[]` (records set aside by a replace restore: `collection`, `reason`, `archiveId`, `at`, `by`, whole `record`) and `restores[]` (`archiveId`, `mode`, `at`, `by`, `recoveryPoint`, `setAside`) | Nothing set aside; no restore recorded in the document (the audit log still has restore entries) |
| Bill history `changes[]`; budget `history[]`, `deletedBy`, `archiveReason`; member `history[]`; workspace `history[]` and `lifecycle[]` | No before/after values recorded before this change (older entries keep field names only) |
| Site document `site/icons.json` (`disabled`, `custom[]` as shape data with `status` and `history`, `audit`) | Every built-in icon offered; no custom icons |
| Workspace `groupExpenses[]` (BT-009): `id`, `description`, `date`, `currency`, `amountMinor`, `categoryId`, `notes`, `payers[{ref, amountMinor}]`, `split{method, lines[{ref, value}]}`, `shares[{ref, amountMinor}]`, `createdBy`, `createdAt`, `updatedAt`, `updatedBy`, `revision`, `voidedAt`, `voidedBy`, `voidReason`, `history[]`, `amendments[]`, `ledgerLinks[{subject, accountId, linkedAt, endedAt, endReason}]` | No shared expenses |
| Workspace `groupSettlements[]` (BT-009): `id`, `from`, `to`, `amountMinor`, `currency`, `date`, `method`, `notes`, `status` (`reported`, `confirmed`, `disputed`), `confirmedBy`, `confirmedAt`, `disputedBy`, `disputedAt`, `disputeReason`, `createdBy`, `createdAt`, `revision`, `voidedAt`, `voidedBy`, `voidReason`, `history[]`, `ledgerLinks[]` | No payments |
| Record `ledgerLinks[]` are increment 1's per-record links. New code never creates them. One still counts for its record while that person has no link for the currency, and only when it points at their own private account; linking or stopping for the currency ends it (`endedAt`, `endReason`), and it is kept | No per-record link |
| Workspace `groupLedgers[]` (BT-009 review, 2026-09-14): `id`, `subject`, `currency`, `accountId`, `linkedAt`, `endedAt`, `endReason`. At most one active per person and currency, always to that person's own private account; ended links are kept | Nothing recorded on personal accounts from Shared expenses (apart from increment-1 per-record links) |
| Transaction kinds `payable` (positive, moves no money: a share of an expense someone else paid) and `repayment` (negative: a repayment made). Neither is spending or income | Not used. Older code classifies them as `other`, and their signs pass the older direction check |
| Transactions summary `payables`, `repayments`, `receivable` (= advances − reimbursements − payables + repayments, signed) | Not reported |
| Transaction `links.groupExpenseId` / `links.groupSettlementId` (entries recorded from a shared expense or a repayment, and their reversals). Server-only: the transactions route refuses them | Not recorded from Shared expenses |
| Backup manifest `counts.groupExpenses` / `counts.groupSettlements`, present only when the workspace has those arrays | Archive made before BT-009 (its manifest still verifies) |
| Workspace settings in `settings` (Terry, 2026-09-14; BT-011-07..13): `sharedExpenses`, `memberEditsOthers`, `sharedListManagers`, `budgetBackdating`, `billReminderDays`, `overdueRecordDate`, `memberRestoresPerDay`, `memberRestoreModes`, next to the existing `budgetPeriod` and `weekStart` | The default, which is today's behaviour; a stored value that is no longer valid also reads as the default. A stored `budgetPeriod: "custom"` (accepted before) reads as monthly and still passes the integrity check |
| Workspace summary `settingValues`; workspace GET `settingsList` | Not sent (older API) |

### Shared expenses (BT-009, increment 1 and its review fixes)

- **Currencies.** New expenses are in the workspace's reporting currency. Payments may also be in any currency that still has an open balance, so a balance left from before a change can always be cleared. The reporting currency cannot change while any shared balance is open (`409 group_balances_open`, naming the currency). Balances are kept per currency, and the view and dashboard show every currency with an open balance (financial review finding 3).
- **Split and rounding.** `split.lines[].value` is one of:
  - `null` (equal);
  - a whole number of shares from 1 to 1000;
  - a canonical percentage string (4 decimals, total exactly 100);
  - positive minor units (amounts, total exactly the expense).

  `shares` is exactly `groups.computeShares(amountMinor, split)`: largest remainder, ties to the first listed person. The backup integrity check applies these same rules to the stored split and recomputes the shares (finding 6). A person reference is `member:<id>` or `contact:<id>`, never a private contact.
- **Net sign convention.** net = paid − share − received + paid out, counting confirmed payments only. Positive means the group owes the person; negative means they owe the group. Nets of one currency add up to zero. Reported payments are pending, and disputed ones are shown separately.
- **Suggestions.** The suggestion basis counts a reported payment as made, but only up to what its payer still owes and its receiver is still owed. Payments are taken in date, then report-time, then id order, so a pending claim never turns a creditor into a debtor (finding 5). Fewest payments first pairs exact opposite balances (creditors largest first, ties in participant order), then applies greedy. The result is deterministic, zero-sum and at most n − 1 payments (finding 7). The direct view counts reported payments in full between the two people.
- **Personal ledger: Terry's model (2026-09-14, financial review finding 2).**
  - **What is recorded.** Anyone in a group may record their own part of it on one account per currency (`groupLedgers`). On that account, per group and currency, the entries satisfy:
    - (a) cash effect = −(what they paid for active expenses) + (confirmed repayments received) − (confirmed repayments made);
    - (b) spending (`expense` entries, in the expense's category) = the sum of their shares of every active expense, whoever paid;
    - (c) outstanding = advances − reimbursements − payables + repayments = their group net, confirmed payments only.
  - **Entries per record.**
    - An expense gives `expense` = −share, plus `advance` = −(paid − share) when they paid more than their share, or `payable` = +(share − paid) when they paid less.
    - A confirmed payment gives `reimbursement` = +amount to the receiver and `repayment` = −amount to the payer.
    - Reported, disputed and voided records want no entries.
  - **Hand-computed walkthrough** (`api/test/group-review.test.js`).
    - **Setup.** Alice pays dinner 300.00 split four ways, and Bob pays a taxi 100.00 split with Alice. Both record on their own cash accounts, opening at 500.00.
    - **Before any payment.**

      | | Cash | Spending | Outstanding |
      |---|---|---|---|
      | Alice | 200.00 | 125.00 | +175.00 |
      | Bob | 400.00 | 125.00 | −25.00 |

    - **After netting.** Frank 75.00, Dana 75.00 and Bob 25.00 pay Alice. Alice: 375.00 / 125.00 / 0.00. Bob: 375.00 / 125.00 / 0.00. Every net is 0.00.
    - **Then a void and a correction.** After Bob voids the taxi, Bob is 475.00 / 75.00 / −50.00 and Alice 375.00 / 75.00 / +50.00. After the dinner is corrected to 320.00, Alice is 355.00 / 80.00 / +65.00 and Bob 475.00 / 80.00 / −55.00.
  - **Link and ownership.** The link must be the person's own private account (security review S2). It is visible only to them and lives in `groupLedgers`, never on a shared record, so it never changes a record's `revision`.
    - Entries belong to the person whose server-set `createdBy` they carry. Only those are compared, counted or reversed (finding 1), and the transactions route refuses group link keys (finding 4 / S3).
    - A person's own add, change or void updates their entries in the same write. Anyone else's change leaves them "needs review" (derived, never stored) until they update with `?action=ledger`.
    - Corrections are reversals plus new entries. Stopping reverses every entry in that currency and keeps the link as ended. Moving to another account reverses entries there and records them on the new account.
- **Group settings (Terry, 2026-09-14).** Terry's principle: "The application shouldnt set hard rules that a person shouldnt otherwise be able to have as a configuration." Workflow and policy choices of a group are settings with defaults and plain explanations. Security and integrity rules are never settings: private by default, server-side authorization, no deletion, atomic audit, integer money, no silent overwrite.
  - **The model** (`api/_shared/group-settings.js`).
    - **Storage.** One validated object per group (a group is a workspace), stored as `groupSettings: { values, history }`.
    - **The allowlist.** `SETTINGS` lists each key's type, default, label, explanation and options.
    - **Reads.** Reads merge stored values over the defaults, so older documents need no migration. An unknown key, or a value no longer valid, reads as its default.
    - **Changes.** A single action, `POST /api/group?action=settings { changes, reason? }`, is limited to owners and managers. It refuses unknown keys and invalid values, keeps every real change in the per-key history (who, when, from, to, why) and audits it, all in the same write.
    - **Returned to every member.** The group GET returns every setting from the one list (`groupSettings.settings`, `groupSettings.history`), so the interface renders them all one way: the "Shared expenses settings" card for owners and managers.
    - **Integrity.** The backup check is as tolerant as reads (financial recheck of 47617b5, L3): a value this version does not know, left by a later version after a rollback, reads as the default and passes. Only broken structure is refused: an object or list where a single value belongs, values that are not an object, an override that is not an object with a text value and a whole non-negative period, or a history that is not a list.
    - **Adding a setting** is one entry in `SETTINGS` plus its enforcement where the rule applies.
  - **The settings.** They are per group. Whether Terry meant per expense is an open question for him. Terry's decision of 2026-09-14 ("build all 10") adds the group-level workflow settings below (b to e); the workspace-wide ones (a, f to j) live in `doc.settings` and are built separately. Every default is today's behaviour, and every rule is enforced by the server.
    - `anyoneConfirms`, "Anyone in the group can confirm payments", default on. See the settlement rules below.
      - **Per person (Terry, 2026-09-14).** Owners and managers may override it for each member: "Can confirm payments: Use the group setting (default) / Yes / No". The effective right is the override if set, otherwise the group setting. Yes lets the person confirm any reported payment, their own and payments to or from contacts included. No applies the strict rules below to that person. A viewer never gets more than confirming payments made to them, whatever the override.
      - **Storage.** Per-person overrides are an allowlist of their own in the same model (`PER_MEMBER`): `groupSettings.perMember.confirmOverrides = { <memberId>: { value, at, by, period } }`, changed through the same action as `{ changes: { confirmOverrides: { <memberId>: 'inherit' | 'yes' | 'no' } } }`. Only active members may be named (otherwise `400 invalid_setting`). Each change is kept in the same history with the member it concerns (from, to, who, when, why) and audited.
      - **Membership periods.** An override counts only while its member is active and in the membership period it was set in (`period` = how many times they had rejoined), so a removed member's override is ignored and does not come back if they rejoin. This does not depend on timestamps.
      - **Who sees what.** The group GET returns `groupSettings.members` (every active member's override and effective right) only to owners and managers, and `groupSettings.mine` (their own override and effective right) to everyone. A per-person history entry is shown to owners and managers and to the person it concerns.
      - **Restores.** A create-new restore keeps only the restorer's own override; history entries about anyone else name a former member (S4).
    - `ownedEntries`, "Owed-to-others and repayment entries", default `shared-only` ("Created by Shared expenses only"); the alternative is `manual` ("Also allow entering them by hand").
      - **`shared-only`.** `/api/transactions` refuses `payable` and `repayment` (`400 server_only_kind`), and quick entry does not offer them. The list response's `entryKinds` is the allowlist the client uses.
      - **`manual`.** A hand-entered `payable` is always created as an atomic pair: an `expense` for the share (chosen category and merchant) and the matching `payable`, sharing an `owedPairId`. The balance is unchanged, spending grows by X and outstanding falls by X. A hand-entered `repayment` is money out and valid alone.
      - **Correcting a pair.** A pair is corrected only as a pair: reversing either half reverses both, while editing its financial fields and deleting it are refused (`409 owed_pair_locked`).
      - **Both modes.** No entry is ever changed to or from these kinds. Hand entries carry no group link, so the group sync never touches them. The backup check refuses a pair that is not exactly one `expense` and one `payable` on one account, currency and date, with opposite amounts and the same deletion state.
    - **(b) The default split for new expenses.** `splitMethod` (equal, amounts, percentages or shares; default equal), `splitWho` (everyone active, the default, or only the person adding it) and `paidBy` (the person adding it, the default, or nobody). The server applies them when a request leaves the payer or the split out, and refuses when the default payer is nobody or the default method needs a value for each person. Each person may keep their own defaults as personal preferences (`groupSplitMethod`, `groupSplitWho`, `groupPaidBy`; not set means the group's), which the expense dialog uses over the group's. They are per person across all their groups, not per group.
    - **(c) `changeExpenses`.** Who may correct or void a shared expense: the person who added it or a manager or owner (default), or any member who can add expenses. Viewers never may.
    - **(d) Payment rules.** `withdrawPayments`: who may withdraw a confirmed payment (the receiver or a manager or owner, the default; the receiver only; or anyone who can confirm payments). For a contact, a manager or owner acts as the receiver. `disputePayments`: who may dispute a reported payment (the receiver, the default, or also a manager or owner); the receiver always may, a viewer included. `settleDisputes` (financial recheck F1): who may confirm a disputed payment (the receiver, or a manager or owner for a contact, the default; or also any manager or owner; or anyone who can confirm payments). Being able to confirm payments moves a reported payment only, never a disputed one on its own. A confirmation over a dispute is always marked: `confirmedOverDispute` in the view ("Confirmed over a dispute by X"), the history event `confirmed-over-dispute`, and the audit field `overDispute`. `receiverConfirms` (default on): a payment recorded by the person who received it counts as confirmed at once; when off, it is only reported and needs its own confirmation step.
    - **(e) `countReported`** (default on): suggestions and the direct view count a reported payment as made, capped at what is owed; when off, they count confirmed payments only, like the balances. Each person's preferred balance view (`groupBalanceView`: fewest payments, the default, or keep who owes whom) is a personal preference.
- **Workspace settings (Terry, 2026-09-14; BT-011-07..13).** The same model as the group settings, for rules of the whole workspace (`api/_shared/workspace-settings.js`). Every default is today's behaviour, so nothing changes until someone changes a setting; security and integrity rules are never settings.
  - **Storage.** Flat keys in the workspace document's existing `settings` object, beside `reportingCurrency`. Reads merge stored values over the defaults (a default may depend on the workspace kind), so older documents need no migration; a value that is no longer valid reads as its default. The integrity check refuses a settings object that is not an object and a value no version accepted.
  - **Changes.** The existing `PATCH /api/workspaces?id= { settings: { <key>: <value> }, reason? }`: unknown keys `400 unknown_setting`, invalid values `400 invalid_setting`, a key above the caller's role `403` naming who may; each real change is a `doc.history` entry (`settings.<key>` from, to, who, why) and a `workspace.update` audit entry in the same write. `changedBy` is `manager` (owners and managers) except the two member-restore settings (`owner`).
  - **Reads.** `GET /api/workspaces?id=` returns `settingsList` (key, group, type, label, explanation, value, default, options or min/max, `changedBy`, `canChange`, and `offForSite` for Shared expenses when the site has it off) to every member; each workspace summary carries `settingValues`, which the app uses for the nav and form defaults. The server enforces every rule; the app only decides what it offers.
  - **The settings.**
    - `sharedExpenses` (boolean; default by kind: on for group, trip and household, off for personal). The site's `modules.sharedExpenses` is the upper bound. When off, every `/api/group` route answers `403 shared_expenses_off` after the membership check; nothing is touched.
    - `memberEditsOthers` (`own` / `any`). With `any`, `authz.canChangeRecord` lets a plain member who can add entries to a shared account change any entry or bill on it. Record locks and amendments are unchanged, and private accounts are never widened.
    - `sharedListManagers` (`managers` / `members`). `managesSharedLists(doc, member)` decides shared accounts, shared budgets, categories, and changes to any shared merchant or shared contact. Viewers never qualify.
    - `budgetPeriod` (`monthly`, `weekly`, `biweekly`) and `weekStart` (1, 0, 6) are the defaults for a new budget. Its start is the first of the month, or the latest week-start day. `budgetBackdating` (`confirm` / `never`): with `never`, a backdated plan change is `409 backdate_off`.
    - `billReminderDays` (0–60) is the default for new bills. `overdueRecordDate` (`today` / `due`) sets the default date of a late payment and of its draft.
    - `memberRestoresPerDay` (0 to the SEC-R2 ceiling of 3) and `memberRestoreModes` (a set of `create-new`, `merge`, `restore-deleted`, `replace`; `restore-deleted` needs `merge`). These apply to members below manager, in preview and execute. A member's restore scope is unchanged.
  - **Restores.** Settings are workspace data. A create-new restore carries them, with other people's identities mapped as for everything else. Merge and replace keep the settings the workspace has now, and access is never restored.
- **Settlement rules (security review S5–S7, Terry 2026-09-14).** With `anyoneConfirms` on (the default), any member who can add to the group confirms any reported payment, their own included, and a viewer confirms one made to them. Every confirmation records who confirmed (`confirmation: { by, relation }`, where `relation` is `receiver`, `payer` or `other`), shown as "Confirmed by Bob, who paid it" or "Confirmed by Alice for Dana". The rules below are those that apply when it is off.
  - **Confirming.** The payer (`from`) never confirms their own payment. The receiving member confirms, or a manager or owner when the receiver is a contact. A manager or owner confirming a contact payment they reported themselves is allowed but recorded as `confirmedByReporter` with the history event `confirmed-by-reporter`, and shown as "confirmed by the person who reported it". A consequence: an owner of a one-owner group who pays a contact cannot confirm that payment alone.
  - **Voiding.** Before confirmation, the reporter or a manager or owner may void a payment. Once it is confirmed, only the receiving member or a manager or owner may. That void is recorded as `withdrawn` (history event `withdrawn`, with the reason) and shown as "Confirmation withdrawn".
  - **Viewers.** A viewer may confirm or dispute payments made to them and may update or stop their own ledger link, which only writes to their own private account. They cannot add, change or void anything, report payments, or start a link.
- **A part left on a former account (financial recheck of 47617b5, F2; decision 2026-09-14).** When a person's entries for a shared expense or payment sit on an account that is no longer their usable private account (shared, removed, out of reach, or closed), the record needs review with a plain reason. Without an account of their own to record on, a sync touches nothing (strict: `409 account_needed`); reversing would leave their part recorded nowhere. Once they choose one, their own entries are reversed where they may still be reversed (the group route may do so although the transactions route locks them) and their whole part is recorded on the new account. Entries on a removed or unreachable account are left exactly as they are, shown as "left on a former account", and not counted again; a closed account asks to be reopened. Stopping recording still reverses them. A consequence to know: moving a part recorded on a now-shared account also moves its cash effect to the new account. The transactions summary's `receivable` counts the viewer's own private accounts only and skips removed accounts.
- **Where a part stays (financial recheck of 53cf181, N-1 and N-2; decision 2026-09-14).** An account's balance is always the cash that really moved through it. This supersedes the F2 move of whole parts.
  - **Cash parts stay.** A part that moved cash (money lent, repaid, or a share paid at least in part) stays on the account the money used while the person may still write there. Corrections and voids land there too. A closed account asks to be reopened. The view says "Your part stays on X, where the money moved." and needs no review.
  - **Non-cash parts follow the link.** Only a part that moved no cash (a share someone else paid, with its amount owed) follows the account the person records on now.
  - **Counting outstanding.** The summary's `receivable` counts the viewer's own private accounts, plus the viewer's own entries from Shared expenses on any account they can see. It never counts anyone else's.
  - **Parts left behind.** Entries the person can still see but no longer change (reason `read-only`) are left where they are. They count in none of that person's totals, like entries on a removed account.
  - **Figures before choosing an account.** Until the person chooses an account, the review note says "Until you do, your totals leave this part out."
- **Disputes, defaults and links (recheck of 53cf181).**
  - **The payer and disputes (R3-1, N-4).** The person who paid never settles a dispute over their own payment, unless "Who can settle a disputed payment" is "Anyone who can confirm payments". That option says "This includes the person who paid.", as does the same option of "Who may withdraw a confirmed payment".
  - **Reported again during a dispute (R3-2).** A payment reported while an earlier one between the same two people, in the same currency, is disputed is marked: `reportedAgainOf` in the view ("Reported again after a dispute"), the history event `reported-again`, and the audit field `reportedAgainAfterDispute`. Confirming it follows the dispute rule and is marked as over a dispute. Once the earlier dispute is resolved, it is an ordinary report.
  - **The direct view (N-3).** "Keep who owes whom" counts a reported payment only by what the suggestions count of it, so both views agree and follow setting (e).
  - **Defaults.** A new expense without a payer or split takes the caller's own defaults, otherwise the group's.
  - **Links (R3-3).** A bill's id and occurrence are named only to someone who can see the bill's account transactions. A shared expense's or payment's id is named only to the owner of the entry. `fromSharedExpense` tells everyone that an entry follows Shared expenses.
- **Paid by someone else (financial recheck L4, Terry's arrow rule).** A share entry fully offset by an amount owed (a share of an expense someone else paid, or the spending half of a hand-entered pair) is marked `paidBySomeoneElse` and shown with the no-money-moved mark and "Paid by someone else", never an arrow. Matching is per person, account and record (or pair), and per state (current, reversed, reversal), a reversal going with the entry it reverses. A share paid in part with one's own cash keeps its arrow.
- **Restores.** Group records are owner scope.
  - **Links never come from an archive (S1).** Replace and merge give every record they bring in the links it has now, or none; the per-currency links in `groupLedgers` are never restored.
  - **Create-new (S4).** It keeps the restorer's archived member id and is blocked when group records name other members. On the records it carries, every other subject becomes `former-member` (shown as "Former member"), and member references in earlier values become `member:former`. It keeps only the restorer's own links to accounts that come along, and entries lose links to records that do not come along.
  - **Replace blocker.** Replace is blocked when it would change what another member's entries should be for a record they record on an account outside the caller's scope.
  - **Integrity check (S8).** The backup and restore integrity check refuses:
    - links whose person is not a member (current or former);
    - links whose account is missing or in another currency;
    - duplicate active links;
    - entries naming a missing expense or payment. Records set aside by a replace still count, because they are kept.

Any change that renames, removes or reinterprets a field needs a real migration (in `api/_shared/schema.js`) and a `schemaVersion` bump before release.

## Permission model

Separate verified Google subject, contact, participant, workspace membership, financial resource ownership and capability grants. Every resource has a workspace and owner. A verified server principal is an adapter output, never a browser-provided object. Resource access requires ownership or an active explicit capability grant in the same workspace. Site-admin and workspace-owner labels are not inputs to financial authorization. Anonymous/invalid identity, unknown capabilities, cross-workspace access, missing/expired/revoked grants fail closed. The prototype checks explicit capabilities; trusted ingress, Google verification and route coverage remain pending.

Financial capabilities: view balances/transactions, create/edit/delete, comment, download receipts, export, invite, change permissions and publish. Publication still requires separate site enablement plus a resource publication action; a capability alone is insufficient. Recovery operator privileges are independent of ordinary financial access.

## Threat boundaries

| Threat | Required control and evidence |
|---|---|
| Account takeover/forged client roles | Verified issuer/audience/subject, session expiry/revocation and negative direct-API tests |
| Malicious member/cross-workspace IDs | Central capabilities on direct and derived surfaces, including totals and selectors |
| Compromised device | Explicit cache policy, sign-out clearing, minimal notifications; downloaded copies cannot be recalled |
| Operator access | Separate operational and financial permissions; no operator-blind encryption promise |
| Stolen backup | Authenticated encryption, separately protected keys and recovery access |
| Destructive changes/ransomware | Independent immutable recovery copies, pre-change backup and measured restore drills |

## Recovery protocol

Versioned snapshots contain records, ownership, permissions, attachment bytes and hashes, schema version and nonsecret configuration metadata. Encrypt with authenticated encryption and a fresh nonce; key storage/rotation is external to archives. Never log keys or payloads. Decrypt and validate in isolation before any write. Validate workspace, schema, attachment completeness and financial invariants. Restored grant data is historical evidence only: strip grants and require explicit reauthorization against current identity/revocation state. Do not restore archived administrator roles. This conservative prototype disables all restored grants.

## Independent prototype review — 2026-09-13

Claude ran a read-only security and financial review of `lib/foundation.cjs` at `2360b79`. Verdict: **PARTIAL** for its prototype purpose. The prototype fails closed on typed malformed input, uses AES-GCM correctly, rejects tampering and strips grants. The production port must fix the following findings:

1. **Owner shortcut** (high). Ownership bypasses workspace and membership checks and grants every capability, including `publish` and `change-permissions`. It also re-grants archived owners after a preview. Fix: owners must hold active membership in the resource's workspace; ownership maps to a capability set; publishing and permission changes are gated separately.
2. **Fixed AAD** (medium). Workspace, schema, archive id, creation time and key id are not authenticated. Fix: authenticate a plaintext header in the AAD, check it before parsing, and use a key id with per-scope keys.
3. **Validated object ≠ encrypted bytes** (medium). `toJSON` or coercing values can produce a valid-looking backup that cannot be restored. Fix: serialize first, validate the parsed bytes, and test-decrypt before recording success.
4. **Per-record precision and coercing currency regex** (medium). Fix: use a server ISO 4217 table, `typeof` checks before any regex, reject `-0`, and bound the magnitude.
5. **Preview returns full payloads** (medium). Fix: the preview returns counts, totals, conflicts, hash status and a permissions summary, never financial payloads.
6. **Inherited or getter properties** (low). Fix: copy the principal and grants into frozen null-prototype plain values; use `Object.hasOwn`.
7. **Size before work** (low). Fix: check total size first, index lookups, and store attachments as separately hashed blobs referenced by a manifest.
8. **Raw exceptions** (low). Fix: return generic errors and log reason codes, never values.
9. **Tests.** Add owner-in-another-workspace, malformed and inherited grants, header tampering and truncation, orphan attachments, precision mismatch, oversized input, and the encrypt/restore asymmetry. Also prove that revoked or expired archived grants stay inactive.

Create-new, merge and replace need separate future execution semantics. No destructive restore is implemented until preview, pre-restore backup, conflict handling, confirmation and atomic commit/restart are proven. Workspace recovery and disaster recovery require distinct operator permissions. Schedules, retention, RPO/RTO and production key custody are pending decisions, not achieved guarantees.
