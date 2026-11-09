#!/bin/bash
# XR Preview 1 — isolation honesty (plan §3/D5).
#
# The claim under test is NOT "Windows is sandboxed". It is:
#   high-risk actions run inside an OS-level boundary on this host, OR they fail
#   closed and name the real remediation for THIS platform.
# The guarantee matrix is generated from live host probes, so the answer is the
# host's actual answer — on a Windows runner with no Docker it must read
# fail-closed, never "in-process, so probably fine".
set -uo pipefail
. "$(dirname "$0")/lib.sh"

out="${TMPDIR:-/tmp}/xr-guarantee-matrix.md"
if ! (cd "$(smoke_root)" && bun run scripts/guarantee-matrix.ts >"$out" 2>&1); then
  smoke_fail "the guarantee matrix generator exited non-zero"
  smoke_summary "isolation"; exit $?
fi

host="$(grep -m1 '\*\*Host:\*\*' "$out" || true)"
shell_row="$(grep -m1 'shell / arbitrary code' "$out" || true)"

if [ -z "$shell_row" ]; then
  smoke_fail "the matrix has no row for shell / arbitrary code"
  smoke_summary "isolation"; exit $?
fi
echo "  ${host}"
echo "  ${shell_row}"

# Columns: | Action class | Risk tier | Placement | Kernel boundary | ... | Fail-closed |
placement="$(printf '%s' "$shell_row" | awk -F'|' '{gsub(/^ +| +$/,"",$4); print $4}')"
boundary="$(printf '%s' "$shell_row" | awk -F'|' '{gsub(/^ +| +$/,"",$5); print $5}')"
failclosed="$(printf '%s' "$shell_row" | awk -F'|' '{gsub(/^ +| +$/,"",$10); print $10}')"

if [ -n "$boundary" ] && [ "$boundary" != "❌" ]; then
  smoke_pass "shell commands run inside an OS boundary here (placement: ${placement})"
elif printf '%s' "$failclosed" | grep -qiE "fail|✅"; then
  smoke_pass "no OS boundary on this host, and the action FAILS CLOSED (placement: ${placement})"
else
  smoke_fail "no OS boundary and no fail-closed marker — this host could run shell commands unsandboxed"
fi

# The remediation text must name a real option for this platform.
if grep -qiE "bubblewrap|Docker|Podman|AppContainer|Seatbelt" "$out"; then
  smoke_pass "remediation names a real backend for this platform"
else
  smoke_fail "remediation text names no actionable backend"
fi

smoke_summary "isolation"
