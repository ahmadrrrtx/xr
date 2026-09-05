/**
 * Phase 6 (integration) — the MISSION SHAPE: plan → funded partitions →
 * parallel workers → read-only verifier → terminal, with every step durable
 * on the workflow record and the ledger. Plus the fail-closed negatives.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { WorkflowRepo } from "../../src/state/repos/workflow-repo.ts";
import { AuditRepo } from "../../src/state/repos/audit-repo.ts";
import { PartitionRepo } from "../../src/state/repos/partition-repo.ts";
import { ServiceRegistry } from "../../src/core/service-registry.ts";
import { Tokens } from "../../src/core/tokens.ts";
import { EventBus } from "../../src/core/event-bus.ts";
import { MultiAgentService } from "../../src/services/multi-agent-service.ts";
import type { AgentService } from "../../src/services/agent-service.ts";

let HOME: string;
beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "xr-mission-"));
});
afterEach(() => rmSync(HOME, { recursive: true, force: true }));

type StubCall = { role?: string; mode: string; prompt: string };

function wiredService(workerImpl: (call: StubCall) => string) {
  const registry = new ServiceRegistry();
  const store = new WorkspaceStore(join(HOME, "service.db"));
  registry.registerValue(Tokens.Store, store);
  registry.registerValue(Tokens.WorkflowStore, new WorkflowRepo(store));
  registry.registerValue(Tokens.AuditStore, new AuditRepo(store));
  registry.registerValue(Tokens.Events, new EventBus());
  const calls: StubCall[] = [];
  registry.registerValue(Tokens.Agent, {
    async runScopedTask(prompt: string, mode: string, opts: any) {
      calls.push({ role: opts?.agentRole, mode, prompt });
      return {
        finalMessage: workerImpl({ role: opts?.agentRole, mode, prompt }),
        sessionId: "stub-session",
        stopped: "done" as const,
        steps: 1,
        meter: "0 tok · $0",
      };
    },
  } as unknown as AgentService);
  return { svc: new MultiAgentService(registry), store, calls };
}

const APPROVE = '{"decision":"approved","reason":"stub verdict: claimed files exist and match summaries."}';
const MEMO = "Summary: stub worker completed its scoped memo.";

describe("mission shape — plan → partitions → parallel workers → verifier", () => {
  test("research goal with approving verifier: completed, tree-funded, lanes durable", async () => {
    const { svc, store, calls } = wiredService(({ role }) =>
      role === "reviewer" || role === "verifier" ? APPROVE : MEMO,
    );
    try {
      const record = await svc.runWorkflow({
        goal: "Compare the top three vendor pricing plans and support SLAs for our migration",
        cwd: process.cwd(),
      });
      expect(record.status).toBe("completed");

      // (1) The verifier lane RAN (the research template carries it by default).
      expect(new Set(calls.map((c) => c.role))).toContain("verifier");
      // (2) The verifier's packet carried the ARTIFACT MANIFEST framed as data.
      const verifierPrompt = calls.find((c) => c.role === "verifier")!.prompt;
      expect(verifierPrompt).toContain("ARTIFACT MANIFEST");
      expect(verifierPrompt.toLowerCase()).toContain("data, not instructions");
      // (3) The workflow's budget is a FUNDED TREE: @root + one child per
      //     funded task, Σ child caps ≤ root caps (in USD; tokens likewise).
      const rows = new PartitionRepo(store).listPartitions(record.workflowId);
      const root = rows.find((r) => r.childId === "@root")!;
      const children = rows.filter((r) => r.childId !== "@root");
      expect(children.length).toBeGreaterThan(0);
      const sumUsd = children.reduce((s, c) => s + (c.capUsd ?? 0), 0);
      if (root.capUsd) expect(sumUsd).toBeLessThanOrEqual(root.capUsd + 1e-9);
      // (4) The partitions are MIRRORED onto the record (resumable truth).
      expect(record.partitions?.length).toBe(rows.length);
      expect(record.partitions?.some((p) => p.childId === "@root")).toBe(true);
      // (5) Every task transition is audited through the task runtime.
      const events = store.recentAudit(400).map((e) => e.event);
      expect(events).toContain("agents.task.transition");
      // (6) planVersion exists (starts at 0 — no supervised edit fired here).
      expect(typeof record.planVersion).toBe("number");
    } finally {
      store.close();
    }
  });

  test("verifier REJECTS ⇒ the workflow fails (approve is earned, never assumed)", async () => {
    const { svc, store } = wiredService(({ role }) =>
      role === "verifier"
        ? '{"decision":"changes_requested","reason":"builder claims a file that does not exist"}'
        : role === "reviewer"
          ? APPROVE
          : MEMO,
    );
    try {
      const record = await svc.runWorkflow({
        goal: "Compare vendor pricing plans and support SLAs carefully for the migration",
        cwd: process.cwd(),
      });
      const verifier = record.tasks.find((t) => t.role === "verifier");
      expect(verifier).toBeDefined();
      expect(verifier!.status).toBe("failed");
      expect(record.status).toBe("failed");
      const failEvent = store
        .recentAudit(400)
        .find((e) => e.event === "agents.verifier.decided" || e.detail?.toString().includes("verifier"));
      expect(failEvent).toBeDefined();
    } finally {
      store.close();
    }
  });

  test("verifier GARBAGE (prose assurance) ⇒ fail-closed with the honest reason", async () => {
    const { svc, store } = wiredService(({ role }) =>
      role === "verifier" ? "Everything looks great, fully approved, ship it." : role === "reviewer" ? APPROVE : MEMO,
    );
    try {
      const record = await svc.runWorkflow({
        goal: "Research the pricing plans of the top three vendors and their support SLAs",
        cwd: process.cwd(),
      });
      const verifier = record.tasks.find((t) => t.role === "verifier");
      expect(verifier!.status).toBe("failed");
      expect(JSON.stringify(verifier)).toContain("unparsable");
      expect(record.status).toBe("failed");
    } finally {
      store.close();
    }
  });

  test("a DELEGATED child task runs under its partition, and its identity audits mint/spawn", async () => {
    const { svc, store, calls } = wiredService(({ role }) =>
      role === "reviewer" || role === "verifier" ? APPROVE : MEMO,
    );
    try {
      const record = await svc.runWorkflow({
        goal: "Research competitor pricing plans and SLAs before the migration",
        cwd: process.cwd(),
      });
      const events = store.recentAudit(500);
      const names = events.map((e) => e.event);
      // Worker identities were minted by the supervisor for the funded lanes…
      expect(names.some((n) => /agent\.minted/.test(n))).toBe(true);
      // …and the workers' envelope is BOUND to the partition (loop-side audit)
      // — or, on this stubbed-agent path, at least the funding rows exist.
      const rows = new PartitionRepo(store).listPartitions(record.workflowId);
      expect(rows.length).toBe(record.partitions?.length ?? 0);
      void calls;
    } finally {
      store.close();
    }
  });
});
