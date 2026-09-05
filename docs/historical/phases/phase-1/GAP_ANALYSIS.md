# Phase 1 — Gap Analysis (STEP 2)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Ordered by dependency (each row maps to Phase-1 tasks / Part 8).

| # | Gap (audited reality vs. requirement) | Constitution / spec basis | Maps to |
|---|---|---|---|
| G1 | Audit append is a non-atomic read-then-write; chain breaks + lost writes under concurrency (reproduced). | Art. VI/IX (one truth, serialized trust writes); Cmdt 6; Part 5 §1 | T1 |
| G2 | SQLite: no `busy_timeout`, no `synchronous=NORMAL`, no explicit `wal_autocheckpoint`, no periodic `wal_checkpoint(RESTART)`, no `IMMEDIATE` locking, no max-1-RW enforcement, no retry/backoff. | Part 5 §2; Part 8 T2 | T2 |
| G3 | No encoded single-writer invariant; multiple RW connections to one file possible; no property test; no ADR. | Art. VI/IX; Part 5 §3; Part 8 T3 | T3 |
| G4 | No crash-injection matrix; transitions not proven crash-safe (execution transitions interleave statements without a wrapping transaction). | Cmdt 2 (no simulated durability); Part 8 T4 | T4 |
| G5 | Checkpoints exist (execution) but no claim-first idempotency primitive; crash-mid-effect can duplicate non-idempotent effects; semantics undocumented. | Part 5 §4; Part 8 T5 | T5 |
| G6 | No nightly golden-path automation (Linux + container). | Part 8 T6; Part 10 | T6 |
| G7 | CI is Linux-only; no macOS/Windows jobs. | Phase-0 discipline (honest gaps or green); Part 8 T7 | T7 |
| G8 | No mutation testing on critical modules. | Part 8 T8 | T8 |
| G9 | No hermetic artifact E2E from a published package. | Part 8 T9 | T9 |
| G10 | No `xr uninstall`; no per-mode filesystem assertions. | Part 8 T10 | T10 |
| G11 | Update is git-only, doesn't use `applyUpdate`, no health canary, no npm path, no atomic swap/rollback proof. | Part 8 T11 | T11 |
| G12 | No reversible-migration framework; no round-trip fixtures/tests. | Art. XXIII; Part 8 T12; Part 17 | T12 |
| G13 | Backup/restore is a stub with simulated durability; no RPO/RTO stated or met; no drill. | Cmdt 2; Art. XX (effects asserted); Part 8 T13 | T13 |
| G14 | Lifecycle: no WAL checkpoint on shutdown/close; shutdown contract undocumented. | Part 18 (shutdown contract); Part 5 | folded into T2/T9 docs |
| G15 | `src/business/core/audit.ts` same read-then-write gap (second chain). | Art. VI/IX | T1/STEP 6 refactor |

## Out of scope (Phase 2+ — recorded, not built)
- Execution-envelope unification (memory→context, workflow→execution) — explicitly deferred by the Phase-1 prompt.
- Multi-node / distributed durability / full HA — Phase 10.
- Release signing — Phase 9.
