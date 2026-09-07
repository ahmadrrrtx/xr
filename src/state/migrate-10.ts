/**
 * Schema migration 10 — Phase 8 (capability grants + headless typed confirm).
 *
 * Lives outside migrations.ts so the registry stays under the 800-LOC threshold.
 */
import type { Migration } from "./migrations.ts";

export const MIGRATION_10: Migration = {
  version: 10,
  name: "phase8_grants_typed_confirm",
  up(store) {
    store.exec(`
      CREATE TABLE IF NOT EXISTS typed_confirm (
        capability TEXT NOT NULL,
        surface TEXT NOT NULL,
        phrase_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        created_by TEXT,
        PRIMARY KEY (capability, surface)
      );
      CREATE TABLE IF NOT EXISTS grants_active (
        grant_id TEXT PRIMARY KEY,
        capability_id TEXT NOT NULL,
        args_hash TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        ttl_ms INTEGER NOT NULL,
        consumed_at INTEGER,
        run_id TEXT,
        task_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_grants_active_cap ON grants_active(capability_id, issued_at);
    `);
  },
  down(store) {
    store.exec(`DROP TABLE IF EXISTS grants_active;`);
    store.exec(`DROP TABLE IF EXISTS typed_confirm;`);
  },
};
