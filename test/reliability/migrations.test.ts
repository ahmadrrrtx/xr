/**
 * Phase 1 · T12 — Reversible migrations.
 *
 * Forward + backward round-trip on real fixtures:
 *   - up: baseline → latest (idempotency_slots created, recorded in
 *     schema_migrations, audit chain untouched);
 *   - down: latest → baseline (table dropped, bookkeeping removed);
 *   - downgrade readability: a database that was upgraded is still fully
 *     readable by code that only knows the baseline schema;
 *   - the audit chain continues across migration boundaries (additive format).
 */
import { describe, expect, test } from "bun:test";
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
import { IdempotencyStore } from "../../src/state/idempotency.ts";
import { rmrf } from "./helpers.ts";

describe("Phase 1 · reversible migrations", () => {
  test("up: baseline → latest creates idempotency_slots and records versions",async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-mig-up-"));
    try {
      const store = new WorkspaceStore("m", join(dir, "xr.db"));
      expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);

      const table = store
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_slots'")
        .get() as { name: string } | null;
      expect(table).not.toBeNull();

      const idem = new IdempotencyStore(store);
      idem.claim("x", "kind");
      expect(idem.get("x")?.state).toBe("pending");

      // The audit chain is untouched by migration bookkeeping.
      store.audit("pre.mig", { ok: true });
      expect(store.verifyChain().valid).toBe(true);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("round-trip: down drops the table, up recreates it; audit chain survives",async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-mig-rt-"));
    try {
      const store = new WorkspaceStore("m", join(dir, "xr.db"));
      store.audit("entry.before", { n: 1 });

      // Down to baseline.
      const reverted = runMigrationsDown(store, 0);
      expect(reverted).toContain("idempotency_slots");
      expect(currentSchemaVersion(store)).toBe(0);
      const gone = store
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_slots'")
        .get() as { name: string } | null;
      expect(gone).toBeNull();

      // The baseline schema and audit chain are intact.
      expect(store.verifyChain().valid).toBe(true);
      store.audit("entry.mid", { n: 2 });
      expect(store.verifyChain().valid).toBe(true);

      // Up again — forward round-trip complete.
      const ran = runMigrationsUp(store);
      expect(ran).toContain("idempotency_slots");
      expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);
      expect(
        store.prepare("SELECT COUNT(*) c FROM idempotency_slots").get() as { c: number },
      ).toEqual({ c: 0 });
      store.audit("entry.after", { n: 3 });
      expect(store.verifyChain().valid).toBe(true);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("downgrade readability: upgraded DB is readable without the new table",async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-mig-down-"));
    try {
      const store = new WorkspaceStore("m", join(dir, "xr.db"));
      store.audit("upgraded.entry", { ok: true });
      store.close();

      // Downgrade the schema (as an older binary would after an update rollback).
      const downgraded = new WorkspaceStore("d", join(dir, "xr.db"));
      runMigrationsDown(downgraded, 0);
      downgraded.close();

      // An "old" code path that knows only the baseline reads everything fine.
      const old = new WorkspaceStore("old", join(dir, "xr.db"));
      expect(old.auditCount()).toBe(1);
      expect(old.verifyChain().valid).toBe(true);
      // Baseline operations still work.
      old.createSession("s1", "t", "chat");
      old.audit("old.path", { ok: true });
      expect(old.verifyChain().valid).toBe(true);
      old.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("runMigrationsUp is idempotent (safe to call repeatedly)",async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-mig-idem-"));
    try {
      const store = new WorkspaceStore("m", join(dir, "xr.db"));
      const first = runMigrationsUp(store);
      const second = runMigrationsUp(store);
      expect(second).toHaveLength(0); // nothing new to apply
      expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });
});
