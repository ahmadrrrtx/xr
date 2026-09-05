/**
 * Phase 6 · Step 6 — durable checkpoints + honest resume through the REAL
 * AgentService (config `orchestration.checkpointPlainRuns: true`).
 *
 * Semantics under test (documented decisions, not accidents):
 *  · resume re-asks the model from the checkpointed transcript (no provider
 *    journaling); the SEED is deterministic even though the answer isn't.
 *  · a run without checkpoints (pre-Phase-6) refuses to resume — no fake
 *    "started fresh" masquerading as recovery.
 *  · a tampered chain refuses; a truncation envelope refuses.
 *  · tool-call ids keep increasing ACROSS the resume (M-09), user message is
 *    never duplicated, consumed usage is re-seeded (no free second lunch).
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
import { CheckpointRepo } from "../../src/state/repos/checkpoint-repo.ts";
import type { Message, ModelTurn, Provider, Tool } from "../../src/core/types.ts";
import type { ConfigService } from "../../src/services/config-service.ts";
import type { ProviderService } from "../../src/services/provider-service.ts";
import type { PluginService } from "../../src/services/plugin-service.ts";
import type { McpService } from "../../src/services/mcp-service.ts";
import type { SkillService } from "../../src/services/skill-service.ts";

let tmp: string;
let store: WorkspaceStore;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ckpt-"));
  store = new WorkspaceStore("ckpt-test", join(tmp, "xr.db"));
});
afterEach(() => {
  try {
    store.close();
  } catch {}
  rmSync(tmp, { recursive: true, force: true });
});

/** Script: two tool-call turns, then whatever the caller scripts per phase. */
function scriptedProvider(afterCrash: ModelTurn[]): Provider & { phase(): void; calls(): number } {
  let crashPhase = true;
  let calls = 0;
  const crashScript: ModelTurn[] = [
    {
      message: "step one",
      toolCalls: [{ id: "call_a", name: "read_file", arguments: { path: "a" } } as never],
      done: false,
      usage: { inTokens: 800, outTokens: 200 },
    },
    {
      message: "step two",
      toolCalls: [{ id: "call_b", name: "read_file", arguments: { path: "b" } } as never],
      done: false,
      usage: { inTokens: 900, outTokens: 300 },
    },
  ];
  return {
    id: "fake-llm",
    label: "Ckpt Fake",
    async health() {
      return { ok: true };
    },
    phase() {
      crashPhase = false;
      calls = 0;
    },
    calls() {
      return calls;
    },
    async chat(_m: Message[], _t: Tool[]): Promise<ModelTurn> {
      calls += 1;
      const script = crashPhase ? crashScript : afterCrash;
      const turn = script[calls - 1];
      // "Crash": the provider dies when the script is exhausted (call 3+).
      if (turn === undefined) throw new Error("provider exploded (simulated crash)");
      return turn;
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
        budget: { perTaskUsd: 5, perTaskTokens: 250_000 },
        security: { egressAllowlist: [], requireApproval: [] },
        memory: { enabled: false, injectInChat: false, recallLimit: 5, semanticRecall: false, saveSessionSummaries: false, sessionSummaryMinTurns: 6 },
        orchestration: { checkpointPlainRuns: true, concurrentWorkers: 4 },
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

const doneTurn: ModelTurn = { message: "FINISHED AFTER RESUME", toolCalls: [], done: true, usage: { inTokens: 100, outTokens: 50 } };

describe("checkpoint → crash → resume", () => {
  test("a crashed run journals run.step rows; the ledger records the failure", async () => {
    const provider = scriptedProvider([doneTurn]);
    const svc = new AgentService(wiredRegistry(provider));
    const r = await svc.runTask("do the thing", "ask", { maxSteps: 5, say: () => {}, approve: async () => false });
    // third chat call throws (script exhausted) → error stop
    expect(r.stopped).toBe("error");
    const ckpt = new CheckpointRepo(store);
    const rows = ckpt.list(r.sessionId);
    const steps = rows.filter((x) => x.kind === "run.step");
    expect(steps.length).toBeGreaterThanOrEqual(2); // one per completed charged step
    expect((steps[0]!.payload as { stepIdx: number }).stepIdx).toBe(0);
    expect((steps[1]!.payload as { stepIdx: number }).stepIdx).toBe(1);
    expect(ckpt.verifyChain(r.sessionId).ok).toBe(true);
    const events = store.recentAudit(100).map((e) => e.event);
    expect(events).toContain("task.checkpointed");
    expect(events).toContain("task.transition"); // terminal fail edge audited through the ledger
  });

  test("resume completes from the last checkpoint — no duplicated user turn, chain intact", async () => {
    const provider = scriptedProvider([
      {
        message: "resumed step",
        toolCalls: [{ id: "call_z", name: "read_file", arguments: { path: "z" } } as never],
        done: false,
        usage: { inTokens: 10, outTokens: 5 },
      },
      doneTurn,
    ]);
    const svc = new AgentService(wiredRegistry(provider));
    const crashed = await svc.runTask("do the thing", "ask", { maxSteps: 5, say: () => {}, approve: async () => false });
    expect(crashed.stopped).toBe("error");

    // Capture the CRASH-side checkpoint facts BEFORE the resume appends rows
    // to the same session journal (they share one sequence by design).
    const ckpt0 = new CheckpointRepo(store);
    const crashStepsBefore = ckpt0.list(crashed.sessionId).filter((x) => x.kind === "run.step");
    const seqOf = (row: { payload: unknown }): number => (row.payload as { toolCallSeq: number }).toolCallSeq;
    expect(seqOf(crashStepsBefore[crashStepsBefore.length - 1]!)).toBe(2);

    provider.phase(); // now the provider answers the resumed steps
    const resumed = await svc.runTask("do the thing", "ask", {
      resume: crashed.sessionId,
      maxSteps: 5,
      say: () => {},
      approve: async () => false,
    });
    expect(resumed.stopped).toBe("done");
    expect(resumed.finalMessage).toContain("FINISHED AFTER RESUME");
    expect(resumed.sessionId).toBe(crashed.sessionId); // SAME session — re-owned, not replaced

    // The resumed transcript is the checkpointed one + new turns: exactly ONE
    // user message in the FINAL durable run.step snapshot (no duplication).
    const ckpt = new CheckpointRepo(store);
    const runSteps = ckpt.list(resumed.sessionId).filter((x) => x.kind === "run.step");
    const finalStep = runSteps[runSteps.length - 1]!;
    const finalMessages = (finalStep.payload as { messages: Array<{ role: string }> }).messages;
    expect(finalMessages.filter((m) => m.role === "user").length).toBe(1);
    // The resumed run's checkpoints CONTINUE the step sequence (never restart):
    // run 1 journaled steps 0 and 1; the resumed step must be numbered 2.
    expect((finalStep.payload as { stepIdx: number }).stepIdx).toBe(2);

    // Resume is AUDITED as an explicit event (never hidden in a normal start).
    const events = store.recentAudit(100).map((e) => e.event);
    expect(events).toContain("session.resume");
    expect(events).toContain("task.resumed");
    expect(store.verifyChain().valid).toBe(true);

    // M-09: the tool-call SEQUENCE continues across the resume (seed from 2,
    // not restart at 0): the resumed checkpoint carries seq ≥ 3.
    const resumedLast = runSteps[runSteps.length - 1]!;
    expect(seqOf(resumedLast)).toBeGreaterThanOrEqual(3);
    // And ids are session-scoped: assistant transcript rows carry call ids.
    const assistantBlob = finalMessages.filter((m) => m.role === "assistant").map((m) => (m as unknown as { content: string }).content).join("|");
    expect(assistantBlob.length).toBeGreaterThan(0);
  });

  test("resumed usage re-seeds the meter — the checkpoint's spend counts against the ceiling", async () => {
    // Root-level arithmetic guard: resumed run must NOT get a fresh full budget
    // while keeping the old consumption free. Consume ~2k tokens in run 1; a
    // ceiling of exactly that must stop the resumed run at once.
    const provider = scriptedProvider([
      { message: "resumed step", toolCalls: [{ id: "c9", name: "read_file", arguments: { path: "x" } } as never], done: false, usage: { inTokens: 1000, outTokens: 500 } },
      doneTurn,
    ]);
    const svc = new AgentService(wiredRegistry(provider));
    const crashed = await svc.runTask("budget seeded resume", "ask", { maxSteps: 5, say: () => {}, approve: async () => false });
    provider.phase();
    // 2 steps × 1000 tokens consumed pre-crash. Re-run with a TIGHT ceiling:
    const resumed = await svc.runTask("budget seeded resume", "ask", {
      resume: crashed.sessionId,
      budget: 5,
      maxTokens: 2000, // the pre-crash run already consumed 2000 in THIS session's meter lineage
      maxSteps: 5,
      say: () => {},
      approve: async () => false,
    });
    // The pre-crash run consumed 2,200 tokens; the resume ceiling is 2,000.
    // A FRESH meter would happily run a step (stop "done" after the done-turn);
    // a SEEDED meter denies before the first provider call (stop "budget").
    expect(resumed.stopped).toBe("budget");
    expect(provider.calls()).toBe(0); // zero provider calls — the seed was already over
    expect(resumed.finalMessage).toContain("budget");
  });

  test("resume without checkpoints is REFUSED with the honest message (no silent restart)", async () => {
    const provider = scriptedProvider([doneTurn]);
    const svc = new AgentService(wiredRegistry(provider));
    await expect(
      svc.runTask("never ran", "ask", { resume: "s_nonexistent", say: () => {} }),
    ).rejects.toThrow(/no checkpoint|Only runs started after Phase 6|resume refused/);
  });

  test("a tampered checkpoint breaks the chain and the resume refuses", async () => {
    const provider = scriptedProvider([doneTurn]);
    const svc = new AgentService(wiredRegistry(provider));
    const crashed = await svc.runTask("tamper target", "ask", { maxSteps: 5, say: () => {}, approve: async () => false });
    const ckpt = new CheckpointRepo(store);
    expect(ckpt.verifyChain(crashed.sessionId).ok).toBe(true);

    // Direct DB tamper (simulates a modified data file, not an API misuse).
    const rows = ckpt.list(crashed.sessionId).filter((r) => r.kind === "run.step");
    const victim = rows[0]!;
    const evil = JSON.parse(JSON.stringify(victim.payload ?? {}));
    evil.messages = []; // drop the transcript
    store
      .query("UPDATE task_checkpoints SET payload_json = ? WHERE task_id = ? AND seq = ?")
      .run(JSON.stringify(evil), crashed.sessionId, victim.seq);

    const verify = ckpt.verifyChain(crashed.sessionId);
    expect(verify.ok).toBe(false);
    expect(verify.brokenAtSeq).toBe(victim.seq);
    provider.phase();
    await expect(
      svc.runTask("tamper target", "ask", { resume: crashed.sessionId, say: () => {} }),
    ).rejects.toThrow(/chain .* broken|resume refused/);
  });

  test("a truncation envelope cannot resume (honest refusal — the transcript is gone)", async () => {
    const ckpt = new CheckpointRepo(store);
    // Force an oversized payload → append() stores a {truncated:true, fileRef}
    // envelope instead of an inline transcript.
    const huge = { messages: "x".repeat(50_000) };
    ckpt.append("s_trunc", "run.step", huge as never);
    const svc = new AgentService(wiredRegistry(scriptedProvider([doneTurn])));
    await expect(
      svc.runTask("anything", "ask", { resume: "s_trunc", say: () => {} }),
    ).rejects.toThrow(/truncation envelope|refused/);
  });

  test("journal off ⇒ NO checkpoints, and resume says so plainly (config honesty)", async () => {
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
          budget: { perTaskUsd: 5, perTaskTokens: 250_000 },
          security: { egressAllowlist: [], requireApproval: [] },
          memory: { enabled: false, injectInChat: false, recallLimit: 5, semanticRecall: false, saveSessionSummaries: false, sessionSummaryMinTurns: 6 },
          orchestration: { checkpointPlainRuns: false },
        }),
      } as unknown as ConfigService,
    );
    const provider = scriptedProvider([doneTurn]);
    registry.registerValue(Tokens.Providers, { getProvider: () => provider } as unknown as ProviderService);
    registry.registerValue(Tokens.Budget, new BudgetService(registry));
    registry.registerValue(Tokens.Plugins, { ensureLoaded: async () => {}, getPluginTools: () => [] } as unknown as PluginService);
    registry.registerValue(Tokens.Mcp, { ensureLoaded: async () => {}, getMcpTools: () => [] } as unknown as McpService);
    registry.registerValue(Tokens.Skills, { executionContext: () => undefined } as unknown as SkillService);
    const svc = new AgentService(registry);
    const r = await svc.runTask("unjournaled", "ask", { maxSteps: 5, say: () => {}, approve: async () => false });
    expect(new CheckpointRepo(store).list(r.sessionId)).toHaveLength(0);
    provider.phase();
    await expect(svc.runTask("unjournaled", "ask", { resume: r.sessionId, say: () => {} })).rejects.toThrow(/refused|checkpoint/);
  });
});
