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

  bun install --frozen-lockfile --ignore-scripts

  local audit_json
  audit_json="$(mktemp)"
  # `bun audit` exits non-zero when it finds advisories; that is data for the
  # filter below, not a failure of the audit itself — hence `|| true`. A real
  # audit failure (no lockfile, registry error) produces unparseable output,
  # which the filter treats as a hard error.
  bun audit --json >"$audit_json" 2>/dev/null || true

  AUDIT_JSON="$audit_json" bun --eval '
    const fs = require("fs");

    const fail = (msg) => {
      console.error(`audit-deps: ${msg}`);
      process.exit(2);
    };

    let report;
    try {
      report = JSON.parse(fs.readFileSync(process.env.AUDIT_JSON, "utf8"));
    } catch {
      fail("bun audit did not produce JSON — treating as gate failure");
    }

    // Normalise `bun audit --json` output to [{name, severity, title, url, id}].
    // Current Bun emits { "<pkg>": [ {advisory}, ... ] }; accept a bare array
    // too so a future format change degrades into parsing, not silence.
    const advisories = [];
    const push = (name, a) => {
      if (!a || typeof a !== "object") return;
      advisories.push({
        name: name ?? a.name ?? a.package ?? "(unknown)",
        severity: String(a.severity ?? a.level ?? "unknown").toLowerCase(),
        title: a.title ?? a.summary ?? "",
        url: a.url ?? "",
        id: a.id ?? a.ghsa_id ?? "",
      });
    };
    if (Array.isArray(report)) {
      for (const item of report) push(item?.name ?? item?.package, item);
    } else if (report && typeof report === "object") {
      for (const [name, list] of Object.entries(report)) {
        if (Array.isArray(list)) for (const a of list) push(name, a);
        else if (list && Array.isArray(list.advisories))
          for (const a of list.advisories) push(name, a);
        else push(name, list);
      }
    }

    if (advisories.length === 0) {
      console.log("audit-deps: no advisories reported by bun audit");
      process.exit(0);
    }

    // Production-reachability BFS over the installed graph.
    const root = process.cwd();
    const readPkg = (dir) => {
      try {
        return JSON.parse(fs.readFileSync(`${dir}/package.json`, "utf8"));
      } catch {
        return null;
      }
    };
    const resolveDep = (name, parentDir) => {
      for (const base of [`${parentDir}/node_modules`, `${root}/node_modules`]) {
        const dir = `${base}/${name}`;
        if (fs.existsSync(`${dir}/package.json`)) return dir;
      }
      return null;
    };
    const depNames = (pkg) => [
      ...Object.keys(pkg?.dependencies ?? {}),
      ...Object.keys(pkg?.optionalDependencies ?? {}),
      ...Object.keys(pkg?.peerDependencies ?? {}),
    ];

    const rootPkg = readPkg(root);
    if (!rootPkg) fail(`no readable package.json in ${root}`);

    const production = new Set();
    const queue = depNames(rootPkg).map((name) => ({ name, from: root }));
    while (queue.length > 0) {
      const { name, from } = queue.shift();
      if (production.has(name)) continue;
      const dir = resolveDep(name, from);
      if (!dir) continue; // declared but not installed (e.g. skipped optional)
      production.add(name);
      const pkg = readPkg(dir);
      for (const dep of depNames(pkg)) {
        if (!production.has(dep)) queue.push({ name: dep, from: dir });
      }
    }

    const BLOCKING = new Set(["high", "critical"]);
    const blocking = [];
    const devOnly = [];
    for (const a of advisories) {
      if (!BLOCKING.has(a.severity)) continue;
      (production.has(a.name) ? blocking : devOnly).push(a);
    }

    for (const a of devOnly) {
      console.log(
        `audit-deps: ignored dev-only ${a.severity} in ${a.name} — ${a.title} ${a.url}`.trimEnd(),
      );
    }
    if (blocking.length > 0) {
      for (const a of blocking) {
        console.error(
          `audit-deps: PRODUCTION ${a.severity.toUpperCase()} in ${a.name} — ${a.title} ${a.url}`.trimEnd(),
        );
      }
      console.error(
        `audit-deps: FAIL — ${blocking.length} high/critical advisor${blocking.length === 1 ? "y" : "ies"} reachable from production dependencies`,
      );
      process.exit(1);
    }
    console.log(
      `audit-deps: PASS — no high/critical advisories in the production graph (${production.size} production packages, ${devOnly.length} dev-only ignored)`,
    );
  '
  local rc=$?
  rm -f "$audit_json"
  return $rc
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
