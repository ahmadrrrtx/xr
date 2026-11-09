#!/bin/bash
# XR Preview 1 — one governed agent turn against a loopback provider.
#
# Proves the whole pipeline without a credential or a real model: provider
# resolution → planner loop → tool registry → approval gate → honest reporting.
# The mock asks for ONE shell command. On an UNATTENDED run the approval gate must
# DENY it ("no terminal to ask on"). If that command ever ran, this is a FAIL —
# a hands-free shell is the single worst defect this release could ship.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

if ! command -v bun >/dev/null 2>&1; then smoke_blocked "bun is not on PATH"; smoke_summary "agent-turn"; exit $?; fi
if ! smoke_start_mock 11434 "${TMPDIR:-/tmp}/xr-mock-agent.log"; then
  smoke_fail "loopback mock provider did not start"
  smoke_summary "agent-turn"; exit $?
fi
trap smoke_stop_mock EXIT

export XR_HOME="$(smoke_home)"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/xr-smoke-ws.XXXXXX")"
log="${TMPDIR:-/tmp}/xr-agent-turn.log"

cd "$workdir" || exit 1
smoke_xr --provider ollama --model qwen2.5:3b "run the shell command whoami" >"$log" 2>&1
rc=$?

# Documented exit codes: 0 done · 3 network · 4 approval DENIED. An unattended run
# that reaches the approval gate must exit 4 — exit 0 would mean a hands-free shell.
case "$rc" in
  4) smoke_pass "exit code 4 = approval denied (the documented code for this outcome)" ;;
  0) smoke_fail "the turn exited 0 with no approval prompt — a hands-free shell ran; this is a security FAIL" ;;
  *) smoke_fail "the one-shot turn exited $rc (expected 4 = denied; see $log)" ;;
esac
if grep -q "MOCK-REPORT" "$log"; then
  smoke_pass "the mock provider drove a complete turn (provider → tool → report)"
else
  smoke_fail "no MOCK-REPORT in the transcript — the turn did not complete"
fi

# The safety hinge: unattended approval must deny, and say so.
if grep -qiE "no terminal to ask on|denied whoami|shell denied" "$log"; then
  smoke_pass "the unattended shell call was DENIED at the approval gate"
else
  smoke_fail "the shell call was not denied — inspect $log"
fi
# and it must not have executed: `whoami` output is a bare username line.
if grep -qE "^\s*(root|runner|user|[A-Za-z0-9._-]+)\s*$" "$log" && ! grep -qi "denied" "$log"; then
  smoke_fail "command output appeared without a denial"
fi

smoke_summary "agent-turn"
