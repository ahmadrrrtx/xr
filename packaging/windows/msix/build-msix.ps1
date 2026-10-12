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
  [switch]$Sign,
  [string]$CertPath,
  [System.Security.SecureString]$CertPassword
)

$ErrorActionPreference = "Stop"

function Require-Path([string]$Path, [string]$What) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$What not found: $Path"
  }
}

function Require-Tool([string]$Name, [string]$Hint) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "$Name is not available on PATH. $Hint" }
  return $cmd.Source
}

# ── Inputs ──────────────────────────────────────────────────────────────────
Require-Path $AppDir "The built app directory"
Require-Path $Manifest "The MSIX manifest"
Require-Path $AssetsDir "The MSIX icon assets (see the README in that folder)"

$exe = Join-Path $AppDir "xr-desktop.exe"
Require-Path $exe "The built XR executable"

$sidecar = Get-ChildItem -Path $AppDir -Filter "xr-engine-*.exe" | Select-Object -First 1
if (-not $sidecar) {
  throw "The engine sidecar (xr-engine-<triple>.exe) is missing from $AppDir — build with scripts/compile-sidecar.ts first. XR without its engine is not shippable."
}

# ── Layout ──────────────────────────────────────────────────────────────────
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("xr-msix-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "Assets") | Out-Null

Copy-Item -LiteralPath $exe -Destination $stage
Copy-Item -LiteralPath $sidecar.FullName -Destination $stage
Copy-Item -Path (Join-Path $AssetsDir "*.png") -Destination (Join-Path $stage "Assets")

# The MSIX identity version is four-part; the app version is semver.
$parts = ($Version -replace "^v", "") -split "\."
while ($parts.Count -lt 4) { $parts += "0" }
$appxVersion = ($parts[0..3] -join ".")

$manifestXml = Get-Content -LiteralPath $Manifest -Raw
$manifestXml = $manifestXml -replace 'Version="\d+\.\d+\.\d+\.\d+"', "Version=`"$appxVersion`""
Set-Content -LiteralPath (Join-Path $stage "AppxManifest.xml") -Value $manifestXml -Encoding UTF8

# ── Pack ────────────────────────────────────────────────────────────────────
$makeAppx = Require-Tool "MakeAppx.exe" "It ships with the Windows SDK (Windows App Certification Kit / 'MSIX Packaging Tools')."
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$msix = Join-Path $OutDir "XR_$appxVersion`_x64.msix"
& $makeAppx pack /d $stage /p $msix /o | Out-Host
Write-Host "packed $msix"

# ── Sign ────────────────────────────────────────────────────────────────────
if ($Sign) {
  if (-not $CertPath) { throw "-Sign needs -CertPath (a .pfx). Generate a self-signed test cert with: New-SelfSignedCertificate -Type Custom -Subject 'CN=Muhammad Ahmad, O=Muhammad Ahmad, C=PK' -KeyUsage DigitalSignature -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3') -CertStoreLocation Cert:\CurrentUser\My" }
  Require-Path $CertPath "The signing certificate"
  $signtool = Require-Tool "signtool.exe" "It ships with the Windows SDK."
  $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($CertPassword)
  )
  & $signtool sign /fd SHA256 /a /f $CertPath /p $plain /tr http://timestamp.digicert.com /td SHA256 $msix | Out-Host
  Write-Host "signed $msix"
} else {
  Write-Warning "Package produced UNSIGNED — Windows will refuse to install it. Re-run with -Sign for a testable package."
}

# ── Verify ──────────────────────────────────────────────────────────────────
if (Get-Command "Get-AppPackageManifest" -ErrorAction SilentlyContinue) {
  Write-Host "manifest validation is available via: makeappx validate /p $msix"
}
Remove-Item -Recurse -Force $stage
Write-Host "done: $msix"
