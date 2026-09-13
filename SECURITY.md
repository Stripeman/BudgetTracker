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

## Checkpoint assurance — 2026-09-13

The earlier assurance paragraph describes the initial baseline. Local additions now include a pinned Gitleaks/test workflow and a synthetic in-memory authorization/encrypted-snapshot preview prototype with four passing tests. No API identity verification, durable backup, executed restore, scheduler or deployment is operational. Preview strips archived grants and is explicitly non-executable; current-owner and revocation reconciliation is still required before restore execution can exist. Independent security/financial code review remains pending.

Read-only GitHub API inspection observed secret scanning and push protection enabled, Dependabot security updates disabled, and no main branch protection (404 Branch not protected). Workflow execution, environment isolation and deployment identity controls remain unverified. Documentation and local tests do not enforce those remote controls.

## Claude takeover update — 2026-09-13

- **CI.** The `secret-scan` and `foundation-tests` jobs passed on GitHub for `2360b79`, on both the push and the pull request.
- **Branch protection.** On 2026-09-13 Claude configured `main` protection through the GitHub API, under the repository instruction to add protection controls. A pull request is required (zero approvals, so the sole maintainer can merge), both checks must pass, conversations must be resolved, the rule is enforced for administrators, and force-push and deletion are blocked. Dependabot vulnerability alerts and automated security fixes are now enabled.
  - Residual gap: agents act with Terry's administrator token, so they could technically change these settings. Instructions prohibit that, but true enforcement needs a separate, non-admin agent identity.
- **Staged scanning.** `scripts/scan-staged.cjs` and `.githooks/pre-commit` block commits that stage:
  - private paths (environment files, key material, databases, archives and backups, bank exports, spreadsheets, documents, private-data directories, CSV and images outside fixtures)
  - secrets
  - personal email addresses
  - Luhn-valid card numbers
  - valid IBANs

  The hook then runs gitleaks 8.30.1. That binary was downloaded to the ignored `.local/bin` and its SHA-256 checked against the release checksums. The hook is per-clone and can be bypassed locally; CI is the enforced layer.
- **Identity ingress assumption.** The API trusts `x-ms-client-principal` only because the managed Functions app is reachable solely through Static Web Apps, which sets that header after Google sign-in. Bring-your-own Functions, a directly exposed Functions host or port 7071 would break this assumption. The local dev server injects fictional principals on loopback only. Local file storage is refused whenever Azure environment markers are present.
- **Backups and restores** (checkpoint C). Workspace archives are encrypted with AES-256-GCM, using an authenticated header and a per-workspace key derived with HKDF from rotatable master keys. They are stored only in separate backup storage and are never downloadable. Restores are limited to the caller's own scope, and previews return counts only. Archived access is never restored. Replace is confirmed, ETag-guarded, preceded by a recovery point and applied as one conditional write. Scheduled backups, immutable retention, Key Vault custody and monitoring are **not** operational (no Staging infrastructure yet); see `docs/RECOVERY_RUNBOOK.md`.
- **Prototype review.** An independent review found the foundation prototype PARTIAL. The findings, and the properties the production port must have, are recorded in `docs/FOUNDATION_DESIGN.md`.
