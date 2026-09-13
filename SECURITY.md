# Security foundation

Security is the primary foundation of BudgetTracker. Financial features depend on validated isolation, authorization, secret handling, automated backups, and tested recovery.

## Public Git handling

Maintain .gitignore for credential files, environment configuration, financial data, attachments, exports, backups, emulator storage, and build output. Use fictional seed data in an explicitly named fixtures directory only after review.

Before commits, review staged paths and content. Ignore rules do not prevent force-adds, inline secrets, or disclosure in tracked files. Do not store secrets in examples, workflows, README content, logs, issue bodies, or PR descriptions. Add automated secret scanning and configure available GitHub protection controls before application implementation.

If a secret is exposed, revoke or rotate it immediately and follow a documented incident and history-cleanup process. Do not paste its value into a public issue.

## Application and recovery requirements

Deny access by default and enforce permissions server-side on every route, search, aggregate, export, attachment, and background task. Keep site administration separate from financial access. Encrypt backups and restrict their access independently. Validate isolated restore, archive integrity, financial balances, attachments, and permission behavior.

## Current assurance

These are requirements, not completed application controls. No application, scheduled backup, restore engine, secret-scanning workflow, or deployment protection has been implemented yet. Record verified controls and outstanding gaps in PROJECT_STATE.md.
