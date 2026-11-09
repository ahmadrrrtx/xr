#!/bin/bash
# XR Preview 1 — shared helpers for scripts/release-smoke/*.sh
#
# Rules these helpers enforce, because they are the rules the release is graded on:
#   · a check that did not execute is NOT RUN, never a pass;
#   · a check whose precondition is missing (no bun, no provider key, no sandbox
#     backend) is NOT RUN or BLOCKED with the reason, never silently green;
#   · the runner exits non-zero if anything FAILED.
#
# NOTE: CI runs bash with `-e`, so callers must use `if`/`||` around commands whose
# non-zero exit is the expected outcome (a refusal, a denied approval). A bare
# command that exits non-zero is a real failure and SHOULD stop the script.

SMOKE_PASS=0
SMOKE_FAIL=0
SMOKE_NOTRUN=0
SMOKE_BLOCKED=0

smoke_pass() { echo "PASS     $*"; SMOKE_PASS=$((SMOKE_PASS + 1)); }
smoke_fail() { echo "FAIL     $*"; SMOKE_FAIL=$((SMOKE_FAIL + 1)); }
smoke_notrun() { echo "NOT RUN  $*"; SMOKE_NOTRUN=$((SMOKE_NOTRUN + 1)); }
smoke_blocked() { echo "BLOCKED  $*"; SMOKE_BLOCKED=$((SMOKE_BLOCKED + 1)); }

smoke_summary() {
  local label="${1:-smoke}"
  echo "── ${label}: ${SMOKE_PASS} passed · ${SMOKE_FAIL} failed · ${SMOKE_BLOCKED} blocked · ${SMOKE_NOTRUN} not run"
  [ "${SMOKE_FAIL}" -eq 0 ]
}

# A scratch XR_HOME so a smoke run never touches the user's real state.
smoke_home() {
  local dir="${1:-$(mktemp -d "${TMPDIR:-/tmp}/xr-smoke-home.XXXXXX")}"
  mkdir -p "$dir"
  printf '%s\n' "$dir"
}

# Absolute path to the repo root, resolved ONCE at source time.
# Resolving lazily broke as soon as a smoke `cd`-ed into its scratch workspace:
# `scripts/release-smoke/../..` is relative to the CWD, not to this file, so the
# runner resolved to /src/index.ts and the whole suite died with "Module not found".
SMOKE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
smoke_root() {
  printf '%s\n' "$SMOKE_ROOT"
}

# Start the loopback mock provider, echo nothing, leave the PID in SMOKE_MOCK_PID.
# The mock is keyless (ollama preset) so a governed agent turn needs no credential.
smoke_start_mock() {
  local port="${1:-11434}"
  local log="${2:-${TMPDIR:-/tmp}/xr-mock.log}"
  bun "$(smoke_root)/scripts/release-smoke/mock-ollama.ts" --port "$port" >"$log" 2>&1 &
  SMOKE_MOCK_PID=$!
  for _ in $(seq 1 50); do
    if grep -q "MOCK READY" "$log" 2>/dev/null; then return 0; fi
    if ! kill -0 "$SMOKE_MOCK_PID" 2>/dev/null; then return 1; fi
    sleep 0.1
  done
  return 1
}

smoke_stop_mock() {
  if [ -n "${SMOKE_MOCK_PID:-}" ]; then
    kill "$SMOKE_MOCK_PID" 2>/dev/null || true
    wait "$SMOKE_MOCK_PID" 2>/dev/null || true
    unset SMOKE_MOCK_PID
  fi
}

# `xr` as a runnable command in this checkout (works for a compiled exe too,
# when XR_BIN is set by the Windows job).
smoke_xr() {
  if [ -n "${XR_BIN:-}" ]; then
    "$XR_BIN" "$@"
  else
    bun "$(smoke_root)/src/index.ts" "$@"
  fi
}
