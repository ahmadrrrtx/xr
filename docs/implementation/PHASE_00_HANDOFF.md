# PHASE 00 HANDOFF — Baseline / Freeze / Safety

**Status:** COMPLETE  
**PR base:** current `main` (includes Phase 01 PR #58). Phase 00 artifacts are additive; they must not replace Phase 01 PERF-BUDGETS §12 or `perf:daemon-routes`.  
**Baseline date:** 2026-08-15  
**Artifact dir:** `benchmarks/baseline/2026-08-15/`

## CURRENT BASELINE COMMIT (code measured)

`96802988904b0ce3c477f501b23de0009b28c751`

This is the production code tip that was measured. **No production performance code changed.**

## PHASE 00 ARTIFACT COMMITS

| Commit | Role |
|---|---|
| `99ea5fb7bd9f992ffd1ff530f589dd3ff3009330` | Primary Phase 00 baseline tooling + artifacts |
| `c2538a8429613c4488d3c70c696c9002a55a3874` | Metadata stamp (HEAD of phase00 series) |

When you apply these on your machine, commit hashes will differ if you recreate commits; that is fine. The **file contents** are what matter for the PR.

## HISTORICAL PRE-PHASE-01 COMMIT

`UNKNOWN_OR_IDENTICAL`

Evidence: `src/local/runtimes.ts` still sequential; `src/daemon/routes/providers.routes.ts` still unbounded health; `src/local/hardware.ts` still `spawnSync`. No Phase 01 performance commit exists on this clone. Forensic audit referenced the same tip (`9680298`).

## XR VERSION

1.0.0 (Truth) — `@rrrtx/xr`

## BUN

1.3.14 (matches `.bun-version`)

## NODE

20.20.2

## ENVIRONMENT

- OS: Linux x64 (e2b.local), kernel 6.1.x
- CPU: 2× Intel Xeon @ 2.60GHz
- RAM: ~1.9 GiB
- Hardware tier (detectHardwareSpecs): unsupported (no GPU tools in environment)

## TESTS

**2950 pass / 0 fail / 19 skip** across 242 files (final suite after ownership map regen).

## TYPECHECK

PASS (`tsc --noEmit`)

## BOUNDARIES

PASS — 538 modules, 1740 dependencies, 0 violations

## SECURITY

PASS — 157 pass / 0 fail (`test/security/`, plugins, agent, context security, capability manifest)

## AUDIT

PASS — chain valid on fresh XR_HOME (`/api/audit`, overview.audit)

## GOLDEN TASKS

PASS — hermetic `scripts/golden-path.ts` (install → first answer → restart → resume → second answer → uninstall).  
Note: the external forensic “16 golden scenarios” suite is **not** an executable suite in this repository; certification belongs to a later phase.

## PERFORMANCE (CURRENT FROZEN BASELINE)

| Metric | p50 | p95 | Phase 01 target | Notes |
|---|---:|---:|---|---|
| providers.list (daemon) | ~533 ms | ~640 ms | < 2500 ms | MEETS target on empty XR_HOME; forensic 17–18s not reproduced |
| models.list (daemon) | ~38 ms | ~51 ms | < 2500 ms | MEETS; forensic 7–13s not reproduced |
| onboarding.status | ~60 ms | ~85 ms | < 3000 ms | MEETS; forensic 10–12s not reproduced |
| daemon startup | ~6 ms | ~53 ms | — | serve({port:0}) + /api/health |
| dashboard FMP | ~553 ms | ~647 ms | < 2000 ms | html + parallel loadDashboard batch |
| chat TTFT | ~5 ms | ~12 ms | (Phase 05) | **HTTP 503 all samples** (no provider) |
| memory recall | ~1.9 ms | ~5.1 ms | < 250 ms | 50 seeded entries, lexical recall |
| CLI --version | ~41 ms | ~52 ms | < 150 warm / 300 cold | MEETS |
| CLI --help | ~41 ms | ~46 ms | < 150 warm / 300 cold | MEETS |
| CLI providers list | ~160 ms | ~200 ms | — | MEETS historical ~171 ms order |
| CLI models list | ~156 ms | ~172 ms | — | MEETS historical ~173 ms order |
| CLI doctor --json | ~380 ms | ~404 ms | < 2500 ms gate | MEETS |
| tools read/write/list/shell p95 | <16 ms | | ref 100/200/5000 | MEETS |

### Tool execution (p95)

- read_file ~0.28 ms  
- write_file ~0.43 ms  
- list_dir ~1.04 ms  
- shell ~15.9 ms  

## KNOWN PRE-EXISTING FAILURES / GAPS

1. **Chat 503** without configured provider / local runtime — Phase 05 (streaming + fallback).
2. **Sequential `detectAllRuntimes`** still in source — Phase 01 (even if fast-fail here).
3. **Unbounded provider health** in daemon providers.list — Phase 01.
4. **`spawnSync` hardware detection** — Phase 01.
5. Forensic multi-second latencies are **host/workload dependent**; do not assume they appear on every empty sandbox.

## PHASE 01 TARGETS (unchanged)

- providers.list p95 < 2.5s  
- models.list p95 < 2.5s  
- onboarding.status p95 < 3s  
- dashboard first meaningful paint < 2s  
- runtime detection 10 runtimes wall-clock < 3s  
- cached runtime lookup < 50 ms  
- hardware must not stall request path > 100 ms  
- no Bun 10s timeout on normal dashboard load  
- eliminate N+1 catalog rebuild  

## PHASE 01 MUST NOT CLAIM IMPROVEMENT UNTIL

1. Measurements are taken with the **same methodology** as `scripts/phase00/capture-baseline.ts` (isolated XR_HOME, documented sample counts, p50/p95).  
2. Results are written beside this baseline and compared numerically.  
3. Structural Phase 01 items (parallel runtime detection, bounded health + cancellation, catalog once, async/cached hardware, request dedupe, SWR where safe) are implemented **or** audited as already present with tests.  
4. Security / reliability / typecheck / full tests remain green.  
5. No claim cites forensic 17–18s as “before” if the frozen baseline p95 is ~640 ms on the comparison host — cite **this** baseline.

## PHASE 01 FIRST ACTIONS

1. Diff current tree vs Phase 01 spec; inventory what is already present.  
2. Re-run `bun run baseline:phase00:validate`.  
3. Implement only missing Phase 01 items.  
4. Re-measure and certify against `benchmarks/baseline/2026-08-15/`.

## COMMANDS

``bash
bun run baseline:phase00              # re-capture (overwrites date dir if re-run)
bun run baseline:phase00:validate     # artifact integrity
bun run typecheck && bun test && bun run boundaries
``

## ROLLBACK

``bash
git revert <phase00-commit>
# or
git checkout <parent> -- benchmarks/baseline scripts/phase00 docs/implementation/PHASE_00_HANDOFF.md docs/perf/PERF-BUDGETS.md package.json docs/OWNERSHIP.md
``

## PHASE 01 HANDOFF

**READY**
