# BudgetTracker — Claude Code instructions

These instructions govern all work in this repository. `AGENTS.md` is the short, tool-neutral
contract; nothing here contradicts it. Read both explicitly even when an app displays
`Agents.md: <none>`.

## 1. Before changing anything

1. Read `PROJECT_STATE.md` completely, then `docs/PROJECT_BRIEF.md`, `docs/REQUIREMENTS.md`,
   `SECURITY.md` and `AGENTS.md`. `docs/BRIEF_RECONCILIATION.md` records the full Word
   comparison (161/161 paragraphs, no additions or conflicts); the Markdown brief is canonical
   and the ignored local Word file is preserved, never edited or committed.
2. Establish real Git state: `git status -sb`, `git branch --show-current`,
   `git log --oneline -10`, then `git fetch origin` and compare before any pull or switch.
   Never overwrite uncommitted or upstream work; if both changed a file, stop and reconcile.
3. Verify behavior in source and tests, not from filenames, documentation or memory.

Source of truth, in order: Terry's latest explicit instruction → repository contents → Git
state → verified runtime/infrastructure state → `PROJECT_STATE.md` → conversation history →
assumptions.

## 2. Scope and product boundaries

- Implement the full brief through increments. A milestone is not permission to discard
  remaining requirements. Every feature and significant defect has a stable `BT-` identifier,
  acceptance criteria and evidence in `docs/REQUIREMENTS.md`; partial work stays marked partial.
- BudgetTracker is offered as a budgeting service. Never add eSIM offerings, card issuance,
  affiliate offers, financial-product advertising, or unrequested sales/marketplace features.
  Do not invent billing or pricing.
- Delivery order: security, permissions, automated backups and tested restores → accounts and
  transactions → budgets, debt and forecasting → shared expenses, trips and currencies →
  settings, reporting, imports and offline → optional financial integrations.

## 3. Security invariants (release gates)

- Financial records are private by default. Deny by default. Authorize server-side on every
  read and write, including search, autocomplete, suggestions, totals, reports, exports,
  receipts/attachments, deep links, notifications, background tasks and queued offline writes.
  Client checks are presentation only.
- Identity comes only from trusted server-side claims (the Static Web Apps principal from the
  Google provider). Never trust browser-supplied roles, user ids or ownership. Verified
  subject, contact, payee, participant, workspace member and resource grant are distinct; a
  contact recorded as "Paid by" gains no access or debit authority.
- Site administration never grants access to financial records. Workspace ownership never
  grants access to another member's private accounts. These are deliberate departures from
  TaskTracker's site-admin owner elevation.
- An identifier from another workspace fails as not found. Errors, logs and notifications never
  disclose another workspace or financial details.
- Sensitive actions are audited atomically with the mutation (never best-effort).
- **Nothing is ever physically deleted** (Terry, 2026-09-13; BT-001-05): merchants, payees,
  contacts, members, accounts, transactions, bills, trips, budgets, categories, attachments,
  settings, audit records, backups and restore history use archived, inactive, closed, cancelled
  or superseded states. Historical financial records are immutable: corrections are amendments
  (before/after values with who, when and why), reversals, replacements or adjustments that keep
  the original. Archived or closed records are excluded from new-entry choices by default but stay
  in history, search, reports, audits and authorized administrative views. Never truncate history
  or audit arrays; size limits are solved by partitioning (ADR-003), never by deletion.
- Backups are encrypted and independently protected. Restores are isolated, previewed without
  mutation, atomic, and never resurrect revoked or expired access.
- Client state guards against stale responses: synchronous reset on workspace switch,
  generation tokens that discard abandoned responses, and slice ownership checks.

## 4. Financial integrity

- Integer minor units with ISO 4217 precision; never binary floating point for money.
  Rounding residuals are deterministic and visible.
- Immutable stable ids. Every persisted document carries `schemaVersion`; newer versions are
  refused, older versions are read tolerantly, and migrations are recorded before release.
- Every mutable write is an ETag-guarded read-modify-write. Financial creates carry idempotency
  keys; linked records (transfers, splits, settlements) are written atomically; unresolvable
  conflicts return 409. No blind writes, no silent overwrites. Corrupt documents are refused,
  never treated as empty.
- One canonical model, calculation and filter per concept shared by every view; metrics are
  derived on read. Original amount, currency, rate, rate source and effective date are
  preserved; refreshing rates never changes history. Paying a card or repaying a shared debt is
  never counted as spending again.
- Merchants are managed directory records linked by stable id, never free text or names
  (BT-007-01); closed merchants leave new-entry choices but keep their history.
- Recurring bills are versioned: term changes take effect from a chosen date and never rewrite
  recorded entries; each occurrence is reviewed before it becomes an entry and is recorded once
  (BT-008-02).
- Category colours are stored by stable category id, validated server-side for contrast and never
  the only signal (BT-011-04).
- Icons come only from the central registry by stable id (`app/js/ui/icons.js`, with ids kept
  equal to `api/_shared/icons.js` by a test) and sit beside visible text. Custom icons enter only
  through the site-admin upload in `api/_shared/icon-svg.js`, which stores plain shape data — never
  SVG markup — and the client re-checks it before drawing. Icons are retired or switched off, never
  deleted, and keep drawing on records that use them (BT-011-05).

## 5. Public repository hygiene

- Never commit secrets, credentials, API keys, real financial records, receipts, private
  exports, backups, local database files or personal identifiers. Use fictional data only.
- Enable the hook once per clone: `git config core.hooksPath .githooks`. It runs
  `scripts/scan-staged.cjs` (staged path/content rules plus gitleaks from `.local/bin` or
  PATH). Also inspect `git diff --cached --stat` and the staged content yourself before every
  commit. Never use `--no-verify` and never force-add ignored files. `.gitignore` is maintained
  but is only one layer.

## 6. Branches, CI and release

- Work on feature branches. Never push to `main`, merge pull requests, enable auto-merge,
  deploy Production, or use another agent or tool to bypass these rules. Terry controls
  promotion after review.
- `main` protection is configured (see `PROJECT_STATE.md` for verified settings). Agents act
  with Terry's admin token, so the protection does not technically stop an agent from changing
  settings: never alter it except to strengthen it when authorized.
- Staging is deployed only after its target (tenant, subscription, resources) is explicitly
  selected and recorded; never infer it from ambient `az` context. Staging and Production
  storage, identities, secrets and data are fully separate; Staging uses fictional data.
- Tie every release to a commit and application version and show version and environment in
  the app. Deployment success is not application validation; verify separately.
- There is exactly one supported way to deploy code: `.\deploy.ps1 -Environment preview|production`
  (`scripts/deploy/deploy.ps1`, a thin interface over `scripts/deploy/engine.mjs`, BT-003-05). Never
  invoke the engine, `az`, `npx swa`, GitHub Actions, or another script to deploy directly, and
  never instruct anyone else to. `scripts/deploy/provision.ps1` and
  `scripts/deploy/configure-settings.ps1` are separate, occasional infrastructure/settings scripts,
  not alternate deployment routes; `scripts/recovery/*` is a different, recovery-operator concern.
- Hosting (Terry, 2026-09-13): one dedicated Azure Static Web App for BudgetTracker
  (`budget-tracker`, resource group `budget-tracker`, East US 2) with its own settings, secrets,
  authentication, storage, logs, backups and restore scope; feature builds go only to its named
  `preview` environment. No separate Staging app yet, but keep everything ready for one. Never
  copy TaskTracker secrets or data, never touch TaskTracker's Azure resources, and never change
  DNS (`budget.remsik.org`, documented in `docs/DEPLOYMENT.md`) or deploy Production without
  Terry's explicit authorization.

## 7. Working discipline

- Requirement → failing test → implementation → full suite. Tests assert contracts with
  independent expected values. Never weaken a test or an implementation to reach green.
- Gate: `npm test` and `npm run validate` must exit 0 (see `README.md` for the current command
  set). Say plainly what was not run.
- Brief plan before multi-file changes; targeted edits; no unrelated refactors; do not remove
  error handling or compatibility logic without saying why.
- Report truthfully and distinctly: tests pass, validation passes, deployed, verified in
  Staging. Quote real exit codes.
- TaskTracker is read-only reference; never modify, fetch or switch it. Compare the committed
  `main` of `Z:\repos\TaskTracker` and `T:\repos\TaskTracker` and read the freshest with
  `git show main:<path>` (on 2026-09-13 `T:` `main` `a1ec150` was canonical; `Z:` was stale).
  Reuse or faithfully adapt its Tiptap editor, its day/night (moon/sun) Appearance control
  (`app/js/ui/daynight.js`) and its colour-aware theme picker (`app/js/ui/themepicker.js`, never a
  plain browser select) rather than inventing different controls
  (`docs/TASKTRACKER_REUSE.md`, BT-011-01/02/03). Do not copy site-admin elevation, best-effort audit, invalid-JSON
  fallback, archived-member reactivation, permanent deletion without safeguards, historical
  deployment exceptions, stale infrastructure facts, or forged-identity seed scripts.

## 7a. Local runtime and ports

Other applications run locally on this machine. BudgetTracker must never bind, stop, kill or
otherwise manipulate these ports or their processes: 4280 (SWA CLI), 7071 (Functions host),
10000–10002 (Azurite). BudgetTracker's local dev server binds 127.0.0.1 only on its own port
(default 4380; see `README.md`) and uses file storage under the ignored `.local/`, so it needs no
Azurite. Choose another free port rather than freeing an occupied one.

## 8. Agents

- Role text lives in `scripts/setup-project-agents.py`, generated to `.codex/agents/*.toml`
  (Codex) and `.claude/agents/*.md` (Claude). Skills in `.agents/skills/` are mirrored to
  `.claude/skills/`. Edit the generator and rerun it; never edit generated files.
- One implementation owner writes per scope; reviewers are read-only and return evidence.
- Invoke selectively: `code-archaeologist` before TaskTracker reuse; `security-privacy-reviewer`
  for identity, access, storage, integrations, backup and restore; `financial-accuracy-reviewer`
  for calculations and data models; UX/UI, usability and accessibility reviewers for meaningful
  interface changes; `regression-false-green-auditor` for cross-layer claims;
  `release-readiness-auditor` before a Staging candidate or release review. Run security and
  financial review at major milestones and before release. Do not run the whole team for
  small commits. A finding or READY verdict is evidence, never authorization.

## 9. Handoff

After each meaningful checkpoint update `PROJECT_STATE.md`: completed work, unfinished work,
tests and scan results, blockers, and exact next steps. If context runs short, stop starting new
work and checkpoint; a context limit is a reason to checkpoint, not to hurry.
