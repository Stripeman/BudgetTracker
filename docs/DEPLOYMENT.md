# Deployment — BudgetTracker

Terry's decisions (2026-09-13):
- One dedicated Azure Static Web App for BudgetTracker, following TaskTracker's approved platform conventions.
- No second Static Web App or separate Staging instance yet.
- Feature builds may go to an isolated **preview** environment of that one app, with fictional data and preview-only storage.
- **Production stays empty until Terry explicitly authorizes it.**
- DNS is documented here but not changed.

TaskTracker's resources, settings, secrets and data are never touched or copied.

## Deployment path inventory and TaskTracker comparison (BT-003-05, 2026-09-16)

Terry's instruction (2026-09-16): one supported deployment entry point, adapted from TaskTracker's
proven structure, never bypassed by another script, CLI command or workflow. Before this
consolidation:

- **TaskTracker** ships a thin `deploy.ps1` that only parses arguments and prompts for the
  (currently suspended) production confirmation; every rule — gate ordering, production
  confirmation, environment resolution, secret handling, the health check, the receipt — lives in
  a Node engine under `scripts/deploy/engine/` (`cli.js`, `operations.js`, `environments.js`,
  `gateevidence.js`, …), plus a guided browser Setup Wizard and a `--ci` token-authenticated mode.
  Its own documentation states the point precisely: "this CLI and the browser Setup Wizard enforce
  exactly the same things and cannot drift apart" — calling the engine's CLI directly is exactly as
  safe as `deploy.ps1`, because the rules live in one place.
- **BudgetTracker (before this change)** had every rule inline in one 72-line
  `scripts/deploy/deploy.ps1`: the tenant check, clean-tree/branch checks, the typed production
  confirmation, the `npm test`/`npm run validate` gate, the artifact build and the `swa deploy`
  call were one PowerShell script, with nothing separately invocable or unit-testable. There was
  no automated post-deploy health check (it printed "now verify the running application
  separately" and stopped), no secret-scan step in the deploy path itself (only in the pre-commit
  hook and CI), and no structured receipt beyond a few `Write-Host` lines. `docs/REQUIREMENTS.md`
  and `PROJECT_STATE.md` documented every real deploy as `deploy.ps1 -Environment preview`, yet
  `-SubscriptionId`/`-TenantId` were Mandatory PowerShell parameters with no fallback — every
  invocation actually also passed them, supplied by an operator or agent from memory or from
  `.local/deploy-target.json` by hand, a step the documented command line never showed.

**Every path that could reach Azure before this change, and its disposition now:**

1. `scripts/deploy/deploy.ps1 -Environment preview|production` — the documented, actually-used
   path. **Kept as the one supported entry point**, now a thin interface over
   `scripts/deploy/engine.mjs`.
2. Manually running the same `az`/`npx swa deploy` commands by hand, with a token fetched via
   `az staticwebapp secrets list` — always technically possible for anyone with the `az` CLI and
   Azure access (true of TaskTracker's engine too: access to the subscription is the real trust
   boundary, not which script is used) and was not gated by any repository rule. **Cannot be
   closed by software**; it is now explicitly documented as unsupported everywhere it used to be
   implied, and every actual gate (tests, validate, secret scan, confirmation, health check) lives
   only in the engine an operator would be bypassing.
3. `node scripts/build-artifact.mjs` (`npm run build:artifact`) followed by a manual
   `npx swa deploy` — the build step never touched Azure by itself, but nothing stopped an
   operator from building the artifact once and deploying it outside every gate. **Unaffected in
   raw capability** (same caveat as path 2), but a structural test
   (`scripts/deploy/test/engine.test.mjs`) now asserts `scripts/deploy/engine.mjs` is the only
   tracked file that invokes the SWA CLI's `deploy` command, so no second in-repo path can be
   added silently, and no `npm` script performs a deploy.
4. `scripts/deploy/provision.ps1` and `scripts/deploy/configure-settings.ps1` — these never ship
   application code (they create infrastructure and set application settings), so they are not
   deployment paths, but were not clearly distinguished from "the deployment process" in prose.
   **Kept as separate, occasional operator scripts**, each already independently requiring
   explicit tenant verification and, for production, a typed confirmation; now explicitly labelled
   as a different concern in their own headers and here.
5. No CI workflow deploys anything (`.github/workflows/security.yml` only runs `secret-scan` and
   `foundation-tests`); `scripts/recovery/*.ps1`/`*.cjs` (drill, escrow) are a separate
   recovery-operator concern (`docs/RECOVERY_RUNBOOK.md`) and never touch the SWA deploy path.
   **Unchanged**, and explicitly noted as out of scope here.

**Deliberate differences from TaskTracker's engine shape** (read-only inspected via
`git -C T:/repos/TaskTracker show main:<path>`; structure adapted, nothing copied): no Setup
Wizard, no `--ci` token-authenticated mode, and no `--skip-tests`/`--skip-live-check` flags —
Terry's instruction requires the complete gate (test, validate, build, secret-scan, health check)
on every deploy, with nothing to weaken it. The typed production confirmation is never suspended:
TaskTracker currently suspends its own interactive prompt "for the beta development phase", which
this repository's rules call a historical deployment exception and say not to copy
(`docs/TASKTRACKER_REUSE.md`).

## Target (explicitly selected; never inferred from `az` context)

| Dimension | Value |
|---|---|
| Subscription | TerryRemsiksSubscription. The subscription and tenant ids are kept in the ignored `.local/deploy-target.json`; this repository is public. Re-verify with `az account show --subscription <id>` before any change. |
| Resource group | `budget-tracker` |
| Region | `eastus2` (East US 2) |
| Static Web App | `budget-tracker`, **Standard** plan. Required for the custom Google provider and `rolesSource`. |
| Monitoring | Log Analytics `log-budget-tracker` (30-day retention); workspace-based Application Insights `appi-budget-tracker` |

## Environments

| Environment | SWA environment | Data storage | Backup storage | Data | Status |
|---|---|---|---|---|---|
| preview | named preview environment `preview` — https://polite-plant-03bb7570f-preview.eastus2.3.azurestaticapps.net | `stbudgetpv01` | `stbudgetbkpv01` | fictional only | deployed 2026-09-13 with settings configured (see PROJECT_STATE for the exact commit and verification) |
| production | production environment | `stbudgetprd01` | `stbudgetbkprd01` | real | **not created**; needs Terry's explicit authorization |
| staging (future) | a separate SWA or the named environment `staging` | own accounts | own accounts | fictional | not planned yet |

Adding Staging later needs no redesign:
- Every environment boundary is configuration: `BT_ENVIRONMENT`, storage and backup connection settings, backup keys, and the Google client.
- The API refuses to run without explicit storage settings.
- It refuses backup storage that equals data storage.
- It shows the environment in `/api/me`.
- `scripts/deploy/provision.ps1` provisions any environment's accounts with the same controls.

**Storage controls** (verified by the provisioning script): StorageV2, Standard_LRS, TLS 1.2 minimum, HTTPS only, blob public access disabled, cross-tenant replication disabled, blob versioning, and blob and container soft delete (14 days for data, 35 days for backups). Data and backup storage are **separate accounts with separate keys**, so a leaked data key cannot delete recovery points.

**Immutable (WORM) retention on the production backups container (Terry, 2026-09-13: unlocked policy now).** The `backups` container in `stbudgetbkprd01` is created with **version-level** immutability and a default time-based policy of 35 days, **unlocked**. Version level is required: the backup index (`workspaces/<id>/index.json`) is rewritten on every backup and reservation, which a container-level policy would forbid; with version-level immutability each rewrite simply creates a new protected version. Every archive and every earlier version of the index is kept unchangeable for 35 days. Unlocked means the policy can still be changed or removed; locking is a separate, irreversible decision for later. Enabling version-level support on a container cannot be undone, and the container cannot be deleted while it holds blobs — both consistent with nothing ever being deleted.

## Application settings (names only; values never in Git, chat or logs)

These are set per environment on the SWA.

| Setting | Purpose | Secret | Who sets it |
|---|---|---|---|
| `BT_ENVIRONMENT` | `preview`, `staging` or `production` (shown in the app) | no | agent |
| `BT_COMMIT` | deployed commit SHA (shown in the app) | no | deploy script |
| `BT_STORAGE`, `BT_DATA_CONTAINER` | `blob`, `data` | no | agent |
| `BT_STORAGE_CONNECTION_STRING` | data account connection string | **yes** | agent (piped from `az`, never printed) |
| `BT_BACKUP_STORAGE`, `BT_BACKUP_CONTAINER` | `blob`, `backups` | no | agent |
| `BT_BACKUP_CONNECTION_STRING` | backup account connection string | **yes** | agent (piped, never printed) |
| `BT_BACKUP_KEYS`, `BT_BACKUP_ACTIVE_KEY` | backup master keys (`id:base64`) and the active id | **yes** | generated once by `configure-settings.ps1`, never overwritten; **Terry holds an offline escrow copy for production** (`scripts/recovery/escrow-keys.ps1`, `docs/RECOVERY_RUNBOOK.md`) |
| `BT_SITE_ADMINS` | operational site admins, by provider **subject** (`google:<id>` from `/api/me`), never an email (SEC-R10). Terry's subject is kept only in the ignored `.local/deploy-target.json` and passed to `configure-settings.ps1 -SiteAdmins` | no | agent, with Terry's subject |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | BudgetTracker's own Google OAuth client | secret: yes | **Terry** |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | monitoring | treated as secret | agent |

## Google sign-in (Terry's action; BudgetTracker's own client)

1. In Google Cloud, use a project dedicated to BudgetTracker (not TaskTracker's). Create an **OAuth 2.0 Client ID** of type *Web application*.
2. Add these authorized redirect URIs:
   - `https://<preview hostname>/.auth/login/google/callback`, where the preview hostname is shown by `az staticwebapp environment list -n budget-tracker -g budget-tracker` after the first preview deploy
   - later, `https://<production default hostname>/.auth/login/google/callback`
   - later, `https://budget.remsik.org/.auth/login/google/callback`

   Add new URIs alongside the existing ones; never replace them.
3. Set the id and secret yourself so they never pass through an agent. The same pattern applies to production later.

   ```powershell
   az staticwebapp appsettings set -n budget-tracker -g budget-tracker --subscription <id> --environment-name preview --setting-names GOOGLE_CLIENT_ID=<id> GOOGLE_CLIENT_SECRET=<secret> | Out-Null
   ```

Until this is done, sign-in on preview fails closed. The API accepts only the Google provider, and the other providers are blocked in `staticwebapp.config.json`.

## Custom domain `budget.remsik.org` (documented only; do not change DNS without authorization)

The custom domain belongs to the **production** environment. Preview keeps its generated hostname. When Terry authorizes production:

1. At the `remsik.org` DNS provider, add: `budget  CNAME  <production default hostname of budget-tracker>.azurestaticapps.net`.
2. Bind it with `az staticwebapp hostname set -n budget-tracker -g budget-tracker --hostname budget.remsik.org --subscription <id>`. SWA validates subdomains by CNAME. If the DNS provider cannot serve a CNAME there, SWA offers TXT validation (`--validation-method dns-txt-token`) with a TXT record at `_dnsauth.budget`.
3. SWA issues and renews the TLS certificate automatically.
4. Add the Google redirect URI for the custom domain (see above).
5. Verify separately: HTTPS, security headers, sign-in, the `/api/me` environment and version.

## Deployment procedure

**The one supported entry point (BT-003-05, 2026-09-16):**

```powershell
.\deploy.ps1 -Environment preview
.\deploy.ps1 -Environment production -AuthorizedProduction   # only with Terry's current, explicit authorization
```

`deploy.ps1` is a thin interface over `scripts/deploy/engine.mjs`. Every rule below lives in the
engine, so `node scripts/deploy/engine.mjs --environment ...` enforces exactly the same things —
there is no weaker path, only an unsupported one (see the inventory above). Agents and
documentation must never instruct anyone to call the engine, `az`, `npx swa`, GitHub Actions, or
any other script directly instead of `deploy.ps1`.

- **Artifact.** Built from an allowlist (the site shell, `app/`, `staticwebapp.config.json`, `version.json`, and the API without tests). Tooling, docs, tests and local data are never published.
- **Target resolution.** `-SubscriptionId`/`-TenantId`/`-ResourceGroup`/`-SwaName` are optional; when omitted they are read from the gitignored `.local/deploy-target.json` (keys: `subscriptionId`, `tenantId`, `resourceGroup`, `swaName`). Missing subscription or tenant configuration fails closed with a clear message — nothing is ever inferred from ambient `az` context.
- **Validation, in order, before anything is built or uploaded:** the working tree is clean and HEAD is a named branch (not detached); for production, the branch must be `main` and HEAD must equal `origin/main`; the target Static Web App, resource group, environment, branch, commit and app version are printed; for production, the operator must pass `-AuthorizedProduction` AND type the exact Static Web App name when prompted (never suspended, never inferred from a previous run — see "Deliberate differences" above); the subscription's tenant is verified; the Static Web App is confirmed to exist in the named resource group; the target environment's application settings are read and checked for completeness (`BT_ENVIRONMENT`, `BT_STORAGE_CONNECTION_STRING`, `BT_BACKUP_CONNECTION_STRING`, `BT_BACKUP_KEYS`, `BT_BACKUP_ACTIVE_KEY`, `BT_SITE_ADMINS`), for storage isolation (data and backup connection strings must differ) and for a matching `BT_ENVIRONMENT` value.
- **Gates, all required, none skippable.** `npm test`, `npm run validate`, the allowlisted artifact build (`scripts/build-artifact.mjs`), then a secret scan of the BUILT ARTIFACT with gitleaks (`gitleaks dir`, the same binary discovery as the pre-commit hook, exported from `scripts/scan-staged.cjs`). Preview proceeds with a recorded warning if gitleaks is not installed locally (CI's `secret-scan` job remains the enforced layer for the repository); **production refuses outright if gitleaks is unavailable.**
- **Upload.** The SWA deployment token is read from `az staticwebapp secrets list` at run time, held in memory only, and never printed, logged or placed in GitHub secrets (one token can deploy every environment of the app). `BT_COMMIT` is set on the target environment after a successful upload.
- **Post-deploy verification (now automatic).** The engine fetches the deployed `/version.json` and `/api/site-settings` and refuses to call the deploy healthy unless the live `app.commit` equals the exact commit just deployed and `app.environment` equals the target environment. This directly supersedes the earlier "a deploy without the SWA CLI's final 'Project deployed' line has failed, whatever the exit code" heuristic (2026-09-13 incident, kept below for history): the health check now verifies the ACTUAL running commit rather than trusting the CLI's own text output. A successful upload with a failed health check exits with code `2`, and the receipt says `UPLOADED, NOT VERIFIED HEALTHY` — upload success and live verification are always reported as separate, truthful claims. This is still only a SURFACE check (version, commit, environment); it is not application validation — Terry's own sign-in and permission smoke checks remain separate and manual (see PROJECT_STATE.md, "Waiting on Terry").
- **Deployment receipt.** Printed at the end of every completed run: target (Static Web App / resource group / environment), URL, deployed SHA, app version, the ordered list of gate results, and the final result (`SUCCESS` or `UPLOADED, NOT VERIFIED HEALTHY`).
- **Runtime.** The API runs on Node 22 (`staticwebapp.config.json` `apiRuntime`, the engine's `--api-version` argument to `swa deploy`; Terry, 2026-09-13), matching the local and test runtime.
- **Shared with preview (Terry, 2026-09-13: "share both for now").** Production uses the same Application Insights resource and the same Google OAuth client as preview; the Production redirect URI is added to that client. Separating them later needs only new settings.
- **Bypass guards.** `scripts/deploy/engine.mjs` is the only file in the repository that calls `swa deploy` (enforced by a structural test); `deploy.ps1` itself contains no `az`/`swa` calls (only delegation); no `npm` script performs a deploy; `scripts/deploy/provision.ps1` and `scripts/deploy/configure-settings.ps1` are separate, occasional infrastructure/settings scripts, not alternate ways to ship code, and each already independently requires explicit tenant verification and, for production, a typed confirmation; `scripts/recovery/*.ps1`/`*.cjs` are a different, recovery-operator concern (`docs/RECOVERY_RUNBOOK.md`) and never deploy code. `scripts/deploy/test/engine.test.mjs` proves both the gating rules (production confirmation, clean tree, branch, tenant, isolated settings, gate ordering) and the "only one deploy path" structural claim; it runs with the rest of the suite via `npm test`.

### Historical incident (kept for context)

The first preview deploy was labelled `386543c` but included an uncommitted `platform.apiRuntime` line in `staticwebapp.config.json` (2026-09-13). The clean-tree check existed even then; this is why it stays non-negotiable in the engine today.

## Rollback and schema compatibility

Every stored document carries `schemaVersion`. All changes so far are additive within version 1 (`docs/FOUNDATION_DESIGN.md`), so an older version-1 build reads data written by a newer one; a document from a NEWER schema version is refused with 503 and never modified (`api/_shared/schema.js`). A release that bumps `schemaVersion` must record its migration and its own rollback steps first.

In order of speed:

1. **Contain (minutes).** Stop new sign-ins by removing the environment's `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` app settings (Terry). Sign-in then fails closed; stored data is untouched. Restore the settings to reopen.
2. **Roll the code back (tens of minutes).** Production deploys only from `main` equal to `origin/main`, so a rollback is a revert: open a PR that reverts the faulty merge on `main`, let the required checks pass, have Terry merge it, then run `scripts/deploy/deploy.ps1 -Environment production -AuthorizedProduction` (typed confirmation). Verify `/api/site-settings` `app.commit` equals the revert commit. Never force-push `main` and never deploy from a branch.
3. **Recover data.**
   - A single workspace: restore from an encrypted archive through the app (preview first; replace sets current records aside, never drops them), or run `scripts/recovery/drill.cjs` into an isolated folder to inspect an archive first. Archives need the environment's backup key — for Production, the escrowed copy.
   - Storage-level mistakes: blob versioning and soft delete keep earlier versions for 14 days (data) and 35 days (backups).
4. **Never** delete storage accounts, clear containers, rotate backup keys without keeping the old ones, or change DNS as part of a rollback.

Record every rollback — cause, commit, steps and verification — in `PROJECT_STATE.md`.

## Monitoring and logging

- Application Insights receives Functions telemetry through `APPLICATIONINSIGHTS_CONNECTION_STRING`.
- The API logs only error codes, request ids and stack frames — never bodies, amounts, names, notes or tokens.
- Backup-failure alerting is pending (see `docs/RECOVERY_RUNBOOK.md`).

## Residual risks (recorded, not hidden)

- **Dev tooling vulnerabilities.** `@azure/static-web-apps-cli` 2.0.10 (the same pin TaskTracker uses) pulls in `adm-zip` and `tmp`, which `npm audit` flags as high severity, plus `devcert` as low. They affect only the local deploy tooling on the operator's machine and are never published; the API's production dependencies audit clean. Revisit when a patched CLI is released.
- **Deployment from a dirty tree (2026-09-13).** See "Historical incident" under Deployment procedure above; the clean-tree check has applied to every environment since, and is unconditional in the engine.
- **Direct `az`/`swa` invocation remains technically possible.** Anyone with `az` CLI access to the subscription could run the same commands `scripts/deploy/engine.mjs` runs, by hand, bypassing every gate. This cannot be closed by software — the real trust boundary is Azure access, not which script is used (true of TaskTracker's engine as well). The mitigation is that no repository-supported path other than `deploy.ps1` performs the upload (enforced by `scripts/deploy/test/engine.test.mjs`), and every document that could be read as inviting a shortcut now says explicitly not to.
- **One deployment token.** A Static Web App has one deployment token for all its environments. Anyone holding it could deploy production. It is fetched only at run time and never stored. A separate production SWA or token rotation after use would remove this risk.
- **Agent credentials.** Agents operate with Terry's Azure and GitHub admin credentials. Instructions, not identities, currently restrict them from production and settings changes. A dedicated least-privilege deployment identity is recommended before production.
- **Connection strings.** SWA managed functions cannot use managed identity or Key Vault references, so storage access uses connection strings kept in app settings, as TaskTracker does. Rotate the storage keys to revoke access.
- **Open sign-up without request rate limiting.** Any Google account can sign in. Each person may have at most 20 active workspaces they created (including new workspaces from backups and unarchived ones) and may create at most 10 a day, each capped at 12 MB with per-member allowances, and members may run at most 3 restores a day per workspace. There is no per-request rate limiting in the API yet; Static Web Apps offers none for managed functions. Add it (or an allow-list of who may create workspaces) before inviting the public at scale.
- **Backup key escrow.** Backup master keys live in app settings. For production, keep an offline escrow copy under Terry's control, or losing the app would make the backups unreadable.
