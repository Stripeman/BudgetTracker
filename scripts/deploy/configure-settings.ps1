<#
.SYNOPSIS
  Configures application settings for ONE environment of BudgetTracker's Static Web App.

.DESCRIPTION
  Secrets (storage connection strings, Application Insights connection string, backup keys) are
  read from Azure and piped straight into the settings; they are never printed, logged or written
  to disk. Existing backup keys are NEVER overwritten (that would make existing archives
  unreadable); rotation is a separate, deliberate step (docs/RECOVERY_RUNBOOK.md).

  Google sign-in settings (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are set by Terry himself.

  Production is refused unless -AuthorizedProduction is passed.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [ValidatePattern('^[0-9a-f-]{36}$')] [string] $SubscriptionId,
  [Parameter(Mandatory)] [ValidatePattern('^[0-9a-f-]{36}$')] [string] $TenantId,
  [Parameter(Mandatory)] [ValidateSet('preview', 'production')] [string] $Environment,
  [Parameter(Mandatory)] [string] $SiteAdmins,
  [string] $ResourceGroup = 'budget-tracker',
  [string] $SwaName = 'budget-tracker',
  [switch] $AuthorizedProduction
)
$ErrorActionPreference = 'Stop'
$tenant = az account show --subscription $SubscriptionId --query tenantId -o tsv --only-show-errors
if ($tenant -ne $TenantId) { throw 'Subscription is not in the selected tenant. Nothing was changed.' }
if ($Environment -eq 'production' -and -not $AuthorizedProduction) { throw 'Production settings require Terry''s explicit authorization.' }

$abbrev = @{ preview = 'pv'; production = 'prd' }[$Environment]
$dataAccount = "stbudget$($abbrev)01"
$backupAccount = "stbudgetbk$($abbrev)01"
$envArgs = if ($Environment -eq 'production') { @() } else { @('--environment-name', 'preview') }
$common = @('-n', $SwaName, '-g', $ResourceGroup, '--subscription', $SubscriptionId, '--only-show-errors')

$existing = az staticwebapp appsettings list @common @envArgs --query 'properties' -o json | ConvertFrom-Json
$names = if ($existing) { $existing.PSObject.Properties.Name } else { @() }

$settings = [ordered]@{
  BT_ENVIRONMENT = $Environment
  BT_STORAGE = 'blob'
  BT_DATA_CONTAINER = 'data'
  BT_BACKUP_STORAGE = 'blob'
  BT_BACKUP_CONTAINER = 'backups'
  BT_SITE_ADMINS = $SiteAdmins
  BT_STORAGE_CONNECTION_STRING = (az storage account show-connection-string -n $dataAccount -g $ResourceGroup --subscription $SubscriptionId --query connectionString -o tsv --only-show-errors)
  BT_BACKUP_CONNECTION_STRING = (az storage account show-connection-string -n $backupAccount -g $ResourceGroup --subscription $SubscriptionId --query connectionString -o tsv --only-show-errors)
  APPLICATIONINSIGHTS_CONNECTION_STRING = (az resource show -g $ResourceGroup -n "appi-$SwaName" --resource-type Microsoft.Insights/components --subscription $SubscriptionId --query properties.ConnectionString -o tsv --only-show-errors)
}
if ($names -notcontains 'BT_BACKUP_KEYS') {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $settings['BT_BACKUP_KEYS'] = "$($abbrev)1:$([Convert]::ToBase64String($bytes))"
  $settings['BT_BACKUP_ACTIVE_KEY'] = "$($abbrev)1"
  Write-Host 'generated a new backup master key (never printed). For production, keep an offline escrow copy.'
} else { Write-Host 'backup keys already present; not changed' }

foreach ($k in $settings.Keys) { if (-not $settings[$k]) { throw "Could not resolve a value for $k. Nothing was changed." } }
$pairs = foreach ($k in $settings.Keys) { "$k=$($settings[$k])" }
az staticwebapp appsettings set @common @envArgs --setting-names @pairs | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Setting application settings failed.' }
$after = (az staticwebapp appsettings list @common @envArgs --query 'properties' -o json | ConvertFrom-Json).PSObject.Properties.Name | Sort-Object
Write-Host "settings present for ${Environment}: $($after -join ', ')"
if ($after -notcontains 'GOOGLE_CLIENT_ID') { Write-Host 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set yet: Terry sets them (docs/DEPLOYMENT.md). Sign-in fails closed until then.' }
