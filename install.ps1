# XR bootstrap installer for native Windows.
#
# Remote (documented, tested):
#   iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)
#
# Local file (also supported, with arguments):
#   .\install.ps1 -AssumeYes -InstallMode minimal -TargetDirectory C:\tools\xr -ReleaseVersion 1.0.0
#
# It installs ONE pinned, published release: the compiled binary verified
# against the release's SHA256SUMS, or (when no binary fits) that release's
# verified xr-source.tar.gz with `bun install --frozen-lockfile`. It never
# installs from an unpinned branch, and a missing or unverifiable release stops
# the install with nothing half-installed (launch audit XR-LAUNCH-002).
#
# Environment (launch audit XR-LAUNCH-025):
#   XR_INSTALL_DIR  where XR's program files go (default <profile>\.xr-agent;
#                   -TargetDirectory wins). Absolute; never the profile itself,
#                   a drive root, or XR's data home.
#   XR_HOME         XR's DATA home (config, databases, vault). The installer
#                   never puts program files there.
# The user profile (USERPROFILE / HOME) must exist; there is no fallback to the
# current directory.
#
# ---------------------------------------------------------------------------
# WHY THIS FILE HAS NO TOP-LEVEL param() BLOCK
# ---------------------------------------------------------------------------
# `iex (irm ...)` runs the downloaded text through Invoke-Expression, which
# executes it as a statement list in the CALLER's scope — not as a script or
# function with its own parameter binding. A top-level `param(...)` in that
# context does not "declare parameters"; PowerShell instead tries to APPLY the
# parameter attributes to variables in the current scope. The previous version
# had:
#
#   [ValidateSet('minimal','local','byok','hybrid','full')][string]$Mode = ''
#
# so Invoke-Expression attempted to attach a ValidateSet attribute to $Mode
# whose value ('' — and '' is not a member of the set) instantly violates it:
#
#   ValidationMetadataException / ValidateSetFailure
#   "The attribute cannot be added because variable Mode with value
#    would no longer be valid."
#
# Verified: this reproduces with ANY ValidateSet whose current value is outside
# the set, and removing only the default does NOT fix it (an unset variable is
# still ''). It is not caused by Invoke-Expression being "unsafe" — the param
# block is simply invalid in that execution mode. `Mode` is also a dangerously
# generic name to inject into the caller's session.
#
# The fix: put ALL parameters on a FUNCTION (real parameter binding, ValidateSet
# works normally), give them explicit, collision-free names, and dispatch at the
# bottom. This is correct under `iex`, under `-File`, and when dot-sourced.
# ---------------------------------------------------------------------------

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$XrRepo = 'ahmadrrrtx/xr'
# Stamped from release.manifest.json `channels.publicVersion` (bun run release:stamp).
# The installer only ever installs a published, pinned release (XR-LAUNCH-002).
$Version = '1.0.0'
$XrInstallMarker = '.xr-install'

function Write-XrStep { param([string]$Message) Write-Host "  > $Message" -ForegroundColor Cyan }
function Write-XrOk { param([string]$Message) Write-Host "  [ok] $Message" -ForegroundColor Green }
function Write-XrWarn { param([string]$Message) Write-Host "  [!] $Message" -ForegroundColor Yellow }

# Fail loudly with a non-zero exit code, but NEVER kill the user's interactive
# session: `iex` runs in-process, so a bare `exit 1` would close their console.
# Throwing gives a catchable, visible error; the dispatcher maps it to an exit
# code when we are running as a script.
function Stop-XrInstall { param([string]$Message) throw "XR install failed: $Message" }

# Windows detection that is safe on BOTH editions. $IsWindows only exists in
# PowerShell 6+; under Windows PowerShell 5.1 with `Set-StrictMode -Version
# Latest`, merely READING it throws "variable cannot be retrieved because it has
# not been set" — a real latent bug in the previous version of this script.
function Test-XrOnWindows {
  if (Test-Path Variable:\IsWindows) { return [bool](Get-Variable -Name IsWindows -ValueOnly) }
  return $env:OS -eq 'Windows_NT'
}

function Test-XrInteractive {
  try { return ([Console]::IsInputRedirected -eq $false) -and ([Console]::IsOutputRedirected -eq $false) }
  catch { return $false }
}

# The user's profile directory, or $null when none is usable. XR-LAUNCH-025:
# this used to fall back to the CURRENT directory, so an install from a shell
# without a profile landed wherever the user happened to be standing.
function Get-XrHomeDirectory {
  $candidates = @($env:USERPROFILE)
  if (Test-Path Variable:\HOME) { $candidates += (Get-Variable -Name HOME -ValueOnly) }
  foreach ($h in $candidates) {
    if ($h -and [IO.Path]::IsPathRooted($h) -and (Test-Path -LiteralPath $h -PathType Container)) { return $h.TrimEnd('\', '/') }
  }
  return $null
}

function Get-XrNormalPath {
  param([string]$Path)
  $full = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($full)
  if ($full.Length -gt $root.Length) { $full = $full.TrimEnd('\', '/') }
  return $full
}

# Launch audit XR-LAUNCH-025: resolve the install directory.
# -TargetDirectory > $env:XR_INSTALL_DIR > <profile>\.xr-agent. XR_HOME is the
# DATA home and no longer selects the install directory.
function Resolve-XrInstallTarget {
  param([string]$TargetDirectory)
  $profileDir = Get-XrHomeDirectory
  $dataHome = if ($env:XR_HOME) { $env:XR_HOME } elseif ($profileDir) { Join-Path $profileDir '.xr' } else { $null }
  $chosen = $TargetDirectory
  if (-not $chosen -and $env:XR_INSTALL_DIR) { $chosen = $env:XR_INSTALL_DIR }
  if (-not $chosen) {
    if (-not $profileDir) {
      Stop-XrInstall 'No user profile directory found (USERPROFILE is unset or does not exist). Set USERPROFILE, or pass -TargetDirectory / set XR_INSTALL_DIR. Nothing was installed.'
    }
    $chosen = Join-Path $profileDir '.xr-agent'
    if ($env:XR_HOME) {
      Write-XrWarn "XR_HOME ($env:XR_HOME) is XR's data home; program files go to $chosen. Set XR_INSTALL_DIR or pass -TargetDirectory to choose the install directory."
      if (Test-Path -LiteralPath (Join-Path $env:XR_HOME $XrInstallMarker)) {
        Write-XrWarn "An older installer put XR's program files inside the data home ($env:XR_HOME). They are left untouched; remove src, node_modules, dist and bin-local there once this install works."
      }
    }
  }
  if ($chosen -match '["`$%\r\n]') {
    Stop-XrInstall 'The install directory may not contain quotes, backticks, $, % or newlines. Nothing was installed.'
  }
  # Drive-relative paths (\foo) are rooted per .NET but resolve against the current drive.
  $driveRelative = ([IO.Path]::DirectorySeparatorChar -eq '\') -and ($chosen -match '^[\\/](?![\\/])')
  if (-not [IO.Path]::IsPathRooted($chosen) -or $driveRelative) {
    Stop-XrInstall "The install directory ('$chosen') must be an absolute path such as C:\Tools\xr. Nothing was installed."
  }
  $target = Get-XrNormalPath $chosen
  $cmp = { param($a, $b) [string]::Equals($a, $b, [StringComparison]::OrdinalIgnoreCase) }
  if (& $cmp $target ([IO.Path]::GetPathRoot($target))) {
    Stop-XrInstall "Refusing to install into a drive root ($target). Choose a dedicated directory. Nothing was installed."
  }
  if ($profileDir -and (& $cmp $target (Get-XrNormalPath $profileDir))) {
    Stop-XrInstall "Refusing to install into your profile directory itself. Use a dedicated directory such as $(Join-Path $profileDir '.xr-agent'). Nothing was installed."
  }
  if ($dataHome) {
    $data = Get-XrNormalPath $dataHome
    $sep = [IO.Path]::DirectorySeparatorChar
    if ((& $cmp $target $data) -or $target.StartsWith("$data$sep", [StringComparison]::OrdinalIgnoreCase)) {
      Stop-XrInstall "The install directory ($target) is XR's data home or inside it ($data). Program files and data must stay separate; choose another directory. Nothing was installed."
    }
    if ($data.StartsWith("$target$sep", [StringComparison]::OrdinalIgnoreCase)) {
      Stop-XrInstall "The install directory ($target) contains XR's data home ($data). Choose a dedicated directory. Nothing was installed."
    }
  }
  return $target
}

function Confirm-XrAction {
  param([string]$Question, [bool]$DefaultYes = $true, [bool]$AssumeYes = $false)
  if ($AssumeYes) { return $DefaultYes }
  if (-not (Test-XrInteractive)) { return $false }
  $suffix = if ($DefaultYes) { '[Y/n]' } else { '[y/N]' }
  $answer = Read-Host "$Question $suffix"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $DefaultYes }
  return $answer.Trim().ToLowerInvariant().StartsWith('y')
}

function Update-XrSessionPath {
  $profileDir = Get-XrHomeDirectory
  if ($profileDir) {
    $bunBin = Join-Path $profileDir '.bun\bin'
    if (Test-Path $bunBin) { $env:Path = "$bunBin;$env:Path" }
  }
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath) { $env:Path = "$userPath;$env:Path" }
}

function Get-XrBinaryName {
  $osTag = if (Test-XrOnWindows) { 'windows' } else { 'unknown' }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
  return "xr-$osTag-$arch.exe"
}

function Test-XrVersionString {
  param([string]$Value)
  return $Value -match '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
}

function Get-XrReleaseBase {
  param([string]$ReleaseVersion)
  # Mirror / hermetic-test override (XR-LAUNCH-011 clean-machine journey). Only
  # https:// or loopback http:// is accepted, and SHA256SUMS is still verified.
  $override = "$env:XR_INSTALL_BASE_URL".TrimEnd('/')
  if ($override) {
    if ($override -notmatch '^https://\S+$' -and $override -notmatch '^http://(127\.0\.0\.1|localhost)(:\d+)?(/\S*)?$') {
      Stop-XrInstall "XR_INSTALL_BASE_URL must be an https:// or loopback http:// URL. Nothing was installed."
    }
    return "$override/v$ReleaseVersion"
  }
  return "https://github.com/$XrRepo/releases/download/v$ReleaseVersion"
}

function Get-XrSha256 {
  param([string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Expected sha256 for an asset from the release's SHA256SUMS ($null when absent).
function Get-XrExpectedSha {
  param([string]$SumsPath, [string]$Name)
  foreach ($line in Get-Content -LiteralPath $SumsPath) {
    $parts = $line.Trim() -split '\s+'
    if ($parts.Count -ge 2 -and $parts[1].TrimStart('*') -eq $Name) { return $parts[0].ToLowerInvariant() }
  }
  return $null
}

# True when the target is absent, empty, or provably an XR install (installer
# marker, an XR source tree, or only the dist\ folder an older installer left).
function Test-XrTargetIsOurs {
  param([string]$TargetDirectory)
  if (-not (Test-Path -LiteralPath $TargetDirectory)) { return $true }
  if (-not (Test-Path -LiteralPath $TargetDirectory -PathType Container)) { return $false }
  if (Test-Path -LiteralPath (Join-Path $TargetDirectory $XrInstallMarker)) { return $true }
  $pkg = Join-Path $TargetDirectory 'package.json'
  if ((Test-Path -LiteralPath $pkg) -and ((Get-Content -LiteralPath $pkg -Raw) -match '"name":\s*"@rrrtx/xr"')) { return $true }
  $others = @(Get-ChildItem -LiteralPath $TargetDirectory -Force | Where-Object { $_.Name -ne 'dist' })
  if ($others.Count -gt 0) { return $false }
  $dist = Join-Path $TargetDirectory 'dist'
  if (-not (Test-Path -LiteralPath $dist)) { return $true }
  $foreign = @(Get-ChildItem -LiteralPath $dist -Force | Where-Object { $_.Name -notlike 'xr-*' -and $_.Name -ne '.sha256sums.tmp' })
  return ($foreign.Count -eq 0)
}

function Write-XrInstallMarker {
  param([string]$TargetDirectory, [string]$ReleaseVersion, [string]$Method)
  Set-Content -LiteralPath (Join-Path $TargetDirectory $XrInstallMarker) -Encoding ASCII -Value "version=$ReleaseVersion`nmethod=$Method`nrepo=$XrRepo`n"
}

# Download the release's SHA256SUMS into the staging directory. Missing release
# = hard stop with nothing installed; there is no unpinned fallback.
function Get-XrReleaseSums {
  param([string]$ReleaseVersion, [string]$Stage)
  $base = Get-XrReleaseBase -ReleaseVersion $ReleaseVersion
  $sumsPath = Join-Path $Stage 'SHA256SUMS'
  Write-XrStep "Fetching release checksums for v$ReleaseVersion"
  try {
    Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sumsPath -UseBasicParsing -ErrorAction Stop | Out-Null
  } catch {
    Stop-XrInstall "XR v$ReleaseVersion is not available from GitHub Releases (no SHA256SUMS at $base). Release checksums unavailable - refusing an unverified install. Nothing was installed. See https://github.com/$XrRepo/releases or pass -ReleaseVersion <published version>."
  }
  if ((Get-Item -LiteralPath $sumsPath).Length -eq 0) { Stop-XrInstall "SHA256SUMS for v$ReleaseVersion is empty. Nothing was installed." }
  return $sumsPath
}

# Returns $true when the verified binary is installed; $false when this
# release has no usable binary for the platform (the caller then installs the
# verified source archive). A checksum mismatch is fatal, never a fallback.
function Install-XrBinary {
  param([string]$TargetDirectory, [string]$ReleaseVersion, [string]$Stage, [string]$SumsPath)
  $name = Get-XrBinaryName
  if (-not $name) { return $false }
  $expect = Get-XrExpectedSha -SumsPath $SumsPath -Name $name
  if (-not $expect) {
    Write-XrWarn "No checksum entry for $name in SHA256SUMS - refusing the unverified binary."
    return $false
  }
  $base = Get-XrReleaseBase -ReleaseVersion $ReleaseVersion
  $staged = Join-Path $Stage $name
  Write-XrStep "Downloading compiled binary v$ReleaseVersion ($name)"
  try {
    Invoke-WebRequest -Uri "$base/$name" -OutFile $staged -UseBasicParsing -ErrorAction Stop | Out-Null
  } catch {
    Write-XrWarn "Binary download unavailable ($name)."
    return $false
  }
  $actual = Get-XrSha256 -Path $staged
  if ($actual -ne $expect) {
    Stop-XrInstall "Integrity check FAILED for $name (sha256 $actual != published $expect). Refusing the binary (possible tampering). Nothing was installed."
  }
  $createdTarget = -not (Test-Path -LiteralPath $TargetDirectory)
  $distDir = Join-Path $TargetDirectory 'dist'
  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  # Keep the binary's own extension LAST (.partial-xr-windows-x64.exe): Windows
  # only executes a file whose extension is in PATHEXT, so a '.exe.partial'
  # candidate could never pass the run check below.
  $partial = Join-Path $distDir ".partial-$name"
  Move-Item -LiteralPath $staged -Destination $partial -Force
  $ran = $false
  try { & $partial --version 2>$null | Out-Null; $ran = ($LASTEXITCODE -eq 0) } catch { $ran = $false }
  if (-not $ran) {
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    if (-not (Get-ChildItem -LiteralPath $distDir -Force)) { Remove-Item -LiteralPath $distDir -Force -ErrorAction SilentlyContinue }
    if ($createdTarget -and -not (Get-ChildItem -LiteralPath $TargetDirectory -Force)) { Remove-Item -LiteralPath $TargetDirectory -Force -ErrorAction SilentlyContinue }
    Write-XrWarn 'Binary failed to run on this system.'
    return $false
  }
  Move-Item -LiteralPath $partial -Destination (Join-Path $distDir $name) -Force
  Write-XrInstallMarker -TargetDirectory $TargetDirectory -ReleaseVersion $ReleaseVersion -Method 'binary'
  Write-XrOk "Compiled binary installed and verified ($name, v$ReleaseVersion)"
  return $true
}

# Bun is only needed for the source install (the binary path never calls this).
# -BunVersion = the Bun the release was built with (its .bun-version), if known.
function Install-XrBunRuntime {
  param([bool]$AssumeYes, [string]$BunVersion)
  Update-XrSessionPath
  if (Get-Command bun -ErrorAction SilentlyContinue) {
    $have = "$(bun --version)".Trim()
    Write-XrOk "Bun $have"
    if ($BunVersion -and $have -ne $BunVersion) {
      Write-XrWarn "This release was built with Bun $BunVersion; you have Bun $have. If the install fails, install Bun $BunVersion from https://bun.sh."
    }
    return
  }
  if ($BunVersion) { Write-XrWarn "The source install needs Bun $BunVersion." } else { Write-XrWarn 'The source install needs Bun.' }
  Write-XrStep 'Bun install is user-level and downloads from https://bun.sh.'
  if (-not (Confirm-XrAction -Question 'Install Bun now?' -DefaultYes $true -AssumeYes $AssumeYes)) {
    Stop-XrInstall 'Bun is required for the source install. Install it from https://bun.sh and rerun this installer. Nothing was installed.'
  }
  $bunScript = Join-Path ([IO.Path]::GetTempPath()) ("bun-install-" + [Guid]::NewGuid().ToString('n') + ".ps1")
  try {
    Invoke-WebRequest -Uri 'https://bun.sh/install.ps1' -OutFile $bunScript -UseBasicParsing -ErrorAction Stop
    if ($BunVersion) {
      # Pinned to the release's Bun (XR-LAUNCH-025).
      & powershell -NoProfile -ExecutionPolicy Bypass -File $bunScript -Version $BunVersion
    } else {
      Write-XrWarn 'This release does not record its Bun version; installing the latest Bun.'
      & powershell -NoProfile -ExecutionPolicy Bypass -File $bunScript
    }
  } finally {
    Remove-Item $bunScript -Force -ErrorAction SilentlyContinue
  }
  Update-XrSessionPath
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Stop-XrInstall 'Bun installed but is not on PATH. Open a new PowerShell window and rerun this installer.'
  }
  Write-XrOk "Bun $(bun --version)"
}

# Source install from the SAME pinned release (never a branch): verify the
# archive, install dependencies from the frozen lockfile in a sibling staging
# tree, then swap it into place. The previous tree is kept, never deleted.
function Install-XrSource {
  param([string]$TargetDirectory, [string]$ReleaseVersion, [string]$Stage, [string]$SumsPath, [bool]$AssumeYes)
  $asset = 'xr-source.tar.gz'
  $expect = Get-XrExpectedSha -SumsPath $SumsPath -Name $asset
  if (-not $expect) { Stop-XrInstall "Release v$ReleaseVersion has no checksum for $asset - refusing an unverified source install. Nothing was installed." }
  if (-not (Get-Command tar -ErrorAction SilentlyContinue)) { Stop-XrInstall 'tar.exe is required for the source install (built into Windows 10 1803 and later).' }
  $archive = Join-Path $Stage $asset
  Write-XrStep "Downloading source archive v$ReleaseVersion"
  try {
    Invoke-WebRequest -Uri "$(Get-XrReleaseBase -ReleaseVersion $ReleaseVersion)/$asset" -OutFile $archive -UseBasicParsing -ErrorAction Stop | Out-Null
  } catch {
    Stop-XrInstall "Could not download $asset for v$ReleaseVersion. Nothing was installed."
  }
  $actual = Get-XrSha256 -Path $archive
  if ($actual -ne $expect) { Stop-XrInstall "Integrity check FAILED for $asset (sha256 $actual != published $expect). Nothing was installed." }
  Write-XrOk 'Source archive verified'

  $parent = Split-Path $TargetDirectory -Parent
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $newTree = "$($TargetDirectory.TrimEnd('\','/')).new-" + [Guid]::NewGuid().ToString('n')
  New-Item -ItemType Directory -Force -Path $newTree | Out-Null
  try {
    tar -xzf $archive -C $newTree
    if ($LASTEXITCODE -ne 0) { Stop-XrInstall "Could not unpack $asset (tar exit $LASTEXITCODE). Nothing was installed." }
    if (-not (Test-Path -LiteralPath (Join-Path $newTree 'src\index.ts'))) { Stop-XrInstall "Source archive v$ReleaseVersion has no src\index.ts. Nothing was installed." }
    if (-not (Test-Path -LiteralPath (Join-Path $newTree 'bun.lock'))) { Stop-XrInstall "Source archive v$ReleaseVersion has no bun.lock; refusing a non-reproducible install. Nothing was installed." }
    # Use the Bun this release was built with (XR-LAUNCH-025).
    $bunPin = ''
    $bunVersionFile = Join-Path $newTree '.bun-version'
    if (Test-Path -LiteralPath $bunVersionFile) {
      $bunPin = (Get-Content -LiteralPath $bunVersionFile -Raw).Trim()
      if ($bunPin -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { $bunPin = '' }
    }
    Install-XrBunRuntime -AssumeYes $AssumeYes -BunVersion $bunPin
    Install-XrDependencies -TargetDirectory $newTree

    if (Test-Path -LiteralPath $TargetDirectory) {
      $stamp = Get-Date -Format 'yyyyMMddHHmmss'
      $previous = "$($TargetDirectory.TrimEnd('\','/')).previous"
      if (Test-Path -LiteralPath (Join-Path $TargetDirectory '.git')) {
        $previous = "$($TargetDirectory.TrimEnd('\','/')).backup-$stamp"
      } elseif (Test-Path -LiteralPath $previous) {
        if (Test-Path -LiteralPath (Join-Path $previous $XrInstallMarker)) { Remove-Item -LiteralPath $previous -Recurse -Force }
        else { $previous = "$($TargetDirectory.TrimEnd('\','/')).previous-$stamp" }
      }
      Move-Item -LiteralPath $TargetDirectory -Destination $previous
      Write-XrWarn "Kept your previous install at $previous (remove it once the new install works)."
    }
    Move-Item -LiteralPath $newTree -Destination $TargetDirectory
  } finally {
    if (Test-Path -LiteralPath $newTree) { Remove-Item -LiteralPath $newTree -Recurse -Force -ErrorAction SilentlyContinue }
  }
  Write-XrInstallMarker -TargetDirectory $TargetDirectory -ReleaseVersion $ReleaseVersion -Method 'source'
  Write-XrOk "Source install v$ReleaseVersion placed at $TargetDirectory"
}

function Install-XrDependencies {
  param([string]$TargetDirectory)
  Write-XrStep 'Installing XR package dependencies (frozen lockfile)'
  # Supply-chain hardening (matches CI): never run package lifecycle scripts
  # during install, and never resolve versions outside the release's bun.lock.
  # Override scripts with XR_INSTALL_ALLOW_SCRIPTS=1 only if you understand the risk.
  $allowScripts = $env:XR_INSTALL_ALLOW_SCRIPTS -eq '1'
  $installArgs = @('install', '--frozen-lockfile')
  if (-not $allowScripts) {
    $installArgs += '--ignore-scripts'
  } else {
    Write-XrWarn 'XR_INSTALL_ALLOW_SCRIPTS=1 - package lifecycle scripts WILL run during install (supply-chain risk).'
  }
  Push-Location $TargetDirectory
  try {
    bun @installArgs
    if ($LASTEXITCODE -ne 0) { Stop-XrInstall "bun $($installArgs -join ' ') failed (exit $LASTEXITCODE). Nothing was installed." }
  } finally {
    Pop-Location
  }
  Write-XrOk 'Dependencies installed'
}

# The raw user Path (HKCU\Environment, %VAR% entries unexpanded). [Environment]::Get/SetEnvironmentVariable
# would expand every %VAR% entry and store REG_SZ, permanently flattening the user's Path.
function Get-XrUserPathRaw {
  if (-not (Test-XrOnWindows)) { return '' }
  $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
  if (-not $k) { return '' }
  try { return [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $k.Close() }
}
function Set-XrUserPathRaw([string]$Value) {
  if (-not (Test-XrOnWindows)) { return }
  $k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
  try {
    $kind = if ($null -ne $k.GetValue('Path') -and $k.GetValueKind('Path') -eq 'String') { 'String' } else { 'ExpandString' }
    $k.SetValue('Path', $Value, [Microsoft.Win32.RegistryValueKind]$kind)
  } finally { $k.Close() }
  # A bare registry write notifies nobody; a scratch user-variable set/clear broadcasts WM_SETTINGCHANGE.
  [Environment]::SetEnvironmentVariable('XR_PATH_BROADCAST', '1', 'User'); [Environment]::SetEnvironmentVariable('XR_PATH_BROADCAST', $null, 'User')
}

function Install-XrLauncher {
  param([string]$TargetDirectory)
  $binDir = Join-Path $TargetDirectory 'bin-local'
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $ps1 = Join-Path $binDir 'xr.ps1'
  $cmd = Join-Path $binDir 'xr.cmd'
  $entry = Join-Path $TargetDirectory 'src\index.ts'
  $binary = Join-Path $TargetDirectory ("dist\" + (Get-XrBinaryName))
  # Phase 3 - T2: compiled binary first (default distribution path), Bun source fallback.
  # XR_INSTALL_DIR tells `xr uninstall` / `xr update` where the program files live (XR-LAUNCH-025).
  $ps1Body = @(
    "`$env:XR_INSTALL_DIR = '$($TargetDirectory.Replace("'", "''"))'",
    "if (Test-Path -LiteralPath `"$binary`") { & `"$binary`" @args; exit `$LASTEXITCODE }",
    "if (Test-Path -LiteralPath `"$entry`") { & bun run `"$entry`" @args; exit `$LASTEXITCODE }",
    "Write-Error 'xr: no XR install found at $TargetDirectory. Rerun the installer.'; exit 127"
  ) -join "`n"
  Set-Content -Path $ps1 -Encoding UTF8 -Value $ps1Body
  # exit /b inside each parsed block: cmd.exe re-reads a batch file from disk, and `xr uninstall`
  # deletes this file - so it must never go back to it (bare exit /b keeps xr's exit code).
  Set-Content -Path $cmd -Encoding ASCII -Value "@echo off`r`nsetlocal`r`nset `"XR_INSTALL_DIR=$TargetDirectory`"`r`nif exist `"$binary`" (`r`n  `"$binary`" %*`r`n  exit /b`r`n) else if exist `"$entry`" (`r`n  bun run `"$entry`" %*`r`n  exit /b`r`n) else (`r`n  echo xr: no XR install found at $TargetDirectory. Rerun the installer. 1>&2`r`n  exit /b 127`r`n)`r`n"

  # PATH hygiene: append only when genuinely absent, compare case-insensitively
  # and ignore trailing separators, and never write back a PATH we failed to
  # read (that would silently truncate the user's PATH).
  $userPath = Get-XrUserPathRaw
  $entries = @()
  if ($userPath) { $entries = $userPath -split ';' | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') } }
  if ($entries -notcontains $binDir.TrimEnd('\')) {
    $newPath = if ($userPath) { "$userPath;$binDir" } else { $binDir }
    Set-XrUserPathRaw $newPath
    $env:Path = "$env:Path;$binDir"
    Write-XrOk "Added XR launcher to user PATH: $binDir"
  } else {
    Write-XrOk "XR launcher already on PATH: $binDir"
  }
}

function Invoke-XrInstall {
  [CmdletBinding()]
  param(
    # Non-interactive: accept the default answer for every prompt.
    [switch]$AssumeYes,
    # Allow system-level (elevated) operations in the XR setup wizard.
    [switch]$AllowSystem,
    # Setup profile. ValidateSet is safe HERE because function parameter
    # binding only validates a value that is actually supplied.
    [ValidateSet('minimal', 'local', 'byok', 'hybrid', 'full')]
    [string]$InstallMode,
    # Install location. Defaults to $env:XR_INSTALL_DIR, else <user profile>\.xr-agent
    # ($env:XR_HOME is the DATA home and never receives program files; XR-LAUNCH-025).
    [string]$TargetDirectory,
    # Published release to install (default: the stamped public version; also $env:XR_INSTALL_VERSION).
    [string]$ReleaseVersion,
    # Skip the compiled binary and install the release's verified source archive.
    [switch]$FromSource
  )

  if (-not (Test-XrOnWindows)) {
    Stop-XrInstall 'install.ps1 is the Windows bootstrapper. On macOS/Linux use: curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash'
  }
  if ($PSVersionTable.PSVersion.Major -lt 5) {
    Stop-XrInstall "PowerShell 5.1 or newer is required (found $($PSVersionTable.PSVersion)). Install Windows Management Framework 5.1 or PowerShell 7."
  }
  # TLS 1.2 is not the default on stock Windows PowerShell 5.1; without this
  # every Invoke-WebRequest to GitHub fails with an opaque connection error.
  try {
    if ([Net.ServicePointManager]::SecurityProtocol -notmatch 'Tls12') {
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    }
  } catch {
    Write-XrWarn 'Could not enable TLS 1.2 explicitly; downloads may fail on older systems.'
  }

  $TargetDirectory = Resolve-XrInstallTarget -TargetDirectory $TargetDirectory
  $installVersion = $Version
  if ($ReleaseVersion) { $installVersion = $ReleaseVersion } elseif ($env:XR_INSTALL_VERSION) { $installVersion = $env:XR_INSTALL_VERSION }
  $installVersion = $installVersion.TrimStart('v')
  if (-not (Test-XrVersionString -Value $installVersion)) {
    Stop-XrInstall "Invalid version '$installVersion'. Use a published release such as -ReleaseVersion 1.0.0."
  }

  Write-Host ""
  Write-Host "  XR Installer v$installVersion" -ForegroundColor Cyan
  Write-Host "  Windows - PowerShell $($PSVersionTable.PSVersion) - Target: $TargetDirectory" -ForegroundColor DarkGray
  Write-Host ""
  Write-XrStep "This downloads XR v$installVersion from GitHub Releases, verifies it against the release's SHA256SUMS, and creates an xr launcher."
  Write-XrStep 'Optional Ollama, voice, browser and desktop-control packs are handled later by xr install prompts.'
  if (-not (Test-XrTargetIsOurs -TargetDirectory $TargetDirectory)) {
    Stop-XrInstall "$TargetDirectory exists and is not an XR install. Use -TargetDirectory or set XR_INSTALL_DIR. Nothing was changed."
  }
  if (-not (Confirm-XrAction -Question 'Continue?' -DefaultYes $true -AssumeYes $AssumeYes.IsPresent)) {
    Stop-XrInstall 'Cancelled by user.'
  }

  # Everything is downloaded and verified in a private staging directory
  # first; the target is only touched once an artifact has verified.
  $stage = Join-Path ([IO.Path]::GetTempPath()) ("xr-install-" + [Guid]::NewGuid().ToString('n'))
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  try {
    $sumsPath = Get-XrReleaseSums -ReleaseVersion $installVersion -Stage $stage
    $binaryInstalled = $false
    if (-not $FromSource) {
      $binaryInstalled = Install-XrBinary -TargetDirectory $TargetDirectory -ReleaseVersion $installVersion -Stage $stage -SumsPath $sumsPath
    }
    if ($binaryInstalled) {
      Write-XrStep 'Using the compiled binary distribution (source install skipped).'
    } else {
      Install-XrSource -TargetDirectory $TargetDirectory -ReleaseVersion $installVersion -Stage $stage -SumsPath $sumsPath -AssumeYes $AssumeYes.IsPresent
    }
  } finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
  Install-XrLauncher -TargetDirectory $TargetDirectory

  $xrCmd = Join-Path $TargetDirectory 'bin-local\xr.cmd'
  $wizardArgs = @('install', '--from-bootstrap')
  if ($InstallMode) { $wizardArgs += @('--mode', $InstallMode) }
  if ($AssumeYes) { $wizardArgs += '--yes' }
  if ($AllowSystem) { $wizardArgs += '--allow-system' }
  & $xrCmd @wizardArgs
  if ($LASTEXITCODE -ne 0) { Write-XrWarn 'XR installed, but the setup wizard reported issues. Run: xr doctor' }

  Write-Host ""
  Write-XrOk "XR v$installVersion installed. Open a new PowerShell window and run: xr doctor"
}

# ---------------------------------------------------------------------------
# Dispatch.
#
# Under `iex (irm ...)` there are no arguments and no script file, so this just
# runs an interactive install in the caller's session. Running the file
# (`.\install.ps1 -AssumeYes -InstallMode minimal`) forwards $args to the
# function, where ValidateSet performs real parameter binding.
#
# Errors: Stop-XrInstall throws. When executed with -File, an uncaught throw
# already sets exit code 1 (verified on PowerShell 7 and 5.1 semantics), so we
# deliberately do NOT call `exit` here -- under `iex` that would terminate the
# user's interactive console. Dot-sourcing (`. .\install.ps1`) defines the
# functions without running anything.
if ($MyInvocation.InvocationName -ne '.') {
  if ($args.Count -gt 0) { Invoke-XrInstall @args } else { Invoke-XrInstall }
}
