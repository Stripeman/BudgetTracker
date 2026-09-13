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
| Workspace `groupExpenses[]` (BT-009): `id`, `description`, `date`, `currency`, `amountMinor`, `categoryId`, `notes`, `payers[{ref, amountMinor}]`, `split{method, lines[{ref, value}]}`, `shares[{ref, amountMinor}]`, `createdBy`, `createdAt`, `updatedAt`, `updatedBy`, `revision`, `voidedAt`, `voidedBy`, `voidReason`, `history[]`, `amendments[]`, `ledgerLinks[{subject, accountId, linkedAt, endedAt}]` | No shared expenses |
| Workspace `groupSettlements[]` (BT-009): `id`, `from`, `to`, `amountMinor`, `currency`, `date`, `method`, `notes`, `status` (`reported`, `confirmed`, `disputed`), `confirmedBy`, `confirmedAt`, `disputedBy`, `disputedAt`, `disputeReason`, `createdBy`, `createdAt`, `revision`, `voidedAt`, `voidedBy`, `voidReason`, `history[]`, `ledgerLinks[]` | No payments |
| Transaction `links.groupExpenseId` / `links.groupSettlementId` (entries recorded from a shared expense or a repayment, and their reversals) | Not recorded from Shared expenses |
| Backup manifest `counts.groupExpenses` / `counts.groupSettlements`, present only when the workspace has those arrays | Archive made before BT-009 (its manifest still verifies) |

### Shared expenses (BT-009, increment 1)

- **One currency per workspace for now.** New expenses and payments must be in the workspace's reporting currency; balances are nevertheless computed per currency, so records kept after a change of reporting currency never mix.
- **Split and rounding.** `split.lines[].value` is `null` (equal), a whole number of shares, a canonical percentage string (4 decimals, total exactly 100) or minor units (amounts, total exactly the expense). `shares` is exactly `groups.computeShares(amountMinor, split)` — largest remainder, ties to the first listed person — and the backup integrity check recomputes it. A person reference is `member:<id>` or `contact:<id>`; private contacts never.
- **Net sign convention.** net = paid − share − received + paid out, counting confirmed payments only. Positive: the group owes the person; negative: they owe the group. Nets of one currency add up to zero. Reported payments are pending and disputed ones separate; suggestions and the direct view count reported payments as made (not disputed ones).
- **Personal ledger link.** Only the link's subject writes to the linked account. Entries: `expense` = min(paid, share), `advance` = paid − that; a confirmed repayment to the subject = `reimbursement`. Corrections are reversals plus new entries (never edits); "needs review" is derived by comparing the live linked entries with what the record now needs. The link list never changes the record's `revision`.
- **Restores.** Group records are owner scope. Create-new keeps the restorer's archived member id and is blocked when group records name other members; replace is blocked when it would change a group record that is linked to an account outside the caller's scope.

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
