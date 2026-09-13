# Recovery runbook — BT-002

This procedure is Git-tracked and must match the code. Never use real financial data in development or Git, and never paste archives, keys or reports containing identifiers into tickets, chats or logs.

## What exists (application layer, verified by tests)

- **On-demand encrypted workspace backups.** `POST /api/backups` (workspace owners and managers). Each archive is one consistent snapshot of the workspace document (financial records, ownership, grants, settings) plus content-addressed attachments.
- **Encryption.** AES-256-GCM with a key per workspace, derived with HKDF-SHA256 from a master key. A plaintext header (workspace, archive id, schema, time, key id, reason) is authenticated. The bytes are validated after serialization and test-decrypted before the backup is recorded.
- **Separate storage.** Archives live in backup storage, separate from data storage, and are never downloadable through the application.
- **Workspace restore.** `POST /api/restore?action=preview|execute` with modes `create-new`, `merge` and `replace`.
  - The preview is non-mutating and summary-only.
  - Scope is limited to what the caller may manage: owners get shared records and their own private accounts; other members get only their own private accounts.
  - Replace needs `confirm: "REPLACE"` and the preview ETag. It writes a pre-restore recovery point, then attachments create-only, then one conditional document write.
  - Archived memberships, grants and invitations are never restored.
- **Isolated operator drill.** `scripts/recovery/drill.cjs` performs a service-level full-document restore into an empty isolated directory, verifies it, and reports counts, checks and durations only.

## What does not exist yet (do not claim it)

Scheduled automatic backups and immutable (WORM) retention are **pending**: Staging infrastructure is not established. Also pending:
- backup-failure alerting and monitoring
- a last-successful-backup display
- key-vault custody and rotation procedures in Azure
- a service-level disaster-recovery restore into live storage
- measured RPO/RTO from drills in Staging

The planned infrastructure is:
- Azure Blob versioning, soft delete and point-in-time restore on the data account
- an Azure Backup vault (operational backup) for the storage accounts
- a separate backup container with a time-based immutability policy
- master keys held in Key Vault and referenced from app settings
- an external scheduler calling a backup operator identity

Record that design as an ADR before provisioning.

## Configuration (names only; values live in secure settings, never in Git)

| Setting | Purpose |
|---|---|
| `BT_BACKUP_STORAGE` | `blob` (deployed) or `file` (local development only) |
| `BT_BACKUP_CONNECTION_STRING`, `BT_BACKUP_CONTAINER` | Backup storage; must differ from the data container and connection |
| `BT_BACKUP_DIR` | Local development only; must differ from `BT_FILE_STORAGE_DIR` |
| `BT_BACKUP_KEYS` | `id:base64(32 bytes)` entries, comma-separated. Keep old ids until their archives expire. |
| `BT_BACKUP_ACTIVE_KEY` | Key id used for new archives |

**Rotation.** Add the new key, switch `BT_BACKUP_ACTIVE_KEY`, and keep the old key listed. Remove it only after every archive using it has passed retention. Removing it early makes those archives fail with `backup_key_unavailable`, which is tested.

## Backup-key escrow (Terry; required before Production holds real data)

Backup master keys live only in the app's settings, so losing the app or mis-editing a setting would make every archive unreadable. Keep an offline copy, and prove it works:

1. After `scripts/deploy/configure-settings.ps1` has generated the environment's key, run:

   ```powershell
   $t = Get-Content .local/deploy-target.json -Raw | ConvertFrom-Json
   ./scripts/recovery/escrow-keys.ps1 -SubscriptionId $t.subscriptionId -TenantId $t.tenantId -Environment production -AuthorizedProduction
   ```

   It writes `.local/escrow/<environment>-backup-keys-<time>.env` (ignored by Git), prints only the key ids and a fingerprint, and refuses to overwrite an earlier file.
2. Create a backup of a workspace in that environment, download the archive from the backup storage account into an ignored `.local/` folder, and load the escrowed keys into the shell for this step only (see the drill below). Run the drill. A `passed` report proves the escrow copy opens real archives.
3. Clear the keys from the shell. Move the escrow file and a note of its fingerprint to offline storage under Terry's control (for example a password manager entry or an encrypted USB drive). Record the date, fingerprint and drill result in `PROJECT_STATE.md` — never the key.
4. Repeat after every key rotation: the escrow copy must list every key id that archives still use.

## Workspace recovery (workspace owner or member, in the application)

1. Choose the archive. Run **preview** with the intended mode. Review the counts, totals for your accounts, exclusions and blockers. The preview changes nothing.
2. `merge` adds missing records and skips conflicts. `create-new` makes a new workspace with you as sole owner. `replace` rolls your scope back to the archive.
3. For replace, confirm with `REPLACE`. A recovery point is written first. If the document write fails or the workspace changed, nothing changes, and you can preview and execute again.
4. If the preview shows a blocker (for example, a transfer linked to another member's private account), escalate to a recovery operator.

## Service-level recovery drill (recovery operator only)

The operator role is separate from site administration and from workspace roles. It requires access to backup storage and keys, and grants no application access.

1. Identify the operator, the workspace id, the archive id and the isolated target, and record who authorized the drill. Obtain the archive through operator storage access, not through the application.
2. Export the keys into the operator shell only for the duration of the drill. Then run:

   ```powershell
   Get-Content <escrow file>.env | ForEach-Object { $n, $v = $_ -split '=', 2; if ($n) { Set-Item "env:$n" $v } }
   node scripts/recovery/drill.cjs --archive <file.btbk> --workspace <wsId> --target <new empty dir>
   Remove-Item env:BT_BACKUP_KEYS, env:BT_BACKUP_ACTIVE_KEY
   ```

3. The drill refuses a non-empty target, a mismatched workspace, tampering, a wrong or missing key, a newer schema, missing or altered attachments and any financial-invariant failure. Invariants checked:
   - every entry references an account in the same currency
   - amounts are valid integers
   - splits sum exactly
   - transfer legs pair, net to zero in one currency and share their deletion state
   - recomputed balances match the manifest
4. Record in the recovery log:
   - archive id and time
   - schema and key id
   - candidate commit
   - operator
   - durations
   - recovery-point age
   - check results
   - any gaps

   The report contains no names, amounts or emails. Do not claim RPO or RTO achievement from unit tests; only Staging drills with measured timings count.
5. Destroy the isolated copy and clear the keys from the shell after the drill.

## Evidence

- `api/test/backup.test.js`: 13 acceptance tests, including an edit that lands while the recovery point is being written. That edit is never overwritten: the final conditional write fails with `stale_preview`.
- Mutation checks in a disposable copy: restoring archived grants, skipping the pre-decrypt workspace check, a restore scope that ignores ownership, skipping the pre-restore recovery point, skipping the preview-ETag check, and dropping the final write's `ifMatch` are each caught by at least one test.
