/**
 * XR Phase 1 — Reversible migrations (T12).
 *
 * The workspace store's schema has a stable **baseline** (version 0): the
 * idempotent `CREATE TABLE IF NOT EXISTS` set in `WorkspaceStore.migrate()`.
 * Incremental schema changes are registered here as numbered, reversible
 * migrations, each with `up()` and `down()`, recorded in `schema_migrations`.
 *
 * Guarantees (Constitution Art. XXIII):
 *   - Every migration is reversible; `runMigrationsDown(target)` restores the
 *     exact previous structure.
 *   - Forward + backward round-trips are covered by fixtures in
 *     `test/reliability/migrations.test.ts`.
 *   - Audit-format changes are ADDITIVE — the hash chain continues across
 *     versions (the chain is never re-keyed by a migration).
 *   - A downgraded database is readable by code that does not know the
 *     migration (it simply no longer has the tables/columns).
 */

import type { WorkspaceStore } from "./workspace-store.ts";

export interface Migration {
  readonly version: number;
  readonly name: string;
  /** Apply the migration (may assume version-1 state exists). */
  up(store: WorkspaceStore): void;
  /** Reverse the migration exactly. */
  down(store: WorkspaceStore): void;
}

const MIGRATIONS_TABLE = "schema_migrations";

export class MigrationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "MigrationError";
  }
}

/**
 * Migration 1 — `idempotency_slots` (claim-first idempotency, T5).
 * Additive: adds one new table. Down: drops it. The audit chain is untouched.
 */
const MIGRATION_1: Migration = {
  version: 1,
  name: "idempotency_slots",
  up(store: WorkspaceStore) {
    store.exec(`
      CREATE TABLE IF NOT EXISTS idempotency_slots (
        slot_key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        effect_ref TEXT,
        result_json TEXT,
        run_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_idem_state ON idempotency_slots(state, updated_at);
    `);
  },
  down(store: WorkspaceStore) {
    store.exec(`DROP TABLE IF EXISTS idempotency_slots;`);
  },
};

export const MIGRATIONS: readonly Migration[] = [MIGRATION_1];

/** Latest known schema version. */
export const LATEST_SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);

/** Ensure the version bookkeeping table exists. */
export function ensureMigrationTable(store: WorkspaceStore): void {
  store.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

/** Current applied schema version (0 = baseline only). */
export function currentSchemaVersion(store: WorkspaceStore): number {
  ensureMigrationTable(store);
  const row = store
    .prepare(`SELECT MAX(version) AS v FROM ${MIGRATIONS_TABLE}`)
    .get() as { v: number | null } | null;
  return row?.v ?? 0;
}

/**
 * Apply pending migrations up to `target` (default: latest). Idempotent AND
 * race-safe across processes: the applied-check runs INSIDE the serialized
 * write transaction (`BEGIN IMMEDIATE` serializes writers), and the
 * bookkeeping insert is `INSERT OR IGNORE`, so two processes racing to apply
 * migration N on a fresh database cannot produce a UNIQUE violation (the
 * loser's transaction sees the winner's committed row and no-ops).
 */
export function runMigrationsUp(store: WorkspaceStore, target: number = LATEST_SCHEMA_VERSION): string[] {
  ensureMigrationTable(store);
  const ran: string[] = [];
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (m.version > target) break;
    store.write(() => {
      // Re-check inside the transaction: IMMEDIATE serializes writers, so the
      // check-then-record below is atomic with respect to other processes.
      const already = store
        .prepare(`SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE version = ?`)
        .get(m.version);
      if (already) return;
      m.up(store); // idempotent DDL (CREATE ... IF NOT EXISTS)
      store
        .prepare(`INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`)
        .run(m.version, m.name, Date.now());
      ran.push(m.name);
    });
  }
  return ran;
}

/**
 * Reverse migrations down to `target` (default: 0 = baseline). Idempotent and
 * race-safe across processes: the presence check runs inside the write
 * transaction and the reversal DDL is idempotent (DROP TABLE IF EXISTS).
 */
export function runMigrationsDown(store: WorkspaceStore, target: number = 0): string[] {
  ensureMigrationTable(store);
  const reverted: string[] = [];
  for (let v = LATEST_SCHEMA_VERSION; v > target; v--) {
    const m = MIGRATIONS.find((x) => x.version === v);
    if (!m) throw new MigrationError(`no migration registered for version ${v}`);
    store.write(() => {
      const present = store
        .prepare(`SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE version = ?`)
        .get(v);
      if (!present) return; // another process already reverted it
      m.down(store);
      store.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = ?`).run(v);
      reverted.push(m.name);
    });
  }
  return reverted;
}
