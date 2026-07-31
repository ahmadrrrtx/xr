# XR Phase 1 — Known Limitations Register (update)

Status of the register after Phase 1. Items marked **closed** were resolved;
new entries are added with evidence. Nothing here is silently accepted — each
entry has an owner and a review date.

| # | Limitation | Status | Evidence / remediation |
|---|---|---|---|
| L1 | Audit chain falsifiable under concurrency (non-atomic append, no busy_timeout) | **closed (T1/T2)** | Reproduced 6× locked + broken at 138 before; after: 0 locked, chain intact at 4,800 concurrent appends. |
| L2 | Multiple RW connections per file possible; no encoded single-writer invariant | **closed (T3)** | ADR 0001 + property test + static scan. |
| L3 | Crash between side effect and completion could duplicate non-idempotent effects | **closed (T5)** | Claim-first idempotency slots; crash matrix asserts 0 duplicates. |
| L4 | Backup/restore was a stub with simulated durability | **closed (T13)** | Real `VACUUM INTO` snapshots + chain-verified restore + RPO/RTO drill. |
| L5 | Update was git-only, no canary, no npm path | **closed (T11)** | Atomic updater (blue-green + canary + rollback) for git + npm. |
| L6 | No uninstall | **closed (T10)** | `xr uninstall --keep-data|--purge` with per-mode FS assertions. |
| L7 | No reversible migration framework | **closed (T12)** | `src/state/migrations.ts` + round-trip fixtures. |
| L8 | CI Linux-only; no nightly; no mutation gate; no artifact E2E | **closed (T6–T9)** | Nightly (Linux+container), cross-platform macOS/Windows, mutation gate, artifact E2E. |
| L9 | Power-loss RPO > 0 (synchronous=NORMAL) | **open — accepted, documented** | RPO/RTO.md: power-loss RPO ≤ checkpoint window; FULL available for power-loss RPO 0. Owner: reliability-eng · review: Phase 3. |
| L10 | Multi-node / distributed durability / full HA | **open — out of scope** | Single-node scope per Phase 1 contract; full HA is Phase 10. Owner: architecture · review: Phase 10. |
| L11 | Release signing | **open — out of scope** | Signing enforced in Phase 9; identity unified but unsigned (Phase 0/1). Owner: security · review: Phase 9. |
| L12 | Windows CI runs a subset (crash matrix uses POSIX SIGKILL) | **open — honest gap** | Documented in cross-platform.yml + FINAL_REVIEW. Owner: ci-eng · review: Phase 2. |
| L13 | Legacy `src/state/store.ts` remains as a deprecated re-export | **open — intentional** | Back-compat surface; do not extend. Owner: architecture. |
| L14 | `syncSleep` busy-retry uses Atomics.wait (synchronous sleep) | **open — accepted** | Only triggers when busy_timeout is exhausted; bounded (≤3 retries). Owner: reliability-eng. |
| L15 | Memory recall scoring is heuristic (lexical) | **open — pre-existing** | Not a Phase-1 defect; unchanged. Owner: context-eng. |

## New claims introduced by Phase 1 (with evidence)

- "Tamper-evident under concurrency" — evidence: test/reliability/concurrency-stress.test.ts + crash matrix.
- "Effective exactly-once for keyed non-idempotent effects" — evidence: test/reliability/idempotency.test.ts.
- "RPO 0 on process crash; RTO < 2 s" — evidence: test/reliability/rpo-rto.test.ts.
