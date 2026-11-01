param([Parameter(Mandatory=$true)][string]$ToolsDirectory)
$ErrorActionPreference = 'Stop'
$ToolsDirectory = [IO.Path]::GetFullPath($ToolsDirectory)
New-Item -ItemType Directory -Path $ToolsDirectory -Force | Out-Null
$taskLockPath = Join-Path $PSScriptRoot '../release-inputs.lock.json'
$taskLock = Get-Content -LiteralPath $taskLockPath -Raw | ConvertFrom-Json
$taskDependencies = @($taskLock.targets.'windows-x64'.tools)
# Reuse verified tools without extracting unchanged modules again.
$taskProvenance = Join-Path $ToolsDirectory 'DEPENDENCY-PROVENANCE.json'
if (Test-Path -LiteralPath $taskProvenance) {
  & node.exe -e "require(process.argv[1]).verifyTools(process.argv[2],require(process.argv[3]).targets['windows-x64'])" (Join-Path $PSScriptRoot '../scripts/release/verify-tools.cjs') $ToolsDirectory $taskLockPath
  if ($LASTEXITCODE -eq 0) { Write-Output 'Verified tool cache hit'; return }
}
$taskRecords = @()
foreach ($taskDependency in $taskDependencies) {
  if ($taskDependency.integrity -notmatch '^sha512-(.+)$') { throw 'Invalid locked tool integrity' }
  $taskExpectedDigest = $Matches[1]
  $taskArchive = Join-Path $ToolsDirectory (($taskDependency.Name -replace '[/@]', '_') + '-' + $taskDependency.Version + '.tgz')
  if (!(Test-Path -LiteralPath $taskArchive)) { Invoke-WebRequest -Uri $taskDependency.url -OutFile $taskArchive -TimeoutSec 120 }
  $taskHasher = [Security.Cryptography.SHA512]::Create()
  $taskStream = [IO.File]::OpenRead($taskArchive)
  try { $taskActualDigest = [Convert]::ToBase64String($taskHasher.ComputeHash($taskStream)) } finally { $taskStream.Dispose(); $taskHasher.Dispose() }
  if ($taskActualDigest -cne $taskExpectedDigest) { throw ('Dependency integrity mismatch: ' + $taskDependency.Name) }
  $taskModuleDirectory = Join-Path (Join-Path $ToolsDirectory 'node_modules') ($taskDependency.Name -replace '/', '\')
  if (Test-Path -LiteralPath $taskModuleDirectory) { Remove-Item -LiteralPath $taskModuleDirectory -Recurse -Force }
  New-Item -ItemType Directory -Path $taskModuleDirectory -Force | Out-Null
  & tar.exe -xf $taskArchive -C $taskModuleDirectory --strip-components 1
  if ($LASTEXITCODE -ne 0) { throw 'Dependency extraction failed' }
  $taskRecords += [ordered]@{ name=$taskDependency.Name; version=$taskDependency.Version; url=$taskDependency.url; integrity='sha512-'+$taskActualDigest; transport='Windows HTTPS with certificate validation'; installScriptsRun=$false }
}
$taskJson = $taskRecords | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $ToolsDirectory 'DEPENDENCY-PROVENANCE.json'), $taskJson, [Text.UTF8Encoding]::new($false))
$taskJson
