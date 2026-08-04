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
$Version = '7.1.0'

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

# Phase 9 · T5 — verify the downloaded binary against the release SHA256SUMS.
# FAIL CLOSED: for releases >= 7.1.0 checksums are part of the release contract.
function Verify-XrBinary([string]$Name, [string]$Path) {
  $sumsUrl = "https://github.com/$Repo/releases/download/v$Version/SHA256SUMS"
  $sumsFile = Join-Path $env:TEMP ("xr-sums-" + [Guid]::NewGuid().ToString('n') + ".txt")
  try {
    Invoke-WebRequest -Uri $sumsUrl -OutFile $sumsFile -UseBasicParsing -ErrorAction Stop
  } catch {
    Remove-Item $sumsFile -Force -ErrorAction SilentlyContinue
    Die "Release SHA256SUMS unavailable for v$Version — refusing to install an integrity-unverified binary (docs/release/VERIFYING_RELEASES.md)."
  }
  $line = Get-Content $sumsFile | Where-Object { $_ -match "\s$([regex]::Escape($Name))$" } | Select-Object -First 1
  Remove-Item $sumsFile -Force -ErrorAction SilentlyContinue
  if (-not $line) { Die "SHA256SUMS has no entry for $Name — refusing (tamper-evidence)." }
  $expected = ($line -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) {
    Remove-Item $Path -Force -ErrorAction SilentlyContinue
    Die "Checksum mismatch for $Name — refusing to install (tamper-evidence). Report: https://github.com/$Repo/security"
  }
  Ok 'Checksum verified against release SHA256SUMS'
}

# Phase 9 · T5 — record the install channel so `xr update` picks the right
# update/rollback contract (docs/release/CHANNELS.md).
function Write-InstallRecord([string]$Channel, [string]$Layout) {
  $dataHome = if ($env:XR_DATA_HOME) { $env:XR_DATA_HOME } else { Join-Path $HOME '.xr' }
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
  New-Item -ItemType Directory -Force -Path $dataHome | Out-Null
  $record = @{ channel = $Channel; layout = $Layout; version = $Version; installedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); installer = 'install.ps1' } | ConvertTo-Json -Compress
  Set-Content -Path (Join-Path $TargetDir 'install.json') -Value $record -Encoding UTF8
  Set-Content -Path (Join-Path $dataHome 'install.json') -Value $record -Encoding UTF8
  Ok "install channel recorded: $Channel"
}

# Phase 3 · T2 — download the standalone binary (default distribution path).
function Fetch-XrBinary {
  $name = Get-XrBinaryName
  if (-not $name) { return $false }
  $url = "https://github.com/$Repo/releases/download/v$Version/$name"
  $distDir = Join-Path $TargetDir 'dist'
  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  Step "Downloading compiled binary v$Version ($name)"
  try {
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $distDir $name) -UseBasicParsing -ErrorAction Stop
    Verify-XrBinary -Name $name -Path (Join-Path $distDir $name)
    $probe = & (Join-Path $distDir $name) --version 2>$null
    if ($LASTEXITCODE -eq 0) {
      Ok "Compiled binary installed ($name)"
      return $true
    }
    Warn 'Binary failed to run; falling back to source checkout.'
    Remove-Item (Join-Path $distDir $name) -Force -ErrorAction SilentlyContinue
    return $false
  } catch {
    Warn 'Binary download unavailable; falling back to source checkout.'
    return $false
  }
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
Write-Host "  ▀▄▀ █▀█   XR Installer v$Version" -ForegroundColor Cyan
Write-Host "  Public Beta — validated, signed and reversible; not finished." -ForegroundColor Yellow
Write-Host "  Windows · Target: $TargetDir" -ForegroundColor DarkGray
Write-Host ""
Step 'This will download XR from GitHub, install Bun dependencies, and create an xr launcher.'
Step 'Optional Ollama, voice, browser and desktop-control packs are handled later by xr install prompts.'
if (-not (AskYes 'Continue?' $true)) { Die 'Cancelled.' }

Ensure-Bun
if (Fetch-XrBinary) {
  Step 'Using the compiled binary distribution (source checkout skipped).'
  Write-InstallRecord -Channel 'github-releases' -Layout 'binary'
} else {
  Fetch-Repo
  Install-Deps
  Write-InstallRecord -Channel 'git-checkout' -Layout 'git'
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
