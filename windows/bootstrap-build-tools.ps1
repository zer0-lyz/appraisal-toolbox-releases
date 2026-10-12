param([Parameter(Mandatory=$true)][string]$ToolsDirectory)
$ErrorActionPreference = 'Stop'
$ToolsDirectory = [IO.Path]::GetFullPath($ToolsDirectory)
New-Item -ItemType Directory -Path $ToolsDirectory -Force | Out-Null
$taskDependencies = @(
  @{ Name='esbuild'; Version='0.25.12' },
  @{ Name='@esbuild/win32-x64'; Version='0.25.12' },
  @{ Name='postject'; Version='1.0.0-alpha.6' }
)
$taskRecords = @()
foreach ($taskDependency in $taskDependencies) {
  $taskMetadataUrl = 'https://registry.npmjs.org/' + $taskDependency.Name + '/' + $taskDependency.Version
  $taskMetadata = Invoke-RestMethod -Uri $taskMetadataUrl -TimeoutSec 60
  if ($taskMetadata.version -ne $taskDependency.Version -or $taskMetadata.dist.integrity -notmatch '^sha512-(.+)$') { throw 'Unexpected registry metadata' }
  $taskExpectedDigest = $Matches[1]
  $taskArchive = Join-Path $ToolsDirectory (($taskDependency.Name -replace '[/@]', '_') + '-' + $taskDependency.Version + '.tgz')
  Invoke-WebRequest -Uri $taskMetadata.dist.tarball -OutFile $taskArchive -TimeoutSec 120
  $taskHasher = [Security.Cryptography.SHA512]::Create()
  $taskStream = [IO.File]::OpenRead($taskArchive)
  try { $taskActualDigest = [Convert]::ToBase64String($taskHasher.ComputeHash($taskStream)) } finally { $taskStream.Dispose(); $taskHasher.Dispose() }
  if ($taskActualDigest -cne $taskExpectedDigest) { throw ('Dependency integrity mismatch: ' + $taskDependency.Name) }
  $taskModuleDirectory = Join-Path (Join-Path $ToolsDirectory 'node_modules') ($taskDependency.Name -replace '/', '\')
  New-Item -ItemType Directory -Path $taskModuleDirectory -Force | Out-Null
  & tar.exe -xf $taskArchive -C $taskModuleDirectory --strip-components 1
  if ($LASTEXITCODE -ne 0) { throw 'Dependency extraction failed' }
  $taskRecords += [ordered]@{ name=$taskDependency.Name; version=$taskDependency.Version; url=$taskMetadata.dist.tarball; integrity='sha512-'+$taskActualDigest; transport='Windows HTTPS with certificate validation'; installScriptsRun=$false }
}
$taskJson = $taskRecords | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $ToolsDirectory 'DEPENDENCY-PROVENANCE.json'), $taskJson, [Text.UTF8Encoding]::new($false))
$taskJson
