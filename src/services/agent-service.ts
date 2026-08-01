/**
 * XR — Agent Service: THE SOLE ENTRY POINT for agent execution.
 *
 * Phase 2 · T1. Constitution Art. VI.3 ("one execution envelope") and Art. VI
 * Violations ("a surface calling `runAgent` directly, bypassing the service").
 *
 * Two entry shapes, one path:
 *
 *   · `execute(request)`  — the canonical envelope entry. Every surface
 *     (CLI, Shell, Telegram, Voice, daemon) calls this.
 *   · `runTask` / `runScopedTask` — the pre-Phase-2 signatures, retained as a
 *     stable compatibility surface (Art. XXVII: no stable surface broken
 *     without a deprecation cycle). They now DELEGATE to `execute()`, so there
 *     is exactly one code path, not two.
 */

import { ServiceRegistry } from "../core/service-registry.ts";
import { LifecycleHook } from "../core/lifecycle.ts";
import { Tokens } from "../core/tokens.ts";
import type { AgentResult } from "../core/agent.ts";
import {
  assembleEnvelope,
  newEvidence,
  type EnvelopeOutcome,
  type SurfaceId,
} from "../core/execution/envelope.ts";
import { runEnvelope, type EnvelopeContext, type EnvelopeStores } from "../core/execution/runner.ts";
import { buildToolRegistry } from "../tools/registry-builder.ts";
import { ProviderService } from "./provider-service.ts";
import { BudgetService } from "./budget-service.ts";
import { ConfigService } from "./config-service.ts";
import { PluginService } from "./plugin-service.ts";
import { McpService } from "./mcp-service.ts";
import { SkillService } from "./skill-service.ts";
import { SessionRepo } from "../state/repos/session-repo.ts";
import { UserMemoryRepo } from "../state/repos/user-memory-repo.ts";
import { CostRepo } from "../state/repos/cost-repo.ts";
import { WorkspaceStore } from "../state/workspace-store.ts";
import { MemoryStore } from "../context/memory/store.ts";
import { priceFor } from "../cost/pricing.ts";
import type { ApprovalRequest, Mode, Provider } from "../core/types.ts";

/**
 * Overrides accepted by both runTask and runScopedTask. runTask is a thin
 * passthrough to runScopedTask, so it must accept the full override surface —
 * declaring a narrower type dropped options (say/approve/systemPrompt/…) that
 * the runtime forwards and honors.
 */
export interface AgentRunOverrides {
  provider?: string;
  model?: string;
  budget?: number;
  maxTokens?: number;
  maxSteps?: number;
  dryRun?: boolean;
  json?: boolean;
  systemPrompt?: string;
  toolsAllow?: string[];
  toolsDeny?: string[];
  say?: (line: string) => void;
  approve?: (req: ApprovalRequest) => Promise<boolean>;
  memoryEnabled?: boolean;
  /**
   * XR 4.4 — optional task requirements for the intelligence plane.
   * Explicit provider/model pins still win.
   */
  requirements?: Partial<import("../intelligence/types.ts").TaskRequirements>;
  /** XR 4.4 — force a routing mode for this run. */
  routingMode?: import("../intelligence/types.ts").RoutingMode;

  // ── XR 4.5 — Knowledge and Context OS scoping ──────────────────────────
  /** Agent role name, recorded on the context grant for audit. */
  agentRole?: string;
  /**
   * Declared memory-scope kind (`none|workflow|project|research|user`) from
   * `src/agents/types.ts`. Phase 6 ENFORCES this at retrieval time rather than
   * treating it as documentation. Defaults to "user" for the primary agent.
   */
  memoryScopeKind?: string;
  /** Bind the context grant to a specific task; task-scoped items follow it. */
  taskId?: string;
  /** Durable run id, so the assembled package can be checkpointed. */
  runId?: string;
  /**
   * Phase 2 · T1 — which surface originated this run. Recorded on the envelope
   * and on every audit entry, so "which surface did this?" is answerable from
   * the audit log alone. Defaults to "cli".
   */
  surface?: SurfaceId;
}

/** Phase 2 · T1 — the canonical execution request. */
export interface ExecuteRequest extends AgentRunOverrides {
  readonly task: string;
  readonly mode: Mode;
}

export class AgentService implements LifecycleHook {
  private registry: ServiceRegistry;

  constructor(registry: ServiceRegistry) {
    this.registry = registry;
  }

  /**
   * Execute a task using the agent loop.
   *
   * Compatibility surface — delegates to `execute()`. Kept because the CLI,
   * daemon and several tests call it by this name (Art. XXVII).
   */
  async runTask(
    task: string,
    mode: Mode,
    overrides: AgentRunOverrides = {},
  ): Promise<AgentResult> {
    return this.runScopedTask(task, mode, overrides);
  }

  /** Compatibility surface — delegates to `execute()`. */
  async runScopedTask(
    task: string,
    mode: Mode,
    overrides: AgentRunOverrides = {},
  ): Promise<AgentResult> {
    return this.execute({ ...overrides, task, mode });
  }

  /**
   * THE canonical entry point (Phase 2 · T1).
   *
   * Assembles the eight-phase execution envelope and runs it. Every surface
   * reaches agent execution through here; nothing else may call the loop.
   */
  async execute(request: ExecuteRequest): Promise<EnvelopeOutcome> {
    const { task, mode, ...overrides } = request;
    const configService = this.registry.resolve(Tokens.Config);
    const providerService = this.registry.resolve(Tokens.Providers);
    const budgetService = this.registry.resolve(Tokens.Budget);
    const pluginService = this.registry.resolve(Tokens.Plugins);
    const mcpService = this.registry.resolve(Tokens.Mcp);
    let skillService: SkillService | undefined;
    skillService = this.registry.tryResolve(Tokens.Skills);
    const sessionStore = this.registry.resolve(Tokens.SessionStore);
    const memoryStore = this.registry.resolve(Tokens.UserMemoryStore);
    const costStore = this.registry.resolve(Tokens.CostStore);

    const config = configService.get();

    // Stage 6 — the canonical memory engine, backed by the same WorkspaceStore the rest
    // of the system uses, so CLI / TUI / voice / dashboard / agent all share ONE
    // memory. (The legacy UserMemoryRepo stays registered for backward compat.)
    /** 0.2 Storage Unification: Resolve the single workspace store. */
    const unifiedStore = this.registry.resolve(Tokens.Store);
    const engine = new MemoryStore(unifiedStore);

    // XR 4.4 — capability-aware routing; explicit provider/model pins preserved.
    const agentReqs = {
      modelClass: "chat" as const,
      require: { toolUse: true },
      summary: task.slice(0, 120),
      ...(overrides.requirements ?? {}),
    };
    const provider = providerService.getProvider({
      provider: overrides.provider,
      model: overrides.model,
      requirements: agentReqs,
      mode: overrides.routingMode,
    });
    const routingDecision =
      typeof (providerService as any).getLastDecision === "function"
        ? (providerService as any).getLastDecision()
        : null;

    // Determine pricing for this provider
    const selectedModel =
      routingDecision?.selected?.modelId ??
      overrides.model ??
      config.defaults.model;
    const pricing = priceFor(provider.id, selectedModel);

    const budget = {
      maxUsd: overrides.budget ?? config.budget.perTaskUsd,
      maxTokens: overrides.maxTokens ?? config.budget.perTaskTokens,
    };

    await pluginService.ensureLoaded();
    await mcpService.ensureLoaded();

    const { confirm } = await import("../interfaces/cli.ts");

    /**
     * Phase 2 · T2 — PLACEMENT: build the ONE tool registry from the already
     * loaded hosts. Passing the hosts (rather than letting the builder
     * construct managers) means the kernel path reuses the services it already
     * booted — no second plugin load, no second MCP handshake, no second DB
     * connection.
     */
    const { registry: toolRegistry, diagnostics } = await buildToolRegistry({
      store: this.registry.resolve(Tokens.Store),
      task,
      hosts: {
        pluginTools: () => pluginService.getPluginTools(),
        mcpTools: () => mcpService.getMcpTools(),
        skillContext: () => {
          try {
            return skillService?.executionContext(task, 4);
          } catch {
            // Skills are best-effort; the degradation is reported as a
            // diagnostic by the builder rather than failing the run.
            return undefined;
          }
        },
      },
    });

    const scopedSystemPrompt = [toolRegistry.skillPrompt(), overrides.systemPrompt]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join("\n\n");

    const stores: EnvelopeStores = {
      sessionStore,
      auditStore: this.registry.resolve(Tokens.AuditStore),
      costStore,
      userMemoryStore: memoryStore,
    };

    const envelopeContext: EnvelopeContext = {
      memory: {
        enabled: overrides.memoryEnabled ?? (config.memory.enabled && config.memory.injectInChat),
        recallLimit: config.memory.recallLimit,
        semantic: config.memory.semanticRecall,
      },
      memoryStore: engine,
      // XR 4.5 — upgraded to "context" below when the knowledge layer is enabled.
      contextMode: "legacy",
      sessionSummary: {
        enabled: config.memory.enabled && config.memory.saveSessionSummaries,
        minTurns: config.memory.sessionSummaryMinTurns,
      },
      /**
       * Phase 4 · T1 — placement ENFORCEMENT on the canonical path: the run's
       * tool contexts get the Trust service (so high-risk tools isolate or
       * fail closed) and the envelope outcome records the strongest placement
       * actually enforced. The Trust token is always registered by the
       * composition root; tryResolve keeps out-of-tree callers working.
       */
      trust: this.registry.tryResolve(Tokens.Trust),
      hardened: config.security.hardened,
      allowedHosts: config.security.allowedHosts,
    };

    // ── XR 4.5 — assemble a scope-filtered context package ──────────────
    //
    // The package replaces the legacy memory block when the knowledge layer is
    // enabled. Assembly is best-effort: a failure degrades to the 4.4 path
    // rather than failing the run, and the degradation is recorded.
    const memoryOn = overrides.memoryEnabled ?? (config.memory.enabled && config.memory.injectInChat);
    if (config.knowledge?.enabled && config.memory.enabled) {
      try {
        const contextSvc = this.registry.tryResolve(Tokens.Context);
        if (contextSvc) {
          const pkg = await contextSvc.requestContext(
            {
              requester: { kind: "agent", id: "primary", role: overrides.agentRole ?? "agent" },
              intent: task.slice(0, 200),
              query: task,
              cwd: process.cwd(),
              ...(overrides.taskId ? { taskId: overrides.taskId } : {}),
              // The primary agent acts directly for the user, so it may see
              // long-term memory — subject to the same authorization gate.
              memoryScopeKind: overrides.memoryScopeKind ?? "user",
              includeUserMemory: memoryOn,
              maxItems: config.knowledge.maxPackageItems,
              maxChars: config.knowledge.maxPackageChars,
              lexicalOnly: config.knowledge.lexicalOnly,
              ...(overrides.runId ? { runId: overrides.runId } : {}),
            },
            { memoryEnabled: memoryOn, memoryStore: engine },
          );
          (envelopeContext as { contextPackage?: unknown }).contextPackage = pkg;
          (envelopeContext as { contextMode?: string }).contextMode = config.knowledge.injectionMode;
        }
      } catch (err) {
        // Context assembly is best-effort — the legacy path still applies.
        // Recorded rather than swallowed (Art. IV: no empty catch).
        diagnostics.push(
          `context assembly degraded: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Best-effort audit of routing (secret-free)
    try {
      const audit = this.registry.resolve(Tokens.AuditStore);
      if (routingDecision) {
        audit.audit(
          "intelligence.route",
          {
            decisionId: routingDecision.decisionId,
            providerId: routingDecision.selected?.providerId,
            modelId: routingDecision.selected?.modelId,
            mode: routingDecision.mode,
            manual: routingDecision.manual,
            explanation: routingDecision.explanation,
            localityPolicy: routingDecision.constraints?.localityPolicy,
          },
          null,
        );
      }
    } catch (err) {
      diagnostics.push(
        `routing audit degraded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ── Assemble and run the canonical envelope ─────────────────────────────
    const surface: SurfaceId = overrides.surface ?? "cli";
    const evidence = newEvidence(diagnostics);

    /**
     * Phase 2 · T2 — collision transparency. If the registry had to arbitrate
     * a bare name (a plugin/MCP tool claiming a core tool's name), that is a
     * security-relevant event: it is audited, not hidden.
     */
    const collisions = toolRegistry.listCollisions();
    if (collisions.length > 0) {
      try {
        this.registry.resolve(Tokens.AuditStore).audit(
          "tools.collision",
          { envelopeId: evidence.envelopeId, surface, collisions },
          null,
        );
      } catch (err) {
        diagnostics.push(
          `collision audit degraded: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const envelope = assembleEnvelope({
      intent: {
        task,
        mode,
        surface,
        cwd: process.cwd(),
        ...(overrides.agentRole ? { agentRole: overrides.agentRole } : {}),
        ...(overrides.taskId ? { taskId: overrides.taskId } : {}),
        ...(overrides.runId ? { runId: overrides.runId } : {}),
      },
      plan: {
        provider,
        providerId: provider.id,
        modelId: selectedModel,
        maxSteps: overrides.maxSteps ?? 12,
        ...(scopedSystemPrompt ? { systemPrompt: scopedSystemPrompt } : {}),
        ...(routingDecision ? { routingDecision } : {}),
      },
      policy: {
        budget,
        pricing,
        egressAllowlist: config.security.egressAllowlist,
        dryRun: overrides.dryRun ?? false,
        ...(overrides.toolsAllow ? { toolsAllow: overrides.toolsAllow } : {}),
        ...(overrides.toolsDeny ? { toolsDeny: overrides.toolsDeny } : {}),
        approve:
          overrides.approve ??
          (async (req) => {
            const preview = req.preview ? `\n${req.preview}` : "";
            return await confirm(`Approve ${req.tool}? ${req.reason}${preview}`, false);
          }),
      },
      placement: {
        // Phase 2 records placement; risk-tiered isolation is Phase 4 and is
        // NOT claimed here.
        placement: "in_process",
        registry: toolRegistry,
        tools: toolRegistry.discover({
          mode,
          ...(overrides.toolsAllow ? { allow: overrides.toolsAllow } : {}),
          ...(overrides.toolsDeny ? { deny: overrides.toolsDeny } : {}),
        }),
        collisions,
      },
      observation: {
        say: overrides.say ?? ((line: string) => console.log(line)),
        onOverBudget: async () => null, // Default to stop.
      },
      evidence,
    });

    return await runEnvelope(envelope, stores, envelopeContext);
  }

  async onInit(): Promise<void> {}
  async onStart(): Promise<void> {}
  async onStop(): Promise<void> {}
}
