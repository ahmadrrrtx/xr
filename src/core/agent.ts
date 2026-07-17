/**
 * XR — the agent loop: Observe → Think → Act, repeat until done.
 * This is the universal engine every agent harness runs.
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
import type { SessionRepo } from "../state/repos/session-repo.ts";
import type { AuditRepo } from "../state/repos/audit-repo.ts";
import type { CostRepo } from "../state/repos/cost-repo.ts";
import type { UserMemoryRepo } from "../state/repos/user-memory-repo.ts";
import type { WorkspaceStore as Store } from "../state/workspace-store.ts";
import { CostGovernor, type Budget, type Pricing } from "../cost/governor.ts";
import { BudgetManager } from "../cost/manager.ts";
import { compact } from "../memory/compact.ts";
import { MemoryStore, projectScopeFromCwd } from "../memory/store.ts";
import { buildMemoryBlock } from "../memory/inject.ts";

export interface AgentDeps {
  provider: Provider;
  /** Legacy monolithic store (kept for older CLI/test call-sites during the runtime-store migration). */
  store?: Store;
  sessionStore?: SessionRepo;
  auditStore?: AuditRepo;
  costStore?: CostRepo;
  userMemoryStore?: UserMemoryRepo;
  cwd: string;
  /** Extra system guidance for role-scoped or workflow-scoped agents. */
  systemPrompt?: string;
  /** Fine-grained tool scoping for multi-agent workers. */
  tools?: {
    allow?: string[];
    deny?: string[];
  };
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
   * v0.9 / Stage 6 — durable memory recall.
   */
  memory?: {
    enabled: boolean;
    /** Max entries to surface. */
    recallLimit?: number;
    /** Use embeddings-based semantic recall. */
    semantic?: boolean;
  };
  /**
   * Stage 6 — the canonical memory engine. When provided, the agent recalls
   * through it (explainable, access-tracked, expiry-aware). Falls back to
   * `userMemoryStore` for older call-sites.
   */
  memoryStore?: MemoryStore;
  /**
   * Stage 6 — optionally fold a finished conversation into a compact session
   * summary (kept in a SEPARATE store, never confused with long-term facts).
   */
  sessionSummary?: {
    enabled: boolean;
    /** Minimum user/assistant turns before a summary is saved. */
    minTurns?: number;
  };
  /**
   * XR 1.0 — extra tools contributed by enabled plugins.
   */
  extraTools?: Tool[];
}

export interface AgentResult {
  sessionId: string;
  finalMessage: string;
  steps: number;
  stopped: "done" | "max_steps" | "error" | "budget" | "approval";
  /** Optional token counters for richer UIs when a caller/provider supplies them. */
  inputTokens?: number;
  outputTokens?: number;
  /** Final cost meter string. */
  meter?: string;
}

export async function runAgent(
  task: string,
  mode: Mode,
  deps: AgentDeps,
): Promise<AgentResult> {
  const { provider, cwd, say } = deps;
  const sessionStore = deps.sessionStore ?? deps.store;
  const auditStore = deps.auditStore ?? deps.store;
  const costStore = deps.costStore ?? deps.store;
  const userMemoryStore = deps.userMemoryStore ?? deps.store;
  if (!sessionStore || !auditStore || !costStore) {
    throw new Error("Agent requires session/audit/cost stores");
  }
  const maxSteps = deps.maxSteps ?? 12;
  
  const budgetManager = new BudgetManager(costStore);
  const governor = new CostGovernor(
    deps.budget ?? {},
    deps.pricing ?? { inPerMTok: 0, outPerMTok: 0 },
    budgetManager,
  );
  
  const sessionId = `s_${randomUUID().slice(0, 8)}`;
  sessionStore.createSession(sessionId, task.slice(0, 80), mode);
  auditStore.audit("session.start", { task, mode, provider: provider.id }, sessionId);

  const coreTools: Tool[] = toolsForMode(mode);
  const extraTools: Tool[] = mode === "agent" ? deps.extraTools ?? [] : [];
  const filteredAllow = deps.tools?.allow ? new Set(deps.tools.allow) : null;
  const filteredDeny = deps.tools?.deny ? new Set(deps.tools.deny) : null;
  const tools: Tool[] = [...coreTools, ...extraTools].filter((tool) => {
    if (filteredAllow && !filteredAllow.has(tool.name)) return false;
    if (filteredDeny && filteredDeny.has(tool.name)) return false;
    return true;
  });
  const extraToolMap = new Map(extraTools.map((t) => [t.name, t]));
  const toolCtx = {
    cwd,
    approve: deps.approve,
    audit: (event: string, detail: Record<string, unknown>) =>
      auditStore.audit(event, detail, sessionId),
    egressAllowlist: deps.egressAllowlist ?? [],
    dryRun: deps.dryRun ?? false,
  };

  const messages: Message[] = [];

  if (deps.memory?.enabled) {
    try {
      const scope = projectScopeFromCwd(cwd);
      const limit = deps.memory.recallLimit ?? 5;
      // Stage 6 — prefer the canonical engine; fall back to the legacy store.
      const engine: MemoryStore | undefined =
        deps.memoryStore ??
        (userMemoryStore && "recallSemantic" in userMemoryStore
          ? (userMemoryStore as unknown as MemoryStore)
          : undefined);
      const hits = engine
        ? (deps.memory.semantic === false
          ? engine.recallExplain(task, { scope, k: limit })
          : await engine.recallSemanticExplain(task, { scope, k: limit }))
        : [];
      const recalled = hits.map((h) => h.entry);
      const block = buildMemoryBlock(recalled);
      if (block) {
        messages.push({ role: "system", content: block });
        auditStore.audit(
          "memory.recall",
          {
            count: recalled.length,
            ids: recalled.map((e) => e.id),
            scores: hits.map((h) => ({ id: h.entry.id, sim: Math.round(h.sim * 100) })),
          },
          sessionId,
        );
      }
    } catch {
      /* best-effort: recall must never break a run */
    }
  }

  if (deps.systemPrompt?.trim()) {
    messages.push({ role: "system", content: deps.systemPrompt.trim() });
  }

  messages.push({ role: "user", content: task });
  let finalMessage = "";
  let stepIdx = 0;

  // Stage 6 — fold the finished conversation into a compact session summary.
  // Best-effort, separate store, never throws, never confuses with long-term
  // memory. Only fires when the caller opted in.
  const maybeSaveSessionSummary = (): void => {
    if (!deps.sessionSummary?.enabled || !deps.memoryStore) return;
    try {
      const scope = projectScopeFromCwd(cwd);
      deps.memoryStore.saveSessionSummary(scope, messages, {
        minTurns: deps.sessionSummary.minTurns,
      });
    } catch {
      /* best-effort */
    }
  };

  try {
    for (; stepIdx < maxSteps; stepIdx++) {
      const decision = governor.checkBeforeStep();
      
      if (decision.allow && decision.warning) {
        say(`\x1b[33m⚠ ${decision.warning}\x1b[0m`);
      }

      if (!decision.allow) {
        auditStore.audit("budget.pause", { reason: decision.reason, snapshot: decision.snapshot }, sessionId);
        
        if (decision.suggestLocal) {
          say(`\x1b[33m⚠ Cloud budget exhausted. If you have a local model, consider using it.\x1b[0m`);
        }

        const extra = deps.onOverBudget
          ? await deps.onOverBudget(governor.meter(), decision.reason)
          : null;
        if (!extra) {
          say(`\x1b[33m⏸ stopped — ${decision.reason}\x1b[0m`);
          sessionStore.endSession(sessionId, "stopped");
          auditStore.audit("budget.stop", { snapshot: governor.snapshot() }, sessionId);
          return {
            sessionId,
            finalMessage: finalMessage || `Stopped to respect your budget. ${governor.meter()}`,
            steps: stepIdx,
            stopped: "budget",
          };
        }
        governor.raise(extra);
        auditStore.audit("budget.raised", { extra }, sessionId);
      }

      say(`\x1b[2m▸ think  (step ${stepIdx + 1}/${maxSteps}) · ${provider.label} · ${governor.meter()}\x1b[0m`);
      const compacted = compact(messages, { maxChars: 16000, keepRecent: 6 });
      const turn = await provider.chat(compacted, tools);
      if (turn.usage) {
        governor.record(turn.usage.inTokens, turn.usage.outTokens);
        try {
          const stepUsd =
            (turn.usage.inTokens / 1_000_000) * (deps.pricing?.inPerMTok ?? 0) +
            (turn.usage.outTokens / 1_000_000) * (deps.pricing?.outPerMTok ?? 0);
          costStore.recordCost(sessionId, provider.id, provider.label, turn.usage.inTokens, turn.usage.outTokens, stepUsd);
        } catch {
          /* best-effort */
        }
      }
      sessionStore.addStep(`st_${randomUUID().slice(0, 8)}`, sessionId, stepIdx, "think", null, {
        message: turn.message,
        toolCalls: turn.toolCalls.map((c) => c.tool),
      });

      if (turn.message) say(`\x1b[36m◆ ${turn.message}\x1b[0m`);
      messages.push({ role: "assistant", content: JSON.stringify({ message: turn.message, tool_calls: turn.toolCalls, done: turn.done }) });

      if (turn.done && turn.toolCalls.length === 0) {
        finalMessage = turn.message;
        // Stage 6 — optionally fold the conversation into a session summary.
        maybeSaveSessionSummary();
        sessionStore.endSession(sessionId, "done");
        auditStore.audit("session.done", { steps: stepIdx + 1, snapshot: governor.snapshot() }, sessionId);
        return { sessionId, finalMessage, steps: stepIdx + 1, stopped: "done", meter: governor.meter() };
      }

      for (const call of turn.toolCalls) {
        const tool = getTool(call.tool) ?? extraToolMap.get(call.tool);
        if (!tool || !tools.some((t) => t.name === call.tool)) {
          const msg = `tool "${call.tool}" is not available in ${mode} mode`;
          say(`\x1b[31m✗ ${msg}\x1b[0m`);
          messages.push({ role: "tool", name: call.tool, content: msg });
          auditStore.audit("tool.blocked", { tool: call.tool, mode }, sessionId);
          continue;
        }
        say(`\x1b[2m▸ tool   ⚙ ${call.tool}(${JSON.stringify(call.args)})\x1b[0m`);
        try {
          const result = await tool.run(call.args, toolCtx);
          const tag = result.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
          say(`  ${tag} ${result.output.split("\n")[0].slice(0, 100)}`);
          sessionStore.addStep(`st_${randomUUID().slice(0, 8)}`, sessionId, stepIdx, "act", call.tool, {
            ok: result.ok,
          });
          messages.push({ role: "tool", name: call.tool, content: result.output });
        } catch (e) {
          const msg = `tool error: ${(e as Error).message}`;
          say(`  \x1b[31m✗ ${msg}\x1b[0m`);
          messages.push({ role: "tool", name: call.tool, content: msg });
          auditStore.audit("tool.error", { tool: call.tool, error: (e as Error).message }, sessionId);
        }
      }
    }

    sessionStore.endSession(sessionId, "stopped");
    auditStore.audit("session.max_steps", { steps: maxSteps }, sessionId);
    return { sessionId, finalMessage: finalMessage || "(stopped at step limit)", steps: stepIdx, stopped: "max_steps", meter: governor.meter() };
  } catch (e) {
    sessionStore.endSession(sessionId, "error");
    auditStore.audit("session.error", { error: (e as Error).message }, sessionId);
    say(`\x1b[31m✗ error: ${(e as Error).message}\x1b[0m`);
    return { sessionId, finalMessage: (e as Error).message, steps: stepIdx, stopped: "error", meter: governor.meter() };
  }
}
