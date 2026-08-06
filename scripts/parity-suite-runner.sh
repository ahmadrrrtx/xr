#!/usr/bin/env bash
# XR — per-directory segmented test runner with crash-class retry.
#
# Replaces the inline loop in .github/workflows/cross-platform.yml "Full unit
# suite" step. Behaviour is identical to the inline version EXCEPT for one
# deliberate addition: a segment whose `bun test` process dies WITHOUT
# reporting any test failure is retried ONCE with a fresh process.
#
# Why: bun test processes intermittently die on hosted runners in
# transpiler/GC/teardown under accumulated load (documented in the workflow
# comment: "win32 exit 3 at ~85s — no test-failure output"). Segmentation
# already bounds this; a single crash-class retry with a brand-new process
# absorbs the remaining flake.
#
# Honesty contract (Art. XX.4 / Commandment 2):
#   - A segment that reports ANY test failure (any "(fail)" line or a summary
#     with N>0 fail) is FAILED immediately. No retry. Green must mean true.
#   - Only a non-zero exit with ZERO test failures is treated as a process
#     crash and retried. If the retry also fails, the segment FAILS and its
#     full captured output is printed.
#   - Every failure is emitted as a ::error:: annotation that NAMES the
#     segment, so a red job is always self-diagnosing.
#   - The executed-files guard is unchanged: RAN must equal EXPECTED or the
#     step fails (a file can never silently vanish).
#   - If the parity authority produces no files, the step FAILS (fail closed)
#     instead of silently running nothing.
#
# Portability notes (macOS ships bash 3.2; Linux GitHub runners ship bash 5.x):
#   - NO `set -u`: in bash < 4.4, expanding an EMPTY array ("${a[@]}") under
#     set -u raises "unbound variable" and kills the script silently. This
#     script avoids arrays and empty-array expansion entirely (a plain string
#     flag instead), so it behaves identically on bash 3.2 and 5.x.
#   - No GNU-only tools: uses only grep -E (POSIX ERE), tr, cut, sort, wc,
#     mkdir — all present on macOS and Linux.
#
# Usage: bash scripts/parity-suite-runner.sh <linux|darwin|win32>

# Fail fast if the OS argument is missing (explicit, not a nounset trap).
: "${1:?usage: parity-suite-runner.sh <linux|darwin|win32>}"
OS="$1"

FILES=$(bun run scripts/platform-parity.ts --os "$OS" --args)
EXPECTED=$(echo "$FILES" | wc -w)
echo "running $EXPECTED test files (per-directory segments, one computation authority)"

if [ "$EXPECTED" -eq 0 ]; then
  echo "::error::platform-parity produced no test files for $OS — refusing to run an empty suite (fail closed, Art. XX.4)"
  exit 1
fi

RAN=0
STATUS=0
# No mktemp dependency: a per-run dir under the OS temp dir. mkdir -p is
# portable (mktemp templates differ between BSD/macOS and GNU/Linux).
LOGDIR="${TMPDIR:-/tmp}/xr-parity-$$"
mkdir -p "$LOGDIR" || {
  echo "::error::cannot create log dir $LOGDIR"
  exit 1
}
trap 'rm -rf "$LOGDIR"' EXIT

# Run one segment. Return 0 on success; on a crash-class exit (non-zero with
# zero test failures) retry once with a fresh process before giving up.
run_segment() {
  local seg="$1" out="$2" label="$3"
  # shellcheck disable=SC2086
  bun test $(echo "$seg") >"$out" 2>&1
  local code=$?
  if [ "$code" -eq 0 ]; then
    cat "$out"
    return 0
  fi

  # Crash-class detection: no per-test failures AND no non-zero fail summary.
  # `tr -d '\r'` normalizes Windows CRLF so the summary regex matches.
  if ! grep -qE '\(fail\)' "$out" && ! tr -d '\r' <"$out" | grep -qE '^[[:space:]]*[1-9][0-9]*[[:space:]]+fail$'; then
    echo "::warning::$label exit code ${code} with 0 test failures (bun process crash/teardown class) — retrying once with a fresh process"
    cat "$out"
    # shellcheck disable=SC2086
    bun test $(echo "$seg") >"$out" 2>&1
    code=$?
    if [ "$code" -eq 0 ]; then
      cat "$out"
      return 0
    fi
  fi

  echo "::error::$label FAILED (exit ${code}) — full output:"
  cat "$out"
  return "$code"
}

XR_SEGDIRS=$(echo "$FILES" | tr ' ' '\n' | grep -E '^test/[^/]+/' | cut -d/ -f1,2 | sort -u)
for G in $XR_SEGDIRS; do
  SEG=$(echo "$FILES" | tr ' ' '\n' | grep -E "^$G/")
  N=$(echo "$SEG" | wc -l)
  RAN=$((RAN + N))
  echo "::group::suite segment $G/ — $N files"
  run_segment "$SEG" "$LOGDIR/$(echo "$G" | tr '/' '_').log" "suite segment $G/" || STATUS=1
  echo "::endgroup::"
done

ROOTSEG=$(echo "$FILES" | tr ' ' '\n' | grep -E '^test/[^/]+$' || true)
if [ -n "$ROOTSEG" ]; then
  N=$(echo "$ROOTSEG" | wc -l)
  RAN=$((RAN + N))
  echo "::group::suite segment test/ (root) — $N files"
  run_segment "$ROOTSEG" "$LOGDIR/root.log" "suite segment test/ (root)" || STATUS=1
  echo "::endgroup::"
fi

echo "executed $RAN of $EXPECTED files"
if [ "$RAN" -ne "$EXPECTED" ]; then
  echo "::error::SEGMENT GUARD FAILED: ran $RAN of $EXPECTED files — a file silently vanished (Art. XX.4)"
  exit 1
fi
exit $STATUS
