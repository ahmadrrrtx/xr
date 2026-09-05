/**
 * Phase 4 (Evidence Integrity, F-08) — Migration 7 on an EXISTING database.
 *
 * A pre-Phase-4 workspace (baseline audit chain, migrations 1..6) opens
 * unchanged: migration 7 adds head_counter/sig + audit_head/audit_anchors
 * additively, the EXISTING unsigned chain stays readable and verifiable
 * (chain-only), and keying then activates signing for all subsequent entries.
 *
 * Also verifies migration reversibility (down) per Constitution Art. XXIII.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  runMigrationsDown,
  runMigrationsUp,
} from "../../src/state/migrations.ts";
import { clearSecretMemo } from "../../src/security/secrets.ts";

let home: string;
let prevHome: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "xr-p4-mig-home-"));
  prevHome = process.env.XR_HOME;
  process.env.XR_HOME = home;
  process.env.XR_AUDIT_SIGN_EVERY = "1";
  clearSecretMemo();
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = prevHome;
  delete process.env.XR_AUDIT_SIGN_EVERY;
  clearSecretMemo();
});

/** Build a pre-Phase-4 DB: baseline tables + audit rows + migrations 1..6. */
function prePhase4Db(path: string): void {
  const raw = new Database(path);
  raw.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, event TEXT NOT NULL, detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES
      (1,'idempotency_slots',0),(2,'x',0),(3,'y',0),(4,'z',0),(5,'w',0),(6,'phase2',0);
  `);
  // Insert a small unsigned but consistent hash chain (legacy format).
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  let prev = "xr-genesis";
  for (let i = 0; i < 3; i++) {
    const event = `legacy.${i}`;
    const detail = JSON.stringify({ i });
    const ts = 1_700_000_000_000 + i;
    const hash = createHash("sha256").update(JSON.stringify({ event, detail: { i }, prev, ts })).digest("hex");
    raw
      .query(`INSERT INTO audit_log (session_id,event,detail,prev_hash,hash,created_at) VALUES (?,?,?,?,?,?)`)
      .run(null, event, detail, prev, hash, ts);
    prev = hash;
  }
  raw.close();
}

describe("Phase 4 · migration 7 + keying on an existing database", () => {
  test("opens a legacy DB, applies migration 7, keeps the unsigned chain verifiable, then keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-p4-mig-"));
    const dbPath = join(dir, "xr.db");
    try {
      prePhase4Db(dbPath);
      // (Later phases add migrations above 7 — assert THIS one landed, not that
      // 7 is still the ceiling.)
      expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(7);

      const store = new WorkspaceStore("t", dbPath);
      expect(currentSchemaVersion(store)).toBeGreaterThanOrEqual(7);

      // The legacy unsigned chain still replays.
      expect(store.verifyChain().valid).toBe(true);
      expect(store.auditCount()).toBe(3);
      const beforeKey = store.verifyCrypto();
      expect(beforeKey.chainValid).toBe(true);
      expect(beforeKey.keyed).toBe(false); // not yet keyed

      // Key it (the real boot path).
      const k = store.ensureAuditKeying("migration-test");
      expect(k.keyed).toBe(true);
      store.audit("after.keying.1", {});
      store.audit("after.keying.2", {});

      const after = store.verifyCrypto();
      expect(after.chainValid).toBe(true);
      expect(after.keyed).toBe(true);
      expect(after.signaturesValid).toBe(true);
      expect(after.head?.matches).toBe(true);
      expect(after.head?.stale).toBe(false);

      // The 3 legacy entries are chain-only; signed entries carry counters.
      const legacyCount = store.auditChainRange({ limit: 100 }).filter((e) => e.event.startsWith("legacy.")).length;
      expect(legacyCount).toBe(3);

      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("migration 7 is reversible (down drops audit_head/anchors + columns)", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-p4-migdown-"));
    const dbPath = join(dir, "xr.db");
    try {
      prePhase4Db(dbPath);
      let store = new WorkspaceStore("t", dbPath);
      expect(currentSchemaVersion(store)).toBeGreaterThanOrEqual(7);
      runMigrationsDown(store, 6); // below 7: this migration must vanish with any above it
      expect(currentSchemaVersion(store)).toBe(6);

      // audit_head / audit_anchors dropped.
      const raw = new Database(dbPath);
      const tables = raw.query(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
      expect(tables.some((t) => t.name === "audit_head")).toBe(false);
      expect(tables.some((t) => t.name === "audit_anchors")).toBe(false);
      raw.close();

      // Re-applying forward works and the chain still verifies.
      store = new WorkspaceStore("t", dbPath);
      expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION); // forward re-applies 7 (and above)
      expect(store.verifyChain().valid).toBe(true);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
