#!/usr/bin/env bash
# =============================================================================
# Phase 31 · A11 — production dependency vulnerability gate.
#
# Why this exists (and why it is not just `bun audit`):
#   The phase spec calls for `bun audit --environment production --json`, but
#   neither the pinned Bun 1.3.14 nor current Bun accepts an `--environment`
#   flag — `bun audit` always reports against the whole installed tree,
#   including devDependencies. Dev-only advisories (a vulnerable test runner,
#   a build plugin) must not block a release, and production advisories must
#   never be waved through because "most of these are probably dev stuff".
#   So this script does the environment split itself:
#
#     1. bun install --frozen-lockfile --ignore-scripts
#        (lockfile is the source of truth; no install script ever runs —
#        same supply-chain rule as the CI install steps)
#     2. bun audit --json
#     3. BFS from package.json's production `dependencies` through the
#        installed node_modules graph; an advisory only counts when its
#        package is reachable from that production set.
#     4. Exit 1 when any reachable advisory is HIGH or CRITICAL.
#
# Usage:
#   scripts/audit-deps.sh              # audit the repository root
#   scripts/audit-deps.sh website ...  # audit additional Bun projects too
#
# Requires: bun on PATH.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

audit_project() {
  local dir="$1"
  echo "── audit-deps: $dir"
  cd "$dir"

  if [[ ! -f package.json ]]; then
    echo "audit-deps: no package.json in $dir" >&2
    return 1
  fi
  if [[ ! -f bun.lock && ! -f bun.lockb ]]; then
    echo "audit-deps: no bun.lock in $dir — this gate audits Bun projects" >&2
    return 1
  fi

  bun install --frozen-lockfile --ignore-scripts || return "$?"
  local audit_json audit_status=0 rc=0
  audit_json="$(mktemp)" || return 1
  bun audit --json >"$audit_json" || audit_status=$?
  bun "$ROOT/scripts/audit-deps-filter.ts" "$audit_json" "$audit_status" || rc=$?
  rm -f "$audit_json"
  return "$rc"
}

targets=("$ROOT")
if [[ $# -gt 0 ]]; then
  targets=()
  for arg in "$@"; do
    targets+=("$(cd "$arg" && pwd)")
  done
fi

status=0
for dir in "${targets[@]}"; do
  audit_project "$dir" || status=1
done
exit $status
