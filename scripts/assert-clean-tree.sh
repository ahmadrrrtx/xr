#!/usr/bin/env bash
# XR-LAUNCH-033 — a test run must leave the checkout exactly as it found it.
# Tests write only to $TMPDIR or an artifact directory; this fails the job when
# any tracked file was modified or deleted, or any untracked file was created.
# Usage (CI, after a test lane):  bash scripts/assert-clean-tree.sh
set -euo pipefail
dirty="$(git status --porcelain --untracked-files=all)"
if [ -n "${dirty}" ]; then
  echo "::error title=Tests changed the checkout::A test wrote into the repository. Tests must write to \$TMPDIR or an artifact directory (XR-LAUNCH-033)."
  printf '%s\n' "${dirty}"
  git --no-pager diff --stat || true
  exit 1
fi
echo "assert-clean-tree: the checkout is clean"
