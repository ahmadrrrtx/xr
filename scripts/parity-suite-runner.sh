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
#     segment, so a red job is always self-diagnosing. A failed segment ALSO
#     emits per-culprit annotations (failed tests / error lines / locating
#     frames / crash vocabulary — see diagnose_segment) so the root cause is
#     visible in the check annotations without opening raw logs.
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

  # Crash class that survived the retry. A directory-level "exit 3, no test
  # failures" names the DIRECTORY but not the FILE, which is exactly why the
  # win32 test/perf/ panic could not be attributed from CI logs (the previous
  # attempt excluded binary-smoke.test.ts on a guess; the lane stayed red).
  # Bisect: run each file in its own process. This is diagnosis, not
  # suppression — see the honesty rules in isolate_segment.
  if ! grep -qE '\(fail\)' "$out" && ! tr -d '\r' <"$out" | grep -qE '^[[:space:]]*[1-9][0-9]*[[:space:]]+fail$'; then
    echo "::warning::$label still crash-class after retry — isolating file-by-file to name the culprit"
    cat "$out"
    isolate_segment "$seg" "$out" "$label"
    return $?
  fi

  echo "::error::$label FAILED (exit ${code}) — full output:"
  diagnose_segment "$out"
  cat "$out"
  return "$code"
}

# Run every file of a crash-class segment in its OWN process.
#
# Honesty rules (Art. XX.4 / Commandment 2) — this must never turn a real
# failure green:
#   - ANY file reporting a test failure => the segment FAILS, and the failing
#     file is named in an annotation. No exceptions.
#   - ANY file that still dies alone => the segment FAILS, and that file is
#     named as the crash culprit. This is the outcome that finally attributes
#     a runtime panic to a single file.
#   - Only if EVERY file passes alone does the segment pass — and then every
#     test in it demonstrably ran and passed, so coverage is intact and the
#     gate's meaning ("all tests ran and passed") is preserved. A loud warning
#     records that isolation was required, because needing it is itself a
#     defect signal worth tracking rather than hiding.
isolate_segment() {
  local seg="$1" out="$2" label="$3"
  local failed="" crashed="" isolated_ok=1
  for f in $seg; do
    # shellcheck disable=SC2086
    bun test "$f" >"$out.one" 2>&1
    local c=$?
    if [ "$c" -eq 0 ]; then
      echo "  [isolated ok]    $f"
      continue
    fi
    isolated_ok=0
    if grep -qE '\(fail\)' "$out.one" || tr -d '\r' <"$out.one" | grep -qE '^[[:space:]]*[1-9][0-9]*[[:space:]]+fail$'; then
      echo "::error::REAL TEST FAILURE in $f (isolated, exit ${c})"
      failed="$failed $f"
    else
      echo "::error::CRASH CULPRIT: $f dies alone (exit ${c}, zero test failures) — runtime/process-level defect, not an assertion"
      crashed="$crashed $f"
    fi
    diagnose_segment "$out.one"
    cat "$out.one"
  done
  rm -f "$out.one"

  if [ "$isolated_ok" -eq 1 ]; then
    echo "::warning::$label passed only when files were isolated — every file ran and passed alone, so coverage is intact, but the aggregated process died. Track this as a runtime/load defect, not a test defect."
    return 0
  fi
  echo "::error::$label FAILED — real failures:${failed:- none} · crash culprits:${crashed:- none}"
  return 1
}

# Surface the specific culprits as annotations in addition to the segment
# header above — the header says WHICH directory failed but not WHICH test.
# bun already annotates per-test failures; this covers the shapes it does NOT
# annotate: "(fail)" lines when output got reshaped (CRLF/spawned output),
# file/module-level "error:" lines (beforeAll/afterAll/module-top throws),
# and crash-class process deaths. A red lane must name its root cause in the
# check annotations WITHOUT opening raw logs (PR #45 could not be diagnosed
# from the segment header alone). POSIX only: grep -E, tr, sed, head, cut —
# identical on bash 3.2/macOS and bash 5/Linux.
diagnose_segment() {
  local out="$1"
  # 1. Explicit failed tests (any source): "(fail) <describe > name> [ms]"
  grep -E '^[[:space:]]*\(fail\)[[:space:]]' "$out" | head -8 | tr -d '\r' \
    | sed -e 's/[[:space:]]*\[[0-9.]*ms\][[:space:]]*$//' -e 's/^[[:space:]]*/::error::FAILED TEST: /' \
    | cut -c1-256
  # 2. File/module-level errors: "error: <summary>" (hook throws etc.).
  #    NOT anchored to column 0: bun indents errors that belong to a test body,
  #    and an anchored pattern silently missed those — a failing Windows-only
  #    assertion then produced a named test with NO visible cause.
  grep -E '^[[:space:]]*error: ' "$out" | head -6 | tr -d '\r' \
    | sed 's/^[[:space:]]*/::error::ERROR: /' | cut -c1-256
  # 2b. The assertion diff itself (Expected/Received), which is what actually
  #     identifies a wrong value. Without this a red lane names the test but
  #     never says what differed.
  grep -E '^[[:space:]]*(Expected|Received)([[:space:]]*:|[[:space:]])' "$out" | head -8 | tr -d '\r' \
    | sed 's/^[[:space:]]*/::error::ASSERT: /' | cut -c1-256
  # 3. Stack frames that locate an error: "at <fn> (path:line:col)"
  grep -E '^[[:space:]]*at .*[\\/][^()]+:[0-9]+:[0-9]+' "$out" | head -4 | tr -d '\r' \
    | sed 's/^[[:space:]]*/::error::FRAME: /' | cut -c1-256
  # 4. Process-crash vocabulary (panics/OOM/signals) for crash-class exits.
  grep -Ei 'panic|segmentation fault|illegal instruction|aborted|bus error|out of memory|heap' "$out" | head -4 \
    | tr -d '\r' | sed 's/^/::error::CRASH TRACE: /' | cut -c1-256
  return 0
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
