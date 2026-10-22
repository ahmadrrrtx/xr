#!/usr/bin/env bash
# XR bootstrap installer for Linux, macOS, Termux and Git Bash/WSL.
#
#   curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash -s -- --yes --version=1.0.0
#
# What it does (launch audit XR-LAUNCH-002):
#   1. Downloads the release's SHA256SUMS for ONE pinned, published version.
#   2. Installs the compiled binary for this platform, after its sha256 matches.
#      On platforms without a binary, it installs that same release's
#      xr-source.tar.gz (also checksum-verified) with `bun install --frozen-lockfile`.
#   3. Writes the `xr` launcher and runs the setup wizard.
#
# It never installs from an unpinned branch, and it fails closed: if the
# release, its checksums or the artifact is missing or does not verify,
# it exits non-zero and leaves nothing half-installed.
#
# Options:
#   --version=X.Y.Z   install a specific published release (also: XR_INSTALL_VERSION)
#   --from-source     skip the compiled binary; install the release's verified source archive
#   -y, --yes         accept defaults non-interactively
#   --mode=<profile>  minimal | local | byok | hybrid | full (passed to the setup wizard)
#   --allow-system    allow system-level steps in the setup wizard
set -Eeuo pipefail

# Stamped from release.manifest.json `channels.publicVersion` (bun run release:stamp).
VERSION="1.0.0"
REPO="ahmadrrrtx/xr"
TARGET_DIR="${XR_HOME:-$HOME/.xr-agent}"
MARKER=".xr-install"
YES=0
ALLOW_SYSTEM=0
MODE=""
FROM_SOURCE=0
REQUESTED_VERSION="${XR_INSTALL_VERSION:-}"

RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; CYN='\033[0;36m'; BLD='\033[1m'; DIM='\033[2m'; RST='\033[0m'
log(){ printf "%b\n" "${CYN}▸${RST} $*"; }
ok(){ printf "%b\n" "${GRN}✓${RST} $*"; }
warn(){ printf "%b\n" "${YEL}!${RST} $*"; }
die(){ printf "%b\n" "${RED}✗${RST} $*" >&2; exit 1; }

usage(){
  cat <<'USAGE'
XR installer. Usage: install.sh [options]
  --version=X.Y.Z   install a specific published release (also: XR_INSTALL_VERSION)
  --from-source     install the release's verified source archive instead of the binary
  -y, --yes         accept defaults non-interactively
  --mode=<profile>  minimal | local | byok | hybrid | full
  --allow-system    allow system-level steps in the setup wizard
Install directory: $XR_HOME, else ~/.xr-agent. Launcher: ~/.local/bin/xr
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) YES=1 ;;
    --allow-system) ALLOW_SYSTEM=1 ;;
    --mode=*) MODE="${1#--mode=}" ;;
    --mode) shift; MODE="${1:-}" ;;
    --minimal) MODE="minimal" ;;
    --local) MODE="local" ;;
    --byok) MODE="byok" ;;
    --hybrid) MODE="hybrid" ;;
    --full) MODE="full" ;;
    --version=*) REQUESTED_VERSION="${1#--version=}" ;;
    --version) shift; REQUESTED_VERSION="${1:-}" ;;
    --from-source) FROM_SOURCE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) warn "Ignoring unknown option: $1" ;;
  esac
  shift
done

if [ -n "$REQUESTED_VERSION" ]; then
  VERSION="${REQUESTED_VERSION#v}"
fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  die "Invalid version \"$VERSION\". Use a published release such as --version=1.0.0."
fi
BASE="https://github.com/$REPO/releases/download/v$VERSION"

# Where to read answers from. `curl … | bash` makes stdin the script pipe, so
# reading stdin would never reach the user (and the old installer silently
# answered "no" and cancelled the documented one-liner). Use the controlling
# terminal instead when there is one; with none (CI, cron) there is nobody to
# ask, so prompts decline unless --yes was given.
tty_source(){
  if [ -t 0 ]; then echo "/dev/stdin"; return 0; fi
  if { : </dev/tty; } 2>/dev/null; then echo "/dev/tty"; return 0; fi
  return 1
}

prompt_yes(){
  local question="$1" default="${2:-n}" src ans
  if [ "$YES" = "1" ]; then [ "$default" = "y" ]; return $?; fi
  src="$(tty_source)" || return 1
  local suffix="[y/N]"; [ "$default" = "y" ] && suffix="[Y/n]"
  printf "%b " "${CYN}${question}${RST} ${DIM}${suffix}${RST}"
  read -r ans <"$src" || true
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

# Compiled-binary asset name for this platform ("" = no binary; use the source archive).
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

# ── Staging and cleanup ──────────────────────────────────────────────────────
# Everything is downloaded and verified in a private staging directory first.
# TARGET_DIR is only touched once an artifact has verified, so a missing
# release can never leave a half-created install behind (XR-LAUNCH-002).
STAGE=""
NEW_TREE=""
CREATED_TARGET=0
cleanup(){
  [ -n "$STAGE" ] && rm -rf "$STAGE"
  [ -n "$NEW_TREE" ] && [ -d "$NEW_TREE" ] && rm -rf "$NEW_TREE"
  return 0
}
trap cleanup EXIT

download(){
  curl --proto '=https' --tlsv1.2 -fsSL --retry 2 --connect-timeout 20 "$1" -o "$2"
}

sha256_of(){
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else return 1
  fi
}

expected_sha(){
  awk -v f="$1" '$2 == f || $2 == "*"f {print $1}' "$STAGE/SHA256SUMS" | head -n1
}

# Returns 0 when TARGET_DIR is absent, empty, or provably an XR install
# (installer marker, an XR source tree, or only the dist/ an older installer left).
target_is_ours(){
  [ -e "$TARGET_DIR" ] || return 0
  [ -d "$TARGET_DIR" ] || return 1
  [ -f "$TARGET_DIR/$MARKER" ] && return 0
  if [ -f "$TARGET_DIR/package.json" ] && grep -q '"name": *"@rrrtx/xr"' "$TARGET_DIR/package.json" 2>/dev/null; then
    return 0
  fi
  [ -z "$(find "$TARGET_DIR" -mindepth 1 -maxdepth 1 ! -name dist 2>/dev/null | head -n 1)" ] || return 1
  [ -d "$TARGET_DIR/dist" ] || return 0
  [ -z "$(find "$TARGET_DIR/dist" -mindepth 1 -maxdepth 1 ! -name 'xr-*' ! -name '.sha256sums.tmp' 2>/dev/null | head -n 1)" ]
}

ensure_target(){
  if [ ! -e "$TARGET_DIR" ]; then CREATED_TARGET=1; fi
  mkdir -p "$TARGET_DIR"
}

tidy_target(){
  rmdir "$TARGET_DIR/dist" 2>/dev/null || true
  if [ "$CREATED_TARGET" = "1" ]; then rmdir "$TARGET_DIR" 2>/dev/null || true; fi
}

write_marker(){
  printf 'version=%s\nmethod=%s\nrepo=%s\n' "$VERSION" "$1" "$REPO" > "$TARGET_DIR/$MARKER"
}

fetch_sums(){
  log "Fetching release checksums for v$VERSION"
  if ! download "$BASE/SHA256SUMS" "$STAGE/SHA256SUMS" 2>/dev/null; then
    die "XR v$VERSION is not available from GitHub Releases (no SHA256SUMS at $BASE).
  Release checksums unavailable — refusing an unverified install. Nothing was installed.
  See https://github.com/$REPO/releases, or pass --version=<published version>."
  fi
  [ -s "$STAGE/SHA256SUMS" ] || die "SHA256SUMS for v$VERSION is empty. Nothing was installed."
}

# 0 = installed · 1 = no usable binary for this platform/release (caller falls back
# to the verified source archive). A checksum mismatch is fatal, never a fallback.
fetch_binary(){
  local bin; bin="$(binary_name)"
  [ -z "$bin" ] && { log "No compiled binary for $(os_name)/$(arch_name); using the verified source archive."; return 1; }
  local expect actual
  expect="$(expected_sha "$bin")"
  if [ -z "$expect" ]; then
    warn "No checksum entry for $bin in SHA256SUMS — refusing the unverified binary."
    return 1
  fi
  log "Downloading compiled binary v$VERSION ($bin)"
  if ! download "$BASE/$bin" "$STAGE/$bin" 2>/dev/null; then
    warn "Binary download unavailable ($bin)."
    return 1
  fi
  actual="$(sha256_of "$STAGE/$bin")" || die "No sha256 tool (sha256sum or shasum) available — refusing the unverified binary."
  if [ "$actual" != "$expect" ]; then
    die "Integrity check FAILED for $bin (sha256 ${actual} ≠ published ${expect}). Refusing the binary (possible tampering). Nothing was installed."
  fi
  chmod +x "$STAGE/$bin"
  ensure_target
  mkdir -p "$TARGET_DIR/dist"
  local partial="$TARGET_DIR/dist/.$bin.partial"
  mv -f "$STAGE/$bin" "$partial"
  if ! "$partial" --version >/dev/null 2>&1; then
    rm -f "$partial"
    tidy_target
    warn "Binary failed to run on this system."
    return 1
  fi
  mv -f "$partial" "$TARGET_DIR/dist/$bin"
  write_marker binary
  ok "Compiled binary installed and verified ($bin, v$VERSION)"
  return 0
}

ensure_bun(){
  if command -v bun >/dev/null 2>&1; then ok "Bun $(bun --version)"; return; fi
  warn "The source install needs Bun."
  log "Bun install is user-level. It downloads from https://bun.sh or your Termux package repository."
  if ! prompt_yes "Install Bun now?" y; then die "Install Bun from https://bun.sh and rerun this installer. Nothing was installed."; fi
  case "$(os_name)" in
    termux)
      command -v pkg >/dev/null 2>&1 || die "Termux pkg not found. Install Bun manually."
      pkg install -y bun || die "Bun install failed."
      ;;
    macos|linux)
      curl --proto '=https' --tlsv1.2 -fsSL https://bun.sh/install | bash
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

# Source install from the SAME pinned release (never a branch): verify the
# archive, install dependencies from the frozen lockfile in a sibling staging
# tree, then swap it into place. The previous tree is kept, never deleted.
fetch_repo(){
  local asset="xr-source.tar.gz" expect actual
  expect="$(expected_sha "$asset")"
  [ -n "$expect" ] || die "Release v$VERSION has no checksum for $asset — refusing an unverified source install. Nothing was installed."
  command -v tar >/dev/null 2>&1 || die "tar is required for the source install."
  log "Downloading source archive v$VERSION"
  download "$BASE/$asset" "$STAGE/$asset" 2>/dev/null || die "Could not download $asset for v$VERSION. Nothing was installed."
  actual="$(sha256_of "$STAGE/$asset")" || die "No sha256 tool (sha256sum or shasum) available — refusing the unverified source archive."
  [ "$actual" = "$expect" ] || die "Integrity check FAILED for $asset (sha256 ${actual} ≠ published ${expect}). Nothing was installed."
  ok "Source archive verified"
  ensure_bun

  mkdir -p "$(dirname "$TARGET_DIR")"
  NEW_TREE="$(mktemp -d "${TARGET_DIR%/}.new.XXXXXX")"
  tar -xzf "$STAGE/$asset" -C "$NEW_TREE"
  [ -f "$NEW_TREE/src/index.ts" ] || die "Source archive v$VERSION has no src/index.ts. Nothing was installed."
  [ -f "$NEW_TREE/bun.lock" ] || die "Source archive v$VERSION has no bun.lock; refusing a non-reproducible install. Nothing was installed."
  install_deps "$NEW_TREE"

  local previous="${TARGET_DIR%/}.previous"
  if [ -e "$TARGET_DIR" ]; then
    if [ -d "$TARGET_DIR/.git" ]; then
      previous="${TARGET_DIR%/}.backup-$(date +%Y%m%d%H%M%S)"
    elif [ -e "$previous" ]; then
      if [ -f "$previous/$MARKER" ]; then rm -rf "$previous"; else previous="${TARGET_DIR%/}.previous-$(date +%Y%m%d%H%M%S)"; fi
    fi
    mv "$TARGET_DIR" "$previous"
    warn "Kept your previous install at $previous (remove it once the new install works)."
  fi
  mv "$NEW_TREE" "$TARGET_DIR"
  NEW_TREE=""
  write_marker source
  ok "Source install v$VERSION placed at $TARGET_DIR"
}

install_deps(){
  local dir="$1"
  log "Installing XR package dependencies (frozen lockfile)"
  # Supply-chain hardening (matches CI): never run package lifecycle scripts
  # during install, and never resolve versions outside the release's bun.lock.
  # Override scripts with XR_INSTALL_ALLOW_SCRIPTS=1 only if you understand the risk.
  local install_args=(install --frozen-lockfile)
  if [ "${XR_INSTALL_ALLOW_SCRIPTS:-0}" != "1" ]; then
    install_args+=(--ignore-scripts)
  else
    warn "XR_INSTALL_ALLOW_SCRIPTS=1 — package lifecycle scripts WILL run during install (supply-chain risk)."
  fi
  (cd "$dir" && bun "${install_args[@]}") || die "Dependency install failed (bun ${install_args[*]}). Nothing was installed."
  ok "Dependencies installed"
}

install_launcher(){
  local bin_dir="$HOME/.local/bin"
  mkdir -p "$bin_dir"
  local bun_bin
  bun_bin="$(command -v bun 2>/dev/null || echo bun)"
  local bin; bin="$(binary_name)"
  cat > "$bin_dir/xr" <<EOF
#!/usr/bin/env bash
# XR launcher (written by install.sh v$VERSION): compiled binary first, Bun source fallback.
if [ -n "$bin" ] && [ -x "$TARGET_DIR/dist/$bin" ]; then
  exec "$TARGET_DIR/dist/$bin" "\$@"
fi
if [ -f "$TARGET_DIR/src/index.ts" ]; then
  exec "$bun_bin" run "$TARGET_DIR/src/index.ts" "\$@"
fi
echo "xr: no XR install found at $TARGET_DIR. Rerun the installer." >&2
exit 127
EOF
  chmod +x "$bin_dir/xr"
  ok "Installed launcher: $bin_dir/xr"
  case ":$PATH:" in *":$bin_dir:"*) ;; *)
    local rc=""
    [ -n "${ZSH_VERSION:-}" ] && rc="$HOME/.zshrc"
    [ -z "$rc" ] && [ -f "$HOME/.zshrc" ] && rc="$HOME/.zshrc"
    [ -z "$rc" ] && rc="$HOME/.bashrc"
    if [ "$YES" != "1" ] && tty_source >/dev/null && prompt_yes "Add $bin_dir to PATH in $rc?" y; then
      touch "$rc"
      if ! grep -q "XR launcher" "$rc" 2>/dev/null; then
        # shellcheck disable=SC2016  # literal $HOME/$PATH are meant to expand when the rc file runs
        printf '\n# XR launcher\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
      fi
      ok "PATH updated. Restart your terminal or run: source $rc"
    else
      warn "Add this to PATH if xr is not found: export PATH=\"$bin_dir:\$PATH\""
    fi
  esac
}

main(){
  printf "\n%b\n" "${BLD}${CYN}  ▀▄▀ █▀█   XR Installer · v$VERSION${RST}"
  printf "%b\n\n" "${DIM}  OS: $(os_name)/$(arch_name) · Target: $TARGET_DIR${RST}"
  log "This downloads XR v$VERSION from GitHub Releases, verifies it against the release's SHA256SUMS, and creates an xr launcher."
  log "Optional Ollama, voice, browser and desktop-control packs are handled later by xr install prompts."
  if ! target_is_ours; then
    die "$TARGET_DIR exists and is not an XR install. Set XR_HOME to a different directory. Nothing was changed."
  fi
  if ! prompt_yes "Continue?" y; then
    if [ "$YES" != "1" ] && ! tty_source >/dev/null; then
      die "No terminal to confirm on. Rerun non-interactively with:
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- --yes"
    fi
    die "Cancelled."
  fi
  STAGE="$(mktemp -d "${TMPDIR:-/tmp}/xr-install.XXXXXX")"
  fetch_sums
  if [ "$FROM_SOURCE" != "1" ] && fetch_binary; then
    log "Using the compiled binary distribution (source install skipped)."
  else
    fetch_repo
  fi
  install_launcher
  cmd=("$HOME/.local/bin/xr" install --from-bootstrap)
  [ -n "$MODE" ] && cmd+=(--mode "$MODE")
  [ "$YES" = "1" ] && cmd+=(--yes)
  [ "$ALLOW_SYSTEM" = "1" ] && cmd+=(--allow-system)
  # Give the wizard the user's terminal, not the `curl | bash` script pipe.
  local wizard_in="/dev/null"
  wizard_in="$(tty_source)" || wizard_in="/dev/null"
  "${cmd[@]}" <"$wizard_in" || warn "XR installed, but setup wizard reported issues. Run: xr doctor"
  printf "\n%b\n" "${GRN}✓ XR v$VERSION installed.${RST} Run: ${BLD}xr doctor${RST}"
}

main
