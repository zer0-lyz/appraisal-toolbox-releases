$ErrorActionPreference = "Stop"
$InstallRoot = Join-Path $env:LOCALAPPDATA "AppraisalToolbox"
$HostName = "com.appraisal.toolbox.helper"
$RegistryPaths = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
)

foreach ($RegistryPath in $RegistryPaths) {
  if (Test-Path -LiteralPath $RegistryPath) {
    $RegisteredManifest = (Get-Item -LiteralPath $RegistryPath).GetValue("")
    $OwnedManifest = Join-Path $InstallRoot "native-helper\$HostName.json"
    if ([string]$RegisteredManifest -eq $OwnedManifest) {
      Remove-Item -LiteralPath $RegistryPath -Recurse -Force
    }
  }
}

if (Test-Path -LiteralPath $InstallRoot) {
  Remove-Item -LiteralPath $InstallRoot -Recurse -Force
}
Write-Host "Appraisal Toolbox removed from $InstallRoot"
