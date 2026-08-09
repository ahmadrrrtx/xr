# Phase 1 — Research Notes (STEP 3)

Principles adopted (verified against current consensus; cited). We adopt
principles, not code.

## R1 — SQLite local concurrency
- **WAL mode + `synchronous=NORMAL`** is the standard local-first durability/throughput point: readers never block the writer, commits are durable to the WAL, and NORMAL avoids a full fsync per commit. The #1 skipped setting is `busy_timeout`. [SQLite WAL doc](https://www.sqlite.org/wal.html); [SQLite PRAGMA docs](https://www.sqlite.org/pragma.html).
- **`busy_timeout` ≥ 3000 ms** — a writer that would otherwise fail instantly with `SQLITE_BUSY` waits instead; recommended range 3000–5000 ms.
- **`wal_autocheckpoint` ≈ 1000** pages plus a periodic `PRAGMA wal_checkpoint(RESTART)` bounds WAL growth (RESTART only succeeds when no readers are attached; TRUNCATE is the fallback).
- **One read-write connection (max open = 1) + separate read connections** — the widely recommended topology; more writers only add lock contention with no throughput gain on a single file.
- **`BEGIN IMMEDIATE` for multi-statement writes** — acquires the write lock up front, so the classic read-then-upgrade DEADLOCK/`SQLITE_BUSY` is impossible.
- **Enforce the single writer at the connection/dispatcher level, never the thread pool** — "The most robust pattern is an application-level single writer so a lock is never hit." (consensus in SQLite threads and ORM guidance).

## R2 — Tamper-evident append under concurrency
- The hash-chain append must be **one atomic transaction**: `BEGIN IMMEDIATE → SELECT last → compute → INSERT → COMMIT`. A read-then-write across a lockable gap allows two writers to fork the chain (both read the same tail, both insert). [SQLite "Atomic Commit In SQLite"](https://www.sqlite.org/atomiccommit.html).

## R3 — Durable execution / idempotency
- **Checkpoint after each successful step** so resume *skips ahead* instead of replaying.
- **Claim the dedup/idempotency slot BEFORE the side effect** (INSERT-then-execute). "Executing-then-logging loses the record on crash and duplicates on retry." This is the *claim-first* / *reservation* pattern.
- **Idempotency keys for external effects**; **at-least-once delivery + idempotency = effective exactly-once**; for genuinely non-idempotent effects: **at-most-once + no-retry, or compensation (saga)**. Durability does not make a non-idempotent call exactly-once — you must layer idempotency. [Microsoft "Idempotency and idempotency keys"](https://learn.microsoft.com/en-us/azure/architecture/patterns/idempotency-key); [Stripe idempotency design](https://stripe.com/blog/idempotency).

## R4 — Crash testing
- **Deterministic crash injection at persisted transitions**: kill the process at controlled points (after BEGIN, after INSERT, before COMMIT) and assert exact terminal state — transactions make the pre/post boundary the only observable states. [SQLite atomic commit behavior under power loss](https://www.sqlite.org/atomiccommit.html#durability).

## R5 — Atomic update/rollback
- **Blue-green swap with a health canary**: install the candidate into a parallel slot, run a self-test/canary, then atomically swap; on canary failure roll back automatically. [Twelve-Factor / zero-downtime deploy patterns]; the repo already encodes the algorithm in `src/update/selfheal.ts` (install → self-test → activate → discard).

## R6 — Mutation testing
- Mutate the code, run the tests, and require each mutation to be *killed* (test fails) — a module's score gates it. [PIT mutation testing](https://pitest.org/) (JVM reference; same discipline for TS). We implement a lightweight in-repo harness because the repo intentionally has no heavy JS toolchain beyond bun + typescript + zod.

## R7 — Backup/restore (RPO/RTO)
- Crash-consistent single-file snapshot via SQLite online backup / `VACUUM INTO`, taken under the write gate; restore = replace + reopen + verify (audit chain intact). RPO/RTO are stated per failure class, not as a single number.
