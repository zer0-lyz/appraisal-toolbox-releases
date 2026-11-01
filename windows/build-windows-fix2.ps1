param(
 [Parameter(Mandatory=$true)][string]$BaseArchivePath,
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [Parameter(Mandatory=$true)][string]$ToolsDirectory,
 [Parameter(Mandatory=$true)][ValidateSet('fix2','fix3','fix4','inplace','layout','amap','mapui','round2')][string]$BuildSuffix,
 [string]$ReuseBuildResult
)
$ErrorActionPreference = 'Stop'
$BuildArguments = @((Join-Path $PSScriptRoot 'build-windows-fix2.cjs'), $BaseArchivePath, $OutputDirectory, $ToolsDirectory, $BuildSuffix)
if ($ReuseBuildResult) { $BuildArguments += $ReuseBuildResult }
& node.exe @BuildArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
