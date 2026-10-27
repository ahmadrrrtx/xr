<#
  Wrap a built XR app directory into an MSIX (Phase 27).

  Tauri 2.12 cannot emit MSIX itself, so this script does the two steps the
  bundler would: lay out the package (manifest + icons + the built binary and its
  sidecar) and hand it to MakeAppx, then sign it.

  It refuses to guess: every input path is checked, and a missing MakeAppx or
  signing tool is an error with the fix in the message, not a silent skip.

  Usage:
    pwsh packaging/windows/msix/build-msix.ps1 `
      -AppDir   desktop/src-tauri/target/release `
      -Version  0.2.0 `
      -OutDir   dist/msix `
      -Sign     -CertPath certs/xr-test.pfx -CertPassword (Read-Host -AsSecureString)

  Signing is optional so an unsigned package can be produced for inspection on a
  machine without a certificate; an unsigned MSIX cannot be installed.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$OutDir = "dist/msix",
  [string]$Manifest = "packaging/windows/msix/AppxManifest.xml",
  [string]$AssetsDir = "packaging/windows/msix/Assets",
  [string]$BinariesDir = "desktop/src-tauri/binaries",
  [switch]$Sign,
  [string]$CertPath,
  [System.Security.SecureString]$CertPassword
)

$ErrorActionPreference = "Stop"

# MSIX takes four integers, not semver. This is a test-package encoding only:
# previews with the same major.minor.patch intentionally collide and must not be
# used to infer update ordering or a publishable versioning policy.
function ConvertTo-AppxVersion([string]$InputVersion) {
  $n = '(?:0|[1-9][0-9]*)'
  $id = '[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*'
  $pattern = "^v?(?<major>$n)\.(?<minor>$n)\.(?<patch>$n)(?:\.(?<revision>$n)|(?:-(?<pre>$id))?(?:\+$id)?)?$"
  if ($InputVersion -notmatch $pattern) {
    throw "Invalid MSIX source version: $InputVersion (expected semver or four numeric fields)"
  }
  $parts = @($Matches.major, $Matches.minor, $Matches.patch, '0')
  if ($Matches.revision) { $parts[3] = $Matches.revision }
  foreach ($part in $parts) {
    if ($part.Length -gt 5 -or [int]$part -gt 65535) {
      throw "MSIX version field out of range (0..65535): $InputVersion"
    }
  }
  if ($Matches.pre) {
    Write-Warning "The MSIX test version does not distinguish prereleases; it is not an upgrade or publication policy."
  }
  return ($parts -join '.')
}

function Require-Path([string]$Path, [string]$What) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$What not found: $Path"
  }
}

function Require-Tool([string]$Name, [string]$Hint) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  # MakeAppx.exe and signtool.exe ship inside the Windows SDK bin folder,
  # which the GitHub windows-latest image does not put on PATH. Search the
  # newest SDK first so a stale 10.0.1xxxx copy never wins over the one
  # that matches the manifest this package declares. Join-Path throws on a
  # $null root, so empty roots are dropped before joining.
  $binRoots = @(${env:ProgramFiles(x86)}, $env:ProgramFiles) |
    Where-Object { $_ } |
    ForEach-Object { Join-Path $_ 'Windows Kits\10\bin' }
  foreach ($root in $binRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    # The regex keeps [version] from throwing on a folder it cannot parse.
    $found = Get-ChildItem -LiteralPath $root -Directory -Filter '10.0.*' -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^\d+(\.\d+){1,3}$' } |
      Sort-Object -Property { [version]$_.Name } -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\$Name" } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Select-Object -First 1
    if ($found) { return $found }
  }

  throw "$Name is not available on PATH or under Windows Kits\10\bin. $Hint"
}

# ── Inputs ──────────────────────────────────────────────────────────────────
$appxVersion = ConvertTo-AppxVersion $Version
Require-Path $AppDir "The built app directory"
Require-Path $Manifest "The MSIX manifest"
Require-Path $AssetsDir "The MSIX icon assets (see the README in that folder)"

$exe = Join-Path $AppDir "xr-desktop.exe"
Require-Path $exe "The built XR executable"

# The sidecar does NOT land in the app directory. Tauri resolves externalBin
# from src-tauri/binaries/ and copies it into the *bundle*, so target/release
# only ever holds the shell itself. Look in both instead of assuming one
# layout — on a Windows runner only $BinariesDir has it.
$sidecar = @($AppDir, $BinariesDir) |
  Where-Object { Test-Path -LiteralPath $_ } |
  ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter "xr-engine-*.exe" } |
  Select-Object -First 1
if (-not $sidecar) {
  throw "The engine sidecar (xr-engine-<triple>.exe) is missing from $AppDir and $BinariesDir — build with scripts/compile-sidecar.ts first. XR without its engine is not shippable."
}

# ── Layout ──────────────────────────────────────────────────────────────────
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("xr-msix-" + [guid]::NewGuid().ToString("N"))
$msix = $null
$completed = $false
try {
New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "Assets") | Out-Null

Copy-Item -LiteralPath $exe -Destination $stage
Copy-Item -LiteralPath $sidecar.FullName -Destination $stage
Copy-Item -Path (Join-Path $AssetsDir "*.png") -Destination (Join-Path $stage "Assets")

# Change ONLY Package/Identity/@Version. A string replacement of `Version=`
# also matches TargetDeviceFamily's MinVersion and silently lowers that floor.
[xml]$manifestXml = Get-Content -LiteralPath $Manifest -Raw
$ns = [System.Xml.XmlNamespaceManager]::new($manifestXml.NameTable)
$ns.AddNamespace('appx', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
$identities = @($manifestXml.SelectNodes('/appx:Package/appx:Identity', $ns))
if ($identities.Count -ne 1 -or -not $identities[0].HasAttribute('Version')) {
  throw "Expected one MSIX Package/Identity with a Version attribute: $Manifest"
}
$identities[0].SetAttribute('Version', $appxVersion)
$manifestXml.Save((Join-Path $stage 'AppxManifest.xml'))

# ── Pack ────────────────────────────────────────────────────────────────────
$makeAppx = Require-Tool "MakeAppx.exe" "It ships with the Windows SDK (Windows App Certification Kit / 'MSIX Packaging Tools')."
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$msix = Join-Path $OutDir "XR_$appxVersion`_x64.msix"
& $makeAppx pack /d $stage /p $msix /o | Out-Host
if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $msix -PathType Leaf) -or (Get-Item -LiteralPath $msix).Length -eq 0) {
  throw "MakeAppx reported success but produced no package: $msix"
}
Write-Host "packed $msix"

# ── Sign ────────────────────────────────────────────────────────────────────
if ($Sign) {
  if (-not $CertPath) { throw "-Sign needs -CertPath (a .pfx). Generate a self-signed test cert with: New-SelfSignedCertificate -Type Custom -Subject 'CN=Muhammad Ahmad, O=Muhammad Ahmad, C=PK' -KeyUsage DigitalSignature -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3') -CertStoreLocation Cert:\CurrentUser\My" }
  Require-Path $CertPath "The signing certificate"
  $signtool = Require-Tool "signtool.exe" "It ships with the Windows SDK."
  if (-not $CertPassword) { throw "-Sign needs -CertPassword" }
  $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($CertPassword)
  try {
    $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    & $signtool sign /fd SHA256 /a /f $CertPath /p $plain /tr http://timestamp.digicert.com /td SHA256 $msix | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "SignTool failed with exit code $LASTEXITCODE" }
  } finally {
    $plain = $null
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
  Write-Host "signed $msix"
} else {
  Write-Warning "Package produced UNSIGNED — Windows will refuse to install it. Re-run with -Sign for a testable package."
}

# ── Verify ──────────────────────────────────────────────────────────────────
if (Get-Command "Get-AppPackageManifest" -ErrorAction SilentlyContinue) {
  Write-Host "manifest validation is available via: makeappx validate /p $msix"
}
$completed = $true
Write-Host "done: $msix"
} finally {
  # A failed pack/sign must not leave a stale or unsigned file as a success.
  if (-not $completed -and $msix -and (Test-Path -LiteralPath $msix)) {
    Remove-Item -LiteralPath $msix -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
