# Deployment — BudgetTracker

Terry's decisions (2026-09-13):
- One dedicated Azure Static Web App for BudgetTracker, following TaskTracker's approved platform conventions.
- No second Static Web App or separate Staging instance yet.
- Feature builds may go to an isolated **preview** environment of that one app, with fictional data and preview-only storage.
- **Production stays empty until Terry explicitly authorizes it.**
- DNS is documented here but not changed.

TaskTracker's resources, settings, secrets and data are never touched or copied.

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
| preview | named preview environment `preview` | `stbudgetpv01` | `stbudgetbkpv01` | fictional only | provisioned 2026-09-13; application not yet deployed |
| production | production environment | `stbudgetprd01` | `stbudgetbkprd01` | real | **not created**; needs Terry's explicit authorization |
| staging (future) | a separate SWA or the named environment `staging` | own accounts | own accounts | fictional | not planned yet |

Adding Staging later needs no redesign:
- Every environment boundary is configuration: `BT_ENVIRONMENT`, storage and backup connection settings, backup keys, and the Google client.
- The API refuses to run without explicit storage settings.
- It refuses backup storage that equals data storage.
- It shows the environment in `/api/me`.
- `scripts/deploy/provision.ps1` provisions any environment's accounts with the same controls.

**Storage controls** (verified by the provisioning script): StorageV2, Standard_LRS, TLS 1.2 minimum, HTTPS only, blob public access disabled, cross-tenant replication disabled, blob versioning, and blob and container soft delete (14 days for data, 35 days for backups). Data and backup storage are **separate accounts with separate keys**, so a leaked data key cannot delete recovery points.

**Not applied yet:** immutable (WORM) retention on the production backup container. A *locked* policy cannot be undone, so it needs Terry's decision before production. The recommendation is a time-based policy on the backups container, tested unlocked first.

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
| `BT_BACKUP_KEYS`, `BT_BACKUP_ACTIVE_KEY` | backup master keys (`id:base64`) and the active id | **yes** | agent generates for preview; **Terry holds an offline escrow copy for production** |
| `BT_SITE_ADMINS` | operational site admins; use the provider subject shown by `/api/me` | no | Terry |
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

- **Artifact.** Built from an allowlist (the site shell, `app/`, `staticwebapp.config.json`, `version.json`, and the API without tests). Tooling, docs, tests and local data are never published.
- **Preview deploys.** Run locally by the implementation agent through `scripts/deploy/deploy.ps1 -Environment preview` (added with the frontend). The SWA deployment token is read from `az` at run time, held in memory only and never printed or stored. It is not placed in GitHub secrets, because the single token can deploy to every environment of the app.
- **Production deploys.** Refused unless Terry explicitly authorizes the exact commit. The script then additionally requires `-AuthorizedProduction`, a clean tree on `main` equal to `origin/main`, and a typed confirmation.
- **After any deploy.** Verify the running app separately (`/version.json`, `/api/me` environment and commit, sign-in, permission smoke checks) and report deployment and verification as separate claims.

## Monitoring and logging

- Application Insights receives Functions telemetry through `APPLICATIONINSIGHTS_CONNECTION_STRING`.
- The API logs only error codes, request ids and stack frames — never bodies, amounts, names, notes or tokens.
- Backup-failure alerting is pending (see `docs/RECOVERY_RUNBOOK.md`).

## Residual risks (recorded, not hidden)

- **One deployment token.** A Static Web App has one deployment token for all its environments. Anyone holding it could deploy production. It is fetched only at run time and never stored. A separate production SWA or token rotation after use would remove this risk.
- **Agent credentials.** Agents operate with Terry's Azure and GitHub admin credentials. Instructions, not identities, currently restrict them from production and settings changes. A dedicated least-privilege deployment identity is recommended before production.
- **Connection strings.** SWA managed functions cannot use managed identity or Key Vault references, so storage access uses connection strings kept in app settings, as TaskTracker does. Rotate the storage keys to revoke access.
- **Backup key escrow.** Backup master keys live in app settings. For production, keep an offline escrow copy under Terry's control, or losing the app would make the backups unreadable.
