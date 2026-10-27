#!/usr/bin/env bash
# =============================================================================
# Phase 4 · D-02 — sidecar smoke test (runs on all three CI OS families).
#
# Proves the COMPILED engine binary actually boots and serves — a bundle never
# ships an engine that didn't boot:
#   1. `xr-engine-<triple> --version` prints a version;
#   2. `serve --port 39417` starts and /api/v1/health answers 200 (no auth —
#      health is the only unauthenticated route by design);
#   3. the daemon is killed cleanly (best effort; runners are ephemeral).
#
# Usage: bash scripts/smoke-sidecar.sh <target-triple>
#
# Cross-target builds (launch-audit L-003): when <target-triple> is not this
# machine's own triple, the binary provably cannot run here — the smoke is
# reported honestly as SKIPPED (not faked green, not failed). The arch-
# assertion step in the bundling workflow still verifies the produced binary
# is genuinely the target architecture via `file`, and scripts/build-matrix.ts
# smokes the same engine natively per platform in the CLI matrix.
# =============================================================================
set -euo pipefail

TRIPLE="${1:?usage: smoke-sidecar.sh <target-triple>}"
PORT="${SIDECAR_SMOKE_PORT:-39417}"
EXT=""

# Host triple in Rust form (mirrors scripts/compile-sidecar.ts TRIPLES).
_host_key() {
  local kernel arch
  kernel="$(uname -s 2>/dev/null || echo unknown)"
  arch="$(uname -m 2>/dev/null || echo unknown)"
  case "$kernel" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT) kernel=windows ;;
    Darwin) kernel=darwin ;;
    Linux) kernel=linux ;;
  esac
  case "$arch" in
    x86_64|amd64|AMD64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
  esac
  echo "${kernel}-${arch}"
}
HOST_KEY="$(_host_key)"
case "$HOST_KEY" in
  linux-x64) HOST_TRIPLE="x86_64-unknown-linux-gnu" ;;
  linux-arm64) HOST_TRIPLE="aarch64-unknown-linux-gnu" ;;
  darwin-x64) HOST_TRIPLE="x86_64-apple-darwin" ;;
  darwin-arm64) HOST_TRIPLE="aarch64-apple-darwin" ;;
  windows-x64) HOST_TRIPLE="x86_64-pc-windows-msvc" ;;
  windows-arm64) HOST_TRIPLE="aarch64-pc-windows-msvc" ;;
  *) HOST_TRIPLE="unknown" ;;
esac

case "$HOST_KEY" in
  windows-*) EXT=".exe" ;;
esac
# Windows targets always carry .exe regardless of the compiling host.
case "$TRIPLE" in
  *windows*) TARGET_EXT=".exe" ;;
  *) TARGET_EXT="" ;;
esac
BIN="desktop/src-tauri/binaries/xr-engine-${TRIPLE}${TARGET_EXT}"
if [ ! -f "$BIN" ] && [ -n "$EXT" ]; then BIN="desktop/src-tauri/binaries/xr-engine-${TRIPLE}${EXT}"; fi

if [ "$TRIPLE" != "$HOST_TRIPLE" ]; then
  echo "[smoke] SKIPPED (cross-target): this host runs ${HOST_TRIPLE}, the binary targets ${TRIPLE}."
  echo "[smoke] The bundling workflow's 'file' arch assertion proves the target arch; runtime proof comes from the native leg of the matrix."
  exit 0
fi

[ -f "$BIN" ] || { echo "[smoke] FAIL: $BIN not found"; exit 1; }

echo "[smoke] --version"
"$BIN" --version

echo "[smoke] booting serve on :$PORT (isolated XR_HOME)"
SMOKE_HOME="$(mktemp -d)"
NO_COLOR=1 XR_HOME="$SMOKE_HOME" "$BIN" serve --port "$PORT" > "$SMOKE_HOME/serve.log" 2>&1 &
PID=$!

cleanup() {
  kill "$PID" 2>/dev/null || true
  # Windows runners: git-bash kill may not reap a native process.
  command -v taskkill >/dev/null 2>&1 && taskkill //PID "$PID" //F >/dev/null 2>&1 || true
}
trap cleanup EXIT

ok=""
for _ in $(seq 1 30); do
  sleep 1
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "[smoke] FAIL: sidecar exited early — log:"; sed -E 's/(Token: ).*/\1[REDACTED]/; s/(Bearer )[A-Za-z0-9._~-]+/\1[REDACTED]/g' "$SMOKE_HOME/serve.log" || true; exit 1
  fi
  if curl -sf "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1; then ok=1; break; fi
done

if [ -z "$ok" ]; then
  echo "[smoke] FAIL: health probe never answered — log:"; sed -E 's/(Token: ).*/\1[REDACTED]/; s/(Bearer )[A-Za-z0-9._~-]+/\1[REDACTED]/g' "$SMOKE_HOME/serve.log" || true; exit 1
fi

echo "[smoke] health OK — token handshake banner present:"
# Strip ANSI (Windows Bun may emit color codes even redirected) before matching.
sed 's/\x1b\[[0-9;]*m//g' "$SMOKE_HOME/serve.log" | grep -q "Token: " \
  && echo "[smoke] PASS" \
  || { echo "[smoke] FAIL: no token banner — log:"; sed -E 's/(Token: ).*/\1[REDACTED]/; s/(Bearer )[A-Za-z0-9._~-]+/\1[REDACTED]/g' "$SMOKE_HOME/serve.log" || true; exit 1; }
