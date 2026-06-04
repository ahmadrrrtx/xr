#!/usr/bin/env bash
# XR — One-Command Installer
# Supports: Linux, macOS, Windows (Git Bash / WSL)
# Usage: curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash
set -e

VERSION="0.2.0"
REPO="ahmadrrrtx/xr"
INSTALL_URL="https://raw.githubusercontent.com/${REPO}/main/install.sh"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; BLU='\033[0;34m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RST='\033[0m'

log() { echo -e "${CYAN}▸${RST} $*"; }
ok()  { echo -e "${GRN}✓${RST} $*"; }
warn(){ echo -e "${YEL}!${RST} $*"; }
die() { echo -e "${RED}✗${RST} $*" >&2; exit 1; }

hr() { echo -e "${DIM}$(printf '─%.0s' $(seq 1 60))${RST}"; }

# ── Platform Detection ───────────────────────────────────────────────────────
detect_os() {
  case "$(uname -s)" in
    Linux*)     echo "linux";;
    Darwin*)    echo "macos";;
    MINGW*|MSYS*|CYGWIN*) echo "windows";;
    *)          echo "unknown";;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64)    echo "x64";;
    aarch64|arm64) echo "arm64";;
    armv7l)    echo "arm";;
    *)         echo "x64";;
  esac
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    die "Missing required command: $1. Install it first, then re-run this installer."
  }
}

# ── Bun Install ──────────────────────────────────────────────────────────────
install_bun() {
  if command -v bun >/dev/null 2>&1; then
    local ver=$(bun --version 2>/dev/null | head -n1)
    log "Bun already installed: ${ver}"
    return 0
  fi
  log "Installing Bun runtime…"
  
  local os=$(detect_os)
  case "$os" in
    linux|macos)
      require_command curl
      curl -fsSL https://bun.sh/install | bash
      ;;
    windows)
      curl -fsSL https://bun.sh/install | bash 2>/dev/null || {
        warn "On Windows: install Bun via 'npm i -g bun' or https://bun.sh"
        log "Continuing with npm fallback…"
        require_command npm
        npm install -g bun 2>/dev/null || true
      }
      ;;
  esac
  
  # Source shell config
  for rc in ~/.bashrc ~/.zshrc ~/.config/fish/config.fish; do
    [ -f "$rc" ] && source "$rc" 2>/dev/null && break
  done
  
  if command -v bun >/dev/null 2>&1; then
    ok "Bun installed: $(bun --version)"
  else
    warn "Bun not in PATH. Add to your shell config: export BUN_INSTALL=\"\$HOME/.bun\""
    warn "Then: export PATH=\"\$BUN_INSTALL/bin:\$PATH\""
  fi
}

# ── Git Clone / Update ───────────────────────────────────────────────────────
install_xr() {
  local target_dir="${XR_HOME:-$HOME/.xr-agent}"
  
  if [ -d "$target_dir/.git" ]; then
    log "XR already installed at ${target_dir} — updating…"
    cd "$target_dir"
    git pull origin main 2>/dev/null || git pull 2>/dev/null || true
  else
    log "Cloning XR repository…"
    require_command git
    git clone https://github.com/ahmadrrrtx/xr "$target_dir"
    cd "$target_dir"
  fi
  
  log "Installing dependencies…"
  if command -v bun >/dev/null 2>&1; then
    bun install 2>/dev/null || bun install
  elif command -v npm >/dev/null 2>&1; then
    npm install 2>/dev/null || npm install
  else
    die "Neither Bun nor npm found. Please install Bun first."
  fi
  
  # Run tests quickly
  if command -v bun >/dev/null 2>&1; then
    log "Running quick sanity check…"
    bun test --bail 2>/dev/null | head -5 || true
  fi
  
  ok "XR installed successfully!"
  echo ""
  echo -e "${BOLD}Next steps:${RST}"
  echo ""
  echo -e "  ${GRN}1.${RST} ${BOLD}Quick start:${RST}   bun run src/index.ts doctor"
  echo -e "  ${GRN}2.${RST} ${BOLD}Run a task:${RST}     bun run src/index.ts \"list files and explain them\""
  echo -e "  ${GRN}3.${RST} ${BOLD}Local model:${RST}    # Install Ollama then: XR_PROVIDER=ollama bun run src/index.ts \"hi\""
  echo -e "  ${GRN}4.${RST} ${BOLD}Cloud model:${RST}    GROQ_API_KEY=sk-... bun run src/index.ts \"hi\""
  echo ""
  echo -e "${DIM}Tip: add ${BOLD}alias xr='bun run $target_dir/src/index.ts'${RST} to your ~/.bashrc or ~/.zshrc${DIM}"
  echo -e "Then just type: xr \"your task\"${RST}"
  echo ""
  
  # Try to detect and suggest provider
  if command -v ollama >/dev/null 2>&1; then
    ok "Ollama detected — XR will use it for free local inference."
  elif [ -n "$GROQ_API_KEY" ]; then
    ok "GROQ_API_KEY found — XR will use Groq cloud inference."
  elif [ -n "$ANTHROPIC_API_KEY" ]; then
    ok "ANTHROPIC_API_KEY found — XR will use Claude."
  else
    warn "No LLM provider detected. Options:"
    warn "  • Ollama (local, free): curl -fsSL https://ollama.ai/install.sh | bash"
    warn "  • Groq: get a key at https://console.groq.com"
    warn "  • Anthropic: get a key at https://console.anthropic.com"
  fi
}

# ── Shell Alias Setup ────────────────────────────────────────────────────────
setup_alias() {
  local target_dir="${XR_HOME:-$HOME/.xr-agent}"
  local alias_line="alias xr='bun run $target_dir/src/index.ts'"
  local rc_file=""
  
  if [ -f "$HOME/.zshrc" ]; then rc_file="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then rc_file="$HOME/.bashrc"
  elif [ -f "$HOME/.config/fish/config.fish" ]; then rc_file="$HOME/.config/fish/config.fish"
  fi
  
  if [ -n "$rc_file" ]; then
    if ! grep -q "alias xr=" "$rc_file" 2>/dev/null; then
      echo "" >> "$rc_file"
      echo "# XR — AI Agent (installed $(date '+%Y-%m-%d'))" >> "$rc_file"
      echo "$alias_line" >> "$rc_file"
      ok "Added 'xr' alias to ${rc_file}"
      ok "Run: source ${rc_file} && xr doctor"
    else
      ok "'xr' alias already configured in ${rc_file}"
    fi
  else
    log "Add this to your shell config to enable 'xr' command:"
    echo ""
    echo -e "  ${CYAN}${alias_line}${RST}"
    echo ""
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  clear
  echo ""
  echo -e "${BOLD}${CYAN}  ▀▄▀ █▀█   XR — The AI Agent You Can Actually Trust  ${RST}"
  echo -e "${DIM}  █░█ █▀▄   by @ahmadrrrtx · v${VERSION}${RST}"
  echo ""
  hr
  
  local os=$(detect_os)
  log "Detected: ${os}/$(detect_arch)"
  
  echo ""
  log "Installing XR — BYOK · local-first · spend-capped · tamper-evident"
  echo ""
  
  # Step 1: Ensure Bun
  if ! command -v bun >/dev/null 2>&1; then
    log "Bun not found — installing…"
    install_bun
  else
    log "Bun found: $(bun --version 2>/dev/null | head -n1)"
  fi
  
  # Step 2: Clone/install XR
  install_xr
  
  # Step 3: Setup alias
  setup_alias
  
  hr
  echo ""
  ok "XR is ready. Run: xr doctor"
  echo ""
}

main "$@"
