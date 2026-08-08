# XR Phase 3 — STEP 2 Gap Analysis

Audited reality vs Constitution (Art. XII/VI) and the Phase 3 spec (Part 5/8).

| # | Gap (audited) | Constitutional/spec basis | Task | Budget targeted | Regression gate |
|---|---|---|---|---|---|
| G1 | Router statically imports all 33 command modules + daemon + kernel; fast paths pay the whole graph (214 ms module eval) | Art. XII · Forbidden "eager-importing the whole runtime"; Cmdt 11 | T1 | version-warm 100 ms / help-warm 150 ms | perf-gate + startup-latency tests |
| G2 | Every command boots all 16 providers (skills/capability scans on every boot, 145 ms in start()) | Art. VI.4 "a command boots only the subsystems it needs" | T1 | doctor 1000 ms / boot-profile | boot-profile tests |
| G3 | `bin/xr.cjs` node→Bun spawn wrapper on the default npm path (+35–50 ms) | Art. XII · Forbidden "node→runtime spawn wrappers" | T2 | version-warm 100 ms | perf-gate + binary smoke |
| G4 | No standalone compiled binary; no build matrix; no per-target distribution | Art. XII · Recommended "standalone compiled binary" | T2 | — | binary-smoke tests + matrix script |
| G5 | Hot paths use sync FS/process (507 calls repo-wide; boot path sync reads/writes) | Art. XII.4 "no synchronous I/O on hot paths; stalls are a defect" | T3 | fast-path sync I/O = 0 | hot-path-lint + stall tests |
| G6 | No event-loop stall detection | Art. XII.4 | T3 | — | stall-detection tests |
| G7 | Plugin/skill/config/shield scans are full re-scans (skills 79 ms) | Art. XII · Recommended "content-addressed incremental scans" | T4 | warm scan near O(changed) | scan-cache tests |
| G8 | Dashboard render un-benchmarked (first render 12 ms measured, ungated) | Part 5: dashboard < 1 s | T5 | dashboard 1000 ms | render-perf tests + gate |
| G9 | Model switch = single config write; unbounded health probes; no rollback | Part 5: state machine, no unexplained waits | T6 | — | model-switch tests |
| G10 | No streaming metrics (TTFT/tokens/s) captured or reportable | Art. XII · Recommended per-provider streaming metrics | T7 | — | metrics-capture tests |
| G11 | Local model loads never preflighted against hardware (OOM risk) | Part 5: local-load admission | T8 | — | load-admission tests |
| G12 | `memory reindex` re-embeds every row every time | Part 5: incremental large-repo indexing; 90%+ reduction | T9 | warm re-index ≥90% skip | incremental-index tests |
| G13 | No published budgets, no baseline artifacts, no CI regression gate | Art. XII.2 "no perf claim without a budget and a regression gate" | T10 | all budgets | perf-gate CI job + seeded-regression test |

**Not gaps (already satisfied):** retrieval @100k (33.8 ms < 100 ms), route
decision (0.003 ms < 20 ms), dashboard (12 ms < 1 s), doctor (< 1 s).
**Out of scope (must not be implemented):** risk-tiered isolation (Phase 4),
routing-quality work (Phase 5), release signing (Phase 9).
