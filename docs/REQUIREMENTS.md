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
| BT-003-02 | Seven reusable roles, selective routing, read-only reviewers and native smoke test | Partial: seven TOMLs parsed/discovered; security role executed; others not individually executed; skills not fully validated | .codex/agents, .agents/skills, scripts/setup-project-agents.py, docs/AGENT_VALIDATION.md; Claude-native setup pending |
| BT-003-03 | Secret scanning and repository controls | Partial: pinned workflow prepared; GitHub scanning/push protection enabled; main protection absent | .github/workflows/security.yml, .gitignore; CI result/protection enforcement pending |
| BT-004-01 | Verify actual TaskTracker reuse seams | Partial: source inventory complete; editor/theme mismatches recorded, dependencies not selected | docs/TASKTRACKER_REUSE.md; component/runtime verification pending |
| BT-001-01 | Threat/permission model with release gates | Partial: prototype design recorded, no runtime enforcement | docs/FOUNDATION_DESIGN.md; BT-004-01, trusted identity/storage decisions pending |
| BT-001-02 | Deny by default and explicit grants with negative tests | Partial: local helper tested for identity flag, admin separation, scope, expiry and revocation | lib/foundation.cjs, test/foundation.test.cjs; trusted server adapter and every indirect/API surface pending |
| BT-002-01 | Recovery runbook, independent privileges and isolated validation | Partial: design/runbook only | docs/RECOVERY_RUNBOOK.md; storage, keys, schedules, retention and RPO/RTO pending |
| BT-002-02 | Authenticated encryption and nonmutating isolated preview | Partial: synthetic round trip, tampering/key/scope/schema/attachment failures tested; grants stripped | lib/foundation.cjs, test/foundation.test.cjs; executable/atomic restore, owner reconciliation, financial invariants and independent reviews pending |
