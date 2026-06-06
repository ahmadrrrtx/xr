/**
 * XR — the agent loop: Observe → Think → Act, repeat until done.
 * This is the universal engine every agent harness runs (see research docs).
 */
import { randomUUID } from "node:crypto";
import type {
  ApprovalRequest,
  Message,
  Mode,
  Provider,
  Tool,
} from "./types.ts";
import { getTool, toolsForMode } from "../tools/registry.ts";
import type { Store } from "../state/db.ts";
import { CostGovernor, type Budget, type Pricing } from "../cost/governor.ts";
import { BudgetManager } from "../cost/manager.ts";
import { compact } from "../memory/compact.ts";
import { MemoryStore, projectScopeFromCwd } from "../memory/store.ts";
import { buildMemoryBlock } from "../memory/inject.ts";

export interface AgentDeps {
  provider: Provider;
  store: Store;
  cwd: string;
  /** UI hook: stream a line to the user. */
  say(line: string): void;
  /** UI hook: ask the human to approve a risky action. */
  approve(req: ApprovalRequest): Promise<boolean>;
  /** UI hook: budget exceeded — ask whether to raise it / stop. Returns extra budget or null to stop. */
  onOverBudget?(meter: string, reason: string): Promise<{ usd?: number; tokens?: number } | null>;
  /** Spend ceiling for this task. */
  budget?: Budget;
  /** Pricing for the active model. */
  pricing?: Pricing;
  /** Safety rail: max loop iterations (prevents runaway). */
  maxSteps?: number;
  /** Domains the agent may contact (egress allow-list). */
  egressAllowlist?: string[];
  /** Dry-run: simulate side effects, never write/execute. */
  dryRun?: boolean;
  /**
   * v0.9 — durable memory recall. When enabled, the agent injects relevant
   * saved memory as a single system message before the first turn. Conservative
   * by design (only entries above the relevance floor). Off → no injection.
   */
  memory?: {
    enabled: boolean;
    /** Max entries to surface. */
    recallLimit?: number;
  };
}

export interface AgentResult {
  sessionId: string;
  finalMessage: string;
  steps: number;
  stopped: "done" | "max_steps" | "error" | "budget";
  /** Final cost meter string. */
  meter?: string;
}

export async function runAgent(
  task: string,
  mode: Mode,
  deps: AgentDeps,
): Promise<AgentResult> {
  const { provider, store, cwd, say } = deps;
  const maxSteps = deps.maxSteps ?? 12;
  
  const budgetManager = new BudgetManager(store);
  const governor = new CostGovernor(
    deps.budget ?? {},
    deps.pricing ?? { inPerMTok: 0, outPerMTok: 0 },
    budgetManager,
  );
  
  const sessionId = `s_${randomUUID().slice(0, 8)}`;
  store.createSession(sessionId, task.slice(0, 80), mode);
  store.audit("session.start", { task, mode, provider: provider.id }, sessionId);

  const tools: Tool[] = toolsForMode(mode);
  const toolCtx = {
    cwd,
    approve: deps.approve,
    audit: (event: string, detail: Record<string, unknown>) =>
      store.audit(event, detail, sessionId),
    egressAllowlist: deps.egressAllowlist ?? [],
    dryRun: deps.dryRun ?? false,
  };

  const messages: Message[] = [];

  // v0.9 — conservative memory recall: surface only entries relevant to the
  // task (global + this project's scope). Never silent: the injected block is
  // clearly labelled as reference, and the recall is audited (no raw content).
  if (deps.memory?.enabled) {
    try {
      const memStore = new MemoryStore(store);
      const scope = projectScopeFromCwd(cwd);
      const recalled = memStore.recall(task, {
        scope,
        k: deps.memory.recallLimit ?? 5,
      });
      const block = buildMemoryBlock(recalled);
      if (block) {
        messages.push({ role: "system", content: block });
        store.audit(
          "memory.recall",
          { count: recalled.length, ids: recalled.map((e) => e.id) },
          sessionId,
        );
      }
    } catch {
      /* memory recall is best-effort — never block a task on it */
    }
  }

  messages.push({ role: "user", content: task });
  let finalMessage = "";
  let stepIdx = 0;

  try {
    for (; stepIdx < maxSteps; stepIdx++) {
      // COST GOVERNOR: pre-flight check. The agent cannot exceed the ceiling.
      const decision = governor.checkBeforeStep();
      
      if (decision.warning) {
        say(`\x1b[33m⚠ ${decision.warning}\x1b[0m`);
      }

      if (!decision.allow) {
        store.audit("budget.pause", { reason: decision.reason, snapshot: decision.snapshot }, sessionId);
        
        if (decision.suggestLocal) {
          say(`\x1b[33m⚠ Cloud budget exhausted. If you have a local model, consider using it.\x1b[0m`);
        }

        const extra = deps.onOverBudget
          ? await deps.onOverBudget(governor.meter(), decision.reason)
          : null;
        if (!extra) {
          say(`\x1b[33m⏸ stopped — ${decision.reason}\x1b[0m`);
          store.endSession(sessionId, "stopped");
          store.audit("budget.stop", { snapshot: governor.snapshot() }, sessionId);
          return {
            sessionId,
            finalMessage: finalMessage || `Stopped to respect your budget. ${governor.meter()}`,
            steps: stepIdx,
            stopped: "budget",
          };
        }
        governor.raise(extra);
        store.audit("budget.raised", { extra }, sessionId);
      }

      // OBSERVE + THINK: ask the model what to do next.
      say(`\x1b[2m▸ think  (step ${stepIdx + 1}/${maxSteps}) · ${provider.label} · ${governor.meter()}\x1b[0m`);
      // Smart context compaction: keep the prompt lean (serves the spend cap).
      const compacted = compact(messages, { maxChars: 16000, keepRecent: 6 });
      const turn = await provider.chat(compacted, tools);
      if (turn.usage) {
        governor.record(turn.usage.inTokens, turn.usage.outTokens);
        // Persist a per-step cost event for the Cost Cockpit (best-effort).
        try {
          const stepUsd =
            (turn.usage.inTokens / 1_000_000) * (deps.pricing?.inPerMTok ?? 0) +
            (turn.usage.outTokens / 1_000_000) * (deps.pricing?.outPerMTok ?? 0);
          store.recordCost(sessionId, provider.id, provider.label, turn.usage.inTokens, turn.usage.outTokens, stepUsd);
        } catch {
          /* cost logging is best-effort */
        }
      }
      store.addStep(`st_${randomUUID().slice(0, 8)}`, sessionId, stepIdx, "think", null, {
        message: turn.message,
        toolCalls: turn.toolCalls.map((c) => c.tool),
      });

      if (turn.message) say(`\x1b[36m◆ ${turn.message}\x1b[0m`);
      messages.push({ role: "assistant", content: JSON.stringify({ message: turn.message, tool_calls: turn.toolCalls, done: turn.done }) });

      // Done?
      if (turn.done && turn.toolCalls.length === 0) {
        finalMessage = turn.message;
        store.endSession(sessionId, "done");
        store.audit("session.done", { steps: stepIdx + 1, snapshot: governor.snapshot() }, sessionId);
        return { sessionId, finalMessage, steps: stepIdx + 1, stopped: "done", meter: governor.meter() };
      }

      // ACT: execute each requested tool call.
      for (const call of turn.toolCalls) {
        const tool = getTool(call.tool);
        if (!tool || !tools.some((t) => t.name === call.tool)) {
          // Fail closed: unknown / not-allowed tool in this mode.
          const msg = `tool "${call.tool}" is not available in ${mode} mode`;
          say(`\x1b[31m✗ ${msg}\x1b[0m`);
          messages.push({ role: "tool", name: call.tool, content: msg });
          store.audit("tool.blocked", { tool: call.tool, mode }, sessionId);
          continue;
        }
        say(`\x1b[2m▸ tool   ⚙ ${call.tool}(${JSON.stringify(call.args)})\x1b[0m`);
        try {
          const result = await tool.run(call.args, toolCtx);
          const tag = result.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
          say(`  ${tag} ${result.output.split("\n")[0].slice(0, 100)}`);
          store.addStep(`st_${randomUUID().slice(0, 8)}`, sessionId, stepIdx, "act", call.tool, {
            ok: result.ok,
          });
          messages.push({ role: "tool", name: call.tool, content: result.output });
        } catch (e) {
          const msg = `tool error: ${(e as Error).message}`;
          say(`  \x1b[31m✗ ${msg}\x1b[0m`);
          messages.push({ role: "tool", name: call.tool, content: msg });
          store.audit("tool.error", { tool: call.tool, error: (e as Error).message }, sessionId);
        }
      }
    }

    // Hit the safety rail.
    store.endSession(sessionId, "stopped");
    store.audit("session.max_steps", { steps: maxSteps }, sessionId);
    return { sessionId, finalMessage: finalMessage || "(stopped at step limit)", steps: stepIdx, stopped: "max_steps", meter: governor.meter() };
  } catch (e) {
    store.endSession(sessionId, "error");
    store.audit("session.error", { error: (e as Error).message }, sessionId);
    say(`\x1b[31m✗ error: ${(e as Error).message}\x1b[0m`);
    return { sessionId, finalMessage: (e as Error).message, steps: stepIdx, stopped: "error", meter: governor.meter() };
  }
}
