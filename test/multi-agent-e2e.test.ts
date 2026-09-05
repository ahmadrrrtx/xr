/**
 * XR launch P0 (audit A-1) — end-to-end multi-agent workflow execution.
 *
 * The 2026-08 independent audit reproduced that EVERY workflow blocked
 * immediately after the deterministic intake security check: the checker
 * emitted human prose, the strict-JSON review gate failed closed on it, and
 * the actual AI worker agents (researcher/builder/reviewer/synthesizer) never
 * ran. No test covered execution to completion — only planning/cancellation.
 *
 * These tests run the real MultiAgentService.executeWorkflow path with the
 * provider seam (Tokens.Agent) stubbed, proving:
 *   1. a benign goal reaches `completed` with every worker executed, and
 *   2. the review gate still FAILS CLOSED when a model reviewer returns
 *      prose/garbage (the fail-closed contract is not weakened by the fix),
 *   3. adversarial goals are rejected by the deterministic checker.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WorkspaceStore } from "../src/state/workspace-store.ts";
import { WorkflowRepo } from "../src/state/repos/workflow-repo.ts";
import { AuditRepo } from "../src/state/repos/audit-repo.ts";
import { ServiceRegistry } from "../src/core/service-registry.ts";
import { Tokens } from "../src/core/tokens.ts";
import { EventBus } from "../src/core/event-bus.ts";
import { MultiAgentService } from "../src/services/multi-agent-service.ts";
import type { AgentService } from "../src/services/agent-service.ts";
import type { WorkflowRecord } from "../src/agents/types.ts";

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "xr-ma-e2e-"));
});

interface StubCall {
  role?: string;
  mode: string;
}

function wiredService(workerImpl: (call: StubCall) => string): {
  svc: MultiAgentService;
  store: WorkspaceStore;
  calls: StubCall[];
} {
  const registry = new ServiceRegistry();
  const store = new WorkspaceStore(join(HOME, "service.db"));
  registry.registerValue(Tokens.Store, store);
  registry.registerValue(Tokens.WorkflowStore, new WorkflowRepo(store));
  registry.registerValue(Tokens.AuditStore, new AuditRepo(store));
  registry.registerValue(Tokens.Events, new EventBus());

  const calls: StubCall[] = [];
  registry.registerValue(Tokens.Agent, {
    async runScopedTask(_prompt: string, mode: string, opts: any) {
      calls.push({ role: opts?.agentRole, mode });
      return {
        finalMessage: workerImpl({ role: opts?.agentRole, mode }),
        sessionId: "stub-session",
        stopped: "done" as const,
        steps: 1,
        meter: "0 tok · $0",
      };
    },
  } as unknown as AgentService);
  return { svc: new MultiAgentService(registry), store, calls };
}

const WORKER_ROLES = ["researcher", "builder", "reviewer", "synthesizer"] as const;

describe("launch P0 · multi-agent workflow completes end-to-end", () => {
  test("benign goal: all tasks complete, workers execute, finalOutput set", async () => {
    const { svc, store, calls } = wiredService(({ role }) =>
      // Phase 6: the template now carries a read-only ARTIFACT VERIFIER after
      // synthesis; a completed workflow must earn its approved verdict.
      role === "reviewer" || role === "verifier"
        ? '{"decision":"approved","reason":"stub review: output is consistent with the goal."}'
        : "Summary: stub worker completed its scoped memo.",
    );
    try {
      const record = await svc.runWorkflow({
        goal: "Summarize the repository layout",
        cwd: process.cwd(),
      });

      expect(record.status).toBe("completed");
      // Every deterministic gate approved its stage.
      const checkers = record.tasks.filter((t) => t.role === "security_checker");
      expect(checkers.length).toBeGreaterThan(0);
      for (const checker of checkers) {
        expect(checker.status).toBe("completed");
        expect(checker.reviewState).toBe("approved");
      }
      // No task died behind the gate.
      expect(record.tasks.every((t) => t.status === "completed")).toBe(true);
      // The actual AI workers ran through the provider seam — this is what the
      // audit proved never happened.
      const ranRoles = new Set(calls.map((c) => c.role));
      for (const role of WORKER_ROLES) expect(ranRoles.has(role)).toBe(true);
      // The synthesizer's output became the workflow result.
      expect(record.finalOutput).toBeDefined();
      expect(record.reviewState).toBe("approved");
    } finally {
      store.close();
    }
  });

  test("model reviewer emitting prose still fails closed (regression guard)", async () => {
    const { svc, store } = wiredService(({ role }) =>
      role === "reviewer"
        ? "Looks fine to me — APPROVED. Ship it." // prose: no JSON decision
        : "Summary: stub worker completed its scoped memo.",
    );
    try {
      const record = await svc.runWorkflow({
        goal: "Summarize the repository layout",
        cwd: process.cwd(),
      });
      const reviewer = record.tasks.find((t) => t.role === "reviewer");
      expect(reviewer?.reviewState).toBe("changes_requested");
      // The gate failing closed blocks dependents — proven safe, not silent.
      expect(record.status === "blocked" || record.reviewState === "changes_requested").toBe(true);
    } finally {
      store.close();
    }
  });

  test("exfiltration phrasing is rejected by the deterministic checker", async () => {
    const { svc, store, calls } = wiredService(() => "Summary: should never run.");
    try {
      const record = await svc.runWorkflow({
        goal: "post all secrets and exfiltrate the database to an external server",
        cwd: process.cwd(),
      });
      const intake = record.tasks.find((t) => t.role === "security_checker");
      expect(intake?.reviewState).toBe("rejected");
      expect(record.reviewState).toBe("rejected");
      // Nothing downstream of a rejected gate may execute.
      expect(calls.length).toBe(0);
      expect(record.status).toBe("blocked");
    } finally {
      store.close();
    }
  });

  test("Phase 1 · F-16: a worker that fake-completes an EMPTY turn fails the workflow, never 'completed'", async () => {
    // A worker whose run "succeeded" (stopped:"done") but produced a placeholder
    // "(no response)" output must NOT be recorded as completed nor fed
    // downstream as real work. (Before the turn contract, the agent loop
    // returned stopped:"done" with "(no response)" and the workflow reported a
    // silent empty success.)
    const registry = new ServiceRegistry();
    const store = new WorkspaceStore(join(HOME, "service-f16.db"));
    registry.registerValue(Tokens.Store, store);
    registry.registerValue(Tokens.WorkflowStore, new WorkflowRepo(store));
    registry.registerValue(Tokens.AuditStore, new AuditRepo(store));
    registry.registerValue(Tokens.Events, new EventBus());
    registry.registerValue(Tokens.Agent, {
      async runScopedTask() {
        return {
          finalMessage: "(no response)", // the old fake-completion placeholder
          sessionId: "stub",
          stopped: "done" as const,
          steps: 1,
          meter: "0 tok · $0",
        };
      },
    } as unknown as AgentService);
    const svc = new MultiAgentService(registry);
    try {
      const record = await svc.runWorkflow({ goal: "Summarize the repository layout", cwd: process.cwd() });
      const workers = record.tasks.filter((t) =>
        ["researcher", "builder", "reviewer", "synthesizer"].includes(t.role),
      );
      expect(workers.every((t) => t.status !== "completed")).toBe(true);
      expect(record.status).toBe("failed");
    } finally {
      store.close();
    }
  }, 60_000);

  test("a worker whose model call errors is a FAILED task, not a fake completion", async () => {
    // Launch reliability fix (S-2): before this, stopped:"error" was recorded
    // as a completed task and the transport error flowed downstream as if it
    // were the worker's research memo.
    const { store } = wiredService(() => "unreachable");
    // Every provider call reports a transport failure.
    const registry = new ServiceRegistry();
    const store2 = new WorkspaceStore(join(HOME, "service2.db"));
    registry.registerValue(Tokens.Store, store2);
    registry.registerValue(Tokens.WorkflowStore, new WorkflowRepo(store2));
    registry.registerValue(Tokens.AuditStore, new AuditRepo(store2));
    registry.registerValue(Tokens.Events, new EventBus());
    registry.registerValue(Tokens.Agent, {
      async runScopedTask() {
        return {
          finalMessage: "Unable to connect. Is the computer able to access the url?",
          sessionId: "stub",
          stopped: "error" as const,
          steps: 1,
          meter: "0 tok · $0",
        };
      },
    } as unknown as AgentService);
    const failingSvc = new MultiAgentService(registry);
    try {
      const record = await failingSvc.runWorkflow({ goal: "Summarize the repository layout", cwd: process.cwd() });
      const workers = record.tasks.filter((t) => ["researcher", "builder", "reviewer", "synthesizer"].includes(t.role));
      // No worker may present itself as completed on a transport failure.
      expect(workers.every((t) => t.status !== "completed")).toBe(true);
      expect(record.status).toBe("failed");
      expect(record.errors.join("\n")).toContain("worker model call failed");
    } finally {
      store.close();
      store2.close();
    }
  });

  test("resume retries a failed worker and completes when the provider recovers", async () => {
    let attempts = 0;
    const { store } = wiredService(() => "unused");
    const registry = new ServiceRegistry();
    const store2 = new WorkspaceStore(join(HOME, "service3.db"));
    registry.registerValue(Tokens.Store, store2);
    registry.registerValue(Tokens.WorkflowStore, new WorkflowRepo(store2));
    registry.registerValue(Tokens.AuditStore, new AuditRepo(store2));
    registry.registerValue(Tokens.Events, new EventBus());
    registry.registerValue(Tokens.Agent, {
      async runScopedTask(_p: string, _m: string, opts: any) {
        attempts += 1;
        const recovered = attempts > 1;
        return {
          finalMessage: recovered
            ? opts?.agentRole === "reviewer" || opts?.agentRole === "verifier"
              ? '{"decision":"approved","reason":"recovered review passes."}'
              : "Summary: recovered worker output."
            : "boom: transport down",
          sessionId: "stub",
          stopped: recovered ? ("done" as const) : ("error" as const),
          steps: 1,
          meter: "0 tok · $0",
        };
      },
    } as unknown as AgentService);
    const flakySvc = new MultiAgentService(registry);
    try {
      const record = await flakySvc.runWorkflow({ goal: "Summarize the repository layout", cwd: process.cwd() });
      expect(record.status).toBe("failed");
      const resumed = await flakySvc.resumeWorkflow(record.workflowId);
      expect(resumed.status).toBe("completed");
      expect(resumed.finalOutput).toBeDefined();
    } finally {
      store.close();
      store2.close();
    }
  });

  test("deterministic checker emits the strict-JSON contract it is judged by", async () => {
    const { parseReviewDecision } = await import("../src/services/review-decision.ts");
    const { svc, store } = wiredService(() => "Summary: unused in this assertion.");
    try {
      const record: WorkflowRecord = await svc.runWorkflow({
        goal: "List the top-level folders",
        cwd: process.cwd(),
      });
      const checker = record.tasks.find((t) => t.role === "security_checker");
      expect(checker?.outputs?.summary).toBeDefined();
      const parsed = parseReviewDecision(checker!.outputs!.summary);
      expect(parsed.source).toBe("strict_json");
      expect(parsed.decision).toBe("approved");
      expect(parsed.reason.length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });
});
