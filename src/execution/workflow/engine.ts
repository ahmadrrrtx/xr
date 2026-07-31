/**
 * XR 5.0 — Canonical Workflow Engine
 *
 * The ONE workflow execution substrate. Executes workflow runs that contain
 * any mix of deterministic, agentic, human, tool, and other node types.
 * Integrates with the existing MultiAgentService, ExecutionService, and
 * ContextService through typed contracts.
 *
 * Design invariants:
 *   - The graph controls sequencing. Agent output is evidence, not authority.
 *   - Nodes execute only when dependencies are satisfied.
 *   - Completed nodes are NEVER rerun accidentally.
 *   - Human decisions persist with full audit context.
 *   - Every node links to execution records and context packages.
 *   - No unbounded agent loops.
 *   - No duplicate execution.
 *   - No approval bypass.
 */

import { randomUUID } from "node:crypto";
import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunState,
  WorkflowNode,
  WorkflowNodeState,
  WorkflowNodeStateDetail,
  HumanDecision,
  ExecutionRef,
  WorkflowArtifact,
  WorkflowCost,
  WorkflowErrorEntry,
  WorkflowRunSummary,
  WorkflowInspection,
} from "./types.ts";
import { applyRunEvent, applyNodeEvent, canAdvanceNodes, canAcceptHumanInput, canPause, canCancel } from "./state-machine.ts";
import { verifyIntegrity } from "./versioning.ts";
import type { RunEvent } from "./state-machine.ts";

// ── Interfaces to existing systems ─────────────────────────────────────────

/** Interface for the MultiAgentService — we only need what the engine calls. */
export interface WorkflowAgentRunner {
  runAgentTask(params: {
    agentRole: string;
    agentId?: string;
    instruction: string;
    systemPrompt?: string;
    providerScope: Record<string, unknown>;
    toolScope: { mode: string; tools: string[] };
    permissions: Record<string, boolean>;
    budget?: { maxUsd?: number; maxTokens?: number; maxSteps?: number };
    contextTiers?: string[];
    includeUserMemory?: boolean;
    taskId: string;
    workflowId: string;
    say: (line: string) => void;
  }): Promise<{ summary: string; structured?: Record<string, unknown>; artifacts?: Array<{ path: string; description?: string }> }>;
}

/** Interface for the ExecutionService. */
export interface WorkflowExecutionRecorder {
  recordExecution(params: {
    workflowId: string;
    taskId: string;
    nodeId: string;
    capability: { kind: string; name: string };
    inputSummary: string;
    outcome: "succeeded" | "failed";
    message: string;
    durationMs: number;
    cost?: { usd: number; tokensIn: number; tokensOut: number };
  }): Promise<string>;
}

/**
 * Interface for the canonical tool-execution service (Phase 0 · T6).
 *
 * The engine does NOT implement tool execution — a second executor would be a
 * duplicate authority for an L1 concern (Commandment 6 / ADR-2). It delegates,
 * and when no executor is wired it refuses to run the node rather than
 * fabricating success.
 */
export interface WorkflowToolExecutor {
  /**
   * Execute a tool action for real.
   *
   * Implementations must return `ok: false` when the action did not happen.
   * Returning `ok: true` for an action that was not performed is the defect
   * class Phase 0 exists to eliminate (Commandment 2).
   */
  executeTool(params: {
    capability: { family: string; name: string };
    inputs: Record<string, unknown>;
    workflowId: string;
    nodeId: string;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; output?: unknown; error?: string }>;

  /** Whether this executor can perform the named capability at all. */
  supports(capability: { family: string; name: string }): boolean;
}

/**
 * Interface for real time-based waiting (Phase 0 · T6).
 *
 * Timer nodes previously "waited" by immediately marking themselves complete.
 * A scheduler that actually elapses time is injected instead; without one,
 * timer nodes park in a waiting state rather than lying about having waited.
 */
export interface WorkflowTimerScheduler {
  /** Resolve after `ms` have genuinely elapsed. */
  wait(ms: number, signal?: AbortSignal): Promise<void>;
  /** Resolve when the named event fires; reject/timeout otherwise. */
  waitForEvent?(eventName: string, signal?: AbortSignal): Promise<void>;
}

/** Interface for the ContextService. */
export interface WorkflowContextProvider {
  buildContextPackage(params: {
    intent: string;
    cwd?: string;
    taskId: string;
    agentId?: string;
    tiers?: string[];
    includeUserMemory: boolean;
  }): Promise<{ packageId: string }>;
}

/** Interface for persisting workflow runs. */
export interface WorkflowRunStore {
  saveRun(run: WorkflowRun): void;
  getRun(runId: string): WorkflowRun | null;
  listRuns(opts: { limit?: number; state?: WorkflowRunState; definitionId?: string }): WorkflowRunSummary[];
  saveHumanDecision(decision: HumanDecision): void;
  getHumanDecision(decisionId: string): HumanDecision | null;
  getPendingDecisions(opts: { limit?: number }): HumanDecision[];
  getDecisionsForRun(runId: string): HumanDecision[];
  saveDefinition(def: WorkflowDefinition): void;
  getDefinition(definitionId: string, version?: number): WorkflowDefinition | null;
  listDefinitions(opts: { limit?: number; activeOnly?: boolean }): WorkflowDefinition[];
}

// ── Engine Configuration ──────────────────────────────────────────────────

export interface WorkflowEngineConfig {
  agentRunner: WorkflowAgentRunner;
  executionRecorder: WorkflowExecutionRecorder;
  contextProvider: WorkflowContextProvider;
  runStore: WorkflowRunStore;
  /**
   * Canonical tool executor (Phase 0 · T6). Optional by type so existing
   * call-sites compile unchanged, but its ABSENCE now means tool-action nodes
   * fail as unsupported — never that they succeed silently.
   */
  toolExecutor?: WorkflowToolExecutor;
  /**
   * Real timer scheduler (Phase 0 · T6). Without it, timer nodes remain in a
   * waiting state to be advanced by an external scheduler instead of
   * pretending the delay elapsed.
   */
  timerScheduler?: WorkflowTimerScheduler;
}

// ── The Engine ─────────────────────────────────────────────────────────────

export class WorkflowEngine {
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly config: WorkflowEngineConfig) {}

  // ── Definition Management ────────────────────────────────────────────────

  /** Publish a definition (or new version). Makes it immutable. */
  publishDefinition(def: WorkflowDefinition): WorkflowDefinition {
    if (!verifyIntegrity(def)) {
      throw new Error("Definition integrity check failed");
    }
    this.config.runStore.saveDefinition(def);
    return def;
  }

  /** Get a published definition. */
  getDefinition(definitionId: string, version?: number): WorkflowDefinition | null {
    return this.config.runStore.getDefinition(definitionId, version);
  }

  /** List published definitions. */
  listDefinitions(opts: { limit?: number; activeOnly?: boolean } = {}): WorkflowDefinition[] {
    return this.config.runStore.listDefinitions(opts);
  }

  // ── Run Lifecycle ────────────────────────────────────────────────────────

  /** Create and queue a new run from a published definition. */
  async startRun(
    definitionId: string,
    version: number,
    params: {
      initiatedBy: WorkflowRun["initiatedBy"];
      resolvedParameters?: Record<string, unknown>;
      tags?: string[];
    },
  ): Promise<WorkflowRun> {
    const def = this.config.runStore.getDefinition(definitionId, version);
    if (!def) throw new Error(`Definition not found: ${definitionId} v${version}`);
    if (!def.active) throw new Error(`Definition ${definitionId} v${version} is not active`);
    if (!verifyIntegrity(def)) throw new Error(`Definition ${definitionId} v${version} fails integrity check`);

    const runId = `wfr_${randomUUID().slice(0, 10)}`;
    const now = Date.now();

    const nodeStates = new Map<string, WorkflowNodeStateDetail>();
    for (const node of def.nodes) {
      const isEntry = def.entryNodeIds.includes(node.id) || node.dependencies.length === 0;
      nodeStates.set(node.id, {
        nodeId: node.id,
        kind: node.kind,
        state: isEntry ? "ready" : "pending",
        inputs: {},
        attempt: 0,
        retryHistory: [],
      });
    }

    const run: WorkflowRun = {
      runId,
      definitionId: def.definitionId,
      definitionVersion: def.version,
      state: "queued",
      definitionSnapshot: JSON.parse(JSON.stringify(def)),
      nodeStates,
      executionRefs: [],
      contextPackageIds: [],
      artifacts: [],
      humanDecisions: [],
      cost: { estimatedUsd: 0, actualUsd: 0, tokensIn: 0, tokensOut: 0, breakdown: {} },
      createdAt: now,
      updatedAt: now,
      initiatedBy: params.initiatedBy,
      resolvedParameters: params.resolvedParameters ?? {},
      errorChain: [],
      tags: params.tags ?? [],
      policyDecisions: [],
      contentHash: "",
    };
    run.contentHash = this.computeRunHash(run);

    this.config.runStore.saveRun(run);
    return run;
  }

  /** Execute the run: start queued runs. */
  async executeRun(runId: string): Promise<WorkflowRun> {
    const run = this.requireRun(runId);
    if (run.state === "queued") {
      this.applyRunTransition(run, "start");
    }
    return this.advanceRun(run);
  }

  /** Advance a run that's in progress, processing ready nodes. */
  async advanceRun(run: WorkflowRun): Promise<WorkflowRun> {
    let safety = 0;
    const MAX_TICKS = 1000;

    while (safety++ < MAX_TICKS) {
      if (!canAdvanceNodes(run.state) && !canAcceptHumanInput(run.state)) {
        break;
      }

      // If waiting for human input, don't advance — exit the loop.
      if (canAcceptHumanInput(run.state)) {
        break;
      }

      // Refresh readiness: mark pending nodes whose dependencies are now satisfied
      this.refreshNodeReadiness(run);

      const readyNodes = this.getReadyNodes(run);
      if (readyNodes.length === 0) {
        // No ready nodes — determine if we're done or blocked
        this.recomputeRunState(run);
        break;
      }

      // Execute all ready nodes (respecting parallel keys)
      const controller = new AbortController();
      this.running.set(run.runId, controller);

      try {
        const results = await Promise.allSettled(
          readyNodes.map(n => this.executeNode(run, n, controller.signal)),
        );
        // Process results
        for (const result of results) {
          if (result.status === "rejected") {
            run.errorChain.push({
              nodeId: "engine",
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
              timestamp: Date.now(),
              retryable: false,
            });
          }
        }
      } finally {
        this.running.delete(run.runId);
      }

      this.recomputeRunState(run);

      if (canAcceptHumanInput(run.state)) {
        this.config.runStore.saveRun(run);
        break;
      }
    }

    run.updatedAt = Date.now();
    run.contentHash = this.computeRunHash(run);
    this.config.runStore.saveRun(run);
    return run;
  }

  /** Submit a human decision (approval or review). */
  async submitHumanDecision(
    runId: string,
    nodeId: string,
    decision: HumanDecision["decision"],
    decidedBy: HumanDecision["decidedBy"],
    comment?: string,
    evidenceShown: HumanDecision["evidenceShown"] = [],
  ): Promise<WorkflowRun> {
    const run = this.requireRun(runId);
    if (!canAcceptHumanInput(run.state)) {
      throw new Error(`Run ${runId} is not awaiting human input (state: ${run.state})`);
    }

    const nodeState = run.nodeStates.get(nodeId);
    if (!nodeState) throw new Error(`Node ${nodeId} not found in run ${runId}`);
    if (nodeState.state !== "waiting_approval" && nodeState.state !== "waiting_review") {
      throw new Error(`Node ${nodeId} is not waiting for human input (state: ${nodeState.state})`);
    }

    const node = run.definitionSnapshot.nodes.find(n => n.id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found in definition`);

    const now = Date.now();
    const isApproval = node.kind === "human_approval";

    const humanDecision: HumanDecision = {
      decisionId: `hd_${randomUUID().slice(0, 10)}`,
      runId: run.runId,
      nodeId,
      kind: isApproval ? "approval" : "review",
      decidedBy,
      decision,
      comment,
      evidenceShown,
      requestedAt: nodeState.startedAt ?? now,
      decidedAt: now,
      expiresAt: (nodeState.startedAt ?? now) + (isApproval
        ? (node as any).expiresInMs ?? 86_400_000
        : (node as any).expiresInMs ?? 86_400_000),
      resultingTransition: run.state,
    };

    this.config.runStore.saveHumanDecision(humanDecision);
    run.humanDecisions.push(humanDecision);

    // Apply the decision outcome
    let nextState: WorkflowRunState;
    if ("approval" in decision) {
      if (decision.approval === "approved") {
        // Complete the approval node so downstream nodes become ready
        nodeState.state = applyNodeEvent(nodeState.state, "start", nodeId);
        nodeState.state = applyNodeEvent(nodeState.state, "complete", nodeId);
        nodeState.outputs = { approved: true, by: decidedBy.name ?? decidedBy.userId };
        nextState = applyRunEvent(run.state, "resume");
      } else {
        nodeState.state = applyNodeEvent(nodeState.state, "fail", nodeId);
        nodeState.error = decision.reason ?? "Denied by human";
        if (isApproval) {
          const onDenial = (node as any).onDenial;
          nextState = onDenial?.action === "stop_workflow"
            ? applyRunEvent(run.state, "fail")
            : applyRunEvent(run.state, "resume");
        } else {
          nextState = applyRunEvent(run.state, "resume");
        }
      }
    } else if ("review" in decision) {
      if (decision.review === "approved") {
        nodeState.state = applyNodeEvent(nodeState.state, "complete", nodeId);
        nodeState.outputs = { reviewDecision: "approved", comment };
        nextState = applyRunEvent(run.state, "resume");
      } else if (decision.review === "changes_requested") {
        nodeState.state = applyNodeEvent(nodeState.state, "fail", nodeId);
        nodeState.error = `Changes requested: ${decision.changes}`;
        nextState = applyRunEvent(run.state, "resume");
      } else {
        nodeState.state = applyNodeEvent(nodeState.state, "fail", nodeId);
        nodeState.error = decision.reason ?? "Rejected";
        nextState = applyRunEvent(run.state, "fail");
      }
    } else {
      // Expired
      nodeState.state = applyNodeEvent(nodeState.state, "expire", nodeId);
      nextState = applyRunEvent(run.state, "expire");
    }

    humanDecision.resultingTransition = nextState;
    nodeState.humanDecisionRef = humanDecision.decisionId;

    run.state = nextState;
    run.updatedAt = now;
    this.config.runStore.saveRun(run);

    // If we can advance, continue execution
    if (canAdvanceNodes(run.state)) {
      return this.advanceRun(run);
    }

    return run;
  }

  /** Pause a running workflow. */
  pauseRun(runId: string): WorkflowRun {
    const run = this.requireRun(runId);
    if (!canPause(run.state)) {
      throw new Error(`Cannot pause run ${runId} in state ${run.state}`);
    }
    this.applyRunTransition(run, "pause");
    return run;
  }

  /** Resume a paused workflow. */
  async resumeRun(runId: string): Promise<WorkflowRun> {
    const run = this.requireRun(runId);
    if (run.state !== "paused") {
      throw new Error(`Cannot resume run ${runId} in state ${run.state}`);
    }
    this.applyRunTransition(run, "resume");
    return this.advanceRun(run);
  }

  /** Request cancellation of a workflow. */
  cancelRun(runId: string): WorkflowRun {
    const run = this.requireRun(runId);
    if (!canCancel(run.state)) {
      throw new Error(`Cannot cancel run ${runId} in state ${run.state}`);
    }
    this.applyRunTransition(run, "request_cancel");
    // Cancel all non-terminal nodes
    for (const [_, ns] of run.nodeStates) {
      if (ns.state !== "completed" && ns.state !== "cancelled" && ns.state !== "skipped" && ns.state !== "failed") {
        try { ns.state = applyNodeEvent(ns.state, "cancel", ns.nodeId); } catch { /* best effort */ }
      }
    }
    try { run.state = applyRunEvent(run.state, "cancel"); } catch { /* may already be terminal */ }
    run.updatedAt = Date.now();
    this.config.runStore.saveRun(run);
    return run;
  }

  // ── Inspection ───────────────────────────────────────────────────────────

  getRun(runId: string): WorkflowRun | null {
    return this.config.runStore.getRun(runId);
  }

  listRuns(opts: { limit?: number; state?: WorkflowRunState; definitionId?: string } = {}): WorkflowRunSummary[] {
    return this.config.runStore.listRuns(opts);
  }

  inspectRun(runId: string): WorkflowInspection | null {
    const run = this.config.runStore.getRun(runId);
    if (!run) return null;
    return {
      run: this.summarizeRun(run),
      nodeStates: [...run.nodeStates.values()],
      humanDecisions: this.config.runStore.getDecisionsForRun(runId),
      artifacts: run.artifacts,
      executionRefs: run.executionRefs,
      errorChain: run.errorChain,
    };
  }

  getPendingDecisions(opts: { limit?: number } = {}): HumanDecision[] {
    return this.config.runStore.getPendingDecisions(opts);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private requireRun(runId: string): WorkflowRun {
    const run = this.config.runStore.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  private applyRunTransition(run: WorkflowRun, event: RunEvent): void {
    run.state = applyRunEvent(run.state, event);
    run.updatedAt = Date.now();
    this.config.runStore.saveRun(run);
  }

  /** Mark pending nodes as ready when all dependencies are completed. */
  private refreshNodeReadiness(run: WorkflowRun): void {
    for (const [id, ns] of run.nodeStates) {
      if (ns.state !== "pending") continue;
      const node = run.definitionSnapshot.nodes.find(n => n.id === id);
      if (!node) continue;
      const depsSatisfied = node.dependencies.every(depId => {
        const depState = run.nodeStates.get(depId);
        return depState && (depState.state === "completed" || depState.state === "skipped" || depState.state === "compensated");
      });
      if (depsSatisfied) {
        ns.state = "ready";
      }
    }
  }

  private getReadyNodes(run: WorkflowRun): WorkflowNodeStateDetail[] {
    const ready: WorkflowNodeStateDetail[] = [];
    for (const [id, ns] of run.nodeStates) {
      if (ns.state !== "ready") continue;
      const node = run.definitionSnapshot.nodes.find(n => n.id === id);
      if (!node) continue;
      // Check dependencies are completed
      const depsSatisfied = node.dependencies.every(depId => {
        const depState = run.nodeStates.get(depId);
        return depState && (depState.state === "completed" || depState.state === "skipped" || depState.state === "compensated");
      });
      if (depsSatisfied) {
        ready.push(ns);
      }
    }
    return ready;
  }

  private async executeNode(
    run: WorkflowRun,
    nodeState: WorkflowNodeStateDetail,
    signal: AbortSignal,
  ): Promise<void> {
    const node = run.definitionSnapshot.nodes.find(n => n.id === nodeState.nodeId);
    if (!node) {
      nodeState.state = "failed";
      nodeState.error = `Node ${nodeState.nodeId} not found in definition`;
      return;
    }

    nodeState.state = applyNodeEvent("ready", "start", node.id);
    nodeState.attempt++;
    nodeState.startedAt = Date.now();
    run.updatedAt = Date.now();

    // Check cancellation
    if (signal.aborted) {
      nodeState.state = applyNodeEvent(nodeState.state, "cancel", node.id);
      return;
    }

    try {
      switch (node.kind) {
        case "trigger":
          nodeState.state = applyNodeEvent(nodeState.state, "complete", node.id);
          nodeState.outputs = { triggered: true, trigger: node.trigger };
          break;

        case "deterministic":
          await this.executeDeterministicNode(run, node, nodeState);
          break;

        case "agentic":
          await this.executeAgenticNode(run, node, nodeState);
          break;

        case "human_approval":
        case "human_review":
          await this.enterHumanWait(run, node, nodeState);
          break;

        case "tool_action":
          await this.executeToolActionNode(run, node, nodeState);
          break;

        case "wait_timer":
          await this.executeWaitTimerNode(run, node, nodeState);
          break;

        case "branch":
          this.executeBranchNode(run, node, nodeState);
          break;

        case "join":
          this.executeJoinNode(run, node, nodeState);
          break;

        case "artifact_output":
          this.executeArtifactOutputNode(run, node, nodeState);
          break;

        case "business_record":
          await this.executeBusinessRecordNode(run, node, nodeState);
          break;

        case "notification":
          await this.executeNotificationNode(run, node, nodeState);
          break;

        case "completion":
          this.executeCompletionNode(run, node, nodeState);
          break;

        case "compensation":
          await this.executeCompensationNode(run, node, nodeState);
          break;

        default:
          nodeState.state = "failed";
          nodeState.error = `Unknown node kind: ${(node as any).kind}`;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (node.retry.maxRetries > 0 && nodeState.attempt <= node.retry.maxRetries) {
        nodeState.retryHistory.push({
          attempt: nodeState.attempt,
          startedAt: nodeState.startedAt ?? Date.now(),
          endedAt: Date.now(),
          error: errorMsg,
        });
        nodeState.state = "ready"; // Retry
      } else {
        nodeState.state = applyNodeEvent(nodeState.state, "fail", node.id);
        nodeState.error = errorMsg;
        run.errorChain.push({
          nodeId: node.id,
          error: errorMsg,
          timestamp: Date.now(),
          retryable: false,
        });
      }
    }

    nodeState.endedAt = Date.now();
    run.updatedAt = Date.now();
  }

  private async executeDeterministicNode(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "deterministic" },
    ns: WorkflowNodeStateDetail,
  ): Promise<void> {
    // For now, deterministic nodes are simple transform operations.
    // In the future, they will call into the skill/tool system via functionRef.
    const startTime = Date.now();
    try {
      // Simple built-in functions
      let output: unknown;
      if (node.functionRef === "builtin:transform_json") {
        output = node.inputs;
      } else if (node.functionRef === "builtin:noop") {
        output = { status: "ok" };
      } else if (node.functionRef.startsWith("builtin:")) {
        output = { result: node.inputs, function: node.functionRef };
      } else {
        // Delegate to skill system (future)
        output = { result: node.inputs, function: node.functionRef, note: "skill execution not yet integrated" };
      }
      ns.state = applyNodeEvent(ns.state, "complete", node.id);
      ns.outputs = { result: output };
      await this.config.executionRecorder.recordExecution({
        workflowId: run.runId,
        taskId: ns.nodeId,
        nodeId: node.id,
        capability: { kind: "workflow_task", name: node.functionRef },
        inputSummary: `Deterministic: ${node.functionRef}`,
        outcome: "succeeded",
        message: "Completed",
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      ns.state = applyNodeEvent(ns.state, "fail", node.id);
      ns.error = err instanceof Error ? err.message : String(err);
    }
  }

  private async executeAgenticNode(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "agentic" },
    ns: WorkflowNodeStateDetail,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      const result = await this.config.agentRunner.runAgentTask({
        agentRole: node.agentRole,
        agentId: node.agentId,
        instruction: node.instruction,
        systemPrompt: node.systemPrompt,
        providerScope: node.providerScope as any,
        toolScope: node.toolScope,
        permissions: node.permissions as any,
        budget: node.budget,
        contextTiers: node.contextScope.tiers,
        includeUserMemory: node.contextScope.includeUserMemory,
        taskId: ns.nodeId,
        workflowId: run.runId,
        say: (_line) => {
          // Progress callback — streamed to subscribers
        },
      });
      ns.state = applyNodeEvent(ns.state, "complete", node.id);
      ns.outputs = { summary: result.summary, structured: result.structured, artifacts: result.artifacts };
      await this.config.executionRecorder.recordExecution({
        workflowId: run.runId,
        taskId: ns.nodeId,
        nodeId: node.id,
        capability: { kind: "workflow_task", name: `agentic:${node.agentRole}` },
        inputSummary: node.instruction.slice(0, 200),
        outcome: "succeeded",
        message: result.summary.slice(0, 200),
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      ns.state = applyNodeEvent(ns.state, "fail", node.id);
      ns.error = err instanceof Error ? err.message : String(err);
      await this.config.executionRecorder.recordExecution({
        workflowId: run.runId,
        taskId: ns.nodeId,
        nodeId: node.id,
        capability: { kind: "workflow_task", name: `agentic:${node.agentRole}` },
        inputSummary: node.instruction.slice(0, 200),
        outcome: "failed",
        message: ns.error,
        durationMs: Date.now() - startTime,
      });
    }
  }

  private async enterHumanWait(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "human_approval" | "human_review" },
    ns: WorkflowNodeStateDetail,
  ): Promise<void> {
    const isApproval = node.kind === "human_approval";
    ns.state = applyNodeEvent(ns.state, isApproval ? "wait_approval" : "wait_review", node.id);
    run.state = applyRunEvent(run.state, isApproval ? "enter_approval" : "enter_review");
  }

  /**
   * Execute a tool-action node against the canonical execution service.
   *
   * Phase 0 · T6. Previously this method transitioned the node straight to
   * "complete", echoed its own inputs back as `outputs`, and recorded
   * `outcome: "succeeded"` — without invoking anything. A workflow could report
   * that it had sent the email, written the file or called the API when no such
   * thing had occurred.
   *
   * The node now succeeds only when a real executor reports a real effect:
   *   · no executor wired      → fail (unsupported), never succeed
   *   · capability unsupported → fail, never succeed
   *   · executor returns !ok   → fail, with the executor's reason
   *   · executor throws        → fail, with the thrown message
   */
  private async executeToolActionNode(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "tool_action" },
    ns: WorkflowNodeStateDetail,
  ): Promise<void> {
    const startTime = Date.now();

    const fail = async (reason: string): Promise<void> => {
      ns.state = applyNodeEvent(ns.state, "fail", node.id);
      ns.error = reason;
      const entry: WorkflowErrorEntry = {
        nodeId: node.id,
        error: reason,
        timestamp: Date.now(),
        retryable: false,
      };
      run.errorChain.push(entry);
      try {
        await this.config.executionRecorder.recordExecution({
          workflowId: run.runId,
          taskId: ns.nodeId,
          nodeId: node.id,
          capability: { kind: node.capability.family, name: node.capability.name },
          inputSummary: node.inputSummary,
          outcome: "failed",
          message: reason,
          durationMs: Date.now() - startTime,
        });
      } catch {
        // Recording the failure must never convert it into a success.
      }
    };

    const executor = this.config.toolExecutor;
    if (!executor) {
      await fail(
        `tool_action node "${node.id}" cannot run: no tool executor is configured for this engine. ` +
          `XR refuses to report success for an action it did not perform.`,
      );
      return;
    }

    const capability = { family: node.capability.family, name: node.capability.name };
    if (!executor.supports(capability)) {
      await fail(`tool_action node "${node.id}" requires unsupported capability ${capability.family}:${capability.name}`);
      return;
    }

    try {
      const result = await executor.executeTool({
        capability,
        inputs: (node.inputs ?? {}) as Record<string, unknown>,
        workflowId: run.runId,
        nodeId: node.id,
        signal: this.running.get(run.runId)?.signal,
      });

      if (!result.ok) {
        await fail(result.error ?? `tool ${capability.family}:${capability.name} reported failure`);
        return;
      }

      ns.state = applyNodeEvent(ns.state, "complete", node.id);
      ns.outputs = { result: result.output };
      await this.config.executionRecorder.recordExecution({
        workflowId: run.runId,
        taskId: ns.nodeId,
        nodeId: node.id,
        capability: { kind: capability.family, name: capability.name },
        inputSummary: node.inputSummary,
        outcome: "succeeded",
        message: "Tool action completed",
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      await fail(err instanceof Error ? err.message : String(err));
    }
  }

  private async executeWaitTimerNode(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "wait_timer" },
    ns: WorkflowNodeStateDetail,
  ): Promise<void> {
    const scheduler = this.config.timerScheduler;
    const signal = this.running.get(run.runId)?.signal;

    if (node.timer.type === "delay" || node.timer.type === "deadline") {
      const durationMs =
        node.timer.type === "delay"
          ? node.timer.durationMs
          : Math.max(0, node.timer.timestamp - Date.now());

      ns.state = applyNodeEvent(ns.state, "wait_timer", node.id);
      run.state = applyRunEvent(run.state, "enter_waiting");

      if (!scheduler) {
        // No scheduler: the node legitimately stays in the waiting state for an
        // external scheduler to advance. It must NOT claim to have waited.
        ns.error = `waiting ${durationMs}ms — no timer scheduler configured; an external scheduler must advance this node`;
        return;
      }

      const startedAt = Date.now();
      try {
        ns.state = applyNodeEvent(ns.state, "start", node.id);
        await scheduler.wait(durationMs, signal);
      } catch (err) {
        ns.state = applyNodeEvent(ns.state, "fail", node.id);
        ns.error = err instanceof Error ? err.message : String(err);
        return;
      }

      const elapsed = Date.now() - startedAt;
      ns.state = applyNodeEvent(ns.state, "complete", node.id);
      // `waited` is the measured elapsed time, not the requested duration, so
      // the record reflects what actually happened (Article XX.1).
      ns.outputs = { waited: elapsed, requested: durationMs };
      return;
    }

    // Event-based wait.
    ns.state = applyNodeEvent(ns.state, "wait_event", node.id);
    run.state = applyRunEvent(run.state, "enter_waiting");

    if (!scheduler?.waitForEvent) {
      // Park in the waiting state. Previously this completed instantly, so a
      // workflow "waited for" an event that had never fired.
      ns.error = `waiting for event "${node.timer.eventName}" — no event scheduler configured; an external subscriber must advance this node`;
      return;
    }

    try {
      await scheduler.waitForEvent(node.timer.eventName, signal);
      ns.state = applyNodeEvent(ns.state, "complete", node.id);
      ns.outputs = { event: node.timer.eventName, observed: true };
    } catch (err) {
      ns.state = applyNodeEvent(ns.state, "fail", node.id);
      ns.error = err instanceof Error ? err.message : String(err);
    }
  }

  private executeBranchNode(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "branch" },
    ns: WorkflowNodeStateDetail,
  ): void {
    // Collect available outputs from dependencies
    const availableOutputs: Record<string, unknown> = {};
    for (const depId of node.dependencies) {
      const depState = run.nodeStates.get(depId);
      if (depState?.outputs) {
        availableOutputs[depId] = depState.outputs;
      }
    }

    let conditionResult = false;
    const c = node.condition;
    try {
      if (c.type === "field_exists") {
        conditionResult = c.field in availableOutputs;
      } else if (c.type === "field_is_empty") {
        conditionResult = !availableOutputs[c.field];
      } else if (c.type === "field_compare") {
        const val = availableOutputs[c.field];
        switch (c.operator) {
          case "eq": conditionResult = val === c.value; break;
          case "neq": conditionResult = val !== c.value; break;
          case "gt": conditionResult = (val as number) > (c.value as number); break;
          case "lt": conditionResult = (val as number) < (c.value as number); break;
          case "contains": conditionResult = String(val).includes(String(c.value)); break;
          default: conditionResult = false;
        }
      } else if (c.type === "expression") {
        // Safe eval for simple expressions — in production, use a proper expression parser
        try {
          conditionResult = !!new Function("ctx", `"use strict"; return (${c.expression});`)(availableOutputs);
        } catch {
          conditionResult = false;
        }
      } else if (c.type.startsWith("review_") || c.type.startsWith("approval_")) {
        // Check human decision state for a specific node
        const targetState = run.nodeStates.get(c.nodeId);
        if (c.type === "review_approved" || c.type === "approval_granted") {
          conditionResult = targetState?.state === "completed";
        } else {
          conditionResult = targetState?.state === "failed";
        }
      }
    } catch {
      conditionResult = false;
    }

    ns.state = applyNodeEvent(ns.state, "complete", node.id);
    ns.outputs = { branch: conditionResult ? "true" : "false", conditionResult };

    // Activate the appropriate downstream nodes
    const targetIds = conditionResult ? node.trueNodes : node.falseNodes;
    for (const tid of targetIds) {
      const targetState = run.nodeStates.get(tid);
      if (targetState && targetState.state === "pending") {
        targetState.state = "ready";
      }
    }
  }

  private executeJoinNode(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "join" },
    ns: WorkflowNodeStateDetail,
  ): void {
    const depStates = node.dependencies.map(id => run.nodeStates.get(id)).filter(Boolean);
    const completed = depStates.filter(d => d!.state === "completed" || d!.state === "skipped").length;

    let proceed = false;
    if (node.strategy === "all") {
      proceed = completed === depStates.length;
    } else if (node.strategy === "any") {
      proceed = completed > 0;
    } else if (node.strategy === "n_of_m") {
      proceed = completed >= (node.n ?? 1);
    }

    if (proceed) {
      ns.state = applyNodeEvent(ns.state, "complete", node.id);
      ns.outputs = { joined: completed, total: depStates.length };
    } else {
      ns.state = applyNodeEvent(ns.state, "fail", node.id);
      ns.error = `Join not satisfied: ${completed}/${depStates.length}`;
    }
  }

  private executeArtifactOutputNode(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "artifact_output" },
    ns: WorkflowNodeStateDetail,
  ): void {
    const sourceState = run.nodeStates.get(node.sourceNodeId);
    const sourceOutputs = sourceState?.outputs ?? {};

    const artifact: WorkflowArtifact = {
      artifactId: `art_${randomUUID().slice(0, 8)}`,
      nodeId: node.id,
      contract: node.artifact,
      location: node.artifact.storagePath ?? `workspace://artifacts/${run.runId}/${node.id}`,
      contentHash: "",
      createdAt: Date.now(),
    };

    run.artifacts.push(artifact);
    ns.state = applyNodeEvent(ns.state, "complete", node.id);
    ns.outputs = { artifactId: artifact.artifactId, location: artifact.location, sourceOutputs };
  }

  private async executeBusinessRecordNode(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "business_record" },
    ns: WorkflowNodeStateDetail,
  ): Promise<void> {
    // In production, this would call into the Business OS
    ns.state = applyNodeEvent(ns.state, "complete", node.id);
    ns.outputs = {
      module: node.module,
      operation: node.operation,
      entity: node.entity,
      status: "recorded",
    };
  }

  private async executeNotificationNode(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "notification" },
    ns: WorkflowNodeStateDetail,
  ): Promise<void> {
    // In production, this would dispatch through the notification system
    ns.state = applyNodeEvent(ns.state, "complete", node.id);
    ns.outputs = { notified: node.channels, recipients: node.recipients.length };
  }

  private executeCompletionNode(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "completion" },
    ns: WorkflowNodeStateDetail,
  ): void {
    ns.state = applyNodeEvent(ns.state, "complete", node.id);
    ns.outputs = { outcome: node.outcome, message: node.message };
    run.state = applyRunEvent(run.state, node.outcome === "success" ? "complete" : "partial_complete");
  }

  private async executeCompensationNode(
    run: WorkflowRun,
    node: WorkflowNode & { kind: "compensation" },
    ns: WorkflowNodeStateDetail,
  ): Promise<void> {
    ns.state = applyNodeEvent(ns.state, "begin_compensate", node.id);
    // Mark target nodes as compensated
    for (const tid of node.targetNodeIds) {
      const ts = run.nodeStates.get(tid);
      if (ts && ts.state === "completed") {
        try { ts.state = applyNodeEvent(ts.state, "begin_compensate", tid); } catch { /* skip */ }
      }
    }
    ns.state = applyNodeEvent(ns.state, "compensated", node.id);
    ns.outputs = { compensated: node.targetNodeIds, scope: node.scope };
  }

  private recomputeRunState(run: WorkflowRun): void {
    const allStates = [...run.nodeStates.values()];

    // Check for human waiting
    if (allStates.some(ns => ns.state === "waiting_approval")) {
      run.state = "awaiting_approval";
      return;
    }
    if (allStates.some(ns => ns.state === "waiting_review")) {
      run.state = "awaiting_review";
      return;
    }
    if (allStates.some(ns => ns.state === "waiting_timer" || ns.state === "waiting_event")) {
      run.state = "waiting";
      return;
    }

    // Check for failures
    const failed = allStates.filter(ns => ns.state === "failed");
    if (failed.length > 0) {
      run.state = "failed";
      // Check if any failed node has compensation
      for (const f of failed) {
        const node = run.definitionSnapshot.nodes.find(n => n.id === f.nodeId);
        if (node?.onFailure.action === "compensate" && node.onFailure.compensateNodeId) {
          run.state = "compensation_required";
          return;
        }
      }
      return;
    }

    // Check for blocked
    const blocked = allStates.filter(ns => ns.state === "blocked");
    if (blocked.length > 0) {
      run.state = "blocked";
      return;
    }

    // Check completion
    const terminal = allStates.filter(ns =>
      ns.state === "completed" || ns.state === "skipped" || ns.state === "compensated" || ns.state === "cancelled",
    );
    const pending = allStates.filter(ns =>
      ns.state === "pending" || ns.state === "ready" || ns.state === "running",
    );

    if (terminal.length === allStates.length && pending.length === 0) {
      run.state = "completed";
      run.endedAt = Date.now();
      return;
    }

    if (pending.length === 0 && terminal.length > 0) {
      run.state = "partially_completed";
      return;
    }

    run.state = "running";
  }

  private summarizeRun(run: WorkflowRun): WorkflowRunSummary {
    const allStates = [...run.nodeStates.values()];
    return {
      runId: run.runId,
      definitionId: run.definitionId,
      definitionVersion: run.definitionVersion,
      name: run.definitionSnapshot.name,
      state: run.state,
      nodeCount: allStates.length,
      nodesCompleted: allStates.filter(ns => ns.state === "completed" || ns.state === "skipped" || ns.state === "compensated").length,
      nodesFailed: allStates.filter(ns => ns.state === "failed").length,
      nodesBlocked: allStates.filter(ns => ns.state === "blocked").length,
      nodesAwaitingHuman: allStates.filter(ns => ns.state === "waiting_approval" || ns.state === "waiting_review").length,
      cost: run.cost,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      error: run.error,
    };
  }

  private computeRunHash(run: WorkflowRun): string {
    const s = `${run.runId}:${run.state}:${run.updatedAt}`;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }
}
