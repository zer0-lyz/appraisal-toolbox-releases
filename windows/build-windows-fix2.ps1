param(
 [Parameter(Mandatory=$true)][string]$BaseArchivePath,
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [Parameter(Mandatory=$true)][string]$ToolsDirectory
)
$ErrorActionPreference = 'Stop'
& node.exe (Join-Path $PSScriptRoot 'build-windows-fix2.cjs') $BaseArchivePath $OutputDirectory $ToolsDirectory
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
