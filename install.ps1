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
  Set-Content -Path $ps1 -Encoding UTF8 -Value "& bun run `"$entry`" @args`nexit `$LASTEXITCODE`n"
  Set-Content -Path $cmd -Encoding ASCII -Value "@echo off`r`nbun run `"$entry`" %*`r`n"
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
Fetch-Repo
Install-Deps
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
