/**
 * Phase 1 · T1 — Audit chain trust-critical behaviours that close mutation
 * gaps: fail-closed appends on a broken chain, explicit repair with an intact
 * prefix preserved, WAL checkpoint maintenance, and boundary predicates.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { AuditChainCorruptedError } from "../../src/state/write-gate.ts";
import { rmrf } from "./helpers.ts";

function fresh(dbName = "xr.db"): { store: WorkspaceStore; dbPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "xr-chain-"));
  const dbPath = join(dir, dbName);
  return { store: new WorkspaceStore("t", dbPath), dbPath, dir };
}

describe("Phase 1 · audit chain — fail-closed + repair + checkpoint", () => {
  test("auditChainCorrupted flips true on tamper and false after repair",async () => {
    const { store, dbPath, dir } = fresh();
    try {
      store.audit("a", { v: 1 });
      store.audit("b", { v: 2 });
      store.audit("c", { v: 3 });
      expect(store.auditChainCorrupted).toBe(false);
      store.close();

      // Tamper via a raw connection.
      const raw = new Database(dbPath);
      raw.query(`UPDATE audit_log SET detail='{"v":999}' WHERE id=2`).run();
      raw.close();

      const reopened = new WorkspaceStore("t", dbPath);
      expect(reopened.auditChainCorrupted).toBe(true);
      expect(reopened.verifyChain().valid).toBe(false);
      expect(reopened.verifyChain().brokenAt).toBe(2);

      // Appends FAIL CLOSED while broken.
      expect(() => reopened.audit("x", { v: 1 })).toThrow(AuditChainCorruptedError);

      const repaired = reopened.repairChain("test");
      expect(repaired.repaired).toBe(true);
      expect(repaired.removed).toBeGreaterThanOrEqual(2);
      expect(reopened.auditChainCorrupted).toBe(false);
      expect(reopened.verifyChain().valid).toBe(true);
      // The intact prefix (entry 1) survived verbatim.
      const entries = reopened.auditChainRange({ limit: 100 });
      expect(entries[0]!.event).toBe("a");
      expect(entries.some((e) => e.event === "audit.repair")).toBe(true);
      // The chain continues after repair.
      reopened.audit("after.repair", { ok: true });
      expect(reopened.verifyChain().valid).toBe(true);
      reopened.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("repair on an intact chain is a no-op",async () => {
    const { store, dir } = fresh();
    try {
      store.audit("a", { v: 1 });
      const r = store.repairChain();
      expect(r.repaired).toBe(false);
      expect(store.verifyChain().valid).toBe(true);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("chainStatus reports metadata; headHash equals the last row hash",async () => {
    const { store, dir } = fresh();
    try {
      store.audit("a", { v: 1 });
      const status = store.chainStatus();
      expect(status.valid).toBe(true);
      expect(status.count).toBe(1);
      expect(status.headHash).toBe(store.recentAudit(1)[0]!.hash);
      expect(status.genesis).toBe("xr-genesis");
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("WAL checkpoint maintenance returns a usable result",async () => {
    const { store, dir } = fresh();
    try {
      for (let i = 0; i < 20; i++) store.audit(`c.${i}`, { i });
      const r = store.checkpointWal("RESTART");
      expect(r.ok).toBe(true);
      expect(["RESTART", "TRUNCATE"].includes(r.used)).toBe(true);
      const t = store.checkpointWal("TRUNCATE");
      expect(t.ok).toBe(true);
      expect(store.verifyChain().valid).toBe(true);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("boundary predicates: getSpendForPeriod and expired-memory prune are inclusive at the boundary",async () => {
    const { store, dir } = fresh();
    try {
      const now = Date.now();
      store.recordCost("s", "t", "m", 1, 1, 0.5);
      // Cost within the window (>= semantics on created_at) is included.
      expect(store.getSpendForPeriod(now - 1000)).toBe(0.5);
      // A window strictly after the cost excludes it.
      expect(store.getSpendForPeriod(now + 1000)).toBe(0);
      // Memory expiring exactly at `now` is pruned (<= semantics).
      store.insertMemory({ id: "exp1", category: "fact", content: "c", scope: "global", source: "user", tags: "", importance: 1, expiresAt: now });
      expect(store.expiredMemoryCount(now)).toBe(1);
      expect(store.pruneExpiredMemory(now)).toBe(1);
      expect(store.expiredMemoryCount(now)).toBe(0);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });
});
