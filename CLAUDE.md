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
- Sensitive actions are audited atomically with the mutation (never best-effort). Deletion is
  recoverable with safeguards; no silent permanent deletion of financial records.
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
  Reuse or faithfully adapt its Tiptap editor and its day/night (moon/sun) Appearance control
  (`app/js/ui/daynight.js`) rather than inventing a different selector
  (`docs/TASKTRACKER_REUSE.md`, BT-011-01/02). Do not copy site-admin elevation, best-effort audit, invalid-JSON
  fallback, archived-member reactivation, permanent deletion without safeguards, historical
  deployment exceptions, stale infrastructure facts, or forged-identity seed scripts.

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
