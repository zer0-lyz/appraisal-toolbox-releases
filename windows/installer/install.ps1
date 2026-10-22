param(
  [string]$InstallRoot = "",
  [string]$RegistryTestRoot = "",
  [string]$OriginalExtensionPath = "",
  [switch]$RecoverUpdateTransaction,
  [string]$RecoveryJournalPath = "",
  [string]$RecoveryNonce = ""
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$TestMode = $env:APPRAISAL_TOOLBOX_INSTALLER_TEST_MODE -eq "1"
if ($RegistryTestRoot -and -not $TestMode) {
  throw "RegistryTestRoot is only available when APPRAISAL_TOOLBOX_INSTALLER_TEST_MODE=1."
}
if ($TestMode) {
  if (-not $InstallRoot -and $env:APPRAISAL_TOOLBOX_INSTALL_ROOT) {
    $InstallRoot = $env:APPRAISAL_TOOLBOX_INSTALL_ROOT
  }
  if (-not $RegistryTestRoot -and $env:APPRAISAL_TOOLBOX_INSTALLER_TEST_REGISTRY_ROOT) {
    $RegistryTestRoot = $env:APPRAISAL_TOOLBOX_INSTALLER_TEST_REGISTRY_ROOT
  }
}
if (-not $InstallRoot -and $env:TB_UPDATE_INSTALL_ROOT) { $InstallRoot = $env:TB_UPDATE_INSTALL_ROOT }
if (-not $InstallRoot) {
  $InstallRoot = Join-Path $env:LOCALAPPDATA "AppraisalToolbox"
}
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$UniqueSuffix = "$PID-$([Guid]::NewGuid().ToString('N'))"
$StagingRoot = "$InstallRoot.staging-$UniqueSuffix"
$BackupRoot = "$InstallRoot.previous-$UniqueSuffix"
$InstallSnapshotPath = Join-Path $env:TEMP "AppraisalToolbox-install-snapshot-$UniqueSuffix.json"
$HostName = "com.appraisal.toolbox.helper"
$ExtensionId = "aamfmhcbjgofhmannejoiilkkpchfkgm"
$ProductVersion = ""
$InstallerBuild = "windows-context-attested.8"
$BuildMetadata = $null
$ExtensionLoadPath = Join-Path $InstallRoot "extension"
$ExtensionMoved = $false
$ExtensionReplaced = $false
$ExtensionStaging = ""
$ExtensionBackup = ""
$ExtensionSnapshotPath = Join-Path $env:TEMP "AppraisalToolbox-extension-snapshot-$UniqueSuffix.json"
$UpdateNonce = [string]$env:TB_UPDATE_NONCE
if ($UpdateNonce -and $UpdateNonce -notmatch "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$") { throw "Invalid update nonce." }
$TransactionJournalPath = [string]$env:TB_UPDATE_JOURNAL_PATH
$UpdateOwnerPid = [string]$env:TB_UPDATE_OWNER_PID
$UpdateOwnerStartedAtUtc = [string]$env:TB_UPDATE_OWNER_STARTED_AT_UTC
$UpdateLockPath = [string]$env:TB_UPDATE_LOCK_PATH
$UpdateLockStatePath = [string]$env:TB_UPDATE_LOCK_STATE_PATH
$UpdateTransactionSchemaVersion = 0
$UpdateTransactionIdentity = $null
$UpdateTransactionJournalCreated = $false
$VersionFile = Join-Path $PackageRoot "VERSION.txt"
if (Test-Path -LiteralPath $VersionFile -PathType Leaf) {
  foreach ($Line in Get-Content -LiteralPath $VersionFile -Encoding UTF8) {
    if ($Line -match '^version=(.+)$') { $ProductVersion = $Matches[1].Trim(); break }
  }
}
$ProvenanceFile = Join-Path $PackageRoot "BUILD-PROVENANCE.json"
if (Test-Path -LiteralPath $ProvenanceFile -PathType Leaf) {
  try {
    $BuildMetadata = Get-Content -LiteralPath $ProvenanceFile -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    if ($BuildMetadata.installerBuild) { $InstallerBuild = [string]$BuildMetadata.installerBuild }
    if (-not $ProductVersion -and $BuildMetadata.productVersion) { $ProductVersion = [string]$BuildMetadata.productVersion }
  } catch {
    throw "BUILD-PROVENANCE.json is invalid."
  }
}
if (-not $ProductVersion) { $ProductVersion = "unknown" }
$MovedExistingRoot = $false
$InstalledNewRoot = $false
$RegistryPaths = if ($RegistryTestRoot) {
  if ($RegistryTestRoot -notlike "HKCU:\Software\AppraisalToolbox\InstallerFixture\*") {
    throw "RegistryTestRoot must be beneath HKCU:\Software\AppraisalToolbox\InstallerFixture."
  }
  @("$RegistryTestRoot\Chrome", "$RegistryTestRoot\Edge")
} else {
  @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
  )
}
$RegistrySnapshots = @{}
$RegistryTouched = @{}
$RegistryResults = @()

if (-not ("AppraisalToolboxInstallerWin32" -as [type])) {
  Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class AppraisalToolboxInstallerWin32 {
    private const int ERROR_SUCCESS = 0;
    private const int ERROR_INSUFFICIENT_BUFFER = 122;
    private const int APPMODEL_ERROR_NO_PACKAGE = 15700;
    private const uint TOKEN_QUERY = 0x0008;
    private const int TokenIsAppContainer = 29;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetCurrentPackageFullName(ref uint packageFullNameLength, StringBuilder packageFullName);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetCurrentPackageFamilyName(ref uint packageFamilyNameLength, StringBuilder packageFamilyName);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr tokenHandle, int tokenInformationClass, out int tokenInformation, int tokenInformationLength, out int returnLength);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateDirectoryNative(string path, IntPtr securityAttributes);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHGetKnownFolderPath(ref Guid folderId, uint flags, IntPtr token, out IntPtr path);

    public static void CreateDirectoryExclusive(string path) {
        if (CreateDirectoryNative(path, IntPtr.Zero)) return;
        throw new Win32Exception(Marshal.GetLastWin32Error(), "Exclusive directory creation failed.");
    }

    public static string GetCurrentPackageFullNameValue() {
        uint length = 0;
        int result = GetCurrentPackageFullName(ref length, null);
        if (result == APPMODEL_ERROR_NO_PACKAGE) return "";
        if (result != ERROR_INSUFFICIENT_BUFFER && result != ERROR_SUCCESS) throw new Win32Exception(result);
        var value = new StringBuilder((int)Math.Max(length, 1));
        result = GetCurrentPackageFullName(ref length, value);
        if (result == APPMODEL_ERROR_NO_PACKAGE) return "";
        if (result != ERROR_SUCCESS) throw new Win32Exception(result);
        return value.ToString();
    }

    public static string GetCurrentPackageFamilyNameValue() {
        uint length = 0;
        int result = GetCurrentPackageFamilyName(ref length, null);
        if (result == APPMODEL_ERROR_NO_PACKAGE) return "";
        if (result != ERROR_INSUFFICIENT_BUFFER && result != ERROR_SUCCESS) throw new Win32Exception(result);
        var value = new StringBuilder((int)Math.Max(length, 1));
        result = GetCurrentPackageFamilyName(ref length, value);
        if (result == APPMODEL_ERROR_NO_PACKAGE) return "";
        if (result != ERROR_SUCCESS) throw new Win32Exception(result);
        return value.ToString();
    }

    public static bool IsCurrentTokenAppContainer() {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, out token)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            int value;
            int returned;
            if (!GetTokenInformation(token, TokenIsAppContainer, out value, sizeof(int), out returned)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return value != 0;
        } finally {
            CloseHandle(token);
        }
    }

    public static string GetWin32LocalAppData() {
        var folderId = new Guid("F1B32785-6FBA-4FCF-9D55-7B8E7F157091");
        IntPtr value;
        int result = SHGetKnownFolderPath(ref folderId, 0, IntPtr.Zero, out value);
        if (result != ERROR_SUCCESS) Marshal.ThrowExceptionForHR(result);
        try { return Marshal.PtrToStringUni(value) ?? ""; }
        finally { Marshal.FreeCoTaskMem(value); }
    }
}
"@
}

function Fail([string]$Message) {
  throw $Message
}

function Normalize-ComparablePath([string]$Path) {
  return [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
}

function Save-RegistrySnapshots {
  foreach ($RegistryPath in $RegistryPaths) {
    if (Test-Path -LiteralPath $RegistryPath) {
      $RegistryKey = Get-Item -LiteralPath $RegistryPath
      $DefaultValueExists = $RegistryKey.GetValueNames() -contains ""
      $RegistrySnapshots[$RegistryPath] = @{
        Exists = $true
        DefaultValueExists = $DefaultValueExists
        Value = if ($DefaultValueExists) {
          $RegistryKey.GetValue("", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        } else { $null }
        Kind = if ($DefaultValueExists) { [string]$RegistryKey.GetValueKind("") } else { $null }
      }
    } else {
      $RegistrySnapshots[$RegistryPath] = @{
        Exists = $false
        DefaultValueExists = $false
        Value = $null
        Kind = $null
      }
    }
  }
}

function Assert-OrdinaryUserContext {
  $PackageFullName = [AppraisalToolboxInstallerWin32]::GetCurrentPackageFullNameValue()
  $PackageFamilyName = [AppraisalToolboxInstallerWin32]::GetCurrentPackageFamilyNameValue()
  $IsAppContainer = [AppraisalToolboxInstallerWin32]::IsCurrentTokenAppContainer()
  if ($IsAppContainer -or $PackageFullName -or $PackageFamilyName -or $env:APPX_PACKAGE_FAMILY_NAME) {
    Fail "Unsupported AppContainer/MSIX context detected. Extract the package and run install.cmd from ordinary Windows PowerShell or Command Prompt."
  }
  if (-not $env:LOCALAPPDATA) {
    Fail "LOCALAPPDATA is unavailable. Run install.cmd from an ordinary signed-in Windows user session."
  }
  $Win32LocalAppData = [AppraisalToolboxInstallerWin32]::GetWin32LocalAppData()
  if ((-not $Win32LocalAppData) -or
      ((Normalize-ComparablePath $env:LOCALAPPDATA) -ine (Normalize-ComparablePath $Win32LocalAppData)) -or
      ($Win32LocalAppData -match '\\Packages\\[^\\]+\\(?:LocalCache|LocalState|TempState)\\Local(?:\\|$)')) {
    Fail "LOCALAPPDATA redirection detected. Run install.cmd from ordinary Windows PowerShell or Command Prompt outside the packaged sandbox."
  }
  return [ordered]@{
    appContainer = $IsAppContainer
    packageFullName = $PackageFullName
    packageFamilyName = $PackageFamilyName
    processLocalAppData = $env:LOCALAPPDATA
    win32LocalAppData = $Win32LocalAppData
  }
}

function Read-ExternalRegistryState([string]$RegistryPath) {
  $ProbeScript = Join-Path $PackageRoot "verify-registration.ps1"
  if (-not (Test-Path -LiteralPath $ProbeScript -PathType Leaf)) {
    Fail "Missing independent registration verifier: verify-registration.ps1"
  }
  $PowerShellExe = Join-Path $PSHOME "powershell.exe"
  $ProbeOutput = & $PowerShellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $ProbeScript -RegistryPath $RegistryPath 2>&1
  $ProbeExitCode = $LASTEXITCODE
  $ProbeText = (@($ProbeOutput) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  if ($ProbeExitCode -ne 0) {
    Fail "Independent registry read-back process failed for $RegistryPath (exit $ProbeExitCode): $ProbeText"
  }
  try {
    $Result = $ProbeText | ConvertFrom-Json -ErrorAction Stop
  } catch {
    Fail "Independent registry read-back returned invalid data for $RegistryPath."
  }
  Assert-IndependentProcessContext $Result
  return $Result
}

function Verify-ExternalRegistration([string]$RegistryPath, [string]$ManifestPath, [string]$NativeHostExe) {
  $ProbeScript = Join-Path $PackageRoot "verify-registration.ps1"
  $PowerShellExe = Join-Path $PSHOME "powershell.exe"
  $ProbeId = [Guid]::NewGuid().ToString('N')
  $ProbeOutput = & $PowerShellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $ProbeScript -RegistryPath $RegistryPath -ProbeId $ProbeId -ExpectedManifestPath $ManifestPath `
    -ExpectedExePath $NativeHostExe -ExpectedHostName $HostName -ExpectedExtensionId $ExtensionId `
    -VerifyRegistration 2>&1
  $ProbeExitCode = $LASTEXITCODE
  $ProbeText = (@($ProbeOutput) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  if ($ProbeExitCode -ne 0) {
    Fail "Independent registration verification failed for $RegistryPath (exit $ProbeExitCode): $ProbeText"
  }
  try {
    $Result = $ProbeText | ConvertFrom-Json -ErrorAction Stop
  } catch {
    Fail "Independent registration verifier returned invalid data for $RegistryPath."
  }
  Assert-IndependentProcessContext $Result
  if ([string]$Result.registryPath -cne $RegistryPath -or [string]$Result.probeId -cne $ProbeId -or
      [int]$Result.processId -eq $PID -or -not $Result.process64Bit -or @($Result.registryViews).Count -ne 2) {
    Fail "Independent verifier did not attest the requested key, nonce, child PID and two explicit registry views: $RegistryPath"
  }
  if (-not $Result.ok -or -not $Result.manifestExists -or -not $Result.executableExists -or -not $Result.manifestValid) {
    Fail "Independent registration verification reported incomplete files for $RegistryPath."
  }
  return $Result
}

function Assert-IndependentProcessContext($Result) {
  Assert-RegistrationContext $Result.executionContext
  if ($Result.executionContext.userSid -cne $RegistrationExecutionContext.userSid -or
      $Result.executionContext.sessionId -ne $RegistrationExecutionContext.sessionId) {
    Fail "REGISTRATION_VERIFICATION_INVALID: child SID/session differs from installer."
  }
  if (-not $Result.contextValid -or -not $Result.context) {
    Fail "Independent registry process did not confirm an ordinary Win32 user context."
  }
  $Child = $Result.context
  if ([bool]$Child.appContainer -ne [bool]$InstallContext.appContainer -or
      [string]$Child.packageFullName -cne [string]$InstallContext.packageFullName -or
      [string]$Child.packageFamilyName -cne [string]$InstallContext.packageFamilyName -or
      (Normalize-ComparablePath ([string]$Child.processLocalAppData)) -ine (Normalize-ComparablePath ([string]$InstallContext.processLocalAppData)) -or
      (Normalize-ComparablePath ([string]$Child.win32LocalAppData)) -ine (Normalize-ComparablePath ([string]$InstallContext.win32LocalAppData))) {
    Fail "Independent registry process context differs from the installer process."
  }
}

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) {
    Fail "Missing package directory: $Source"
  }
  [IO.Directory]::CreateDirectory($Destination) | Out-Null
  foreach ($Item in (Get-ChildItem -LiteralPath $Source -Force -ErrorAction Stop)) {
    $Target = Join-Path $Destination $Item.Name
    if ($Item.PSIsContainer) {
      Copy-Tree -Source $Item.FullName -Destination $Target
    } else {
      # Copy-Item treats square brackets in paths as wildcard character classes.
      # The python-docx distribution contains a real [Content_Types].xml file,
      # so use the filesystem API with literal paths to preserve the full tree.
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Target)) | Out-Null
      [IO.File]::Copy($Item.FullName, $Target, $true)
    }
  }
}

function Get-PackageSha256([string]$Path) {
  $Stream = [IO.File]::OpenRead($Path)
  $Hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $Digest = $Hasher.ComputeHash($Stream)
    return ([BitConverter]::ToString($Digest)).Replace("-", "").ToLowerInvariant()
  } finally {
    $Stream.Dispose()
    $Hasher.Dispose()
  }
}

function Save-InstallTreeSnapshot([string]$Root, [string]$Destination) {
  $Prefix = (Normalize-ComparablePath $Root) + [IO.Path]::DirectorySeparatorChar
  $Files = @()
  foreach ($File in (Get-ChildItem -LiteralPath $Root -Recurse -Force -File -ErrorAction Stop)) {
    $Files += [ordered]@{
      relativePath = $File.FullName.Substring($Prefix.Length)
      sha256 = Get-PackageSha256 $File.FullName
    }
  }
  $Snapshot = [ordered]@{ files = $Files }
  [IO.File]::WriteAllText($Destination, ($Snapshot | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
}

function Verify-ExternalTree([string]$Root, [string]$SnapshotPath) {
  $ProbeScript = Join-Path $PackageRoot "verify-registration.ps1"
  $PowerShellExe = Join-Path $PSHOME "powershell.exe"
  $ProbeOutput = & $PowerShellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $ProbeScript -TreeRoot $Root -ExpectedTreeSnapshotPath $SnapshotPath -VerifyTree 2>&1
  $ProbeExitCode = $LASTEXITCODE
  $ProbeText = (@($ProbeOutput) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  if ($ProbeExitCode -ne 0) {
    Fail "Independent install tree verification failed (exit $ProbeExitCode): $ProbeText"
  }
  try {
    $Result = $ProbeText | ConvertFrom-Json -ErrorAction Stop
  } catch {
    Fail "Independent install tree verifier returned invalid data."
  }
  Assert-IndependentProcessContext $Result
  if (-not $Result.treeValid) {
    Fail "Independent install tree verification reported a mismatch."
  }
  return $Result
}

function Verify-Package {
  $ChecksumFile = Join-Path $PackageRoot "SHA256SUMS"
  if (-not (Test-Path -LiteralPath $ChecksumFile)) {
    Fail "Missing SHA256SUMS file."
  }
  foreach ($Line in Get-Content -LiteralPath $ChecksumFile -Encoding UTF8) {
    if (-not $Line.Trim()) { continue }
    if ($Line -notmatch '^([0-9a-fA-F]{64})  (.+)$') {
      Fail "Invalid SHA256SUMS line."
    }
    $Expected = $Matches[1].ToLowerInvariant()
    $Relative = $Matches[2] -replace '^\./', ''
    $Target = Join-Path $PackageRoot ($Relative -replace '/', '\')
    if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) {
      Fail "Missing package file: $Relative"
    }
    $Actual = Get-PackageSha256 $Target
    if ($Actual -ne $Expected) {
      Fail "Checksum mismatch: $Relative"
    }
  }
}

function Restore-RegistrySnapshot([string]$RegistryPath, $Snapshot) {
  if (-not $Snapshot.Exists) {
    Remove-Item -LiteralPath $RegistryPath -Recurse -Force -ErrorAction SilentlyContinue
    return
  }

  if (-not (Test-Path -LiteralPath $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
  }
  if ($Snapshot.DefaultValueExists) {
    # RegistryKey returned by Get-Item is read-only. Use the registry provider for writes.
    $ValueKind = [Enum]::Parse([Microsoft.Win32.RegistryValueKind], [string]$Snapshot.Kind)
    Set-ItemProperty -LiteralPath $RegistryPath -Name "(default)" `
      -Value $Snapshot.Value -Type $ValueKind -Force
  } else {
    Remove-ItemProperty -LiteralPath $RegistryPath -Name "(default)" -ErrorAction SilentlyContinue
  }
}

function Assert-NoReparsePath([string]$Path) {
  $Resolved = [IO.Path]::GetFullPath($Path)
  for ($Cursor = $Resolved; $Cursor; $Cursor = Split-Path -Parent $Cursor) {
    if (Test-Path -LiteralPath $Cursor) {
      $Item = Get-Item -LiteralPath $Cursor -Force
      if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail "Update recovery path contains a reparse point: $Cursor" }
    }
    if ((Split-Path -Parent $Cursor) -eq $Cursor) { break }
  }
}

function Assert-UpdateJournalPath([string]$Path) {
  if (-not $Path) { Fail "Update transaction journal path is missing." }
  $Resolved = [IO.Path]::GetFullPath($Path)
  $Directory = Split-Path -Parent $Resolved
  $AllowedRoot = Join-Path (Join-Path (Split-Path -Parent $InstallRoot) ".AppraisalToolbox-updates") "run-"
  $AllowedRoot = [IO.Path]::GetFullPath($AllowedRoot)
  if ([IO.Path]::GetFileName($Resolved) -cne "update-transaction.json" -or
      -not $Directory.StartsWith($AllowedRoot, [StringComparison]::OrdinalIgnoreCase) -or
      ((Split-Path -Parent $Directory) -ine (Join-Path (Split-Path -Parent $InstallRoot) ".AppraisalToolbox-updates"))) {
    Fail "Update transaction journal is outside the updater staging directory."
  }
  Assert-NoReparsePath $Directory
  return $Resolved
}

function Assert-UpdateLockProcessPhase($State, [bool]$ForRecovery, [string]$JournalPath) {
  if ($State.recoveryRequired -ne $true -or
      -not $State.installerJournalPath -or
      (Normalize-ComparablePath ([string]$State.installerJournalPath)) -ine (Normalize-ComparablePath $JournalPath)) {
    Fail "Update transaction state does not require recovery for this installer journal."
  }
  if ($ForRecovery) {
    if ($State.phase -ceq 'recovery_start_pending') {
      if ($State.recoveryStartPending -ne $true -or $State.recoveryProcess) {
        Fail "Update recovery start state is inconsistent."
      }
      return
    }
    if ($State.phase -ceq 'recovery_running') {
      $Process = $State.recoveryProcess
      $ProcessPid = 0
      $StartedAt = [DateTime]::MinValue
      if ($State.recoveryStartPending -ne $false -or $State.installerStarted -ne $true -or
          -not $Process -or $Process.role -cne 'recovery' -or
          -not [int]::TryParse([string]$Process.pid, [ref]$ProcessPid) -or
          $ProcessPid -le 1 -or $Process.exitObserved -ne $false -or
          -not [DateTime]::TryParse([string]$Process.spawnedAtUtc, [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::RoundtripKind, [ref]$StartedAt)) {
        Fail "Update recovery process identity is invalid."
      }
      return
    }
    Fail "Update recovery phase is not active and verifiable."
  }
  if ($State.phase -ceq 'installer_start_pending') {
    if ($State.installerStartPending -ne $true -or $State.installerStarted -ne $false -or $State.installerProcess) {
      Fail "Update installer start state is inconsistent."
    }
    return
  }
  if ($State.phase -ceq 'installer_running') {
    $Process = $State.installerProcess
    $ProcessPid = 0
    $StartedAt = [DateTime]::MinValue
    if ($State.installerStartPending -ne $false -or $State.installerStarted -ne $true -or
        -not $Process -or $Process.role -cne 'installer' -or
        -not [int]::TryParse([string]$Process.pid, [ref]$ProcessPid) -or $ProcessPid -le 1 -or
        $Process.exitObserved -ne $false -or
        -not [DateTime]::TryParse([string]$Process.spawnedAtUtc, [Globalization.CultureInfo]::InvariantCulture,
          [Globalization.DateTimeStyles]::RoundtripKind, [ref]$StartedAt)) {
      Fail "Update installer process identity is invalid."
    }
    return
  }
  Fail "Update installer phase is not active and verifiable."
}

function Assert-UpdateTransactionOwnerStillMatches($Identity, [switch]$ForRecovery) {
  Assert-NoReparsePath ([string]$Identity.lockPath)
  $OwnerPath = Join-Path ([string]$Identity.lockPath) 'owner.json'
  if (-not (Test-Path -LiteralPath $OwnerPath -PathType Leaf)) { Fail "Update lock owner disappeared during installation." }
  Assert-NoReparsePath $OwnerPath
  try { $Owner = Get-Content -LiteralPath $OwnerPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
  catch { Fail "Update lock owner changed or became invalid during installation." }
  $ExpectedOwnerPropertyNames = if ([int]$Identity.schemaVersion -eq 2) { @('nonce', 'pid', 'schemaVersion', 'startedAtUtc') } else { @('nonce', 'pid', 'startedAtUtc') }
  $OwnerPropertyNames = @($Owner.PSObject.Properties.Name | Sort-Object -CaseSensitive)
  if (($OwnerPropertyNames -join '|') -cne ($ExpectedOwnerPropertyNames -join '|')) {
    Fail "Update lock owner schema changed during installation."
  }
  if ([int]$Owner.pid -ne [int]$Identity.ownerPid -or
      [string]$Owner.nonce -cne [string]$Identity.nonce -or
      [string]$Owner.startedAtUtc -cne [string]$Identity.ownerStartedAtUtc) {
    Fail "Update lock owner identity changed during installation."
  }
  if ([int]$Identity.schemaVersion -eq 3) {
    $LegacyStatePath = Join-Path ([string]$Identity.lockPath) 'transaction.json'
    if ($Owner.PSObject.Properties.Name -contains 'schemaVersion' -or
        (Test-Path -LiteralPath $LegacyStatePath)) {
      Fail "Legacy updater lock protocol changed during installation."
    }
    return
  }
  $OwnerSchema = 0
  if (-not [int]::TryParse([string]$Owner.schemaVersion, [ref]$OwnerSchema) -or $OwnerSchema -ne 2) {
    Fail "Update v2 lock owner schema changed during installation."
  }
  $StatePath = [string]$Identity.lockStatePath
  if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { Fail "Update v2 transaction state disappeared during installation." }
  Assert-NoReparsePath $StatePath
  try { $State = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
  catch { Fail "Update v2 transaction state changed or became invalid during installation." }
  $StateSchema = 0
  if (-not [int]::TryParse([string]$State.schemaVersion, [ref]$StateSchema) -or $StateSchema -ne 2 -or
      [int]$State.ownerPid -ne [int]$Identity.ownerPid -or
      [string]$State.nonce -cne [string]$Identity.nonce -or
      [string]$State.ownerStartedAtUtc -cne [string]$Identity.ownerStartedAtUtc -or
      (Normalize-ComparablePath ([string]$State.installerJournalPath)) -ine (Normalize-ComparablePath ([string]$Identity.journalPath))) {
    Fail "Update v2 transaction state owner binding changed during installation."
  }
  Assert-UpdateLockProcessPhase $State ([bool]$ForRecovery) ([string]$Identity.journalPath)
}

function Assert-ExistingUpdateTransactionJournal($Identity, [string]$JournalPath) {
  if (-not (Test-Path -LiteralPath $JournalPath -PathType Leaf)) { Fail "Update transaction journal disappeared during installation." }
  Assert-NoReparsePath $JournalPath
  try { $Existing = Get-Content -LiteralPath $JournalPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
  catch { Fail "Update transaction journal changed or became invalid during installation." }
  $LockStatePathMatches = if ([int]$Identity.schemaVersion -eq 3) {
    $null -eq $Existing.updateLockStatePath -and $null -eq $Identity.lockStatePath
  } else {
    (Normalize-ComparablePath ([string]$Existing.updateLockStatePath)) -ieq (Normalize-ComparablePath ([string]$Identity.lockStatePath))
  }
  if ([int]$Existing.schemaVersion -ne [int]$Identity.schemaVersion -or
      [string]$Existing.nonce -cne [string]$Identity.nonce -or
      [int]$Existing.updaterOwnerPid -ne [int]$Identity.ownerPid -or
      [string]$Existing.updaterOwnerStartedAtUtc -cne [string]$Identity.ownerStartedAtUtc -or
      [string]$Existing.updaterAttemptStartedAtUtc -cne [string]$Identity.ownerStartedAtUtc -or
      [string]$Existing.nativeHostCreatedAtUtc -cne [string]$Identity.hostCreatedAtUtc -or
      (Normalize-ComparablePath ([string]$Existing.installRoot)) -ine (Normalize-ComparablePath $InstallRoot) -or
      (Normalize-ComparablePath ([string]$Existing.extensionLoadPath)) -ine (Normalize-ComparablePath ([string]$Identity.extensionPath)) -or
      (Normalize-ComparablePath ([string]$Existing.updateLockPath)) -ine (Normalize-ComparablePath ([string]$Identity.lockPath)) -or
      -not $LockStatePathMatches) {
    Fail "Update transaction journal identity changed during installation."
  }
  if ([int]$Identity.schemaVersion -eq 3 -and
      ([string]$Existing.updaterProtocol -cne 'legacy-owner-v1' -or
       $Existing.externalRecoverySupported -ne $false -or
       [string]$Existing.identitySource -cne 'legacy-native-messaging-owner-only')) {
    Fail "Legacy update journal protocol identity changed during installation."
  }
  return $Existing
}

function Resolve-UpdateTransactionIdentity([switch]$ForRecovery) {
  $LegacyFields = @('TB_UPDATE_NONCE', 'TB_UPDATE_INSTALL_ROOT', 'TB_UPDATE_EXTENSION_PATH')
  $BindingFields = @('TB_UPDATE_JOURNAL_PATH', 'TB_UPDATE_OWNER_PID', 'TB_UPDATE_OWNER_STARTED_AT_UTC', 'TB_UPDATE_LOCK_PATH', 'TB_UPDATE_LOCK_STATE_PATH')
  $LegacyValues = @{}
  $BindingValues = @{}
  foreach ($Name in $LegacyFields) { $LegacyValues[$Name] = [string][Environment]::GetEnvironmentVariable($Name, 'Process') }
  foreach ($Name in $BindingFields) { $BindingValues[$Name] = [string][Environment]::GetEnvironmentVariable($Name, 'Process') }

  $LegacyCount = @($LegacyValues.Values | Where-Object { $_ }).Count
  $BindingCount = @($BindingValues.Values | Where-Object { $_ }).Count
  if ($LegacyCount -eq 0 -and $BindingCount -eq 0 -and -not $ForRecovery) { return $null }
  if ($LegacyCount -ne $LegacyFields.Count) { Fail "Update transaction identity has incomplete legacy environment fields." }
  if ($BindingCount -ne 0 -and $BindingCount -ne $BindingFields.Count) { Fail "Update transaction identity has incomplete lock binding fields." }
  if ($ForRecovery -and $BindingCount -ne $BindingFields.Count) { Fail "Update recovery requires a complete v2 lock binding." }

  $Nonce = $LegacyValues['TB_UPDATE_NONCE']
  if ($Nonce -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') {
    Fail "Update transaction nonce is not a canonical UUIDv4."
  }
  if ((Normalize-ComparablePath $LegacyValues['TB_UPDATE_INSTALL_ROOT']) -ine (Normalize-ComparablePath $InstallRoot)) {
    Fail "Update transaction install path does not match the installer target."
  }

  if (-not $RegistrationExecutionContext.valid -or
      $RegistrationExecutionContext.boundaryType -cne 'browser-native-messaging-update' -or
      -not $RegistrationExecutionContext.nativeMessagingBrowserBoundaryAttested -or
      -not $RegistrationExecutionContext.browserUpdateProof.installerLaunchRelationVerified -or
      -not $RegistrationExecutionContext.browserUpdateProof.updateEnvironmentMatchesInstalledRoot -or
      -not $RegistrationExecutionContext.executableChainValidated) {
    Fail "Update transaction identity requires an attested Native Messaging browser update context."
  }
  $Chain = @($RegistrationExecutionContext.parentChain)
  if ($Chain.Count -lt 3 -or [int]$Chain[0].processId -ne $PID -or
      $Chain[0].name -notmatch '^(?:powershell|pwsh)(?:_ise)?\.exe$' -or
      ($ForRecovery -and $Chain[1].name -ine 'native_host.exe') -or
      (-not $ForRecovery -and $Chain[1].name -ine 'cmd.exe')) {
    Fail "Update transaction process chain does not contain the expected installer launch relation."
  }
  $HostRecords = @($Chain | Where-Object { $_.name -ieq 'native_host.exe' })
  if ($HostRecords.Count -ne 1) { Fail "Update transaction process chain must contain one Native Messaging host." }
  $HostRecord = $HostRecords[0]
  $HostIndex = -1
  for ($Index = 0; $Index -lt $Chain.Count; $Index++) {
    if ([int]$Chain[$Index].processId -eq [int]$HostRecord.processId) { $HostIndex = $Index; break }
  }
  $HostBrowserLink = $false
  if ($ForRecovery -and $HostIndex -ne 1) {
    Fail "Update recovery process must be a direct child of its Native Messaging host."
  }
  if (-not $ForRecovery -and $HostIndex -lt 2) {
    Fail "Update installer process chain does not contain install.cmd."
  }
  if ($HostIndex -ge 1 -and $HostIndex + 1 -lt $Chain.Count -and
      $Chain[$HostIndex + 1].name -in @('chrome.exe', 'msedge.exe') -and
      [int]$HostRecord.parentProcessId -eq [int]$Chain[$HostIndex + 1].processId) {
    $HostBrowserLink = $true
  } elseif ($HostIndex -ge 1 -and $HostIndex + 2 -lt $Chain.Count -and
      $Chain[$HostIndex + 1].name -ieq 'cmd.exe' -and
      $Chain[$HostIndex + 2].name -in @('chrome.exe', 'msedge.exe') -and
      [int]$HostRecord.parentProcessId -eq [int]$Chain[$HostIndex + 1].processId -and
      [int]$Chain[$HostIndex + 1].parentProcessId -eq [int]$Chain[$HostIndex + 2].processId) {
    $HostBrowserLink = $true
  }
  if (-not $HostBrowserLink -or -not $HostRecord.nativeHostOriginArgumentVerified) {
    Fail "Update transaction Native Messaging host is not bound to the browser parent chain."
  }
  for ($Index = 0; $Index -lt $HostIndex; $Index++) {
    if ([int]$Chain[$Index].parentProcessId -ne [int]$Chain[$Index + 1].processId) {
      Fail "Update transaction parentChain process IDs are not contiguous."
    }
  }

  $ExpectedHostPath = [IO.Path]::GetFullPath((Join-Path $InstallRoot 'native-helper\native_host.exe'))
  if ((Normalize-ComparablePath ([string]$HostRecord.executablePath)) -ine (Normalize-ComparablePath $ExpectedHostPath) -or
      -not (Test-Path -LiteralPath $ExpectedHostPath -PathType Leaf)) {
    Fail "Update transaction Native Messaging host path does not match the installed root."
  }
  Assert-NoReparsePath $ExpectedHostPath
  $HostConfigPath = Join-Path (Split-Path -Parent $ExpectedHostPath) 'runtime-config.json'
  if (-not (Test-Path -LiteralPath $HostConfigPath -PathType Leaf)) { Fail "Installed Native Messaging runtime configuration is missing." }
  Assert-NoReparsePath $HostConfigPath
  try { $HostConfig = Get-Content -LiteralPath $HostConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
  catch { Fail "Installed Native Messaging runtime configuration is invalid." }
  if ([string]$HostConfig.toolboxExtensionId -cne $ExtensionId -or -not $HostConfig.extensionLoadPath -or
      (Normalize-ComparablePath ([string]$HostConfig.extensionLoadPath)) -ine (Normalize-ComparablePath $LegacyValues['TB_UPDATE_EXTENSION_PATH'])) {
    Fail "Update transaction extension path does not match the installed Native Messaging configuration."
  }
  Assert-NoReparsePath ([string]$HostConfig.extensionLoadPath)

  $ExpectedLockPath = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $InstallRoot) '.AppraisalToolbox-update.lock'))
  $ExpectedLockStatePath = Join-Path $ExpectedLockPath 'transaction.json'
  $LegacyRunPath = $null
  if ($BindingCount -eq $BindingFields.Count) {
    $JournalPath = Assert-UpdateJournalPath $BindingValues['TB_UPDATE_JOURNAL_PATH']
    $LockPath = [IO.Path]::GetFullPath($BindingValues['TB_UPDATE_LOCK_PATH'])
    $LockStatePath = [IO.Path]::GetFullPath($BindingValues['TB_UPDATE_LOCK_STATE_PATH'])
    if ((Normalize-ComparablePath $LockPath) -ine (Normalize-ComparablePath $ExpectedLockPath) -or
        (Normalize-ComparablePath $LockStatePath) -ine (Normalize-ComparablePath $ExpectedLockStatePath) -or
        [IO.Path]::GetFileName($LockStatePath) -cne 'transaction.json' -or
        $BindingValues['TB_UPDATE_OWNER_PID'] -notmatch '^[1-9][0-9]{0,9}$' -or
        $BindingValues['TB_UPDATE_OWNER_STARTED_AT_UTC'] -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$') {
      Fail "Update transaction v2 lock environment binding is invalid."
    }
    $OwnerPid = [int]$BindingValues['TB_UPDATE_OWNER_PID']
    $OwnerStartedAtUtc = $BindingValues['TB_UPDATE_OWNER_STARTED_AT_UTC']
    $SchemaVersion = 2
  } else {
    if ($ForRecovery) { Fail "Legacy update transaction cannot be recovered without an explicit v2 journal binding." }
    $LockPath = $ExpectedLockPath
    $LockStatePath = $null
    $JournalRoot = Join-Path (Split-Path -Parent $InstallRoot) '.AppraisalToolbox-updates'
    if (-not (Test-Path -LiteralPath $JournalRoot -PathType Container)) { Fail "Legacy update staging root is missing." }
    Assert-NoReparsePath $JournalRoot
    $OwnerPid = [int]$HostRecord.processId
    $SchemaVersion = 3
  }

  Assert-NoReparsePath $LockPath
  $OwnerPath = Join-Path $LockPath 'owner.json'
  if (-not (Test-Path -LiteralPath $OwnerPath -PathType Leaf)) { Fail "Update lock owner is missing." }
  Assert-NoReparsePath $OwnerPath
  try {
    $Owner = Get-Content -LiteralPath $OwnerPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
  } catch { Fail "Update lock owner is invalid." }
  $OwnerPropertyNames = @($Owner.PSObject.Properties.Name | Sort-Object -CaseSensitive)
  $ExpectedOwnerPropertyNames = if ($BindingCount -eq $BindingFields.Count) { @('nonce', 'pid', 'schemaVersion', 'startedAtUtc') } else { @('nonce', 'pid', 'startedAtUtc') }
  if (($OwnerPropertyNames -join '|') -cne ($ExpectedOwnerPropertyNames -join '|')) {
    Fail "Update lock owner schema is not the exact v2 or legacy owner-only protocol."
  }
  if ([int]$Owner.pid -ne $OwnerPid -or [string]$Owner.nonce -cne $Nonce) {
    Fail "Update lock owner does not bind the current nonce and Native Messaging host process."
  }
  if ($BindingCount -eq $BindingFields.Count) {
    if (-not (Test-Path -LiteralPath $LockStatePath -PathType Leaf)) { Fail "Update v2 transaction state is missing." }
    Assert-NoReparsePath $LockStatePath
    try { $LockState = Get-Content -LiteralPath $LockStatePath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
    catch { Fail "Update v2 transaction state is invalid." }
    if ([int]$Owner.schemaVersion -ne 2 -or [int]$LockState.schemaVersion -ne 2 -or
        [int]$LockState.ownerPid -ne $OwnerPid -or [string]$LockState.nonce -cne $Nonce -or
        [string]$LockState.ownerStartedAtUtc -cne [string]$Owner.startedAtUtc) {
      Fail "Update v2 owner and transaction state do not bind the current nonce and host process."
    }
    if ((Normalize-ComparablePath ([string]$LockState.installerJournalPath)) -ine (Normalize-ComparablePath $JournalPath)) {
      Fail "Update v2 transaction state journal path does not match the current installer request."
    }
    Assert-UpdateLockProcessPhase $LockState ([bool]$ForRecovery) $JournalPath
  } else {
    if ($Owner.PSObject.Properties.Name -contains 'schemaVersion' -or
        (Test-Path -LiteralPath $ExpectedLockStatePath)) {
      Fail "Legacy updater lock is not the owner-only protocol."
    }
  }
  if ($OwnerPid -ne [int]$HostRecord.processId) { Fail "Update lock owner PID does not match the Native Messaging parentChain." }
  try {
    if ([string]$Owner.startedAtUtc -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$') {
      Fail "Update owner attempt timestamp is invalid."
    }
    $OwnerStarted = [DateTime]::Parse([string]$Owner.startedAtUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    $HostStarted = [DateTime]::Parse([string]$HostRecord.createdAtUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    $ContextObservedAt = [DateTime]::Parse([string]$RegistrationExecutionContext.observedAtUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
  } catch { Fail "Update v2 owner or Native Messaging process start time is invalid." }
  if ($OwnerStarted -gt $ContextObservedAt.AddSeconds(1) -or $HostStarted -gt $OwnerStarted.AddSeconds(5)) {
    Fail "Update owner attempt time does not bind the Native Messaging process lifetime."
  }
  if ($BindingCount -eq $BindingFields.Count -and
      ([int]$OwnerPid -ne [int]$HostRecord.processId -or
       [string]$OwnerStartedAtUtc -cne [string]$Owner.startedAtUtc)) {
    Fail "Update transaction v2 owner environment does not match the v2 lock files."
  }
  if ($ForRecovery) {
    if ($RecoveryNonce -cne $Nonce -or -not $RecoveryJournalPath) {
      Fail "Update recovery parameters do not match the current transaction."
    }
    if ((Normalize-ComparablePath $JournalPath) -ine (Normalize-ComparablePath $RecoveryJournalPath) -or
        (Normalize-ComparablePath $JournalPath) -ine (Normalize-ComparablePath $TransactionJournalPath)) {
      Fail "Update recovery journal path does not match its v2 environment binding."
    }
  } else {
    if ($SchemaVersion -eq 3) {
      if ($Owner.PSObject.Properties.Name -contains 'schemaVersion') { Fail "Legacy updater lock contains a v2 owner record." }
      $LegacyRunPath = Join-Path $JournalRoot ("run-legacy-$OwnerPid-$Nonce")
      if (Test-Path -LiteralPath $LegacyRunPath) { Fail "Legacy update run directory already exists; refusing to reuse its nonce." }
      $JournalPath = Assert-UpdateJournalPath (Join-Path $LegacyRunPath 'update-transaction.json')
    }
    if (Test-Path -LiteralPath $JournalPath) {
      Fail "Update transaction journal already exists; refusing to overwrite prior evidence."
    }
  }

  $Identity = [PSCustomObject]@{
    schemaVersion = $SchemaVersion
    mode = if ($SchemaVersion -eq 3) { 'legacy-owner-only' } else { 'v2-lock' }
    nonce = $Nonce
    installRoot = $InstallRoot
    extensionPath = [IO.Path]::GetFullPath([string]$HostConfig.extensionLoadPath)
    journalPath = $JournalPath
    ownerPid = $OwnerPid
    ownerStartedAtUtc = [string]$Owner.startedAtUtc
    hostCreatedAtUtc = $HostStarted.ToString('o')
    lockPath = $LockPath
    lockStatePath = $LockStatePath
    legacyRunPath = $LegacyRunPath
    parentChain = @($RegistrationExecutionContext.parentChain)
  }
  $script:UpdateNonce = $Nonce
  $script:TransactionJournalPath = $JournalPath
  $script:UpdateOwnerPid = [string]$OwnerPid
  $script:UpdateOwnerStartedAtUtc = [string]$Owner.startedAtUtc
  $script:UpdateLockPath = $LockPath
  $script:UpdateLockStatePath = $LockStatePath
  $script:UpdateTransactionSchemaVersion = $SchemaVersion
  $script:UpdateTransactionIdentity = $Identity
  if (-not $ForRecovery) { $script:UpdateTransactionJournalCreated = $false }
  return $Identity
}

function Write-UpdateTransactionJournal([string]$Phase) {
  if (-not $UpdateNonce) { return }
  $JournalPath = Assert-UpdateJournalPath $TransactionJournalPath
  $Identity = $script:UpdateTransactionIdentity
  if (-not $Identity -or [int]$Identity.schemaVersion -notin @(2, 3) -or
      (Normalize-ComparablePath $JournalPath) -ine (Normalize-ComparablePath ([string]$Identity.journalPath))) {
    Fail "Update transaction owner identity is missing or invalid."
  }
  $Journal = [ordered]@{
    schemaVersion = [int]$Identity.schemaVersion
    status = $Phase
    nonce = [string]$Identity.nonce
    updaterOwnerPid = [int]$Identity.ownerPid
    updaterOwnerStartedAtUtc = [string]$Identity.ownerStartedAtUtc
    updaterAttemptStartedAtUtc = [string]$Identity.ownerStartedAtUtc
    nativeHostCreatedAtUtc = [string]$Identity.hostCreatedAtUtc
    updateLockPath = [string]$Identity.lockPath
    updateLockStatePath = $Identity.lockStatePath
    userSid = [string]$RegistrationExecutionContext.userSid
    sessionId = [int]$RegistrationExecutionContext.sessionId
    installRoot = $InstallRoot
    stagingRoot = $StagingRoot
    backupRoot = $BackupRoot
    installSnapshotPath = $InstallSnapshotPath
    extensionLoadPath = $ExtensionLoadPath
    extensionStaging = $ExtensionStaging
    extensionBackup = $ExtensionBackup
    extensionSnapshotPath = $ExtensionSnapshotPath
    registrySnapshots = $RegistrySnapshots
    writtenAtUtc = [DateTime]::UtcNow.ToString('o')
  }
  if ([int]$Identity.schemaVersion -eq 3) {
    $Journal['identitySource'] = 'legacy-native-messaging-owner-only'
    $Journal['updaterProtocol'] = 'legacy-owner-v1'
    $Journal['externalRecoverySupported'] = $false
    $Journal['parentChain'] = @($Identity.parentChain)
  } else {
    $Journal['updaterProtocol'] = 'transaction-lock-v2'
    $Journal['externalRecoverySupported'] = $true
  }
  $TemporaryPath = "$JournalPath.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
  $Stream = $null
  try {
    Assert-UpdateTransactionOwnerStillMatches $Identity
    if ([int]$Identity.schemaVersion -eq 3 -and -not $script:UpdateTransactionJournalCreated) {
      if (Test-Path -LiteralPath (Split-Path -Parent $JournalPath)) { Fail "Legacy update run directory already exists; refusing to overwrite prior evidence." }
      [AppraisalToolboxInstallerWin32]::CreateDirectoryExclusive((Split-Path -Parent $JournalPath))
      Assert-NoReparsePath (Split-Path -Parent $JournalPath)
    }
    $Bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Journal | ConvertTo-Json -Depth 16))
    $Stream = [IO.FileStream]::new($TemporaryPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough)
    $Stream.Write($Bytes, 0, $Bytes.Length)
    $Stream.Flush($true)
    $Stream.Dispose()
    $Stream = $null
    if (-not $script:UpdateTransactionJournalCreated) {
      if (Test-Path -LiteralPath $JournalPath) { Fail "Update transaction journal already exists; refusing to overwrite prior evidence." }
      [IO.File]::Move($TemporaryPath, $JournalPath)
      $script:UpdateTransactionJournalCreated = $true
    } else {
      $null = Assert-ExistingUpdateTransactionJournal $Identity $JournalPath
      $BackupPath = "$JournalPath.previous-$PID-$([Guid]::NewGuid().ToString('N'))"
      [IO.File]::Replace($TemporaryPath, $JournalPath, $BackupPath, $true)
      if (Test-Path -LiteralPath $BackupPath -PathType Leaf) {
        Remove-Item -LiteralPath $BackupPath -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    if ($Stream) { $Stream.Dispose() }
    if (Test-Path -LiteralPath $TemporaryPath -PathType Leaf) { Remove-Item -LiteralPath $TemporaryPath -Force -ErrorAction SilentlyContinue }
    throw
  }
}

function Invoke-UpdateTransactionRecovery {
  if ($TestMode -or $RegistryTestRoot) { Fail "Update transaction recovery is not available in installer fixture mode." }
  if (-not $UpdateNonce -or $RecoveryNonce -cne $UpdateNonce) { Fail "Update recovery nonce does not match the initiating transaction." }
  $JournalPath = Assert-UpdateJournalPath $RecoveryJournalPath
  if (-not (Test-Path -LiteralPath $JournalPath -PathType Leaf)) { Fail "Update transaction journal is missing." }
  try { $Journal = Get-Content -LiteralPath $JournalPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
  catch { Fail "Update transaction journal is invalid." }
  $RecoveryIdentity = $script:UpdateTransactionIdentity
  if (-not $RecoveryIdentity -or [int]$RecoveryIdentity.schemaVersion -ne 2) { Fail "Update recovery v2 identity is missing." }
  Assert-UpdateTransactionOwnerStillMatches $RecoveryIdentity -ForRecovery
  if ([int]$Journal.schemaVersion -ne 2 -or [string]$Journal.updaterProtocol -cne 'transaction-lock-v2' -or
      $Journal.externalRecoverySupported -ne $true -or
      [string]$Journal.nonce -cne [string]$RecoveryIdentity.nonce -or
      [int]$Journal.updaterOwnerPid -ne [int]$RecoveryIdentity.ownerPid -or
      [string]$Journal.updaterOwnerStartedAtUtc -cne [string]$RecoveryIdentity.ownerStartedAtUtc -or
      [string]$Journal.updaterAttemptStartedAtUtc -cne [string]$RecoveryIdentity.ownerStartedAtUtc -or
      [string]$Journal.nativeHostCreatedAtUtc -cne [string]$RecoveryIdentity.hostCreatedAtUtc -or
      (Normalize-ComparablePath ([string]$Journal.updateLockPath)) -ine (Normalize-ComparablePath ([string]$RecoveryIdentity.lockPath)) -or
      (Normalize-ComparablePath ([string]$Journal.updateLockStatePath)) -ine (Normalize-ComparablePath ([string]$RecoveryIdentity.lockStatePath)) -or
      (Normalize-ComparablePath ([string]$Journal.extensionLoadPath)) -ine (Normalize-ComparablePath ([string]$RecoveryIdentity.extensionPath)) -or
      [int]$Journal.sessionId -ne [int]$RegistrationExecutionContext.sessionId -or
      [string]$Journal.userSid -cne [string]$RegistrationExecutionContext.userSid -or
      (Normalize-ComparablePath ([string]$Journal.installRoot)) -ine (Normalize-ComparablePath $InstallRoot)) {
    Fail "Update transaction journal identity does not match the current desktop session."
  }

  $InstallParent = Split-Path -Parent $InstallRoot
  $InstallName = Split-Path -Leaf $InstallRoot
  $ExpectedBackupPrefix = $InstallName + ".previous-"
  $BackupPath = [IO.Path]::GetFullPath([string]$Journal.backupRoot)
  if ((Split-Path -Parent $BackupPath) -ine $InstallParent -or
      -not (Split-Path -Leaf $BackupPath).StartsWith($ExpectedBackupPrefix, [StringComparison]::OrdinalIgnoreCase) -or
      (Split-Path -Leaf $BackupPath).Substring($ExpectedBackupPrefix.Length) -notmatch '^[A-Za-z0-9-]+$') {
    Fail "Update transaction backup path is invalid."
  }
  Assert-NoReparsePath $BackupPath

  $OriginalRoot = if (Test-Path -LiteralPath $BackupPath -PathType Container) { $BackupPath } else { $InstallRoot }
  if (-not (Test-Path -LiteralPath $OriginalRoot -PathType Container)) { Fail "Neither the previous installation nor its backup is available." }
  $OriginalConfigPath = Join-Path $OriginalRoot "native-helper\runtime-config.json"
  if (-not (Test-Path -LiteralPath $OriginalConfigPath -PathType Leaf)) { Fail "Previous installation runtime configuration is missing." }
  try { $OriginalConfig = Get-Content -LiteralPath $OriginalConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
  catch { Fail "Previous installation runtime configuration is invalid." }
  if ([string]$OriginalConfig.toolboxExtensionId -cne $ExtensionId) { Fail "Previous installation extension identity is invalid." }
  $ExpectedExtensionPath = if ($OriginalConfig.extensionLoadPath) { [IO.Path]::GetFullPath([string]$OriginalConfig.extensionLoadPath) } else { Join-Path $InstallRoot "extension" }
  $ExtensionPath = [IO.Path]::GetFullPath([string]$Journal.extensionLoadPath)
  if ((Normalize-ComparablePath $ExtensionPath) -ine (Normalize-ComparablePath $ExpectedExtensionPath)) { Fail "Update recovery extension path does not match the previous installation." }

  $InstallSnapshotPath = [IO.Path]::GetFullPath([string]$Journal.installSnapshotPath)
  $ExtensionSnapshotPath = [IO.Path]::GetFullPath([string]$Journal.extensionSnapshotPath)
  $TempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
  foreach ($Snapshot in @($InstallSnapshotPath, $ExtensionSnapshotPath)) {
    if ((Split-Path -Parent $Snapshot).TrimEnd('\') -ine $TempRoot -or
        (Split-Path -Leaf $Snapshot) -notmatch '^AppraisalToolbox-(?:install|extension)-snapshot-[A-Za-z0-9-]+\.json$') {
      Fail "Update recovery snapshot path is invalid."
    }
  }

  $Snapshots = @{}
  foreach ($Property in $Journal.registrySnapshots.PSObject.Properties) { $Snapshots[$Property.Name] = $Property.Value }
  if ($Snapshots.Count -ne $RegistryPaths.Count) { Fail "Update transaction registry snapshot is incomplete." }
  foreach ($RegistryPath in $RegistryPaths) { if (-not $Snapshots.ContainsKey($RegistryPath)) { Fail "Update transaction registry snapshot is incomplete." } }

  if (Test-Path -LiteralPath $BackupPath -PathType Container) {
    if (-not (Test-Path -LiteralPath $InstallSnapshotPath -PathType Leaf)) { Fail "Previous installation snapshot is missing; automatic rollback is unsafe." }
    $null = Verify-ExternalTree $BackupPath $InstallSnapshotPath
    if (Test-Path -LiteralPath $InstallRoot) {
      Assert-NoReparsePath $InstallRoot
      Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction Stop
      if (Test-Path -LiteralPath $InstallRoot) { Fail "Partial installation directory could not be removed." }
    }
    Move-Item -LiteralPath $BackupPath -Destination $InstallRoot -ErrorAction Stop
    $null = Verify-ExternalTree $InstallRoot $InstallSnapshotPath
  } elseif (Test-Path -LiteralPath $InstallRoot -PathType Container) {
    if (Test-Path -LiteralPath $InstallSnapshotPath -PathType Leaf) { $null = Verify-ExternalTree $InstallRoot $InstallSnapshotPath }
    # With no backup and no snapshot, the installer is guaranteed to have been
    # terminated before its first root move, which is ordered after the snapshot.
  } else {
    Fail "Previous installation root and rollback backup are both missing."
  }

  $ExtensionBackupPath = [string]$Journal.extensionBackup
  $ExtensionStagingPath = [string]$Journal.extensionStaging
  $InternalExtensionPath = Normalize-ComparablePath (Join-Path $InstallRoot "extension")
  if ((Normalize-ComparablePath $ExtensionPath) -ine $InternalExtensionPath) {
    $ExtensionParent = Split-Path -Parent $ExtensionPath
    $ExtensionName = Split-Path -Leaf $ExtensionPath
    if ($ExtensionBackupPath) {
      $ExtensionBackupPath = [IO.Path]::GetFullPath($ExtensionBackupPath)
      $ExpectedExtensionBackupPrefix = $ExtensionName + ".previous-"
      if ((Split-Path -Parent $ExtensionBackupPath) -ine $ExtensionParent -or
          -not (Split-Path -Leaf $ExtensionBackupPath).StartsWith($ExpectedExtensionBackupPrefix, [StringComparison]::OrdinalIgnoreCase) -or
          (Split-Path -Leaf $ExtensionBackupPath).Substring($ExpectedExtensionBackupPrefix.Length) -notmatch '^[A-Za-z0-9-]+$') {
        Fail "Original extension backup path is invalid."
      }
      Assert-NoReparsePath $ExtensionBackupPath
    }
    if ($ExtensionBackupPath -and (Test-Path -LiteralPath $ExtensionBackupPath -PathType Container)) {
      if (-not (Test-Path -LiteralPath $ExtensionSnapshotPath -PathType Leaf)) { Fail "Original extension snapshot is missing; automatic rollback is unsafe." }
      $null = Verify-ExternalTree $ExtensionBackupPath $ExtensionSnapshotPath
      if (Test-Path -LiteralPath $ExtensionPath) {
        Assert-NoReparsePath $ExtensionPath
        Remove-Item -LiteralPath $ExtensionPath -Recurse -Force -ErrorAction Stop
      }
      Move-Item -LiteralPath $ExtensionBackupPath -Destination $ExtensionPath -ErrorAction Stop
      $null = Verify-ExternalTree $ExtensionPath $ExtensionSnapshotPath
    } elseif (Test-Path -LiteralPath $ExtensionPath -PathType Container) {
      if (Test-Path -LiteralPath $ExtensionSnapshotPath -PathType Leaf) { $null = Verify-ExternalTree $ExtensionPath $ExtensionSnapshotPath }
      # No extension backup means the installer was terminated before its atomic rename.
    } else {
      Fail "Original extension and its rollback backup are both missing."
    }
    if ($ExtensionStagingPath -and (Test-Path -LiteralPath $ExtensionStagingPath)) {
      $ExtensionStagingPath = [IO.Path]::GetFullPath($ExtensionStagingPath)
      if ((Split-Path -Parent $ExtensionStagingPath) -ine $ExtensionParent -or
          -not (Split-Path -Leaf $ExtensionStagingPath).StartsWith(($ExtensionName + ".staging-"), [StringComparison]::OrdinalIgnoreCase)) {
        Fail "Original extension staging path is invalid."
      }
      Assert-NoReparsePath $ExtensionStagingPath
      Remove-Item -LiteralPath $ExtensionStagingPath -Recurse -Force -ErrorAction Stop
    }
  }

  foreach ($RegistryPath in $RegistryPaths) {
    Restore-RegistrySnapshot $RegistryPath $Snapshots[$RegistryPath]
    $Actual = Read-ExternalRegistryState $RegistryPath
    $Expected = $Snapshots[$RegistryPath]
    if ([bool]$Actual.exists -ne [bool]$Expected.Exists -or
        [bool]$Actual.defaultValueExists -ne [bool]$Expected.DefaultValueExists -or
        ($Expected.DefaultValueExists -and ([string]$Actual.value -cne [string]$Expected.Value -or [string]$Actual.valueKind -cne [string]$Expected.Kind))) {
      Fail "Native Messaging registration rollback did not verify: $RegistryPath"
    }
  }
  if (Test-Path -LiteralPath ([string]$Journal.stagingRoot)) {
    $StagingPath = [IO.Path]::GetFullPath([string]$Journal.stagingRoot)
    if ((Split-Path -Parent $StagingPath) -ine $InstallParent -or
        -not (Split-Path -Leaf $StagingPath).StartsWith(($InstallName + ".staging-"), [StringComparison]::OrdinalIgnoreCase)) {
      Fail "Runtime staging path is invalid."
    }
    Assert-NoReparsePath $StagingPath
    Remove-Item -LiteralPath $StagingPath -Recurse -Force -ErrorAction Stop
  }

  $Report = [ordered]@{
    status = "recovered"
    nonce = $UpdateNonce
    ownerPid = [int]$RecoveryIdentity.ownerPid
    journalSchemaVersion = 2
    installRoot = $InstallRoot
    installRootRestored = $true
    extensionRestored = $true
    registryRestored = $true
    recoveryExecutionContext = $RegistrationExecutionContext
    recoveredAtUtc = [DateTime]::UtcNow.ToString('o')
  }
  [IO.File]::WriteAllText("$JournalPath.recovery-report.json", ($Report | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
  Write-Host "Timed-out update transaction rollback verified."
}

try {
  Write-Host "[0/7] Checking ordinary Windows user context"
  . (Join-Path $PackageRoot 'registration-context.ps1')
  $RegistrationExecutionContext = Get-RegistrationContext -CallerScriptPath $PSCommandPath
  Assert-RegistrationContext $RegistrationExecutionContext
  $InstallContext = Assert-OrdinaryUserContext
  . (Join-Path $PackageRoot "extension-deployment.ps1")
  if ($RecoverUpdateTransaction) {
    $null = Resolve-UpdateTransactionIdentity -ForRecovery
    Invoke-UpdateTransactionRecovery
    exit 0
  }
  if ($RecoveryJournalPath -or $RecoveryNonce) { Fail "Recovery parameters require -RecoverUpdateTransaction." }
  $OldConfigPath = Join-Path $InstallRoot "native-helper\runtime-config.json"
  if (Test-Path -LiteralPath $OldConfigPath) {
    $OldConfig = Get-Content -LiteralPath $OldConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($OldConfig.extensionLoadPath -and $OldConfig.toolboxExtensionId -eq $ExtensionId) { $ExtensionLoadPath = [string]$OldConfig.extensionLoadPath }
  }
  if ($env:TB_UPDATE_EXTENSION_PATH) {
    if (-not $OldConfig -or $env:TB_UPDATE_EXTENSION_PATH -cne $OldConfig.extensionLoadPath) { throw "Untrusted original extension path." }
    $ExtensionLoadPath = $env:TB_UPDATE_EXTENSION_PATH
  }
  if ($OriginalExtensionPath) { $ExtensionLoadPath = $OriginalExtensionPath }
  $ExtensionLoadPath = [IO.Path]::GetFullPath($ExtensionLoadPath)
  if ($ExtensionLoadPath -ine (Join-Path $InstallRoot "extension")) {
    $null = Assert-ToolboxExtensionPath $ExtensionLoadPath (Join-Path $PackageRoot "extension")
  }
  $null = Resolve-UpdateTransactionIdentity
  Save-RegistrySnapshots

  Write-Host "[1/7] Unblocking and verifying package"
  Get-ChildItem -LiteralPath $PackageRoot -Recurse -Force -File -ErrorAction SilentlyContinue |
    Unblock-File -ErrorAction SilentlyContinue
  Verify-Package

  Write-Host "[2/7] Staging independent runtime"
  New-Item -ItemType Directory -Path $StagingRoot -Force | Out-Null
  Copy-Tree (Join-Path $PackageRoot "extension") (Join-Path $StagingRoot "extension")
  Copy-Tree (Join-Path $PackageRoot "native-helper") (Join-Path $StagingRoot "native-helper")
  Copy-Tree (Join-Path $PackageRoot "skills") (Join-Path $StagingRoot "skills")
  Copy-Tree (Join-Path $PackageRoot "runtime") (Join-Path $StagingRoot "runtime")

  if (Test-Path -LiteralPath (Join-Path $InstallRoot "map-config.json")) {
    Copy-Item -LiteralPath (Join-Path $InstallRoot "map-config.json") `
      -Destination (Join-Path $StagingRoot "map-config.json") -Force
  }
  $OldState = Join-Path $InstallRoot "native-helper\depreciation-capex-forecast-state.json"
  if (Test-Path -LiteralPath $OldState) {
    Copy-Item -LiteralPath $OldState `
      -Destination (Join-Path $StagingRoot "native-helper\depreciation-capex-forecast-state.json") -Force
  }

  foreach ($PrivateFile in @("update-sources.json")) {
    $OldFile = Join-Path $InstallRoot "native-helper\$PrivateFile"
    if (Test-Path -LiteralPath $OldFile) { Copy-Item -LiteralPath $OldFile -Destination (Join-Path $StagingRoot "native-helper\$PrivateFile") -Force }
  }

  Write-Host "[3/7] Writing runtime configuration"
  $RuntimeConfig = [ordered]@{
    pythonBin = Join-Path $InstallRoot "runtime\python-portable\python.exe"
    printSkillsDir = Join-Path $InstallRoot "skills"
    depreciationSkillDir = Join-Path $InstallRoot "skills\depreciation-capex-forecast"
    toolboxExtensionId = $ExtensionId
    nativeHostName = $HostName
    extensionLoadPath = $ExtensionLoadPath
  }
  [IO.File]::WriteAllText(
    (Join-Path $StagingRoot "native-helper\runtime-config.json"),
    ($RuntimeConfig | ConvertTo-Json -Depth 5),
    [Text.UTF8Encoding]::new($false)
  )

  Write-Host "[4/7] Installing atomically"
  if ($ExtensionLoadPath -ine (Join-Path $InstallRoot "extension")) {
    $ExtensionStaging = "$ExtensionLoadPath.staging-$UniqueSuffix"
    $ExtensionBackup = "$ExtensionLoadPath.previous-$UniqueSuffix"
  }
  if ($UpdateNonce -and -not $TransactionJournalPath) { Fail "Update transaction journal path is required." }
  Write-UpdateTransactionJournal "prepared"
  if (Test-Path -LiteralPath $InstallRoot) {
    Save-InstallTreeSnapshot $InstallRoot $InstallSnapshotPath
    Write-UpdateTransactionJournal "previous-root-snapshotted"
    Move-Item -LiteralPath $InstallRoot -Destination $BackupRoot
    $MovedExistingRoot = $true
    Write-UpdateTransactionJournal "previous-root-moved"
  }
  Move-Item -LiteralPath $StagingRoot -Destination $InstallRoot
  $InstalledNewRoot = $true
  Write-UpdateTransactionJournal "new-root-installed"

  Write-Host "[5/7] Running Python and Native Helper self-tests"
  $PythonExe = Join-Path $InstallRoot "runtime\python-portable\python.exe"
  $NativeHostExe = Join-Path $InstallRoot "native-helper\native_host.exe"
  & $PythonExe -c "import docx, et_xmlfile, lxml, openpyxl, requests, typing_extensions"
  if ($LASTEXITCODE -ne 0) { Fail "Python dependency self-test failed." }
  $SelfTestText = (& $NativeHostExe --self-test | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { Fail "Native Helper self-test failed." }
  $SelfTest = $SelfTestText | ConvertFrom-Json
  if (-not $SelfTest.ok) { Fail "Native Helper self-test returned ok=false." }

  Write-Host "[6/7] Registering Chrome and Edge Native Messaging"
  $ManifestPath = Join-Path $InstallRoot "native-helper\$HostName.json"
  $Manifest = [ordered]@{
    name = $HostName
    description = "Appraisal Toolbox Native Helper"
    path = $NativeHostExe
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
  }
  [IO.File]::WriteAllText(
    $ManifestPath,
    ($Manifest | ConvertTo-Json -Depth 5),
    [Text.UTF8Encoding]::new($false)
  )
  foreach ($RegistryPath in $RegistryPaths) {
    $BrowserName = if ($RegistryPath -ieq "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName" -or
                       ($RegistryTestRoot -and $RegistryPath -ieq "$RegistryTestRoot\Chrome")) { "chrome" } else { "edge" }
    $KeyResult = [ordered]@{
      browser = $BrowserName
      registryPath = $RegistryPath
      manifestPath = $ManifestPath
      readBackProcess = "powershell.exe"
      status = "pending"
      manifestExists = $false
      executableExists = $false
      registryViews = @()
      error = ""
    }
    $RegistryResults += $KeyResult
    try {
      $RegistryTouched[$RegistryPath] = $true
      New-Item -Path $RegistryPath -Force | Out-Null
      Set-Item -LiteralPath $RegistryPath -Value $ManifestPath -Force
      # Fault injection is restricted to the explicitly isolated registry fixture.
      if ($TestMode -and $RegistryTestRoot -and
          $env:APPRAISAL_TOOLBOX_INSTALLER_TEST_DELETE_BEFORE_VERIFY -eq $RegistryPath) {
        Remove-Item -LiteralPath $RegistryPath -Recurse -Force
      }
      $ExternalResult = Verify-ExternalRegistration $RegistryPath $ManifestPath $NativeHostExe
      $KeyResult.status = "verified"
      $KeyResult.manifestExists = [bool]$ExternalResult.manifestExists
      $KeyResult.executableExists = [bool]$ExternalResult.executableExists
      $KeyResult.registryViews = @($ExternalResult.registryViews)
      $KeyResult.executionContext = $ExternalResult.executionContext
      $KeyResult.verifiedAt = [DateTime]::UtcNow.ToString('o')
      $KeyResult.readBackProcessId = $ExternalResult.processId
    } catch {
      $KeyResult.status = "failed"
      $KeyResult.error = $_.Exception.Message
      throw
    }
    Write-Host "Verified $BrowserName Native Messaging registration in an independent process."
    if ($TestMode -and $env:APPRAISAL_TOOLBOX_INSTALLER_TEST_FAIL_AFTER_REGISTRY -eq $RegistryPath) {
      Fail "Test fixture requested rollback after verifying $BrowserName registration."
    }
  }

  Update-OriginalExtension
  Write-Host "[7/7] Writing installation report"
  # Re-query both keys immediately before success, catching deletion after the
  # first key was checked. A report is a timestamped observation, not a promise
  # that another program cannot remove registration later.
  foreach ($KeyResult in $RegistryResults) {
    try {
      $FinalReadback = Verify-ExternalRegistration $KeyResult.registryPath $ManifestPath $NativeHostExe
      $KeyResult.registryViews = @($FinalReadback.registryViews)
      $KeyResult.executionContext = $FinalReadback.executionContext
      $KeyResult.verifiedAt = $FinalReadback.executionContext.observedAtUtc
      $KeyResult.readBackProcessId = $FinalReadback.processId
    } catch { $KeyResult.status = "failed"; $KeyResult.error = $_.Exception.Message; throw }
  }
  [IO.File]::WriteAllText((Join-Path $InstallRoot "registration-verification.json"),
    (@{ verifiedAtUtc = [DateTime]::UtcNow.ToString('o'); installerExecutionContext=$RegistrationExecutionContext; registryResults = @($RegistryResults) } | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
  $PreviousInstallBackup = ""
  if ($MovedExistingRoot) {
    if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
      Fail "Previous installation backup is missing; refusing to report success."
    }
    $PreviousInstallBackup = $BackupRoot
  }
  $InstallMode = if ($TestMode) { "isolated-fixture" } else { "ordinary-user" }
  $BrowserRegistrationScope = if ($TestMode) { "fixture-only-not-real-chrome-or-edge" } else { "chrome-and-edge-user-hives" }
  $BrowserInstallVerification = if ($TestMode) { "false-fixture-only" } else { "registry-and-manifest-only" }
  $Report = @(
    "status=success",
    "product=Appraisal Toolbox",
    "version=$ProductVersion",
    "installerBuild=$InstallerBuild",
    "extensionId=$ExtensionId",
    "nativeHost=$HostName",
    "extensionPath=$ExtensionLoadPath",
    "extensionBackup=$ExtensionBackup",
    "updateNonce=$UpdateNonce",
    "buildId=$($BuildMetadata.buildId)",
    "nativeExeSha256=$(Get-PackageSha256 $NativeHostExe)",
    "nativeHelper=passed",
    "pythonDependencies=passed",
    "registryReadBack=independent-powershell-process-win32-and-regexe-both-views",
    "registryVerificationEvidence=$(Join-Path $InstallRoot 'registration-verification.json')",
    "registrationStatusScope=verified-at-install-time",
    "registryVerificationContext=$($RegistrationExecutionContext.scope)",
    "registryVerificationContextPid=$PID",
    "registryVerificationContextSid=$($RegistrationExecutionContext.userSid)",
    "registryVerificationContextSession=$($RegistrationExecutionContext.sessionId)",
    "registryVerificationContextAtUtc=$($RegistrationExecutionContext.observedAtUtc)",
    "registryVerificationLimitation=same-process-tree-crossread-not-independent-out-of-tree-witness",
    "installationMode=$InstallMode",
    "browserRegistrationScope=$BrowserRegistrationScope",
    "browserInstallVerification=$BrowserInstallVerification",
    "previousInstallBackup=$PreviousInstallBackup",
    "previousInstallBackupRetention=manual-review-before-delete",
    "previousInstallDataMigration=legacy-projects-and-user-data-retained-in-backup",
    "chromeNativeMessaging=$($RegistryResults[0].status)",
    "chromeNativeMessagingRegistryPath=$($RegistryResults[0].registryPath)",
    "chromeNativeMessagingManifest=$($RegistryResults[0].manifestPath)",
    "edgeNativeMessaging=$($RegistryResults[1].status)",
    "edgeNativeMessagingRegistryPath=$($RegistryResults[1].registryPath)",
    "edgeNativeMessagingManifest=$($RegistryResults[1].manifestPath)",
    "processLocalAppDataMatchesWin32=true",
    "browserProfileAutoOpened=false",
    "installedAt=$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz'))"
  ) -join [Environment]::NewLine
  [IO.File]::WriteAllText(
    (Join-Path $InstallRoot "installation-report.txt"),
    $Report + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
  )
  if (Test-Path -LiteralPath $InstallSnapshotPath -PathType Leaf) {
    Remove-Item -LiteralPath $InstallSnapshotPath -Force -ErrorAction SilentlyContinue
  }

  Write-Host ""
  Write-Host "Installation completed. No browser profile or Explorer window was opened."
  Write-Host "In Chrome and Edge, use Load unpacked to select:"
  Write-Host $ExtensionLoadPath
  Write-Host "Expected extension ID: $ExtensionId"
  exit 0
}
catch {
  $InstallError = $_.Exception.Message
  [Console]::Error.WriteLine("Installation failed: " + $InstallError)
  $RollbackErrors = @()
  try { if (Get-Command Restore-OriginalExtension -ErrorAction SilentlyContinue) { Restore-OriginalExtension } } catch { $RollbackErrors += "Original extension rollback failed: $($_.Exception.Message)" }
  if ($InstalledNewRoot -and (Test-Path -LiteralPath $InstallRoot)) {
    try {
      Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction Stop
      if (Test-Path -LiteralPath $InstallRoot) { throw "New installation directory still exists after removal." }
    } catch {
      $RollbackErrors += "New installation directory removal failed: $($_.Exception.Message)"
    }
  }
  if ($MovedExistingRoot -and (Test-Path -LiteralPath $BackupRoot)) {
    try {
      Move-Item -LiteralPath $BackupRoot -Destination $InstallRoot -ErrorAction Stop
      if (-not (Test-Path -LiteralPath $InstallRoot) -or (Test-Path -LiteralPath $BackupRoot)) {
        throw "Previous installation directory restore did not verify."
      }
      if (-not (Test-Path -LiteralPath $InstallSnapshotPath -PathType Leaf)) {
        throw "Previous installation snapshot is missing; restored files cannot be independently verified."
      }
      $null = Verify-ExternalTree $InstallRoot $InstallSnapshotPath
    } catch {
      $RollbackErrors += "Install directory restore failed: $($_.Exception.Message)"
    }
  }
  foreach ($RegistryPath in $RegistryPaths) {
    if (-not $RegistryTouched.ContainsKey($RegistryPath)) { continue }
    try {
      Restore-RegistrySnapshot $RegistryPath $RegistrySnapshots[$RegistryPath]
      $ActualState = Read-ExternalRegistryState $RegistryPath
      $Snapshot = $RegistrySnapshots[$RegistryPath]
      if (([bool]$ActualState.exists -ne [bool]$Snapshot.Exists) -or
          ([bool]$ActualState.defaultValueExists -ne [bool]$Snapshot.DefaultValueExists) -or
          ($Snapshot.DefaultValueExists -and ([string]$ActualState.value -cne [string]$Snapshot.Value)) -or
          ($Snapshot.DefaultValueExists -and ([string]$ActualState.valueKind -cne [string]$Snapshot.Kind))) {
        throw "Registry snapshot restore did not verify in an independent process."
      }
    } catch {
      $RollbackErrors += "Registry restore failed for $RegistryPath`: $($_.Exception.Message)"
    }
  }
  if (Test-Path -LiteralPath $StagingRoot) {
    try {
      Remove-Item -LiteralPath $StagingRoot -Recurse -Force -ErrorAction Stop
      if (Test-Path -LiteralPath $StagingRoot) { throw "Staging directory still exists after cleanup." }
    } catch {
      $RollbackErrors += "Staging directory cleanup failed: $($_.Exception.Message)"
    }
  }
  if (Test-Path -LiteralPath $InstallSnapshotPath -PathType Leaf) {
    if ($RollbackErrors.Count -eq 0) {
      Remove-Item -LiteralPath $InstallSnapshotPath -Force -ErrorAction SilentlyContinue
    } else {
      [Console]::Error.WriteLine("Previous installation snapshot retained for recovery: $InstallSnapshotPath")
    }
  }
  if ($RollbackErrors.Count -gt 0) {
    foreach ($RollbackError in $RollbackErrors) {
      [Console]::Error.WriteLine("Rollback warning: $RollbackError")
    }
  } else {
    [Console]::Error.WriteLine("Rollback completed.")
  }
  try {
    $FailureReportPath = "$InstallRoot.installation-failure-$UniqueSuffix.json"
    $FailureReport = [ordered]@{
      status = "failed"
      productVersion = $ProductVersion
      installerBuild = $InstallerBuild
      updateNonce = $UpdateNonce
      fixtureOnly = [bool]($TestMode -and $RegistryTestRoot)
      error = $InstallError
      executionContext = $RegistrationExecutionContext
      registryResults = @($RegistryResults)
      registryKeysNotAttempted = @($RegistryPaths | Where-Object { -not $RegistryTouched.ContainsKey($_) })
      rollbackVerified = ($RollbackErrors.Count -eq 0)
      rollbackErrors = @($RollbackErrors)
      installRoot = $InstallRoot
      failedAt = [DateTime]::Now.ToString('o')
    }
    [IO.File]::WriteAllText($FailureReportPath, ($FailureReport | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    [Console]::Error.WriteLine("Failure report: $FailureReportPath")
  } catch {
    [Console]::Error.WriteLine("Failure report could not be written: " + $_.Exception.Message)
  }
  exit 1
}
