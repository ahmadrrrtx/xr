# XR Concurrency & Durability Model (developer)

Ratified by ADR 0001 (docs/adr/0001-single-writer-durability-invariant.md).

## The model in one paragraph

All trust-critical persistence runs through **one read-write SQLite connection
per database file per process**, and every mutating statement on that
connection is executed inside a serialized `BEGIN IMMEDIATE … COMMIT`
transaction by construction. Cross-process writers (N `xr` invocations, or the
daemon + CLI, sharing one `XR_HOME`) serialize at the database level via
`IMMEDIATE` locking + `busy_timeout=5000` + bounded retry/backoff. The audit
hash-chain append is one atomic transaction; a broken chain fails closed.

## Adding a trust-critical write (do this)

```ts
// Through the store's public API — automatically serialized + transactional.
store.audit("my.event", { ok: true });

// Multi-statement read-modify-write: wrap it so the whole sequence is atomic.
store.write(() => {
  const prev = store.something();
  store.updateSomething(prev + 1);
});

// Raw SQL through prepare/exec is STILL gated automatically (the connection
// is the single writer) — but prefer typed repos/methods.
store.prepare("UPDATE t SET x = ? WHERE id = ?").run(1, "id");
```

## Forbidden

- `new Database(path)` anywhere except `openDatabase()` in
  `src/state/write-gate.ts` (the T3 static scan fails the build).
- A second `WorkspaceStore` on the same file in the same process expecting a
  second connection — it shares the existing one by design (max-1 RW).
- A read-then-write across an async gap without wrapping it in `store.write()`
  or a single transaction — that is the exact defect Phase 1 eliminated.
- `db.transaction()` (bun's DEFERRED helper) — disabled; use `store.write()`.

## SQLite settings

`journal_mode=WAL` · `synchronous=NORMAL` · `busy_timeout=5000` ·
`foreign_keys=ON` · `wal_autocheckpoint=1000` · periodic
`wal_checkpoint(RESTART)` (fallback TRUNCATE) every 15 min + on close.

## Delivery semantics per path

| Path | Semantics |
|---|---|
| Audit append | Exactly-once per call; atomic; fail-closed on a broken chain |
| Session/step/workflow transitions | Atomic per transition; recovery classifies interrupted work at startup |
| Non-idempotent external effects (with idempotency key) | Effective exactly-once via claim-first slots; interrupted effects → `requires_reconciliation` (never re-run) |
| Naturally idempotent effects | At-least-once (re-run safe) |
| Backups | Crash-consistent snapshots; restore verifies the audit chain |

## Mutation gate

`bun run mutation:run` gates trust/execution/persistence/credential modules
(threshold 0.6). Add tests that assert *effects* when you touch those modules —
the gate will tell you when coverage regresses.

## Cross-platform

Linux and macOS run the full suite; Windows runs the typecheck + unit +
golden-path subset (the crash matrix uses POSIX SIGKILL semantics). Keep new
tests platform-agnostic or gate them like the crash matrix.
