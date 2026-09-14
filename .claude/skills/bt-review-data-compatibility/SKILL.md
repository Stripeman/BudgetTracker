---
name: bt-review-data-compatibility
description: Review financial field lifecycles, migration compatibility and monetary invariants in BudgetTracker.
---

Use financial-accuracy-reviewer; include security-privacy-reviewer for ownership, grant, backup or restore effects. Read governance and relevant schema/readers/writers/tests without edits or real-data mutations.

Map each field through default, validation, normalization, write, readback, updates, serialization, import/export, backup/restore, history, legacy absence and unknown values. Review null/empty distinctions, partial records, mixed versions, forward/backward compatibility, idempotency, concurrent updates and round-trip fidelity. Do not recommend destructive migrations without a pre-migration recovery point and tested rollback.

Use independent expected arithmetic for precise minor units/decimals, currency precision, residuals, transfers, debt and shared allocations. Prove repayment and forecast transitions do not double count. Return compatibility matrix, exact seams, failures, missing tests, safe migration expectations and unresolved decisions. Automated tests are not proof of operational recovery.
