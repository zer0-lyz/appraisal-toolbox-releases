# Read-only context attestation. A browser update boundary permits the installer
# to run from a verified Native Messaging request; it is not an independent
# desktop witness. All child verifiers rebuild this same live process chain.
function Get-RegistrationContextPolicyReasons($Context) {
  $reasons = @()
  if ($Context.appContainer -or $Context.tokenRestricted -or $Context.virtualizationEnabled -or
      $Context.packageFullName -or $Context.appxEnvironment) {
    $reasons += 'restricted-token-or-AppContainer/MSIX-or-virtualization'
  }
  if (-not $Context.process64Bit -or $Context.sessionId -eq 0) { $reasons += 'not-interactive-x64-session' }
  $normalize = { param($p) [IO.Path]::GetFullPath([string]$p).TrimEnd([char[]]@('\', '/')) }
  if (-not $Context.processLocalAppData -or -not $Context.win32LocalAppData -or -not $Context.profileLocalAppData -or
      (& $normalize $Context.processLocalAppData) -ine (& $normalize $Context.win32LocalAppData) -or
      (& $normalize $Context.profileLocalAppData) -ine (& $normalize $Context.win32LocalAppData) -or
      $Context.win32LocalAppData -match '\\Packages\\') { $reasons += 'LocalAppData-view-mismatch' }

  $chain = @($Context.parentChain)
  foreach ($ancestor in $chain) {
    if ($ancestor.userSid -and $ancestor.userSid -cne $Context.userSid) { $reasons += 'process-sid-session-mismatch' }
    if ($null -ne $ancestor.sessionId -and [int]$ancestor.sessionId -ne [int]$Context.sessionId) { $reasons += 'process-sid-session-mismatch' }
    if ($ancestor.appContainer -or $ancestor.tokenRestricted -or $ancestor.virtualizationEnabled -or $ancestor.packageFullName) {
      $reasons += 'restricted-ancestor-token-or-AppContainer/MSIX'
    }
    if ($ancestor.executablePath -match '\\WindowsApps\\|\\Packages\\' -or
        $ancestor.name -match '^(codex|codex-sandbox|codex-exec|ChatGPT|zcode)\.exe$') {
      $reasons += 'packaged-or-agent-ancestor-not-independent-desktop'
    }
  }

  if ($Context.boundaryType -eq 'browser-native-messaging-update') {
    if ($Context.browserBoundaryOuterParentState -notin @('verified-desktop', 'pid-reused')) {
      $reasons += 'browser-boundary-parent-chain-unverified'
    }
    if (-not (Test-RegistrationBrowserUpdateProofComplete $Context)) {
      $reasons += 'browser-update-boundary-evidence-incomplete'
    }
    if (-not $Context.nativeMessagingBrowserBoundaryAttested) {
      $reasons += 'browser-update-boundary-unattested'
    }
  } elseif (-not $Context.desktopBoundaryAttested) {
    $reasons += 'desktop-boundary-unattested'
  }
  return @($reasons | Select-Object -Unique)
}

function Test-RegistrationBrowserUpdateProofComplete($Context) {
  $proof = $Context.browserUpdateProof
  $outerBoundaryVerified = $Context.browserBoundaryOuterParentState -in @('verified-desktop', 'pid-reused')
  return [bool]($proof -and $proof.browserImageTrusted -and
    $proof.nativeHostOriginVerified -and $proof.nativeHostPathRootVerified -and
    $proof.installedManifestVerified -and $proof.extensionIdentityVerified -and
    $proof.updateEnvironmentMatchesInstalledRoot -and $proof.installerLaunchRelationVerified -and
    $Context.executableChainValidated -and $outerBoundaryVerified)
}

function Get-RegistrationParentPidReuseReason([DateTime]$ChildCreatedUtc, [DateTime]$ParentCreatedUtc, [bool]$BrowserBoundaryReached) {
  if ($ParentCreatedUtc -le $ChildCreatedUtc) { return '' }
  if ($BrowserBoundaryReached) { return 'browser-boundary-parent-pid-reused' }
  return 'parent-pid-reused'
}

function Normalize-RegistrationComparablePath([string]$Path) {
  if (-not $Path) { return '' }
  return [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
}

function Test-RegistrationPathEqual([string]$Left, [string]$Right) {
  try { return (Normalize-RegistrationComparablePath $Left) -ieq (Normalize-RegistrationComparablePath $Right) }
  catch { return $false }
}

function Convert-RegistrationCimCreationDateToUtc($Value) {
  if ($null -eq $Value) { throw 'process-creation-time-unavailable' }
  if ($Value -is [DateTime]) { return ([DateTime]$Value).ToUniversalTime() }
  $text = [string]$Value
  if ($text -match '^\d{14}\.\d{6}[+-]\d{3}$') {
    return [Management.ManagementDateTimeConverter]::ToDateTime($text).ToUniversalTime()
  }
  return ([DateTime]::Parse($text, [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind)).ToUniversalTime()
}

function Get-RegistrationProcessArguments($Process) {
  if (-not $Process) { throw 'process-record-unavailable' }
  $pidValue = [int]$Process.processId
  $native = [AppraisalRegistrationContextToken]::ReadProcess($pidValue)
  $wmi = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$pidValue" `
    -Property @('ProcessId','ParentProcessId','ExecutablePath','CreationDate','CommandLine') -ErrorAction Stop
  if (-not $wmi -or [int]$wmi.ProcessId -ne $pidValue -or
      [int]$wmi.ParentProcessId -ne [int]$Process.parentProcessId -or
      -not (Test-RegistrationPathEqual ([string]$wmi.ExecutablePath) $native.ImagePath) -or
      -not (Test-RegistrationPathEqual ([string]$Process.executablePath) $native.ImagePath) -or
      [Math]::Abs(((Convert-RegistrationCimCreationDateToUtc $wmi.CreationDate) - $native.CreatedUtc).TotalSeconds) -gt 1 -or
      [Math]::Abs(([DateTime]::Parse([string]$Process.createdAtUtc, [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() - $native.CreatedUtc).TotalSeconds) -gt 1) {
    throw 'process-snapshot-race-or-pid-reused'
  }
  return @([AppraisalRegistrationContextToken]::ParseCommandLine([string]$wmi.CommandLine))
}

function Get-CommandScriptPath([string[]]$Arguments) {
  for ($i = 0; $i -lt $Arguments.Count - 1; $i++) {
    if ($Arguments[$i] -match '^(?:-file|/file)$') { return [string]$Arguments[$i + 1] }
  }
  return ''
}

function Test-CommandHasToken([string[]]$Arguments, [string]$Token) {
  foreach ($argument in $Arguments) {
    if ([string]$argument -ieq $Token) { return $true }
  }
  return $false
}

function Test-InstallCmdInvocation($Process) {
  if (-not $Process -or $Process.name -ine 'cmd.exe') { return $false }
  $args = @($Process.arguments)
  if (-not (Test-CommandHasToken $args '/c')) { return $false }
  foreach ($argument in $args) {
    $candidate = ([string]$argument).Trim('"')
    if ([IO.Path]::GetFileName($candidate) -ieq 'install.cmd') { return $true }
  }
  return $false
}

function Get-RegistrationInstallCmdPath($Process, [string]$CallerScriptPath) {
  if (-not (Test-InstallCmdInvocation $Process)) { return '' }
  $arguments = @($Process.arguments)
  $cIndex = -1
  for ($i = 0; $i -lt $arguments.Count; $i++) {
    if ([string]$arguments[$i] -ieq '/c') { $cIndex = $i; break }
  }
  if ($cIndex -lt 0 -or $cIndex -ge ($arguments.Count - 1)) { return '' }
  $paths = @()
  foreach ($argument in @($arguments | Select-Object -Skip ($cIndex + 1))) {
    $candidate = ([string]$argument).Trim('"')
    if ([IO.Path]::GetFileName($candidate) -ine 'install.cmd') { continue }
    try {
      if ([IO.Path]::IsPathRooted($candidate)) { $paths += [IO.Path]::GetFullPath($candidate) }
      elseif ($candidate -in @('install.cmd', '.\install.cmd')) {
        if (-not $CallerScriptPath -or -not [IO.Path]::IsPathRooted($CallerScriptPath)) { return '' }
        $paths += [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $CallerScriptPath) 'install.cmd'))
      } else { return '' }
    } catch { return '' }
  }
  if ($paths.Count -ne 1) { return '' }
  return [string]$paths[0]
}

function Test-RegistrationNativeHostOrigin([string[]]$Arguments, [string]$ExpectedOrigin) {
  if ($Arguments.Count -ne 2) { return $false }
  return [string]$Arguments[1] -ceq $ExpectedOrigin
}

function Test-RegistrationBrowserImage([string]$BrowserKind, [string]$ImagePath,
    [string]$ProgramFiles, [string]$ProgramFilesX86, [string]$LocalAppData,
    [string]$SignatureStatus, [string]$SignerSubject) {
  if ($BrowserKind -notin @('chrome', 'edge')) { return $false }
  if ($BrowserKind -eq 'chrome') {
    $expectedPaths = @(
      (Join-Path $ProgramFiles 'Google\Chrome\Application\chrome.exe'),
      (Join-Path $ProgramFilesX86 'Google\Chrome\Application\chrome.exe'),
      (Join-Path $LocalAppData 'Google\Chrome\Application\chrome.exe')
    )
    $publisherMatch = $SignerSubject -match '^CN=Google LLC(?:,|$)'
  } else {
    $expectedPaths = @(
      (Join-Path $ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
      (Join-Path $ProgramFilesX86 'Microsoft\Edge\Application\msedge.exe'),
      (Join-Path $LocalAppData 'Microsoft\Edge\Application\msedge.exe')
    )
    $publisherMatch = $SignerSubject -match '^CN=Microsoft Corporation(?:,|$)'
  }
  $pathMatch = $false
  foreach ($expectedPath in $expectedPaths) {
    if ($expectedPath -and (Test-RegistrationPathEqual $ImagePath $expectedPath)) { $pathMatch = $true; break }
  }
  return $pathMatch -and $SignatureStatus -ceq 'Valid' -and $publisherMatch
}

function Test-RegistrationNativeHostIdentity([string]$ExpectedHostId, [string]$RegisteredHostId,
    [string]$ExpectedHostPath, [string]$RegisteredHostPath, [string[]]$AllowedOrigins,
    [string]$ExpectedOrigin, [string]$ExpectedExtensionId, [string]$ManifestExtensionId) {
  if ($ExpectedHostId -cne 'com.appraisal.toolbox.helper' -or $RegisteredHostId -cne $ExpectedHostId) { return $false }
  if (-not (Test-RegistrationPathEqual $ExpectedHostPath $RegisteredHostPath)) { return $false }
  if ($AllowedOrigins.Count -ne 1 -or $AllowedOrigins[0] -cne $ExpectedOrigin) { return $false }
  if ($ExpectedExtensionId -cne 'aamfmhcbjgofhmannejoiilkkpchfkgm' -or $ManifestExtensionId -cne $ExpectedExtensionId) { return $false }
  return $true
}

function Test-RegistrationInstallerRelationship([string]$CallerScriptPath,
    [string]$InstallerCommandLinePath, [string]$ObservedWrapperPath,
    [string]$ExpectedWrapperPath, [bool]$HostBrowserLink) {
  if (-not $CallerScriptPath -or -not $InstallerCommandLinePath -or -not $ObservedWrapperPath -or -not $ExpectedWrapperPath) { return $false }
  $callerName = [IO.Path]::GetFileName($CallerScriptPath)
  if ($callerName -notin @('install.ps1', 'verify-registration.ps1')) { return $false }
  $scriptRoot = Split-Path -Parent ([IO.Path]::GetFullPath($CallerScriptPath))
  $installerPath = Join-Path $scriptRoot 'install.ps1'
  $expectedInstallerPath = Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($ExpectedWrapperPath))) 'install.ps1'
  return $HostBrowserLink -and
    (Test-RegistrationPathEqual $InstallerCommandLinePath $installerPath) -and
    (Test-RegistrationPathEqual $InstallerCommandLinePath $expectedInstallerPath) -and
    (Test-RegistrationPathEqual $ObservedWrapperPath $ExpectedWrapperPath) -and
    (Test-RegistrationPathEqual (Split-Path -Parent ([IO.Path]::GetFullPath($CallerScriptPath))) (Split-Path -Parent ([IO.Path]::GetFullPath($ExpectedWrapperPath))))
}

function Test-NativeHostCmdInvocation($Process, [string]$HostPath, [string]$Origin) {
  if (-not $Process -or $Process.name -ine 'cmd.exe') { return $false }
  $args = @($Process.arguments)
  $cIndex = -1
  for ($i = 0; $i -lt $args.Count; $i++) {
    if ($args[$i] -ieq '/c') { $cIndex = $i; break }
  }
  if ($cIndex -lt 0 -or $cIndex -ge ($args.Count - 1)) { return $false }
  $nestedCommand = (@($args | Select-Object -Skip ($cIndex + 1)) -join ' ')
  try { $nested = @([AppraisalRegistrationContextToken]::ParseCommandLine($nestedCommand)) }
  catch { return $false }
  $hasHost = $false
  $hasOrigin = $false
  foreach ($argument in $nested) {
    if ([string]$argument -ieq $HostPath) { $hasHost = $true }
    if ([string]$argument -ceq $Origin) { $hasOrigin = $true }
  }
  return ($hasHost -and $hasOrigin -and $nested.Count -eq 2 -and
    (Test-RegistrationPathEqual ([string]$nested[0]) $HostPath) -and [string]$nested[1] -ceq $Origin)
}

function Get-RegistrationPowerShellInvocation($Process, [string]$ExpectedScriptPath) {
  if (-not $Process -or -not $Process.argumentsLoaded -or
      $Process.name -notmatch '^(?:powershell|pwsh)(?:_ise)?\.exe$') { return $null }
  $arguments = @($Process.arguments)
  if ($arguments.Count -lt 2 -or
      [IO.Path]::GetFileName(([string]$arguments[0]).Trim('"')) -ine [string]$Process.name) { return $null }

  $seen = @{}
  $options = @{}
  $hasNoProfile = $false
  $hasNonInteractive = $false
  $hasExecutionPolicy = $false
  $scriptPath = ''
  for ($i = 1; $i -lt $arguments.Count; $i++) {
    $argument = [string]$arguments[$i]
    $name = $argument.ToLowerInvariant()
    if ($seen.ContainsKey($name)) { return $null }
    $seen[$name] = $true
    switch ($name) {
      '-noprofile' { $hasNoProfile = $true; continue }
      '-noninteractive' { $hasNonInteractive = $true; continue }
      '-executionpolicy' {
        if ($i + 1 -ge $arguments.Count -or [string]$arguments[$i + 1] -ine 'Bypass') { return $null }
        $hasExecutionPolicy = $true
        $i++
        continue
      }
      '-file' {
        if ($i + 1 -ge $arguments.Count) { return $null }
        $scriptPath = [string]$arguments[$i + 1]
        $i++
        continue
      }
      { $_ -in @('-recoverupdatetransaction', '-verifytree') } {
        $options[$name] = $true
        continue
      }
      { $_ -in @('-recoveryjournalpath', '-recoverynonce', '-installroot', '-treeroot', '-expectedtreesnapshotpath', '-registrypath') } {
        if ($i + 1 -ge $arguments.Count) { return $null }
        $value = [string]$arguments[$i + 1]
        if (-not $value -or $value.StartsWith('-') -or $value.StartsWith('/')) { return $null }
        $options[$name] = $value
        $i++
        continue
      }
      default { return $null }
    }
  }
  if (-not $hasNoProfile -or -not $hasNonInteractive -or -not $hasExecutionPolicy -or
      -not $scriptPath -or -not (Test-RegistrationPathEqual $scriptPath $ExpectedScriptPath)) { return $null }
  return [PSCustomObject]@{ scriptPath = $scriptPath; options = $options }
}

function Get-RegistrationRecoveryJournal([string]$JournalPath, [string]$Nonce, [string]$InstallRoot) {
  try {
    if ($Nonce -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' -or
        -not [IO.Path]::IsPathRooted($JournalPath) -or -not [IO.Path]::IsPathRooted($InstallRoot)) { return $null }
    $resolvedJournalPath = [IO.Path]::GetFullPath($JournalPath)
    $journalDirectory = Split-Path -Parent $resolvedJournalPath
    $updatesRoot = Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($InstallRoot))) '.AppraisalToolbox-updates'
    if ([IO.Path]::GetFileName($resolvedJournalPath) -cne 'update-transaction.json' -or
        -not (Split-Path -Leaf $journalDirectory).StartsWith('run-', [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-RegistrationPathEqual (Split-Path -Parent $journalDirectory) $updatesRoot) -or
        -not (Test-NoReparseRegistrationPath $resolvedJournalPath)) { return $null }
    $item = Get-Item -LiteralPath $resolvedJournalPath -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $null }
    $journal = Get-Content -LiteralPath $resolvedJournalPath -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ([int]$journal.schemaVersion -ne 2 -or [string]$journal.nonce -cne $Nonce -or
        -not (Test-RegistrationPathEqual ([string]$journal.installRoot) $InstallRoot)) { return $null }
    return $journal
  } catch { return $null }
}

function Get-RegistrationRecoveryLaunchJournal($Process, [string]$ExpectedScriptPath, [string]$HostInstallRoot) {
  $invocation = Get-RegistrationPowerShellInvocation $Process $ExpectedScriptPath
  if (-not $invocation) { return $null }
  $options = $invocation.options
  if ($options.Count -ne 4 -or -not $options.ContainsKey('-recoverupdatetransaction') -or
      -not $options.ContainsKey('-recoveryjournalpath') -or -not $options.ContainsKey('-recoverynonce') -or
      -not $options.ContainsKey('-installroot')) { return $null }
  $journalPath = [string]$options['-recoveryjournalpath']
  $nonce = [string]$options['-recoverynonce']
  $installRoot = [string]$options['-installroot']
  $environmentJournalPath = [string][Environment]::GetEnvironmentVariable('TB_UPDATE_JOURNAL_PATH', 'Process')
  $environmentNonce = [string][Environment]::GetEnvironmentVariable('TB_UPDATE_NONCE', 'Process')
  $environmentInstallRoot = [string][Environment]::GetEnvironmentVariable('TB_UPDATE_INSTALL_ROOT', 'Process')
  if ($nonce -cne $environmentNonce -or
      -not (Test-RegistrationPathEqual $journalPath $environmentJournalPath) -or
      -not (Test-RegistrationPathEqual $installRoot $environmentInstallRoot) -or
      -not (Test-RegistrationPathEqual $installRoot $HostInstallRoot)) { return $null }
  return Get-RegistrationRecoveryJournal $journalPath $nonce $installRoot
}

function Test-RegistrationRecoveryVerifierOptions($Options, $Journal) {
  if (-not $Options -or -not $Journal) { return $false }
  if ($Options.Count -eq 1 -and $Options.ContainsKey('-registrypath')) {
    return [string]$Options['-registrypath'] -ceq 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.appraisal.toolbox.helper' -or
      [string]$Options['-registrypath'] -ceq 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.appraisal.toolbox.helper'
  }
  if ($Options.Count -ne 3 -or -not $Options.ContainsKey('-verifytree') -or
      -not $Options.ContainsKey('-treeroot') -or -not $Options.ContainsKey('-expectedtreesnapshotpath')) { return $false }
  $treeRoot = [string]$Options['-treeroot']
  $snapshotPath = [string]$Options['-expectedtreesnapshotpath']
  $installSnapshotMatch = [string]$Journal.installSnapshotPath -and
    (Test-RegistrationPathEqual $snapshotPath ([string]$Journal.installSnapshotPath)) -and
    ((Test-RegistrationPathEqual $treeRoot ([string]$Journal.installRoot)) -or
      (Test-RegistrationPathEqual $treeRoot ([string]$Journal.backupRoot)))
  $extensionSnapshotMatch = [string]$Journal.extensionSnapshotPath -and
    (Test-RegistrationPathEqual $snapshotPath ([string]$Journal.extensionSnapshotPath)) -and
    ((Test-RegistrationPathEqual $treeRoot ([string]$Journal.extensionLoadPath)) -or
      ($Journal.extensionBackup -and (Test-RegistrationPathEqual $treeRoot ([string]$Journal.extensionBackup))))
  return $installSnapshotMatch -or $extensionSnapshotMatch
}

function Test-NativeMessagingInstallerLaunchRelation($Chain, [int]$BrowserIndex, [int]$HostIndex,
    $Context, [string]$HostPath, [string]$Origin, [string]$HostInstallRoot) {
  if (-not $Chain -or $BrowserIndex -lt 0 -or $HostIndex -lt 0 -or
      $BrowserIndex -ge $Chain.Count -or $HostIndex -ge $Chain.Count -or
      $BrowserIndex -le $HostIndex -or $HostIndex -le 0 -or -not $Context.callerScriptPath -or
      -not $Chain[0].argumentsLoaded -or $Chain[0].name -notmatch '^(?:powershell|pwsh)(?:_ise)?\.exe$') { return $false }

  $hostBrowserLink = $false
  $nativeHostRecord = $Chain[$HostIndex]
  $browser = $Chain[$BrowserIndex]
  if ($BrowserIndex -eq ($HostIndex + 1) -and $nativeHostRecord.parentProcessId -eq $browser.processId) {
    $hostBrowserLink = $true
  } elseif ($BrowserIndex -eq ($HostIndex + 2) -and
      $Chain[$HostIndex + 1].name -ieq 'cmd.exe' -and
      $nativeHostRecord.parentProcessId -eq $Chain[$HostIndex + 1].processId -and
      $Chain[$HostIndex + 1].parentProcessId -eq $browser.processId -and
      (Test-NativeHostCmdInvocation $Chain[$HostIndex + 1] $HostPath $Origin)) {
    $hostBrowserLink = $true
  }
  if (-not $hostBrowserLink) { return $false }

  $callerPath = [string]$Context.callerScriptPath
  $callerCommandPath = Get-CommandScriptPath @($Chain[0].arguments)
  if (-not $callerCommandPath -or -not (Test-RegistrationPathEqual $callerCommandPath $callerPath)) { return $false }
  $callerName = [IO.Path]::GetFileName($callerPath)

  if ($callerName -ieq 'install.ps1' -and $HostIndex -eq 1 -and
      $Chain[0].parentProcessId -eq $nativeHostRecord.processId) {
    $expectedInstallPath = Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($callerPath))) 'install.ps1'
    return [bool](Get-RegistrationRecoveryLaunchJournal $Chain[0] $expectedInstallPath $HostInstallRoot)
  }

  if ($callerName -ieq 'verify-registration.ps1' -and $HostIndex -eq 2 -and
      $Chain.Count -gt 2 -and $Chain[1].name -match '^(?:powershell|pwsh)(?:_ise)?\.exe$' -and
      $Chain[0].parentProcessId -eq $Chain[1].processId -and
      $Chain[1].parentProcessId -eq $nativeHostRecord.processId) {
    $packageRoot = Split-Path -Parent ([IO.Path]::GetFullPath($callerPath))
    $expectedVerifierPath = Join-Path $packageRoot 'verify-registration.ps1'
    $expectedRecoveryPath = Join-Path $packageRoot 'install.ps1'
    $verifierInvocation = Get-RegistrationPowerShellInvocation $Chain[0] $expectedVerifierPath
    if (-not $verifierInvocation) { return $false }
    if (-not $Chain[1].argumentsLoaded) {
      try {
        $Chain[1].arguments = @(Get-RegistrationProcessArguments $Chain[1])
        $Chain[1].argumentsLoaded = $true
      } catch { return $false }
    }
    $journal = Get-RegistrationRecoveryLaunchJournal $Chain[1] $expectedRecoveryPath $HostInstallRoot
    return Test-RegistrationRecoveryVerifierOptions $verifierInvocation.options $journal
  }

  # Preserve the ordinary package install.cmd -> install.ps1 -> Native Host
  # relationship for initial installs and independent registration read-backs.
  $installCmdPath = ''
  $installerCommandLinePath = ''
  for ($i = 1; $i -lt $HostIndex; $i++) {
    if ($Chain[$i].name -ine 'cmd.exe' -or -not $Chain[$i].argumentsLoaded -or $i + 1 -gt $HostIndex) { continue }
    $candidateCmdPath = Get-RegistrationInstallCmdPath $Chain[$i] $callerPath
    if (-not $candidateCmdPath) { continue }
    $childProcess = $Chain[$i - 1]
    $parentProcess = $Chain[$i + 1]
    if ($childProcess.name -match '^(?:powershell|pwsh)(?:_ise)?\.exe$' -and
        $childProcess.parentProcessId -eq $Chain[$i].processId -and
        $Chain[$i].parentProcessId -eq $parentProcess.processId -and
        $parentProcess.processId -eq $nativeHostRecord.processId) {
      $scriptPath = Get-CommandScriptPath @($childProcess.arguments)
      if ($scriptPath -and (Test-RegistrationPathEqual $scriptPath (Join-Path (Split-Path -Parent $candidateCmdPath) 'install.ps1'))) {
        $installCmdPath = $candidateCmdPath
        $installerCommandLinePath = $scriptPath
        break
      }
    }
  }
  $installerScriptPath = Join-Path (Split-Path -Parent $callerPath) 'install.ps1'
  $installerScriptSeen = $false
  if ($installerScriptPath) {
    for ($i = 0; $i -le $HostIndex; $i++) {
      $process = $Chain[$i]
      if ($process.name -notmatch '^(?:powershell|pwsh)(?:_ise)?\.exe$') { continue }
      $scriptPath = Get-CommandScriptPath @($process.arguments)
      if ($scriptPath -and (Test-RegistrationPathEqual $scriptPath $installerScriptPath)) {
        $installerScriptSeen = $true
        break
      }
    }
  }
  $expectedWrapperPath = Join-Path (Split-Path -Parent $callerPath) 'install.cmd'
  return $installerScriptSeen -and
    (Test-RegistrationInstallerRelationship $callerPath $installerCommandLinePath `
      $installCmdPath $expectedWrapperPath $hostBrowserLink)
}

function Get-ChromeExtensionIdFromManifestKey([string]$Key) {
  if (-not $Key) { return '' }
  $keyBytes = [Convert]::FromBase64String($Key)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $digest = $hasher.ComputeHash($keyBytes) }
  finally { $hasher.Dispose() }
  $builder = [Text.StringBuilder]::new(32)
  for ($i = 0; $i -lt 16; $i++) {
    [void]$builder.Append([char]([int][Math]::Floor($digest[$i] / 16) + 97))
    [void]$builder.Append([char]([int]($digest[$i] % 16) + 97))
  }
  return $builder.ToString()
}

function Test-NoReparseRegistrationPath([string]$Path) {
  try {
    $full = [IO.Path]::GetFullPath($Path)
    $current = $full
    while ($current) {
      $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
      $parent = [IO.Path]::GetDirectoryName($current)
      if (-not $parent -or $parent -ieq $current) { break }
      $current = $parent
    }
    return $true
  } catch { return $false }
}

function Get-BrowserExpectedPaths([string]$BrowserName, [string]$LocalAppData) {
  $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
  $programFilesX86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
  if ($BrowserName -eq 'chrome') {
    return @(
      (Join-Path $programFiles 'Google\Chrome\Application\chrome.exe'),
      (Join-Path $programFilesX86 'Google\Chrome\Application\chrome.exe'),
      (Join-Path $LocalAppData 'Google\Chrome\Application\chrome.exe')
    ) | Where-Object { $_ }
  }
  return @(
    (Join-Path $programFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $programFilesX86 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $LocalAppData 'Microsoft\Edge\Application\msedge.exe')
  ) | Where-Object { $_ }
}

function Get-NativeMessagingBrowserProof($Chain, [int]$BrowserIndex, [int]$HostIndex, $Context) {
  $proof = [ordered]@{
    browserImageTrusted = $false
    nativeHostOriginVerified = $false
    nativeHostPathRootVerified = $false
    installedManifestVerified = $false
    extensionIdentityVerified = $false
    updateEnvironmentMatchesInstalledRoot = $false
    installerLaunchRelationVerified = $false
    browserName = ''
    nativeHostPath = ''
    installedRoot = ''
    nativeHostDiskSha256 = ''
    nativeHostDiskDigestStatus = 'unavailable'
    nativeHostDiskHashSemantics = 'Hash of the file currently at the reported path; it does not prove the bytes mapped into the live process.'
    browserSignatureStatus = ''
    limitation = 'Browser boundary attests the Native Messaging update caller; it is not an independent desktop witness.'
    reasons = @()
  }
  try {
    $browser = $Chain[$BrowserIndex]
    $nativeHostRecord = $Chain[$HostIndex]
    for ($i = 0; $i -le $HostIndex; $i++) {
      $name = [string]$Chain[$i].name
      $isCurrentPowerShell = ($i -eq 0) -and ($name -match '^(?:powershell|pwsh)(?:_ise)?\.exe$')
      if (($isCurrentPowerShell -or $name -ieq 'cmd.exe' -or $i -eq $HostIndex) -and
          -not $Chain[$i].argumentsLoaded) {
        $Chain[$i].arguments = @(Get-RegistrationProcessArguments $Chain[$i])
        $Chain[$i].argumentsLoaded = $true
      }
    }
    if ($BrowserIndex -eq ($HostIndex + 2) -and
        $Chain[$HostIndex + 1].name -ieq 'cmd.exe' -and
        -not $Chain[$HostIndex + 1].argumentsLoaded) {
      $Chain[$HostIndex + 1].arguments = @(Get-RegistrationProcessArguments $Chain[$HostIndex + 1])
      $Chain[$HostIndex + 1].argumentsLoaded = $true
    }

    # Registration read-back children are launched by install.ps1. Read an
    # ancestor PowerShell command line only when it is the immediate child of
    # the verified install.cmd wrapper directly above this Native Host.
    for ($i = 1; $i -lt $HostIndex; $i++) {
      if ($Chain[$i].name -notmatch '^(?:powershell|pwsh)(?:_ise)?\.exe$' -or
          $i + 1 -ge $HostIndex -or $Chain[$i + 1].name -ine 'cmd.exe' -or
          $Chain[$i + 1].parentProcessId -ne $nativeHostRecord.processId -or
          -not (Test-InstallCmdInvocation $Chain[$i + 1]) -or $Chain[$i].argumentsLoaded) { continue }
      $Chain[$i].arguments = @(Get-RegistrationProcessArguments $Chain[$i])
      $Chain[$i].argumentsLoaded = $true
    }

    $browserBase = [IO.Path]::GetFileName($browser.executablePath).ToLowerInvariant()
    $browserKind = if ($browserBase -eq 'chrome.exe') { 'chrome' } elseif ($browserBase -eq 'msedge.exe') { 'edge' } else { '' }
    if (-not $browserKind) { $proof.reasons += 'browser-image-name-invalid'; return $proof }
    $proof.browserName = $browserKind

    $expectedOrigin = 'chrome-extension://aamfmhcbjgofhmannejoiilkkpchfkgm/'
    $nativeArgs = @($nativeHostRecord.arguments)
    if (-not (Test-RegistrationPathEqual ([string]$nativeArgs[0]) ([string]$nativeHostRecord.executablePath)) -or
        -not (Test-RegistrationNativeHostOrigin $nativeArgs $expectedOrigin)) {
      $proof.reasons += 'native-host-extension-origin-mismatch'
    } else { $proof.nativeHostOriginVerified = $true }

    $hostPath = [IO.Path]::GetFullPath([string]$nativeHostRecord.executablePath)
    $hostDir = Split-Path -Parent $hostPath
    $installRootFromHost = Split-Path -Parent $hostDir
    $proof.nativeHostPath = $hostPath
    $proof.installedRoot = $installRootFromHost
    $expectedHostPath = Join-Path $hostDir 'native_host.exe'
    if ($nativeHostRecord.name -ine 'native_host.exe' -or
        -not (Test-RegistrationPathEqual $hostPath $expectedHostPath) -or
        -not (Test-NoReparseRegistrationPath $installRootFromHost)) {
      $proof.reasons += 'native-host-install-root-path-invalid'
    } else { $proof.nativeHostPathRootVerified = $true }

    if (-not (Test-Path -LiteralPath $hostPath -PathType Leaf)) {
      $proof.reasons += 'native-host-image-missing'
    } else {
      $hash = [Security.Cryptography.SHA256]::Create()
      $stream = [IO.File]::OpenRead($hostPath)
      try { $proof.nativeHostDiskSha256 = ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
      finally { $stream.Dispose(); $hash.Dispose() }
    }

    $runtimeConfigPath = Join-Path $hostDir 'runtime-config.json'
    $hostManifestPath = Join-Path $hostDir 'com.appraisal.toolbox.helper.json'
    if (-not (Test-Path -LiteralPath $runtimeConfigPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $hostManifestPath -PathType Leaf)) {
      $proof.reasons += 'native-host-installed-identity-files-missing'
      return $proof
    }
    $runtime = Get-Content -LiteralPath $runtimeConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    $hostManifest = Get-Content -LiteralPath $hostManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    $runtimeExtensionPath = [IO.Path]::GetFullPath([string]$runtime.extensionLoadPath)
    if (-not (Test-NoReparseRegistrationPath $runtimeExtensionPath)) {
      $proof.reasons += 'installed-extension-path-reparse-or-unavailable'
    }
    $manifestObject = Get-Content -LiteralPath (Join-Path $runtimeExtensionPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    $manifestExtensionId = Get-ChromeExtensionIdFromManifestKey ([string]$manifestObject.key)
    if (-not (Test-RegistrationNativeHostIdentity ([string]$runtime.nativeHostName) ([string]$hostManifest.name) `
        ([string]$hostManifest.path) $hostPath @($hostManifest.allowed_origins) $expectedOrigin `
        ([string]$runtime.toolboxExtensionId) $manifestExtensionId)) {
      $proof.reasons += 'installed-extension-identity-mismatch'
    } else { $proof.extensionIdentityVerified = $true }

    $envRoot = [string]$env:TB_UPDATE_INSTALL_ROOT
    $envExtensionPath = [string]$env:TB_UPDATE_EXTENSION_PATH
    $nonceValid = [string]$env:TB_UPDATE_NONCE -match '^[a-f0-9-]{36}$'
    $proof.updateEnvironmentMatchesInstalledRoot =
      (Test-RegistrationPathEqual $envRoot $installRootFromHost) -and
      (Test-RegistrationPathEqual $envExtensionPath $runtimeExtensionPath) -and
      $nonceValid
    if (-not $proof.updateEnvironmentMatchesInstalledRoot) {
      $proof.reasons += 'update-environment-root-or-extension-mismatch'
    }

    if (-not (Test-RegistrationNativeHostIdentity ([string]$runtime.nativeHostName) ([string]$hostManifest.name) `
        ([string]$hostManifest.path) $hostPath @($hostManifest.allowed_origins) $expectedOrigin `
        ([string]$runtime.toolboxExtensionId) $manifestExtensionId)) {
      $proof.reasons += 'installed-native-host-manifest-mismatch'
    } else {
      $registryKeyPath = if ($browserKind -eq 'chrome') {
        'Software\Google\Chrome\NativeMessagingHosts\com.appraisal.toolbox.helper'
      } else {
        'Software\Microsoft\Edge\NativeMessagingHosts\com.appraisal.toolbox.helper'
      }
      $view = if ($browser.process64Bit) { [Microsoft.Win32.RegistryView]::Registry64 } else { [Microsoft.Win32.RegistryView]::Registry32 }
      $registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
      try {
        $key = $registry.OpenSubKey($registryKeyPath, $false)
        try {
          $registeredManifest = if ($key) { [string]$key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { '' }
        } finally { if ($key) { $key.Dispose() } }
      } finally { $registry.Dispose() }
      if (-not (Test-RegistrationPathEqual $registeredManifest $hostManifestPath)) {
        $proof.reasons += 'browser-native-messaging-registry-route-mismatch'
      } else { $proof.installedManifestVerified = $true }
    }

    if (-not (Test-NoReparseRegistrationPath $browser.executablePath)) {
      $proof.reasons += 'browser-image-path-not-official-install-location'
    } else {
      $signature = Get-AuthenticodeSignature -LiteralPath $browser.executablePath
      $proof.browserSignatureStatus = [string]$signature.Status
      $subject = [string]$signature.SignerCertificate.Subject
      $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
      $programFilesX86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
      if (-not (Test-RegistrationBrowserImage $browserKind $browser.executablePath $programFiles `
          $programFilesX86 $Context.win32LocalAppData ([string]$signature.Status) $subject)) {
        $proof.reasons += 'browser-image-signature-invalid'
      } else { $proof.browserImageTrusted = $true }
    }

    $hostExpectedHash = [string]$runtime.nativeExeSha256
    if ($hostExpectedHash -match '^[a-fA-F0-9]{64}$') {
      if ($proof.nativeHostDiskSha256 -ine $hostExpectedHash) { $proof.reasons += 'installed-native-host-disk-digest-mismatch' }
      else { $proof.nativeHostDiskDigestStatus = 'runtime-config-disk-digest-matched' }
    } elseif ($proof.nativeHostDiskSha256 -match '^[a-f0-9]{64}$') {
      # Legacy installed helpers did not persist an expected executable digest.
      # Record the measured hash without presenting it as an independently trusted
      # baseline; newly installed candidates add this field for future upgrades.
      $proof.nativeHostDiskDigestStatus = 'observed-only-legacy-no-trusted-disk-baseline'
    }

    $proof.installerLaunchRelationVerified = Test-NativeMessagingInstallerLaunchRelation $Chain $BrowserIndex $HostIndex `
      $Context $hostPath $expectedOrigin $proof.installedRoot
    if (-not $proof.installerLaunchRelationVerified) { $proof.reasons += 'native-messaging-installer-launch-relation-invalid' }
  } catch {
    $proof.reasons += 'browser-update-proof-inspection-failed'
    $proof.inspectionError = ([string]$_.Exception.Message -replace 'https?://\S+', '[url]').Substring(0, [Math]::Min(300, ([string]$_.Exception.Message -replace 'https?://\S+', '[url]').Length))
  }
  return $proof
}

function Get-RegistrationContext([string]$CallerScriptPath = '') {
  if (-not ('AppraisalRegistrationContextToken' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

public sealed class AppraisalRegistrationProcessEvidence {
  public int ProcessId { get; set; }
  public string ImagePath { get; set; }
  public DateTime CreatedUtc { get; set; }
  public int SessionId { get; set; }
  public string UserSid { get; set; }
  public bool Process64Bit { get; set; }
  public bool AppContainer { get; set; }
  public bool TokenRestricted { get; set; }
  public bool VirtualizationAllowed { get; set; }
  public bool VirtualizationEnabled { get; set; }
  public string PackageFullName { get; set; }
}

public static class AppraisalRegistrationContextToken {
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const uint TOKEN_QUERY = 0x0008;
  const int ERROR_INSUFFICIENT_BUFFER = 122;
  const int APPMODEL_ERROR_NO_PACKAGE = 15700;
  [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsWow64Process(IntPtr process, out bool wow64);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern int GetPackageFullName(IntPtr process, ref uint length, StringBuilder name);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, int length, out int returned);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="ConvertSidToStringSidW")] static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr text);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
  [DllImport("shell32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
  [DllImport("shell32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern int SHGetKnownFolderPath(ref Guid folderId, uint flags, IntPtr token, out IntPtr path);

  static int TokenInt(IntPtr token, int infoClass) {
    IntPtr value = Marshal.AllocHGlobal(sizeof(int)); int returned;
    try {
      if (!GetTokenInformation(token, infoClass, value, sizeof(int), out returned)) throw new Win32Exception(Marshal.GetLastWin32Error());
      return Marshal.ReadInt32(value);
    } finally { Marshal.FreeHGlobal(value); }
  }
  static string TokenSid(IntPtr token) {
    int returned; GetTokenInformation(token, 1, IntPtr.Zero, 0, out returned);
    if (returned <= 0) throw new Win32Exception(Marshal.GetLastWin32Error());
    IntPtr buffer = Marshal.AllocHGlobal(returned);
    try {
      if (!GetTokenInformation(token, 1, buffer, returned, out returned)) throw new Win32Exception(Marshal.GetLastWin32Error());
      SID_AND_ATTRIBUTES value = (SID_AND_ATTRIBUTES)Marshal.PtrToStructure(buffer, typeof(SID_AND_ATTRIBUTES));
      IntPtr text;
      if (!ConvertSidToStringSid(value.Sid, out text)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try { return Marshal.PtrToStringUni(text); } finally { LocalFree(text); }
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  static string PackageFullName(IntPtr process) {
    uint length = 0; int result = GetPackageFullName(process, ref length, null);
    if (result == APPMODEL_ERROR_NO_PACKAGE) return "";
    if (result != ERROR_INSUFFICIENT_BUFFER && result != 0) throw new Win32Exception(result);
    StringBuilder name = new StringBuilder((int)Math.Max(length, 1));
    result = GetPackageFullName(process, ref length, name);
    if (result == APPMODEL_ERROR_NO_PACKAGE) return "";
    if (result != 0) throw new Win32Exception(result);
    return name.ToString();
  }
  public static string LocalAppData() {
    Guid folderId = new Guid("F1B32785-6FBA-4FCF-9D55-7B8E7F157091");
    IntPtr path;
    int result = SHGetKnownFolderPath(ref folderId, 0, IntPtr.Zero, out path);
    if (result < 0) Marshal.ThrowExceptionForHR(result);
    try { return Marshal.PtrToStringUni(path); }
    finally { Marshal.FreeCoTaskMem(path); }
  }
  public static AppraisalRegistrationProcessEvidence ReadProcess(int pid) {
    IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      uint size = 32768; StringBuilder image = new StringBuilder((int)size);
      if (!QueryFullProcessImageName(process, 0, image, ref size)) throw new Win32Exception(Marshal.GetLastWin32Error());
      long creation, exit, kernel, user;
      if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error());
      uint session;
      if (!ProcessIdToSessionId((uint)pid, out session)) throw new Win32Exception(Marshal.GetLastWin32Error());
      bool wow64;
      if (!IsWow64Process(process, out wow64)) throw new Win32Exception(Marshal.GetLastWin32Error());
      IntPtr token;
      if (!OpenProcessToken(process, TOKEN_QUERY, out token)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        return new AppraisalRegistrationProcessEvidence {
          ProcessId = pid, ImagePath = image.ToString(), CreatedUtc = DateTime.FromFileTimeUtc(creation),
          SessionId = (int)session, UserSid = TokenSid(token),
          Process64Bit = Environment.Is64BitOperatingSystem && !wow64,
          AppContainer = TokenInt(token, 29) != 0, VirtualizationAllowed = TokenInt(token, 23) != 0,
          VirtualizationEnabled = TokenInt(token, 24) != 0, TokenRestricted = TokenInt(token, 40) != 0,
          PackageFullName = PackageFullName(process)
        };
      } finally { CloseHandle(token); }
    } finally { CloseHandle(process); }
  }
  public static string[] ParseCommandLine(string commandLine) {
    if (String.IsNullOrWhiteSpace(commandLine)) return new string[0];
    int count; IntPtr vector = CommandLineToArgvW(commandLine, out count);
    if (vector == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      string[] result = new string[count];
      for (int i = 0; i < count; i++) result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(vector, i * IntPtr.Size));
      return result;
    } finally { LocalFree(vector); }
  }
}
"@
  }

  $callerScriptPath = [string]$CallerScriptPath
  if (-not $callerScriptPath) { $callerScriptPath = [string]$MyInvocation.ScriptName }
  if ($callerScriptPath) {
    try { $callerScriptPath = [IO.Path]::GetFullPath($callerScriptPath) }
    catch { $callerScriptPath = '' }
  }
  $c = [ordered]@{
    observedAtUtc = [DateTime]::UtcNow.ToString('o')
    processId = $PID
    callerScriptPath = $callerScriptPath
    sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    process64Bit = [Environment]::Is64BitProcess
    processLocalAppData = [string]$env:LOCALAPPDATA
    win32LocalAppData = ''
    packageFullName = ''
    appxEnvironment = [string]$env:APPX_PACKAGE_FAMILY_NAME
    profileLocalAppData = ''
    desktopBoundaryAttested = $false
    nativeMessagingBrowserBoundaryAttested = $false
    boundaryType = 'invalid-unattested-context'
    browserUpdateProof = $null
    browserBoundaryOuterParentState = 'not-applicable'
    parentChain = @()
    limitations = @()
    executableChainValidated = $false
    independentDesktopWitness = $false
    valid = $false
    scope = 'invalid-unattested-context'
    reasons = @()
    limitation = 'Token/path/ancestry attestation plus same-tree cross-read is not an independent out-of-tree witness.'
  }
  try {
    $currentEvidence = [AppraisalRegistrationContextToken]::ReadProcess($PID)
    if ($currentEvidence.ProcessId -ne $PID -or $currentEvidence.UserSid -cne $c.userSid) {
      throw 'current-process-token-snapshot-mismatch'
    }
    $c.appContainer = $currentEvidence.AppContainer
    $c.virtualizationAllowed = $currentEvidence.VirtualizationAllowed
    $c.virtualizationEnabled = $currentEvidence.VirtualizationEnabled
    $c.tokenRestricted = $currentEvidence.TokenRestricted
    $c.packageFullName = $currentEvidence.PackageFullName
    $c.win32LocalAppData = [AppraisalRegistrationContextToken]::LocalAppData()
    $c.profileLocalAppData = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'AppData\Local'

    $chain = @()
    $next = $PID
    $childCreated = $null
    $seen = @{}
    $browserIndex = -1
    $hostIndex = -1
    $boundaryReached = $false
    $collectFailed = $false
    for ($i = 0; $i -lt 64 -and $next; $i++) {
      if ($seen.ContainsKey([string]$next)) {
        if ($boundaryReached) { $c.limitations += 'browser-parent-chain-cycle-after-trusted-boundary' }
        else { $c.reasons += 'parent-chain-cycle' }
        break
      }
      $seen[[string]$next] = $true
      try {
        $native = [AppraisalRegistrationContextToken]::ReadProcess([int]$next)
        $wmi = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$next" `
          -Property @('ProcessId','ParentProcessId','ExecutablePath','CreationDate') -ErrorAction Stop
        if (-not $wmi -or -not $wmi.ExecutablePath -or -not $wmi.CreationDate) { throw 'process-record-unavailable' }
        $createdFromCim = Convert-RegistrationCimCreationDateToUtc $wmi.CreationDate
        if ([Math]::Abs(($createdFromCim - $native.CreatedUtc).TotalSeconds) -gt 1 -or
            -not (Test-RegistrationPathEqual ([string]$wmi.ExecutablePath) $native.ImagePath)) {
          throw 'process-snapshot-race-or-pid-reused'
        }
        $process = [ordered]@{
          processId = [int]$wmi.ProcessId
          parentProcessId = [int]$wmi.ParentProcessId
          name = [IO.Path]::GetFileName($native.ImagePath)
          executablePath = $native.ImagePath
          createdAtUtc = $native.CreatedUtc.ToString('o')
          sessionId = $native.SessionId
          userSid = $native.UserSid
          process64Bit = $native.Process64Bit
          appContainer = $native.AppContainer
          tokenRestricted = $native.TokenRestricted
          virtualizationEnabled = $native.VirtualizationEnabled
          packageFullName = $native.PackageFullName
          arguments = @()
          argumentsLoaded = $false
        }
      } catch {
        if ($boundaryReached) {
          $c.browserBoundaryOuterParentState = 'unavailable-or-changed'
          $c.limitations += 'browser-parent-process-unavailable-or-changed'
        } else {
          $c.reasons += 'parent-chain-unavailable-or-changed'
          $collectFailed = $true
        }
        break
      }
      if ($childCreated -and $native.CreatedUtc -gt $childCreated) {
        if ($boundaryReached) {
          $c.browserBoundaryOuterParentState = 'pid-reused'
          $c.limitations += 'browser-boundary-parent-pid-reused'
        } else {
          $c.reasons += 'parent-pid-reused'
        }
        break
      }

      $chain += [PSCustomObject]$process
      if ($native.ProcessId -eq $PID) {
        if ($process.name -match '^(?:powershell|pwsh)(?:_ise)?\.exe$') {
          $chain[$chain.Count - 1].arguments = @(Get-RegistrationProcessArguments $chain[$chain.Count - 1])
          $chain[$chain.Count - 1].argumentsLoaded = $true
          $currentScriptArgument = Get-CommandScriptPath @($chain[$chain.Count - 1].arguments)
          if ($currentScriptArgument -and
              (-not $c.callerScriptPath -or -not (Test-RegistrationPathEqual $currentScriptArgument $c.callerScriptPath))) {
            $c.reasons += 'current-installer-script-argument-mismatch'
          }
        } else { $c.reasons += 'current-process-is-not-powershell' }
      }
      if ($native.PackageFullName -or $native.AppContainer -or $native.TokenRestricted -or $native.VirtualizationEnabled) {
        $c.reasons += 'restricted-ancestor-token-or-AppContainer/MSIX'
      }
      if ($native.UserSid -cne $c.userSid -or $native.SessionId -ne $c.sessionId) {
        $c.reasons += 'process-sid-session-mismatch'
      }
      if ($native.ImagePath -match '\\WindowsApps\\|\\Packages\\' -or
          ([IO.Path]::GetFileName($native.ImagePath) -match '^(codex|codex-sandbox|codex-exec|ChatGPT|zcode)\.exe$')) {
        $c.reasons += 'packaged-or-agent-ancestor-not-independent-desktop'
      }
      $imageName = [IO.Path]::GetFileName($native.ImagePath)
      if ($imageName -ieq 'native_host.exe') {
        if ($hostIndex -ge 0) { $c.reasons += 'duplicate-native-host-ancestor' }
        else { $hostIndex = $chain.Count - 1 }
      }
      if ($native.ImagePath -ieq (Join-Path $env:WINDIR 'explorer.exe') -or
          $native.ImagePath -ieq (Join-Path $env:WINDIR 'System32\sihost.exe')) {
        $c.desktopBoundaryAttested = $true
        if ($boundaryReached) { $c.browserBoundaryOuterParentState = 'verified-desktop' }
        $c.boundaryType = if ($boundaryReached) { 'browser-native-messaging-update' } else { 'ordinary-desktop-shell' }
        break
      }
      if ($imageName -ieq 'chrome.exe' -or $imageName -ieq 'msedge.exe') {
        if ($browserIndex -ge 0) {
          $firstBrowser = $chain[$browserIndex]
          if ($c.browserUpdateProof -and $c.browserUpdateProof.browserImageTrusted -and
              $firstBrowser.name -ieq $chain[$chain.Count - 1].name -and
              (Test-RegistrationPathEqual $firstBrowser.executablePath $chain[$chain.Count - 1].executablePath)) {
            $c.limitations += 'additional-same-image-browser-ancestor-accepted'
          } else {
            $c.reasons += 'duplicate-or-conflicting-browser-boundary'
            break
          }
        } else {
          $browserIndex = $chain.Count - 1
          $boundaryReached = $true
          $c.boundaryType = 'browser-native-messaging-update'
          if ($hostIndex -lt 0) {
            $c.reasons += 'browser-boundary-without-native-host-ancestor'
          } else {
            $c.browserUpdateProof = Get-NativeMessagingBrowserProof $chain $browserIndex $hostIndex $c
            $c.reasons += @($c.browserUpdateProof.reasons)
            $proof = $c.browserUpdateProof
            $c.nativeMessagingBrowserBoundaryAttested =
              $proof.browserImageTrusted -and $proof.nativeHostOriginVerified -and
              $proof.nativeHostPathRootVerified -and $proof.installedManifestVerified -and
              $proof.extensionIdentityVerified -and $proof.updateEnvironmentMatchesInstalledRoot -and
              $proof.installerLaunchRelationVerified
          }
        }
      }
      $childCreated = $native.CreatedUtc
      $next = [int]$wmi.ParentProcessId
      if ($i -eq 63 -and $next) {
        if ($boundaryReached) { $c.limitations += 'browser-parent-chain-depth-limited' }
        else { $c.reasons += 'parent-chain-depth-exceeded' }
      }
    }
    if ($boundaryReached -and $c.browserBoundaryOuterParentState -eq 'not-applicable') {
      $c.browserBoundaryOuterParentState = 'unavailable-or-changed'
      $c.limitations += 'browser-parent-chain-ended-without-desktop-boundary'
    }
    $c.parentChain = @($chain | ForEach-Object {
      $copy = [ordered]@{}
      foreach ($key in $_.PSObject.Properties.Name) {
        if ($key -ne 'arguments') { $copy[$key] = $_.$key }
      }
      # Never persist raw command lines or arguments. Keep only the exact origin test.
      $copy['nativeHostOriginArgumentVerified'] = [bool](
        $_.name -ieq 'native_host.exe' -and
        @($_.arguments | Where-Object { [string]$_ -ceq 'chrome-extension://aamfmhcbjgofhmannejoiilkkpchfkgm/' }).Count -eq 1
      )
      [PSCustomObject]$copy
    })
    $c.executableChainValidated = (-not $collectFailed) -and ($c.parentChain.Count -gt 0) -and
      ($c.parentChain[0].processId -eq $PID)
    $c.reasons += @(Get-RegistrationContextPolicyReasons $c)
    $c.reasons = @($c.reasons | Where-Object { $_ } | Select-Object -Unique)
    $c.valid = $c.reasons.Count -eq 0
    if ($c.valid -and $c.nativeMessagingBrowserBoundaryAttested) {
      $c.scope = 'verified-native-messaging-browser-update-context-same-tree-crossread'
      $c.limitation = 'Verified browser Native Messaging update boundary; not an independent out-of-tree desktop witness.'
    } elseif ($c.valid -and $c.desktopBoundaryAttested) {
      $c.scope = 'desktop-lineage-token-path-attested-same-tree-crossread'
    }
  } catch {
    $c.reasons += 'context-inspection-failed'
    $c.inspectionError = ([string]$_.Exception.Message -replace 'https?://\S+', '[url]').Substring(0, [Math]::Min(300, ([string]$_.Exception.Message -replace 'https?://\S+', '[url]').Length))
  }
  return $c
}

function Assert-RegistrationContext($Context) {
  if (-not $Context.valid) {
    $reasonText = (@($Context.reasons) -join ', ')
    if ($Context.nativeMessagingBrowserBoundaryAttested -or $Context.boundaryType -eq 'browser-native-messaging-update') {
      throw ('REGISTRATION_VERIFICATION_INVALID: ' + $reasonText + '. Browser update origin or process context could not be verified; use the official Chrome/Edge Native Messaging route or run the installer from an ordinary desktop session.')
    }
    throw ('REGISTRATION_VERIFICATION_INVALID: ' + $reasonText + '. Run install.cmd / verification in an ordinary desktop Windows PowerShell outside the agent or packaged sandbox.')
  }
}
