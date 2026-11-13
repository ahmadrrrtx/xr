#!/bin/bash
# XR Preview 1 — CLI truth: the binary answers, knows its own version, and reports
# its environment honestly. No provider, no network, no state.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

export XR_HOME="$(smoke_home)"
ver_file="$(smoke_root)/release.manifest.json"
want="$(grep -o '"version": *"[^"]*"' "$ver_file" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"

out="$(smoke_xr --version 2>&1)" || { smoke_fail "--version exited non-zero"; out=""; }
if printf '%s' "$out" | grep -qF "$want"; then
  smoke_pass "--version reports $want"
else
  smoke_fail "--version did not report $want (got: ${out:0:120})"
fi

if smoke_xr --help >/dev/null 2>&1; then smoke_pass "--help exits 0"; else smoke_fail "--help exited non-zero"; fi

# doctor: exit status is informational, but it must SAY something about providers.
dout="$(smoke_xr doctor 2>&1)" || true
if printf '%s' "$dout" | grep -qi "provider"; then
  smoke_pass "doctor reports provider state"
else
  smoke_fail "doctor printed no provider state"
fi

capfile="${TMPDIR:-/tmp}/xr-env-capabilities.json"
if smoke_xr env capabilities --json >"$capfile" 2>/dev/null; then
  if bun -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit(Array.isArray(j.entries)&&j.entries.length>0?0:1)' "$capfile"; then
    smoke_pass "env capabilities --json is valid JSON with entries ($(bun -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).os)' "$capfile"))"
  else
    smoke_fail "env capabilities --json has no entries"
  fi
else
  smoke_fail "env capabilities --json exited non-zero"
fi

smoke_summary "cli"
