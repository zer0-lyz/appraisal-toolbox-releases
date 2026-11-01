$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\installer\registration-context.ps1')
$results=@()
function Test-Policy([string]$Name, [hashtable]$Change, [bool]$Valid) {
  $fixture=@{appContainer=$false;tokenRestricted=$false;virtualizationEnabled=$false;packageFullName='';appxEnvironment='';process64Bit=$true;sessionId=1;processLocalAppData='C:\Users\fixture\AppData\Local';win32LocalAppData='C:\Users\fixture\AppData\Local';profileLocalAppData='C:\Users\fixture\AppData\Local';parentChain=@(@{name='powershell.exe';executablePath='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'});desktopBoundaryAttested=$true}
  foreach($k in $Change.Keys){$fixture[$k]=$Change[$k]}
  $r=@(Get-RegistrationContextPolicyReasons $fixture)
  if (($r.Count -eq 0) -ne $Valid) { throw "Policy fixture failed: $Name ($r)" }
  $script:results+=@{name=$Name;ok=$true;fixtureOnly=$true;reasons=$r}
}
Test-Policy 'ordinary-desktop-policy' @{} $true
Test-Policy 'AppContainer' @{appContainer=$true} $false
Test-Policy 'restricted-token' @{tokenRestricted=$true} $false
Test-Policy 'virtualization-enabled' @{virtualizationEnabled=$true} $false
Test-Policy 'package-identity' @{packageFullName='Synthetic.Package'} $false
Test-Policy 'appx-environment' @{appxEnvironment='Synthetic.Package'} $false
Test-Policy 'different-localappdata' @{processLocalAppData='C:\redirected'} $false
Test-Policy 'both-views-redirected' @{win32LocalAppData='C:\redirected';processLocalAppData='C:\redirected'} $false
Test-Policy 'no-localappdata' @{processLocalAppData=''} $false
Test-Policy 'x86' @{process64Bit=$false} $false
Test-Policy 'session-zero' @{sessionId=0} $false
Test-Policy 'agent-ancestor' @{parentChain=@(@{name='codex.exe';executablePath='C:\agent\codex.exe'})} $false
Test-Policy 'packaged-ancestor' @{parentChain=@(@{name='other.exe';executablePath='C:\Program Files\WindowsApps\Synthetic\other.exe'})} $false
Test-Policy 'unknown-ancestry' @{desktopBoundaryAttested=$false} $false
try { Assert-RegistrationContext @{valid=$false;reasons=@('fixture-invalid')}; throw 'Invalid context was accepted' }
catch { if($_.Exception.Message -notlike 'REGISTRATION_VERIFICATION_INVALID:*'){throw} }
$results+=@{name='invalid-context-throws';ok=$true;fixtureOnly=$true}
@{ok=$true;count=$results.Count;tests=$results;realDesktopCovered=$false}|ConvertTo-Json -Depth 8
