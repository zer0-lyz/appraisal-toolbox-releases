param(
  [Parameter(Mandatory=$true)][string]$HostRoot,
  [string]$EvidenceRoot = 'C:\AppraisalToolboxAcceptance\v0.2.1\evidence\Z1-desktop'
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'registration-context.ps1')
$context = Get-RegistrationContext -CallerScriptPath $PSCommandPath
$out = Join-Path $EvidenceRoot ([DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($out) | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $out 'execution-context.json'), ($context | ConvertTo-Json -Depth 12), $utf8)
$summary = [ordered]@{ status='not-verified'; contextValid=$context.valid; evidencePath=$out; keys=@(); limitation=$context.limitation }
foreach ($browser in @('Chrome','Edge')) {
  $vendor = if ($browser -eq 'Chrome') { 'Google\Chrome' } else { 'Microsoft\Edge' }
  $key = "HKCU:\Software\$vendor\NativeMessagingHosts\com.appraisal.toolbox.helper"
  foreach ($bits in @('32','64')) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $env:WINDIR 'System32\reg.exe'
    $info.Arguments = 'query "' + $key.Replace('HKCU:\','HKCU\') + '" /ve /reg:' + $bits
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $nativeEncoding=[Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
    $info.StandardOutputEncoding=$nativeEncoding; $info.StandardErrorEncoding=$nativeEncoding
    $p = [Diagnostics.Process]::Start($info)
    try {
      $regPid=$p.Id; $stdout=$p.StandardOutput.ReadToEndAsync(); $stderr=$p.StandardError.ReadToEndAsync()
      if (-not $p.WaitForExit(15000)) { $p.Kill(); throw 'reg.exe timed out' }
      $raw=$stdout.Result + $stderr.Result; $exitCode=$p.ExitCode
      [IO.File]::WriteAllText((Join-Path $out "$browser-$bits-reg-raw.txt"), $raw, $utf8)
      [IO.File]::WriteAllText((Join-Path $out "$browser-$bits-metadata.json"),
        (@{ command=($info.FileName+' '+$info.Arguments); processId=$regPid; exitCode=$exitCode; nativeCodePage=$nativeEncoding.CodePage; evidenceTextEncoding='utf-8'; observedAtUtc=[DateTime]::UtcNow.ToString('o'); contextScope=$context.scope } | ConvertTo-Json), $utf8)
    } finally { $p.Dispose() }
  }
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $ErrorActionPreference='Continue'
  $probe = & $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify-registration.ps1') `
    -RegistryPath $key -ProbeId ([Guid]::NewGuid().ToString('N')) `
    -ExpectedManifestPath (Join-Path $HostRoot 'native-helper\com.appraisal.toolbox.helper.json') `
    -ExpectedExePath (Join-Path $HostRoot 'native-helper\native_host.exe') `
    -ExpectedHostName 'com.appraisal.toolbox.helper' -ExpectedExtensionId 'aamfmhcbjgofhmannejoiilkkpchfkgm' -VerifyRegistration 2>$null
  $code=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  $text=@($probe) -join "`n"
  [IO.File]::WriteAllText((Join-Path $out "$browser-verifier.json"), $text, $utf8)
  $result = $text | ConvertFrom-Json
  $summary.keys += @{browser=$browser;exitCode=$code;ok=$result.ok;contextValid=$result.contextValid}
}
if ($context.valid -and @($summary.keys | Where-Object { -not $_.ok -or $_.exitCode -ne 0 }).Count -eq 0) {
  $summary.status='verified-in-attested-desktop-session'
}
[IO.File]::WriteAllText((Join-Path $out 'summary.json'), ($summary | ConvertTo-Json -Depth 8), $utf8)
$summary | ConvertTo-Json -Depth 8
if ($summary.status -ne 'verified-in-attested-desktop-session') { exit 1 }
exit 0
