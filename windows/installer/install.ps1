param(
  [string]$InstallRoot = "",
  [string]$RegistryTestRoot = ""
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
$InstallerBuild = "windows-context-attested.6"
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
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHGetKnownFolderPath(ref Guid folderId, uint flags, IntPtr token, out IntPtr path);

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

try {
  Write-Host "[0/7] Checking ordinary Windows user context"
  . (Join-Path $PackageRoot 'registration-context.ps1')
  $RegistrationExecutionContext = Get-RegistrationContext
  Assert-RegistrationContext $RegistrationExecutionContext
  $InstallContext = Assert-OrdinaryUserContext
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

  Write-Host "[3/7] Writing runtime configuration"
  $RuntimeConfig = [ordered]@{
    pythonBin = Join-Path $InstallRoot "runtime\python-portable\python.exe"
    printSkillsDir = Join-Path $InstallRoot "skills"
    depreciationSkillDir = Join-Path $InstallRoot "skills\depreciation-capex-forecast"
    toolboxExtensionId = $ExtensionId
    nativeHostName = $HostName
  }
  [IO.File]::WriteAllText(
    (Join-Path $StagingRoot "native-helper\runtime-config.json"),
    ($RuntimeConfig | ConvertTo-Json -Depth 5),
    [Text.UTF8Encoding]::new($false)
  )

  Write-Host "[4/7] Installing atomically"
  if (Test-Path -LiteralPath $InstallRoot) {
    Save-InstallTreeSnapshot $InstallRoot $InstallSnapshotPath
    Move-Item -LiteralPath $InstallRoot -Destination $BackupRoot
    $MovedExistingRoot = $true
  }
  Move-Item -LiteralPath $StagingRoot -Destination $InstallRoot
  $InstalledNewRoot = $true

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
    "extensionPath=$(Join-Path $InstallRoot 'extension')",
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
  Write-Host (Join-Path $InstallRoot "extension")
  Write-Host "Expected extension ID: $ExtensionId"
  exit 0
}
catch {
  $InstallError = $_.Exception.Message
  [Console]::Error.WriteLine("Installation failed: " + $InstallError)
  $RollbackErrors = @()
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
    Remove-Item -LiteralPath $InstallSnapshotPath -Force -ErrorAction SilentlyContinue
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
