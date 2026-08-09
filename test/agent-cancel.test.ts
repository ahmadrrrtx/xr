/**
 * XR launch (audit A-19) — cooperative cancellation threading.
 *
 *   surface abort handle → AgentService / executeOnSurface → envelope → runner
 *   → agent-loop checkpoints → honest `stopped: "cancelled"`
 *
 * Ledger A-19 recorded the gap: no cancel signal ever reached
 * AgentService → runner → loop, `AgentResult.stopped` had no `cancelled`
 * variant, and the Shell's own Ctrl+C handler admitted "agent may not support
 * abort yet". This file pins the delivered primitive at every layer:
 *
 *   1. loop — a pre-aborted signal stops before step 0 (provider never called);
 *   2. loop — an abort mid-turn lands BEFORE that turn's tool calls run
 *      (a cancelled run must not perform new side effects) and the session is
 *      audited `session.cancelled`;
 *   3. loop — no signal / un-aborted signal = unchanged behaviour;
 *   4. service — AgentService threads the signal through the envelope;
 *   5. surface — executeOnSurface threads it identically;
 *   6. workflow — stopWorkflow reaches the IN-FLIGHT worker run (not only the
 *      next task boundary): the worker fails honestly as "interrupted", the
 *      workflow ends `cancelled`, and nothing downstream fakes completion;
 *   7. workflow — a LATER run on the same service instance is not poisoned by
 *      the earlier run's aborted controller (fresh handle per execution).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../src/state/workspace-store.ts";
import { runAgent } from "../src/core/agent.ts"; // deprecated alias: loop-level unit path (pattern: test/agent.test.ts)
import { executeOnSurface } from "../src/services/surface-execution.ts";
import { AgentService } from "../src/services/agent-service.ts";
import { MultiAgentService } from "../src/services/multi-agent-service.ts";
import { BudgetService } from "../src/services/budget-service.ts";
import { ServiceRegistry } from "../src/core/service-registry.ts";
import { Tokens } from "../src/core/tokens.ts";
import { EventBus } from "../src/core/event-bus.ts";
import { WorkspaceStore } from "../src/state/workspace-store.ts";
import { SessionRepo } from "../src/state/repos/session-repo.ts";
import { AuditRepo } from "../src/state/repos/audit-repo.ts";
import { CostRepo } from "../src/state/repos/cost-repo.ts";
import { UserMemoryRepo } from "../src/state/repos/user-memory-repo.ts";
import { WorkflowRepo } from "../src/state/repos/workflow-repo.ts";
import type { Message, ModelTurn, Provider, Tool } from "../src/core/types.ts";
import type { ConfigService } from "../src/services/config-service.ts";
import type { ProviderService } from "../src/services/provider-service.ts";
import type { PluginService } from "../src/services/plugin-service.ts";
import type { McpService } from "../src/services/mcp-service.ts";
import type { SkillService } from "../src/services/skill-service.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-cancel-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** A promise the test resolves when cancellation should take effect. */
class Gate {
  promise: Promise<void>;
  resolve!: () => void;
  constructor() {
    this.promise = new Promise((r) => (this.resolve = r));
  }
}

/** Poll until a condition holds (bounded), to catch "in flight" deterministically. */
async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

// ── 1–3 · the loop itself ────────────────────────────────────────────────────

function loopProvider(turns: ModelTurn[]): Provider & { calls: number } {
  let calls = 0;
  return {
    id: "mock",
    label: "Mock",
    get calls() {
      return calls;
    },
    async chat(_m: Message[], _t: Tool[]) {
      calls++;
      return turns[Math.min(calls - 1, turns.length - 1)]!;
    },
    async health() {
      return { ok: true, latencyMs: 1 };
    },
  };
}

describe("agent loop checkpoints (A-19)", () => {
  test("pre-aborted signal: stops before step 0, provider never called", async () => {
    const store = new Store(join(tmp, "pre.db"));
    const provider = loopProvider([{ message: "never seen", toolCalls: [], done: true }]);
    const controller = new AbortController();
    controller.abort();

    const result = await runAgent("task", "agent", {
      provider,
      store,
      cwd: tmp,
      say: () => {},
      approve: async () => false,
      maxSteps: 5,
      signal: controller.signal,
    });

    expect(result.stopped).toBe("cancelled");
    expect(result.steps).toBe(0);
    expect(provider.calls).toBe(0);
    expect(store.getSession(result.sessionId)!.status).toBe("stopped");
    const events = store.recentAudit(20).map((r) => r.event);
    expect(events).toContain("session.cancelled");
    expect(store.verifyChain().valid).toBe(true);
    store.close();
  });

  test("abort mid-turn: the aborted turn's tool calls never execute (no post-abort side effects)", async () => {
    const store = new Store(join(tmp, "mid.db"));
    const gate = new Gate();
    const controller = new AbortController();
    let calls = 0;
    const provider: Provider = {
      id: "mock",
      label: "Mock",
      async chat() {
        calls++;
        if (calls === 1) await gate.promise; // hold the first turn in flight
        return {
          message: "about to act",
          toolCalls: [{ tool: "spy_tool", args: {} }],
          done: false,
        };
      },
      async health() {
        return { ok: true };
      },
    };
    let spyRan = false;
    const spyTool: Tool = {
      name: "spy_tool",
      description: "tracks whether it ran",
      parameters: { type: "object", properties: {} },
      requiresApproval: false,
      async run() {
        spyRan = true;
        return { ok: true, output: "ran" };
      },
    };

    const run = runAgent("task", "agent", {
      provider,
      store,
      cwd: tmp,
      say: () => {},
      approve: async () => false,
      maxSteps: 5,
      extraTools: [spyTool],
      signal: controller.signal,
    });
    await waitFor(() => calls === 1, "first model turn in flight");
    controller.abort();
    gate.resolve();
    const result = await run;

    expect(result.stopped).toBe("cancelled");
    expect(result.steps).toBe(1); // the think step happened...
    expect(spyRan).toBe(false); // ...but its side effect did NOT.
    const events = store.recentAudit(20).map((r) => r.event);
    expect(events).toContain("session.cancelled");
    store.close();
  });

  test("no signal / un-aborted signal: behaviour unchanged", async () => {
    const store = new Store(join(tmp, "happy.db"));
    const provider = loopProvider([{ message: "final answer", toolCalls: [], done: true }]);
    const controller = new AbortController(); // never aborted

    const noSignal = await runAgent("a", "agent", {
      provider,
      store,
      cwd: tmp,
      say: () => {},
      approve: async () => false,
      maxSteps: 3,
    });
    const withSignal = await runAgent("b", "agent", {
      provider,
      store,
      cwd: tmp,
      say: () => {},
      approve: async () => false,
      maxSteps: 3,
      signal: controller.signal,
    });

    expect(noSignal.stopped).toBe("done");
    expect(withSignal.stopped).toBe("done");
    store.close();
  });
});

// ── 4–5 · the seam: service + surface ────────────────────────────────────────

function configFake() {
  return {
    get: () => ({
      defaults: { provider: "mock", model: "m" },
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

function wiredRegistry(store: WorkspaceStore, provider: Provider): ServiceRegistry {
  const registry = new ServiceRegistry();
  registry.registerValue(Tokens.SessionStore, new SessionRepo(store));
  registry.registerValue(Tokens.UserMemoryStore, new UserMemoryRepo(store));
  registry.registerValue(Tokens.CostStore, new CostRepo(store));
  registry.registerValue(Tokens.AuditStore, new AuditRepo(store));
  registry.registerValue(Tokens.Store, store);
  registry.registerValue(Tokens.Config, configFake() as unknown as ConfigService);
  registry.registerValue(Tokens.Providers, { getProvider: () => provider } as unknown as ProviderService);
  registry.registerValue(Tokens.Budget, new BudgetService(registry));
  registry.registerValue(Tokens.Plugins, { ensureLoaded: async () => {}, getPluginTools: () => [] } as unknown as PluginService);
  registry.registerValue(Tokens.Mcp, { ensureLoaded: async () => {}, getMcpTools: () => [] } as unknown as McpService);
  registry.registerValue(Tokens.Skills, { executionContext: () => undefined } as unknown as SkillService);
  return registry;
}

describe("service/surface threading (A-19)", () => {
  test("AgentService.execute threads the signal: pre-aborted stops the envelope", async () => {
    const store = new WorkspaceStore("cancel-svc", join(tmp, "svc.db"));
    const provider = loopProvider([{ message: "x", toolCalls: [], done: true }]);
    const svc = new AgentService(wiredRegistry(store, provider));
    const controller = new AbortController();
    controller.abort();

    const outcome = await svc.execute({
      task: "task",
      mode: "ask",
      say: () => {},
      approve: async () => false,
      signal: controller.signal,
    });

    expect(outcome.stopped).toBe("cancelled");
    expect(outcome.steps).toBe(0);
    expect(provider.calls).toBe(0);
    expect(store.getSession(outcome.sessionId)!.status).toBe("stopped");
    const events = store.recentAudit(20).map((r) => r.event);
    expect(events).toContain("session.cancelled");
    store.close();
  });

  test("executeOnSurface threads the signal identically", async () => {
    const store = new Store(join(tmp, "surface.db"));
    const provider = loopProvider([{ message: "x", toolCalls: [], done: true }]);
    const controller = new AbortController();
    controller.abort();

    const outcome = await executeOnSurface({
      task: "task",
      mode: "ask",
      surface: "shell",
      store,
      provider,
      modelId: "m",
      budget: {},
      pricing: { inPerMTok: 0, outPerMTok: 0 },
      approve: async () => false,
      signal: controller.signal,
    });

    expect(outcome.stopped).toBe("cancelled");
    expect(outcome.steps).toBe(0);
    expect(provider.calls).toBe(0);
    store.close();
  });
});

// ── 6–7 · the flagship: workflow stop reaches the in-flight worker ──────────

function wiredMultiAgent(store: WorkspaceStore, provider: Provider): {
  svc: MultiAgentService;
  registry: ServiceRegistry;
} {
  const registry = wiredRegistry(store, provider);
  registry.registerValue(Tokens.WorkflowStore, new WorkflowRepo(store));
  registry.registerValue(Tokens.Events, new EventBus());
  registry.registerValue(Tokens.Agent, new AgentService(registry));
  return { svc: new MultiAgentService(registry), registry };
}

describe("workflow cancellation reach (A-19)", () => {
  test("stopWorkflow aborts the in-flight worker run: honest 'interrupted', status cancelled, no fake completion", async () => {
    const store = new WorkspaceStore("cancel-wf", join(tmp, "wf.db"));
    const gate = new Gate();
    let gateOpen = false;
    let chatCalls = 0;
    // Every turn holds on the gate until the test opens it; each turn claims
    // to still be working, so any run that escapes the gate un-aborted would
    // loop (and be caught by max_steps) rather than fake-finish.
    const provider: Provider = {
      id: "mock",
      label: "Mock",
      async chat() {
        chatCalls++;
        if (!gateOpen) await gate.promise;
        return { message: "still working", toolCalls: [], done: false };
      },
      async health() {
        return { ok: true };
      },
    };
    const { svc } = wiredMultiAgent(store, provider);

    const run = svc.runWorkflow({ goal: "Summarize the repository layout", cwd: tmp });
    await waitFor(() => chatCalls >= 1, "an in-flight worker model call");
    const wfId = svc.listWorkflows(1)[0]!.workflowId;
    const stopped = svc.stopWorkflow(wfId);
    expect(stopped.cancellationState).toBe("requested");
    gateOpen = true;
    gate.resolve();

    const record = await run;
    expect(record.status).toBe("cancelled");
    // The in-flight worker failed HONESTLY as interrupted (not completed,
    // not a generic error).
    const interrupted = record.tasks.find((t) =>
      t.errors.some((e) => e.includes("worker interrupted: the run was cancelled")),
    );
    expect(interrupted).not.toBeUndefined();
    expect(interrupted!.status).toBe("failed");
    // Downstream work was flipped to cancelled at the boundary…
    expect(record.tasks.some((t) => t.status === "cancelled")).toBe(true);
    // …and nothing fabricated a final answer.
    expect(record.finalOutput).toBeUndefined();
    expect(record.errors.some((e) => e === `cancelled:${wfId}`)).toBe(true);
    store.close();
  });

  test("a later run on the same service instance is not poisoned by an aborted run", async () => {
    const store = new WorkspaceStore("cancel-wf2", join(tmp, "wf2.db"));
    // Completed workers answer with the strict-JSON decision contract so the
    // review gate APPROVES (a prose "final answer" would fail closed — F-1;
    // every role speaking JSON is harmless to non-reviewer tasks).
    const provider = loopProvider([
      { message: '{"decision":"approved","reason":"trusted"}', toolCalls: [], done: true },
    ]);
    const { svc } = wiredMultiAgent(store, provider);

    // Poison the well: cancel a run that is in flight (gate held), then let it settle.
    const gate = new Gate();
    let gateOpen = false;
    let chatCalls = 0;
    const gating: Provider = {
      id: "mock",
      label: "Mock",
      async chat() {
        chatCalls++;
        if (!gateOpen) await gate.promise;
        return { message: "still working", toolCalls: [], done: false };
      },
      async health() {
        return { ok: true };
      },
    };
    const first = wiredMultiAgent(store, gating);
    const firstRun = first.svc.runWorkflow({ goal: "Summarize the repository layout", cwd: tmp });
    await waitFor(() => chatCalls >= 1, "first workflow in flight");
    first.svc.stopWorkflow(first.svc.listWorkflows(1)[0]!.workflowId);
    gateOpen = true;
    gate.resolve();
    await firstRun;

    // A fresh workflow on the SAME service instance must run clean — its own
    // controller, not the aborted one.
    const record = await svc.runWorkflow({ goal: "Summarize the repository layout", cwd: tmp });
    expect(record.status).toBe("completed");
    store.close();
  });
});
