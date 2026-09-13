<#
.SYNOPSIS
  Copies ONE environment's backup master keys from its Static Web App settings into an escrow
  file under the ignored .local/escrow/ folder, without printing them.

.DESCRIPTION
  BT_BACKUP_KEYS and BT_BACKUP_ACTIVE_KEY exist only in the app's settings. Losing the app (or a
  mistaken settings change) would make every archive unreadable, so production keeps an offline
  escrow copy under Terry's control (docs/RECOVERY_RUNBOOK.md, "Backup-key escrow").

  The script prints only key ids and a SHA-256 fingerprint of the escrowed text, never a key. It
  refuses to overwrite an existing escrow file. Prove the copy with a drill on a real archive
  (runbook), then move the file to offline storage.

  Production is refused unless -AuthorizedProduction is passed.
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
$tenant = az account show --subscription $SubscriptionId --query tenantId -o tsv --only-show-errors
if ($tenant -ne $TenantId) { throw 'Subscription is not in the selected tenant. Nothing was written.' }
if ($Environment -eq 'production' -and -not $AuthorizedProduction) { throw 'Production escrow requires Terry''s explicit authorization (-AuthorizedProduction).' }

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dir = Join-Path $root '.local/escrow'
$file = Join-Path $dir "$Environment-backup-keys-$(Get-Date -Format 'yyyyMMdd-HHmmss').env"
if (Test-Path $file) { throw "Escrow file already exists: $file. Nothing was written." }

$envArgs = if ($Environment -eq 'production') { @() } else { @('--environment-name', 'preview') }
$common = @('-n', $SwaName, '-g', $ResourceGroup, '--subscription', $SubscriptionId, '--only-show-errors')
$props = (az staticwebapp appsettings list @common @envArgs --query 'properties' -o json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or -not $props) { throw 'Could not read application settings. Nothing was written.' }
$keys = $props.BT_BACKUP_KEYS
$active = $props.BT_BACKUP_ACTIVE_KEY
if (-not $keys -or -not $active) { throw "BT_BACKUP_KEYS / BT_BACKUP_ACTIVE_KEY are not set for $Environment. Nothing was written." }

$ids = @($keys -split ',' | ForEach-Object { ($_ -split ':', 2)[0].Trim() })
foreach ($entry in ($keys -split ',')) {
  $parts = $entry.Trim() -split ':', 2
  if ($parts.Count -ne 2 -or [Convert]::FromBase64String($parts[1]).Length -ne 32) { throw 'A backup key entry is malformed (expected id:base64 of 32 bytes). Nothing was written.' }
}
if ($ids -notcontains $active) { throw "The active key id is not in BT_BACKUP_KEYS. Nothing was written." }

$text = "BT_BACKUP_KEYS=$keys`nBT_BACKUP_ACTIVE_KEY=$active`n"
New-Item -ItemType Directory -Force $dir | Out-Null
[System.IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding $false))
$hash = [System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes($text))
$fingerprint = ([System.BitConverter]::ToString($hash) -replace '-', '').ToLower().Substring(0, 16)

Write-Host "escrowed $Environment backup keys (ids: $($ids -join ', '); active: $active; fingerprint $fingerprint)"
Write-Host "file: $file"
Write-Host 'Next: prove it with a drill on a real archive (docs/RECOVERY_RUNBOOK.md), then move the file to offline storage.'
