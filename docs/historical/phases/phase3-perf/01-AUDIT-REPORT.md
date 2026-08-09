# XR Phase 3 — STEP 1 Audit Report (re-verified against live `main` b8be112)

**Date:** 2026-08-01 · **Repository:** github.com/ahmadrrrtx/xr @ `b8be112` (PR #33) · **Host:** Linux x64, 2 vCPU, ~2 GB RAM sandbox · Bun 1.3.14

## 1. Phase 0–2 re-verification

| Phase 0 item | Status | Evidence |
|---|---|---|
| Unified version identity (version.ts / PKG / manifest) | VERIFIED | `src/core/version.ts` + release:check green |
| Restart-safe vault / secrets | VERIFIED | security/secrets.ts present; tests green |
| Workflow executor delegation | VERIFIED | src/workflow/ absent; execution/workflow/ present |
| Stub removal (no ok:true stubs) | VERIFIED | claim-lint + 2235 tests green |
| AgentService envelope sole path | VERIFIED | services/agent-service.ts; no direct runAgent in surfaces |
| Canonical policy gate + fail-closed reviewer | VERIFIED | security/policies + review-decision tests green |
| Container bind (CONTAINER_BIND) | VERIFIED | daemon/server.ts + trust container backend |
| **Phase 1** WriteGate single-writer, BEGIN IMMEDIATE, busy_timeout, WAL | VERIFIED | state/write-gate.ts; concurrency tests green |
| Serialized audit + `xr audit repair` | VERIFIED | audit-repo + repair tests green |
| `VACUUM INTO` backups | VERIFIED | workspace-store backup path |
| Uninstall / atomic updater / reversible migrations / ADR 0001 | VERIFIED | install/uninstall + update/selfheal + migrations |
| **Phase 2** one execution envelope + no-bypass test | VERIFIED | execution/envelope + tests |
| One ToolRegistryService | VERIFIED | tools/registry-service.ts |
| Single routing authority (legacy router absent) | VERIFIED | no legacy router module |
| One planner (PlanningService) | VERIFIED | services/planning-service.ts |
| memory/ + workflow/ absent | VERIFIED | directories do not exist |
| Enforced boundaries + 0 cycles | VERIFIED | dependency-cruiser green (506 modules) |
| No phase-named modules; giant files split | VERIFIED | dashboard.ts → dashboard/ split |

## 2. Phase 3 surface audit (the measured tax)

| Item | Audit finding (BEFORE) |
|---|---|
| `bin/xr.cjs` | Node→Bun `spawnSync` wrapper: `which` probes (shell `command -v` via spawn) + `bun run src/index.ts`. **Measured tax: warm `--version` through the wrapper p95 241.0 ms vs 219.2 ms source — the wrapper adds ~20–40 ms on top of source, and source itself was already over budget.** |
| Router imports | 35 static top-level imports (33 command modules + daemon server + kernel). Dynamic: 3. Eager import cost measured: **213.9 ms** module-eval for the whole static graph. |
| Kernel boot | `XRKernel` → `XRApp` → **16 providers** registered for every command; `start()` = **144.9 ms** (SkillService scan 54.6 ms + CapabilityService scan 71.1 ms + ContextService 3.8 ms). |
| Sync I/O inventory | 507 sync FS/process calls across ~66 files; boot path: workspace state read/write + config read + skills scan + capability scan (all sync). |
| Scans | Full re-scan every boot: skills loader 79 ms, capability list 71 ms — no cache, no incremental. |
| Dashboard | Post-Phase-2 split (dashboard.ts → 3 modules); route renders full HTML; first-render measured **12–18 ms** (already within budget). |
| Model switch | `setActiveProvider`: single config write, no preflight/canary/rollback — **unexplained waits possible** (health probes unbounded). |
| Streaming metrics / load admission / incremental indexing / perf budgets | **ABSENT** (verified by grep + code reading). |

## 3. Measured perf baseline (BEFORE vs AFTER, fixed harness, isolated XR_HOME)

| Scenario | BEFORE p95 | AFTER p95 | Δ | Budget | Status |
|---|---:|---:|---:|---:|---|
| `--version` warm | 219.2 | **47.4** | −78% | 100 | BEFORE ❌ / AFTER ✅ |
| `--version` cold | 269.5 | **55.7** | −79% | 250 | BEFORE ❌ / AFTER ✅ |
| `--help` warm | 261.0 | **43.9** | −83% | 150 | BEFORE ❌ / AFTER ✅ |
| `--help` cold | 254.4 | **42.6** | −83% | 300 | ✅ both |
| `doctor --json` warm | 640.7 | **474.4** | −26% | 1000 | ✅ both |
| route decision (in-process) | 0.003 | 0.003 | — | 20 | ✅ both |
| dashboard first render | 15.4 | 15.6 | — | 1000 | ✅ both |
| retrieval @100k (in-process) | 37.1 | 33.7 | — | 100 | ✅ both |
| wrapper `--version` warm (node→bun) | 241.0 | retired (binary-first) | — | 100 | BEFORE ❌ |

**Conclusion:** the three headline budgets (`--version`/`--help` warm and
`--version` cold) were **broken** on pristine main; Phase 3 brings all budgets
under with 60–80% margins. The node→Bun spawn wrapper is retired from the
default path.

> Measurement integrity note: an early harness bug (scenario argv never
> appended → measured the bare shell path) was found and fixed; all numbers
> here come from the fixed harness. BEFORE was measured on a pristine
> `b8be112` git worktree with the same fixed harness.

## 4. Boot/import/sync-I/O inventory (BEFORE → AFTER)

| Inventory item | BEFORE | AFTER |
|---|---|---|
| Router static imports | 35 | 13 (all lightweight: flags/output/errors/version/catalog/help/route-decision/loaders/boot-trace) |
| Command modules loaded for `--version` | 33+ | 0 (kernel never loads) |
| Providers booted for `config get` | 16 | 1 (`config`) |
| Providers booted for `doctor` | 16 | 4 (`state, config, providers, capabilities`) |
| Providers booted for `skills` | 16 | 1 (`skills`) |
| Fast-path sync FS/process calls | ~10 | **0** (lint-enforced) |
| Boot-path scans | full re-scan (skills 79 ms / capabilities 71 ms) | content-addressed cache (skills ~22 ms warm) |
| `memory reindex` | re-embeds every row | skips unchanged rows (content hash) |
| Spawn wrapper on default path | node→bun (every invocation) | retired: binary-first launcher + installers |
| Model switch | config write only | preflight→warm→canary→swap→verify + rollback |
