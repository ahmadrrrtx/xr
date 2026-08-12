/**
 * XR — the agent loop: Observe → Think → Act, repeat until done.
 *
 * ── Phase 2 · T1: this is a LOOP, not an ENTRY POINT ────────────────────────
 *
 * `runAgentLoop` implements the ACTION phase of the canonical execution
 * envelope (src/core/execution/envelope.ts). The ONLY module permitted to call
 * it is src/core/execution/runner.ts; every surface reaches it through
 * `AgentService.execute()`. `test/core/no-bypass.test.ts` fails the build if
 * any other module imports it.
 *
 * The historical name `runAgent` is retained as a deprecated alias for
 * out-of-tree callers and is scheduled for removal in 8.0.0 (ADR-0002).
 */
import { randomUUID } from "node:crypto";
import type {
  ApprovalRequest,
  Message,
  Mode,
  Provider,
  Tool,
  ToolContext,
} from "./types.ts";
import { getTool, toolsForMode } from "../tools/registry.ts";
import { isCancellation } from "../providers/request-guard.ts";
import type { SessionRepo } from "../state/repos/session-repo.ts";
import type { AuditRepo } from "../state/repos/audit-repo.ts";
import type { CostRepo } from "../state/repos/cost-repo.ts";
import type { UserMemoryRepo } from "../state/repos/user-memory-repo.ts";
import type { WorkspaceStore as Store } from "../state/workspace-store.ts";
import { CostGovernor, type Budget, type Pricing } from "../cost/governor.ts";
import { BudgetManager } from "../cost/manager.ts";
import { compact } from "../context/memory/compact.ts";
import { MemoryStore, projectScopeFromCwd } from "../context/memory/store.ts";
import { buildMemoryBlock, buildContextMessages } from "../context/memory/inject.ts";
import type { ContextPackage, InjectionPackage } from "../context/types.ts";

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
   *
   * @deprecated Phase 2 · T2. Superseded by `toolRegistry`, which namespaces
   * contributions and arbitrates collisions instead of concatenating a flat
   * list whose bare names could shadow core tools. Still honoured for
   * out-of-tree callers; removed in 8.0.0 (ADR-0003).
   */
  extraTools?: Tool[];
  /**
   * Phase 2 · T2 — the single tool registry for this run. When supplied it is
   * the authority for both discovery and call resolution, and `extraTools` is
   * ignored. Supplied by the execution envelope on every in-tree path.
   */
  toolRegistry?: import("../tools/registry-service.ts").ToolRegistryService;
  /** Phase 2 · T1 — envelope identity, recorded on audit entries. */
  envelopeId?: string;
  /** Phase 2 · T1 — originating surface, recorded on audit entries. */
  surface?: string;
  /**
   * Phase 4 · T1 — the Trust service, wired UNCONDITIONALLY on every in-tree
   * path so high-risk tools (shell/code) execute inside an enforced
   * environment or fail closed. Absent only for deprecated out-of-tree
   * callers, whose tools then see `hardened` and act accordingly.
   */
  trust?: import("../runtime/trust/service.ts").TrustService;
  /**
   * Phase 4 · T1 — hardened mode flag (from config). When true, high-risk
   * tools refuse host-authority fallbacks. Defaults to true when unset.
   */
  hardened?: boolean;
  /**
   * Phase 4 · T4 — explicit raw-IP/loopback destinations (local runtimes).
   */
  allowedHosts?: readonly string[];
  /**
   * Phase 4 · T1 — run identity for escalate-only lattice bookkeeping.
   * Defaults to `envelopeId`. Shared by every tool call in this run so the
   * run's isolation can only escalate, never downgrade.
   */
  runId?: string;
  /**
   * Phase 7 · T1 — optional tool-use recorder forwarded into every
   * ToolContext. Wired by the execution envelope from the caller-provided
   * EnvelopeContext; provenance recording is best-effort by design.
   */
  onToolUse?: (info: { tool: string; ok: boolean; error?: string }) => void;
  /**
   * XR 4.4 — routing decision from the Universal Intelligence Plane.
   * Secret-free; safe to audit and attach to execution records.
   */
  routingDecision?: import("../intelligence/types.ts").RoutingDecision;
  /**
   * XR 4.5 — a pre-assembled, scope-filtered context package.
   *
   * When present, the agent injects THIS instead of the legacy memory block:
   * items arrive already authorized, tiered, trust-labelled, and explainable,
   * and untrusted content is delimited in a non-instruction channel.
   *
   * When absent, the agent falls back to the 4.4 recall path unchanged, so
   * `injectionMode: "legacy"` and every older call-site keep working (§10.2).
   */
  contextPackage?: ContextPackage;
  /**
   * XR 4.5 — injection mode. Defaults to "legacy" when no package is supplied
   * so behavior never changes implicitly.
   */
  contextMode?: "legacy" | "context" | "both";
  /** XR 4.5 — receives the rendered injection for inspection/audit surfaces. */
  onContextInjected?(injection: InjectionPackage): void;
  /**
   * XR 7.1.0-RC (audit A-19) — cooperative cancellation.
   *
   * Wired by the execution envelope from the caller-provided signal. The loop
   * checks it at well-defined checkpoints: the top of every step, after a
   * model turn resolves (before its tool calls execute — a cancelled run must
   * not perform new side effects), and between tool calls. A signal raised
   * mid-`provider.chat` takes effect at the next checkpoint; JS cannot
   * universally force-interrupt an in-flight turn, and XR does not fake it —
   * the session ends honestly as `stopped: "cancelled"` once the turn
   * resolves or the next step begins.
   */
  signal?: AbortSignal;
}

export interface AgentResult {
  sessionId: string;
  finalMessage: string;
  steps: number;
  stopped: "done" | "max_steps" | "error" | "budget" | "approval" | "cancelled";
  /** Optional token counters for richer UIs when a caller/provider supplies them. */
  inputTokens?: number;
  outputTokens?: number;
  /** Final cost meter string. */
  meter?: string;
  /** XR 4.4 — routing decision id when intelligence plane selected the model. */
  routingDecisionId?: string;
}
export async function runAgentLoop(
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

  /**
   * Phase 2 · T2 — tool discovery.
   *
   * With a registry (every in-tree path), discovery and call resolution share
   * ONE arbitrated view: a contested bare name is advertised under its
   * qualified id and resolves to exactly one entry, or to nothing. Without a
   * registry (deprecated out-of-tree callers passing `extraTools`), the
   * pre-Phase-2 behaviour is preserved verbatim so nothing breaks.
   */
  const registry = deps.toolRegistry;
  const filteredAllow = deps.tools?.allow ? new Set(deps.tools.allow) : null;
  const filteredDeny = deps.tools?.deny ? new Set(deps.tools.deny) : null;

  let tools: Tool[];
  let resolveTool: (name: string) => Tool | undefined;

  if (registry) {
    tools = registry.discover({
      mode,
      ...(deps.tools?.allow ? { allow: deps.tools.allow } : {}),
      ...(deps.tools?.deny ? { deny: deps.tools.deny } : {}),
    });
    const offered = new Set(tools.map((t) => t.name));
    resolveTool = (name: string) => {
      // Only a name actually offered for this mode may resolve — a shadowed or
      // out-of-mode entry is never reachable, even by qualified id.
      if (!offered.has(name)) return undefined;
      const entry = registry.resolve(name);
      return entry ? entry.tool : tools.find((t) => t.name === name);
    };
  } else {
    const coreTools: Tool[] = toolsForMode(mode);
    const extraTools: Tool[] = mode === "agent" ? deps.extraTools ?? [] : [];
    tools = [...coreTools, ...extraTools].filter((tool) => {
      if (filteredAllow && !filteredAllow.has(tool.name)) return false;
      if (filteredDeny && filteredDeny.has(tool.name)) return false;
      return true;
    });
    const extraToolMap = new Map(extraTools.map((t) => [t.name, t]));
    resolveTool = (name: string) => getTool(name) ?? extraToolMap.get(name);
  }
  /**
   * Phase 4 · T1 — every tool on the canonical path sees the Trust service, so
   * a high-risk tool can demand an enforced environment. The run's identity
   * (`runId`) feeds the escalate-only lattice: isolation can only go up
   * within a run, never down. When no Trust service is wired (deprecated
   * out-of-tree callers), `hardened` still governs whether tools may fall
   * back to host authority at all.
   */
  const runId = deps.runId ?? deps.envelopeId ?? sessionId;
  const hardened = deps.hardened ?? true;
  const toolCtx: ToolContext = {
    cwd,
    approve: deps.approve,
    audit: (event: string, detail: Record<string, unknown>) =>
      auditStore.audit(event, detail, sessionId),
    egressAllowlist: deps.egressAllowlist ?? [],
    allowedHosts: deps.allowedHosts ?? [],
    dryRun: deps.dryRun ?? false,
    hardened,
    ...(deps.onToolUse ? { onToolUse: deps.onToolUse } : {}),
    ...(deps.trust
      ? {
          runIsolated: async (req, exec) => {
            const ev = await deps.trust!.evaluate({
              request: req,
              runId,
              correlationId: runId,
              workspaceId: cwd,
              actor: "agent-loop",
              capability: `${req.capability.kind}:${req.capability.name}`,
              executable: exec,
            });
            if (ev.outcome.kind === "blocked") {
              return {
                ok: false,
                exitCode: null,
                stdout: "",
                stderr: ev.outcome.reason ?? "blocked",
                timedOut: false,
                blocked: true,
                reason: ev.outcome.reason,
                remediation: ev.outcome.remediation,
              };
            }
            if (ev.outcome.kind === "in_process_ok") {
              return {
                ok: false,
                exitCode: null,
                stdout: "",
                stderr: "high-risk action refused: trust gate returned in-process (placement not enforced)",
                timedOut: false,
                blocked: true,
                reason: "high-risk action refused: trust gate returned in-process (placement not enforced)",
              };
            }
            const o = ev.outcome.observation;
            return {
              ok: o.transportOk,
              exitCode: typeof o.statusCode === "number" ? o.statusCode : null,
              stdout: String(o.meta?.stdout ?? ""),
              stderr: (o.logs ?? []).join("\n"),
              timedOut: Boolean(o.meta?.timedOut),
              blocked: false,
              placement: typeof o.meta?.placement === "string" ? o.meta.placement : undefined,
              verified: ev.trust.verification?.verified ?? false,
            };
          },
        }
      : {}),
  };

  const messages: Message[] = [];

  // ── XR 4.5 — context injection ────────────────────────────────────────
  //
  // Two paths, chosen explicitly (never implicitly):
  //   • context package supplied → typed, channel-separated injection
  //   • otherwise                → the unchanged 4.4 memory block
  //
  // The context path is strictly safer: items are already scope-authorized,
  // trust-labelled, and split across instruction / data / quarantine channels,
  // so a retrieved item cannot occupy the instruction channel.
  const contextMode = deps.contextMode ?? (deps.contextPackage ? "context" : "legacy");
  let injectedContext = false;

  if (deps.contextPackage && contextMode !== "legacy") {
    try {
      const { messages: ctxMessages, injection } = buildContextMessages(deps.contextPackage, {
        workspaceRoot: cwd,
      });
      for (const m of ctxMessages) messages.push({ role: m.role, content: m.content });
      injectedContext = ctxMessages.length > 0;
      deps.onContextInjected?.(injection);

      auditStore.audit(
        "context.inject",
        {
          packageId: deps.contextPackage.packageId,
          packageVersion: deps.contextPackage.version,
          contentHash: deps.contextPackage.contentHash,
          items: injection.allItemIds.length,
          chars: injection.totalChars,
          // Channel counts prove the authority separation held.
          channels: injection.blocks.map((b) => ({
            channel: b.channel,
            tier: b.tier,
            role: b.role,
            items: b.itemIds.length,
          })),
          degraded: deps.contextPackage.degraded,
          degradedReasons: deps.contextPackage.degradedReasons,
          revalidated: deps.contextPackage.revalidation?.note,
        },
        sessionId,
      );
    } catch {
      /* best-effort: context injection must never break a run */
    }
  }

  // Legacy path — runs when no package was supplied, or in "both" mode.
  if (deps.memory?.enabled && (!injectedContext || contextMode === "both")) {
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
            mode: contextMode,
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

  /**
   * A-19 — cooperative cancellation. Checkpoints sit where the loop can stop
   * cleanly WITHOUT faking outcomes: before a step starts, after a model turn
   * resolves (before its tool calls run), and between tool calls. The
   * session/audit record says exactly what happened — interrupted by the
   * caller, at this step.
   */
  const isCancelled = (): boolean => deps.signal?.aborted === true;
  const cancelledResult = (steps: number): AgentResult => {
    say(`\x1b[33m⏸ cancelled — interrupted at your request\x1b[0m`);
    sessionStore.endSession(sessionId, "stopped");
    auditStore.audit("session.cancelled", { steps, snapshot: governor.snapshot() }, sessionId);
    return {
      sessionId,
      finalMessage: finalMessage || "Interrupted at your request.",
      steps,
      stopped: "cancelled",
      meter: governor.meter(),
      routingDecisionId: deps.routingDecision?.decisionId,
    };
  };

  try {
    for (; stepIdx < maxSteps; stepIdx++) {
      if (isCancelled()) return cancelledResult(stepIdx);

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
            routingDecisionId: deps.routingDecision?.decisionId,
          };
        }
        governor.raise(extra);
        auditStore.audit("budget.raised", { extra }, sessionId);
      }

      say(`\x1b[2m▸ think  (step ${stepIdx + 1}/${maxSteps}) · ${provider.label} · ${governor.meter()}\x1b[0m`);
      const compacted = compact(messages, { maxChars: 16000, keepRecent: 6 });
      // GAP-001 — hand the caller's cancellation token to the transport itself.
      // Loop checkpoints alone could not interrupt an in-flight model call, so
      // a stalled provider was unrecoverable (reproduced live: Ctrl+C printed
      // "stopping at the next step" and then hung until the process was
      // killed). The provider now also applies a bounded default timeout.
      const turn = await provider.chat(compacted, tools, { signal: deps.signal });
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

      // A-19 — an abort that landed while the model turn was in flight takes
      // effect HERE, before any of its tool calls run.
      if (isCancelled()) return cancelledResult(stepIdx + 1);

      if (turn.done && turn.toolCalls.length === 0) {
        finalMessage = turn.message;
        // Stage 6 — optionally fold the conversation into a session summary.
        maybeSaveSessionSummary();
        sessionStore.endSession(sessionId, "done");
        auditStore.audit("session.done", { steps: stepIdx + 1, snapshot: governor.snapshot() }, sessionId);
        return {
          sessionId,
          finalMessage,
          steps: stepIdx + 1,
          stopped: "done",
          meter: governor.meter(),
          routingDecisionId: deps.routingDecision?.decisionId,
        };
      }

      for (const call of turn.toolCalls) {
        // A-19 — between tool calls: a mid-batch abort skips the rest.
        if (isCancelled()) return cancelledResult(stepIdx + 1);

        const tool = resolveTool(call.tool);
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
          toolCtx.onToolUse?.({ tool: call.tool, ok: result.ok });
        } catch (e) {
          const msg = `tool error: ${(e as Error).message}`;
          say(`  \x1b[31m✗ ${msg}\x1b[0m`);
          messages.push({ role: "tool", name: call.tool, content: msg });
          auditStore.audit("tool.error", { tool: call.tool, error: (e as Error).message }, sessionId);
          toolCtx.onToolUse?.({ tool: call.tool, ok: false, error: (e as Error).message });
        }
      }
    }

    sessionStore.endSession(sessionId, "stopped");
    auditStore.audit("session.max_steps", { steps: maxSteps }, sessionId);
    return {
      sessionId,
      finalMessage: finalMessage || "(stopped at step limit)",
      steps: stepIdx,
      stopped: "max_steps",
      meter: governor.meter(),
      routingDecisionId: deps.routingDecision?.decisionId,
    };
  } catch (e) {
    // GAP-001 — a run the USER cancelled must end `cancelled`, not `error`.
    // Now that the caller's signal reaches the transport, an in-flight model
    // call can reject with ProviderAbortError; reporting that as a generic
    // error would be exactly the fake/false outcome XR forbids (the loop's own
    // contract is success | failed | cancelled, honestly stamped).
    if (isCancellation(e)) return cancelledResult(stepIdx);
    sessionStore.endSession(sessionId, "error");
    auditStore.audit("session.error", { error: (e as Error).message }, sessionId);
    say(`\x1b[31m✗ error: ${(e as Error).message}\x1b[0m`);
    return {
      sessionId,
      finalMessage: (e as Error).message,
      steps: stepIdx,
      stopped: "error",
      meter: governor.meter(),
      routingDecisionId: deps.routingDecision?.decisionId,
    };
  }
}

/**
 * @deprecated Phase 2 · T1 — use `AgentService.execute()` / the execution
 * envelope. Retained ONLY as a compatibility alias for out-of-tree callers and
 * for the pre-existing unit tests that exercise the loop in isolation.
 *
 * In-tree surfaces MUST NOT call this: `test/core/no-bypass.test.ts` asserts
 * that no production module outside `src/core/execution/` imports the loop.
 *
 * Removal: 8.0.0 (ADR-0002).
 */
export const runAgent = runAgentLoop;
