/**
 * XR Stage 12 — Multi-agent runtime service.
 *
 * This service is intentionally conservative:
 * - task graphs are explicit and persisted
 * - delegation is role-scoped, not free-form prompt chaining
 * - durable memory is packaged by the memory manager instead of being exposed
 *   wholesale to every worker
 * - review and synthesis are separate steps
 * - cancellation and resume are first-class workflow states
 */

import { randomUUID } from "node:crypto";
import { parseReviewDecision } from "./review-decision.ts";
import { executeWorkflowTask } from "./multi-agent-task-support.ts";
import {
  WorkerGate,
  addDelegatedTask,
  fundWorkflow,
  resolveRootCeilings,
  maybeApplySupervisedFragment,
  mirrorPartitions,
  type FundingResult,
} from "./multi-agent-orchestration.ts";
import { TaskRunLedger, statusToTaskState, type TaskState } from "../execution/task-runtime.ts";
import {
  dependencyById,
  dependenciesReady,
  refreshReadyTasks as refreshReadyTasksCore,
  recomputeWorkflowStatusCore,
} from "./multi-agent-graph.ts";
import { CheckpointRepo } from "../state/repos/checkpoint-repo.ts";
import { PartitionRepo } from "../state/repos/partition-repo.ts";
import { ServiceRegistry } from "../core/service-registry.ts";
import { Tokens } from "../core/tokens.ts";
import type { LifecycleHook } from "../core/lifecycle.ts";
import { CoreEvents, type EventBus } from "../core/event-bus.ts";
import { AgentService } from "./agent-service.ts";
import { AuditRepo } from "../state/repos/audit-repo.ts";
import { WorkflowRepo } from "../state/repos/workflow-repo.ts";
import { WorkspaceStore } from "../state/workspace-store.ts";
import { loadConfig } from "../config/config.ts";
import { workflowSummary } from "../agents/planner.ts";
import { planningService } from "./planning-service.ts";
import {
  getAgentByRole,
  getAgentDefinition,
  hasAgent,
  listAgents,
} from "../agents/registry.ts";
import type {
  AgentDefinition,
  AgentExecutionOutput,
  MultiAgentHealth,
  ReviewState,
  WorkflowPlanRequest,
  WorkflowRecord,
  WorkflowRunRequest,
  WorkflowStatus,
  WorkflowSummary,
  WorkflowTask,
} from "../agents/types.ts";

export class MultiAgentService implements LifecycleHook {
  constructor(private registry: ServiceRegistry) {}

  /**
   * A-19 — live runs on THIS service instance, by workflow id: stop reaches an
   * in-flight run by mutating its LIVE record (boundary) and aborting its
   * controller (mid-step). Cross-process cancels stay boundary-checked on the
   * durable record. Phase 6 adds per-run task ledgers (Step 1) alongside.
   */
  private workflowRuns = new Map<
    string,
    { controller: AbortController; record: WorkflowRecord; ledgers: Map<string, TaskRunLedger> }
  >();

  /**
   * Phase 6 · Step 7 — the process-global worker gate. Created from config on
   * first use; `concurrentWorkers` caps TOTAL parallel workers across every
   * workflow this instance runs, `perWorkflowWorkers` the lane cap inside one
   * tree. Exhaustion queues; the bounded wait converts starvation into an
   * honest per-task failure instead of a deadlock.
   */
  private workerGate: WorkerGate | undefined;

  /**
   * Phase 6 · Step 2 — partition ledger view over the unified store. Lazily
   * built; a store without migration 8 (fresh-test fixture) degrades to the
   * legacy per-worker budget path WITH an audit record, never silently.
   */
  private partitionLedger(): PartitionRepo {
    return new PartitionRepo(this.unifiedStore);
  }

  private checkpoints(): CheckpointRepo {
    return new CheckpointRepo(this.unifiedStore);
  }

  private gate(): WorkerGate {
    if (!this.workerGate) {
      let cap = 4;
      let lane = 4;
      try {
        const orch = loadConfig().config.orchestration;
        cap = orch.concurrentWorkers;
        lane = orch.perWorkflowWorkers;
      } catch {
        /* defaults are the conservative ones */
      }
      this.workerGate = new WorkerGate(cap, lane);
    }
    return this.workerGate;
  }

  private get workflowStore(): WorkflowRepo {
    return this.registry.resolve(Tokens.WorkflowStore);
  }

  private get auditStore(): AuditRepo {
    return this.registry.resolve(Tokens.AuditStore);
  }

  private get unifiedStore(): WorkspaceStore {
    return this.registry.resolve(Tokens.Store);
  }

  private get events(): EventBus {
    return this.registry.resolve(Tokens.Events);
  }

  private get agentService(): AgentService {
    return this.registry.resolve(Tokens.Agent);
  }

  listAgents(includeDisabled = true): AgentDefinition[] {
    return listAgents({ includeDisabled });
  }

  inspectAgent(id: string): AgentDefinition | undefined {
    return getAgentDefinition(id);
  }

  planWorkflow(req: WorkflowPlanRequest): WorkflowRecord {
    // Phase 2 · T4 — the single planning authority (adds the schema gate
    // this path never had).
    const planned = planningService.planWorkflow(req).plan;
    this.persist(planned, "workflow.created", {
      workflowId: planned.workflowId,
      kind: planned.kind,
      mode: "plan",
    });
    return planned;
  }

  getWorkflow(workflowId: string): WorkflowRecord | null {
    return this.workflowStore.getWorkflow(workflowId);
  }

  listWorkflows(limit = 20): WorkflowSummary[] {
    return this.workflowStore.listWorkflowSummaries(limit);
  }

  async runWorkflow(req: WorkflowRunRequest): Promise<WorkflowRecord> {
    const record = this.planWorkflow(req);
    record.metadata.mode = "run";
    record.metadata.requestedProvider = req.provider;
    record.metadata.requestedModel = req.model;
    return await this.executeWorkflow(record, req);
  }

  async resumeWorkflow(workflowId: string, req: Partial<WorkflowRunRequest> = {}): Promise<WorkflowRecord> {
    const record = this.requireWorkflow(workflowId);
    if (record.status === "completed") return record;
    record.cancellationState = "active";
    record.status = record.status === "cancelled" ? "paused" : record.status;
    record.errors = record.errors.filter((e) => !e.startsWith("cancelled:"));
    for (const task of record.tasks) {
      if (task.status === "failed" && task.retryCount < task.maxRetries) {
        task.status = task.dependencies.length ? "pending" : "ready";
        task.errors = [];
        task.endedAt = undefined;
        task.updatedAt = Date.now();
        task.retryCount += 1;
      }
      if (task.status === "cancelled") {
        task.status = task.dependencies.length ? "pending" : "ready";
        task.cancellationState = "active";
        task.endedAt = undefined;
        task.updatedAt = Date.now();
      }
    }
    record.updatedAt = Date.now();
    this.persist(record, "workflow.updated", { workflowId, action: "resume" });
    return await this.executeWorkflow(record, req);
  }

  stopWorkflow(workflowId: string): WorkflowRecord {
    const record = this.requireWorkflow(workflowId);
    record.cancellationState = "requested";
    record.updatedAt = Date.now();
    for (const task of record.tasks) {
      if (task.status === "pending" || task.status === "ready") {
        task.cancellationState = "requested";
        task.updatedAt = record.updatedAt;
      }
    }
    // A-19 — reach the in-flight run on THIS instance: flip its LIVE record
    // (the persisted flip above never reaches it) and abort its workers.
    const live = this.workflowRuns.get(workflowId);
    if (live) {
      live.record.cancellationState = "requested";
      live.record.updatedAt = Date.now();
      for (const task of live.record.tasks) {
        if (task.status === "pending" || task.status === "ready") {
          task.cancellationState = "requested";
          task.updatedAt = live.record.updatedAt;
        }
      }
      live.controller.abort();
    }
    this.persist(record, "workflow.cancel_requested", { workflowId });
    return record;
  }

  async delegateTask(workflowId: string, agentId: string, instruction: string): Promise<WorkflowRecord> {
    if (!hasAgent(agentId)) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    const record = this.requireWorkflow(workflowId);
    const agent = getAgentDefinition(agentId)!;
    const { task } = addDelegatedTask(record, agent, instruction);
    record.updatedAt = Date.now();
    this.persist(record, "handoff", {
      workflowId,
      taskId: task.taskId,
      toAgent: agentId,
      reason: "manual-delegate",
    });
    return record;
  }

  async synthesizeWorkflow(workflowId: string): Promise<WorkflowRecord> {
    const record = this.requireWorkflow(workflowId);
    if (record.finalOutput?.summary) return record;
    const synth = [...record.tasks].reverse().find((task) => task.role === "synthesizer");
    if (!synth) return record;
    if (synth.status === "completed") {
      record.finalOutput = synth.outputs;
      record.updatedAt = Date.now();
      this.persist(record, "workflow.updated", { workflowId, action: "use-existing-synthesis" });
      return record;
    }
    if (!this.dependenciesReady(synth, record)) {
      throw new Error(`Synthesis cannot run yet for workflow ${workflowId}`);
    }
    await this.executeTask(record, synth, {});
    this.recomputeWorkflowStatus(record);
    this.persist(record, "workflow.updated", { workflowId, action: "synthesize" });
    return record;
  }

  reviewStatus(workflowId: string): Array<Pick<WorkflowTask, "taskId" | "agentId" | "name" | "status" | "reviewState" | "blockedReason" | "outputs">> {
    const record = this.requireWorkflow(workflowId);
    return record.tasks
      .filter((task) => task.role === "reviewer" || task.role === "security_checker")
      .map((task) => ({
        taskId: task.taskId,
        agentId: task.agentId,
        name: task.name,
        status: task.status,
        reviewState: task.reviewState,
        blockedReason: task.blockedReason,
        outputs: task.outputs,
      }));
  }

  health(): MultiAgentHealth {
    const base = this.workflowStore.health();
    const agents = this.listAgents(true);
    return {
      enabledAgents: agents.filter((agent) => agent.enabledByDefault).length,
      totalAgents: agents.length,
      workflows: base.workflows,
    };
  }

  async onInit(): Promise<void> {}
  async onStart(): Promise<void> {}
  async onStop(): Promise<void> {}

  private requireWorkflow(workflowId: string): WorkflowRecord {
    const record = this.workflowStore.getWorkflow(workflowId);
    if (!record) throw new Error(`Unknown workflow: ${workflowId}`);
    return record;
  }

  private persist(record: WorkflowRecord, event: string, detail: Record<string, unknown>): void {
    record.updatedAt = Date.now();
    this.workflowStore.saveWorkflow(record);
    this.auditStore.audit(`agents.${event}`, detail, record.workflowId);
    this.events.emit(CoreEvents.AgentWorkflowUpdated, workflowSummary(record));
  }

  private emitTaskEvent(
    name: string,
    task: WorkflowTask,
    record: WorkflowRecord,
    extra: Record<string, unknown> = {},
  ): void {
    const eventName = this.normalizeTaskEvent(name);
    this.events.emit(eventName, {
      workflowId: record.workflowId,
      taskId: task.taskId,
      agentId: task.agentId,
      role: task.role,
      phase: task.phase,
      name: task.name,
      status: task.status,
      reviewState: task.reviewState,
      blockedReason: task.blockedReason,
      timestamp: Date.now(),
      ...extra,
    });
  }

  private normalizeTaskEvent(name: string): string {
    switch (name) {
      case CoreEvents.AgentTaskStarted:
      case CoreEvents.AgentTaskReady:
      case CoreEvents.AgentTaskBlocked:
      case CoreEvents.AgentTaskCompleted:
      case CoreEvents.AgentTaskFailed:
      case CoreEvents.AgentTaskNote:
        return name;
      default:
        return CoreEvents.AgentTaskNote;
    }
  }

  private appendWorkflowEvent(record: WorkflowRecord, actor: string, kind: any, message: string, detail?: Record<string, unknown>): void {
    record.auditTrail.push({
      id: `evt_${randomUUID().slice(0, 8)}`,
      ts: Date.now(),
      actor,
      kind,
      message,
      detail,
    });
  }

  private appendTaskEvent(task: WorkflowTask, actor: string, kind: any, message: string, detail?: Record<string, unknown>): void {
    task.auditTrail.push({
      id: `evt_${randomUUID().slice(0, 8)}`,
      ts: Date.now(),
      actor,
      kind,
      message,
      detail,
    });
    task.updatedAt = Date.now();
  }

  private dependencyById(record: WorkflowRecord, taskId: string): WorkflowTask | undefined {
    return dependencyById(record, taskId);
  }

  private dependenciesReady(task: WorkflowTask, record: WorkflowRecord): boolean {
    return dependenciesReady(task, record);
  }

  /** Phase 6 · Step 1 — the DAG state law moved to `multi-agent-graph.ts` (pure, contract-tested). */
  private refreshReadyTasks(record: WorkflowRecord): void {
    refreshReadyTasksCore(record, {
      onReady: (task) => {
        this.appendTaskEvent(task, "supervisor", "task.ready", `${task.name} is ready`, { dependencies: task.dependencies });
        this.emitTaskEvent(CoreEvents.AgentTaskReady, task, record, { dependencies: task.dependencies });
      },
      onBlocked: (task, failedGate) => {
        if (failedGate && task.blockedReason) {
          this.appendTaskEvent(task, "supervisor", "task.blocked", task.blockedReason, { dependency: failedGate.taskId });
        }
        this.emitTaskEvent(CoreEvents.AgentTaskBlocked, task, record, { dependencies: task.dependencies });
      },
    });
  }

  private recomputeWorkflowStatus(record: WorkflowRecord): void {
    recomputeWorkflowStatusCore(record);
  }

  private async executeWorkflow(record: WorkflowRecord, req: Partial<WorkflowRunRequest>): Promise<WorkflowRecord> {
    // A-19 — publish this execution's live record + abort handle. A fresh
    // controller per execution means a resume after a cancelled run is NOT
    // poisoned by the old aborted signal. The entry is removed when the run
    // ends so the map never leaks across runs of the same workflow id.
    this.workflowRuns.set(record.workflowId, { controller: new AbortController(), record, ledgers: new Map() });
    try {
      return await this.executeWorkflowLoop(record, req);
    } finally {
      this.workflowRuns.delete(record.workflowId);
    }
  }

  private async executeWorkflowLoop(record: WorkflowRecord, req: Partial<WorkflowRunRequest>): Promise<WorkflowRecord> {
    record.status = "running";
    record.startedAt = record.startedAt ?? Date.now();

    // ── Phase 6 · Step 5 — OPTIONAL supervised plan-fragment editing ─────
    // Off by default (`orchestration.supervisorEditing`): the deterministic
    // template remains the default of record. When enabled for the kind, the
    // supervisor gets ONE model turn to propose add/rename/skip within the
    // template's declared role set — every accepted edit is a new plan
    // version, every rejected edit is a visible denial. It can never widen
    // roles, tools, or budget: role-set lock + funding headroom check, both
    // enforced in PlanningService.applyPlanFragment against this ledger.
    await this.maybeEditPlanFragment(record, req);

    // ── Phase 6 · Step 2 — fund the tree BEFORE any worker can spend ─────
    // root envelope = the request's budget ceilings; every worker then runs
    // under a PARTITION (Σ child caps ≤ root cap, ledger-enforced). An
    // unfundable task fails the workflow here — at plan time — rather than
    // discovering an empty envelope at its first step.
    const funding = this.fundRecord(record, req);
    if (!funding.ok || funding.denied.length > 0) {
      record.status = "failed";
      record.endedAt = Date.now();
      for (const d of funding.denied) {
        record.errors.push(`budget.partition_denied:${d.childId}:${d.reason}`);
        const task = record.tasks.find((t) => t.taskId === d.childId);
        if (task && (task.status === "pending" || task.status === "ready")) {
          task.status = "failed";
          task.errors.push(`unfunded: ${d.reason}`);
          task.endedAt = Date.now();
        }
      }
      this.persist(record, "workflow.updated", { workflowId: record.workflowId, action: "funding-denied" });
      return record;
    }

    while (true) {
      if (record.cancellationState === "requested") {
        for (const task of record.tasks) {
          if (task.status === "pending" || task.status === "ready") {
            task.status = "cancelled";
            task.cancellationState = "cancelled";
            task.endedAt = Date.now();
          }
        }
        record.status = "cancelled";
        record.endedAt = Date.now();
        record.errors.push(`cancelled:${record.workflowId}`);
        this.events.emit(CoreEvents.AgentWorkflowCancelled, {
          workflowId: record.workflowId,
          status: record.status,
          timestamp: Date.now(),
        });
        this.persist(record, "workflow.cancelled", { workflowId: record.workflowId });
        return record;
      }

      this.refreshReadyTasks(record);
      const ready = record.tasks.filter((task) => task.status === "ready");
      if (!ready.length) {
        this.recomputeWorkflowStatus(record);
        if ((record.status as WorkflowStatus) === "completed") {
          const synth = [...record.tasks].reverse().find((task) => task.role === "synthesizer" && task.outputs);
          if (synth?.outputs) record.finalOutput = synth.outputs;
        }
        this.persist(record, "workflow.updated", { workflowId: record.workflowId, action: "idle" });
        return record;
      }

      // Phase 6 · Step 7 — the batch still starts in one shot, but EVERY
      // worker passes through the gate before touching the model: the global
      // cap (default 4) and the per-workflow lane cap are enforced there, and
      // a worker that waits too long fails honestly. Queueing, never
      // oversubscription; a gate-timeout is bounded, so no deadlock.
      const gate = this.gate();
      const batch = [...ready];
      await Promise.all(
        batch.map(async (task) => {
          let release: (() => void) | undefined;
          try {
            release = await gate.acquire(record.workflowId);
            await this.executeTask(record, task, req, funding);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            task.status = "failed";
            task.errors.push(message);
            task.endedAt = Date.now();
            record.errors.push(`${task.taskId}:${message}`);
          } finally {
            release?.();
          }
        }),
      );
      this.recomputeWorkflowStatus(record);
      this.persist(record, "workflow.updated", { workflowId: record.workflowId, action: "tick" });
      if ((record.status as WorkflowStatus) === "failed" || (record.status as WorkflowStatus) === "blocked") {
        return record;
      }
    }
  }

  private async executeTask(
    record: WorkflowRecord,
    task: WorkflowTask,
    req: Partial<WorkflowRunRequest>,
    funding?: FundingResult,
  ): Promise<void> {
    const agent = getAgentDefinition(task.agentId);
    if (!agent) throw new Error(`Unknown task agent: ${task.agentId}`);

    record.currentAgentId = task.agentId;
    // Phase 6 · Step 1 — the Task Runtime owns the transition; the record
    // mirrors it. Every fire() is audited AND journaled (checkpoint row), so
    // "what state is this task in" and "what proves it" are the same event.
    const ledger = this.ledgerFor(record, task);
    ledger.fire("start", { agentId: task.agentId, phase: task.phase });
    task.status = "running";
    task.startedAt = task.startedAt ?? Date.now();
    task.updatedAt = Date.now();
    this.appendTaskEvent(task, task.agentId, "task.started", `${task.name} started`, { phase: task.phase });
    this.appendWorkflowEvent(record, task.agentId, "handoff", `Supervisor delegated ${task.name} to ${task.agentId}`, {
      taskId: task.taskId,
      role: task.role,
    });
    task.handoffHistory.push({
      id: `handoff_${randomUUID().slice(0, 8)}`,
      fromAgentId: "supervisor",
      toAgentId: task.agentId,
      reason: task.delegatedReason ?? `Delegated to ${task.agentId}`,
      ts: Date.now(),
      payloadSummary: task.description.slice(0, 200),
    });
    this.emitTaskEvent(CoreEvents.AgentTaskStarted, task, record);
    this.persist(record, "workflow.updated", {
      workflowId: record.workflowId,
      taskId: task.taskId,
      action: "task-start",
    });

    try {
      const output = await this.runTask(record, task, agent, req);
      task.outputs = output;
      task.status = "completed";
      task.endedAt = Date.now();
      task.updatedAt = task.endedAt;
      if (task.role === "reviewer" || task.role === "security_checker") {
        task.reviewState = this.inferReviewState(output);
        if (task.reviewState === "changes_requested" || task.reviewState === "rejected") {
          task.blockedReason = output.summary.slice(0, 300);
        }
      } else if (task.role === "verifier") {
        // The verifier gate's outcome IS its completion; approved was already
        // audited as verifier.decided. Keep the review vocabulary coherent.
        task.reviewState = "approved";
      } else {
        // Phase 0 · T10 (audit finding N4): a non-reviewer task completing does
        // not constitute review approval. Leaving it "pending" keeps approval
        // something a reviewer must grant explicitly, not a side effect of
        // finishing work.
        task.reviewState = task.reviewState === "pending" ? "not_required" : task.reviewState;
      }
      this.appendTaskEvent(task, task.agentId, "task.completed", `${task.name} completed`, {
        reviewState: task.reviewState,
      });
      this.emitTaskEvent(CoreEvents.AgentTaskCompleted, task, record, {
        reviewState: task.reviewState,
        summary: output.summary,
      });
      if (task.role === "synthesizer") record.finalOutput = output;
      // honest terminal state through the runtime (succeed → completed; a
      // gated review may park downstream work via recomputeWorkflowStatus)
      if (!ledger.terminal) ledger.fire("succeed", { reviewState: task.reviewState });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      task.status = "failed";
      task.errors.push(message);
      task.endedAt = Date.now();
      task.updatedAt = task.endedAt;
      if (!ledger.terminal) {
        try {
          ledger.fire("fail", { error: message.slice(0, 300) });
        } catch {
          /* an illegal terminal double-transition must not mask the original error */
        }
      }
      this.appendTaskEvent(task, task.agentId, "task.failed", message);
      this.emitTaskEvent(CoreEvents.AgentTaskFailed, task, record, { error: message });
      record.errors.push(`${task.taskId}:${message}`);
    }
  }

  /** One ledger per task per live run; hydrated from persisted status on resume. */
  private ledgerFor(record: WorkflowRecord, task: WorkflowTask): TaskRunLedger {
    const live = this.workflowRuns.get(record.workflowId);
    const existing = live?.ledgers.get(task.taskId);
    if (existing) return existing;
    const ckpt = this.checkpoints();
    const journalKey = `${record.workflowId}/${task.taskId}`;
    const ledger = new TaskRunLedger(journalKey, statusToTaskState(task.status) as TaskState, {
      onTransition: (rec) => {
        this.auditStore.audit(
          "agents.task.transition",
          { workflowId: record.workflowId, taskId: task.taskId, from: rec.from, to: rec.to, event: rec.event, detail: rec.detail },
          record.workflowId,
        );
      },
      onCheckpoint: (kind, payload) => {
        const res = ckpt.append(journalKey, kind, payload);
        if (res) {
          this.auditStore.audit("agents.task.checkpointed", { workflowId: record.workflowId, taskId: task.taskId, kind, seq: res.seq }, record.workflowId);
        }
      },
    });
    live?.ledgers.set(task.taskId, ledger);
    return ledger;
  }

  /**
   * Phase 6 · Step 2 — open the root envelope and cut per-task partitions
   * (idempotent across resumes). The record copy is DISPLAY ONLY; the ledger
   * is the authority. `budget.partitioned` is audited exactly once per
   * workflow lifetime (when new children are created).
   */
  private fundRecord(record: WorkflowRecord, req: Partial<WorkflowRunRequest>): FundingResult {
    let ledger: PartitionRepo | null = null;
    try {
      ledger = this.partitionLedger();
    } catch {
      ledger = null;
    }
    if (!ledger) {
      // Degraded (pre-migration-8 store): legacy per-worker budget path for
      // one release, LOUDLY audited — never silent.
      this.auditStore.audit("agents.budget.partition_unavailable", { workflowId: record.workflowId }, record.workflowId);
      return { ok: true, headroom: { usd: 0, tokens: 0 }, children: [], denied: [] };
    }
    let floors: { floorUsd: number; floorTokens: number; roleWeights?: Partial<Record<string, number>> } = {
      floorUsd: 0.01,
      floorTokens: 1000,
    };
    try {
      const orch = loadConfig().config.orchestration;
      floors = { floorUsd: orch.partitionFloorUsd, floorTokens: orch.partitionFloorTokens, roleWeights: orch.roleWeights };
    } catch {
      /* defaults are the conservative ones */
    }
    const ceilings = resolveRootCeilings(req, loadConfig().config.budget);
    const rootCapUsd = ceilings.capUsd;
    const rootCapTokens = ceilings.capTokens;
    const before = new Set(ledger.listPartitions(record.workflowId).map((r) => r.childId));
    const funding = fundWorkflow(ledger, record, ceilings, floors);
    mirrorPartitions(record, ledger.listPartitions(record.workflowId));
    const created = ledger.listPartitions(record.workflowId).filter((r) => !before.has(r.childId) && r.childId !== "@root");
    if (created.length > 0) {
      this.auditStore.audit(
        "agents.budget.partitioned",
        {
          workflowId: record.workflowId,
          root: { capUsd: rootCapUsd ?? null, capTokens: rootCapTokens ?? null },
          children: created.map((c) => ({ childId: c.childId, agentId: c.agentId, capUsd: c.capUsd, capTokens: c.capTokens })),
          headroom: funding.headroom,
        },
        record.workflowId,
      );
    }
    return funding;
  }

  /**
   * Phase 6 · Step 5 — supervised fragment editing, delegated to the
   * orchestration helper (which is unit-tested directly). The service keeps
   * only the wiring: model turn, headroom source, and the in-place record
   * mutation + persist that the live work loop requires.
   */
  private async maybeEditPlanFragment(record: WorkflowRecord, req: Partial<WorkflowRunRequest>): Promise<void> {
    let orch: ReturnType<typeof loadConfig>["config"]["orchestration"];
    try {
      orch = loadConfig().config.orchestration;
    } catch {
      return;
    }
    let headroom: (() => { usd: number; tokens: number } | null) = () => null;
    try {
      const ledger = this.partitionLedger();
      headroom = () => ledger.headroom(record.workflowId);
    } catch {
      /* legacy path: no ledger, additions denied */
    }
    await maybeApplySupervisedFragment({
      record,
      orch,
      ask: async (prompt) =>
        (await this.agentService.runScopedTask(prompt, "ask", {
          provider: req.provider ?? record.metadata.requestedProvider,
          model: req.model ?? record.metadata.requestedModel,
          budget: req.budget,
          maxSteps: 1,
          memoryEnabled: false,
          agentRole: "supervisor",
          taskId: record.workflowId,
          say: () => {},
        })) as { finalMessage?: string },
      headroom,
      apply: (raw, budgetCheck) => {
        const outcome = planningService.applyPlanFragment(record, raw, {
          withVerifier: orch.verifier && orch.verifierKinds.includes(record.kind),
          maxEdits: orch.maxPlanEdits,
          budgetCheck,
        });
        return outcome.ok
          ? { ok: true as const, record: outcome.record, changes: outcome.changes }
          : { ok: false as const, errors: outcome.errors };
      },
      audit: (event, detail) => this.auditStore.audit(event, detail, record.workflowId),
      onApplied: (next) => {
        record.tasks = next.tasks;
        record.planVersion = next.planVersion;
        record.rootTaskIds = next.rootTaskIds;
        this.persist(record, "workflow.updated", { workflowId: record.workflowId, action: "plan-edited" });
      },
    });
  }

  private ledgerStateFor(record: WorkflowRecord, task: WorkflowTask): TaskState | undefined {
    return undefined;
  }

  /**
   * Resolve a review task's decision.
   *
   * XR launch fix (P0 · audit A-1): deterministic reviewers — currently the
   * security_checker — compute their decision in code and return it under
   * `output.structured.decision`. Prefer that structured value: it is our own
   * code's contract, and re-parsing it out of human-facing prose is what
   * deadlocked every workflow behind a fail-closed "changes_requested".
   *
   * Model-driven reviewers have no structured decision; their prose is parsed
   * by `parseReviewDecision`, which still fails closed on anything that is not
   * an explicit, well-formed JSON decision object. The gate stays fail-closed —
   * only the deterministic path stops tripping it.
   */
  private inferReviewState(output: AgentExecutionOutput): ReviewState {
    const structured = output.structured;
    if (structured && typeof structured === "object") {
      const decision = (structured as Record<string, unknown>).decision;
      if (
        decision === "approved" ||
        decision === "changes_requested" ||
        decision === "rejected"
      ) {
        return decision;
      }
    }
    return parseReviewDecision(output.summary).decision;
  }

  private async runTask(
    record: WorkflowRecord,
    task: WorkflowTask,
    agent: ReturnType<typeof getAgentDefinition>,
    req: Partial<WorkflowRunRequest>,
    funding?: FundingResult,
  ): Promise<AgentExecutionOutput> {
    if (!agent) throw new Error(`Unknown task agent: ${task.agentId}`);
    return await executeWorkflowTask(
      {
        record,
        task,
        agent,
        req,
        funding,
        unifiedStore: this.unifiedStore,
        audit: (event, detail) => this.auditStore.audit(event, detail, record.workflowId),
        runScoped: (prompt, mode, opts) => this.agentService.runScopedTask(prompt, mode, opts),
        workflowSignal: this.workflowRuns.get(record.workflowId)?.controller.signal,
        note: (line) => {
          this.appendTaskEvent(task, task.agentId, "note", line);
          this.emitTaskEvent(CoreEvents.AgentTaskNote, task, record, { note: line });
        },
      },
    );
  }

  // Phase 6 · Steps 1-5: the worker execution semantics moved to
  // `runWorkerTask` (multi-agent-task-support.ts) and the per-worker budget
  // copy is GONE — workers receive an envelope ref resolved by the Governor
  // partition ledger (F-12). `taskRunOptions` retired with it.

}
