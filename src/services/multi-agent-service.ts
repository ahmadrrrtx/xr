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
import { Container } from "../core/container.ts";
import type { LifecycleHook } from "../core/lifecycle.ts";
import type { EventBus } from "../core/event-bus.ts";
import { AgentService } from "./agent-service.ts";
import { AuditStore } from "../state/stores/audit-store.ts";
import { WorkflowStore } from "../state/stores/workflow-store.ts";
import { Store } from "../state/db.ts";
import { MemoryStore, projectScopeFromCwd } from "../memory/store.ts";
import { loadConfig } from "../config/config.ts";
import { scanUntrusted } from "../security/guard.ts";
import {
  compileWorkflowPlan,
  renderWorkflowPlan,
  workflowSummary,
} from "../agents/planner.ts";
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
  constructor(private container: Container) {}

  private get workflowStore(): WorkflowStore {
    return this.container.resolve<WorkflowStore>("workflowStore");
  }

  private get auditStore(): AuditStore {
    return this.container.resolve<AuditStore>("auditStore");
  }

  private get legacyStore(): Store {
    return this.container.resolve<Store>("legacyStore");
  }

  private get events(): EventBus {
    return this.container.resolve<EventBus>("events");
  }

  private get agentService(): AgentService {
    return this.container.resolve<AgentService>("agent");
  }

  listAgents(includeDisabled = true): AgentDefinition[] {
    return listAgents({ includeDisabled });
  }

  inspectAgent(id: string): AgentDefinition | undefined {
    return getAgentDefinition(id);
  }

  planWorkflow(req: WorkflowPlanRequest): WorkflowRecord {
    const planned = compileWorkflowPlan(req);
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
    this.persist(record, "workflow.cancel_requested", { workflowId });
    return record;
  }

  async delegateTask(workflowId: string, agentId: string, instruction: string): Promise<WorkflowRecord> {
    if (!hasAgent(agentId)) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    const record = this.requireWorkflow(workflowId);
    const agent = getAgentDefinition(agentId)!;
    const now = Date.now();
    const leafIds = new Set(record.tasks.map((task) => task.taskId));
    for (const task of record.tasks) {
      for (const dep of task.dependencies) leafIds.delete(dep);
    }
    const deps = [...leafIds];
    const taskId = `t_${randomUUID().slice(0, 8)}`;
    const delegated: WorkflowTask = {
      workflowId,
      taskId,
      agentId: agent.id,
      role: agent.role,
      name: `Delegated: ${instruction.slice(0, 60)}`,
      description: instruction,
      dependencies: deps,
      status: deps.length ? "pending" : "ready",
      inputs: { goal: record.goal, delegatedInstruction: instruction },
      errors: [],
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      maxRetries: 1,
      permissions: { ...agent.permissions },
      toolScope: { ...agent.toolScope, tools: [...agent.toolScope.tools] },
      memoryScope: { ...agent.memoryScope },
      providerScope: { ...agent.providerScope },
      reviewState: "not_required",
      approvalState: "not_required",
      auditTrail: [],
      handoffHistory: [],
      cancellationState: "active",
      phase: "delegated",
      delegatedReason: "Manual delegation requested by the operator.",
    };
    record.tasks.push(delegated);
    record.updatedAt = now;
    this.persist(record, "handoff", {
      workflowId,
      taskId,
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
    this.events.emit("agents.workflow.updated", workflowSummary(record));
  }

  private emitTaskEvent(
    name: string,
    task: WorkflowTask,
    record: WorkflowRecord,
    extra: Record<string, unknown> = {},
  ): void {
    this.events.emit(name, {
      workflowId: record.workflowId,
      taskId: task.taskId,
      agentId: task.agentId,
      role: task.role,
      phase: task.phase,
      name: task.name,
      status: task.status,
      reviewState: task.reviewState,
      blockedReason: task.blockedReason,
      ...extra,
    });
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
    return record.tasks.find((task) => task.taskId === taskId);
  }

  private dependencyApproved(task: WorkflowTask): boolean {
    return (
      task.status === "completed" &&
      task.reviewState !== "changes_requested" &&
      task.reviewState !== "rejected"
    );
  }

  private dependenciesReady(task: WorkflowTask, record: WorkflowRecord): boolean {
    return task.dependencies.every((depId) => {
      const dep = this.dependencyById(record, depId);
      return !!dep && this.dependencyApproved(dep);
    });
  }

  private refreshReadyTasks(record: WorkflowRecord): void {
    for (const task of record.tasks) {
      if (task.status !== "pending") continue;
      const deps = task.dependencies.map((depId) => this.dependencyById(record, depId)).filter(Boolean) as WorkflowTask[];
      const failedGate = deps.find((dep) => dep.reviewState === "changes_requested" || dep.reviewState === "rejected");
      if (failedGate) {
        task.status = "blocked";
        task.blockedReason = `blocked by ${failedGate.taskId} (${failedGate.reviewState})`;
        task.updatedAt = Date.now();
        this.appendTaskEvent(task, "supervisor", "task.blocked", task.blockedReason, { dependency: failedGate.taskId });
        this.emitTaskEvent("agents.task.blocked", task, record, { dependency: failedGate.taskId });
        continue;
      }
      if (deps.every((dep) => dep.status === "completed")) {
        task.status = deps.every((dep) => this.dependencyApproved(dep)) ? "ready" : "blocked";
        task.updatedAt = Date.now();
        if (task.status === "ready") {
          this.appendTaskEvent(task, "supervisor", "task.ready", `${task.name} is ready`, { dependencies: task.dependencies });
          this.emitTaskEvent("agents.task.ready", task, record, { dependencies: task.dependencies });
        } else {
          this.emitTaskEvent("agents.task.blocked", task, record, { dependencies: task.dependencies });
        }
      }
    }
  }

  private recomputeWorkflowStatus(record: WorkflowRecord): void {
    const reviewTasks = record.tasks.filter((task) => task.role === "reviewer" || task.role === "security_checker");
    if (reviewTasks.some((task) => task.reviewState === "rejected")) record.reviewState = "rejected";
    else if (reviewTasks.some((task) => task.reviewState === "changes_requested")) record.reviewState = "changes_requested";
    else if (reviewTasks.length && reviewTasks.every((task) => task.reviewState === "approved" || task.reviewState === "not_required")) record.reviewState = "approved";
    else record.reviewState = "pending";

    if (record.cancellationState === "requested") {
      record.status = "paused";
      return;
    }
    if (record.tasks.some((task) => task.status === "failed")) {
      record.status = "failed";
      return;
    }
    if (record.tasks.some((task) => task.status === "blocked")) {
      record.status = "blocked";
      return;
    }
    if (record.tasks.some((task) => task.status === "awaiting_review")) {
      record.status = "awaiting_review";
      return;
    }
    if (record.tasks.every((task) => task.status === "completed" || task.status === "cancelled")) {
      record.status = "completed";
      record.currentAgentId = undefined;
      record.endedAt = record.endedAt ?? Date.now();
      return;
    }
    record.status = "running";
  }

  private async executeWorkflow(record: WorkflowRecord, req: Partial<WorkflowRunRequest>): Promise<WorkflowRecord> {
    record.status = "running";
    record.startedAt = record.startedAt ?? Date.now();
    this.persist(record, "workflow.updated", { workflowId: record.workflowId, action: "start" });

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
        this.events.emit("agents.workflow.cancelled", {
          workflowId: record.workflowId,
          status: record.status,
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

      const batch = [...ready];
      await Promise.all(batch.map((task) => this.executeTask(record, task, req)));
      this.recomputeWorkflowStatus(record);
      this.persist(record, "workflow.updated", { workflowId: record.workflowId, action: "tick" });
      if ((record.status as WorkflowStatus) === "failed" || (record.status as WorkflowStatus) === "blocked") {
        return record;
      }
    }
  }

  private async executeTask(record: WorkflowRecord, task: WorkflowTask, req: Partial<WorkflowRunRequest>): Promise<void> {
    const agent = getAgentDefinition(task.agentId);
    if (!agent) throw new Error(`Unknown task agent: ${task.agentId}`);

    record.currentAgentId = task.agentId;
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
    this.emitTaskEvent("agents.task.started", task, record);
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
        task.reviewState = this.inferReviewState(output.summary);
        if (task.reviewState === "changes_requested" || task.reviewState === "rejected") {
          task.blockedReason = output.summary.slice(0, 300);
        }
      } else {
        task.reviewState = task.reviewState === "pending" ? "approved" : task.reviewState;
      }
      this.appendTaskEvent(task, task.agentId, "task.completed", `${task.name} completed`, {
        reviewState: task.reviewState,
      });
      this.emitTaskEvent("agents.task.completed", task, record, {
        reviewState: task.reviewState,
        summary: output.summary,
      });
      if (task.role === "synthesizer") record.finalOutput = output;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      task.status = "failed";
      task.errors.push(message);
      task.endedAt = Date.now();
      task.updatedAt = task.endedAt;
      this.appendTaskEvent(task, task.agentId, "task.failed", message);
      this.emitTaskEvent("agents.task.failed", task, record, { error: message });
      record.errors.push(`${task.taskId}:${message}`);
    }
  }

  private inferReviewState(text: string): ReviewState {
    const t = text.toLowerCase();
    if (/\bdecision\s*:\s*rejected\b|\breject(ed)?\b/.test(t)) return "rejected";
    if (/\bdecision\s*:\s*changes_requested\b|changes requested|request changes|needs changes|blocked/i.test(text)) {
      return "changes_requested";
    }
    if (/\bdecision\s*:\s*approved\b|\bapproved\b|\bpass(ed)?\b/.test(t)) return "approved";
    return "approved";
  }

  private buildTaskPacket(record: WorkflowRecord, task: WorkflowTask): string {
    const depSummaries = task.dependencies
      .map((depId) => this.dependencyById(record, depId))
      .filter(Boolean)
      .map((dep) => `- ${dep!.name} (${dep!.agentId}): ${dep!.outputs?.summary ?? "no output"}`)
      .join("\n");

    const memoryBrief = record.tasks
      .find((t) => t.role === "memory_manager" && t.outputs?.summary)
      ?.outputs?.summary;

    return [
      `Workflow: ${record.workflowId}`,
      `Workflow kind: ${record.kind}`,
      `User goal: ${record.goal}`,
      `Assigned task: ${task.name}`,
      `Task description: ${task.description}`,
      task.delegatedReason ? `Why you were delegated: ${task.delegatedReason}` : "",
      memoryBrief ? `Scoped memory brief:\n${memoryBrief}` : "",
      depSummaries ? `Dependency outputs:\n${depSummaries}` : "",
      `Constraints: remain within your role (${task.role}), respect your tool scope, do not impersonate the supervisor, and do not produce a final user answer unless you are the synthesizer.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private buildSystemPrompt(task: WorkflowTask): string {
    switch (task.role) {
      case "planner":
        return [
          "You are XR's Planner agent.",
          "You do not execute. You produce a concise planning memo for the supervisor.",
          "Return plain text with headings: Summary, Risks, Dependencies, Recommended next focus.",
        ].join("\n");
      case "researcher":
        return [
          "You are XR's Researcher agent.",
          "Gather evidence, repo context, or counterpoints only. Do not modify files.",
          "Return plain text with headings: Summary, Evidence, Gaps, Recommendations.",
        ].join("\n");
      case "builder":
        return [
          "You are XR's Builder agent.",
          "Implement the requested workspace changes. Keep edits minimal and deliberate.",
          "After working, return plain text with headings: Summary, Changed Files, Validation, Risks.",
        ].join("\n");
      case "reviewer":
        return [
          "You are XR's Reviewer agent.",
          "You must critique and never execute. Separate review from generation.",
          "Return plain text with headings: Decision: APPROVED or CHANGES_REQUESTED or REJECTED, Summary, Findings, Risks.",
        ].join("\n");
      case "executor":
        return [
          "You are XR's Executor agent.",
          "Execute only the approved task. Do not widen scope or improvise extra actions.",
          "Return plain text with headings: Summary, Actions Taken, Blockers, Risks.",
        ].join("\n");
      case "synthesizer":
        return [
          "You are XR's Synthesizer agent.",
          "Combine reviewed worker outputs into the final answer. Do not do new execution.",
          "Return plain text with headings: Summary, Delivered Result, Risks, Next Steps.",
        ].join("\n");
      default:
        return [
          `You are XR's ${task.role} agent.`,
          "Stay within your role and return a concise structured memo.",
        ].join("\n");
    }
  }

  private roleMode(task: WorkflowTask): "agent" | "plan" | "ask" {
    if (task.role === "builder" || task.role === "executor") return "agent";
    if (task.role === "planner") return "plan";
    return "ask";
  }

  private async runTask(
    record: WorkflowRecord,
    task: WorkflowTask,
    agent: AgentDefinition,
    req: Partial<WorkflowRunRequest>,
  ): Promise<AgentExecutionOutput> {
    if (task.role === "memory_manager") {
      return this.runMemoryManager(record);
    }
    if (task.role === "security_checker") {
      return await this.runSecurityTask(record, task, req);
    }
    if (task.role === "planner") {
      return {
        summary: renderWorkflowPlan(record),
        structured: { workflowId: record.workflowId, kind: record.kind, tasks: record.tasks.length },
        recommendations: [record.planSummary],
      };
    }

    const provider = task.providerScope.provider ?? req.provider ?? record.metadata.requestedProvider;
    const model = task.providerScope.model ?? req.model ?? record.metadata.requestedModel;
    const allow = task.toolScope.mode === "allowlist" ? task.toolScope.tools : undefined;
    const deny = task.toolScope.mode === "denylist" ? task.toolScope.tools : undefined;
    const result = await this.agentService.runScopedTask(
      this.buildTaskPacket(record, task),
      this.roleMode(task),
      {
        provider,
        model,
        budget: req.budget,
        maxTokens: req.maxTokens,
        maxSteps: req.maxSteps ?? (task.role === "builder" || task.role === "executor" ? 12 : 6),
        dryRun: req.dryRun ?? record.metadata.dryRun,
        systemPrompt: this.buildSystemPrompt(task),
        toolsAllow: allow,
        toolsDeny: deny,
        say: (line) => {
          const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
          const text = clean.slice(0, 400);
          this.appendTaskEvent(task, task.agentId, "note", text);
          this.emitTaskEvent("agents.task.note", task, record, { note: text });
        },
        memoryEnabled: false,
      },
    );

    return {
      summary: (result.finalMessage || "No final message produced.").trim(),
      raw: result.finalMessage,
      structured: {
        sessionId: result.sessionId,
        stopped: result.stopped,
        steps: result.steps,
        meter: result.meter,
      },
    };
  }

  private runMemoryManager(record: WorkflowRecord): AgentExecutionOutput {
    const { config } = loadConfig();
    if (!config.memory.enabled) {
      return { summary: "Memory is disabled for this XR installation." };
    }

    const scope = projectScopeFromCwd(record.metadata.cwd);
    const engine = new MemoryStore(this.legacyStore);
    const recalled = engine.recall(record.goal, {
      scope,
      k: 5,
    });
    const items = recalled.slice(0, 5).map((entry) => `- (${entry.category}) ${entry.content}`);
    if (!items.length) {
      return { summary: `No relevant scoped memory was recalled for project scope ${scope}.` };
    }
    return {
      summary: `Scoped memory for ${scope}:\n${items.join("\n")}`,
      structured: {
        scope,
        count: recalled.length,
        ids: recalled.map((entry) => entry.id),
      },
    };
  }

  private async runSecurityTask(
    record: WorkflowRecord,
    task: WorkflowTask,
    req: Partial<WorkflowRunRequest>,
  ): Promise<AgentExecutionOutput> {
    const findings: string[] = [];
    const scan = scanUntrusted(record.goal);
    if (scan.flagged) {
      findings.push(`Prompt-risk signatures detected: ${scan.signatures.join(", ")}`);
    }
    if (record.kind === "automation" && !(req.dryRun ?? record.metadata.dryRun)) {
      findings.push("Automation workflow will perform side effects; review is mandatory.");
    }
    if (/\b(delete|wipe|exfiltrate|steal|post all secrets|rm -rf|format disk)\b/i.test(record.goal)) {
      findings.push("High-risk destructive or exfiltration phrasing detected in the objective.");
    }

    const depSummaries = task.dependencies
      .map((depId) => this.dependencyById(record, depId))
      .filter(Boolean)
      .map((dep) => dep!.outputs?.summary ?? "")
      .join("\n");
    const allText = `${record.goal}\n${depSummaries}`.toLowerCase();

    let decision: ReviewState = "approved";
    if (/post all secrets|steal|exfil/i.test(allText)) decision = "rejected";
    else if (findings.length) decision = "changes_requested";

    const headline =
      decision === "rejected"
        ? "Decision: REJECTED"
        : decision === "changes_requested"
        ? "Decision: CHANGES_REQUESTED"
        : "Decision: APPROVED";

    return {
      summary: [
        headline,
        `Summary: ${findings.length ? findings.join(" ") : "No blocking deterministic security findings."}`,
        "Findings:",
        ...(findings.length ? findings.map((x) => `- ${x}`) : ["- No deterministic blockers found."]),
      ].join("\n"),
      risks: findings,
      structured: { decision, signatures: scan.signatures },
    };
  }
}
