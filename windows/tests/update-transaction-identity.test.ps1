$ErrorActionPreference = 'Stop'
$Utf8NoBom = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

$InstallerPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'installer\install.ps1'
$InstallerSource = Get-Content -LiteralPath $InstallerPath -Raw -Encoding UTF8
$ParseTokens = $null
$ParseErrors = $null
$InstallerAst = [System.Management.Automation.Language.Parser]::ParseInput($InstallerSource, [ref]$ParseTokens, [ref]$ParseErrors)
if ($ParseErrors.Count -gt 0) { throw "Installer parser reported errors: $($ParseErrors[0].Message)" }

$FunctionNames = @(
  'Fail',
  'Normalize-ComparablePath',
  'Assert-NoReparsePath',
  'Assert-UpdateJournalPath',
  'Assert-UpdateLockProcessPhase',
  'Assert-UpdateTransactionOwnerStillMatches',
  'Assert-ExistingUpdateTransactionJournal',
  'Resolve-UpdateTransactionIdentity',
  'Write-UpdateTransactionJournal'
)
$FunctionAsts = $InstallerAst.FindAll({
  param($Node)
  $Node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $FunctionNames -contains $Node.Name
}, $true)
if ($FunctionAsts.Count -ne $FunctionNames.Count) { throw 'Could not find every installer identity function.' }
foreach ($FunctionAst in $FunctionAsts) { Invoke-Expression $FunctionAst.Extent.Text }

if (-not ('AppraisalToolboxInstallerWin32' -as [type])) {
  Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class AppraisalToolboxInstallerWin32 {
    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateDirectoryNative(string path, IntPtr securityAttributes);
    public static void CreateDirectoryExclusive(string path) {
        if (CreateDirectoryNative(path, IntPtr.Zero)) return;
        throw new Win32Exception(Marshal.GetLastWin32Error(), "Exclusive fixture directory creation failed.");
    }
}
"@
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Assert-Equal($Expected, $Actual, [string]$Message) {
  if ($Expected -is [string] -or $Actual -is [string]) {
    if ([string]$Expected -cne [string]$Actual) { throw "$Message (expected=[$Expected], actual=[$Actual])" }
  } elseif ($Expected -ne $Actual) {
    throw "$Message (expected=[$Expected], actual=[$Actual])"
  }
}

function Assert-Fails([scriptblock]$Action, [string]$MessagePart, [string]$Description) {
  try {
    & $Action
  } catch {
    if ($_.Exception.Message -like "*$MessagePart*") { return }
    throw "$Description failed for the wrong reason: $($_.Exception.Message)"
  }
  throw "$Description unexpectedly succeeded."
}

function Get-FileSha256([string]$Path) {
  $Hasher = [Security.Cryptography.SHA256]::Create()
  $Stream = [IO.File]::OpenRead($Path)
  try {
    return ([BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace('-', '')
  } finally {
    $Stream.Dispose()
    $Hasher.Dispose()
  }
}

function Get-DirectoryDigest([string]$Path) {
  $Root = [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
  $Lines = @()
  foreach ($File in @(Get-ChildItem -LiteralPath $Root -File -Recurse -Force | Sort-Object FullName)) {
    $RelativePath = $File.FullName.Substring($Root.Length).TrimStart([char[]]@('\', '/'))
    $Lines += ($RelativePath + '|' + (Get-FileSha256 $File.FullName))
  }
  $Hasher = [Security.Cryptography.SHA256]::Create()
  try {
    return [Convert]::ToBase64String($Hasher.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes(($Lines -join "`n"))))
  } finally { $Hasher.Dispose() }
}

function Get-PathDigest([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '<missing>' }
  $Item = Get-Item -LiteralPath $Path -Force
  if ($Item.PSIsContainer) { return 'directory:' + (Get-DirectoryDigest $Path) }
  return 'file:' + (Get-FileSha256 $Path)
}

function Assert-FailurePreservesFixture([scriptblock]$Action, [string]$MessagePart, $Fixture, [string[]]$AdditionalPaths, [string]$Description) {
  $Paths = @((Join-Path $Fixture.lockPath 'owner.json'), $Fixture.lockStatePath) + @($AdditionalPaths | Where-Object { $_ })
  $BeforeTree = Get-DirectoryDigest $Fixture.installRoot
  $BeforePaths = @{}
  foreach ($Path in $Paths) { $BeforePaths[$Path] = Get-PathDigest $Path }
  Assert-Fails $Action $MessagePart $Description
  Assert-Equal $BeforeTree (Get-DirectoryDigest $Fixture.installRoot) "$Description must preserve the install tree SHA"
  foreach ($Path in $Paths) {
    Assert-Equal $BeforePaths[$Path] (Get-PathDigest $Path) "$Description must preserve evidence SHA for $Path"
  }
}

function Write-JsonFixture([string]$Path, $Value) {
  $Json = ConvertTo-Json -InputObject $Value -Depth 16 -Compress
  [IO.File]::WriteAllText($Path, $Json, [Text.UTF8Encoding]::new($false))
}

function Set-UpdateEnvironment($Fixture, [string]$Mode, [string]$JournalPath) {
  foreach ($Name in @(
    'TB_UPDATE_NONCE', 'TB_UPDATE_INSTALL_ROOT', 'TB_UPDATE_EXTENSION_PATH',
    'TB_UPDATE_JOURNAL_PATH', 'TB_UPDATE_OWNER_PID', 'TB_UPDATE_OWNER_STARTED_AT_UTC',
    'TB_UPDATE_LOCK_PATH', 'TB_UPDATE_LOCK_STATE_PATH'
  )) {
    [Environment]::SetEnvironmentVariable($Name, $null, 'Process')
  }
  [Environment]::SetEnvironmentVariable('TB_UPDATE_NONCE', $Fixture.nonce, 'Process')
  [Environment]::SetEnvironmentVariable('TB_UPDATE_INSTALL_ROOT', $Fixture.installRoot, 'Process')
  [Environment]::SetEnvironmentVariable('TB_UPDATE_EXTENSION_PATH', $Fixture.extensionPath, 'Process')
  if ($Mode -eq 'v2') {
    [Environment]::SetEnvironmentVariable('TB_UPDATE_JOURNAL_PATH', $JournalPath, 'Process')
    [Environment]::SetEnvironmentVariable('TB_UPDATE_OWNER_PID', [string]$Fixture.hostPid, 'Process')
    [Environment]::SetEnvironmentVariable('TB_UPDATE_OWNER_STARTED_AT_UTC', $Fixture.ownerStartedAtUtc, 'Process')
    [Environment]::SetEnvironmentVariable('TB_UPDATE_LOCK_PATH', $Fixture.lockPath, 'Process')
    [Environment]::SetEnvironmentVariable('TB_UPDATE_LOCK_STATE_PATH', $Fixture.lockStatePath, 'Process')
  }
}

function Set-InstallerGlobals($Fixture, [string]$JournalPath, [bool]$ForRecovery = $false) {
  $script:InstallRoot = $Fixture.installRoot
  $script:ExtensionId = 'aamfmhcbjgofhmannejoiilkkpchfkgm'
  $script:ExtensionLoadPath = $Fixture.extensionPath
  $script:TransactionJournalPath = $JournalPath
  $script:UpdateNonce = $Fixture.nonce
  $script:UpdateOwnerPid = [string]$Fixture.hostPid
  $script:UpdateOwnerStartedAtUtc = $Fixture.ownerStartedAtUtc
  $script:UpdateLockPath = $Fixture.lockPath
  $script:UpdateLockStatePath = if ($Fixture.mode -eq 'legacy') { $null } else { $Fixture.lockStatePath }
  $script:UpdateTransactionSchemaVersion = 0
  $script:UpdateTransactionIdentity = $null
  $script:UpdateTransactionJournalCreated = $false
  $script:RecoveryNonce = if ($ForRecovery) { $Fixture.nonce } else { '' }
  $script:RecoveryJournalPath = if ($ForRecovery) { $JournalPath } else { '' }
  $script:RegistrationExecutionContext = [PSCustomObject]@{
    valid = $true
    boundaryType = 'browser-native-messaging-update'
    nativeMessagingBrowserBoundaryAttested = $true
    browserUpdateProof = [PSCustomObject]@{
      installerLaunchRelationVerified = $true
      updateEnvironmentMatchesInstalledRoot = $true
    }
    executableChainValidated = $true
    parentChain = @($Fixture.parentChain)
    observedAtUtc = $Fixture.observedAtUtc
    userSid = 'S-1-5-21-1000-1000-1000-1001'
    sessionId = 1
  }
  $script:StagingRoot = Join-Path $Fixture.root 'install-staging'
  $script:BackupRoot = Join-Path $Fixture.root 'install-backup'
  $script:InstallSnapshotPath = Join-Path $Fixture.root 'install-snapshot.json'
  $script:OriginalExtensionPath = Join-Path $Fixture.root 'original-extension'
  $script:ExtensionStaging = ''
  $script:ExtensionBackup = ''
  $script:ExtensionSnapshotPath = Join-Path $Fixture.root 'extension-snapshot.json'
  $script:RegistrySnapshots = @{}
  $script:RegistryPaths = @()
  $script:RegistryResults = @()
  $script:MovedExistingRoot = $false
  $script:InstalledNewRoot = $false
  $script:ExtensionMoved = $false
  $script:ExtensionReplaced = $false
  $script:ProductVersion = 'fixture-version'
  $script:InstallerBuild = 'fixture-installer'
  $script:BuildMetadata = $null
}

function New-Fixture([string]$ChainKind = 'install', [string]$Protocol = 'legacy', [switch]$PidReused) {
  $Root = Join-Path ([IO.Path]::GetTempPath()) ("appraisal-update-identity-{0}" -f [Guid]::NewGuid().ToString('N'))
  [IO.Directory]::CreateDirectory($Root) | Out-Null
  $InstallRoot = Join-Path $Root 'AppraisalToolbox'
  $ExtensionPath = Join-Path $InstallRoot 'extension'
  $NativeDirectory = Join-Path $InstallRoot 'native-helper'
  [IO.Directory]::CreateDirectory($ExtensionPath) | Out-Null
  [IO.Directory]::CreateDirectory($NativeDirectory) | Out-Null
  $HostPath = Join-Path $NativeDirectory 'native_host.exe'
  [IO.File]::WriteAllBytes($HostPath, [byte[]]@())
  [IO.File]::WriteAllText((Join-Path $NativeDirectory 'runtime-config.json'),
    (ConvertTo-Json -Compress @{ toolboxExtensionId = 'aamfmhcbjgofhmannejoiilkkpchfkgm'; extensionLoadPath = $ExtensionPath }),
    [Text.UTF8Encoding]::new($false))
  $StagingRoot = Join-Path $Root '.AppraisalToolbox-updates'
  [IO.Directory]::CreateDirectory($StagingRoot) | Out-Null
  $LockPath = Join-Path $Root '.AppraisalToolbox-update.lock'
  [IO.Directory]::CreateDirectory($LockPath) | Out-Null

  $Now = [DateTime]::UtcNow
  $HostStarted = if ($PidReused) { $Now.AddSeconds(-1) } else { $Now.AddSeconds(-4) }
  $OwnerStarted = if ($PidReused) { $Now.AddSeconds(-30) } else { $Now.AddSeconds(-2) }
  $HostStartedAtUtc = $HostStarted.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
  $OwnerStartedAtUtc = $OwnerStarted.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
  $ObservedAtUtc = $Now.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
  $Nonce = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
  $HostPid = Get-Random -Minimum 20000 -Maximum 30000
  $CmdPid = Get-Random -Minimum 30000 -Maximum 40000
  $BrowserPid = Get-Random -Minimum 40000 -Maximum 50000
  $ExplorerPid = Get-Random -Minimum 50000 -Maximum 60000
  $HostName = Join-Path $NativeDirectory 'native_host.exe'
  $BrowserName = 'chrome.exe'
  if ($ChainKind -eq 'recovery-wrapper') {
    $ParentChain = @(
      [PSCustomObject]@{ name = 'powershell.exe'; processId = $PID; parentProcessId = $HostPid; executablePath = $PSHOME }
      [PSCustomObject]@{ name = 'native_host.exe'; processId = $HostPid; parentProcessId = $CmdPid; executablePath = $HostName; createdAtUtc = $HostStartedAtUtc; nativeHostOriginArgumentVerified = $true }
      [PSCustomObject]@{ name = 'cmd.exe'; processId = $CmdPid; parentProcessId = $BrowserPid; executablePath = 'C:\Windows\System32\cmd.exe' }
      [PSCustomObject]@{ name = $BrowserName; processId = $BrowserPid; parentProcessId = $ExplorerPid; executablePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe' }
    )
  } elseif ($ChainKind -like 'recovery*') {
    $ParentChain = @(
      [PSCustomObject]@{ name = 'powershell.exe'; processId = $PID; parentProcessId = $HostPid; executablePath = $PSHOME }
      [PSCustomObject]@{ name = 'native_host.exe'; processId = $HostPid; parentProcessId = $BrowserPid; executablePath = $HostName; createdAtUtc = $HostStartedAtUtc; nativeHostOriginArgumentVerified = $true }
      [PSCustomObject]@{ name = $BrowserName; processId = $BrowserPid; parentProcessId = $ExplorerPid; executablePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe' }
    )
  } else {
    $ParentChain = @(
      [PSCustomObject]@{ name = 'powershell.exe'; processId = $PID; parentProcessId = $CmdPid; executablePath = $PSHOME }
      [PSCustomObject]@{ name = 'cmd.exe'; processId = $CmdPid; parentProcessId = $HostPid; executablePath = 'C:\Windows\System32\cmd.exe' }
      [PSCustomObject]@{ name = 'native_host.exe'; processId = $HostPid; parentProcessId = $BrowserPid; executablePath = $HostName; createdAtUtc = $HostStartedAtUtc; nativeHostOriginArgumentVerified = $true }
      [PSCustomObject]@{ name = $BrowserName; processId = $BrowserPid; parentProcessId = $ExplorerPid; executablePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe' }
    )
  }

  $JournalDirectory = Join-Path $StagingRoot ("run-{0}" -f [Guid]::NewGuid().ToString('N'))
  [IO.Directory]::CreateDirectory($JournalDirectory) | Out-Null
  $JournalPath = Join-Path $JournalDirectory 'update-transaction.json'
  $LockStatePath = Join-Path $LockPath 'transaction.json'
  $Owner = if ($Protocol -eq 'legacy') {
    [ordered]@{ nonce = $Nonce; pid = $HostPid; startedAtUtc = $OwnerStartedAtUtc }
  } else {
    [ordered]@{ nonce = $Nonce; pid = $HostPid; schemaVersion = 2; startedAtUtc = $OwnerStartedAtUtc }
  }
  Write-JsonFixture (Join-Path $LockPath 'owner.json') $Owner
  $State = [ordered]@{
    schemaVersion = 2
    ownerPid = $HostPid
    nonce = $Nonce
    ownerStartedAtUtc = $OwnerStartedAtUtc
    installerJournalPath = $JournalPath
    phase = 'installer_start_pending'
    installerStarted = $false
    installerStartPending = $true
    installerProcess = $null
    recoveryStartPending = $false
    recoveryProcess = $null
    recoveryRequired = $true
  }
  if ($Protocol -eq 'v2') { Write-JsonFixture $LockStatePath $State }
  return [PSCustomObject]@{
    root = $Root
    installRoot = $InstallRoot
    extensionPath = $ExtensionPath
    hostPath = $HostPath
    nonce = $Nonce
    hostPid = $HostPid
    ownerStartedAtUtc = $OwnerStartedAtUtc
    hostStartedAtUtc = $HostStartedAtUtc
    observedAtUtc = $ObservedAtUtc
    lockPath = $LockPath
    lockStatePath = $LockStatePath
    stagingRoot = $StagingRoot
    journalPath = $JournalPath
    parentChain = $ParentChain
    mode = $Protocol
  }
}

function Remove-Fixture($Fixture) {
  if ($Fixture -and (Test-Path -LiteralPath $Fixture.root)) {
    $ResolvedRoot = [IO.Path]::GetFullPath([string]$Fixture.root)
    $TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $ResolvedRoot.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove fixture outside the temp directory: $ResolvedRoot"
    }
    Remove-Item -LiteralPath $ResolvedRoot -Recurse -Force
  }
}

function Test-LegacyOwnerOnlyCreatesBoundV3Journal {
  $Fixture = New-Fixture
  try {
    Set-InstallerGlobals $Fixture ''
    Set-UpdateEnvironment $Fixture 'legacy' ''
    $Identity = Resolve-UpdateTransactionIdentity
    Assert-Equal 3 $Identity.schemaVersion 'legacy updater must use journal schema 3'
    Assert-Equal 'legacy-owner-only' $Identity.mode 'legacy identity mode must remain explicit'
    Assert-Equal $Fixture.hostPid $Identity.ownerPid 'legacy owner PID must match the Native Messaging host'
    Assert-True ($Identity.journalPath -like (Join-Path $Fixture.stagingRoot "run-legacy-$($Fixture.hostPid)-$($Fixture.nonce)\update-transaction.json")) 'legacy journal must use its PID and nonce directory'

    Write-UpdateTransactionJournal 'fixture-started'
    $FirstBytes = [IO.File]::ReadAllBytes($Identity.journalPath)
    $Journal = Get-Content -LiteralPath $Identity.journalPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Equal 3 $Journal.schemaVersion 'legacy journal schema must be 3'
    Assert-Equal $Fixture.nonce $Journal.nonce 'legacy journal must bind the nonce'
    Assert-Equal $Fixture.hostPid $Journal.updaterOwnerPid 'legacy journal must bind the owner PID'
    Assert-Equal 'legacy-owner-v1' $Journal.updaterProtocol 'legacy protocol must be explicit'
    Assert-Equal 'legacy-native-messaging-owner-only' $Journal.identitySource 'legacy identity source must be explicit'
    Assert-Equal $false $Journal.externalRecoverySupported 'legacy journal must not claim external recovery support'
    Assert-True ($null -eq $Journal.updateLockStatePath) 'legacy journal must encode the absent v2 state path as JSON null'

    Assert-Fails { Resolve-UpdateTransactionIdentity } 'refusing to reuse its nonce' 'repeated legacy nonce must not reuse its run directory'
    $AfterRejectedReuse = [IO.File]::ReadAllBytes($Identity.journalPath)
    Assert-Equal ([Convert]::ToBase64String($FirstBytes)) ([Convert]::ToBase64String($AfterRejectedReuse)) 'rejected reuse must preserve prior journal bytes'

    Write-UpdateTransactionJournal 'fixture-verified'
    $Journal = Get-Content -LiteralPath $Identity.journalPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Equal 'fixture-verified' $Journal.status 'same owner may advance its own journal'
    Assert-True ($null -eq $Journal.updateLockStatePath) 'journal updates must preserve JSON null for absent v2 state'

    $Journal.updateLockStatePath = ''
    Write-JsonFixture $Identity.journalPath $Journal
    $CorruptBytes = [IO.File]::ReadAllBytes($Identity.journalPath)
    Assert-Fails { Write-UpdateTransactionJournal 'must-not-replace' } 'journal identity changed' 'empty string must not substitute for absent v2 state'
    $AfterCorruptUpdate = [IO.File]::ReadAllBytes($Identity.journalPath)
    Assert-Equal ([Convert]::ToBase64String($CorruptBytes)) ([Convert]::ToBase64String($AfterCorruptUpdate)) 'rejected journal update must preserve existing bytes'
  } finally { Remove-Fixture $Fixture }
}

function Test-ReusedPidWithNewHostLifetimeIsRejected {
  $Fixture = New-Fixture -PidReused
  try {
    Set-InstallerGlobals $Fixture ''
    Set-UpdateEnvironment $Fixture 'legacy' ''
    Assert-Fails { Resolve-UpdateTransactionIdentity } 'does not bind the Native Messaging process lifetime' 'PID reuse with a newer host lifetime must be rejected'
  } finally { Remove-Fixture $Fixture }
}

function Test-V2InstallIdentityUsesOnlyTheVerifiedInstallerPhase {
  $Fixture = New-Fixture -Protocol 'v2'
  try {
    Set-InstallerGlobals $Fixture $Fixture.journalPath
    Set-UpdateEnvironment $Fixture 'v2' $Fixture.journalPath
    $Identity = Resolve-UpdateTransactionIdentity
    Assert-Equal 2 $Identity.schemaVersion 'v2 install must use schema 2'
    Assert-Equal 'v2-lock' $Identity.mode 'v2 install identity mode must be explicit'
    Assert-Equal $Fixture.hostPid $Identity.ownerPid 'v2 install owner must match the Native Messaging host'
    Assert-Equal $Fixture.journalPath $Identity.journalPath 'v2 install must use the exact lock-bound journal path'
  } finally { Remove-Fixture $Fixture }
}

function Test-V2RecoveryChain([string]$ChainKind) {
  $Fixture = New-Fixture -ChainKind $ChainKind -Protocol 'v2'
  try {
    $State = Get-Content -LiteralPath $Fixture.lockStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $State.phase = 'recovery_start_pending'
    $State.installerStarted = $true
    $State.installerStartPending = $false
    $State.recoveryStartPending = $true
    Write-JsonFixture $Fixture.lockStatePath $State
    Set-InstallerGlobals $Fixture $Fixture.journalPath -ForRecovery $true
    Set-UpdateEnvironment $Fixture 'v2' $Fixture.journalPath
    $Identity = Resolve-UpdateTransactionIdentity -ForRecovery
    Assert-Equal 2 $Identity.schemaVersion 'v2 recovery must use schema 2'
    Assert-Equal $Fixture.hostPid $Identity.ownerPid 'v2 recovery owner must match the Native Messaging host'
    Assert-Equal $Fixture.journalPath $Identity.journalPath 'v2 recovery must match the bound journal path'
  } finally { Remove-Fixture $Fixture }
}

function Test-V2ExistingJournalIsNeverOverwritten {
  $Fixture = New-Fixture -Protocol 'v2'
  try {
    $Sentinel = '{"priorEvidence":"keep"}'
    [IO.File]::WriteAllText($Fixture.journalPath, $Sentinel, [Text.UTF8Encoding]::new($false))
    Set-InstallerGlobals $Fixture $Fixture.journalPath
    Set-UpdateEnvironment $Fixture 'v2' $Fixture.journalPath
    Assert-Fails { Resolve-UpdateTransactionIdentity } 'refusing to overwrite prior evidence' 'preexisting v2 journal must be rejected'
    Assert-Equal $Sentinel ([IO.File]::ReadAllText($Fixture.journalPath, [Text.Encoding]::UTF8)) 'rejected v2 journal collision must preserve prior evidence'
  } finally { Remove-Fixture $Fixture }
}

function Test-PartialV2EnvironmentIsRejected {
  $Fixture = New-Fixture -Protocol 'v2'
  try {
    Set-InstallerGlobals $Fixture $Fixture.journalPath
    Set-UpdateEnvironment $Fixture 'v2' $Fixture.journalPath
    [Environment]::SetEnvironmentVariable('TB_UPDATE_LOCK_STATE_PATH', $null, 'Process')
    Assert-FailurePreservesFixture { Resolve-UpdateTransactionIdentity } 'incomplete lock binding fields' $Fixture @() 'partial v2 environment'
  } finally { Remove-Fixture $Fixture }
}

function Test-NonNativeMessagingContextWithNonceIsRejected {
  $Fixture = New-Fixture
  try {
    Set-InstallerGlobals $Fixture ''
    $script:RegistrationExecutionContext.boundaryType = 'ordinary-desktop'
    $script:RegistrationExecutionContext.nativeMessagingBrowserBoundaryAttested = $false
    Set-UpdateEnvironment $Fixture 'legacy' ''
    Assert-FailurePreservesFixture { Resolve-UpdateTransactionIdentity } 'requires an attested Native Messaging browser update context' $Fixture @() 'ordinary shell with updater nonce'
  } finally { Remove-Fixture $Fixture }
}

function Test-LegacyOwnerNonceAndPidMismatchesAreRejected {
  foreach ($Mismatch in @('nonce', 'pid')) {
    $Fixture = New-Fixture
    try {
      $OwnerPath = Join-Path $Fixture.lockPath 'owner.json'
      $Owner = Get-Content -LiteralPath $OwnerPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($Mismatch -eq 'nonce') { $Owner.nonce = [Guid]::NewGuid().ToString('D').ToLowerInvariant() }
      else { $Owner.pid = [int]$Fixture.hostPid + 1 }
      Write-JsonFixture $OwnerPath $Owner
      Set-InstallerGlobals $Fixture ''
      Set-UpdateEnvironment $Fixture 'legacy' ''
      Assert-FailurePreservesFixture { Resolve-UpdateTransactionIdentity } 'owner does not bind the current nonce and Native Messaging host process' $Fixture @() "legacy owner $Mismatch mismatch"
    } finally { Remove-Fixture $Fixture }
  }
}

function Test-V2LockPathEscapeIsRejected {
  $Fixture = New-Fixture -Protocol 'v2'
  try {
    Set-InstallerGlobals $Fixture $Fixture.journalPath
    Set-UpdateEnvironment $Fixture 'v2' $Fixture.journalPath
    [Environment]::SetEnvironmentVariable('TB_UPDATE_LOCK_PATH', (Join-Path $Fixture.root 'outside-lock'), 'Process')
    Assert-FailurePreservesFixture { Resolve-UpdateTransactionIdentity } 'lock environment binding is invalid' $Fixture @() 'v2 lock path escape'
  } finally { Remove-Fixture $Fixture }
}

function Test-V2PhaseAndJournalBindingMismatchesAreRejected {
  foreach ($Mismatch in @('phase', 'journal')) {
    $Fixture = New-Fixture -Protocol 'v2'
    try {
      $State = Get-Content -LiteralPath $Fixture.lockStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($Mismatch -eq 'phase') { $State.phase = 'downloading' }
      else { $State.installerJournalPath = Join-Path $Fixture.stagingRoot 'run-other\update-transaction.json' }
      Write-JsonFixture $Fixture.lockStatePath $State
      Set-InstallerGlobals $Fixture $Fixture.journalPath
      Set-UpdateEnvironment $Fixture 'v2' $Fixture.journalPath
      $MessagePart = if ($Mismatch -eq 'phase') { 'installer phase is not active and verifiable' } else { 'state journal path does not match the current installer request' }
      Assert-FailurePreservesFixture { Resolve-UpdateTransactionIdentity } $MessagePart $Fixture @() "v2 $Mismatch mismatch"
    } finally { Remove-Fixture $Fixture }
  }
}

function Test-LegacyOwnerSchemaAndV2StateAreRejected {
  foreach ($Mismatch in @('schema', 'state')) {
    $Fixture = New-Fixture
    try {
      if ($Mismatch -eq 'schema') {
        $OwnerPath = Join-Path $Fixture.lockPath 'owner.json'
        $Owner = Get-Content -LiteralPath $OwnerPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $Owner | Add-Member -NotePropertyName schemaVersion -NotePropertyValue 2
        Write-JsonFixture $OwnerPath $Owner
      } else {
        Write-JsonFixture $Fixture.lockStatePath ([ordered]@{ schemaVersion = 2; nonce = $Fixture.nonce; phase = 'installer_start_pending' })
      }
      Set-InstallerGlobals $Fixture ''
      Set-UpdateEnvironment $Fixture 'legacy' ''
      $MessagePart = if ($Mismatch -eq 'schema') { 'exact v2 or legacy owner-only protocol' } else { 'Legacy updater lock is not the owner-only protocol' }
      Assert-FailurePreservesFixture { Resolve-UpdateTransactionIdentity } $MessagePart $Fixture @() "legacy owner $Mismatch marker"
    } finally { Remove-Fixture $Fixture }
  }
}

function Test-PreexistingLegacyRunFileOrDirectoryIsRejected {
  foreach ($ExistingKind in @('file', 'directory')) {
    $Fixture = New-Fixture
    try {
      $RunPath = Join-Path $Fixture.stagingRoot "run-legacy-$($Fixture.hostPid)-$($Fixture.nonce)"
      if ($ExistingKind -eq 'file') {
        [IO.File]::WriteAllText($RunPath, 'preexisting legacy evidence', [Text.UTF8Encoding]::new($false))
      } else {
        [IO.Directory]::CreateDirectory($RunPath) | Out-Null
        [IO.File]::WriteAllText((Join-Path $RunPath 'prior.json'), '{"preserve":true}', [Text.UTF8Encoding]::new($false))
      }
      Set-InstallerGlobals $Fixture ''
      Set-UpdateEnvironment $Fixture 'legacy' ''
      Assert-FailurePreservesFixture { Resolve-UpdateTransactionIdentity } 'Legacy update run directory already exists; refusing to reuse its nonce' $Fixture @($RunPath) "legacy run path collision with $ExistingKind"
    } finally { Remove-Fixture $Fixture }
  }
}

function Test-ReparseJournalDirectoryIsRejected {
  $Fixture = New-Fixture -Protocol 'v2'
  $LinkPath = Join-Path $Fixture.stagingRoot 'run-reparse'
  $TargetPath = Join-Path $Fixture.root 'junction-target'
  try {
    [IO.Directory]::CreateDirectory($TargetPath) | Out-Null
    [IO.File]::WriteAllText((Join-Path $TargetPath 'prior.json'), '{"preserve":true}', [Text.UTF8Encoding]::new($false))
    New-Item -ItemType Junction -Path $LinkPath -Target $TargetPath -ErrorAction Stop | Out-Null
    $JournalPath = Join-Path $LinkPath 'update-transaction.json'
    $State = Get-Content -LiteralPath $Fixture.lockStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $State.installerJournalPath = $JournalPath
    Write-JsonFixture $Fixture.lockStatePath $State
    Set-InstallerGlobals $Fixture $JournalPath
    Set-UpdateEnvironment $Fixture 'v2' $JournalPath
    Assert-FailurePreservesFixture { Resolve-UpdateTransactionIdentity } 'contains a reparse point' $Fixture @($TargetPath) 'junction journal path'
    Assert-True (Test-Path -LiteralPath (Join-Path $TargetPath 'prior.json')) 'rejecting a junction must not alter its target'
  } finally {
    if (Test-Path -LiteralPath $LinkPath) { [IO.Directory]::Delete($LinkPath) }
    Remove-Fixture $Fixture
  }
}

try {
  Test-LegacyOwnerOnlyCreatesBoundV3Journal
  Test-ReusedPidWithNewHostLifetimeIsRejected
  Test-V2InstallIdentityUsesOnlyTheVerifiedInstallerPhase
  Test-V2RecoveryChain 'recovery-direct'
  Test-V2RecoveryChain 'recovery-wrapper'
  Test-V2ExistingJournalIsNeverOverwritten
  Test-PartialV2EnvironmentIsRejected
  Test-NonNativeMessagingContextWithNonceIsRejected
  Test-LegacyOwnerNonceAndPidMismatchesAreRejected
  Test-V2LockPathEscapeIsRejected
  Test-V2PhaseAndJournalBindingMismatchesAreRejected
  Test-LegacyOwnerSchemaAndV2StateAreRejected
  Test-PreexistingLegacyRunFileOrDirectoryIsRejected
  Test-ReparseJournalDirectoryIsRejected
  [PSCustomObject]@{
    ok = $true
    fixtureOnly = $true
    coverage = @(
      'legacy .11 owner-only protocol to schema 3 journal',
      'legacy journal has explicit no-external-recovery and null v2 state path',
      'same nonce cannot reuse a run directory or overwrite prior evidence',
      'PID reuse is rejected when the current Native Messaging host lifetime starts later',
      'v2 installer phase identity and exact journal binding',
      'v2 recovery-start-pending direct and cmd-wrapper parent chains',
      'preexisting v2 journal is preserved',
      'partial v2 environment and ordinary-shell nonce are rejected',
      'legacy owner nonce/PID mismatch is rejected',
      'v2 lock path escape and phase/journal mismatch are rejected',
      'legacy owner schema/state markers and preexisting run file/directory are rejected',
      'junction journal path is rejected without modifying its target'
    )
    realDesktopCovered = $false
  } | ConvertTo-Json -Depth 8 -Compress
} finally {
  foreach ($Name in @(
    'TB_UPDATE_NONCE', 'TB_UPDATE_INSTALL_ROOT', 'TB_UPDATE_EXTENSION_PATH',
    'TB_UPDATE_JOURNAL_PATH', 'TB_UPDATE_OWNER_PID', 'TB_UPDATE_OWNER_STARTED_AT_UTC',
    'TB_UPDATE_LOCK_PATH', 'TB_UPDATE_LOCK_STATE_PATH'
  )) { [Environment]::SetEnvironmentVariable($Name, $null, 'Process') }
}
