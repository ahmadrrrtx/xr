# XR Phase 1 — Schema & Audit-Format Migration Notes

## Schema changes introduced in Phase 1 (all additive)

| Version | Change | Type | Reversible |
|---|---|---|---|
| 1 | `idempotency_slots` table (claim-first idempotency, T5) | new table | `runMigrationsDown(store, 0)` drops it |

- No existing table or column was modified. The pre-existing tables
  (`audit_log`, `sessions`, `steps`, `execution_*`, `user_memory`, …) are
  untouched, so an existing database opens unchanged and continues to work.
- `schema_migrations` bookkeeping table records applied versions.
- Framework: `src/state/migrations.ts` — `runMigrationsUp(store)`,
  `runMigrationsDown(store, target)`. Round-trip fixtures in
  `test/reliability/migrations.test.ts` prove forward/backward and that a
  downgraded database is readable by baseline-only code.

## Audit-format compatibility (Constitution Art. XXIII / Part 17)

- The audit hash-chain format is **unchanged and additive**: each entry still
  hashes `{event, detail, prev, ts}` with SHA-256. Phase 1 changed *how* the
  append is serialized (atomic `IMMEDIATE` transaction) — never *what* is
  hashed — so a Phase-0 chain verifies identically after the Phase-1 upgrade,
  and the chain continues across versions.
- The re-seeding event after an explicit repair (`audit.repair`) is a normal
  chained entry; it does not alter the format.

## Vault (Phase 0)

- The Phase-0 v2 envelope (persisted per-record salt, wrapped DEK) is
  preserved and untouched. No vault migration in Phase 1.

## Update / rollback

- `xr update` preserves user data (config backup before the swap; the swap
  moves directories, it never deletes `~/.xr`).
- A downgrade after an update reads an upgraded database: additive schema
  means an older binary simply does not know the new table (verified by the
  downgrade-readability test).
