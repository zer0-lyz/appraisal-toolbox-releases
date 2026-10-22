param([Parameter(Mandatory = $true)][string]$RegistrationContextPath)

$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($RegistrationContextPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ('PowerShell AST parse failed: ' + (($parseErrors | ForEach-Object { $_.Message }) -join '; ')) }

$requiredFunctions = @(
  'Normalize-RegistrationComparablePath',
  'Test-RegistrationPathEqual',
  'Get-CommandScriptPath',
  'Test-CommandHasToken',
  'Test-InstallCmdInvocation',
  'Get-RegistrationInstallCmdPath',
  'Test-RegistrationInstallerRelationship',
  'Test-NativeHostCmdInvocation',
  'Test-NoReparseRegistrationPath',
  'Get-RegistrationPowerShellInvocation',
  'Get-RegistrationRecoveryJournal',
  'Get-RegistrationRecoveryLaunchJournal',
  'Test-RegistrationRecoveryVerifierOptions',
  'Test-NativeMessagingInstallerLaunchRelation'
)
$functionNodes = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true))
foreach ($functionName in $requiredFunctions) {
  $node = $functionNodes | Where-Object { $_.Name -ceq $functionName } | Select-Object -First 1
  if (-not $node) { throw "AST function missing: $functionName" }
  . ([scriptblock]::Create($node.Extent.Text))
}

# This AST fixture loads only the production functions, not the production
# Get-RegistrationContext function that normally initializes this parser type.
if (-not ('AppraisalRegistrationContextToken' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class AppraisalRegistrationContextToken {
  [DllImport("shell32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CommandLineToArgvW(string commandLine, out int argumentCount);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr LocalFree(IntPtr memory);

  public static string[] ParseCommandLine(string commandLine) {
    if (String.IsNullOrWhiteSpace(commandLine)) return new string[0];
    int count;
    IntPtr vector = CommandLineToArgvW(commandLine, out count);
    if (vector == IntPtr.Zero) throw new InvalidOperationException("CommandLineToArgvW failed.");
    try {
      string[] result = new string[count];
      for (int i = 0; i < count; i++) result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(vector, i * IntPtr.Size));
      return result;
    } finally { LocalFree(vector); }
  }
}
"@
}

function New-ProcessRecord([int]$ProcessId, [int]$ParentProcessId, [string]$Name, [string]$Path, [string[]]$Arguments) {
  return [PSCustomObject]@{
    processId = $ProcessId
    parentProcessId = $ParentProcessId
    name = $Name
    executablePath = $Path
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    arguments = @($Arguments)
    argumentsLoaded = $true
  }
}

function New-PowerShellArguments([string]$ScriptPath, [string[]]$TargetArguments = @()) {
  return @('C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe', '-NoProfile', '-NonInteractive',
    '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath) + @($TargetArguments)
}

function New-RecoveryArguments([string]$ScriptPath, [string]$RecoveryJournalPath, [string]$RecoveryNonce, [string]$Root,
    [string[]]$AdditionalArguments = @()) {
  return New-PowerShellArguments $ScriptPath (@('-RecoverUpdateTransaction', '-RecoveryJournalPath', $RecoveryJournalPath,
    '-RecoveryNonce', $RecoveryNonce, '-InstallRoot', $Root) + @($AdditionalArguments))
}

function New-DirectRecoveryChain([string]$ScriptPath, [string[]]$Arguments, [string]$Root, [string]$CallerPath = '',
    [bool]$NativeHostCmdWrapper = $false) {
  if (-not $CallerPath) { $CallerPath = $ScriptPath }
  $hostPath = Join-Path (Join-Path $Root 'native-helper') 'native_host.exe'
  $origin = 'chrome-extension://aamfmhcbjgofhmannejoiilkkpchfkgm/'
  $chain = @(
    (New-ProcessRecord 101 202 'powershell.exe' 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' $Arguments),
    (New-ProcessRecord 202 303 'native_host.exe' $hostPath @($hostPath, $origin))
  )
  $browserIndex = 2
  if ($NativeHostCmdWrapper) {
    $nativeHostCommand = '"' + $hostPath + '" "' + $origin + '"'
    $chain += (New-ProcessRecord 303 404 'cmd.exe' 'C:\Windows\System32\cmd.exe' `
      @('C:\Windows\System32\cmd.exe', '/d', '/s', '/c', $nativeHostCommand))
    $chain += (New-ProcessRecord 404 505 'chrome.exe' 'C:\Program Files\Google\Chrome\Application\chrome.exe' @())
    $browserIndex = 3
  } else {
    $chain += (New-ProcessRecord 303 404 'chrome.exe' 'C:\Program Files\Google\Chrome\Application\chrome.exe' @())
  }
  $context = [PSCustomObject]@{ callerScriptPath = $CallerPath; browserUpdateProof = $null }
  return [PSCustomObject]@{ chain = $chain; context = $context; browserIndex = $browserIndex; hostIndex = 1; hostPath = $hostPath; hostInstallRoot = $Root }
}

function New-RecoveryVerifierChain([string]$PackageRoot, [string]$InstallRoot, [string]$JournalPath, [string]$Nonce,
    [string[]]$VerifierArguments) {
  $installScript = Join-Path $PackageRoot 'install.ps1'
  $verifyScript = Join-Path $PackageRoot 'verify-registration.ps1'
  $hostPath = Join-Path (Join-Path $InstallRoot 'native-helper') 'native_host.exe'
  $recoveryArguments = New-RecoveryArguments $installScript $JournalPath $Nonce $InstallRoot
  $chain = @(
    (New-ProcessRecord 111 222 'powershell.exe' 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' $VerifierArguments),
    (New-ProcessRecord 222 333 'powershell.exe' 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' $recoveryArguments),
    (New-ProcessRecord 333 444 'native_host.exe' $hostPath @($hostPath, 'chrome-extension://aamfmhcbjgofhmannejoiilkkpchfkgm/')),
    (New-ProcessRecord 444 555 'chrome.exe' 'C:\Program Files\Google\Chrome\Application\chrome.exe' @())
  )
  $context = [PSCustomObject]@{ callerScriptPath = $verifyScript; browserUpdateProof = $null }
  return [PSCustomObject]@{ chain = $chain; context = $context; browserIndex = 3; hostIndex = 2; hostPath = $hostPath; hostInstallRoot = $InstallRoot }
}

function Invoke-Relation($Fixture) {
  return [bool](Test-NativeMessagingInstallerLaunchRelation $Fixture.chain $Fixture.browserIndex $Fixture.hostIndex `
    $Fixture.context $Fixture.hostPath 'chrome-extension://aamfmhcbjgofhmannejoiilkkpchfkgm/' $Fixture.hostInstallRoot)
}

$fixtureTempRootPrefix = 'appraisal-update-recovery-context-fixture-'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ($fixtureTempRootPrefix + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
  $packageRoot = Join-Path $tempRoot 'package space [fixture]'
  $installRoot = Join-Path $tempRoot 'AppraisalToolbox'
  $journalRoot = Join-Path (Split-Path -Parent $installRoot) '.AppraisalToolbox-updates'
  $runRoot = Join-Path $journalRoot 'run-fixture'
  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
  $journalPath = Join-Path $runRoot 'update-transaction.json'
  $nonce = [Guid]::NewGuid().ToString()
  $installSnapshotPath = Join-Path $tempRoot 'AppraisalToolbox-install-snapshot-fixture.json'
  $extensionSnapshotPath = Join-Path $tempRoot 'AppraisalToolbox-extension-snapshot-fixture.json'
  $backupRoot = Join-Path $tempRoot 'AppraisalToolbox.previous-fixture'
  $extensionLoadPath = Join-Path $installRoot 'extension'
  $extensionBackup = $extensionLoadPath + '.previous-fixture'
  $journal = [ordered]@{
    schemaVersion = 2
    nonce = $nonce
    installRoot = $installRoot
    installSnapshotPath = $installSnapshotPath
    extensionSnapshotPath = $extensionSnapshotPath
    backupRoot = $backupRoot
    extensionLoadPath = $extensionLoadPath
    extensionBackup = $extensionBackup
  }
  [IO.File]::WriteAllText($journalPath, ($journal | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  $env:TB_UPDATE_JOURNAL_PATH = $journalPath
  $env:TB_UPDATE_NONCE = $nonce
  $env:TB_UPDATE_INSTALL_ROOT = $installRoot

  $results = [ordered]@{ accepts = [ordered]@{}; rejects = [ordered]@{}; fixtureOnly = $true; astParse = 'passed' }

  $wrapperPath = Join-Path $packageRoot 'install.cmd'
  $installScript = Join-Path $packageRoot 'install.ps1'
  $wrapperChain = @(
    (New-ProcessRecord 11 12 'powershell.exe' 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' (New-PowerShellArguments $installScript)),
    (New-ProcessRecord 12 13 'cmd.exe' 'C:\Windows\System32\cmd.exe' @('C:\Windows\System32\cmd.exe', '/d', '/c', $wrapperPath)),
    (New-ProcessRecord 13 14 'native_host.exe' (Join-Path (Join-Path $installRoot 'native-helper') 'native_host.exe') @()),
    (New-ProcessRecord 14 15 'chrome.exe' 'C:\Program Files\Google\Chrome\Application\chrome.exe' @())
  )
  $wrapperContext = [PSCustomObject]@{ callerScriptPath = $installScript; browserUpdateProof = $null }
  $wrapperFixture = [PSCustomObject]@{ chain = $wrapperChain; context = $wrapperContext; browserIndex = 3; hostIndex = 2; hostPath = $wrapperChain[2].executablePath; hostInstallRoot = $installRoot }
  $results.accepts.normalInstallWrapper = Invoke-Relation $wrapperFixture

  $recoveryScript = Join-Path $packageRoot 'install.ps1'
  $directArgs = New-RecoveryArguments $recoveryScript $journalPath $nonce $installRoot
  $direct = New-DirectRecoveryChain $recoveryScript $directArgs $installRoot
  $results.accepts.directRecovery = Invoke-Relation $direct

  $wrappedDirect = New-DirectRecoveryChain $recoveryScript $directArgs $installRoot '' $true
  $results.accepts.directRecoveryWithNativeHostCmdWrapper = Invoke-Relation $wrappedDirect
  $wrappedDirectWrongParent = New-DirectRecoveryChain $recoveryScript $directArgs $installRoot '' $true
  $wrappedDirectWrongParent.chain[2].parentProcessId = 999
  $results.rejects.nativeHostCmdWrapperWrongBrowserParent = -not (Invoke-Relation $wrappedDirectWrongParent)

  $badFile = New-RecoveryArguments (Join-Path $packageRoot 'other.ps1') $journalPath $nonce $installRoot
  $results.rejects.wrongFile = -not (Invoke-Relation (New-DirectRecoveryChain $recoveryScript $badFile $installRoot))
  $badFlags = New-RecoveryArguments $recoveryScript $journalPath $nonce $installRoot @('-ArbitraryFlag')
  $results.rejects.wrongFlags = -not (Invoke-Relation (New-DirectRecoveryChain $recoveryScript $badFlags $installRoot))
  $badNonce = New-RecoveryArguments $recoveryScript $journalPath ([Guid]::NewGuid().ToString()) $installRoot
  $results.rejects.wrongNonce = -not (Invoke-Relation (New-DirectRecoveryChain $recoveryScript $badNonce $installRoot))
  $otherJournal = Join-Path $runRoot 'other-transaction.json'
  [IO.File]::WriteAllText($otherJournal, [IO.File]::ReadAllText($journalPath), [Text.UTF8Encoding]::new($false))
  $badJournal = New-RecoveryArguments $recoveryScript $otherJournal $nonce $installRoot
  $results.rejects.wrongJournal = -not (Invoke-Relation (New-DirectRecoveryChain $recoveryScript $badJournal $installRoot))
  $badRoot = New-RecoveryArguments $recoveryScript $journalPath $nonce (Join-Path $tempRoot 'other-install-root')
  $results.rejects.wrongRoot = -not (Invoke-Relation (New-DirectRecoveryChain $recoveryScript $badRoot $installRoot))
  $badParent = New-DirectRecoveryChain $recoveryScript $directArgs $installRoot
  $badParent.chain[0].parentProcessId = 999
  $results.rejects.wrongParentChild = -not (Invoke-Relation $badParent)

  $ordinaryArgs = New-PowerShellArguments $recoveryScript
  $results.rejects.ordinaryPowerShell = -not (Invoke-Relation (New-DirectRecoveryChain $recoveryScript $ordinaryArgs $installRoot))
  $extraAncestor = New-DirectRecoveryChain $recoveryScript $directArgs $installRoot
  $extraAncestor.chain = @(
    $extraAncestor.chain[0],
    (New-ProcessRecord 202 303 'powershell.exe' 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' (New-PowerShellArguments (Join-Path $packageRoot 'unrelated.ps1'))),
    $extraAncestor.chain[1],
    $extraAncestor.chain[2]
  )
  $extraAncestor.chain[0].parentProcessId = 202
  $extraAncestor.browserIndex = 3
  $extraAncestor.hostIndex = 2
  $results.rejects.arbitraryAncestor = -not (Invoke-Relation $extraAncestor)

  $verifyScript = Join-Path $packageRoot 'verify-registration.ps1'
  $verifyTreeArgs = New-PowerShellArguments $verifyScript @('-TreeRoot', $backupRoot, '-ExpectedTreeSnapshotPath', $installSnapshotPath, '-VerifyTree')
  $verifyTree = New-RecoveryVerifierChain $packageRoot $installRoot $journalPath $nonce $verifyTreeArgs
  $results.accepts.verifyTreeChild = Invoke-Relation $verifyTree
  $verifyRegistryArgs = New-PowerShellArguments $verifyScript @('-RegistryPath', 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.appraisal.toolbox.helper')
  $results.accepts.verifyRegistryChild = Invoke-Relation (New-RecoveryVerifierChain $packageRoot $installRoot $journalPath $nonce $verifyRegistryArgs)
  $arbitraryRegistryArgs = New-PowerShellArguments $verifyScript @('-RegistryPath', 'HKCU:\Software\Arbitrary\NativeMessagingHosts\com.appraisal.toolbox.helper')
  $results.rejects.arbitraryRegistrationKey = -not (Invoke-Relation (New-RecoveryVerifierChain $packageRoot $installRoot $journalPath $nonce $arbitraryRegistryArgs))
  $wrongTreeArgs = New-PowerShellArguments $verifyScript @('-TreeRoot', (Join-Path $tempRoot 'arbitrary-tree'), '-ExpectedTreeSnapshotPath', $installSnapshotPath, '-VerifyTree')
  $results.rejects.arbitraryTree = -not (Invoke-Relation (New-RecoveryVerifierChain $packageRoot $installRoot $journalPath $nonce $wrongTreeArgs))
  $wrongSnapshotArgs = New-PowerShellArguments $verifyScript @('-TreeRoot', $backupRoot, '-ExpectedTreeSnapshotPath', (Join-Path $tempRoot 'arbitrary-snapshot.json'), '-VerifyTree')
  $results.rejects.arbitrarySnapshot = -not (Invoke-Relation (New-RecoveryVerifierChain $packageRoot $installRoot $journalPath $nonce $wrongSnapshotArgs))
  $otherPackageRoot = Join-Path $tempRoot 'other package'
  New-Item -ItemType Directory -Path $otherPackageRoot | Out-Null
  $otherVerifyScript = Join-Path $otherPackageRoot 'verify-registration.ps1'
  $wrongPackageArgs = New-PowerShellArguments $otherVerifyScript @('-RegistryPath', 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.appraisal.toolbox.helper')
  $wrongPackage = New-RecoveryVerifierChain $packageRoot $installRoot $journalPath $nonce $wrongPackageArgs
  $wrongPackage.context.callerScriptPath = $otherVerifyScript
  $results.rejects.differentPackageVerifier = -not (Invoke-Relation $wrongPackage)
  $verifierWrongParent = New-RecoveryVerifierChain $packageRoot $installRoot $journalPath $nonce $verifyRegistryArgs
  $verifierWrongParent.chain[0].parentProcessId = 999
  $results.rejects.verifierParentChild = -not (Invoke-Relation $verifierWrongParent)
  $verifierExtraAncestor = New-RecoveryVerifierChain $packageRoot $installRoot $journalPath $nonce $verifyRegistryArgs
  $verifierExtraAncestor.chain = @(
    $verifierExtraAncestor.chain[0],
    (New-ProcessRecord 222 333 'powershell.exe' 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' (New-PowerShellArguments (Join-Path $packageRoot 'unrelated.ps1'))),
    $verifierExtraAncestor.chain[1], $verifierExtraAncestor.chain[2], $verifierExtraAncestor.chain[3]
  )
  $verifierExtraAncestor.chain[0].parentProcessId = 222
  $verifierExtraAncestor.chain[1].parentProcessId = 333
  $verifierExtraAncestor.browserIndex = 4
  $verifierExtraAncestor.hostIndex = 3
  $results.rejects.verifierArbitraryAncestor = -not (Invoke-Relation $verifierExtraAncestor)

  $originalJournalText = [IO.File]::ReadAllText($journalPath)
  $badJournalNonce = $journal | ConvertTo-Json -Depth 6 | ConvertFrom-Json
  $badJournalNonce.nonce = [Guid]::NewGuid().ToString()
  [IO.File]::WriteAllText($journalPath, ($badJournalNonce | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  $results.rejects.journalNonceMismatch = -not (Invoke-Relation $direct)
  $badJournalRoot = $journal | ConvertTo-Json -Depth 6 | ConvertFrom-Json
  $badJournalRoot.installRoot = Join-Path $tempRoot 'other-journal-root'
  [IO.File]::WriteAllText($journalPath, ($badJournalRoot | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  $results.rejects.journalRootMismatch = -not (Invoke-Relation $direct)
  [IO.File]::WriteAllText($journalPath, $originalJournalText, [Text.UTF8Encoding]::new($false))

  $falseAccepts = @($results.accepts.Keys | Where-Object { -not $results.accepts[$_] })
  $falseRejects = @($results.rejects.Keys | Where-Object { -not $results.rejects[$_] })
  if ($falseAccepts.Count -or $falseRejects.Count) {
    throw ('Fixture assertions failed. Unexpected accepts: ' + ($falseAccepts -join ', ') + '; unexpected rejections: ' + ($falseRejects -join ', '))
  }
  [PSCustomObject]$results | ConvertTo-Json -Depth 8 -Compress
} finally {
  $fixtureRootFullPath = [IO.Path]::GetFullPath($tempRoot)
  $fixtureRootParentPath = [IO.Directory]::GetParent($fixtureRootFullPath).FullName
  $fixtureRootLeaf = [IO.DirectoryInfo]::new($fixtureRootFullPath).Name
  $systemTempRootFullPath = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not (Test-RegistrationPathEqual $fixtureRootParentPath $systemTempRootFullPath)) {
    throw 'Refusing fixture cleanup: temp root parent is not the canonical system temp directory.'
  }
  if (-not $fixtureRootLeaf.StartsWith($fixtureTempRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing fixture cleanup: temp root does not have the dedicated fixture prefix.'
  }
  $fixtureRootItem = Get-Item -LiteralPath $fixtureRootFullPath -Force
  if (($fixtureRootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Refusing fixture cleanup: temp root is a reparse point.'
  }
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
