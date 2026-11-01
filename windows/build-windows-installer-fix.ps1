param(
  [Parameter(Mandatory = $true)]
  [string]$BaseArchivePath,
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$ExpectedBaseSha256 = "a71aabe5008d06e4ba519a0abfb7c84fcdf6e53085a8eb54100313e626366a28"
$AssetName = "appraisal-toolbox-v0.2.1-windows-x64-installer-fix1.zip"
$ReleaseTag = "windows-installer-fix-20261009"
$InstallerBuild = "windows-registry-write-fix.1"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryRoot = Split-Path -Parent $Here
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$BaseArchivePath = [IO.Path]::GetFullPath($BaseArchivePath)

if (-not (Test-Path -LiteralPath $BaseArchivePath -PathType Leaf)) {
  throw "Base archive not found: $BaseArchivePath"
}
$ActualBaseSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $BaseArchivePath).Hash.ToLowerInvariant()
if ($ActualBaseSha256 -ne $ExpectedBaseSha256) {
  throw "Base archive SHA-256 mismatch. Expected $ExpectedBaseSha256; got $ActualBaseSha256."
}

if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
}
$ArchivePath = Join-Path $OutputDirectory $AssetName
$SidecarPath = "$ArchivePath.sha256"
if ((Test-Path -LiteralPath $ArchivePath) -or (Test-Path -LiteralPath $SidecarPath)) {
  throw "Output archive or checksum sidecar already exists. Use a new empty output directory."
}

$WorkRoot = Join-Path $env:TEMP ("appraisal-toolbox-windows-fix-" + [Guid]::NewGuid().ToString("N"))
$ExtractRoot = Join-Path $WorkRoot "extracted"
$ZipRoot = Join-Path $WorkRoot "zip-root"
$PackageName = "appraisal-toolbox-v0.2.1-windows-x64"
$PackageRoot = Join-Path $ExtractRoot $PackageName
$PackagePrefix = [IO.Path]::GetFullPath($PackageRoot).TrimEnd('\') + '\'

try {
  New-Item -ItemType Directory -Path $ExtractRoot -Force | Out-Null
  Expand-Archive -LiteralPath $BaseArchivePath -DestinationPath $ExtractRoot
  if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot "install.ps1") -PathType Leaf)) {
    throw "Unexpected package layout: missing $PackageName\install.ps1"
  }

  Copy-Item -LiteralPath (Join-Path $Here "installer\install.ps1") -Destination $PackageRoot -Force
  Copy-Item -LiteralPath (Join-Path $Here "installer\install.cmd") -Destination $PackageRoot -Force
  Copy-Item -LiteralPath (Join-Path $Here "installer\uninstall.ps1") -Destination $PackageRoot -Force
  Copy-Item -LiteralPath (Join-Path $Here "installer\uninstall.cmd") -Destination $PackageRoot -Force
  Copy-Item -LiteralPath (Join-Path $Here "installer\INSTALL.md") -Destination $PackageRoot -Force

  $SourceCommit = (& git -C $RepositoryRoot rev-parse HEAD).Trim()
  $Provenance = [ordered]@{
    schemaVersion = 1
    productVersion = "0.2.1"
    installerBuild = $InstallerBuild
    releaseTag = $ReleaseTag
    sourceRepository = "zer0-lyz/appraisal-toolbox-releases"
    installerSourceCommit = $SourceCommit
    baseArchive = "appraisal-toolbox-v0.2.1-windows-x64-full.zip"
    baseArchiveSha256 = $ActualBaseSha256
    extensionChanged = $false
    nativeHelperRebuilt = $false
    runtimeRebuilt = $false
    note = "Installer-only repair. Extension, native helper, Node, portable Python, and offline packages are preserved from the SHA-256-verified v0.2.1 Windows release."
    builtAtUtc = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  }
  [IO.File]::WriteAllText(
    (Join-Path $PackageRoot "BUILD-PROVENANCE.json"),
    ($Provenance | ConvertTo-Json -Depth 5),
    [Text.UTF8Encoding]::new($false)
  )

  $ChecksumLines = @()
  $PackageFiles = Get-ChildItem -LiteralPath $PackageRoot -Recurse -File -Force |
    Where-Object { $_.Name -ne "SHA256SUMS" } |
    Sort-Object { $_.FullName.Substring($PackagePrefix.Length) }
  foreach ($File in $PackageFiles) {
    if (-not $File.FullName.StartsWith($PackagePrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Package file escaped its root: $($File.FullName)"
    }
    $RelativePath = $File.FullName.Substring($PackagePrefix.Length) -replace '\\', '/'
    $FileSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $File.FullName).Hash.ToLowerInvariant()
    $ChecksumLines += "$FileSha256  $RelativePath"
  }
  [IO.File]::WriteAllLines(
    (Join-Path $PackageRoot "SHA256SUMS"),
    [string[]]$ChecksumLines,
    [Text.UTF8Encoding]::new($false)
  )

  New-Item -ItemType Directory -Path $ZipRoot -Force | Out-Null
  Copy-Item -LiteralPath $PackageRoot -Destination $ZipRoot -Recurse
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory(
    $ZipRoot,
    $ArchivePath,
    [IO.Compression.CompressionLevel]::Optimal,
    $false
  )

  $ArchiveSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $ArchivePath).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText(
    $SidecarPath,
    "$ArchiveSha256 *$AssetName`r`n",
    [Text.UTF8Encoding]::new($false)
  )

  $PromptTemplate = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $Here "WINDOWS_CODEX_ACCEPTANCE_PROMPT.md")
  $Prompt = $PromptTemplate.Replace("__WINDOWS_PACKAGE_SHA256__", $ArchiveSha256)
  [IO.File]::WriteAllText(
    (Join-Path $OutputDirectory "WINDOWS_CODEX_ACCEPTANCE_PROMPT.md"),
    $Prompt,
    [Text.UTF8Encoding]::new($false)
  )
  Copy-Item -LiteralPath (Join-Path $Here "INCIDENT_WINDOWS_INSTALLER_2026-10-09.md") `
    -Destination (Join-Path $OutputDirectory "WINDOWS_INSTALLER_INCIDENT_AND_FIX.md")
  Copy-Item -LiteralPath (Join-Path $Here "MULTIPLATFORM_INSTALL_PACKAGING.md") `
    -Destination (Join-Path $OutputDirectory "MULTIPLATFORM_INSTALL_PACKAGING.md")

  $ReleaseFiles = @(
    $ArchivePath,
    $SidecarPath,
    (Join-Path $OutputDirectory "WINDOWS_CODEX_ACCEPTANCE_PROMPT.md"),
    (Join-Path $OutputDirectory "WINDOWS_INSTALLER_INCIDENT_AND_FIX.md"),
    (Join-Path $OutputDirectory "MULTIPLATFORM_INSTALL_PACKAGING.md")
  )
  $ReleaseChecksums = foreach ($File in $ReleaseFiles) {
    $Name = [IO.Path]::GetFileName($File)
    $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant()
    "$Hash  $Name"
  }
  [IO.File]::WriteAllLines(
    (Join-Path $OutputDirectory "SHA256SUMS.txt"),
    [string[]]$ReleaseChecksums,
    [Text.UTF8Encoding]::new($false)
  )

  [ordered]@{
    archive = $ArchivePath
    archiveSha256 = $ArchiveSha256
    sidecar = $SidecarPath
    releaseFiles = $ReleaseFiles
    releaseChecksums = Join-Path $OutputDirectory "SHA256SUMS.txt"
    installerSourceCommit = $SourceCommit
    baseArchiveSha256 = $ActualBaseSha256
  } | ConvertTo-Json -Depth 5
}
finally {
  $TempBase = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  $ResolvedWorkRoot = [IO.Path]::GetFullPath($WorkRoot)
  if (-not $ResolvedWorkRoot.StartsWith($TempBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean a build directory outside the temp root: $ResolvedWorkRoot"
  }
  if (Test-Path -LiteralPath $ResolvedWorkRoot) {
    Remove-Item -LiteralPath $ResolvedWorkRoot -Recurse -Force
  }
}
