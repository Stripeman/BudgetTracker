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
4. If the preview shows a blocker (for example, a transfer linked to another member's private account, or current data that already fails an integrity rule, which the blocker names), escalate to a recovery operator.

Limits (security and financial release review, 2026-09-13):
- A merge or replace that would change nothing is refused (`nothing_to_restore`) and writes nothing — no recovery point, history or audit entry.
- Members below manager may run at most 3 restores a day per workspace (`restore_limit`, 429); owners and managers are not limited. Each restore writes a full recovery point, and each attempt by such a member is reserved in the backup index before its recovery point is written, so at most 6 recovery points a day can come from one member even with parallel or failed attempts.
- Recovery points are written even when the site administrator has switched off on-demand backups: they are the restore's own safety net.
- On-demand backups are limited per day: 12 for each owner, 4 for each manager and 8 for managers together. They are refused before any archive is written when the workspace is full. Only owners may use the last half of the workspace's reserved headroom, so a full workspace can always be administered by its owner.
- A restore may not take the workspace past its size limit (`workspace_full`), and records a member's restores set aside count toward that member's storage allowance. Both are checked before anything is written.
- Replace keeps categories, merchants and contacts that are not in the backup (other records may refer to them), and leaves unchanged any record the backup holds outside your scope — for example a private account shared after the backup.
- Restore history shows backup and recovery-point ids only to owners, managers and the person who ran that restore. A restore by anyone but an owner is recorded in the activity log and in restore history for that person only.
- A restore that would leave records inconsistent — for example a merge that adds a reversal beside an original that no longer names it — is blocked and names the rule it would break.
- Replace leaves an account the backup holds outside your scope exactly as it is now, with all of its entries and bills.
- A new workspace from a backup counts toward the person's limit of 20 active workspaces they created.

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

## Recovery log

Newest first. One entry per drill or real recovery, with the fields listed in step 4 above. No names, amounts, emails or workspace ids (this repository is public); the operator keeps the workspace id in local notes.

| Date (UTC) | Environment | Archive id and time | Schema / key | Candidate commit | Operator and authorization | Durations | Recovery-point age | Checks | Gaps |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-14 | Production (first release) | `bak_mu18lp87d8a425d630bf`, 2026-09-14T12:46:35Z (on-demand backup taken by the site owner of his own workspace) | 1 / `prd1` (the escrowed key) | `31b17b1` | Implementation agent, authorized by Terry; archive read through operator storage access (account-key auth — his login has no blob-data role), keys loaded into the drill process only, isolated copy and downloaded archive deleted afterwards | restore 5.0 ms, verify 1.4 ms, total 6.4 ms | 0.1 h | header.workspace-matches, decrypt-and-validate, attachments-complete, balances-match-manifest, counts-match-manifest: all ok — **passed** (counts: 2 accounts, 2 entries, 1 merchant, 17 categories, 1 member, 0 attachments) | First Production drill, on a very small workspace. Timings are not an RPO/RTO measurement. No scheduled backups yet (accepted for the first release). The escrow file is still on the PC until Terry moves it offline. |

## Evidence

- `api/test/backup.test.js`: 13 acceptance tests, including an edit that lands while the recovery point is being written. That edit is never overwritten: the final conditional write fails with `stale_preview`.
- Mutation checks in a disposable copy: restoring archived grants, skipping the pre-decrypt workspace check, a restore scope that ignores ownership, skipping the pre-restore recovery point, skipping the preview-ETag check, and dropping the final write's `ifMatch` are each caught by at least one test.
