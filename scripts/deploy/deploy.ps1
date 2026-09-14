<#
.SYNOPSIS
  Deploys BudgetTracker to an EXPLICIT environment of its own Static Web App.

.DESCRIPTION
  -Environment preview      the named preview environment "preview" (fictional data only).
  -Environment production   REFUSED unless -AuthorizedProduction is passed, HEAD is on main and
                            equal to origin/main with a clean tree, and the operator types the
                            Static Web App name. Production needs Terry's explicit authorization
                            for the exact commit.

  The deployment token is read from Azure at run time, held in memory only, never printed, logged
  or stored. The artifact is built from an allowlist (scripts/build-artifact.mjs). Tests and the
  validator must pass first. Deployment success is NOT application validation — verify separately.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [ValidatePattern('^[0-9a-f-]{36}$')] [string] $SubscriptionId,
  [Parameter(Mandatory)] [ValidatePattern('^[0-9a-f-]{36}$')] [string] $TenantId,
  [Parameter(Mandatory)] [ValidateSet('preview', 'production')] [string] $Environment,
  [string] $ResourceGroup = 'budget-tracker',
  [string] $SwaName = 'budget-tracker',
  [switch] $AuthorizedProduction
)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot/../..")

$tenant = az account show --subscription $SubscriptionId --query tenantId -o tsv --only-show-errors
if ($tenant -ne $TenantId) { throw 'Subscription is not in the selected tenant. Nothing was deployed.' }

$commit = (git rev-parse HEAD).Trim()
# Every deployment is tied to an exact commit: a dirty tree would publish something that is not
# that commit (this happened once in preview on 2026-09-13 and is recorded in PROJECT_STATE.md).
if (git status --porcelain --untracked-files=no) { throw 'Commit your changes first: deployments must come from a clean tree so the deployed artifact equals the recorded commit.' }
if ($Environment -eq 'production') {
  if (-not $AuthorizedProduction) { throw 'Production deployment requires Terry''s explicit authorization (-AuthorizedProduction).' }
  if ((git branch --show-current).Trim() -ne 'main') { throw 'Production deploys only from main.' }
  git fetch origin main --quiet
  if ($commit -ne (git rev-parse origin/main).Trim()) { throw 'HEAD must equal origin/main.' }
  if (git status --porcelain) { throw 'The working tree must be clean.' }
  $typed = Read-Host "Type the Static Web App name ($SwaName) to deploy commit $($commit.Substring(0,7)) to PRODUCTION"
  if ($typed -ne $SwaName) { throw 'Confirmation did not match. Nothing was deployed.' }
}

Write-Host "Gate: tests and validation"
npm test | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Tests failed. Nothing was deployed.' }
npm run validate | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Validation failed. Nothing was deployed.' }

Write-Host "Build: allowlisted artifact"
node scripts/build-artifact.mjs | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Artifact build failed. Nothing was deployed.' }

$token = az staticwebapp secrets list -n $SwaName -g $ResourceGroup --subscription $SubscriptionId --query 'properties.apiKey' -o tsv --only-show-errors
if (-not $token) { throw 'Could not read the deployment token.' }
$swaEnv = if ($Environment -eq 'production') { 'production' } else { 'preview' }
Write-Host "Deploy: commit $($commit.Substring(0,7)) -> $SwaName ($swaEnv)"
$env:SWA_CLI_DEPLOYMENT_TOKEN = $token
try {
  npx --no-install swa deploy .local/artifact/site --api-location .local/artifact/api --api-language node --api-version 22 --env $swaEnv --no-use-keychain | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Deployment command failed.' }
} finally {
  Remove-Item Env:SWA_CLI_DEPLOYMENT_TOKEN -ErrorAction SilentlyContinue
  $token = $null
}
# Record the exact deployed commit (non-secret) so the running app reports it publicly through
# /api/site-settings `app.commit` and the footer. Only after a successful deploy.
$envArgs = if ($swaEnv -eq 'production') { @() } else { @('--environment-name', $swaEnv) }
az staticwebapp appsettings set -n $SwaName -g $ResourceGroup --subscription $SubscriptionId @envArgs --setting-names "BT_COMMIT=$commit" --only-show-errors | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Warning 'Deployed, but BT_COMMIT could not be recorded; the app will report the previous commit.' }
Write-Host "Deployed commit $commit to $swaEnv. Now verify the running application separately."
