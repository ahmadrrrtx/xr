# XR Phase 3 — Known Limitations Register (performance)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Every Phase 3 outcome that is a limitation — not a claim — with evidence,
owner, and review date. Nothing here is silently accepted.

| # | Limitation | Status | Evidence / remediation |
|---|---|---|---|
| P1 | Compiled binary size ≈ 91–96 MiB (bundled Bun runtime + 245–476 traced modules) | **open — accepted** | `scripts/build-matrix.ts` output; documented in PERF-BUDGETS.md §4. Smaller binaries need `--minify` (~1.3 MB saved) and, later, tree-shaking the eager service graph (Phase 4+ isolation will cut the traced module count). Owner: perf-eng · review: Phase 4. |
| P2 | Compiled binary cold-start floor ≈ 70 ms on this host (binary loader + embedded-module eval) vs ~15 ms for a trivial Bun binary | **open — accepted** | Measured with `vbench` experiments (12-module vs 245-module binaries). The bundled module graph is evaluated at startup by Bun's runtime; lazy imports only defer *execution*, not *embedding*. Mitigation: fast paths never touch the kernel, and the remaining floor is within the warm budgets. Owner: perf-eng · review: Phase 4. |
| P3 | Release binaries are **unsigned** | **open — out of scope** | Signing is enforced in Phase 9 (Part 20). The Phase 3 binaries must not be claimed "signed". Owner: security · review: Phase 9. |
| P4 | TTFT is measured as time-to-first-byte of a complete turn, not true first-token | **open — substrate** | The `Provider` contract returns complete turns (no streaming API). Full first-token TTFT requires a streaming provider contract (Phase 5 routing-quality work is out of Phase 3 scope). Documented in PERF-BUDGETS.md §7. Owner: provider-eng · review: Phase 5. |
| P5 | Scan-cache fingerprint uses size+mtimeMs (standard tradeoff): same-size + same-mtime-tick edits are not invalidated | **open — accepted** | Same tradeoff as git/cargo indexes; documented in PERF-BUDGETS.md §6. Content hashing on every entry would defeat the cache's purpose. Owner: perf-eng · review: Phase 4. |
| P6 | Kernel-boot path retains 4 owned sync-FS/process exceptions (config load, workspace-state standalone fallback, SQLite substrate, scan-cache payload read) | **open — accepted, gated** | Each is a single small-file read (μs–ms) documented in PERF-BUDGETS.md §5; the fast path is strictly zero-sync (lint-enforced) and event-loop stalls > 200 ms are detected and testable. Full async conversion of the config substrate would touch 40+ call sites — deferred. Owner: perf-eng · review: Phase 4. |
| P7 | Cross-platform binary smoke on Linux CI covers only linux-x64 execution; other targets verified by build success | **open — CI substrate** | A darwin/windows binary cannot execute on Linux runners. macOS/Windows CI (cross-platform.yml) runs the same `test/perf/binary-smoke.test.ts` when it has a native binary. Owner: ci-eng · review: Phase 4. |
| P8 | `providers set` canary is a reachability/auth probe for cloud providers (authOk passes); it does not pay for a trial completion | **open — accepted** | Free-by-design: the canary must never send paid traffic. Local-runtime canary depth is available via `xr models set` flows. Owner: provider-eng · review: Phase 4. |
| P9 | Risk-tiered isolation (binary-level sandboxing of agents) is NOT implemented | **open — out of scope** | Phase 4 territory; Phase 3 must not claim it. Owner: security · review: Phase 4. |
| P10 | Dashboard first-render budget is measured as daemon HTML route latency; full client hydration is not benchmarked | **open — accepted** | The daemon returns the complete dashboard app; client-side rendering is browser-dependent and out of Phase 3 scope. Owner: daemon-eng · review: Phase 4. |
| P11 | The committed baseline was measured on a 2-vCPU sandbox; GitHub's 4-vCPU runners measure differently, so a cross-machine regression band false-fails CI | **open — accepted, same-host band** | The regression band now BLOCKS only against a same-host baseline cache (`~/.cache/xr`, persisted in CI via actions/cache, ratchet-down-only); the first run on any host warns and seeds the cache, run 2+ blocks. The budget gate (Constitution ceilings) always blocks and is never calibrated. Two consecutive CI failures on the uncalibrated band led to this design (12/13 checks green both times, incl. startup-latency). Owner: perf-eng · review: Phase 4. |

## New claims introduced by Phase 3 (with evidence)

- "`--version`/`--help` p95 within 100/150 ms warm and 250/300 ms cold" —
  evidence: `docs/perf/baseline-7.0.1-source.json` + `test/perf/startup-latency.test.ts`
  + CI `perf-gate` job.
- "Hot-path (fast-path) sync I/O = 0" — evidence: `scripts/hot-path-lint.ts` +
  `test/perf/hot-path-lint.test.ts` (seeded violation caught).
- "Warm skills scan ≈ 22 ms loader vs 79 ms first scan (content-addressed)" —
  evidence: `test/perf/scan-cache.test.ts` + measured trace.
- "Warm re-index skips ≥ 90% of unchanged rows" — evidence:
  `test/perf/incremental-index.test.ts` (50/50 skipped; 1/50 after edit).
- "Model-switch state machine rolls back on canary/swap/verify failure" —
  evidence: `test/perf/model-switch.test.ts`.
