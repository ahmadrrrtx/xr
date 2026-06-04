# XR — Native Windows Installer (PowerShell)
# Run: iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)
# Or download and run: .\install.ps1

$ErrorActionPreference = "Stop"
$Version = "0.2.0"
$Repo = "ahmadrrrtx/xr"

function Write-Step { param($msg) Write-Host "  ▸ $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Die  { param($msg) Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  ▀▄▀ █▀█   XR — The AI Agent You Can Actually Trust" -ForegroundColor Cyan
Write-Host "  █░█ █▀▄   by @ahmadrrrtx · v$Version" -ForegroundColor Gray
Write-Host ""
Write-Host ("─" * 60) -ForegroundColor DarkGray

Write-Step "Detected: Windows (PowerShell)"

# ── Install Bun ───────────────────────────────────────────────────────────────
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Step "Installing Bun runtime…"
    try {
        # Try npm first (most Windows users have it)
        if (Get-Command npm -ErrorAction SilentlyContinue) {
            npm install -g bun --quiet 2>$null
        }
        if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
            # Fall back to official installer
            $bunInstall = "$env:TEMP\bun-install.ps1"
            Invoke-WebRequest -Uri "https://bun.sh/install.ps1" -OutFile $bunInstall -UseBasicParsing
            if (Test-Path $bunInstall) {
                & $bunInstall -Profile AllUsers 2>$null
                Remove-Item $bunInstall -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        Write-Warn "Bun install failed. Will try npm fallback."
    }
}

if (Get-Command bun -ErrorAction SilentlyContinue) {
    Write-Ok "Bun: $(bun --version 2>$null | Out-String).Trim()"
} else {
    Write-Warn "Bun not in PATH. Install via: npm i -g bun"
}

# ── Clone XR ──────────────────────────────────────────────────────────────────
$TargetDir = if ($env:XR_HOME) { $env:XR_HOME } else { "$HOME\.xr-agent" }

if (Test-Path "$TargetDir\.git") {
    Write-Step "XR already installed at $TargetDir — updating…"
    Set-Location $TargetDir
    git pull 2>$null
} else {
    Write-Step "Cloning XR repository to $TargetDir…"
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Die "Git not found. Install Git from https://git-scm.com or run: winget install Git.Git"
    }
    git clone "https://github.com/$Repo" $TargetDir
    Set-Location $TargetDir
}

# ── Install Dependencies ───────────────────────────────────────────────────────
Write-Step "Installing dependencies…"
if (Get-Command bun -ErrorAction SilentlyContinue) {
    bun install 2>$null
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    npm install 2>$null
} else {
    Write-Die "Neither Bun nor npm available."
}

Write-Ok "Dependencies installed."

# ── Add Alias ─────────────────────────────────────────────────────────────────
$AliasLine = "bun run `"$TargetDir\src\index.ts`""
$RcPath = "$HOME\Documents\PowerShell\Microsoft.PowerShell_profile.ps1"
if (-not (Test-Path (Split-Path $RcPath -Parent))) {
    New-Item -Path (Split-Path $RcPath -Parent) -ItemType Directory -Force | Out-Null
}

if (-not (Test-Path $RcPath)) {
    "# XR — AI Agent (installed $(Get-Date -Format 'yyyy-MM-dd'))" | Out-File $RcPath -Encoding utf8
}

$profileContent = Get-Content $RcPath -Raw -ErrorAction SilentlyContinue
if ($profileContent -notmatch 'alias xr=') {
    Add-Content -Path $RcPath -Value "Set-Alias -Name xr -Value `"$TargetDir\src\index.ts`" -Option Global -Scope Global"
    Write-Ok "Added 'xr' alias to PowerShell profile"
} else {
    Write-Ok "'xr' alias already configured"
}

# ── Ollama Check ───────────────────────────────────────────────────────────────
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Write-Ok "Ollama detected — XR will use it for free local inference."
} else {
    Write-Warn "No LLM detected. To get started:"
    Write-Warn "  • Local (free): irm https://ollama.ai/install.ps1 | iex"
    Write-Warn "  • Groq:         Get API key at https://console.groq.com"
    Write-Warn "  • Anthropic:    Get API key at https://console.anthropic.com"
}

Write-Host ""
Write-Host ("─" * 60) -ForegroundColor DarkGray
Write-Ok "XR installed! Run: bun run src/index.ts doctor"
Write-Host ""
Write-Host "  Quick start:"
Write-Host "    bun run src/index.ts doctor           # System check"
Write-Host "    bun run src/index.ts `"list files`"    # Run a task"
Write-Host ""
Write-Host "  Or with Ollama (free, local):"
Write-Host "    ollama run qwen2.5:7b"
Write-Host "    bun run src/index.ts `"hi`""
Write-Host ""
