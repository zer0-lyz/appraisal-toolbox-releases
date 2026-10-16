# This helper only handles an explicitly recorded Appraisal Toolbox unpacked directory.
function Assert-ToolboxExtensionPath([string]$Target, [string]$Source) {
  $Resolved = [IO.Path]::GetFullPath($Target).TrimEnd('\')
  if ($Resolved -eq [IO.Path]::GetPathRoot($Resolved).TrimEnd('\')) { throw 'Invalid original extension path.' }
  foreach ($AncestorRoot in @($PackageRoot, $InstallRoot)) {
    $Root = [IO.Path]::GetFullPath($AncestorRoot).TrimEnd('\')
    if ($Resolved -ieq $Root -or $Root.StartsWith($Resolved + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Original extension path overlaps installation/package root.' }
    if ($Resolved.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase) -and $Resolved -ine (Join-Path $InstallRoot 'extension')) { throw 'Invalid nested extension path.' }
  }
  for ($Cursor = $Resolved; $Cursor; $Cursor = Split-Path -Parent $Cursor) {
    if (Test-Path -LiteralPath $Cursor) {
      if ((Get-Item -LiteralPath $Cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Original extension path uses a reparse point.' }
    }
  }
  $OriginalManifest = Get-Content -LiteralPath (Join-Path $Resolved 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $NewManifest = Get-Content -LiteralPath (Join-Path $Source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $OriginalManifest.key -or $OriginalManifest.key -cne $NewManifest.key -or $OriginalManifest.name -cne $NewManifest.name -or $OriginalManifest.name -ne '评估工具箱') { throw 'Original extension identity does not match this product.' }
  return $Resolved
}

function Update-OriginalExtension {
  if ($ExtensionLoadPath -ieq (Join-Path $InstallRoot 'extension')) { return }
  $null = Assert-ToolboxExtensionPath $ExtensionLoadPath (Join-Path $PackageRoot 'extension')
  $script:ExtensionStaging = "$ExtensionLoadPath.staging-$UniqueSuffix"
  $script:ExtensionBackup = "$ExtensionLoadPath.previous-$UniqueSuffix"
  Save-InstallTreeSnapshot $ExtensionLoadPath $ExtensionSnapshotPath
  Copy-Tree (Join-Path $PackageRoot 'extension') $ExtensionStaging
  # Verify all staged bytes before touching the original directory.
  $SourceSnapshot = "$ExtensionSnapshotPath.package.json"
  Save-InstallTreeSnapshot (Join-Path $PackageRoot 'extension') $SourceSnapshot
  $null = Verify-ExternalTree $ExtensionStaging $SourceSnapshot
  Move-Item -LiteralPath $ExtensionLoadPath -Destination $ExtensionBackup
  $script:ExtensionMoved = $true
  Move-Item -LiteralPath $ExtensionStaging -Destination $ExtensionLoadPath
  $script:ExtensionReplaced = $true
  $null = Verify-ExternalTree $ExtensionLoadPath $SourceSnapshot
}

function Restore-OriginalExtension {
  if ($ExtensionReplaced -and (Test-Path -LiteralPath $ExtensionLoadPath)) {
    # Validate exact snapshot-owned target before recursive removal.
    $null = Assert-ToolboxExtensionPath $ExtensionLoadPath (Join-Path $PackageRoot 'extension')
    Remove-Item -LiteralPath $ExtensionLoadPath -Recurse -Force
  }
  if ($ExtensionMoved -and (Test-Path -LiteralPath $ExtensionBackup)) {
    Move-Item -LiteralPath $ExtensionBackup -Destination $ExtensionLoadPath
    $null = Verify-ExternalTree $ExtensionLoadPath $ExtensionSnapshotPath
  }
  if ($ExtensionStaging -and (Test-Path -LiteralPath $ExtensionStaging)) {
    if ($ExtensionStaging -cne "$ExtensionLoadPath.staging-$UniqueSuffix") { throw 'Unsafe extension staging path.' }
    Remove-Item -LiteralPath $ExtensionStaging -Recurse -Force
  }
}
