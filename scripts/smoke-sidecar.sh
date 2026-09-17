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
# =============================================================================
set -euo pipefail

TRIPLE="${1:?usage: smoke-sidecar.sh <target-triple>}"
PORT="${SIDECAR_SMOKE_PORT:-39417}"
EXT=""
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT) EXT=".exe" ;;
esac
BIN="desktop/src-tauri/binaries/xr-engine-${TRIPLE}${EXT}"

[ -f "$BIN" ] || { echo "[smoke] FAIL: $BIN not found"; exit 1; }

echo "[smoke] --version"
"$BIN" --version

echo "[smoke] booting serve on :$PORT (isolated XR_HOME)"
SMOKE_HOME="$(mktemp -d)"
XR_HOME="$SMOKE_HOME" "$BIN" serve --port "$PORT" > "$SMOKE_HOME/serve.log" 2>&1 &
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
    echo "[smoke] FAIL: sidecar exited early — log:"; cat "$SMOKE_HOME/serve.log" || true; exit 1
  fi
  if curl -sf "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1; then ok=1; break; fi
done

if [ -z "$ok" ]; then
  echo "[smoke] FAIL: health probe never answered — log:"; cat "$SMOKE_HOME/serve.log" || true; exit 1
fi

echo "[smoke] health OK — token handshake banner present:"
grep -q "Token: " "$SMOKE_HOME/serve.log" && echo "[smoke] PASS" || { echo "[smoke] FAIL: no token banner"; exit 1; }
