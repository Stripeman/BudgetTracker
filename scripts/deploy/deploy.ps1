<#
.SYNOPSIS
  Deploys BudgetTracker to an EXPLICIT environment of its own Static Web App. The ONE supported
  entry point for shipping BudgetTracker code (BT-003-05).

.DESCRIPTION
  This script is an INTERFACE over scripts/deploy/engine.mjs, not an implementation of it. Every
  gating rule — clean-tree and branch checks, tenant verification, Azure resource and application
  settings validation, the test/validate/build/secret-scan gates, the typed production
  confirmation, the post-deploy health check and the deployment receipt — lives in the engine, so
  this script and a direct `node scripts/deploy/engine.mjs ...` invocation enforce exactly the
  same things. There is no flag anywhere in this repository that skips a gate: production readers
  who need that assurance can read scripts/deploy/engine.mjs directly.

  -Environment preview      the named preview environment "preview" (fictional data only).
  -Environment production   REFUSED unless -AuthorizedProduction is passed AND HEAD is on main,
                             equal to origin/main, with a clean tree, AND the operator types the
                             exact Static Web App name when prompted. Production needs Terry's
                             own, current authorization for the exact commit — never inferred from
                             this script having run before.

  -SubscriptionId / -TenantId / -ResourceGroup / -SwaName are optional: when omitted, they are
  read from the gitignored .local/deploy-target.json (subscriptionId, tenantId, resourceGroup,
  swaName). Missing subscription/tenant configuration fails closed with a clear message; nothing
  is ever inferred from ambient `az` context.

  scripts/deploy/provision.ps1 (one-time infrastructure) and scripts/deploy/configure-settings.ps1
  (application settings) are SEPARATE operator scripts, run rarely and by hand before this one
  exists to deploy against a new environment — they are not alternate ways to deploy code, and
  this script does not call them. scripts/recovery/*.ps1 and *.cjs are a different,
  recovery-operator concern (see docs/RECOVERY_RUNBOOK.md); they never deploy code either.

.EXAMPLE
  .\deploy.ps1 -Environment preview

.EXAMPLE
  .\deploy.ps1 -Environment production -AuthorizedProduction
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [ValidateSet('preview', 'production')] [string] $Environment,
  [string] $SubscriptionId,
  [string] $TenantId,
  [string] $ResourceGroup,
  [string] $SwaName,
  [switch] $AuthorizedProduction
)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot/../..")

$engine = Join-Path $PSScriptRoot 'engine.mjs'
if (-not (Test-Path $engine)) {
  Write-Error "The deployment engine is missing. Expected $engine. Is the repository complete?"
  exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js is not on PATH. The deployment engine runs on Node.'
  exit 1
}

$engineArgs = @($engine, '--environment', $Environment)
if ($SubscriptionId) { $engineArgs += @('--subscription-id', $SubscriptionId) }
if ($TenantId) { $engineArgs += @('--tenant-id', $TenantId) }
if ($ResourceGroup) { $engineArgs += @('--resource-group', $ResourceGroup) }
if ($SwaName) { $engineArgs += @('--swa-name', $SwaName) }
if ($AuthorizedProduction) { $engineArgs += '--authorized-production' }

& node @engineArgs
exit $LASTEXITCODE
