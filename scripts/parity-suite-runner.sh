#!/usr/bin/env bash
# XR — per-directory segmented test runner with crash-class retry.
#
# Replaces the inline loop in .github/workflows/cross-platform.yml "Full unit
# suite" step. Behaviour is identical to the inline version EXCEPT for one
# deliberate addition: a segment whose `bun test` process dies WITHOUT
# reporting any test failure is retried ONCE with a fresh process.
#
# Why: bun-on-Windows intermittently crashes in transpiler/GC/teardown under
# accumulated load (documented in the workflow comment: "win32 exit 3 at
# ~85s — no test-failure output"). Segmentation already bounds this; a single
# crash-class retry with a brand-new process absorbs the remaining flake.
#
# Honesty contract (Art. XX.4 / Commandment 2):
#   - A segment that reports ANY test failure (any "(fail)" line or a summary
#     with N>0 fail) is FAILED immediately. No retry. Green must mean true.
#   - Only a non-zero exit with ZERO test failures is treated as a process
#     crash and retried. If the retry also fails, the segment FAILS and its
#     full captured output is printed.
#   - Every segment's output is captured and echoed, so a failing segment
#     always names itself (no silent loss).
#   - The executed-files guard is unchanged: RAN must equal EXPECTED or the
#     step fails (a file can never silently vanish).
#
# Usage: bash scripts/parity-suite-runner.sh <linux|darwin|win32>

set -u

OS="${1:?usage: parity-suite-runner.sh <linux|darwin|win32>}"

FILES=$(bun run scripts/platform-parity.ts --os "$OS" --args)
EXPECTED=$(echo "$FILES" | wc -w)
echo "running $EXPECTED test files (per-directory segments, one computation authority)"

RAN=0
STATUS=0
LOGDIR=$(mktemp -d "${TMPDIR:-/tmp}/xr-parity-XXXXXX")
trap 'rm -rf "$LOGDIR"' EXIT

# On Windows, cap worker-process parallelism: the documented crash class is
# load-driven (transpiler/GC/teardown under accumulated load), so reducing
# concurrent processes materially lowers the odds while staying fast enough.
if [ "$OS" = "win32" ]; then
  PARALLEL=(--parallel=2)
else
  PARALLEL=()
fi

# Run one segment. Return 0 on success; on a crash-class exit (non-zero with
# zero test failures) retry once with a fresh process before giving up.
run_segment() {
  local seg="$1" out="$2"
  # shellcheck disable=SC2086
  bun test "${PARALLEL[@]}" $(echo "$seg") >"$out" 2>&1
  local code=$?
  if [ "$code" -eq 0 ]; then
    cat "$out"
    return 0
  fi

  # Crash-class detection: no per-test failures AND no non-zero fail summary.
  if ! grep -qE '\(fail\)' "$out" && ! grep -qE '^[[:space:]]*[1-9][0-9]*[[:space:]]+fail$' "$out"; then
    echo "::warning::segment exit code ${code} with 0 test failures (bun process crash/teardown class) — retrying once with a fresh process"
    cat "$out"
    # shellcheck disable=SC2086
    bun test "${PARALLEL[@]}" $(echo "$seg") >"$out" 2>&1
    code=$?
    if [ "$code" -eq 0 ]; then
      cat "$out"
      return 0
    fi
  fi

  echo "::error::suite segment FAILED (exit ${code}) — full output:"
  cat "$out"
  return "$code"
}

XR_SEGDIRS=$(echo "$FILES" | tr ' ' '\n' | grep -E '^test/[^/]+/' | cut -d/ -f1,2 | sort -u)
for G in $XR_SEGDIRS; do
  SEG=$(echo "$FILES" | tr ' ' '\n' | grep -E "^$G/")
  N=$(echo "$SEG" | wc -l)
  RAN=$((RAN + N))
  echo "::group::suite segment $G/ — $N files"
  run_segment "$SEG" "$LOGDIR/$(echo "$G" | tr '/' '_').log" || STATUS=1
  echo "::endgroup::"
done

ROOTSEG=$(echo "$FILES" | tr ' ' '\n' | grep -E '^test/[^/]+$' || true)
if [ -n "$ROOTSEG" ]; then
  N=$(echo "$ROOTSEG" | wc -l)
  RAN=$((RAN + N))
  echo "::group::suite segment test/ (root) — $N files"
  run_segment "$ROOTSEG" "$LOGDIR/root.log" || STATUS=1
  echo "::endgroup::"
fi

echo "executed $RAN of $EXPECTED files"
if [ "$RAN" -ne "$EXPECTED" ]; then
  echo "SEGMENT GUARD FAILED: $RAN != $EXPECTED — a file silently vanished (Art. XX.4)"
  exit 1
fi
exit $STATUS
