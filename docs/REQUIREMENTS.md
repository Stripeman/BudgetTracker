# Requirement register

The complete scope and acceptance requirements are in [PROJECT_BRIEF.md](PROJECT_BRIEF.md). All feature modules are unimplemented. Expand these parent requirements into stable child identifiers before coding; retain links to the relevant brief sections, acceptance checks, commits, and PRs.

| ID | Requirement | Status |
|---|---|---|
| BT-001 | Security and authorization foundation | Planned |
| BT-002 | Automated backups and tested restores | Planned |
| BT-003 | Git controls and documentation maintenance | Partial — documentation prepared; enforcement pending |
| BT-004 | TaskTracker reuse and local development | Planned |
| BT-005 | Google identity contacts and memberships | Planned |
| BT-006 | Accounts payees and expenditure entry | Planned |
| BT-007 | Merchant history imports and reconciliation | Planned |
| BT-008 | Budgeting debt and forecasting | Planned |
| BT-009 | Shared expenses and settlement | Planned |
| BT-010 | Trip planning and multicurrency support | Planned |
| BT-011 | Site workspace personal settings and moon sun selector | Planned |
| BT-012 | Reporting notifications and optional integrations | Planned |

## Tracking contract

Each child requirement records scope, acceptance criteria, dependencies, status, affected files, branch, commit or PR, validation evidence, and limitations. Security and recovery acceptance checks are release gates. Do not discard remaining scope after the first milestone.

## Foundation child requirements — checkpoint 2026-09-13

All rows refer to feature/project-foundation and the checkpoint commit containing this register (resolve with git log -1). No PR or deployment yet. Parent scope above remains intact.

| ID | Acceptance and scope | Status / evidence | Dependencies and files / remaining work |
|---|---|---|---|
| BT-003-01 | Compare full Word brief without dropping requirements | Complete: 161 nonempty paragraphs match original Markdown lines after prefix normalization; no conflicts | docs/BRIEF_RECONCILIATION.md; local Word preserved and ignored |
| BT-003-02 | Reusable roles, selective routing, read-only reviewers and native smoke test | Partial: nine roles generated from one source into Codex TOML and Claude Markdown (adds regression-false-green-auditor and release-readiness-auditor); skills mirrored to .claude/skills; Codex security role executed; Claude security and exploration subagents executed as general-purpose delegations (not native-role proof) | scripts/setup-project-agents.py, .codex/agents, .claude/agents, .agents/skills, .claude/skills, docs/AGENT_VALIDATION.md; native Claude role invocation and remaining Codex executions pending |
| BT-003-03 | Secret scanning and repository controls | Partial: CI secret-scan and foundation-tests passed remotely on 2360b79; main protection configured 2026-09-13 (PR required, both checks required, enforced for admins, no force-push/deletion); Dependabot alerts and security fixes enabled | .github/workflows/security.yml, .gitignore; agents use Terry's admin token (settings could be altered) and Staging environment protection pending |
| BT-003-04 | Staged-content scan before every commit | Partial: scripts/scan-staged.cjs (path, secret, personal email, Luhn card and IBAN rules; values never echoed) plus pinned gitleaks 8.30.1 via .githooks/pre-commit; tests in test/scan-staged.test.cjs | Each clone must run `git config core.hooksPath .githooks`; CI remains the enforced layer |
| BT-004-01 | Verify actual TaskTracker reuse seams | Partial, corrected: the earlier inventory used stale Z: beta.240; canonical T: main a1ec150 (beta.416) has both the Tiptap editor and the moon/sun day/night Appearance control; unsafe-pattern rows re-verified | docs/TASKTRACKER_REUSE.md; attachments, people picker, settings and local-runtime rows still need re-verification against T: main |
| BT-011-01 | Reuse TaskTracker's day/night Appearance control | Planned. Acceptance: a faithful port of daynight.js, its CSS and the theme controller; "Use device setting" = system, and clearing it keeps the resolved mode; role=switch with aria-checked, "Appearance: Light/Dark" label, aria-disabled refusal while following, explained in words; reduced motion honored; personal preference persisted server-side and never visible to site admins; site default applied with inherited/customized/locked status; the same control mounted in the account menu and personal settings; TaskTracker's test contract ported | Depends on BT-001 identity/preferences API and the BT-004 frontend shell |
| BT-011-02 | Reuse TaskTracker's Tiptap editor | Planned. Acceptance: vendored Tiptap bundle with pinned versions and a reproducible vendor script, injectCSS false under CSP; Simple, Advanced and customizable toolbars; hiding buttons never destroys content; server-side validation and sanitization; used for transaction, trip, account and debt notes | Archaeology of T: app/js/ui/editor and the rich-text-editor skill required first |
| BT-001-01 | Threat/permission model with release gates | Partial: prototype design recorded, no runtime enforcement | docs/FOUNDATION_DESIGN.md; BT-004-01, trusted identity/storage decisions pending |
| BT-001-02 | Deny by default and explicit grants with negative tests | Partial: local helper tested for identity flag, admin separation, scope, expiry and revocation | lib/foundation.cjs, test/foundation.test.cjs; trusted server adapter and every indirect/API surface pending |
| BT-002-01 | Recovery runbook, independent privileges and isolated validation | Partial: design/runbook only | docs/RECOVERY_RUNBOOK.md; storage, keys, schedules, retention and RPO/RTO pending |
| BT-002-02 | Authenticated encryption and nonmutating isolated preview | Partial: synthetic round trip, tampering/key/scope/schema/attachment failures tested; grants stripped | lib/foundation.cjs, test/foundation.test.cjs; executable/atomic restore, owner reconciliation, financial invariants and independent reviews pending |
