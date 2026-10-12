param(
 [Parameter(Mandatory=$true)][ValidateSet('windows-x64')][string]$Target,
 [Parameter(Mandatory=$true)][string]$Version,
 [Parameter(Mandatory=$true)][string]$BuildId,
 [Parameter(Mandatory=$true)][string]$BuildNumber,
 [Parameter(Mandatory=$true)][string]$Output,
 [Parameter(Mandatory=$true)][string]$Tools,
 [string]$BaseArchive,
 [string]$Cache,
 [string]$ReuseNative
)
$ErrorActionPreference = 'Stop'
$BuildArgs = @((Join-Path $PSScriptRoot 'build.cjs'), '--target', $Target, '--version', $Version, '--build-id', $BuildId, '--build-number', $BuildNumber, '--output', $Output, '--tools', $Tools)
if ($BaseArchive) { $BuildArgs += @('--base-archive', $BaseArchive) }
if ($Cache) { $BuildArgs += @('--cache', $Cache) }
if ($ReuseNative) { $BuildArgs += @('--reuse-native', $ReuseNative) }
& node.exe @BuildArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
