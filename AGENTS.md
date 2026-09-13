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
