/**
 * XR — AgentService Suite
 *
 * Verifies the 0.6 DI-wired reasoning loop without any network:
 *  - dependency resolution through the ServiceRegistry (fail-fast contract)
 *  - happy path: fake provider completes; session/audit/cost persistence lands
 *    in the UNIFIED store (0.2)
 *  - deterministic rails: max_steps and the token budget stop the loop
 *
 * The provider is a canned double — the point is the WIRING and the
 * persistence/integrity guarantees, not the model.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentService } from "../../src/services/agent-service.ts";
import { BudgetService } from "../../src/services/budget-service.ts";
import { ServiceRegistryImpl } from "../../src/core/service-registry.ts";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { SessionRepo } from "../../src/state/repos/session-repo.ts";
import { AuditRepo } from "../../src/state/repos/audit-repo.ts";
import { CostRepo } from "../../src/state/repos/cost-repo.ts";
import { UserMemoryRepo } from "../../src/state/repos/user-memory-repo.ts";
import type { Message, ModelTurn, Provider, Tool } from "../../src/core/types.ts";

let tmp: string;
let store: WorkspaceStore;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-agent-"));
  store = new WorkspaceStore("agent-test", join(tmp, "xr.db"));
});

afterEach(() => {
  try {
    store.close();
  } catch {}
  rmSync(tmp, { recursive: true, force: true });
});

/** A deterministic provider double: always answers, never calls tools. */
function cannedProvider(turns?: ModelTurn[]): Provider {
  const script = turns && turns.length ? turns : null;
  let step = 0;
  return {
    id: "fake-llm",
    label: "Canned Fake",
    async health() {
      return { ok: true };
    },
    async chat(_messages: Message[], _tools: Tool[]): Promise<ModelTurn> {
      if (script) return script[Math.min(step++, script.length - 1)];
      return {
        message: "final answer",
        toolCalls: [],
        done: true,
        usage: { inTokens: 120, outTokens: 30 },
      };
    },
  };
}

function configFake() {
  return {
    get: () => ({
      defaults: { provider: "fake-llm", model: "canned-1" },
      budget: { perTaskUsd: 5, perTaskTokens: 250_000 },
      security: { egressAllowlist: [], requireApproval: [] },
      memory: {
        enabled: false,
        injectInChat: false,
        recallLimit: 5,
        semanticRecall: false,
        saveSessionSummaries: false,
        sessionSummaryMinTurns: 6,
      },
    }),
  };
}

function wiredContainer(provider: Provider): ServiceRegistryImpl {
  const container = new ServiceRegistryImpl();
  // Repos first: BudgetService resolves "costStore" in its constructor.
  container.register("sessionStore", new SessionRepo(store));
  container.register("userMemoryStore", new UserMemoryRepo(store));
  container.register("costStore", new CostRepo(store));
  container.register("auditStore", new AuditRepo(store));
  container.register("store", store);
  container.register("config", configFake());
  container.register("providers", { getProvider: () => provider });
  container.register("budget", new BudgetService(container));
  container.register("plugins", { ensureLoaded: async () => {}, getPluginTools: () => [] });
  container.register("mcp", { ensureLoaded: async () => {}, getMcpTools: () => [] });
  container.register("skills", { executionContext: () => undefined });
  return container;
}

describe("AgentService — DI wiring", () => {
  test("rejects fast and precisely when a required service is missing", async () => {
    const container = new ServiceRegistryImpl();
    const svc = new AgentService(container);
    await expect(
      svc.runScopedTask("hello", "ask", { say: () => {}, approve: async () => false }),
    ).rejects.toThrow("Service config not found in registry");
  });

  test("happy path completes: session, audit chain, and cost land in the unified store", async () => {
    const container = wiredContainer(cannedProvider());
    const svc = new AgentService(container);

    const approvalCalls: unknown[] = [];
    const result = await svc.runTask("say hi", "ask", {
      say: () => {},
      approve: async (req) => {
        approvalCalls.push(req);
        return true;
      },
    });

    expect(result.stopped).toBe("done");
    expect(result.finalMessage).toBe("final answer");
    expect(result.steps).toBe(1);
    expect(approvalCalls).toHaveLength(0); // no tools → no approvals

    // 0.2: persistence into the single unified store.
    const session = store.getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session!.status).toBe("done");
    expect(session!.title).toBe("say hi");

    const events = store.recentAudit(20).map((r) => r.event);
    expect(events).toContain("session.start");
    expect(events).toContain("session.done");
    expect(store.verifyChain().valid).toBe(true);

    // Token counters are recorded even when the provider is priceless.
    const summary = store.costSummary();
    expect(summary.totalTokens).toBe(150);
    expect(summary.byModel.some((m) => m.model === "Canned Fake")).toBe(true);
  });

  test("system prompt override flows into the conversation", async () => {
    const seen: Message[][] = [];
    const provider = cannedProvider();
    const originalChat = provider.chat.bind(provider);
    provider.chat = async (messages: Message[], tools: Tool[]) => {
      seen.push(messages);
      return originalChat(messages, tools);
    };
    const svc = new AgentService(wiredContainer(provider));
    await svc.runScopedTask("task", "ask", {
      say: () => {},
      approve: async () => false,
      systemPrompt: "You are a strict auditor.",
    });
    const all = seen.flat().map((m) => m.content).join("\n");
    expect(all).toContain("You are a strict auditor.");
  });
});

describe("AgentService — deterministic rails", () => {
  test("max_steps stops a provider that never finishes", async () => {
    const neverDone = cannedProvider([{ message: "working…", toolCalls: [], done: false }]);
    const svc = new AgentService(wiredContainer(neverDone));
    const result = await svc.runScopedTask("loop", "ask", {
      say: () => {},
      approve: async () => false,
      maxSteps: 3,
    });
    expect(result.stopped).toBe("max_steps");
    expect(result.steps).toBe(3);
    expect(store.getSession(result.sessionId)!.status).toBe("stopped");
  });

  test("token budget rail stops the run precisely", async () => {
    // Governor.checkBeforeStep estimates the first step at 2000 tokens
    // (Math.max(avg, 500) with no history). With maxTokens = 50 the run is
    // denied BEFORE step 0 executes — zero steps, zero recorded spend.
    const svc = new AgentService(wiredContainer(cannedProvider()));
    const result = await svc.runScopedTask("spend", "ask", {
      say: () => {},
      approve: async () => false,
      maxTokens: 50,
      maxSteps: 10,
    });
    expect(result.stopped).toBe("budget");
    expect(result.steps).toBe(0);

    const events = store.recentAudit(20).map((r) => r.event);
    expect(events).toContain("budget.pause");
    expect(events).toContain("budget.stop");
    // Denied before any provider call: nothing was recorded on the cost ledger.
    expect(store.costSummary().totalTokens).toBe(0);
    expect(store.verifyChain().valid).toBe(true);
  });
});
