#!/bin/bash
# Deterministic, per-feature smoke entry point. No provider keys or user state.
# PASS means the named fixture tests ran, not that live services/devices ran.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
feature="${1:-}"
case "$feature" in
  providers) files=(test/providers/gateway.test.ts test/providers/offline-listing.test.ts);;
  budget) files=(test/cost.test.ts test/cost-adversarial.test.ts);;
  security) files=(test/security/audit-crypto.test.ts test/security/secrets.test.ts test/execution/approval-default.test.ts);;
  research) files=(test/research/citations.test.ts test/research/security.test.ts);;
  orchestration) files=(test/workflow/branch-condition-safety.test.ts test/daemon/workflows-routes.test.ts);;
  ecosystem) files=(test/security/mcp-allowlist.test.ts test/plugins/fs-authority.test.ts test/skills/quarantine-policy.test.ts);;
  telegram) files=(test/telegram/phase24.test.ts test/telegram.test.ts);;
  mobile) files=(test/daemon/mobile-companion.test.ts test/daemon/mobile-lan-integration.test.ts);;
  voice) files=(test/voice/session-states.test.ts test/voice/transcript.test.ts);;
  control) files=(test/security/desktop-control-policy.test.ts test/control/pause-stop.test.ts);;
  local) files=(test/daemon/onboarding-routes.test.ts test/providers/offline-listing.test.ts);;
  *) smoke_fail "unknown feature: $feature"; smoke_summary "feature"; exit 1;;
esac
if ! command -v bun >/dev/null 2>&1; then
  smoke_notrun "$feature fixtures require bun"
  smoke_summary "$feature"; exit 1
fi
log="$(mktemp "${TMPDIR:-/tmp}/xr-feature-smoke.XXXXXX")"
trap 'rm -f "$log"' EXIT
if (cd "$(smoke_root)" && bun test "${files[@]}" >"$log" 2>&1); then
  if grep -Eq '^[[:space:]]*[1-9][0-9]* pass([[:space:]]|$)' "$log"; then
    smoke_pass "$feature fixture tests executed ($(grep -E '^[[:space:]]*[0-9]+ pass' "$log" | tail -1 | xargs))"
  else
    smoke_fail "$feature produced no passing test count"
    tail -20 "$log"
  fi
else
  smoke_fail "$feature fixture tests failed"
  tail -30 "$log"
fi
if grep -q 'tests skipped:' "$log"; then smoke_notrun "$feature includes skipped fixture tests"; fi
case "$feature" in
  providers) smoke_notrun "live provider requires an owner-controlled key and spend cap";;
  telegram) smoke_notrun "live Telegram bot was not exercised by these fixtures";;
  mobile) smoke_notrun "installed desktop-to-phone pairing was not exercised by these fixtures";;
  voice) smoke_notrun "physical microphone and push-to-talk require an owner device";;
  control) smoke_notrun "real graphical computer control requires an owner OS and display";;
  local) smoke_notrun "a real local model was not exercised by these fixtures";;
esac
smoke_summary "$feature"
