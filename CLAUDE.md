# BudgetTracker implementation rules

- Read docs/PROJECT_BRIEF.md, docs/REQUIREMENTS.md, PROJECT_STATE.md, and SECURITY.md before implementation.
- Git is authoritative for source, safe configuration templates, infrastructure, tests, and documentation.
- Use feature branches. Do not push to main, merge PRs, or deploy Production. Terry controls release approval.
- Security, restrictive server-side permissions, backups, and tested restores are the foundation and first milestone.
- This repository is public. Never commit secrets, actual financial data, receipts, backups, or private exports.
- Maintain .gitignore; inspect staged diffs and file lists before committing. Never force-add ignored private files.
- Add automated secret scanning and repository/environment protection controls; report controls accurately while pending.
- Inspect TaskTracker’s actual code before confirming its stack or reusing components. Preserve its editor and moon/sun selector behavior.
- Maintain README.md, PROJECT_STATE.md, and the requirement register. Keep the proposed GitHub description aligned with scope.
- Give each feature and defect a stable BT identifier and acceptance evidence. Partial work remains partial.
- Proceed autonomously with authorized branch work and focused checks. Ask only about genuine blockers.
- Exclude eSIM offerings, card issuance, affiliate sales, and financial-product advertising.

## Reusable roles and handoff

- Read the complete canonical brief; docs/BRIEF_RECONCILIATION.md records the full Word comparison with no additions or conflicts.
- Native Codex roles live in .codex/agents/*.toml; invocation and boundaries are in .codex/agents/README.md. Supporting procedures live in .agents/skills/. Claude may read these instructions; native Claude configuration is not installed or validated.
- One implementation owner writes for each scope. Reviewers remain read-only and return evidence; the owner applies accepted fixes.
- Use archaeology before potential TaskTracker reuse. Use UX/UI, usability and accessibility reviewers for meaningful interface changes; security for identity/access/storage/integration/backup/restore; financial for calculations/data models. Use security and financial reviews at major milestones and before release. Do not run the whole team for every small commit.
- Preserve the required Tiptap and moon/sun behavior despite the inspected TaskTracker mismatch; see docs/TASKTRACKER_REUSE.md.
- Follow PROJECT_STATE.md for checkpoint evidence, limitations and next steps. Explicitly read repository instructions even when the app displays Agents.md: <none>.
