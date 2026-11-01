$ErrorActionPreference = 'Stop'

$installer = Join-Path $PSScriptRoot '..\installer\registration-context.ps1'
. (Resolve-Path -LiteralPath $installer)

$script:results = New-Object System.Collections.Generic.List[object]

function Assert-Fixture([string]$Name, [bool]$Condition, $Details = $null) {
  if (-not $Condition) {
    $detailText = if ($null -eq $Details) { '' } else { " details=$($Details | ConvertTo-Json -Compress -Depth 8)" }
    throw "FAIL $Name$detailText"
  }
  $script:results.Add([ordered]@{ name = $Name; ok = $true; details = $Details })
}

function New-BrowserContext([string]$BrowserName) {
  $browserPath = if ($BrowserName -eq 'chrome') {
    'C:\Program Files\Google\Chrome\Application\chrome.exe'
  } else {
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  }
  $proof = [ordered]@{
    browserImageTrusted = $true
    nativeHostOriginVerified = $true
    nativeHostPathRootVerified = $true
    installedManifestVerified = $true
    extensionIdentityVerified = $true
    updateEnvironmentMatchesInstalledRoot = $true
    installerLaunchRelationVerified = $true
    browserName = $BrowserName
  }
  return @{
    appContainer = $false
    tokenRestricted = $false
    virtualizationEnabled = $false
    packageFullName = ''
    appxEnvironment = ''
    process64Bit = $true
    sessionId = 1
    userSid = 'S-1-5-21-111-222-333-1001'
    processLocalAppData = 'C:\Users\fixture\AppData\Local'
    win32LocalAppData = 'C:\Users\fixture\AppData\Local'
    profileLocalAppData = 'C:\Users\fixture\AppData\Local'
    boundaryType = 'browser-native-messaging-update'
    nativeMessagingBrowserBoundaryAttested = $true
    executableChainValidated = $true
    browserUpdateProof = $proof
    desktopBoundaryAttested = $false
    browserBoundaryOuterParentState = 'verified-desktop'
    parentChain = @(
      @{ name = 'powershell.exe'; executablePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'; processId = 4100; parentProcessId = 4200; userSid = 'S-1-5-21-111-222-333-1001'; sessionId = 1 },
      @{ name = 'cmd.exe'; executablePath = 'C:\Windows\System32\cmd.exe'; processId = 4200; parentProcessId = 4300; userSid = 'S-1-5-21-111-222-333-1001'; sessionId = 1 },
      @{ name = 'native_host.exe'; executablePath = 'E:\AppraisalToolbox\native-helper\native_host.exe'; processId = 4300; parentProcessId = 4400; userSid = 'S-1-5-21-111-222-333-1001'; sessionId = 1 },
      @{ name = 'cmd.exe'; executablePath = 'C:\Windows\System32\cmd.exe'; processId = 4400; parentProcessId = 4500; userSid = 'S-1-5-21-111-222-333-1001'; sessionId = 1 },
      @{ name = $(if ($BrowserName -eq 'chrome') { 'chrome.exe' } else { 'msedge.exe' }); executablePath = $browserPath; processId = 4500; parentProcessId = 4600; userSid = 'S-1-5-21-111-222-333-1001'; sessionId = 1 }
    )
  }
}

function Assert-ContextDecision([string]$Name, $Context, [bool]$ExpectedValid) {
  $reasons = @(Get-RegistrationContextPolicyReasons $Context)
  $valid = ($reasons.Count -eq 0)
  Assert-Fixture $Name ($valid -eq $ExpectedValid) @{ expectedValid = $ExpectedValid; reasons = $reasons }
}

# Validate the same pure predicates used by Get-NativeMessagingBrowserProof.
$expectedOrigin = 'chrome-extension://aamfmhcbjgofhmannejoiilkkpchfkgm/'
Assert-Fixture 'chrome-origin-exact' (Test-RegistrationNativeHostOrigin @('native_host.exe', $expectedOrigin) $expectedOrigin)
Assert-Fixture 'wrong-origin-rejected' (-not (Test-RegistrationNativeHostOrigin @('native_host.exe', 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/') $expectedOrigin))
Assert-Fixture 'origin-with-extra-extension-rejected' (-not (Test-RegistrationNativeHostOrigin @('native_host.exe', $expectedOrigin, 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/') $expectedOrigin))

$chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$edgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
Assert-Fixture 'chrome-standard-path-and-signature' (Test-RegistrationBrowserImage 'chrome' $chromePath 'C:\Program Files' 'C:\Program Files (x86)' 'C:\Users\fixture\AppData\Local' 'Valid' 'CN=Google LLC, O=Google LLC')
Assert-Fixture 'edge-standard-path-and-signature' (Test-RegistrationBrowserImage 'edge' $edgePath 'C:\Program Files' 'C:\Program Files (x86)' 'C:\Users\fixture\AppData\Local' 'Valid' 'CN=Microsoft Corporation, O=Microsoft Corporation')
Assert-Fixture 'browser-path-mismatch-rejected' (-not (Test-RegistrationBrowserImage 'chrome' 'C:\Temp\chrome.exe' 'C:\Program Files' 'C:\Program Files (x86)' 'C:\Users\fixture\AppData\Local' 'Valid' 'CN=Google LLC'))
Assert-Fixture 'browser-signature-mismatch-rejected' (-not (Test-RegistrationBrowserImage 'chrome' $chromePath 'C:\Program Files' 'C:\Program Files (x86)' 'C:\Users\fixture\AppData\Local' 'HashMismatch' 'CN=Google LLC'))
Assert-Fixture 'browser-publisher-mismatch-rejected' (-not (Test-RegistrationBrowserImage 'edge' $edgePath 'C:\Program Files' 'C:\Program Files (x86)' 'C:\Users\fixture\AppData\Local' 'Valid' 'CN=Unknown Publisher'))

Assert-Fixture 'native-host-registration-matches' (Test-RegistrationNativeHostIdentity 'com.appraisal.toolbox.helper' 'com.appraisal.toolbox.helper' 'E:\AppraisalToolbox\native-helper\native_host.exe' 'E:\AppraisalToolbox\native-helper\native_host.exe' @($expectedOrigin) $expectedOrigin 'aamfmhcbjgofhmannejoiilkkpchfkgm' 'aamfmhcbjgofhmannejoiilkkpchfkgm')
Assert-Fixture 'native-host-registration-mismatch-rejected' (-not (Test-RegistrationNativeHostIdentity 'com.appraisal.toolbox.helper' 'com.other.host' 'E:\AppraisalToolbox\native-helper\native_host.exe' 'E:\AppraisalToolbox\native-helper\native_host.exe' @($expectedOrigin) $expectedOrigin 'aamfmhcbjgofhmannejoiilkkpchfkgm' 'aamfmhcbjgofhmannejoiilkkpchfkgm'))
Assert-Fixture 'native-host-manifest-path-mismatch-rejected' (-not (Test-RegistrationNativeHostIdentity 'com.appraisal.toolbox.helper' 'com.appraisal.toolbox.helper' 'E:\AppraisalToolbox\native-helper\native_host.exe' 'C:\Temp\native_host.exe' @($expectedOrigin) $expectedOrigin 'aamfmhcbjgofhmannejoiilkkpchfkgm' 'aamfmhcbjgofhmannejoiilkkpchfkgm'))

Assert-Fixture 'install-script-and-wrapper-root-match' (Test-RegistrationInstallerRelationship 'E:\ATU\install.ps1' 'E:\ATU\install.ps1' 'E:\ATU\install.cmd' 'E:\ATU\install.cmd' $true)
Assert-Fixture 'install-script-and-wrapper-root-mismatch-rejected' (-not (Test-RegistrationInstallerRelationship 'E:\ATU\install.ps1' 'E:\ATU\install.ps1' 'C:\Temp\install.cmd' 'E:\ATU\install.cmd' $true))
Assert-Fixture 'host-not-launched-from-browser-rejected' (-not (Test-RegistrationInstallerRelationship 'E:\ATU\install.ps1' 'E:\ATU\install.ps1' 'E:\ATU\install.cmd' 'E:\ATU\install.cmd' $false))
$relativeWrapper = [pscustomobject]@{ name = 'cmd.exe'; argumentsLoaded = $true; arguments = @('cmd.exe', '/d', '/s', '/c', 'install.cmd') }
Assert-Fixture 'relative-install-cmd-resolves-beside-verified-script' ((Get-RegistrationInstallCmdPath $relativeWrapper 'E:\ATU\install.ps1') -eq 'E:\ATU\install.cmd')
$unexpectedWrapper = [pscustomobject]@{ name = 'cmd.exe'; argumentsLoaded = $true; arguments = @('cmd.exe', '/d', '/s', '/c', 'other.cmd') }
Assert-Fixture 'unexpected-relative-wrapper-rejected' (-not (Get-RegistrationInstallCmdPath $unexpectedWrapper 'E:\ATU\install.ps1'))

$chromeContext = New-BrowserContext 'chrome'
$edgeContext = New-BrowserContext 'edge'
Assert-ContextDecision 'chrome-valid-native-messaging-update' $chromeContext $true
Assert-ContextDecision 'edge-valid-native-messaging-update' $edgeContext $true

$badOrigin = New-BrowserContext 'chrome'
$badOrigin.browserUpdateProof.nativeHostOriginVerified = $false
Assert-ContextDecision 'wrong-origin-context-rejected' $badOrigin $false

$badImage = New-BrowserContext 'edge'
$badImage.browserUpdateProof.browserImageTrusted = $false
Assert-ContextDecision 'wrong-browser-path-or-signature-context-rejected' $badImage $false

$badHostRegistration = New-BrowserContext 'chrome'
$badHostRegistration.browserUpdateProof.installedManifestVerified = $false
Assert-ContextDecision 'host-registration-mismatch-context-rejected' $badHostRegistration $false

$agent = New-BrowserContext 'chrome'
$agent.parentChain += @{ name = 'codex.exe'; executablePath = 'C:\Program Files\WindowsApps\OpenAI.Codex\codex.exe'; userSid = $agent.userSid; sessionId = 1 }
Assert-ContextDecision 'agent-ancestor-rejected' $agent $false

$restricted = New-BrowserContext 'edge'
$restricted.parentChain[2].tokenRestricted = $true
Assert-ContextDecision 'restricted-native-host-ancestor-rejected' $restricted $false

$boundaryInnerPidReuse = Get-RegistrationParentPidReuseReason ([DateTime]'2026-10-18T10:00:00Z') ([DateTime]'2026-10-18T10:00:01Z') $false
Assert-Fixture 'pid-reuse-before-browser-boundary-rejected' ($boundaryInnerPidReuse -eq 'parent-pid-reused') @{ reason = $boundaryInnerPidReuse }

$boundaryOuterPidReuse = Get-RegistrationParentPidReuseReason ([DateTime]'2026-10-18T10:00:00Z') ([DateTime]'2026-10-18T10:00:01Z') $true
$outerReuse = New-BrowserContext 'chrome'
$outerReuse.browserBoundaryOuterParentState = 'pid-reused'
$outerReuse.parentChain += @{ name = 'chrome.exe'; executablePath = $chromePath; userSid = $outerReuse.userSid; sessionId = 1 }
Assert-Fixture 'only-browser-outer-parent-pid-reuse-is-limitation' ($boundaryOuterPidReuse -eq 'browser-boundary-parent-pid-reused') @{ reason = $boundaryOuterPidReuse }
Assert-ContextDecision 'browser-outer-pid-reuse-remains-acceptable' $outerReuse $true

$unknownOuterParent = New-BrowserContext 'chrome'
$unknownOuterParent.parentChain += @{ name = 'chrome.exe'; executablePath = $chromePath; userSid = $unknownOuterParent.userSid; sessionId = 1 }
$unknownOuterParent.boundaryType = 'browser-native-messaging-update'
$unknownOuterParent.browserBoundaryOuterParentState = 'unavailable-or-changed'
Assert-Fixture 'unknown-browser-outer-parent-state-rejected' ((Get-RegistrationContextPolicyReasons $unknownOuterParent) -contains 'browser-boundary-parent-chain-unverified')

$recovery = New-BrowserContext 'chrome'
$recovery.nativeMessagingBrowserBoundaryAttested = $false
$recovery.browserUpdateProof.installerLaunchRelationVerified = $false
Assert-ContextDecision 'direct-recovery-process-without-native-messaging-relation-rejected' $recovery $false

$output = [ordered]@{
  ok = $true
  count = $script:results.Count
  tests = $script:results.ToArray()
  modifiesRegistry = $false
  usesProductionTestSwitch = $false
  realInstallerRun = $false
  realBrowserBoundaryCovered = $false
  note = 'Synthetic PowerShell fixture; it does not read or modify registered hosts, install files, browser profiles, or production settings.'
}
$output | ConvertTo-Json -Depth 12
if (-not $output.ok) { exit 1 }
