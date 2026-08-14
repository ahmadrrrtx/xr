# XR Stage 2 — native Windows bootstrapper.
#
# Remote (documented, tested):
#   iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)
#
# Local file (also supported, with arguments):
#   .\install.ps1 -AssumeYes -InstallMode minimal -TargetDirectory C:\tools\xr
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
$XrBranch = 'main'
$Version = '1.0.0'

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

function Get-XrHomeDirectory {
  if ($env:USERPROFILE) { return $env:USERPROFILE }
  if (Test-Path Variable:\HOME) { $h = Get-Variable -Name HOME -ValueOnly; if ($h) { return $h } }
  return (Get-Location).Path
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
  $bunBin = Join-Path (Get-XrHomeDirectory) '.bun\bin'
  if (Test-Path $bunBin) { $env:Path = "$bunBin;$env:Path" }
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath) { $env:Path = "$userPath;$env:Path" }
}

function Get-XrBinaryName {
  $osTag = if (Test-XrOnWindows) { 'windows' } else { 'unknown' }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
  return "xr-$osTag-$arch.exe"
}

# Phase 3 - T2: download the standalone binary (default distribution path).
# Phase 9 - Part 20: verified-only. Install ONLY when sha256 matches the
# release's SHA256SUMS (fail closed); otherwise fall back to source.
function Install-XrBinary {
  param([string]$TargetDirectory)
  $name = Get-XrBinaryName
  if (-not $name) { return $false }
  $base = "https://github.com/$XrRepo/releases/download/v$Version"
  $url = "$base/$name"
  $distDir = Join-Path $TargetDirectory 'dist'
  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  Write-XrStep "Downloading compiled binary v$Version ($name)"
  $sumsPath = Join-Path $distDir '.sha256sums.tmp'
  $binaryPath = Join-Path $distDir $name
  try {
    Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sumsPath -UseBasicParsing -ErrorAction Stop | Out-Null
  } catch {
    Write-XrWarn 'Release checksums unavailable - refusing an unverified binary; falling back to source.'
    Remove-Item $sumsPath -Force -ErrorAction SilentlyContinue
    return $false
  }
  try {
    Invoke-WebRequest -Uri $url -OutFile $binaryPath -UseBasicParsing -ErrorAction Stop | Out-Null
  } catch {
    Write-XrWarn 'Binary download unavailable; falling back to source checkout.'
    Remove-Item $sumsPath -Force -ErrorAction SilentlyContinue
    return $false
  }
  $expect = $null
  foreach ($line in Get-Content $sumsPath) {
    $parts = $line.Trim() -split '\s+'
    if ($parts.Count -ge 2 -and $parts[1].TrimStart('*') -eq $name) { $expect = $parts[0]; break }
  }
  Remove-Item $sumsPath -Force -ErrorAction SilentlyContinue
  if (-not $expect) {
    Write-XrWarn "No checksum entry for $name in SHA256SUMS - refusing the unverified binary."
    Remove-Item $binaryPath -Force -ErrorAction SilentlyContinue
    return $false
  }
  $actual = (Get-FileHash $binaryPath -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expect.ToLower()) {
    Write-XrWarn "Integrity check FAILED for $name (sha256 $actual != published $expect). Refusing the binary (possible tampering)."
    Remove-Item $binaryPath -Force -ErrorAction SilentlyContinue
    return $false
  }
  & $binaryPath --version 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-XrOk "Compiled binary installed and verified ($name)"
    return $true
  }
  Write-XrWarn 'Binary failed to run; falling back to source checkout.'
  Remove-Item $binaryPath -Force -ErrorAction SilentlyContinue
  return $false
}

function Install-XrBunRuntime {
  param([bool]$AssumeYes)
  Update-XrSessionPath
  if (Get-Command bun -ErrorAction SilentlyContinue) {
    Write-XrOk "Bun $(bun --version)"
    return
  }
  Write-XrWarn 'Bun is required to run XR.'
  Write-XrStep 'Bun install is user-level and downloads from https://bun.sh.'
  if (-not (Confirm-XrAction -Question 'Install Bun now?' -DefaultYes $true -AssumeYes $AssumeYes)) {
    Stop-XrInstall 'Bun is required. Install it from https://bun.sh and rerun this installer.'
  }
  $bunScript = Join-Path $env:TEMP ("bun-install-" + [Guid]::NewGuid().ToString('n') + ".ps1")
  try {
    Invoke-WebRequest -Uri 'https://bun.sh/install.ps1' -OutFile $bunScript -UseBasicParsing -ErrorAction Stop
    & powershell -NoProfile -ExecutionPolicy Bypass -File $bunScript
  } finally {
    Remove-Item $bunScript -Force -ErrorAction SilentlyContinue
  }
  Update-XrSessionPath
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Stop-XrInstall 'Bun installed but is not on PATH. Open a new PowerShell window and rerun this installer.'
  }
  Write-XrOk "Bun $(bun --version)"
}

function Install-XrSource {
  param([string]$TargetDirectory)
  if (Test-Path (Join-Path $TargetDirectory '.git')) {
    Write-XrStep "Existing XR checkout found at $TargetDirectory"
    if (Get-Command git -ErrorAction SilentlyContinue) {
      Push-Location $TargetDirectory
      try {
        git fetch --quiet origin $XrBranch
        git pull --ff-only origin $XrBranch
      } catch {
        Write-XrWarn 'Git update failed; continuing with the existing checkout.'
      } finally {
        Pop-Location
      }
    } else {
      Write-XrWarn 'Git missing; cannot update the existing checkout.'
    }
    return
  }
  if ((Test-Path $TargetDirectory) -and ($null -ne (Get-ChildItem -LiteralPath $TargetDirectory -Force | Select-Object -First 1))) {
    Stop-XrInstall "$TargetDirectory exists and is not an XR git checkout. Use -TargetDirectory or set XR_HOME."
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $TargetDirectory -Parent) | Out-Null
  if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-XrStep "Cloning XR into $TargetDirectory"
    git clone --branch $XrBranch "https://github.com/$XrRepo.git" $TargetDirectory
    if ($LASTEXITCODE -ne 0) { Stop-XrInstall "git clone failed (exit $LASTEXITCODE)." }
  } else {
    Write-XrStep 'Git not found. Downloading the source archive instead; updates will require rerunning the installer.'
    $stage = Join-Path $env:TEMP ("xr-" + [Guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    try {
      $zip = Join-Path $stage 'xr.zip'
      Invoke-WebRequest -Uri "https://github.com/$XrRepo/archive/refs/heads/$XrBranch.zip" -OutFile $zip -UseBasicParsing
      Expand-Archive -Path $zip -DestinationPath $stage -Force
      $src = Join-Path $stage "xr-$XrBranch"
      if (-not (Test-Path $src)) { Stop-XrInstall 'Downloaded archive did not contain the expected source directory.' }
      New-Item -ItemType Directory -Force -Path $TargetDirectory | Out-Null
      Copy-Item -Path (Join-Path $src '*') -Destination $TargetDirectory -Recurse -Force
    } finally {
      Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Install-XrDependencies {
  param([string]$TargetDirectory)
  Write-XrStep 'Installing XR package dependencies'
  Push-Location $TargetDirectory
  try {
    bun install
    if ($LASTEXITCODE -ne 0) { Stop-XrInstall "bun install failed (exit $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }
  Write-XrOk 'Dependencies installed'
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
  Set-Content -Path $ps1 -Encoding UTF8 -Value "if (Test-Path `"$binary`") { & `"$binary`" @args; exit `$LASTEXITCODE }; & bun run `"$entry`" @args`nexit `$LASTEXITCODE`n"
  Set-Content -Path $cmd -Encoding ASCII -Value "@echo off`r`nif exist `"$binary`" (`r`n  `"$binary`" %*`r`n) else (`r`n  bun run `"$entry`" %*`r`n)`r`n"

  # PATH hygiene: append only when genuinely absent, compare case-insensitively
  # and ignore trailing separators, and never write back a PATH we failed to
  # read (that would silently truncate the user's PATH).
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @()
  if ($userPath) { $entries = $userPath -split ';' | ForEach-Object { $_.TrimEnd('\') } }
  if ($entries -notcontains $binDir.TrimEnd('\')) {
    $newPath = if ($userPath) { "$userPath;$binDir" } else { $binDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
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
    # Install location. Defaults to $env:XR_HOME, else <user profile>\.xr-agent.
    [string]$TargetDirectory
  )

  if (-not (Test-XrOnWindows)) {
    Stop-XrInstall 'install.ps1 is the Windows bootstrapper. On macOS/Linux use: curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | sh'
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

  if (-not $TargetDirectory) {
    $TargetDirectory = if ($env:XR_HOME) { $env:XR_HOME } else { Join-Path (Get-XrHomeDirectory) '.xr-agent' }
  }

  Write-Host ""
  Write-Host "  XR Stage 2 Installer v$Version" -ForegroundColor Cyan
  Write-Host "  Windows - PowerShell $($PSVersionTable.PSVersion) - Target: $TargetDirectory" -ForegroundColor DarkGray
  Write-Host ""
  Write-XrStep 'This will download XR from GitHub, install Bun dependencies, and create an xr launcher.'
  Write-XrStep 'Optional Ollama, voice, browser and desktop-control packs are handled later by xr install prompts.'
  if (-not (Confirm-XrAction -Question 'Continue?' -DefaultYes $true -AssumeYes $AssumeYes.IsPresent)) {
    Stop-XrInstall 'Cancelled by user.'
  }

  Install-XrBunRuntime -AssumeYes $AssumeYes.IsPresent
  if (Install-XrBinary -TargetDirectory $TargetDirectory) {
    Write-XrStep 'Using the compiled binary distribution (source checkout skipped).'
  } else {
    Install-XrSource -TargetDirectory $TargetDirectory
    Install-XrDependencies -TargetDirectory $TargetDirectory
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
  Write-XrOk 'XR bootstrap complete. Open a new PowerShell window and run: xr doctor'
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
