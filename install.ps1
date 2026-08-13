# XR Stage 2 — native Windows bootstrapper.
# Run: iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)
[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$AllowSystem,
  [ValidateSet('minimal','local','byok','hybrid','full')][string]$Mode = '',
  [string]$TargetDir = $(if ($env:XR_HOME) { $env:XR_HOME } else { Join-Path $HOME '.xr-agent' })
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = 'ahmadrrrtx/xr'
$Branch = 'main'
$Version = '1.0.0'

function Step($m) { Write-Host "  ▸ $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "  ✓ $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "  ✗ $m" -ForegroundColor Red; exit 1 }
function IsTty { return [Console]::IsInputRedirected -eq $false -and [Console]::IsOutputRedirected -eq $false }
function AskYes([string]$Question, [bool]$DefaultYes = $true) {
  if ($Yes) { return $DefaultYes }
  if (-not (IsTty)) { return $false }
  $suffix = if ($DefaultYes) { '[Y/n]' } else { '[y/N]' }
  $answer = Read-Host "$Question $suffix"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $DefaultYes }
  return $answer.Trim().ToLowerInvariant().StartsWith('y')
}

function Refresh-Path {
  $bunBin = Join-Path $HOME '.bun\bin'
  if (Test-Path $bunBin) { $env:Path = "$bunBin;$env:Path" }
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath) { $env:Path = "$userPath;$env:Path" }
}

function Get-XrBinaryName {
  $os = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'windows' } else { 'unknown' }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
  return "xr-$os-$arch.exe"
}

# Phase 3 · T2 — download the standalone binary (default distribution path).
# Phase 9 · Part 20 — verified-only: install ONLY when sha256 matches the
# release's SHA256SUMS (fail closed); otherwise fall back to source.
function Fetch-XrBinary {
  $name = Get-XrBinaryName
  if (-not $name) { return $false }
  $base = "https://github.com/$Repo/releases/download/v$Version"
  $url = "$base/$name"
  $distDir = Join-Path $TargetDir 'dist'
  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  Step "Downloading compiled binary v$Version ($name)"
  $sumsPath = Join-Path $distDir '.sha256sums.tmp'
  try {
    Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sumsPath -UseBasicParsing -ErrorAction Stop | Out-Null
  } catch {
    Warn 'Release checksums unavailable - refusing an unverified binary; falling back to source.'
    Remove-Item $sumsPath -Force -ErrorAction SilentlyContinue
    return $false
  }
  try {
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $distDir $name) -UseBasicParsing -ErrorAction Stop | Out-Null
  } catch {
    Warn 'Binary download unavailable; falling back to source checkout.'
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
    Warn "No checksum entry for $name in SHA256SUMS - refusing the unverified binary."
    Remove-Item (Join-Path $distDir $name) -Force -ErrorAction SilentlyContinue
    return $false
  }
  $actual = (Get-FileHash (Join-Path $distDir $name) -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expect.ToLower()) {
    Warn "Integrity check FAILED for $name (sha256 $actual ≠ published $expect). Refusing the binary (possible tampering)."
    Remove-Item (Join-Path $distDir $name) -Force -ErrorAction SilentlyContinue
    return $false
  }
  $probe = & (Join-Path $distDir $name) --version 2>$null
  if ($LASTEXITCODE -eq 0) {
    Ok "Compiled binary installed and verified ($name)"
    return $true
  }
  Warn 'Binary failed to run; falling back to source checkout.'
  Remove-Item (Join-Path $distDir $name) -Force -ErrorAction SilentlyContinue
  return $false
}

function Ensure-Bun {
  Refresh-Path
  if (Get-Command bun -ErrorAction SilentlyContinue) {
    Ok "Bun $(bun --version)"
    return
  }
  Warn 'Bun is required to run XR.'
  Step 'Bun install is user-level and downloads from https://bun.sh.'
  if (-not (AskYes 'Install Bun now?' $true)) { Die 'Install Bun from https://bun.sh and rerun this installer.' }
  $script = Join-Path $env:TEMP 'bun-install.ps1'
  Invoke-WebRequest -Uri 'https://bun.sh/install.ps1' -OutFile $script -UseBasicParsing
  & powershell -NoProfile -ExecutionPolicy Bypass -File $script
  Remove-Item $script -Force -ErrorAction SilentlyContinue
  Refresh-Path
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { Die 'Bun installed but is not on PATH. Open a new PowerShell window and rerun.' }
  Ok "Bun $(bun --version)"
}

function Fetch-Repo {
  if (Test-Path (Join-Path $TargetDir '.git')) {
    Step "Existing XR checkout found at $TargetDir"
    if (Get-Command git -ErrorAction SilentlyContinue) {
      Push-Location $TargetDir
      try { git fetch --quiet origin $Branch; git pull --ff-only origin $Branch } catch { Warn 'Git update failed; continuing with existing checkout.' }
      Pop-Location
    } else { Warn 'Git missing; cannot update existing checkout.' }
    return
  }
  if ((Test-Path $TargetDir) -and ((Get-ChildItem -LiteralPath $TargetDir -Force | Select-Object -First 1) -ne $null)) {
    Die "$TargetDir exists and is not an XR git checkout. Use -TargetDir or set XR_HOME."
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $TargetDir -Parent) | Out-Null
  if (Get-Command git -ErrorAction SilentlyContinue) {
    Step "Cloning XR into $TargetDir"
    git clone --branch $Branch "https://github.com/$Repo.git" $TargetDir
  } else {
    Step 'Git not found. Downloading source archive instead. Updates will require rerunning the installer.'
    $tmp = Join-Path $env:TEMP ("xr-" + [Guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $zip = Join-Path $tmp 'xr.zip'
    Invoke-WebRequest -Uri "https://github.com/$Repo/archive/refs/heads/$Branch.zip" -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $src = Join-Path $tmp "xr-$Branch"
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    Copy-Item -Path (Join-Path $src '*') -Destination $TargetDir -Recurse -Force
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Install-Deps {
  Step 'Installing XR package dependencies'
  Push-Location $TargetDir
  try { bun install } finally { Pop-Location }
  Ok 'Dependencies installed'
}

function Install-Launcher {
  $binDir = Join-Path $TargetDir 'bin-local'
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $ps1 = Join-Path $binDir 'xr.ps1'
  $cmd = Join-Path $binDir 'xr.cmd'
  $entry = Join-Path $TargetDir 'src\index.ts'
  $name = Get-XrBinaryName
  $binary = Join-Path $TargetDir "dist\$name"
  # Phase 3 · T2 — compiled binary first (default distribution path), Bun source fallback.
  Set-Content -Path $ps1 -Encoding UTF8 -Value "if (Test-Path `"$binary`") { & `"$binary`" @args; exit `$LASTEXITCODE }; & bun run `"$entry`" @args`nexit `$LASTEXITCODE`n"
  Set-Content -Path $cmd -Encoding ASCII -Value "@echo off`r`nif exist `"$binary`" (`r`n  `"$binary`" %*`r`n) else (`r`n  bun run `"$entry`" %*`r`n)`r`n"
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not ($userPath -split ';' | Where-Object { $_ -eq $binDir })) {
    [Environment]::SetEnvironmentVariable('Path', ($(if ($userPath) { "$userPath;$binDir" } else { $binDir })), 'User')
    $env:Path = "$env:Path;$binDir"
    Ok "Added XR launcher to user PATH: $binDir"
  } else { Ok "XR launcher already on PATH: $binDir" }
}

Write-Host ""
Write-Host "  ▀▄▀ █▀█   XR Stage 2 Installer v$Version" -ForegroundColor Cyan
Write-Host "  Windows · Target: $TargetDir" -ForegroundColor DarkGray
Write-Host ""
Step 'This will download XR from GitHub, install Bun dependencies, and create an xr launcher.'
Step 'Optional Ollama, voice, browser and desktop-control packs are handled later by xr install prompts.'
if (-not (AskYes 'Continue?' $true)) { Die 'Cancelled.' }

Ensure-Bun
if (Fetch-XrBinary) {
  Step 'Using the compiled binary distribution (source checkout skipped).'
} else {
  Fetch-Repo
  Install-Deps
}
Install-Launcher

$xrCmd = Join-Path $TargetDir 'bin-local\xr.cmd'
$argsList = @('install', '--from-bootstrap')
if ($Mode) { $argsList += @('--mode', $Mode) }
if ($Yes) { $argsList += '--yes' }
if ($AllowSystem) { $argsList += '--allow-system' }
& $xrCmd @argsList
if ($LASTEXITCODE -ne 0) { Warn 'XR installed, but setup wizard reported issues. Run: xr doctor' }
Write-Host ""
Ok 'XR bootstrap complete. Open a new PowerShell window and run: xr doctor'
