# BudgetTracker agent contract

Applies to every automated agent (Codex, Claude or other). `CLAUDE.md` holds the full
engineering standard; nothing here contradicts it.

## Before acting

- Read `PROJECT_STATE.md` (a short, stable entry point — not a log), `docs/PROJECT_BRIEF.md`,
  `docs/REQUIREMENTS.md`, `SECURITY.md` and `CLAUDE.md` — explicitly, even if a tool displays
  `Agents.md: <none>`. `docs/BRIEF_RECONCILIATION.md` records the full Word comparison with no
  additions or conflicts.
- Check real Git state (`git status -sb`, `git log --oneline -10`, `git fetch` and compare).
  Repository state outranks conversation memory. Preserve all existing and uncommitted work.
- Discover and read recent checkpoints in `docs/project-state/checkpoints/` (filenames sort
  chronologically; never assume the newest alone holds every outstanding item), plus any earlier
  ones relevant to the active work or an unresolved decision; consult `docs/project-state/archive/`
  for anything from before the checkpoint split. Reconcile older completion claims against verified
  repository, PR and deployment evidence before relying on them.

## Never

- Deploy Production, enable auto-merge, force-push or delete `main`, weaken or bypass branch or
  required-check protections, or use another agent or tool to bypass Staging or release controls.
  Merging Terry-authorized work into `main` once required checks pass is a documented exception
  (Terry, 2026-09-24 — see `docs/project-state/checkpoints/20260924T054237Z-agent-managed-merge-
  policy.md`; "Always" below) — Production deployment stays exclusively Terry's own action.
- Deploy code any way other than `.\deploy.ps1` (BT-003-05; `scripts/deploy/engine.mjs` behind it
  enforces the same rules if called directly, but no other script, npm command or workflow may
  perform the Azure upload, and none may be documented or suggested as a shortcut).
- Commit secrets, credentials, real financial data, receipts, backups, private exports, local
  databases or personal identifiers. Never force-add ignored files or skip the staged scan.
- Rely on client-only permission checks, trust browser-supplied identity or roles, let site
  administration or workspace ownership imply access to private financial records, or let an
  identifier cross a workspace boundary (it fails as not found).
- Use binary floating point for money, overwrite concurrent writes, treat corrupt documents as
  empty, or make financial audit best-effort.
- Truncate history or audit, or overwrite a financial record in place: a correction is always an
  amendment, reversal, replacement or adjustment that keeps the original with who, when and why
  (BT-001-05). Archiving stays available and is not replaced. Permanent deletion IS allowed, but
  only through the explicit, double-confirmed, cascade-limited path in `api/_shared/deletion.js`
  (a member's own/managed records) and `api/_shared/workspace-deletion.js` (a whole workspace, by
  its owner or, administratively and without financial-content visibility, a site administrator) —
  BT-014, 2026-09-17. Never delete a record any other way, and never let deleting one record delete
  another it merely references (a merchant, category or account a transaction points to is never
  removed just because the transaction referencing it is deleted, or vice versa, without going
  through that module's cascade/severance rule).
- Link merchants by name or free text (they are managed records with stable ids), rewrite recorded
  entries when a recurring bill changes, or copy TaskTracker secrets or data, touch its Azure
  resources, change DNS or deploy Production without Terry's explicit authorization.
- Resurrect revoked or expired access on restore, or mutate data during an import/restore preview.
- Infer a deployment target from ambient Azure CLI state. Staging and Production stay separate.
- Modify TaskTracker. Add eSIM offerings, card issuance, affiliate sales or financial-product
  advertising.

## Always

- Deny by default and authorize server-side on every route and derived surface.
- Give each feature and defect a stable BT identifier with acceptance evidence; partial stays partial.
- Follow requirement → test → implementation; run the full gate (`npm test`, `npm run validate`)
  and report real exit codes and anything not run.
- Enable `git config core.hooksPath .githooks` and inspect staged paths and content before commits.
- Reuse or faithfully adapt TaskTracker's Tiptap editor, day/night (moon/sun) Appearance control
  and colour-aware theme picker from the freshest committed TaskTracker `main`
  (`docs/TASKTRACKER_REUSE.md`, BT-011-01/02/03); never invent a different theme selector or use a
  plain browser select for it.
- Keep archived and closed records out of new-entry choices but in history, search, reports and
  audits; store category colours by stable id and validate their contrast server-side.
- Draw icons only from the central registry, by stable id (`app/js/ui/icons.js`, whose ids a test
  keeps equal to `api/_shared/icons.js`), beside visible text. Add custom icons only through the
  validated upload, which stores shape data and never SVG markup; retire or switch icons off,
  never delete them (BT-011-05).
- Keep one implementation writer per scope; reviewers are read-only. Role definitions are
  generated by `scripts/setup-project-agents.py` into `.codex/agents/` and `.claude/agents/`.
  Invoke specialists selectively, not for every small commit.
- Maintain `README.md`, `.gitignore`, `SECURITY.md`, the brief and the requirement and risk
  registers. Write a new checkpoint in `docs/project-state/checkpoints/` at every meaningful
  stopping point (not every intermediate edit) with completed and unfinished work, test and scan
  results, blockers and exact next steps; never edit a checkpoint already on `main` — a correction
  or later outcome goes in a new checkpoint naming the one it corrects.
- For Terry-authorized work with required checks passing (`secret-scan`, `foundation-tests`):
  fetch and reconcile with `origin/main` yourself, resolving routine conflicts while preserving
  both branches' intended changes (never blindly choosing one side or discarding work — ask Terry
  only when resolution needs a genuine product or data decision); merge the resulting PR; then
  deploy that exact `main` commit to Preview with the canonical `deploy.ps1 -Environment preview`
  and independently verify Preview reports that commit before reporting it as current. Do not stop
  to ask for a manual merge or a Preview-deploy request — this is part of finishing the work, not a
  separate step. Never deploy Production, and never deploy on every intermediate edit.

## When blocked

Stop and say so with the BT identifier, evidence and the smallest action needed. Do not guess
at an authorization rule, persistence contract or infrastructure target.
