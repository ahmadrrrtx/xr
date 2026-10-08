/**
 * Phase 19 — the daemon's workflow runtime.
 *
 * Before this file the DAG engine (`src/execution/workflow/engine.ts`) was
 * fully built but never constructed anywhere in the daemon. This module
 * wires it to the real services, once per DaemonState:
 *
 *   agentRunner       → the canonical AgentService (same path as /api/chat),
 *                       with the node's tool scope / permissions / provider
 *                       pin / budget applied as run overrides; token usage is
 *                       priced with the engine's own pricing table.
 *   toolExecutor      → core tools from `src/tools/registry.ts`; risky nodes
 *                       (`requiresApproval` or `tool.requiresApproval`) must
 *                       clear a DURABLE approval record first.
 *   human nodes       → an approval record (`tool: workflow.human_approval |
 *                       workflow.human_review`) so the desktop's existing
 *                       approval plane shows it; its decision is forwarded to
 *                       `engine.submitHumanDecision`. The inline canvas
 *                       buttons go through the same record. Expiry falls
 *                       back to the node's own `onExpiry` policy.
 *   runStore          → WorkflowRepository on the workspace store.
 *   events            → ring buffer + subscribers per run for SSE replay.
 *
 * No timers fake progress: every event here is emitted by the engine as the
 * run actually advances.
 */

import { randomUUID } from "node:crypto";
import type { XRConfig } from "../config/config.ts";
import type { ApprovalRequest, Tool, ToolContext } from "../core/types.ts";
import { getApprovalStore, type ApprovalOutcome, type ApprovalStore } from "../control/approval-store.ts";
import { priceFor } from "../cost/pricing.ts";
import { WorkflowEngine } from "../execution/workflow/engine.ts";
import type { WorkflowRunEvent } from "../execution/workflow/events.ts";
import { WorkflowRepository } from "../execution/workflow/repository.ts";
import type { HumanDecision, WorkflowDefinition, WorkflowNode, WorkflowRun } from "../execution/workflow/types.ts";
import { getTool } from "../tools/registry.ts";
import { Tokens } from "../core/tokens.ts";
import type { DaemonState } from "./routes/router.ts";

const RING = 2000;
const KEEP_FINISHED_MS = 60 * 60 * 1000;
export const MAX_CONCURRENT_WORKFLOW_RUNS = 3;

export interface WorkflowRuntimeOptions {
  /** Test seam: override the agent runner (defaults to the daemon AgentService). */
  agentRunner?: ConstructorParameters<typeof WorkflowEngine>[0]["agentRunner"];
  /** Test seam: override tool execution (defaults to core tools + approvals). */
  toolExecutor?: ConstructorParameters<typeof WorkflowEngine>[0]["toolExecutor"];
  now?: () => number;
}

export interface PendingHumanNode {
  runId: string;
  nodeId: string;
  approvalId: string;
  kind: "approval" | "review";
  summary: string;
}

export class WorkflowRuntime {
  readonly engine: WorkflowEngine;
  readonly repo: WorkflowRepository;
  private readonly events = new Map<string, WorkflowRunEvent[]>();
  private readonly listeners = new Map<string, Set<(e: WorkflowRunEvent) => void>>();
  private readonly finishedAt = new Map<string, number>();
  /** nodeId → approval bridge, per run. */
  private readonly pending = new Map<string, Map<string, PendingHumanNode>>();
  private readonly approvals: ApprovalStore;
  private readonly now: () => number;

  constructor(
    private readonly state: DaemonState,
    private readonly config: XRConfig,
    opts: WorkflowRuntimeOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.repo = new WorkflowRepository(state.store as any);
    this.approvals = getApprovalStore(state.store as any, {
      defaultTtlMs: config.approvals?.defaultTtlMs,
      perSurface: config.approvals?.perSurface,
    });
    this.engine = new WorkflowEngine({
      runStore: this.repo,
      agentRunner: opts.agentRunner ?? this.makeAgentRunner(),
      toolExecutor: opts.toolExecutor ?? this.makeToolExecutor(),
      executionRecorder: {
        recordExecution: async (p) => {
          const id = `wx_${randomUUID().slice(0, 10)}`;
          this.audit("workflow.execution", { id, ...p });
          return id;
        },
      },
      contextProvider: {
        // The run-scoped context package is assembled by the AgentService on
        // each agentic node (same as chat); the engine only needs a handle.
        buildContextPackage: async (p) => ({ packageId: `ctx_${p.taskId}` }),
      },
      timerScheduler: {
        wait: (ms, signal) =>
          new Promise<void>((resolve, reject) => {
            if (signal?.aborted) return reject(new Error("cancelled"));
            const t = setTimeout(() => {
              signal?.removeEventListener("abort", onAbort);
              resolve();
            }, ms);
            const onAbort = () => {
              clearTimeout(t);
              reject(new Error("cancelled"));
            };
            signal?.addEventListener("abort", onAbort, { once: true });
          }),
        // External events are not wired in this build; the node fails
        // honestly instead of hanging forever.
        waitForEvent: async (eventName) => {
          throw new Error(`waiting for external event "${eventName}" is not supported yet`);
        },
      },
      onEvent: (e) => this.onEngineEvent(e),
    });
  }

  // ── Definitions ───────────────────────────────────────────────────────────

  listDefinitions(opts: { limit?: number; activeOnly?: boolean } = {}): WorkflowDefinition[] {
    return this.repo.listDefinitions(opts);
  }

  getDefinition(id: string, version?: number): WorkflowDefinition | null {
    return this.repo.getDefinition(id, version);
  }

  /** Publish (verifies contentHash) — the only write path for definitions. */
  publish(def: WorkflowDefinition): WorkflowDefinition {
    return this.engine.publishDefinition(def);
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  activeRuns(): number {
    let n = 0;
    for (const id of this.events.keys()) {
      const run = this.engine.getRun(id);
      if (run && !isTerminal(run.state)) n += 1;
    }
    return n;
  }

  canStart(): boolean {
    return this.activeRuns() < MAX_CONCURRENT_WORKFLOW_RUNS;
  }

  async start(
    definitionId: string,
    version: number | undefined,
    params: { parameters?: Record<string, unknown>; initiatedBy?: WorkflowRun["initiatedBy"]; tags?: string[] },
  ): Promise<WorkflowRun> {
    this.sweep();
    const def = this.repo.getDefinition(definitionId, version);
    if (!def) throw new WorkflowRuntimeError("not_found", `workflow ${definitionId}${version ? ` v${version}` : ""} not found`);
    const missing = (def.parameters ?? []).filter((p) => p.required && p.default === undefined && params.parameters?.[p.name] === undefined).map((p) => p.name);
    if (missing.length) throw new WorkflowRuntimeError("bad_request", `missing required parameter(s): ${missing.join(", ")}`);
    const resolved: Record<string, unknown> = {};
    for (const p of def.parameters ?? []) {
      const v = params.parameters?.[p.name];
      resolved[p.name] = v === undefined ? p.default : v;
    }
    this.engine.publishDefinition(def); // (re)load into the engine's in-memory map; verifies the hash
    const run = await this.engine.startRun(def.definitionId, def.version, {
      initiatedBy: params.initiatedBy ?? { type: "manual" },
      resolvedParameters: resolved,
      tags: params.tags,
    });
    this.events.set(run.runId, []);
    void this.engine.executeRun(run.runId).catch((err) => {
      this.audit("workflow.run.error", { runId: run.runId, error: String(err) });
    });
    return run;
  }

  getRun(runId: string): WorkflowRun | null {
    return this.engine.getRun(runId) ?? this.repo.getRun(runId);
  }

  listRuns(opts: { limit?: number; definitionId?: string } = {}) {
    return this.repo.listRuns(opts);
  }

  cancel(runId: string): WorkflowRun {
    const run = this.engine.cancelRun(runId);
    // Any parked human node is withdrawn with the run.
    for (const p of this.pending.get(runId)?.values() ?? []) this.approvals.decide(p.approvalId, false, { channel: "workflow", userId: "system:cancelled" });
    this.pending.delete(runId);
    return run;
  }

  pause(runId: string): WorkflowRun {
    return this.engine.pauseRun(runId);
  }

  resume(runId: string): Promise<WorkflowRun> {
    return this.engine.resumeRun(runId);
  }

  /**
   * A human decision from the canvas (inline buttons) or any other surface.
   * When a bridge record exists the decision goes THROUGH it so the approval
   * plane stays the single source of truth; otherwise (engine restarted,
   * record swept) the engine is told directly.
   */
  async decide(
    runId: string,
    nodeId: string,
    decision: HumanDecision["decision"],
    by: { userId: string; channel: string; name?: string },
    comment?: string,
  ): Promise<WorkflowRun> {
    const bridge = this.pending.get(runId)?.get(nodeId);
    if (bridge) {
      const approved = "approval" in decision ? decision.approval === "approved" : "review" in decision ? decision.review === "approved" : false;
      // The bridge's outcome handler forwards to the engine; wait for it.
      const settled = this.waitForNodeToLeave(runId, nodeId);
      const ok = this.approvals.decide(bridge.approvalId, approved, { channel: by.channel, userId: by.userId });
      if (ok) {
        await settled;
        return this.engine.getRun(runId) ?? this.requireRun(runId);
      }
      this.pending.get(runId)?.delete(nodeId);
    }
    return this.engine.submitHumanDecision(runId, nodeId, decision, { kind: "user", userId: by.userId, name: by.name }, comment);
  }

  pendingFor(runId: string): PendingHumanNode[] {
    return [...(this.pending.get(runId)?.values() ?? [])];
  }

  // ── Events ────────────────────────────────────────────────────────────────

  replay(runId: string): WorkflowRunEvent[] {
    return [...(this.events.get(runId) ?? [])];
  }

  subscribe(runId: string, fn: (e: WorkflowRunEvent) => void): () => void {
    const set = this.listeners.get(runId) ?? new Set();
    set.add(fn);
    this.listeners.set(runId, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }

  isTerminal(runId: string): boolean {
    const run = this.engine.getRun(runId) ?? this.repo.getRun(runId);
    return !run || isTerminal(run.state);
  }

  private publishEvent(e: WorkflowRunEvent): void {
    const ring = this.events.get(e.runId) ?? [];
    ring.push(e);
    if (ring.length > RING) ring.splice(0, ring.length - RING);
    this.events.set(e.runId, ring);
    for (const fn of this.listeners.get(e.runId) ?? []) {
      try {
        fn(e);
      } catch {
        /* one broken subscriber never breaks the run */
      }
    }
  }

  private onEngineEvent(e: WorkflowRunEvent): void {
    this.publishEvent(e);
    if (e.type === "node_state" && (e.state === "waiting_approval" || e.state === "waiting_review")) {
      this.openHumanBridge(e.runId, e.nodeId);
    }
    if (e.type === "node_state" && e.state !== "waiting_approval" && e.state !== "waiting_review") {
      this.pending.get(e.runId)?.delete(e.nodeId);
    }
    if (e.type === "run_end") {
      this.finishedAt.set(e.runId, this.now());
      this.pending.delete(e.runId);
    }
  }

  /** Create the approval record for a parked human node and forward its outcome. */
  private openHumanBridge(runId: string, nodeId: string): void {
    const run = this.engine.getRun(runId);
    const node = run?.definitionSnapshot.nodes.find((n) => n.id === nodeId);
    if (!run || !node || (node.kind !== "human_approval" && node.kind !== "human_review")) return;
    if (this.pending.get(runId)?.has(nodeId)) return;
    const kind = node.kind === "human_approval" ? "approval" : "review";
    const summary = node.request.summary || node.label;
    const ttlMs = Math.max(1_000, node.expiresInMs || 0) || undefined;
    let handle;
    try {
      handle = this.approvals.request({
        tool: node.kind === "human_approval" ? "workflow.human_approval" : "workflow.human_review",
        reason: summary,
        args: {
          workflow: run.definitionSnapshot.name,
          node: node.label,
          detail: node.request.detail,
          ...(node.kind === "human_approval" ? { riskLevel: node.request.riskLevel, scope: node.request.scope } : { reviewTargets: node.request.reviewTargetNodes }),
        },
        riskTier: node.kind === "human_approval" ? node.request.riskLevel : "medium",
        surface: "daemon",
        runId,
        taskId: nodeId,
        sessionId: null,
        ttlMs,
      });
    } catch (err) {
      this.audit("workflow.approval.error", { runId, nodeId, error: String(err) });
      return;
    }
    const entry: PendingHumanNode = { runId, nodeId, approvalId: handle.id, kind, summary };
    const map = this.pending.get(runId) ?? new Map();
    map.set(nodeId, entry);
    this.pending.set(runId, map);
    this.publishEvent({ type: "approval_required", runId, nodeId, approvalId: handle.id, kind, summary, at: this.now() });
    void handle.outcome.then((outcome) => this.onHumanOutcome(entry, node, outcome)).catch((err) => {
      this.audit("workflow.approval.error", { runId, nodeId, error: String(err) });
    });
  }

  private async onHumanOutcome(entry: PendingHumanNode, node: WorkflowNode, outcome: ApprovalOutcome): Promise<void> {
    const current = this.pending.get(entry.runId)?.get(entry.nodeId);
    if (!current || current.approvalId !== entry.approvalId) return; // superseded or withdrawn
    this.pending.get(entry.runId)?.delete(entry.nodeId);
    const run = this.engine.getRun(entry.runId);
    const ns = run?.nodeStates.get(entry.nodeId);
    if (!run || !ns || (ns.state !== "waiting_approval" && ns.state !== "waiting_review")) return;
    const userId = outcome.decidedBy?.userId ?? (outcome.timedOut ? "system:expired" : "user");
    let decision: HumanDecision["decision"];
    if (outcome.timedOut) decision = { expiry: "expired" };
    else if (node.kind === "human_review") decision = outcome.approved ? { review: "approved" } : { review: "rejected", reason: "Rejected from the approval plane" };
    else decision = outcome.approved ? { approval: "approved" } : { approval: "denied", reason: "Denied from the approval plane" };
    try {
      await this.engine.submitHumanDecision(entry.runId, entry.nodeId, decision, { kind: "user", userId });
    } catch (err) {
      this.audit("workflow.decision.error", { runId: entry.runId, nodeId: entry.nodeId, error: String(err) });
    }
  }

  private waitForNodeToLeave(runId: string, nodeId: string): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        off();
        clearTimeout(t);
        resolve();
      };
      const off = this.subscribe(runId, (e) => {
        if (e.type === "run_end") done();
        if (e.type === "node_state" && e.nodeId === nodeId && e.state !== "waiting_approval" && e.state !== "waiting_review") done();
      });
      const t = setTimeout(done, 10_000);
    });
  }

  private requireRun(runId: string): WorkflowRun {
    const run = this.repo.getRun(runId);
    if (!run) throw new WorkflowRuntimeError("not_found", `run ${runId} not found`);
    return run;
  }

  sweep(now = this.now()): void {
    for (const [id, at] of this.finishedAt) {
      if (now - at > KEEP_FINISHED_MS) {
        this.finishedAt.delete(id);
        this.events.delete(id);
        this.listeners.delete(id);
      }
    }
  }

  // ── Wiring: agent runner ──────────────────────────────────────────────────

  private makeAgentRunner(): ConstructorParameters<typeof WorkflowEngine>[0]["agentRunner"] {
    return {
      runAgentTask: async (p) => {
        const executor = this.state.agentExecutor;
        if (!executor) throw new Error("agent executor is not available in this daemon");
        const scope = p.providerScope as { provider?: string; model?: string };
        const app = await executor.ensureApp();
        const cfg = app.registry.resolve(Tokens.Config).reload();
        const provider = scope.provider ?? cfg.defaults.provider;
        const model = scope.model ?? cfg.defaults.model;
        const deny = new Set<string>(p.toolScope.mode === "denylist" ? p.toolScope.tools : []);
        // Per-node permissions are enforced here, not trusted from the canvas.
        if (!p.permissions.writeFiles) deny.add("write_file");
        if (!p.permissions.shell) deny.add("shell");
        if (!p.permissions.network) {
          deny.add("fetch_url");
          deny.add("web_search");
        }
        const allow = p.toolScope.mode === "allowlist" ? p.toolScope.tools.filter((t) => !deny.has(t)) : undefined;
        let tokensIn = 0;
        let tokensOut = 0;
        const result = await executor.runTask(p.instruction, "agent", {
          laneKey: `workflow:${p.workflowId}`,
          runId: p.workflowId,
          taskId: p.taskId,
          agentRole: p.agentRole,
          provider,
          model,
          systemPrompt: p.systemPrompt,
          budget: p.budget?.maxUsd,
          maxTokens: p.budget?.maxTokens,
          maxSteps: p.budget?.maxSteps,
          toolsAllow: allow && allow.length ? allow : allow ? ["__none__"] : undefined,
          toolsDeny: deny.size ? [...deny] : undefined,
          memoryEnabled: p.includeUserMemory,
          signal: p.signal,
          say: p.say,
          onStreamEvent: (ev) => {
            if (ev.type === "usage" || (ev.type === "done" && ev.usage)) {
              const u = ev.type === "usage" ? ev.usage : ev.usage!;
              tokensIn = Math.max(tokensIn, u.inTokens);
              tokensOut = Math.max(tokensOut, u.outTokens);
            }
          },
          approve: (req) => this.durableApproval(req, { runId: p.workflowId, taskId: p.taskId }),
        });
        const price = priceFor(provider, model);
        const usd = (tokensIn * price.inPerMTok + tokensOut * price.outPerMTok) / 1_000_000;
        const cost = { usd: Math.round(usd * 1e6) / 1e6, tokensIn, tokensOut };
        if (result.stopped === "cancelled") throw Object.assign(new Error("cancelled"), { cost });
        if (result.stopped === "error") throw Object.assign(new Error(result.finalMessage || "agent run failed"), { cost });
        if (result.stopped === "budget") throw Object.assign(new Error(`stopped: budget cap reached — ${result.finalMessage}`.trim()), { cost });
        if (result.stopped === "approval") throw Object.assign(new Error(`stopped: an approval was denied — ${result.finalMessage}`.trim()), { cost });
        return { summary: result.finalMessage, structured: { stopped: result.stopped, steps: result.steps, provider, model }, cost };
      },
    };
  }

  // ── Wiring: tool executor ─────────────────────────────────────────────────

  private makeToolExecutor(): NonNullable<ConstructorParameters<typeof WorkflowEngine>[0]["toolExecutor"]> {
    return {
      supports: (cap) => cap.family === "core_tool" && !!getTool(cap.name),
      executeTool: async (p) => {
        const tool: Tool | undefined = getTool(p.capability.name);
        if (!tool) return { ok: false, error: `unknown tool ${p.capability.name}` };
        const ctx: ToolContext = {
          cwd: process.cwd(),
          signal: p.signal,
          approve: (req) => this.durableApproval(req, { runId: p.workflowId, taskId: p.nodeId }),
          audit: (event, detail) => this.audit(event, { runId: p.workflowId, nodeId: p.nodeId, ...detail }),
          egressAllowlist: this.config.security?.egressAllowlist ?? [],
        };
        if (p.requiresApproval || tool.requiresApproval) {
          const approved = await ctx.approve({
            tool: tool.name,
            reason: `Workflow step "${p.label ?? p.nodeId}" wants to run ${tool.name}`,
            args: p.inputs,
            riskTier: p.riskTier,
            runId: p.workflowId,
            taskId: p.nodeId,
          });
          if (!approved) return { ok: false, error: `approval denied for ${tool.name}` };
        }
        try {
          const res = await tool.run(p.inputs, ctx);
          return res.ok ? { ok: true, output: res.data ?? res.output } : { ok: false, error: res.output || `${tool.name} failed` };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    };
  }

  /** Every risky action becomes a durable approval the dashboard can decide. Fails closed. */
  private async durableApproval(req: ApprovalRequest, ids: { runId: string; taskId: string }): Promise<boolean> {
    try {
      const handle = this.approvals.request({
        tool: req.tool,
        reason: req.reason,
        args: req.args,
        preview: req.structuredPreview,
        riskTier: req.riskTier,
        surface: "daemon",
        runId: ids.runId,
        taskId: req.taskId ?? ids.taskId,
        sessionId: null,
      });
      this.publishEvent({ type: "approval_required", runId: ids.runId, nodeId: ids.taskId, approvalId: handle.id, kind: "tool", summary: `${req.tool}: ${req.reason}`.slice(0, 200), at: this.now() });
      const outcome = await handle.outcome;
      return outcome.approved;
    } catch (err) {
      this.audit("workflow.approval.error", { runId: ids.runId, error: String(err) });
      return false;
    }
  }

  private audit(event: string, detail: Record<string, unknown>): void {
    try {
      this.state.store.audit(event, detail);
    } catch {
      /* audit sink may be absent in minimal contexts */
    }
  }
}

export class WorkflowRuntimeError extends Error {
  constructor(
    readonly code: "not_found" | "bad_request" | "busy" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "WorkflowRuntimeError";
  }
}

function isTerminal(state: WorkflowRun["state"]): boolean {
  return state === "completed" || state === "failed" || state === "cancelled" || state === "expired";
}

const runtimes = new WeakMap<object, WorkflowRuntime>();
let testOptions: WorkflowRuntimeOptions | null = null;

/** Test seam: options applied to the NEXT runtime created (e.g. a fake agent runner). */
export function setWorkflowRuntimeOptionsForTests(opts: WorkflowRuntimeOptions | null): void {
  testOptions = opts;
}

/** One runtime per daemon state (keyed by its store), created lazily. */
export function getWorkflowRuntime(state: DaemonState, config: XRConfig, opts?: WorkflowRuntimeOptions): WorkflowRuntime {
  const key = state.store as unknown as object;
  const existing = runtimes.get(key);
  if (existing) return existing;
  const created = new WorkflowRuntime(state, config, { ...(testOptions ?? {}), ...(opts ?? {}) });
  runtimes.set(key, created);
  return created;
}
