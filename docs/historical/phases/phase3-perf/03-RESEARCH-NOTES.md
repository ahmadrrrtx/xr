# XR Phase 3 — STEP 3 Research Notes (principles adopted, verified)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


| # | Principle | Source (verified) | Adopted as |
|---|---|---|---|
| R1 | `bun build ./src/index.ts --compile --target=<t> --outfile xr` produces a standalone binary embedding the Bun runtime (~60–96 MB); cross-compile targets `bun-linux-x64/arm64`, `bun-darwin-arm64/x64`, `bun-windows-x64` | Bun docs (bun.sh/docs/bundler/executables) + verified in-repo (linux-x64 built in 0.4–0.9 s; linux-arm64 cross-build 1.1 s) | `scripts/build-matrix.ts` matrix |
| R2 | The compiler statically traces imports: **runtime-computed `await import(name)` fails at boot** in compiled binaries; literal-path dynamic imports are traced | Bun docs + **proven in-repo**: variable-path `import(entry.path)` built fine but failed at boot with `Cannot find module … from /$bunfs/root/…`; rewritten to literal-path switches → binary works | provider-modules.ts + command-loaders.ts literal switches; binary-smoke test |
| R3 | `--external` keeps late-bound deps (playwright) out of the binary, resolved at runtime | Bun docs + verified (playwright external → build succeeds without playwright bundled) | build matrix `--external playwright playwright-core` |
| R4 | Command-scoped lazy boot: statically-resolvable `await import("./path")` per command; a command loads only what it needs | Art. VI.4 / Cmdt 11 + industry practice (CLI lazy loading) | command-loaders + boot profiles + boot trace |
| R5 | CI performance budgets: baseline-vs-current differential, **fail CI on >10% regression without a waiver**, sample isolation + noise budgets for stable latency | Phase 3 spec Part 19 + industry CI-perf practice | perf-gate.ts (budget gate + 10% regression gate + waivers) |
| R6 | Async I/O on hot paths; event-loop stall detection (heartbeat gap) | Art. XII.4 + Node/Bun event-loop monitoring practice | stall-detector.ts (heartbeat >200 ms ⇒ stall record) |
| R7 | SQLite: prepared statements, indexes, FTS for read paths | Spec Part 6 + verified existing substrate (context_items indexes, prepared statements) | retrieval bench + incremental index reuse of prepared stmts |
| R8 | Content-addressed (Merkle/hash) incremental scans: fingerprint tree (path+size+mtime) ⇒ cache; watchers with debounce/backpressure | Spec Part 6 + git/cargo index practice | scan-cache.ts; watcher folded into content-hash reindex (T9) |
| R9 | mtime+size fingerprint tradeoff (same-size same-tick edits missed) is standard (git) | Git index docs | documented limitation (P5) |

All principles were verified against the live repository and Bun 1.3.14 on
this host before adoption; none were copied verbatim from external code.
