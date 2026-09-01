/**
 * XR Phase 2 · F-11/F-12 — NUMBERED MIGRATION for existing databases.
 *
 * An EXISTING (pre-Phase-2) workspace DB gets the durable `approvals` and
 * `reservations` tables via Migration 6 with no dual mode: one release
 * cutover, tables exist on every database afterwards, and the audit chain is
 * untouched.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  runMigrationsDown,
  runMigrationsUp,
} from "../../src/state/migrations.ts";
import { ApprovalStore } from "../../src/control/approval-store.ts";
import { ReservationRepo } from "../../src/state/repos/reservation-repo.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-p2-mig-"));
});

/** Build a pre-Phase-2 database: baseline tables + migrations 1..5 applied. */
function prePhase2Db(path: string): void {
  const raw = new Database(path);
  raw.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, event TEXT NOT NULL, detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES
      (1, 'idempotency_slots', 0),
      (2, 'context_items_consolidation', 0),
      (3, 'unknown_migration_3', 0),
      (4, 'unknown_migration_4', 0),
      (5, 'cost_events_usage_source', 0);
    CREATE TABLE IF NOT EXISTS idempotency_slots (slot_key TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', effect_ref TEXT, result_json TEXT, run_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cost_events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, provider TEXT, model TEXT, in_tokens INTEGER, out_tokens INTEGER, usd REAL, created_at INTEGER NOT NULL, usage_source TEXT NOT NULL DEFAULT 'provider');
  `);
  raw.close();
}

describe("Phase 2 · migration 6 on an existing database", () => {
  test("opening a pre-Phase-2 DB applies migration 6: approvals + reservations exist and work", () => {
    const path = join(tmp, "existing.db");
    prePhase2Db(path);

    const store = new WorkspaceStore("w", path);
    expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);

    for (const table of ["approvals", "reservations"]) {
      const row = store
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table) as { name: string } | null;
      expect(row, `${table} missing after migration`).not.toBeNull();
    }

    // The durable consent plane works on the migrated DB…
    const approvals = new ApprovalStore(store, { defaultTtlMs: 5_000 });
    const handle = approvals.request({ tool: "shell", reason: "x", surface: "cli" });
    expect(approvals.get(handle.id)?.decision).toBeNull();
    expect(approvals.decide(handle.id, true, { channel: "cli" })).toBe(true);
    expect(approvals.get(handle.id)?.decision).toBe("approved");

    // …and the atomic budget admission works too.
    const repo = new ReservationRepo(store);
    store.setBudgetConfig({ monthly_cap: 10, daily_cap: null });
    const admitted = repo.admit("task", 0.1, 100, { monthlyCapUsd: 10, dailyCapUsd: null, taskUsdCap: null, taskTokenCap: null });
    expect(admitted.ok).toBe(true);
    if (admitted.ok) repo.commit(admitted.reservationId, 0.1, 100);

    // Audit chain untouched by the migration.
    store.audit("phase2.post-migration", { ok: true });
    expect(store.verifyChain().valid).toBe(true);
    store.close();
  });

  test("migration 6 is reversible: down to 5 drops the Phase-2 tables, up restores them", () => {
    const path = join(tmp, "rt.db");
    prePhase2Db(path);
    const store = new WorkspaceStore("w", path);
    expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);

    const reverted = runMigrationsDown(store, 5);
    expect(reverted).toContain("phase2_approvals_reservations");
    expect(currentSchemaVersion(store)).toBe(5);
    for (const table of ["approvals", "reservations"]) {
      const row = store
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table) as { name: string } | null;
      expect(row).toBeNull();
    }

    const ran = runMigrationsUp(store);
    expect(ran).toContain("phase2_approvals_reservations");
    expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);
    const approvals = new ApprovalStore(store, { defaultTtlMs: 5_000 });
    const handle = approvals.request({ tool: "shell", reason: "y", surface: "cli" });
    expect(approvals.get(handle.id)).not.toBeNull();
    store.close();
  });
});
