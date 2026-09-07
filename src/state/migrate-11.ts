/**
 * Schema migration 11 — Phase 9 (governed trigger table).
 *
 * Lives outside migrations.ts so the registry stays under the 800-LOC threshold.
 * Fire history lives in the audit chain (no separate fires table).
 */
import type { Migration } from "./migrations.ts";

export const MIGRATION_11: Migration = {
  version: 11,
  name: "phase9_triggers",
  up(store) {
    store.exec(`
      CREATE TABLE IF NOT EXISTS triggers (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        spec TEXT NOT NULL,
        task_template TEXT NOT NULL,
        budget TEXT NOT NULL,
        approval_mode TEXT NOT NULL DEFAULT 'inherit',
        quiet_hours TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        consent_ref TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_fired_at INTEGER,
        last_envelope_id TEXT,
        spent_usd REAL NOT NULL DEFAULT 0,
        spent_tokens INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_triggers_enabled ON triggers(enabled, kind);
    `);
  },
  down(store) {
    store.exec(`DROP TABLE IF EXISTS triggers;`);
  },
};
