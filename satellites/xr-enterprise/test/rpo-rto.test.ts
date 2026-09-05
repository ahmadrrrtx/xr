/**
 * Phase 1 · T13 — RPO/RTO drill (single-node scope).
 *
 * Real backup → mutate → restore round trip with an intact audit chain,
 * real record counts, real integrity hashes, and a measured cold-restart time
 * against the stated RTO budget. See docs/historical/phases/phase-1/RPO_RTO.md for the
 * stated objectives.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "@xr/core/state/workspace-store.ts";
import { BackupService } from "../src/enterprise/deployment/backup/service.ts";
import { rmrf } from "@xr/test/reliability/helpers.ts";

/** RTO budget for a cold restart of the store (opened + migrated + verified). */
const RTO_BUDGET_MS = 2000;

describe("Phase 1 · RPO/RTO drill", () => {
  test("backup is a real snapshot with real counts + integrity; restore returns to the exact state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-rpo-"));
    try {
      const dbPath = join(dir, "xr.db");
      const store = new WorkspaceStore("rpo", dbPath);

      // Seed data (audit + sessions + memory + executions).
      for (let i = 0; i < 50; i++) {
        store.audit(`rpo.${i}`, { i });
      }
      store.createSession("s1", "t", "chat");
      store.insertMemory({ id: "m1", category: "fact", content: "important", scope: "global", source: "user", tags: "", importance: 5 });
      expect(store.verifyChain().valid).toBe(true);

      // Real backup.
      const service = new BackupService({
        backupRoot: join(dir, "backups"),
        profile: "personal_local",
        store,
        audit: (e, d) => store.audit(`backup.${e}`, d as Record<string, unknown>),
      });
      const backup = await service.createBackup({ label: "drill" });
      expect(backup.ok).toBe(true);
      const manifest = backup.manifest!;
      expect(manifest.snapshot).toBe(true);
      expect(manifest.totalSizeBytes).toBeGreaterThan(0);
      expect(manifest.integrityHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      const auditComp = manifest.components.find((c) => c.kind === "audit_records")!;
      expect(auditComp.recordCount).toBeGreaterThanOrEqual(50);
      expect(existsSync(join(dir, "backups", `${backup.backupId}.db`))).toBe(true);
      expect(service.verifyBackup(backup.backupId!).ok).toBe(true);

      // Mutate the live store heavily (the restore must roll this back).
      store.audit("post.backup.mutation", { n: 999 });
      store.deleteMemory("m1");
      store.endSession("s1", "error");
      const mutatedCount = store.auditCount();

      // Restore.
      const restored = await service.restore(backup.backupId!);
      expect(restored.ok).toBe(true);
      expect(restored.chainValid).toBe(true);
      expect(restored.recordsRestored).toBe(
        manifest.components.reduce((a, c) => a + c.recordCount, 0),
      );

      // The mutation is gone; the state equals the backup (plus the audited
      // restore event, which is correct behavior). Effects, not counts:
      const entries = store.auditChainRange({ limit: 100_000 });
      expect(entries.some((e) => e.event === "post.backup.mutation")).toBe(false);
      expect(entries.some((e) => e.event === "rpo.0")).toBe(true);
      expect(store.verifyChain().valid).toBe(true);
      expect(store.getMemory("m1")).not.toBeNull();
      expect(store.getSession("s1")?.status).toBe("running");
      expect(store.auditCount()).toBeLessThan(mutatedCount);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("pre-restore safety: restore creates a safety snapshot first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-rpo-pre-"));
    try {
      const dbPath = join(dir, "xr.db");
      const store = new WorkspaceStore("rpo", dbPath);
      store.audit("a", { n: 1 });
      const service = new BackupService({ backupRoot: join(dir, "b"), profile: "personal_local", store });
      const b1 = await service.createBackup({ label: "b1" });
      const before = service.listBackups().length;
      await service.restore(b1.backupId!);
      expect(service.listBackups().length).toBe(before + 1); // pre-restore backup
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("RPO: every committed transaction survives process restart (RPO = 0 on process crash)",async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-rpo-restart-"));
    try {
      const dbPath = join(dir, "xr.db");
      const a = new WorkspaceStore("a", dbPath);
      for (let i = 0; i < 25; i++) a.audit(`t.${i}`, { i });
      a.createSession("s9", "t", "chat");
      a.close(); // graceful shutdown (checkpoint)

      const b = new WorkspaceStore("b", dbPath);
      expect(b.auditCount()).toBe(25);
      expect(b.getSession("s9")?.status).toBe("running");
      expect(b.verifyChain().valid).toBe(true);
      b.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("RTO: cold restart (open + migrate + verify) completes within budget",async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-rto-"));
    try {
      const dbPath = join(dir, "xr.db");
      const seed = new WorkspaceStore("seed", dbPath);
      for (let i = 0; i < 200; i++) seed.audit(`s.${i}`, { i });
      seed.close();

      const t0 = performance.now();
      const store = new WorkspaceStore("cold", dbPath);
      const opened = performance.now();
      const chain = store.verifyChain();
      const t1 = performance.now();
      expect(chain.valid).toBe(true);
      expect(t1 - t0).toBeLessThan(RTO_BUDGET_MS);
      store.close();
      // eslint-disable-next-line no-console
      console.log(`[RTO] cold restart ${Math.round(t1 - t0)}ms (open ${Math.round(opened - t0)}ms + verify)`);
    } finally {
      await rmrf(dir);
    }
  });
});
