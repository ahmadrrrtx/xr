# XR Phase 3 — STEP 7/8 Test Results (live evidence)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Host:** Linux x64 sandbox (2 vCPU / ~2 GB) · Bun 1.3.14 · Date 2026-08-01

## Full suite

```
2293 pass · 0 fail · 8407 expect() calls · 157 files   (bun test)
```

## Phase 3 test categories (test/perf/ + test/perf/binary-smoke)

| Category | File | Result | What it asserts |
|---|---|---|---|
| Startup latency p50/p95 (warm+cold, isolated) | startup-latency.test.ts | 4/4 ✅ | `--version`/`--help` p95 within budget × 1.25 guard, 7–9 samples, fresh XR_HOME per cold sample, warm-up discarded |
| Boot profile (subsystems-per-command) | boot-profile.test.ts | 8/8 ✅ | `config` boots [config]; `doctor` boots 4 providers; `skills` boots 1; strict-subset + dependency-order + full-boot default |
| Binary smoke (compile-safe lazy imports) | binary-smoke.test.ts | 6/6 ✅ | Built binary: `--version`, `--help`, `doctor --json`, `workspace list --json`, `config get provider` |
| Hot-path sync-I/O lint | hot-path-lint.test.ts | 3/3 ✅ | Fast path = 0 sync FS/process calls; seeded violation caught (non-vacuous) |
| Stall detection | stall-detection.test.ts | 4/4 ✅ | Synthetic 120 ms block detected; golden path zero violations; detach idempotent; XRApp wiring |
| Render perf (dashboard < 1 s) | render-perf.test.ts | 1/1 ✅ | Daemon dashboard HTML first render p95 ~12–15 ms |
| Model-switch rollback | model-switch.test.ts | 7/7 ✅ | Happy path, preflight refusal, canary rollback, --force, swap-failure rollback, verify-mismatch rollback, bounded warm timeout |
| Metrics capture | metrics-capture.test.ts | 3/3 ✅ | TTFT/tokens/s/high-water recorded + persisted; secret-whitelist enforced; failure paths recorded |
| Load admission | load-admission.test.ts | 8/8 ✅ | 70B-on-lightweight DENIED; q4 7B admitted; fp16 7B denied; GPU admit; --force; tier profiles; quantization footprints |
| Incremental index correctness | incremental-index.test.ts | 3/3 ✅ | First pass embeds 50/50; second pass skips 50/50 (≥90% target); 1 changed row → exactly 1 re-embedded; hash stored + matches |
| Perf gate (seeded regression) | perf-gate.test.ts | 5/5 ✅ | Budget violation fails; >10% regression fails; waiver silences; published budget set complete |
| Scan cache (T4) | scan-cache.test.ts | 6/6 ✅ | miss→hit, identical payload, invalidation on change + state file, corrupt cache fallback, merkle fingerprint |

## CI-grade gates (run live)

| Gate | Result | Evidence |
|---|---|---|
| `bun run scripts/perf-gate.ts --samples 21 --baseline docs/perf/baseline-7.0.1-source.json` | ✅ PASS | All 9 scenarios PASS (see table below) |
| **Seeded regression** (baseline halved) | ✅ FAILS (exit 1) | 4 × `[regression]` violations; "no waivers applied" |
| `bun run hot-path-lint` | ✅ | fast path: 0 sync calls |
| `bun run boundaries` | ✅ | no violations (512 modules, 1592 deps) |
| `bun run size-gate` | ✅ | all over-threshold modules have owned waivers |
| `bun run release:check` / `claim-lint` | ✅ | 6 surfaces in sync · 8 evidenced claims |
| golden-path (install→work→restart→recover→uninstall) | ✅ | 17/17 checks, chain intact, exit 0 |
| `bun test` (full) | ✅ | 2293 pass / 0 fail |

## Perf gate scenario table (live run, 21 samples)

| Scenario | p50 | p95 | baseline | budget | verdict |
|---|---:|---:|---:|---:|---|
| Version cold | 35.2 | 54.3 | 55.7 | 300 | PASS |
| Version warm | 35.8 | 42.5 | 47.4 | 150 | PASS |
| Help cold | 36.9 | 37.9 | 42.6 | 300 | PASS |
| Help warm | 38.4 | 43.1 | 43.9 | 150 | PASS |
| Doctor | 323.9 | 359.5 | 474.4 | 1500 | PASS |
| Workspace list | 108.8 | 132.8 | 140.4 | — | PASS |
| Route decision | 0.0 | 0.0 | 0.003 | 20 | PASS |
| Dashboard render | 11.3 | 12.2 | 15.6 | 1000 | PASS |
| Retrieval @100k | 25.0 | 31.2 | 33.7 | 100 | PASS |

> Budget column = Constitution Article XII ceilings. The first CI run failed
> the UNCALIBRATED regression band (baseline measured on a different host);
> with machine calibration the same numbers pass (see KNOWN_LIMITATIONS P11).
