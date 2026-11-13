#!/usr/bin/env bash
# =============================================================================
# Phase 4 · D-02 — sidecar smoke test (runs on all three CI OS families).
#
# Proves the COMPILED engine binary actually boots and serves — a bundle never
# ships an engine that didn't boot:
#   1. `xr-engine-<triple> --version` prints a version;
#   2. `serve --port 39417` starts and /api/v1/health answers 200 (no auth —
#      health is the only unauthenticated route by design);
#   3. protected version endpoint rejects anonymous and invalid bearer requests
#      and accepts the fresh owner-only daemon token;
#   4. the daemon is killed cleanly (best effort; runners are ephemeral).
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
NO_COLOR=1 XR_DAEMON_TOKEN= XR_HOME="$SMOKE_HOME" "$BIN" serve --port "$PORT" > "$SMOKE_HOME/serve.log" 2>&1 &
PID=$!

cleanup() {
  kill "$PID" 2>/dev/null || true
  # Windows runners: git-bash kill may not reap a native process.
  command -v taskkill >/dev/null 2>&1 && taskkill //PID "$PID" //F >/dev/null 2>&1 || true
  # A bounded shutdown prevents a stalled child from hanging the CI runner.
  for _ in $(seq 1 30); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.1
  done
  kill -KILL "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rm -rf "$SMOKE_HOME" || true
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

# Health is intentionally public. Test the actual protected engine handshake,
# including a negative control, rather than treating the word "Token:" in the
# startup banner as proof of authentication. Never put the token in process args.
TOKEN_FILE="$SMOKE_HOME/daemon/token"
[ -s "$TOKEN_FILE" ] || { echo "[smoke] FAIL: daemon token file missing"; exit 1; }
TOKEN="$(cat "$TOKEN_FILE")"
[[ "$TOKEN" =~ ^[0-9a-f]{48}$ ]] || { echo "[smoke] FAIL: unexpected daemon token format"; exit 1; }
URL="http://127.0.0.1:${PORT}/api/v1/meta/version"
anonymous="$(curl -sS -o /dev/null -w '%{http_code}' "$URL")"
wrong="$(printf 'header = "Authorization: Bearer %s"\n' '000000000000000000000000000000000000000000000000' | curl -sS -K - -o /dev/null -w '%{http_code}' "$URL")"
authorized="$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl -sS -K - -o "$SMOKE_HOME/version.json" -w '%{http_code}' "$URL")"
unset TOKEN
[ "$anonymous" = 401 ] || { echo "[smoke] FAIL: anonymous version request returned $anonymous, expected 401"; exit 1; }
[ "$wrong" = 401 ] || { echo "[smoke] FAIL: incorrect bearer returned $wrong, expected 401"; exit 1; }
[ "$authorized" = 200 ] || { echo "[smoke] FAIL: authorized version request returned $authorized, expected 200"; exit 1; }
grep -qE '"version"[[:space:]]*:[[:space:]]*"[^" ]+' "$SMOKE_HOME/version.json" || { echo "[smoke] FAIL: authenticated version response lacked version"; exit 1; }
echo "[smoke] PASS: public health OK; protected version denied anonymous/invalid bearer and accepted the daemon token"
