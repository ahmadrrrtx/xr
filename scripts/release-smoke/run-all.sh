#!/bin/bash
# XR Preview 1 — WS3 smoke runner (T12).
#
# One command that exercises the shipped surfaces end to end and prints a line per
# check. It is written to be run BOTH here (Linux) and on the Windows runner, so a
# green run is a real result on the host that produced it — never a translation of
# Linux output into a platform claim.
#
#   bash scripts/release-smoke/run-all.sh            # everything
#   XR_BIN=/path/to/xr.exe bash scripts/release-smoke/run-all.sh   # a compiled binary
#
# Exit code is 0 only when nothing FAILED. NOT RUN / BLOCKED are reported as what
# they are and do not fail the run — but they are never counted as passes either.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

total_pass=0; total_fail=0; total_blocked=0; total_notrun=0; suite_errors=0
suites=()

run_suite() {
  local name="$1"; shift
  echo
  echo "════ $name"
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  printf '%s\n' "$out"
  suites+=("$name")
  # scrape the suite's own counters (single source: lib.sh's summary line)
  local p f b n
  p="$(printf '%s' "$out" | sed -n 's/.*: \([0-9]*\) passed.*/\1/p' | tail -1)"
  f="$(printf '%s' "$out" | sed -n 's/.* \([0-9]*\) failed.*/\1/p' | tail -1)"
  b="$(printf '%s' "$out" | sed -n 's/.*· \([0-9]*\) blocked.*/\1/p' | tail -1)"
  n="$(printf '%s' "$out" | sed -n 's/.* \([0-9]*\) not run.*/\1/p' | tail -1)"
  if [ -z "$p" ] || [ -z "$f" ] || [ -z "$b" ] || [ -z "$n" ]; then
    echo "FAIL     $name did not emit a complete smoke summary (exit $rc)"
    suite_errors=$((suite_errors + 1))
    return 1
  fi
  if [ "$rc" -ne 0 ]; then
    echo "FAIL     $name exited non-zero ($rc)"
    suite_errors=$((suite_errors + 1))
  fi
  total_pass=$((total_pass + p))
  total_fail=$((total_fail + ${f:-0}))
  total_blocked=$((total_blocked + ${b:-0}))
  total_notrun=$((total_notrun + ${n:-0}))
  return 0
}

run_suite "cli"        bash scripts/release-smoke/smoke-cli.sh
run_suite "agent-turn" bash scripts/release-smoke/smoke-agent-turn.sh
run_suite "isolation"  bash scripts/release-smoke/smoke-isolation.sh
for feature in providers budget security research orchestration ecosystem telegram mobile voice control local; do
  run_suite "$feature" bash "scripts/release-smoke/smoke-$feature.sh"
done

echo
echo "════ summary"
echo "  host: $(uname -s)/$(uname -m)"
echo "  ${total_pass} passed · ${total_fail} failed · ${total_blocked} blocked · ${total_notrun} not run"
if [ "$total_fail" -ne 0 ] || [ "$suite_errors" -ne 0 ]; then
  echo "  RESULT: FAIL"
  exit 1
fi
if [ "$total_pass" -eq 0 ]; then
  echo "  RESULT: NOT RUN (nothing executed)"
  exit 1
fi
if [ "$total_blocked" -ne 0 ] || [ "$total_notrun" -ne 0 ]; then
  echo "  RESULT: PASS (with ${total_blocked} blocked, ${total_notrun} not run)"
else
  echo "  RESULT: PASS"
fi
