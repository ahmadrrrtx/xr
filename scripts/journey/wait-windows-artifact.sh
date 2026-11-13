#!/usr/bin/env bash
# Wait only for the matching commit's x64 bundle; never substitute another SHA.
set -euo pipefail
: "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}" "${GITHUB_OUTPUT:?}"
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid full commit SHA' >&2; exit 1; }
wait_seconds="${1:-3600}"
interval="${2:-30}"
[[ "$wait_seconds" =~ ^[0-9]+$ && "$interval" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid wait parameters' >&2; exit 1; }
mkdir -p evidence
end=$((SECONDS + wait_seconds))
while :; do
  # PR runs can build GitHub's synthetic merge commit despite head_sha matching.
  # Accept only branch push/dispatch runs, whose checkout is the actual head SHA.
  if ! runs=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/desktop-app.yml/runs?head_sha=$GITHUB_SHA&per_page=100" \
    --jq '.workflow_runs[] | select(.head_sha == "'"$GITHUB_SHA"'" and (.event == "workflow_dispatch" or .event == "push")) | .id'); then
    echo 'BLOCKED: desktop workflow lookup failed' | tee evidence/artifact-status.txt; exit 1
  fi
  for run in $runs; do
    [[ "$run" =~ ^[0-9]+$ ]] || { echo 'Invalid desktop run ID' >&2; exit 1; }
    if ! count=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run/artifacts?per_page=100" \
      --jq '[.artifacts[] | select(.name == "xr-desktop-windows-x64" and .expired == false)] | length'); then
      echo 'BLOCKED: desktop artifact lookup failed' | tee evidence/artifact-status.txt; exit 1
    fi
    [[ "$count" =~ ^[0-9]+$ ]] || { echo 'Invalid artifact count' >&2; exit 1; }
    if [ "$count" -gt 1 ]; then echo 'BLOCKED: duplicate installer artifacts in a desktop run' | tee evidence/artifact-status.txt; exit 1; fi
    if [ "$count" -eq 1 ]; then
      printf 'head_sha=%s\ndesktop_run_id=%s\nartifact=xr-desktop-windows-x64\n' "$GITHUB_SHA" "$run" | tee evidence/artifact-status.txt
      printf 'run_id=%s\n' "$run" >> "$GITHUB_OUTPUT"
      exit 0
    fi
  done
  if [ "$SECONDS" -ge "$end" ]; then
    echo "BLOCKED: no unexpired xr-desktop-windows-x64 artifact from exact head $GITHUB_SHA within ${wait_seconds}s" | tee evidence/artifact-status.txt
    echo '::error::Installer lifecycle NOT RUN; matching desktop bundle did not become available.'
    exit 1
  fi
  sleep "$interval"
done
