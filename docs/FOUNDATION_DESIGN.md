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
