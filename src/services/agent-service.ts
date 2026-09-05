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
import { buildMemoryTools } from "../context/tools.ts";
import { projectScopeFromCwd } from "../context/memory/store.ts";
import { buildRepoCandidates, createRepoIntelligence, isRepoIntelligenceEnabled } from "../repo/index.ts";
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
import { makeApprover } from "../control/approval-store.ts";
import { PartitionRepo } from "../state/repos/partition-repo.ts";
import { CheckpointRepo } from "../state/repos/checkpoint-repo.ts";
import { renderPreviewText } from "../control/preview.ts";

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
  /**
   * Phase 05 — canonical streaming event sink, forwarded through the envelope
   * to the loop. Receives token / tool_call / tool_result / status / usage /
   * done / error events as generation progresses.
   */
  onStreamEvent?: import("../core/types.ts").StreamEventSink;
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
  /**
   * A-19 — cooperative cancellation. The surface's own abort handle for THIS
   * run; forwarded through the envelope to the loop's checkpoints. A run
   * cancelled this way ends honestly as `stopped: "cancelled"`.
   */
  signal?: AbortSignal;

  // ── Phase 6 — orchestration plane options ────────────────────────────────

  /**
   * Phase 6 · Step 2 — a Governor CHILD ENVELOPE: this run must spend inside
   * the partition (task, child). When present, the run's budget/token ceilings
   * come from the LEDGER row — `budget`/`maxTokens` below become compat
   * aliases honored only when no ledger is wired (one release, deprecated).
   */
  envelope?: { taskId: string; childId: string };
  /**
   * Phase 6 · Step 6 — resume a plain run from its last durable checkpoint.
   * The id is the crashed run's session/task id (`xr run …` prints it;
   * `xr run --resume <id>` re-enters the loop at the next step). Re-asking the
   * model from the checkpoint is the DOCUMENTED resume semantics — XR does
   * not journal provider traffic for bit-exact replay.
   */
  resume?: string;
  /** Phase 6 · Step 3 — attribution identity carried by this run. */
  agentIdentity?: import("../agents/identity.ts").AgentIdentity;
  /** Phase 6 · Step 1 — durable task journal for THIS run (plain runs). */
  taskJournal?: {
    checkpointSink: (kind: string, payload: Record<string, unknown>) => void;
    taskLedger: import("../execution/task-runtime.ts").TaskRunLedger;
  };
}

/** Phase 6 · Step 6 — consumed-meter shape carried by a resume checkpoint. */
type ResumeFromConsumed = { inTokens: number; outTokens: number; usd: number };

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

    // ── Phase 6 · Step 2 — resolve the Governor child envelope ────────────
    // A partitioned worker runs on LEDGER caps. `req.budget` is not consulted
    // on this path — which is exactly what kills the F-12 N× multiplier: the
    // request's ceiling funds the ROOT, the root partitions bound the tree.
    let partitionRef: import("../cost/governor.ts").PartitionRef | undefined;
    let envelopeBudget: { maxUsd?: number; maxTokens?: number } | undefined;
    if (overrides.envelope) {
      const ledger = new PartitionRepo(this.registry.resolve(Tokens.Store));
      const rows = ledger.listPartitions(overrides.envelope.taskId);
      const child = rows.find((r) => r.childId === overrides.envelope!.childId);
      if (!child) {
        // Fail closed: an unfunded envelope is a DENIED delegation, never an
        // unbounded run and never a silent fall back to the root budget.
        throw new Error(
          `envelope ${overrides.envelope.taskId}/${overrides.envelope.childId} has no funded partition — delegation refused`,
        );
      }
      if (child.status === "closed") {
        throw new Error(`partition ${overrides.envelope.taskId}/${overrides.envelope.childId} is closed`);
      }
      partitionRef = { ledger, taskId: overrides.envelope.taskId, childId: overrides.envelope.childId };
      envelopeBudget = {
        maxUsd: child.capUsd > 0 ? child.capUsd : undefined,
        maxTokens: child.capTokens > 0 ? child.capTokens : undefined,
      };
    }

    // ── Phase 6 · Step 6 — resume from the durable checkpoint ──────────────
    const runSessionId = overrides.resume ?? `s_${Math.random().toString(36).slice(2, 10)}`;
    let resumeFrom: import("../core/agent.ts").ResumeFrom | undefined;
    if (overrides.resume) {
      const ckpt = new CheckpointRepo(this.registry.resolve(Tokens.Store));
      const chain = ckpt.verifyChain(overrides.resume);
      if (!chain.ok) {
        throw new Error(`resume refused: checkpoint chain for ${overrides.resume} is broken at seq ${chain.brokenAtSeq} (${chain.reason})`);
      }
      // latest run.step checkpoint
      const rows = ckpt.list(overrides.resume).filter((r) => r.kind === "run.step");
      const last = rows[rows.length - 1];
      if (!last) {
        throw new Error(
          `resume refused: no checkpoint for task ${overrides.resume}. ` +
            "Only runs started after Phase 6 (plain-run checkpointing) are resumable; older sessions are documented unresumable.",
        );
      }
      const p = last.payload as Record<string, unknown>;
      if (p.truncated === true || !Array.isArray(p.messages)) {
        throw new Error(`resume refused: checkpoint #${last.seq} for ${overrides.resume} is a truncation envelope without a rebuildable transcript`);
      }
      const consumed = (p.consumed ?? { inTokens: 0, outTokens: 0, usd: 0 }) as ResumeFromConsumed;
      resumeFrom = {
        messages: p.messages as import("../core/types.ts").Message[],
        stepIdx: Number(p.stepIdx ?? 0),
        toolCallSeq: Number(p.toolCallSeq ?? 0),
        consumed,
        droppedMessages: Number(p.droppedMessages ?? 0),
      };
      this.registry.resolve(Tokens.AuditStore).audit("task.resumed", {
        taskId: overrides.resume,
        fromSeq: last.seq,
        stepIdx: resumeFrom.stepIdx,
        droppedMessages: resumeFrom.droppedMessages,
      }, overrides.resume);
    }

    // ── Phase 6 · Step 1 — plain runs as 1-node tasks ──────────────────────
    // When checkpointing is on, every plain run journals transitions + step
    // snapshots and (for new runs) mints a root identity. The loop fires the
    // lifecycle edges through `taskLedger`; `plan` is fired here.
    let journal: {
      checkpointSink: (kind: string, payload: Record<string, unknown>) => void;
      taskLedger: import("../execution/task-runtime.ts").TaskRunLedger;
    } | undefined;
    if (config.orchestration?.checkpointPlainRuns && !partitionRef) {
      const ckpt = new CheckpointRepo(this.registry.resolve(Tokens.Store));
      const audit = this.registry.resolve(Tokens.AuditStore);
      const { TaskRunLedger } = await import("../execution/task-runtime.ts");
      const ledger = new TaskRunLedger(runSessionId, resumeFrom ? "recovering" : "created", {
        onTransition: (rec) => {
          audit.audit("task.transition", { taskId: runSessionId, from: rec.from, to: rec.to, event: rec.event }, runSessionId);
        },
        onCheckpoint: (kind, payload) => {
          const res = ckpt.append(runSessionId, kind, payload);
          if (res) audit.audit("task.checkpointed", { taskId: runSessionId, kind, seq: res.seq }, runSessionId);
        },
      });
      if (!resumeFrom) ledger.fire("plan", { mode: request.mode });
      journal = {
        checkpointSink: (kind, payload) => {
          const res = ckpt.append(runSessionId, kind, payload);
          if (res) audit.audit("task.checkpointed", { taskId: runSessionId, kind, seq: res.seq }, runSessionId);
        },
        taskLedger: ledger,
      };
    }
    let runIdentity = overrides.agentIdentity;
    if (!partitionRef && !runIdentity && journal) {
      // Root identity for a plain run (depth 0): the SAME identity object
      // workers carry, one level up — attribution is uniform across the tree.
      try {
        const { mintIdentity } = await import("../agents/identity.ts");
        const mint = mintIdentity({
          role: "primary",
          parentId: "user",
          taskId: runSessionId,
          grantRef: `budget:config:perTask`,
          parentDepth: -1,
        });
        if (mint.allowed) {
          runIdentity = mint.identity;
          this.registry.resolve(Tokens.AuditStore).audit(
            "agent.minted",
            { ...mint.identity, surface: overrides.surface ?? "cli" },
            runSessionId,
          );
        }
      } catch {
        /* identity is attribution, not authority — a mint failure never blocks a run */
      }
    }



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

    const budget = envelopeBudget ?? {
      // Compat aliases (one release): on the partitioned path these are
      // IGNORED — the ledger's child envelope is the ceiling (F-12).
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
        // Phase 6 · T2 — navigable memory-as-tools. Same enable-condition as
        // context injection: knowledge layer on AND memory enabled. The agent
        // can now re-query memory mid-run instead of relying on the single
        // snapshot assembled below; injection stays as the seed context.
        memoryTools: () => {
          try {
            if (!config.knowledge?.enabled || !config.memory.enabled) return [];
            const contextSvc = this.registry.tryResolve(Tokens.Context);
            if (!contextSvc) return [];
            return buildMemoryTools({
              context: contextSvc,
              requester: { kind: "agent", id: "primary", role: overrides.agentRole ?? "agent" },
              lexicalOnly: config.knowledge.lexicalOnly,
            });
          } catch (err) {
            // Reported as a diagnostic by the builder — never fails the run.
            throw err;
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
      // A-19 — cooperative cancellation threaded to the loop's checkpoints.
      ...(overrides.signal ? { signal: overrides.signal } : {}),
      // Phase 6 — task-runtime wiring (envelope ref, resume, journal, identity).
      ...(partitionRef ? { partition: partitionRef } : {}),
      sessionId: runSessionId,
      ...(resumeFrom ? { resumeFrom } : {}),
      ...(journal?.checkpointSink ? { checkpointSink: journal.checkpointSink } : {}),
      ...(journal?.taskLedger ? { taskLedger: journal.taskLedger } : {}),
      ...(runIdentity ? { agentIdentity: runIdentity } : {}),
      // Phase 05 — canonical streaming event sink threaded to the loop.
      ...(overrides.onStreamEvent ? { onStreamEvent: overrides.onStreamEvent } : {}),
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
      /**
       * Phase 7 · T1 — provenance: every tool call of this run is recorded in
       * the capability provenance graph (best-effort; the capability service
       * is optional). Answers "what did the agent use?" with outcomes.
       */
      ...(() => {
        const caps = this.registry.tryResolve(Tokens.Capabilities) as
          | { recordUse?: (tool: string, opts: { runId?: string; outcome?: "success" | "failure" | "unknown"; detail?: string }) => void }
          | undefined;
        const recordUse = caps?.recordUse;
        if (!recordUse) return {};
        return {
          onToolUse: (info: { tool: string; ok: boolean; error?: string }) => {
            try {
              // The envelope identity is allocated below (evidence); the
              // run-level correlation id is the envelope id, recorded per
              // call by the loop's ToolContext wiring.
              recordUse(info.tool, { runId: evidence.envelopeId, outcome: info.ok ? "success" : "failure", detail: info.error });
            } catch {
              // Provenance recording must never break the run.
            }
          },
        };
      })(),
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
          // Phase 11 — seed a token-budgeted repo map when the index is already
          // ready. Never await a cold index here (TTFT). A miss starts
          // background indexing; the model can still request repo_* tools.
          const repoExtras = isRepoIntelligenceEnabled()
            ? await buildRepoCandidates(
                createRepoIntelligence({
                  workspaceId: unifiedStore.workspaceId,
                  root: process.cwd(),
                  store: unifiedStore,
                }),
                {
                  workspaceId: unifiedStore.workspaceId,
                  projectScope: projectScopeFromCwd(process.cwd()),
                  task,
                },
              ).catch((err) => {
                diagnostics.push(`repo context degraded: ${err instanceof Error ? err.message : String(err)}`);
                return [];
              })
            : [];
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
            { memoryEnabled: memoryOn, memoryStore: engine, extras: repoExtras },
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
        // Phase 2 · F-06 — workspace deny-list threaded to the loop boundary
        // (fallback [] when the config block is absent — audited default).
        deniedPermissions: config.capabilities?.deniedPermissions ?? [],
        approve:
          overrides.approve ??
          // Phase 2 · F-11/F-26 — CLI consent via the durable approval store:
          // structured preview, TTL default-deny, cross-process resolvable.
          makeApprover(unifiedStore, {
            surface: "cli",
            defaultTtlMs: config.approvals?.defaultTtlMs,
            perSurface: config.approvals?.perSurface,
            prompt: async (record, decide) => {
              const structured = record.preview
                ? renderPreviewText(record.preview)
                : `(no structured preview) reason: ${record.reason}`;
              const ttlSec = Math.round(record.ttlMs / 1000);
              const answer = await confirm(
                `Approve ${record.tool}? [risk: ${record.riskTier}] (auto-deny in ${ttlSec}s)\n${structured}`,
                false,
              );
              decide(answer);
            },
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
