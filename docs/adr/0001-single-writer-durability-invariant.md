# ADR 0001 — Single-Writer Durability Invariant

**Status:** Ratified (Phase 1, 2026-07-31)
**Applies to:** All trust-critical persistence in the workspace store
**Supersedes:** The pre-Phase-1 ad-hoc multi-connection write model

---

## Context

Phase 1's audit (docs/phase-1/AUDIT_REPORT.md) reproduced a concrete defect:
with N concurrent writers against one `XR_HOME`, the audit hash-chain append
(`lastHash()` → compute → insert with **no transaction**) forked the chain and
lost writes — 8 writers × 50 writes produced **6 "database is locked" errors
and a chain broken at entry 138**. Multiple write authorities existed: every
`new WorkspaceStore(path)` opened another read-write connection, `db.exec()`
ran raw mutations, and `db.transaction()` used DEFERRED locking.

The Constitution requires (Art. VI "one source of truth per concern", Art. IX
trust-integrity, Commandment 6 "correctness over throughput") that trust-
critical writes be serialized through one authority. This ADR encodes that as
an invariant of the system, not a convention.

## Decision

1. **The connection is the single writer.** Every mutating statement that
   executes through the workspace store's connection is executed inside one
   serialized `BEGIN IMMEDIATE … COMMIT` transaction by construction
   (`WriteGate` + `gateConnection` in `src/state/write-gate.ts`). Reads pass
   through; mutations never run outside a write transaction. A mutation that
   somehow executes outside the gate increments `executedOutsideTxn`, which
   the T3 property test asserts is **zero** across every trust-critical
   workload (test/reliability/single-writer.test.ts).

2. **Exactly one read-write connection per database file per process.**
   `WorkspaceStore` shares connections through a per-file registry keyed by
   resolved path. A second open of the same file joins the existing
   connection + gate (max open = 1 RW per file). No code path may construct a
   raw `Database` outside `openDatabase()` (the single sanctioned factory);
   the T3 static scan fails if `new Database(` appears anywhere else in `src/`.

3. **The audit chain append is atomic.** `audit()` reads the last hash,
   computes the SHA-256 link, and inserts inside one `IMMEDIATE` transaction
   (T1). Cross-process writers serialize at the database level via
   `IMMEDIATE` + `busy_timeout=5000` + bounded retry/backoff, so the chain can
   never fork.

4. **Fail closed, repair explicitly.** A corrupted chain makes `audit()`
   throw `AuditChainCorruptedError` until an explicit, user-confirmed
   `xr audit repair --yes` truncates suspect entries and re-seeds with a
   chained `audit.repair` event. Intact history is never rewritten.

5. **Multi-process access is assumed.** This invariant is per-file and
   per-process with cross-process correctness via SQLite's own locking. It is
   NOT a distributed consensus mechanism; full HA is explicitly out of scope
   (Phase 10).

## Consequences

- All trust-critical writes (audit, sessions, steps, workflows, approvals,
  vault, execution transitions, cost, budget, memory) are serialized and
  transactional — no second write authority exists (property test).
- Writes gain bounded latency (a transaction wrapper around each mutation);
  offset by WAL throughput (`synchronous=NORMAL`, `wal_autocheckpoint=1000`)
  and accepted per Commandment 6.
- Developers adding a trust-critical write must go through the store's public
  API (which is gated by construction) or `store.write()`; raw SQL through
  `prepare`/`exec` is still gated automatically. See
  docs/developer/concurrency-model.md.

## Review

Ratified after architecture validation (docs/phase-1/ARCHITECTURE_VALIDATION.md).
Review date: 2026-10-31 · Owner: engineering-review-board · Reviews: T1–T3,
STEP 6 refactor, mutation gate.
