# Recovery runbook — BT-002

This is the foundation acceptance procedure, not an operational service runbook. Never use real financial data in development or Git.

1. Identify the authorized recovery operator, source workspace, schema version, target isolated environment and archive/key provenance. Ordinary resource access does not confer recovery authority.
2. Verify the independent recovery copy and key access. Record only nonsecret metadata; do not upload archives or keys to tickets, logs or Git.
3. Authenticate/decrypt the archive. Reject wrong keys, tampering, incompatible schema, missing attachments, invalid monetary values and cross-workspace records before mutations.
4. Preview counts, conflicts and intended operation without changing storage. Strip archived grants; reconcile current revocations and expirations through explicit reauthorization before any sharing. Never silently restore memberships as active.
5. Validate isolated balances, attachment hashes/completeness and negative permissions. Test revoked-user denial, unrelated workspace denial, site-admin separation and queued-write rejection.
6. Before any future replace operation, require explicit confirmation and an independently restorable pre-change recovery point. Use staged atomic execution; interruption must leave the original intact and permit safe restart.
7. Record archive/schema version, candidate commit, fictional test scenario, duration, measured recovery point, integrity checks, permission checks, results and remaining gaps. Do not claim RPO/RTO achievement from unit tests.

Local prototype check: `node --test test/*.test.cjs`. This checks authenticated encryption, tamper rejection, scope checks and grant stripping using synthetic in-memory snapshots. Scheduled backups, persisted restore, key custody, immutable retention, monitoring, service-wide disaster recovery and achieved recovery objectives remain unimplemented.
