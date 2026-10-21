param(
  [string]$RegistryPath = "",
  [string]$ProbeId = "",
  [string]$ExpectedManifestPath = "",
  [string]$ExpectedExePath = "",
  [string]$ExpectedHostName = "",
  [string]$ExpectedExtensionId = "",
  [string]$TreeRoot = "",
  [string]$ExpectedTreeSnapshotPath = "",
  [switch]$VerifyRegistration,
  [switch]$VerifyTree
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$result = [ordered]@{ ok=$false; contextValid=$false; registryPath=$RegistryPath; probeId=$ProbeId; processId=$PID; registryViews=@(); error='' }

function Get-FileSha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $hasher.Dispose()
  }
}

try {
  . (Join-Path $PSScriptRoot 'registration-context.ps1')
  $executionContextEvidence = Get-RegistrationContext -CallerScriptPath $PSCommandPath
  $result.executionContext = $executionContextEvidence
  Assert-RegistrationContext $executionContextEvidence
  if (-not ("AppraisalToolboxRegistrationVerifierWin32" -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class AppraisalToolboxRegistrationVerifierWin32 {
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

    private static string GetPackageName(bool family) {
        uint length = 0;
        int result = family
            ? GetCurrentPackageFamilyName(ref length, null)
            : GetCurrentPackageFullName(ref length, null);
        if (result == APPMODEL_ERROR_NO_PACKAGE) return "";
        if (result != ERROR_INSUFFICIENT_BUFFER && result != ERROR_SUCCESS) throw new Win32Exception(result);
        var value = new StringBuilder((int)Math.Max(length, 1));
        result = family
            ? GetCurrentPackageFamilyName(ref length, value)
            : GetCurrentPackageFullName(ref length, value);
        if (result == APPMODEL_ERROR_NO_PACKAGE) return "";
        if (result != ERROR_SUCCESS) throw new Win32Exception(result);
        return value.ToString();
    }

    public static string GetCurrentPackageFullNameValue() { return GetPackageName(false); }
    public static string GetCurrentPackageFamilyNameValue() { return GetPackageName(true); }

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

  $context = [ordered]@{
    appContainer = [AppraisalToolboxRegistrationVerifierWin32]::IsCurrentTokenAppContainer()
    packageFullName = [AppraisalToolboxRegistrationVerifierWin32]::GetCurrentPackageFullNameValue()
    packageFamilyName = [AppraisalToolboxRegistrationVerifierWin32]::GetCurrentPackageFamilyNameValue()
    processLocalAppData = [string]$env:LOCALAPPDATA
    win32LocalAppData = [AppraisalToolboxRegistrationVerifierWin32]::GetWin32LocalAppData()
  }
  $normalizePath = { param([string]$Path) [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/')) }
  $localAppDataMatches = $false
  if ($context.processLocalAppData -and $context.win32LocalAppData) {
    $localAppDataMatches = (& $normalizePath $context.processLocalAppData) -ieq (& $normalizePath $context.win32LocalAppData)
  }
  $contextValid = (
    -not $context.appContainer -and
    -not $context.packageFullName -and
    -not $context.packageFamilyName -and
    -not $env:APPX_PACKAGE_FAMILY_NAME -and
    $localAppDataMatches -and
    $context.win32LocalAppData -notmatch '\\Packages\\[^\\]+\\(?:LocalCache|LocalState|TempState)\\Local(?:\\|$)'
  )
  if (-not $contextValid) {
    throw "Independent process is running in an AppContainer/MSIX or redirected LocalAppData context."
  }

  $exists = $false
  $defaultValueExists = $false
  $registeredValue = $null
  $valueKind = $null
  if ($RegistryPath) {
    $exists = Test-Path -LiteralPath $RegistryPath
    if ($exists) {
      $key = Get-Item -LiteralPath $RegistryPath
      $defaultValueExists = $key.GetValueNames() -contains ""
      if ($defaultValueExists) {
        $registeredValue = [string]$key.GetValue("", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $valueKind = [string]$key.GetValueKind("")
      }
    }
  }

  $result = [ordered]@{
    ok = $true
    probeId = $ProbeId
    processId = $PID
    process64Bit = [Environment]::Is64BitProcess
    contextValid = $contextValid
    context = $context
    registryPath = $RegistryPath
    exists = $exists
    defaultValueExists = $defaultValueExists
    value = $registeredValue
    valueKind = $valueKind
    manifestExists = $false
    executableExists = $false
    manifestValid = $false
    treeValid = $false
    registryViews = @()
    executionContext = $executionContextEvidence
  }

  if ($RegistryPath) {
    if (-not [Environment]::Is64BitProcess) { throw "Windows x64 verification requires a 64-bit child process." }
    if ($RegistryPath -notmatch '^HKCU:\\(.+)$') { throw "Only an explicit HKCU registry path can be verified." }
    $subkeyPath = $Matches[1]
    # Provider read-back alone can follow a redirected view. Independently query
    # both explicit views through Win32 registry handles and system reg.exe.
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
      $viewKey = $null
      try {
        $viewKey = $base.OpenSubKey($subkeyPath, $false)
        $viewValue = if ($viewKey) { $viewKey.GetValue("", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }
        $viewKind = if ($viewKey -and $viewKey.GetValueNames() -contains "") { [string]$viewKey.GetValueKind("") } else { "" }
        $bits = if ($view -eq [Microsoft.Win32.RegistryView]::Registry64) { "64" } else { "32" }
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = Join-Path $env:WINDIR 'System32\reg.exe'
        $start.Arguments = 'query "HKCU\' + $subkeyPath + '" /ve /reg:' + $bits
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $nativeEncoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
        $start.StandardOutputEncoding = $nativeEncoding
        $start.StandardErrorEncoding = $nativeEncoding
        $regProcess = [Diagnostics.Process]::Start($start)
        try {
          $regPid = $regProcess.Id
          $stdout = $regProcess.StandardOutput.ReadToEndAsync()
          $stderr = $regProcess.StandardError.ReadToEndAsync()
          if (-not $regProcess.WaitForExit(15000)) { $regProcess.Kill(); throw 'External reg.exe query timed out.' }
          $rawOutput = $stdout.Result + $stderr.Result
          $regExit = $regProcess.ExitCode
        } finally { $regProcess.Dispose() }
        $viewResult = [ordered]@{ view = $bits; exists = [bool]$viewKey; value = $viewValue; valueKind = $viewKind; regExeExitCode = $regExit; regExeProcessId=$regPid; regExePath = (Join-Path $env:WINDIR 'System32\reg.exe'); regExeRawOutput = $rawOutput; observedAtUtc = [DateTime]::UtcNow.ToString('o'); scope='same-process-tree-child-not-out-of-tree-witness' }
        $result.registryViews += $viewResult
        if ([bool]$viewKey -ne $exists -or ([string]$viewValue -cne [string]$registeredValue) -or
            ($defaultValueExists -and ($regExit -ne 0 -or $rawOutput -notmatch ('(?m)^\s*[^\r\n]+\s+REG_SZ\s+' + [regex]::Escape([string]$viewValue) + '\s*$'))) -or
            (-not $viewKey -and $regExit -eq 0)) {
          $result.contextValid = $false
          throw "REGISTRATION_VERIFICATION_INVALID: provider/Win32/external reg.exe views disagree: $RegistryPath ($bits)."
        }
        if ($VerifyRegistration -and (-not $viewKey -or $viewKind -ne "String" -or $regExit -ne 0 -or
            ([string]$viewValue -ine $ExpectedManifestPath) -or
            -not ($rawOutput -match [regex]::Escape($ExpectedManifestPath)))) {
          throw "Native Messaging key failed explicit $bits-bit Win32/reg.exe verification: $RegistryPath"
        }
      } finally {
        if ($viewKey) { $viewKey.Dispose() }
        $base.Dispose()
      }
    }
  }
  if ($VerifyRegistration) {
    if (-not $RegistryPath -or -not $exists -or -not $defaultValueExists -or $valueKind -ne "String") {
      throw "Registry key or REG_SZ default value is missing."
    }
    $expectedManifest = [IO.Path]::GetFullPath($ExpectedManifestPath)
    if ([IO.Path]::GetFullPath($registeredValue) -ine $expectedManifest) {
      throw "Registry default value does not match the installed manifest path."
    }
    $result.manifestExists = Test-Path -LiteralPath $expectedManifest -PathType Leaf
    $result.executableExists = Test-Path -LiteralPath $ExpectedExePath -PathType Leaf
    if (-not $result.manifestExists -or -not $result.executableExists) {
      throw "Installed manifest or Native Helper executable is missing."
    }
    $manifest = Get-Content -LiteralPath $expectedManifest -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    $result.manifestSha256 = Get-FileSha256 $expectedManifest
    $result.executableSha256 = Get-FileSha256 $ExpectedExePath
    $allowedOrigin = "chrome-extension://$ExpectedExtensionId/"
    $result.manifestValid = (
      ($manifest.name -ceq $ExpectedHostName) -and
      ([IO.Path]::GetFullPath([string]$manifest.path) -ieq [IO.Path]::GetFullPath($ExpectedExePath)) -and
      ($manifest.type -ceq "stdio") -and
      (@($manifest.allowed_origins).Count -eq 1) -and
      ([string]$manifest.allowed_origins[0] -ceq $allowedOrigin)
    )
    if (-not $result.manifestValid) {
      throw "Native Messaging manifest fields are invalid."
    }
  }

  if ($VerifyTree) {
    if (-not (Test-Path -LiteralPath $TreeRoot -PathType Container) -or
        -not (Test-Path -LiteralPath $ExpectedTreeSnapshotPath -PathType Leaf)) {
      throw "Install tree or its pre-install snapshot is missing."
    }
    $snapshot = Get-Content -LiteralPath $ExpectedTreeSnapshotPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    $expected = @{}
    foreach ($file in @($snapshot.files)) {
      $expected[[string]$file.relativePath] = [string]$file.sha256
    }
    $prefix = (& $normalizePath $TreeRoot) + [IO.Path]::DirectorySeparatorChar
    $actual = @{}
    foreach ($file in (Get-ChildItem -LiteralPath $TreeRoot -Recurse -Force -File -ErrorAction Stop)) {
      $relativePath = $file.FullName.Substring($prefix.Length)
      $actual[$relativePath] = Get-FileSha256 $file.FullName
    }
    $treeValid = ($actual.Count -eq $expected.Count)
    if ($treeValid) {
      foreach ($relativePath in $expected.Keys) {
        if (-not $actual.ContainsKey($relativePath) -or $actual[$relativePath] -cne $expected[$relativePath]) {
          $treeValid = $false
          break
        }
      }
    }
    $result.treeValid = $treeValid
    if (-not $treeValid) {
      throw "Restored install tree file list or SHA-256 values differ from the pre-install snapshot."
    }
  }

  $result | ConvertTo-Json -Depth 8 -Compress
  exit 0
} catch {
  if ($result) { $result.ok = $false; $result.error = $_.Exception.Message; $result | ConvertTo-Json -Depth 8 -Compress }
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
