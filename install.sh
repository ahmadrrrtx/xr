#!/usr/bin/env bash
# XR Stage 2 — safe bootstrapper for Linux, macOS, Termux, Git Bash/WSL.
# Usage: curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash
set -Eeuo pipefail

VERSION="7.0.1"
REPO="ahmadrrrtx/xr"
BRANCH="main"
TARGET_DIR="${XR_HOME:-$HOME/.xr-agent}"
YES=0
ALLOW_SYSTEM=0
MODE=""

for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    --allow-system) ALLOW_SYSTEM=1 ;;
    --mode=*) MODE="${arg#--mode=}" ;;
    --minimal) MODE="minimal" ;;
    --local) MODE="local" ;;
    --byok) MODE="byok" ;;
    --hybrid) MODE="hybrid" ;;
    --full) MODE="full" ;;
  esac
done

if [ "${1:-}" = "--mode" ] && [ -n "${2:-}" ]; then MODE="$2"; fi

RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; CYN='\033[0;36m'; BLD='\033[1m'; DIM='\033[2m'; RST='\033[0m'
log(){ printf "%b\n" "${CYN}▸${RST} $*"; }
ok(){ printf "%b\n" "${GRN}✓${RST} $*"; }
warn(){ printf "%b\n" "${YEL}!${RST} $*"; }
die(){ printf "%b\n" "${RED}✗${RST} $*" >&2; exit 1; }
is_tty(){ [ -t 0 ] && [ -t 1 ]; }

prompt_yes(){
  local question="$1" default="${2:-n}"
  if [ "$YES" = "1" ]; then [ "$default" = "y" ]; return $?; fi
  if ! is_tty; then return 1; fi
  local suffix="[y/N]"; [ "$default" = "y" ] && suffix="[Y/n]"
  printf "%b " "${CYN}${question}${RST} ${DIM}${suffix}${RST}"
  read -r ans || true
  ans="${ans:-$default}"
  [[ "$ans" =~ ^[Yy] ]]
}

os_name(){
  if [ -n "${TERMUX_VERSION:-}" ] || [[ "${PREFIX:-}" == *com.termux* ]]; then echo termux; return; fi
  case "$(uname -s 2>/dev/null || echo unknown)" in
    Darwin*) echo macos ;;
    Linux*) echo linux ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo unknown ;;
  esac
}

arch_name(){
  case "$(uname -m 2>/dev/null || echo unknown)" in
    x86_64|amd64) echo x64 ;;
    arm64|aarch64) echo arm64 ;;
    arm*) echo arm ;;
    *) echo unknown ;;
  esac
}

# Phase 3 · T2 — compiled-binary distribution name for this platform.
binary_name(){
  local os; os="$(os_name)"; local arch; arch="$(arch_name)"
  case "$os/$arch" in
    linux/x64) echo "xr-linux-x64" ;;
    linux/arm64) echo "xr-linux-arm64" ;;
    macos/x64) echo "xr-darwin-x64" ;;
    macos/arm64) echo "xr-darwin-arm64" ;;
    windows/x64) echo "xr-windows-x64.exe" ;;
    *) echo "" ;;
  esac
}

# Phase 3 · T2 — download the standalone binary (default distribution path).
# Returns 0 when the binary was installed; non-zero falls back to source.
fetch_binary(){
  local bin; bin="$(binary_name)"
  [ -z "$bin" ] && return 1
  local url="https://github.com/$REPO/releases/download/v$VERSION/$bin"
  mkdir -p "$TARGET_DIR/dist"
  log "Downloading compiled binary v$VERSION ($bin)"
  if curl -fsSL "$url" -o "$TARGET_DIR/dist/$bin" 2>/dev/null; then
    chmod +x "$TARGET_DIR/dist/$bin"
    "$TARGET_DIR/dist/$bin" --version >/dev/null 2>&1 || { warn "Binary failed to run; falling back to source."; rm -f "$TARGET_DIR/dist/$bin"; return 1; }
    ok "Compiled binary installed ($bin)"
    return 0
  fi
  warn "Binary download unavailable; falling back to source checkout."
  return 1
}

ensure_bun(){
  if command -v bun >/dev/null 2>&1; then ok "Bun $(bun --version)"; return; fi
  warn "Bun is required to run XR."
  log "Bun install is user-level. It downloads from https://bun.sh or your Termux package repository."
  if ! prompt_yes "Install Bun now?" y; then die "Install Bun from https://bun.sh and rerun this installer."; fi
  case "$(os_name)" in
    termux)
      command -v pkg >/dev/null 2>&1 || die "Termux pkg not found. Install Bun manually."
      pkg install -y bun || die "Bun install failed."
      ;;
    macos|linux)
      command -v curl >/dev/null 2>&1 || die "curl is required to install Bun."
      curl -fsSL https://bun.sh/install | bash
      export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
      export PATH="$BUN_INSTALL/bin:$PATH"
      ;;
    windows)
      if command -v npm >/dev/null 2>&1; then npm install -g bun; else die "Use install.ps1 on Windows or install Bun manually."; fi
      ;;
    *) die "Unsupported OS for automatic Bun install." ;;
  esac
  command -v bun >/dev/null 2>&1 || die "Bun installed but is not on PATH. Open a new terminal or add ~/.bun/bin to PATH."
  ok "Bun $(bun --version)"
}

fetch_repo(){
  if [ -d "$TARGET_DIR/.git" ]; then
    log "Existing XR checkout found at $TARGET_DIR"
    if command -v git >/dev/null 2>&1; then
      (cd "$TARGET_DIR" && git fetch --quiet origin "$BRANCH" && git pull --ff-only origin "$BRANCH") || warn "Git update failed; continuing with existing checkout."
    else
      warn "Git missing; cannot update existing checkout."
    fi
    return
  fi
  if [ -e "$TARGET_DIR" ] && [ "$(find "$TARGET_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]; then
    die "$TARGET_DIR exists and is not an XR git checkout. Set XR_HOME to a different directory."
  fi
  mkdir -p "$(dirname "$TARGET_DIR")"
  if command -v git >/dev/null 2>&1; then
    log "Cloning XR into $TARGET_DIR"
    git clone --branch "$BRANCH" "https://github.com/$REPO.git" "$TARGET_DIR"
  else
    command -v curl >/dev/null 2>&1 || die "Need git or curl to download XR."
    command -v tar >/dev/null 2>&1 || die "Need tar to unpack XR."
    log "Git not found. Downloading source archive instead. Updates will require rerunning the installer."
    tmp="$(mktemp -d)"
    curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" -o "$tmp/xr.tar.gz"
    mkdir -p "$TARGET_DIR"
    tar -xzf "$tmp/xr.tar.gz" -C "$tmp"
    cp -R "$tmp/xr-$BRANCH/." "$TARGET_DIR/"
    rm -rf "$tmp"
  fi
}

install_deps(){
  log "Installing XR package dependencies"
  (cd "$TARGET_DIR" && bun install) || die "Dependency install failed. Run: cd '$TARGET_DIR' && bun install"
  ok "Dependencies installed"
}

install_launcher(){
  local bin_dir="$HOME/.local/bin"
  mkdir -p "$bin_dir"
  local bun_bin
  bun_bin="$(command -v bun)"
  local bin; bin="$(binary_name)"
  cat > "$bin_dir/xr" <<EOF
#!/usr/bin/env bash
# XR launcher (Phase 3 · T2): compiled binary first, Bun source fallback.
if [ -n "$bin" ] && [ -x "$TARGET_DIR/dist/$bin" ]; then
  exec "$TARGET_DIR/dist/$bin" "\$@"
fi
exec "$bun_bin" run "$TARGET_DIR/src/index.ts" "\$@"
EOF
  chmod +x "$bin_dir/xr"
  ok "Installed launcher: $bin_dir/xr"
  case ":$PATH:" in *":$bin_dir:"*) ;; *)
    local rc=""
    [ -n "${ZSH_VERSION:-}" ] && rc="$HOME/.zshrc"
    [ -z "$rc" ] && [ -f "$HOME/.zshrc" ] && rc="$HOME/.zshrc"
    [ -z "$rc" ] && rc="$HOME/.bashrc"
    if is_tty && prompt_yes "Add $bin_dir to PATH in $rc?" y; then
      touch "$rc"
      if ! grep -q "XR launcher" "$rc" 2>/dev/null; then
        printf '\n# XR launcher\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
      fi
      ok "PATH updated. Restart your terminal or run: source $rc"
    else
      warn "Add this to PATH if xr is not found: export PATH=\"$bin_dir:\$PATH\""
    fi
  esac
}

main(){
  printf "\n%b\n" "${BLD}${CYN}  ▀▄▀ █▀█   XR Stage 2 Installer v$VERSION${RST}"
  printf "%b\n\n" "${DIM}  OS: $(os_name)/$(arch_name) · Target: $TARGET_DIR${RST}"
  log "This will download XR from GitHub, install Bun dependencies, and create an xr launcher."
  log "Optional Ollama, voice, browser and desktop-control packs are handled later by xr install prompts."
  if ! prompt_yes "Continue?" y; then die "Cancelled."; fi
  ensure_bun
  if fetch_binary; then
    log "Using the compiled binary distribution (source checkout skipped)."
  else
    fetch_repo
    install_deps
  fi
  install_launcher
  cmd=("$HOME/.local/bin/xr" install --from-bootstrap)
  [ -n "$MODE" ] && cmd+=(--mode "$MODE")
  [ "$YES" = "1" ] && cmd+=(--yes)
  [ "$ALLOW_SYSTEM" = "1" ] && cmd+=(--allow-system)
  "${cmd[@]}" || warn "XR installed, but setup wizard reported issues. Run: xr doctor"
  printf "\n%b\n" "${GRN}✓ XR bootstrap complete.${RST} Run: ${BLD}xr doctor${RST}"
}

main "$@"
