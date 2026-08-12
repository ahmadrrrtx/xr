/**
 * XR 4.1 — Agent Step Adapter (Phase 2 · T1 revision)
 *
 * Records canonical execution records for every model call and tool invocation
 * that occurs during an agent session.
 *
 * ── What Phase 2 changed ────────────────────────────────────────────────────
 *
 * This adapter used to be a FOURTH direct caller of `runAgent`, and its own
 * comments admitted a gap it could not close:
 *
 *     "This leaves a known gap: native core tools invoked directly from
 *      runAgent are NOT double-wrapped in this first pass."
 *
 * The cause was structural: core tools came from a module-level array
 * (`toolsForMode`) that the adapter could not intercept, while plugin/MCP tools
 * arrived as `extraTools` that it could. With the single `ToolRegistryService`
 * (T2) every tool — core, plugin, MCP — arrives through ONE arbitrated
 * collection, so the adapter now wraps them uniformly and the gap is CLOSED.
 *
 * It also no longer calls the loop directly: it assembles an execution envelope
 * and runs it through `runEnvelope`, the single loop caller (T1).
 */
import type {
  ApprovalRequest,
  ChatOptions,
  Message,
  ModelTurn,
  Provider,
  Tool,
} from "../../core/types.ts";
import type { AgentDeps, AgentResult } from "../../core/agent.ts";
import { assembleEnvelope, newEvidence } from "../../core/execution/envelope.ts";
import { runEnvelope } from "../../core/execution/runner.ts";
import { ToolRegistryService } from "../../tools/registry-service.ts";
import { coreToolContributions } from "../../tools/registry.ts";
import type { ExecutionService } from "../service.ts";
import { executeTool } from "./tool-adapter.ts";
import type { ExecutionRecord } from "../types.ts";
import { IN_PROCESS_PLACEMENT, agentActor, okObservation, failObservation, safeJson, sizeBytes, redact } from "./common.ts";

export interface AgentFabricOptions {
  service: ExecutionService;
  workspaceId: string;
  /** Optional prefix added to session-related correlation ids. */
  sessionId?: string;
}

export interface AgentFabricResult extends AgentResult {
  /** Execution records created during the run (model calls + tool calls). */
  executions: ExecutionRecord[];
}

/**
 * Run an agent session while recording canonical execution records for every
 * provider.chat() turn and every tool invocation. Returns the existing
 * AgentResult shape (back-compat) plus the list of execution records.
 */
export async function runAgentWithFabric(
  task: string,
  mode: "agent" | "plan" | "ask",
  deps: AgentDeps,
  fabric: AgentFabricOptions,
): Promise<AgentFabricResult> {
  const executions: ExecutionRecord[] = [];
  const service = fabric.service;
  const workspaceId = fabric.workspaceId;

  // Wrap the provider so that every chat() call is recorded as a model_call execution.
  const wrappedProvider: Provider = {
    id: deps.provider.id,
    label: deps.provider.label,
    health: deps.provider.health.bind(deps.provider),
    // GAP-001 — the wrapper MUST forward chat options. Dropping them here
    // would silently strip the caller's cancellation signal and the request
    // timeout for every fabric-recorded run.
    chat: async (messages: Message[], tools: Tool[], chatOptions?: ChatOptions): Promise<ModelTurn> => {
      const inputSummary = redact(
        safeJson({ mode, messageCount: messages.length, toolCount: tools.length, task: task.slice(0, 200) }),
      );
      let turn: ModelTurn;
      const actor = agentActor("primary", deps.provider.id);
      const record = await service.execute({
        workspaceId,
        sessionId: fabric.sessionId,
        actor,
        intent: { summary: `model turn (${mode}) — ${task.slice(0, 120)}`, origin: actor },
        capability: { kind: "model_call", name: deps.provider.id },
        placement: IN_PROCESS_PLACEMENT,
        idempotency: "non_idempotent",
        inputSummary,
        inputBytes: sizeBytes(inputSummary),
        dryRun: !!deps.dryRun,
        maxAttempts: 1,
        checkBudget: deps.onOverBudget
          ? // We already run budget through runAgent's governor, so this check is a no-op here.
            async () => ({ allow: true })
          : undefined,
        audit: (event, detail) => deps.auditStore?.audit?.(event, detail, fabric.sessionId ?? null),
        run: async (ctx) => {
          turn = await deps.provider.chat(messages, tools, chatOptions);
          if (turn.usage) {
            ctx.recordUsage({
              inTokens: turn.usage.inTokens,
              outTokens: turn.usage.outTokens,
              provider: deps.provider.id,
              estimatedUsd: 0,
            });
          }
          ctx.addEvidence({ kind: "model_response", reference: deps.provider.id });
          // XR 4.4 — attach routing decision evidence (secret-free)
          if (deps.routingDecision) {
            ctx.addEvidence({
              kind: "audit_entry",
              reference: `routing:${deps.routingDecision.decisionId}`,
              meta: {
                providerId: deps.routingDecision.selected?.providerId,
                modelId: deps.routingDecision.selected?.modelId,
                mode: deps.routingDecision.mode,
                manual: deps.routingDecision.manual,
                explanation: deps.routingDecision.explanation,
              },
            });
          }
          return okObservation(
            turn.message?.slice(0, 1000) ?? (turn.done ? "(done)" : `(tool calls: ${turn.toolCalls.length})`),
            {
              modelFeedback: turn.message,
              meta: {
                toolCalls: turn.toolCalls.map((c) => c.tool),
                done: turn.done,
                routingDecisionId: deps.routingDecision?.decisionId,
              },
            },
          );
        },
      });
      executions.push(record);
      if (!turn!) {
        turn = { message: record.outcome?.message ?? "model call failed", toolCalls: [], done: true };
      }
      return turn!;
    },
  };

  /**
   * Wrap every tool so its invocation becomes a canonical execution record.
   * Because the registry is the single source of the tool set, this now covers
   * CORE tools too — the gap the pre-Phase-2 adapter documented and could not
   * close.
   */
  const wrapForFabric = (t: Tool): Tool => ({
    ...t,
    run: async (args, ctx) => {
      const res = await executeTool(t, args, {
        service,
        workspaceId,
        sessionId: fabric.sessionId,
        actor: agentActor("primary", deps.provider.id),
        cwd: ctx.cwd,
        dryRun: ctx.dryRun,
        approve: ctx.approve,
        audit: ctx.audit,
      });
      executions.push(res.__execution!);
      // Return the same ToolResult shape the agent expects.
      return { ok: res.ok, output: res.output, data: res.data };
    },
  });

  /**
   * Build the run's registry. When the caller already supplied one (the
   * in-tree path), its entries are re-registered wrapped; otherwise the core
   * set plus any deprecated `extraTools` are used, preserving back-compat for
   * out-of-tree callers.
   */
  const registry = new ToolRegistryService();
  if (deps.toolRegistry) {
    for (const kind of ["core", "plugin", "mcp"] as const) {
      const entries = deps.toolRegistry.listByKind(kind);
      if (entries.length === 0) continue;
      // Group by source so qualified ids are reproduced exactly.
      const bySource = new Map<string, Tool[]>();
      for (const e of entries) {
        const list = bySource.get(e.source) ?? [];
        list.push(wrapForFabric(e.tool));
        bySource.set(e.source, list);
      }
      for (const [source, tools] of bySource) {
        registry.registerTools({ kind, source, tools });
      }
    }
    for (const skill of deps.toolRegistry.listSkills()) {
      registry.registerSkill({
        kind: "skill",
        source: skill.source,
        prompt: skill.prompt,
        declaredTools: skill.declaredTools,
      });
    }
  } else {
    const core = coreToolContributions();
    registry.registerTools({ kind: "core", source: core.source, tools: core.tools.map(wrapForFabric) });
    if (deps.extraTools?.length) {
      registry.registerTools({
        kind: "plugin",
        source: "extra",
        tools: deps.extraTools.map(wrapForFabric),
      });
    }
  }

  const evidence = newEvidence();
  const envelope = assembleEnvelope({
    intent: { task, mode, surface: "workflow", cwd: deps.cwd },
    plan: {
      provider: wrappedProvider,
      providerId: deps.provider.id,
      modelId: deps.routingDecision?.selected?.modelId ?? "",
      maxSteps: deps.maxSteps ?? 12,
      ...(deps.systemPrompt ? { systemPrompt: deps.systemPrompt } : {}),
      ...(deps.routingDecision ? { routingDecision: deps.routingDecision } : {}),
    },
    policy: {
      budget: deps.budget ?? {},
      pricing: deps.pricing ?? { inPerMTok: 0, outPerMTok: 0 },
      egressAllowlist: deps.egressAllowlist ?? [],
      dryRun: deps.dryRun ?? false,
      ...(deps.tools?.allow ? { toolsAllow: deps.tools.allow } : {}),
      ...(deps.tools?.deny ? { toolsDeny: deps.tools.deny } : {}),
      approve: deps.approve,
    },
    placement: {
      placement: "in_process",
      registry,
      tools: registry.discover({
        mode,
        ...(deps.tools?.allow ? { allow: deps.tools.allow } : {}),
        ...(deps.tools?.deny ? { deny: deps.tools.deny } : {}),
      }),
      collisions: registry.listCollisions(),
    },
    observation: {
      say: deps.say,
      ...(deps.onOverBudget ? { onOverBudget: deps.onOverBudget } : {}),
    },
    evidence,
  });

  const outcome = await runEnvelope(
    envelope,
    {
      ...(deps.store ? { store: deps.store } : {}),
      ...(deps.sessionStore ? { sessionStore: deps.sessionStore } : {}),
      ...(deps.auditStore ? { auditStore: deps.auditStore } : {}),
      ...(deps.costStore ? { costStore: deps.costStore } : {}),
      ...(deps.userMemoryStore ? { userMemoryStore: deps.userMemoryStore } : {}),
    },
    {
      ...(deps.memory ? { memory: deps.memory } : {}),
      ...(deps.memoryStore ? { memoryStore: deps.memoryStore } : {}),
      ...(deps.sessionSummary ? { sessionSummary: deps.sessionSummary } : {}),
      ...(deps.contextPackage ? { contextPackage: deps.contextPackage } : {}),
      ...(deps.contextMode ? { contextMode: deps.contextMode } : {}),
    },
  );

  const result: AgentResult = {
    sessionId: outcome.sessionId,
    finalMessage: outcome.finalMessage,
    steps: outcome.steps,
    stopped: outcome.stopped,
    ...(outcome.meter !== undefined ? { meter: outcome.meter } : {}),
    ...(outcome.inputTokens !== undefined ? { inputTokens: outcome.inputTokens } : {}),
    ...(outcome.outputTokens !== undefined ? { outputTokens: outcome.outputTokens } : {}),
    ...(outcome.routingDecisionId !== undefined ? { routingDecisionId: outcome.routingDecisionId } : {}),
  };
  return { ...result, executions };
}
