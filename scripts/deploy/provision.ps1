<#
.SYNOPSIS
  Provisions BudgetTracker's own Azure resources. Idempotent; never deletes or modifies anything
  it did not create, and never touches other applications' resources.

.DESCRIPTION
  Target selection is EXPLICIT: subscription and tenant are mandatory and have no defaults, and the
  tenant is verified before any write. Nothing is inferred from ambient `az` context.

  Shared (per application):   resource group, Static Web App (Standard), Log Analytics workspace,
                              Application Insights (workspace-based).
  Per environment:            a private DATA storage account and a SEPARATE BACKUP storage account
                              (separate keys), StorageV2 / Standard_LRS / TLS 1.2 / HTTPS only / no
                              public blob access / no cross-tenant replication, with blob versioning,
                              blob soft delete and container soft delete.

  -Environment preview       SWA named preview environment "preview" (fictional data only).
  -Environment production    refused unless -AuthorizedProduction is passed AND the operator types
                             the resource group name. Production requires Terry's explicit approval.

  Immutable (WORM) retention is NOT applied here: a locked policy is irreversible and needs its own
  decision. See docs/DEPLOYMENT.md.

.EXAMPLE
  ./scripts/deploy/provision.ps1 -SubscriptionId <id> -TenantId <id> -Environment preview
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [ValidatePattern('^[0-9a-f-]{36}$')] [string] $SubscriptionId,
  [Parameter(Mandatory)] [ValidatePattern('^[0-9a-f-]{36}$')] [string] $TenantId,
  [Parameter(Mandatory)] [ValidateSet('preview', 'production')] [string] $Environment,
  [string] $ResourceGroup = 'budget-tracker',
  [string] $Location = 'eastus2',
  [string] $SwaName = 'budget-tracker',
  [switch] $AuthorizedProduction
)
$ErrorActionPreference = 'Stop'
$abbrev = @{ preview = 'pv'; production = 'prd' }[$Environment]
$dataAccount = "stbudget$($abbrev)01"
$backupAccount = "stbudgetbk$($abbrev)01"
$tags = @('app=budgettracker', 'managedBy=scripts/deploy/provision.ps1')

function Invoke-Az { param([string[]] $Arguments) $out = & az @Arguments --subscription $SubscriptionId --only-show-errors; if ($LASTEXITCODE -ne 0) { throw "az $($Arguments[0..2] -join ' ') failed" }; return $out }

$actualTenant = az account show --subscription $SubscriptionId --query tenantId -o tsv --only-show-errors
if ($actualTenant -ne $TenantId) { throw "Subscription is not in the selected tenant. Stopping before any change." }
if ($Environment -eq 'production') {
  if (-not $AuthorizedProduction) { throw 'Production provisioning requires -AuthorizedProduction after Terry''s explicit approval.' }
  $typed = Read-Host "Type the resource group name ($ResourceGroup) to provision PRODUCTION storage"
  if ($typed -ne $ResourceGroup) { throw 'Confirmation did not match. Nothing was changed.' }
}

Write-Host "Target: subscription verified in tenant; RG=$ResourceGroup; location=$Location; environment=$Environment"

# Resource providers must be registered before their resources can be created. Registration is
# idempotent and subscription-scoped; it creates no resources.
foreach ($ns in 'Microsoft.Web', 'Microsoft.Storage', 'Microsoft.OperationalInsights', 'Microsoft.Insights') {
  $state = Invoke-Az @('provider', 'show', '--namespace', $ns, '--query', 'registrationState', '-o', 'tsv')
  if ($state -ne 'Registered') { Invoke-Az @('provider', 'register', '--namespace', $ns, '--wait') | Out-Null; Write-Host "registered provider $ns" }
}

if ((Invoke-Az @('group', 'exists', '-n', $ResourceGroup)) -ne 'true') {
  Invoke-Az (@('group', 'create', '-n', $ResourceGroup, '-l', $Location, '--tags') + $tags) | Out-Null
  Write-Host "created resource group $ResourceGroup"
} else { Write-Host "reusing resource group $ResourceGroup" }

$swa = Invoke-Az @('staticwebapp', 'list', '-g', $ResourceGroup, '--query', "[?name=='$SwaName'].{sku:sku.name}", '-o', 'json') | ConvertFrom-Json
if (-not $swa) {
  Invoke-Az (@('staticwebapp', 'create', '-n', $SwaName, '-g', $ResourceGroup, '-l', $Location, '--sku', 'Standard', '--tags') + $tags) | Out-Null
  Write-Host "created Static Web App $SwaName (Standard)"
} elseif ($swa[0].sku -ne 'Standard') { throw "Static Web App $SwaName exists on plan $($swa[0].sku); Standard is required (custom Google provider, rolesSource). Not changing it." }
else { Write-Host "reusing Static Web App $SwaName" }

$law = "log-$SwaName"
$lawId = Invoke-Az @('resource', 'list', '-g', $ResourceGroup, '--resource-type', 'Microsoft.OperationalInsights/workspaces', '--query', "[?name=='$law'].id | [0]", '-o', 'tsv')
if (-not $lawId) {
  $lawFile = New-TemporaryFile
  Set-Content -Path $lawFile -Value '{"sku":{"name":"PerGB2018"},"retentionInDays":30}' -NoNewline
  $lawId = Invoke-Az (@('resource', 'create', '-g', $ResourceGroup, '-n', $law, '--resource-type', 'Microsoft.OperationalInsights/workspaces', '-l', $Location,
      '--properties', "@$lawFile", '--query', 'id', '-o', 'tsv', '--tags') + $tags)
  Remove-Item $lawFile
  Write-Host "created Log Analytics workspace $law (30-day retention)"
} else { Write-Host "reusing Log Analytics workspace $law" }

$appi = "appi-$SwaName"
$appiId = Invoke-Az @('resource', 'list', '-g', $ResourceGroup, '--resource-type', 'Microsoft.Insights/components', '--query', "[?name=='$appi'].id | [0]", '-o', 'tsv')
if (-not $appiId) {
  # `az resource create` has no --kind; the kind is part of a full resource object.
  $full = @{ location = $Location; kind = 'web'; properties = @{ Application_Type = 'web'; WorkspaceResourceId = $lawId; IngestionMode = 'LogAnalytics' } } | ConvertTo-Json -Compress -Depth 5
  $propsFile = New-TemporaryFile
  Set-Content -Path $propsFile -Value $full -NoNewline
  Invoke-Az (@('resource', 'create', '-g', $ResourceGroup, '-n', $appi, '--resource-type', 'Microsoft.Insights/components', '--is-full-object',
      '--properties', "@$propsFile") ) | Out-Null
  Remove-Item $propsFile
  Write-Host "created Application Insights $appi (workspace-based)"
} else { Write-Host "reusing Application Insights $appi" }

function Initialize-Storage([string] $Name, [int] $RetentionDays, [string] $Purpose) {
  $existing = Invoke-Az @('storage', 'account', 'list', '-g', $ResourceGroup, '--query', "[?name=='$Name'].name | [0]", '-o', 'tsv')
  if (-not $existing) {
    Invoke-Az (@('storage', 'account', 'create', '-n', $Name, '-g', $ResourceGroup, '-l', $Location, '--sku', 'Standard_LRS', '--kind', 'StorageV2',
        '--min-tls-version', 'TLS1_2', '--allow-blob-public-access', 'false', '--https-only', 'true', '--allow-cross-tenant-replication', 'false',
        '--tags') + $tags + @("env=$Environment", "purpose=$Purpose")) | Out-Null
    Write-Host "created storage account $Name ($Purpose)"
  } else { Write-Host "reusing storage account $Name ($Purpose)" }
  Invoke-Az @('storage', 'account', 'blob-service-properties', 'update', '-n', $Name, '-g', $ResourceGroup, '--enable-versioning', 'true',
      '--enable-delete-retention', 'true', '--delete-retention-days', "$RetentionDays",
      '--enable-container-delete-retention', 'true', '--container-delete-retention-days', "$RetentionDays") | Out-Null
  $check = Invoke-Az @('storage', 'account', 'show', '-n', $Name, '-g', $ResourceGroup, '--query', '{tls:minimumTlsVersion, publicBlob:allowBlobPublicAccess, https:enableHttpsTrafficOnly}', '-o', 'json') | ConvertFrom-Json
  if ($check.tls -ne 'TLS1_2' -or $check.publicBlob -ne $false -or $check.https -ne $true) { throw "Storage account $Name does not meet the required security settings." }
}

Initialize-Storage -Name $dataAccount -RetentionDays 14 -Purpose 'data'
Initialize-Storage -Name $backupAccount -RetentionDays 35 -Purpose 'backup'

Write-Host "done. Next: deploy to the '$Environment' environment, then run scripts/deploy/configure-settings.ps1."
