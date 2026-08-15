# XR Phase 00 — Baseline Report

**Date:** 2026-08-15  
**Generated:** 2026-08-15T11:50:22.151Z  
**Current baseline commit (pre-Phase00 artifact commit):** `96802988904b0ce3c477f501b23de0009b28c751`  
**XR:** 1.0.0 (Truth)  
**Environment:** Bun 1.3.14, Node 20.20.2, linux/x64, ~1.9 GiB RAM, 2× Xeon @ 2.60GHz  

## Semantics

| Label | Meaning |
|---|---|
| PASS | Check succeeded |
| FAIL | Check failed — recorded, not fixed |
| PRE-EXISTING GAP | Exceeds a *future* target; not a regression vs this freeze |
| REGRESSION | (Future phases only) worse than this baseline |
| BLOCKED / UNAVAILABLE | Could not measure |

## Gates

| Gate | Status | Detail |
|---|---|---|
| Typecheck | PASS | `tsc --noEmit` |
| Boundaries | PASS | 538 modules, 1740 deps, 0 violations |
| Full tests | PASS | **2950 pass / 0 fail / 19 skip** across 242 files |
| Security | PASS | 157 pass / 0 fail |
| Reliability | PASS | 133 pass / 0 fail |
| Audit chain | PASS | valid on fresh XR_HOME |
| Golden path | PASS | hermetic install→answer→restart→resume→uninstall |

## Performance (CURRENT FROZEN BASELINE)

### CLI (21 samples, p50 / p95 ms)

| Scenario | p50 | p95 | max |
|---|---:|---:|---:|
| version (cold) | 41.14 | 52.2 | 57.84 |
| version (warm) | 42.18 | 53.72 | 53.76 |
| help (cold) | 40.62 | 45.76 | 48.99 |
| help (warm) | 40.34 | 49.33 | 55.33 |
| providers list | 160.11 | 199.99 | 203.76 |
| models list | 156.0 | 172.0 | 179.87 |
| doctor --json | 380.01 | 403.91 | 403.95 |
| config show | 116.01 | 125.42 | 132.04 |

### Daemon API (isolated XR_HOME, no cloud keys, localhost)

| Endpoint | p50 ms | p95 ms | max ms | vs Phase01 target | Forensic historical |
|---|---:|---:|---:|---|---|
| health.get | 0.43 | 0.74 | 0.74 | MEETS (<500) | — |
| overview.get | 25.43 | 45.99 | 45.99 | MEETS (<500) | — |
| providers.list | 533.06 | 640.3 | 640.3 | MEETS (<2500) | 17–18s |
| models.list | 37.85 | 51.18 | 51.18 | MEETS (<2500) | 7–13s |
| onboarding.status | 60.2 | 85.04 | 85.04 | MEETS (<3000) | 10–12s |
| daemon startup | 6.42 | 52.82 | 52.82 | — | — |
| dashboard FMP | 553.32 | 646.58 | 646.58 | MEETS (<2000) | >10s timeout |
| chat TTFT | 5.0 | 11.86 | — | **503 all samples** | ~16.5s / 503 |
| memory recall | 1.88 | 5.12 | — | MEETS (<250) | — |

**Important:** Forensic historical multi-second daemon latencies were **not reproduced** on this host with an empty isolated `XR_HOME` (no local runtimes listening, no API keys). Health probes fail fast. The **code structure** that caused the forensic failures is still present (sequential `detectAllRuntimes`, unbounded `provider.health()`, `spawnSync` hardware) and remains Phase 01 scope. Current numbers are the freeze point for regression detection on this methodology.

### Tools (p95 ms)

- read_file: 0.284
- write_file: 0.435
- list_dir: 1.04
- shell: 15.938

## Pre-existing issues (not regressions)

- chat POST returns **503** without configured provider (Phase 05 scope)
- `detectAllRuntimes` is still sequential (`for` + `await`) — Phase 01
- `providers.list` health() appears unbounded — Phase 01
- `hardware.ts` still uses `spawnSync` on request path — Phase 01

## Historical pre-Phase-01 commit

`UNKNOWN_OR_IDENTICAL` — HEAD `9680298` still contains the sequential/unbounded patterns. No separate Phase-01 performance commit is present on this clone. Forensic docs reference the same tip.

## Artifacts

Directory: `benchmarks/baseline/2026-08-15/`

## Phase 01 handoff rule

Phase 01 must compare **after** measurements to **this** baseline (and to targets).
Do **not** treat forensic 17–18s figures as the frozen baseline when current measured numbers differ.
Do **not** claim improvement without measured deltas against these artifacts.

## Production code

**No production performance optimizations were made in Phase 00.**  
Only baseline tooling, docs, package scripts, ownership map regen, and artifacts.
