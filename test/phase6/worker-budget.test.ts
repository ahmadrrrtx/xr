/**
 * Phase 6 · Step 2 (integration) — the F-12 kill test through the REAL loop.
 *
 * One funded workflow tree, five real AgentService workers, a canned provider
 * that charges 2,000 tokens per step. The whole tree shares ONE root
 * envelope: total committed usage must never exceed it, whatever the request
 * tries to pass as `budget`, and an unfunded child must be refused outright.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentService } from "../../src/services/agent-service.ts";
import { BudgetService } from "../../src/services/budget-service.ts";
import { ServiceRegistry } from "../../src/core/service-registry.ts";
import { Tokens } from "../../src/core/tokens.ts";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { SessionRepo } from "../../src/state/repos/session-repo.ts";
import { AuditRepo } from "../../src/state/repos/audit-repo.ts";
import { CostRepo } from "../../src/state/repos/cost-repo.ts";
import { UserMemoryRepo } from "../../src/state/repos/user-memory-repo.ts";
import { PartitionRepo } from "../../src/state/repos/partition-repo.ts";
import type { ModelTurn, Provider, Tool, Message } from "../../src/core/types.ts";
import type { ConfigService } from "../../src/services/config-service.ts";
import type { ProviderService } from "../../src/services/provider-service.ts";
import type { PluginService } from "../../src/services/plugin-service.ts";
import type { McpService } from "../../src/services/mcp-service.ts";
import type { SkillService } from "../../src/services/skill-service.ts";

const ROOT = "wf_budget";
const ROOT_CAP_TOKENS = 10_000;
const STEP_TOKENS = 2000; // in+out per provider call
const N_WORKERS = 5;

let tmp: string;
let store: WorkspaceStore;
let repo: PartitionRepo;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-wbudget-"));
  store = new WorkspaceStore("wbudget-test", join(tmp, "xr.db"));
  repo = new PartitionRepo(store);
  repo.openTask(ROOT, { capUsd: 10, capTokens: ROOT_CAP_TOKENS });
  repo.partition(
    ROOT,
    Array.from({ length: N_WORKERS }, (_, i) => ({ childId: `t_${i}`, weight: 1 })),
    { floorUsd: 0.01, floorTokens: 1000 },
  );
});
afterEach(() => {
  try {
    store.close();
  } catch {}
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * Scripted provider: one tool-call turn per run (charged STEP_TOKENS), then a
 * terminal turn. Each run() takes a fresh slice via reset().
 */
function budgetProvider(): Provider & { reset(): void } {
  let i = 0;
  const toolTurn: ModelTurn = {
    message: "working",
    toolCalls: [{ id: "call_x", name: "read_file", arguments: { path: "x.txt" } } as never],
    done: false,
    usage: { inTokens: 1500, outTokens: 500 },
  };
  const finalTurn: ModelTurn = {
    message: "done",
    toolCalls: [],
    done: true,
    usage: { inTokens: 1500, outTokens: 500 },
  };
  return {
    id: "fake-llm",
    label: "Budget Fake",
    async health() {
      return { ok: true };
    }
    ,
    reset() {
      i = 0;
    },
    async chat(_m: Message[], _t: Tool[]): Promise<ModelTurn> {
      // Every worker: step 1 charged, step 2 attempted (charged at the
      // provider-call decision, denied by the ledger BEFORE the call), so the
      // script only ever answers once per run; guard extras with the final turn.
      const script = [toolTurn, finalTurn];
      return script[Math.min(i++, script.length - 1)];
    },
  };
}

function wiredRegistry(provider: Provider): ServiceRegistry {
  const registry = new ServiceRegistry();
  registry.registerValue(Tokens.SessionStore, new SessionRepo(store));
  registry.registerValue(Tokens.UserMemoryStore, new UserMemoryRepo(store));
  registry.registerValue(Tokens.CostStore, new CostRepo(store));
  registry.registerValue(Tokens.AuditStore, new AuditRepo(store));
  registry.registerValue(Tokens.Store, store);
  registry.registerValue(
    Tokens.Config,
    {
      get: () => ({
        defaults: { provider: "fake-llm", model: "canned-1" },
        // Deliberately HUGE legacy aliases: if a worker ever falls back to
        // these instead of its partition, the tree can exceed the root and
        // the Σ assertions below fail loudly. That is the F-12 regression.
        budget: { perTaskUsd: 100, perTaskTokens: 1_000_000 },
        security: { egressAllowlist: [], requireApproval: [] },
        memory: { enabled: false, injectInChat: false, recallLimit: 5, semanticRecall: false, saveSessionSummaries: false, sessionSummaryMinTurns: 6 },
        orchestration: { checkpointPlainRuns: false, concurrentWorkers: 4 },
      }),
    } as unknown as ConfigService,
  );
  registry.registerValue(Tokens.Providers, { getProvider: () => provider } as unknown as ProviderService);
  registry.registerValue(Tokens.Budget, new BudgetService(registry));
  registry.registerValue(Tokens.Plugins, { ensureLoaded: async () => {}, getPluginTools: () => [] } as unknown as PluginService);
  registry.registerValue(Tokens.Mcp, { ensureLoaded: async () => {}, getMcpTools: () => [] } as unknown as McpService);
  registry.registerValue(Tokens.Skills, { executionContext: () => undefined } as unknown as SkillService);
  return registry;
}

describe("partitioned workers — the tree cannot outrun the root", () => {
  test("5 workers × charged steps: Σ committed == root cap, each worker capped at its slice", async () => {
    const provider = budgetProvider();
    const svc = new AgentService(wiredRegistry(provider));

    for (let i = 0; i < N_WORKERS; i++) {
      provider.reset();
      const result = await svc.runTask(`worker ${i} does real work`, "ask", {
        envelope: { taskId: ROOT, childId: `t_${i}` },
        maxSteps: 6,
        say: () => {},
        approve: async () => false,
      });
      // Each worker: ONE charged step, then the ledger denies its next
      // admission (child slice exhausted) → the loop stops on budget.
      expect(result.stopped).toBe("budget");
      const child = repo.listPartitions(ROOT).find((r) => r.childId === `t_${i}`)!;
      expect(child.consumedTokens).toBe(STEP_TOKENS);
    }

    const rows = repo.listPartitions(ROOT);
    const children = rows.filter((r) => r.childId !== "@root");
    const total = children.reduce((s, r) => s + r.consumedTokens, 0);
    expect(total).toBe(ROOT_CAP_TOKENS); // 5 × 2000 = 10_000 — exactly the root
    const root = rows.find((r) => r.childId === "@root")!;
    expect(root.consumedTokens).toBe(ROOT_CAP_TOKENS);
    expect(root.consumedTokens).toBeLessThanOrEqual(root.capTokens);
  });

  test("the request's own budget is IGNORED on the partitioned path (F-12 verbatim)", async () => {
    const provider = budgetProvider();
    const svc = new AgentService(wiredRegistry(provider));
    // Worker t_0 already has a full slice after one run; a second execute
    // WITH A HUGE explicit budget must not be able to spend another token.
    provider.reset();
    await svc.runTask("w0 first pass", "ask", { envelope: { taskId: ROOT, childId: "t_0" }, maxSteps: 6, say: () => {}, approve: async () => false });
    provider.reset();
    const second = await svc.runTask("w0 greedy pass", "ask", {
      envelope: { taskId: ROOT, childId: "t_0" },
      budget: 90, // legacy alias: $90 of its own — the N× multiplier, this is what dies
      maxTokens: 500_000,
      maxSteps: 6,
      say: () => {},
      approve: async () => false,
    });
    expect(second.stopped).toBe("budget");
    expect(repo.listPartitions(ROOT).find((x) => x.childId === "t_0")!.consumedTokens).toBe(STEP_TOKENS); // still 2000, not 4000
  });

  test("an unfunded child is a REFUSED delegation, never an unbudgeted run", async () => {
    const svc = new AgentService(wiredRegistry(budgetProvider()));
    await expect(
      svc.runTask("ghost", "ask", { envelope: { taskId: ROOT, childId: "t_ghost" }, say: () => {} }),
    ).rejects.toThrow(/delegation refused/);
  });

  test("every bound envelope audits budget.envelope_bound (observability of the ceiling)", async () => {
    const provider = budgetProvider();
    const svc = new AgentService(wiredRegistry(provider));
    await svc.runTask("w1", "ask", { envelope: { taskId: ROOT, childId: "t_1" }, maxSteps: 6, say: () => {}, approve: async () => false });
    const events = store.recentAudit(50).map((r) => r.event);
    expect(events).toContain("budget.envelope_bound");
  });

  test("a CLOSED partition denies further work (the tree finished; the door shuts)", async () => {
    const provider = budgetProvider();
    const svc = new AgentService(wiredRegistry(provider));
    provider.reset();
    await svc.runTask("w2a", "ask", { envelope: { taskId: ROOT, childId: "t_2" }, maxSteps: 6, say: () => {}, approve: async () => false });
    repo.close(ROOT);
    provider.reset();
    await expect(
      svc.runTask("w2b", "ask", { envelope: { taskId: ROOT, childId: "t_2" }, maxSteps: 6, say: () => {}, approve: async () => false }),
    ).rejects.toThrow(/closed/);
  });
});
