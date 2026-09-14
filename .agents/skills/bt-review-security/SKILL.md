---
name: bt-review-security
description: Review BudgetTracker identity, isolation, storage, integrations and backup/restore privacy without edits.
---

Use security-privacy-reviewer and the project governance. Preserve TaskTracker review-auth and review-auth-identity's distinction between login mechanics and identity lifecycle. Trace verified provider subject to account, invitation recipient, membership, explicit resource grant, revocation and audit. Check duplicate/case-normalized identities, orphaned ownership, stale sessions, role drift and read/write symmetry. A contact or recorded payer grants no login or debit authority. Site administration must not imply financial access.

Map each route and indirect surface (search, aggregate, autocomplete, export, receipt, notification, offline write) to server-side authorization. Examine secret/log handling, opt-in external transfers, private caches, keys, deployments and independent backup privileges. Validate restore against current revocations/expired grants, isolated integrity, schema, attachment completeness and failure atomicity. Use docs/RECOVERY_RUNBOOK.md when present. Read-only: no identity changes, messages, secrets, destructive probes or external mutations. Report source/runtime evidence and untested controls separately.
