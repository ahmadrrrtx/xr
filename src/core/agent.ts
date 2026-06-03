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
import { compact } from "../memory/compact.ts";

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
  const governor = new CostGovernor(
    deps.budget ?? {},
    deps.pricing ?? { inPerMTok: 0, outPerMTok: 0 },
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

  const messages: Message[] = [{ role: "user", content: task }];
  let finalMessage = "";
  let stepIdx = 0;

  try {
    for (; stepIdx < maxSteps; stepIdx++) {
      // COST GOVERNOR: pre-flight check. The agent cannot exceed the ceiling.
      const decision = governor.checkBeforeStep();
      if (!decision.allow) {
        store.audit("budget.pause", { reason: decision.reason, snapshot: decision.snapshot }, sessionId);
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
        const before = governor.snapshot().usd;
        // Persist a per-step cost event for the Cost Cockpit (best-effort).
        try {
          const stepUsd =
            (turn.usage.inTokens / 1_000_000) * (deps.pricing?.inPerMTok ?? 0) +
            (turn.usage.outTokens / 1_000_000) * (deps.pricing?.outPerMTok ?? 0);
          store.recordCost(sessionId, provider.id, provider.label, turn.usage.inTokens, turn.usage.outTokens, stepUsd);
          void before;
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
