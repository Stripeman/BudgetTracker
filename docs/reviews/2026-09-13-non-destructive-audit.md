# Non-destructive records audit (BT-001-05)

Read-only audit of `feature/project-foundation` at `4ef49b8` plus the then-uncommitted budgets, bills and forecast files, against Terry's requirement (2026-09-13): nothing is ever physically deleted; financial corrections are amendments, reversals, replacements or adjustments that keep the original and record who, when and why; archived or closed records leave new-entry choices but stay in history, search, reports and audits.

**Overall.** No code path deletes a stored file or blob: the storage adapters expose only get, put and list, and attachments are content-addressed and create-only. The violations are **inside the workspace document**: records dropped from arrays, prior values overwritten, and inconsistent soft-delete semantics. The 12 MB document cap would eventually force deletion.

Status key: **Fixed** (with the commit that fixed it), **Open**.

## A. Records dropped from documents

| ID | Where | What is lost | Sev | Status |
|---|---|---|---|---|
| A1 | transaction `history` capped at 50 | older history, including delete and restore events | High | **Fixed** (`ab27260`) |
| A2 | account `history` capped at 50 | the before/after opening-balance record | High | **Fixed** (`ab27260`) |
| A3 | bill `history` capped at 100 | older bill changes | High | **Fixed** (`ab27260`) |
| A4 | site audit capped at 500 | older site audit records | High | **Fixed** (`ab27260`) |
| A5 | bill "unskip" removes the skip record | its date, reason, actor and time | High | **Fixed** (`ab27260`, withdrawn not removed; tested) |
| A6 | bill "resume" rewrites or drops pause records | the original pause range | High | **Fixed** (`ab27260`, resumes are separate records; tested) |
| A7 | restore "replace" removes in-scope records created after the backup and overwrites changed ones | the current records (only the encrypted recovery point keeps them) | High | Open |
| A8 | idempotency records pruned after 48 h | the cached replay response | Medium | Open (needs a ruling: cache, not record) |
| A9 | preference set to null deletes the key | the prior value | Low | Open |
| A10 | audit `fields` list capped at 30 | long field lists | Low | **Fixed** (`ab27260`) |
| A11 | backup `retentionDays` implies pruning (none implemented) | — | Medium | Open (rename to minimum retention) |
| A12 | blob soft-delete purges after 14/35 days; no WORM | storage-level deletions | Medium | Open (infrastructure, needs Terry) |
| A13 | comment mentions an "archived-and-purged" workspace | — | Low | Open |

## B. Prior values overwritten

| ID | Where | Prior value lost | Sev | Status |
|---|---|---|---|---|
| B1 | transaction PATCH | every field; only field names kept | High | **Fixed** (`af52dba`: amendments with before/after, author, time and required reason; reversals for reconciled entries) |
| B2 | cross-currency transfer edit rebuilds rate context | original rate, source and date | High | **Fixed** (`af52dba`: prior exchange details kept in the amendment; tested) |
| B3 | reconciled → cleared needs no reason | the reconciliation decision | Medium | **Fixed** (`af52dba`: un-reconciling requires a reason) |
| B4 | transaction restore clears `deletedBy` | who deleted it | Medium | **Fixed** (`af52dba`: kept in the amendment; tested) |
| B5 | edit form drops an archived category | the entry's category (silently recategorized) | High | **Fixed** (`e34c1ca`) |
| B6 | edit form always sends `payeeName`; deleted payees re-matched | the entry's merchant link | High | **Fixed** by BT-007-01 (merchants by id; closed merchants keep links) |
| B7 | edit form sends unchanged fields | history signal | Medium | **Fixed** (`e34c1ca`; the server also records only real changes) |
| B8 | account terms and fields overwritten | APR, limits, payment terms, names | High/Medium | **Fixed** (every account edit keeps before/after values and an optional reason; tested) |
| B9 | account close has no who/why | lifecycle | Medium | **Fixed** (close/reopen actions with revision and reason in the account history; tested) |
| B10 | payee edits overwrite with no history or revision | names, aliases, defaults | Medium | **Fixed** by BT-007-01 (revision check, before/after history with reason) |
| B11 | category edits overwrite with no history | names, parents | Medium | Open |
| B12 | contact edits overwrite; private changes unaudited | contact details | Medium | **Fixed** (before/after history on shared and private contacts, private history visible to its owner only; archive and restore; tested) |
| B13 | budget lines replaced; past periods recomputed from current lines | historical budget performance | High | **Fixed** (plan versions from a date; tested) |
| B14 | bill name/type/notes/reminder/end date overwritten | prior values | Medium | Open |
| B15 | member role and rejoin overwrite membership | membership periods | Medium | Open |
| B16 | workspace edits overwrite; unarchive loses who/when | settings history | Medium | Open |
| B17 | site settings overwritten; audit keeps names only | prior settings | Medium | Open |
| B18 | profile and preference overwrites | prior values | Low | Open |
| B19 | invitation replace/revoke lacks `closedBy` and audit | who closed it | Low | Open |

## C. Soft-delete paths

Transactions, accounts, payees, categories, contacts, members, grants, invitations, workspaces, budgets and bills each use a different mechanism. Most lack a reason, several cannot be reversed (payees before BT-007-01, contacts, budgets, bills), and some hide history (deleted budgets and bills vanish; restore "create-new" leaves no record in the source workspace). Merchants now use a uniform close/reopen lifecycle with actor, time and reason (**fixed** for payees). Target for the rest: one lifecycle model `{state: active|archived|closed|cancelled|superseded, at, by, reason}` plus a lifecycle history, with reopen routes and read-only archived workspaces.

## D. Dropdowns and history views

D1 closed accounts offered for new entries (UI and server) — **Fixed** (server refuses entries, transfers in, bills and bill payments on closed accounts; the UI no longer offers them; tested). D2 archived categories accepted by the server — Open; deleted payees re-matched by name — **Fixed** (merchant ids). D3 history filters hide removed merchants and deleted accounts — merchants **fixed** (closed merchants stay in the list, labelled); accounts Open. D4 no "show deleted" or restore in the UI — Open. D5 no archived/closed sections — merchants **fixed**; accounts Open. D6 no former-members list or budget/bill activity labels — Open. D7 budgets drop deleted accounts from past periods — Open. D8 payee statistics and the transaction list use different visibility filters — Open.

## E. Size caps

E1 the 12 MB document cap will force deletion (archiving frees nothing) — Open, needs the partitioning ADR (ledger by year, audit by month, sealed segments). E2 the member quota counts soft-deleted records and suggests removal — Open. E4 attachments embedded in backups cap archives at 64 MB — Open. E5 user-document idempotency is unbounded — Open (compliant but unbounded).

## Remediation order

1. Stop in-document deletion: remove history/audit caps, append-only unskip/resume, idempotency ruling, and a static validator rule banning deletion of persisted records.
2. Transaction amendments with a required reason, before/after values and reversal/replacement for reconciled corrections; fix the rate-context overwrite and the edit-form defects (B5, B7).
3. Non-destructive restore (supersede instead of remove; a restore record in the source workspace).
4. One lifecycle model with reopen routes for every record type; archived workspaces read-only.
5. Versioned account terms, budget lines, category names and membership periods; before/after in every audit.
6. Server-side refusal of archived/closed records on create; archived records kept, labelled, in history filters; one canonical visibility filter.
7. Storage: partitioning ADR, attachments backed up separately, quota semantics, backup immutability (with Terry).

The proving tests are listed in the requirement register under BT-001-05.
