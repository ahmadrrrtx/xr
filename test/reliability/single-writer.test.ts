/**
 * Phase 1 · T3 — Encoded single-writer invariant.
 *
 * Property: every trust-critical write (audit, session, step, workflow,
 * memory, cost, budget, execution, business audit) executes through the
 * serialized write gate, and no mutating statement runs outside a write
 * transaction. Plus: no second raw Database connection is opened anywhere in
 * src/ (a second write authority is a Constitutional violation).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { SessionRepo } from "../../src/state/repos/session-repo.ts";
import { AuditRepo } from "../../src/state/repos/audit-repo.ts";
import { WorkflowRepo } from "../../src/state/repos/workflow-repo.ts";
import { CostRepo } from "../../src/state/repos/cost-repo.ts";
import { IdempotencyStore } from "../../src/state/idempotency.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import { rmrf } from "./helpers.ts";

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

describe("Phase 1 · single-writer invariant", () => {
  test("trust-critical workload executes with zero unsafe (un-gated) mutations", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-single-"));
    try {
      const dbPath = join(dir, "xr.db");
      const store = new WorkspaceStore("test", dbPath);

      // Touch every trust-critical write path.
      const sessions = new SessionRepo(store);
      const audit = new AuditRepo(store);
      const workflows = new WorkflowRepo(store);
      const costs = new CostRepo(store);
      const idem = new IdempotencyStore(store);

      sessions.createSession("s1", "t", "chat");
      sessions.addStep("st1", "s1", 0, "tool", "x", { ok: true });
      audit.audit("test.audit", { ok: true }, "s1");
      store.remember("m1", "p", "fact", "hello");
      store.insertMemory({ id: "um1", category: "fact", content: "c", scope: "global", source: "user", tags: "", importance: 3 });
      store.setMemoryConsent("um1", "approved", "test");
      store.revokeMemory("um1", "test", "test");
      store.insertSessionSummary("ss1", "global", "summary");
      store.recordCost("s1", "test", "m", 1, 1, 0.01);
      costs.setBudgetConfig({ monthly_cap: 10 });
      store.saveSchedule("sched1", "{}");
      store.saveResearch("r1", "topic", "brief", "completed", "{}");
      store.insertSkill("sk1", 1, "preloaded", null);
      store.setActiveSkillVersion("sk1", 1);
      workflows.saveWorkflow({
        workflowId: "wf1", kind: "single", goal: "g", status: "completed",
        reviewState: "none", approvalState: "none", cancellationState: "none",
        planSummary: "p", tasks: [], createdAt: Date.now(), updatedAt: Date.now(),
      } as never);

      // Execution fabric transition writes.
      const repo = new ExecutionRepo(adaptWorkspaceStore(store));
      const exec = new ExecutionService({ repo, idempotency: idem });
      const r = exec.execute({
        workspaceId: "test",
        capability: { kind: "core_tool", name: "test_tool" },
        actor: { kind: "user", source: "cli" },
        intent: { summary: "run", origin: { kind: "user", source: "cli" }, constraints: { dryRun: true } },
        idempotency: "naturally_idempotent",
        inputSummary: "test",
        dryRun: true,
        run: async () => ({ summary: "ok", transportOk: true }),
      });

      // Idempotency claim-first path.
      const claim = idem.claim("slot-a", "core_tool", "run-1");
      expect(claim.proceed).toBe(true);
      idem.complete("slot-a", "done");

      // Audit + execution + everything must have gone through the gate.
      expect(WorkspaceStore.unsafeWriteCount()).toBe(0);
      expect(store.verifyChain().valid).toBe(true);

      // Cross-path consistency.
      expect(store.auditCount()).toBeGreaterThan(0);
      expect(repo.findCompletedByIdempotencyKey("test", "core_tool", "test_tool", "slot-a")).toBeNull(); // dry run: no outcome
      expect(idem.get("slot-a")?.state).toBe("completed");

      store.close();
      expect(WorkspaceStore.unsafeWriteCount()).toBe(0);
      void r;
    } finally {
      rmrf(dir);
    }
  });

  test("two stores on the same path share one read-write connection (max-1 RW per file)", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-max1-"));
    try {
      const dbPath = join(dir, "xr.db");
      const baseline = WorkspaceStore.connectionCount();
      const a = new WorkspaceStore("a", dbPath);
      const b = new WorkspaceStore("b", dbPath); // same file
      expect(WorkspaceStore.connectionCount()).toBe(baseline + 1); // shared, not +2
      a.audit("via.a", { x: 1 });
      b.audit("via.b", { x: 2 });
      expect(a.auditCount()).toBe(2);
      expect(a.verifyChain().valid).toBe(true);
      a.close();
      expect(WorkspaceStore.connectionCount()).toBe(baseline + 1); // still open via b
      b.close();
      expect(WorkspaceStore.connectionCount()).toBe(baseline);
    } finally {
      rmrf(dir);
    }
  });

  test("no second raw Database connection exists anywhere in src/ (no second write authority)", () => {
    const files = walk("src").filter((p) => !p.includes("/reliability/"));
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      // Allow only the single-writer module (openDatabase is the ONE sanctioned
      // raw-connection factory) and the store itself to construct a connection.
      if (f.endsWith("write-gate.ts") || f.endsWith("workspace-store.ts")) continue;
      const matches = text.match(/new\s+Database\s*\(/g);
      if (matches) offenders.push(`${f}: ${matches.length}x`);
    }
    expect(offenders).toEqual([]);
  });

  test("legacy db.transaction passthrough routes through the gate and is atomic", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-tx-"));
    try {
      const store = new WorkspaceStore("tx", join(dir, "xr.db"));
      const ran = store.transaction(() => {
        store.audit("tx.a", { n: 1 });
        store.audit("tx.b", { n: 2 });
        return "ok";
      })();
      expect(ran).toBe("ok");
      expect(store.auditCount()).toBe(2);
      expect(store.verifyChain().valid).toBe(true);
      expect(WorkspaceStore.unsafeWriteCount()).toBe(0);
      store.close();
    } finally {
      rmrf(dir);
    }
  });
});
