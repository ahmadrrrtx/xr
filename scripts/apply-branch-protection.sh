#!/usr/bin/env bash
# XR-LAUNCH-012 (decision D7) — PRINT the owner-run command that makes the
# gate checks in .github/required-checks.json required on `main`.
#
# This script never calls the GitHub API itself: changing branch protection is
# an owner action (it needs an admin token, and it changes who can merge).
# Review the printed command, then run it yourself with an authenticated `gh`.
#
#   bash scripts/apply-branch-protection.sh            # print the command
#   bash scripts/apply-branch-protection.sh --json     # print only the payload
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC="$ROOT/.github/required-checks.json"
REPO="${XR_REPO:-ahmadrrrtx/xr}"

command -v bun >/dev/null 2>&1 || { echo "bun is required to read $SPEC" >&2; exit 2; }

PAYLOAD="$(bun -e '
  const spec = JSON.parse(await Bun.file(process.argv[1]).text());
  const contexts = spec.required.map((r) => r.context);
  if (contexts.length === 0) { console.error("no required checks in spec"); process.exit(2); }
  // strict: the branch must be up to date with main before merging, so a gate
  // result always describes the code that lands.
  console.log(JSON.stringify({ strict: true, contexts }, null, 2));
' "$SPEC")"
BRANCH="$(bun -e 'console.log(JSON.parse(await Bun.file(process.argv[1]).text()).branch)' "$SPEC")"

if [ "${1:-}" = "--json" ]; then
  printf '%s\n' "$PAYLOAD"
  exit 0
fi

cat <<MSG
# Owner-run: require the XR gate checks on ${REPO}@${BRANCH}.
# Prerequisite: branch protection already exists on ${BRANCH} (Settings →
# Branches). This only replaces the required status-check list.
# Run \`bun run ci:policy\` first — it verifies every context below is a real
# gate job name.

gh api --method PATCH \\
  -H "Accept: application/vnd.github+json" \\
  "repos/${REPO}/branches/${BRANCH}/protection/required_status_checks" \\
  --input - <<'JSON'
${PAYLOAD}
JSON
MSG
