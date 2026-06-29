/**
 * XR Stage 12 — deterministic workflow compiler.
 *
 * This file turns a high-level user goal into an explicit task graph with
 * dependencies, review checkpoints, parallel branches, and handoff reasons.
 * The runtime may enrich execution with model-based work, but the graph itself
 * stays explainable and stable.
 */

import { randomUUID } from "node:crypto";
import { getAgentByRole } from "./registry.ts";
import type {
  AgentDefinition,
  AgentRole,
  WorkflowKind,
  WorkflowPlanRequest,
  WorkflowRecord,
  WorkflowSummary,
  WorkflowTask,
  WorkflowAuditEvent,
} from "./types.ts";

function audit(actor: string, kind: WorkflowAuditEvent["kind"], message: string, detail?: Record<string, unknown>): WorkflowAuditEvent {
  return {
    id: `evt_${randomUUID().slice(0, 8)}`,
    ts: Date.now(),
    actor,
    kind,
    message,
    detail,
  };
}

function createTask(
  workflowId: string,
  role: AgentRole,
  name: string,
  description: string,
  opts: {
    phase: string;
    dependencies?: string[];
    parallelKey?: string;
    inputs?: Record<string, unknown>;
    delegatedReason?: string;
    requiresReview?: boolean;
    parentTaskId?: string;
  },
): WorkflowTask {
  const agent = getAgentByRole(role);
  if (!agent) throw new Error(`No built-in agent registered for role: ${role}`);
  return createTaskFromAgent(workflowId, agent, name, description, opts);
}

function createTaskFromAgent(
  workflowId: string,
  agent: AgentDefinition,
  name: string,
  description: string,
  opts: {
    phase: string;
    dependencies?: string[];
    parallelKey?: string;
    inputs?: Record<string, unknown>;
    delegatedReason?: string;
    requiresReview?: boolean;
    parentTaskId?: string;
  },
): WorkflowTask {
  const ts = Date.now();
  const taskId = `t_${randomUUID().slice(0, 8)}`;
  return {
    workflowId,
    taskId,
    agentId: agent.id,
    role: agent.role,
    name,
    description,
    parentTaskId: opts.parentTaskId,
    dependencies: [...(opts.dependencies ?? [])],
    status: (opts.dependencies?.length ?? 0) > 0 ? "pending" : "ready",
    inputs: { ...(opts.inputs ?? {}) },
    errors: [],
    createdAt: ts,
    updatedAt: ts,
    retryCount: 0,
    maxRetries: 1,
    permissions: { ...agent.permissions },
    toolScope: { ...agent.toolScope, tools: [...agent.toolScope.tools] },
    memoryScope: { ...agent.memoryScope },
    providerScope: { ...agent.providerScope },
    reviewState: opts.requiresReview ? "pending" : "not_required",
    approvalState: "not_required",
    auditTrail: [audit(agent.id, "task.created", `${agent.label} task created`, { name, phase: opts.phase })],
    handoffHistory: [],
    cancellationState: "active",
    parallelKey: opts.parallelKey,
    phase: opts.phase,
    delegatedReason: opts.delegatedReason,
    requiresReview: opts.requiresReview ?? false,
  };
}

export function detectWorkflowKind(goal: string): WorkflowKind {
  const q = goal.toLowerCase();
  if (/(threat|security|vuln|audit|cve|hardening|sandbox|permissions?)/i.test(q)) return "security";
  if (/(research|investigate|compare|study|analyze market|benchmark|literature)/i.test(q)) return "research";
  if (/(browser|computer|click|open app|automation|desktop|fill form|upload|download)/i.test(q)) return "automation";
  if (/(refactor|migrate|cleanup|rewrite|rename|restructure)/i.test(q)) return "refactor";
  if (/(build|implement|code|feature|fix|test|package|repo|repository|typescript|bun|react|next)/i.test(q)) return "build";
  if (/(sales|support|ops|business|proposal|customer)/i.test(q)) return "business";
  return "general";
}

function planSummary(kind: WorkflowKind): string {
  switch (kind) {
    case "research":
      return "Supervisor prepares memory + safety context, the planner defines the investigation, researchers gather evidence in parallel, reviewer critiques evidence quality, then the synthesizer produces the final report.";
    case "build":
      return "Supervisor prepares memory + safety context, the planner scopes the implementation, research/security analysis runs in parallel, the builder implements changes, reviewer and security checker critique independently, then the synthesizer delivers the final answer.";
    case "refactor":
      return "Supervisor prepares memory + safety context, the planner scopes the refactor, repo analysis and risk analysis run in parallel, builder applies the refactor, reviewer and security checker validate, then the synthesizer summarizes the result.";
    case "security":
      return "Supervisor prepares memory + intake checks, the planner defines the security investigation, evidence and threat analysis run in parallel, reviewer validates findings, then the synthesizer delivers the report.";
    case "automation":
      return "Supervisor prepares context, planner defines explicit action steps, security checker validates the requested execution, reviewer gates the plan, executor performs only approved actions, then synthesizer reports what happened.";
    case "business":
      return "Supervisor prepares context, planner scopes the business task, research and counter-analysis run in parallel, reviewer critiques the output, then the synthesizer finalizes the deliverable.";
    default:
      return "Supervisor prepares memory and safety context, planner decomposes the task, specialist agents execute focused subtasks, reviewer critiques outputs, and synthesizer combines reviewed work into the final response.";
  }
}

export function compileWorkflowPlan(req: WorkflowPlanRequest): WorkflowRecord {
  const workflowId = `wf_${randomUUID().slice(0, 8)}`;
  const kind = req.kind ?? detectWorkflowKind(req.goal);
  const createdAt = Date.now();
  const tasks: WorkflowTask[] = [];

  const memoryTask = createTask(
    workflowId,
    "memory_manager",
    "Prepare scoped memory brief",
    "Collect only the memory and project context that downstream agents are allowed to see.",
    {
      phase: "intake",
      inputs: { goal: req.goal },
      delegatedReason: "Workers must not inherit broad memory by default.",
    },
  );
  tasks.push(memoryTask);

  const securityTask = createTask(
    workflowId,
    "security_checker",
    "Run intake safety check",
    "Screen the objective for prompt-injection patterns, destructive intent, and obvious permission risks.",
    {
      phase: "intake",
      inputs: { goal: req.goal },
      parallelKey: "intake",
      delegatedReason: "XR fails closed before delegation when the request looks unsafe.",
      requiresReview: true,
    },
  );
  tasks.push(securityTask);

  const plannerTask = createTask(
    workflowId,
    "planner",
    "Create execution plan",
    "Turn the user objective into an explicit plan, identify dependencies, and surface risks before specialists run.",
    {
      phase: "planning",
      dependencies: [memoryTask.taskId, securityTask.taskId],
      inputs: { goal: req.goal, workflowKind: kind },
      delegatedReason: "The supervisor needs a readable plan before specialist work begins.",
      requiresReview: true,
    },
  );
  tasks.push(plannerTask);

  if (kind === "research" || kind === "security" || kind === "business" || kind === "general") {
    const researchMain = createTask(
      workflowId,
      kind === "security" ? "security_checker" : "researcher",
      kind === "security" ? "Primary security analysis" : "Primary evidence gathering",
      kind === "security"
        ? "Analyze the target from the primary risk perspective and gather concrete findings."
        : "Gather the strongest evidence and repo facts relevant to the user objective.",
      {
        phase: "execution",
        dependencies: [plannerTask.taskId],
        parallelKey: "analysis",
        inputs: { goal: req.goal },
        delegatedReason: "The supervisor needs a focused primary analysis lane.",
      },
    );
    tasks.push(researchMain);

    const researchCounter = createTask(
      workflowId,
      kind === "security" ? "reviewer" : "researcher",
      kind === "security" ? "Challenge primary findings" : "Counter-evidence gathering",
      kind === "security"
        ? "Independently challenge the primary findings and search for overlooked assumptions or false positives."
        : "Search for counterpoints, missing evidence, or contradictory sources.",
      {
        phase: "execution",
        dependencies: [plannerTask.taskId],
        parallelKey: "analysis",
        inputs: { goal: req.goal },
        delegatedReason: "Parallel disagreement improves quality and reduces single-agent tunnel vision.",
      },
    );
    tasks.push(researchCounter);

    const review = createTask(
      workflowId,
      "reviewer",
      "Review evidence package",
      "Critique the evidence quality, point out weak claims, and decide whether synthesis may proceed.",
      {
        phase: "review",
        dependencies: [researchMain.taskId, researchCounter.taskId],
        inputs: { goal: req.goal },
        delegatedReason: "Synthesis must not happen before critique.",
        requiresReview: true,
      },
    );
    tasks.push(review);

    const synth = createTask(
      workflowId,
      "synthesizer",
      "Synthesize final answer",
      "Combine reviewed evidence into a clear final response with risks, confidence, and next steps.",
      {
        phase: "synthesis",
        dependencies: [review.taskId],
        inputs: { goal: req.goal },
        delegatedReason: "Only reviewed work should reach the user-facing synthesis lane.",
      },
    );
    tasks.push(synth);
  } else if (kind === "build" || kind === "refactor") {
    const repoAnalysis = createTask(
      workflowId,
      "researcher",
      "Analyze repository context",
      "Inspect the repository, identify impacted files, conventions, and relevant implementation context.",
      {
        phase: "execution",
        dependencies: [plannerTask.taskId],
        parallelKey: "analysis",
        inputs: { goal: req.goal },
        delegatedReason: "The builder needs repo facts, not broad speculation.",
      },
    );
    tasks.push(repoAnalysis);

    const designRisk = createTask(
      workflowId,
      "security_checker",
      "Assess implementation risk",
      "Check for permission, architecture, and execution risks before code changes are attempted.",
      {
        phase: "execution",
        dependencies: [plannerTask.taskId],
        parallelKey: "analysis",
        inputs: { goal: req.goal },
        delegatedReason: "High-risk changes need a separate safety lane before the builder writes.",
        requiresReview: true,
      },
    );
    tasks.push(designRisk);

    const build = createTask(
      workflowId,
      "builder",
      kind === "refactor" ? "Implement refactor" : "Implement changes",
      kind === "refactor"
        ? "Apply the requested refactor using the plan and repository context."
        : "Implement the requested code or configuration changes in the workspace.",
      {
        phase: "execution",
        dependencies: [repoAnalysis.taskId, designRisk.taskId],
        inputs: { goal: req.goal, dryRun: req.dryRun ?? false },
        delegatedReason: "Only the builder lane may write to the repo for this workflow.",
      },
    );
    tasks.push(build);

    const review = createTask(
      workflowId,
      "reviewer",
      "Review implementation quality",
      "Review the implementation for correctness, maintainability, and alignment with the plan.",
      {
        phase: "review",
        dependencies: [build.taskId],
        parallelKey: "post-build-review",
        inputs: { goal: req.goal },
        delegatedReason: "Generation and critique must remain separate.",
        requiresReview: true,
      },
    );
    tasks.push(review);

    const securityReview = createTask(
      workflowId,
      "security_checker",
      "Review implementation safety",
      "Review the changed workspace for obvious security regressions, dangerous patterns, or permission drift.",
      {
        phase: "review",
        dependencies: [build.taskId],
        parallelKey: "post-build-review",
        inputs: { goal: req.goal },
        delegatedReason: "Code review is not the same as security review.",
        requiresReview: true,
      },
    );
    tasks.push(securityReview);

    const synth = createTask(
      workflowId,
      "synthesizer",
      "Prepare final delivery",
      "Summarize the implementation, review findings, risks, and any follow-up actions.",
      {
        phase: "synthesis",
        dependencies: [review.taskId, securityReview.taskId],
        inputs: { goal: req.goal },
        delegatedReason: "Only reviewed implementation work should be surfaced to the user.",
      },
    );
    tasks.push(synth);
  } else if (kind === "automation") {
    const review = createTask(
      workflowId,
      "reviewer",
      "Review execution plan",
      "Review the planned automation for ambiguity and operator safety before anything executes.",
      {
        phase: "review",
        dependencies: [plannerTask.taskId],
        inputs: { goal: req.goal },
        delegatedReason: "Automation must be reviewed before side effects.",
        requiresReview: true,
      },
    );
    tasks.push(review);

    const execute = createTask(
      workflowId,
      "executor",
      "Execute approved automation",
      "Perform only the approved automation steps using the narrow executor tool scope.",
      {
        phase: "execution",
        dependencies: [review.taskId],
        inputs: { goal: req.goal, dryRun: req.dryRun ?? false },
        delegatedReason: "Execution is separate from planning and review.",
      },
    );
    tasks.push(execute);

    const synth = createTask(
      workflowId,
      "synthesizer",
      "Summarize execution",
      "Summarize what ran, what was blocked, and any next steps.",
      {
        phase: "synthesis",
        dependencies: [execute.taskId],
        inputs: { goal: req.goal },
        delegatedReason: "The user should receive a transparent execution report.",
      },
    );
    tasks.push(synth);
  }

  const rootTaskIds = tasks.filter((task) => task.dependencies.length === 0).map((task) => task.taskId);

  const record: WorkflowRecord = {
    workflowId,
    kind,
    goal: req.goal,
    status: "planned",
    createdAt,
    updatedAt: createdAt,
    reviewState: "pending",
    approvalState: "not_required",
    cancellationState: "active",
    planSummary: planSummary(kind),
    rootTaskIds,
    tasks,
    errors: [],
    auditTrail: [
      audit("supervisor", "workflow.created", `Workflow planned for ${kind}`, {
        goal: req.goal.slice(0, 200),
        taskCount: tasks.length,
      }),
    ],
    metadata: {
      cwd: req.cwd,
      createdBy: "xr.agents",
      requestedProvider: req.provider,
      requestedModel: req.model,
      dryRun: req.dryRun ?? false,
      mode: "plan",
      tags: [...(req.tags ?? [])],
    },
  };

  return record;
}

export function workflowSummary(record: WorkflowRecord): WorkflowSummary {
  const tasksCompleted = record.tasks.filter((task) => task.status === "completed").length;
  const tasksFailed = record.tasks.filter((task) => task.status === "failed").length;
  const tasksBlocked = record.tasks.filter((task) => task.status === "blocked").length;
  const tasksAwaitingReview = record.tasks.filter((task) => task.status === "awaiting_review").length;
  return {
    workflowId: record.workflowId,
    kind: record.kind,
    goal: record.goal,
    status: record.status,
    reviewState: record.reviewState,
    approvalState: record.approvalState,
    cancellationState: record.cancellationState,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    currentAgentId: record.currentAgentId,
    tasksTotal: record.tasks.length,
    tasksCompleted,
    tasksFailed,
    tasksBlocked,
    tasksAwaitingReview,
  };
}

export function renderWorkflowPlan(record: WorkflowRecord): string {
  const lines: string[] = [];
  lines.push(`workflow ${record.workflowId} · ${record.kind}`);
  lines.push(`goal: ${record.goal}`);
  lines.push(`plan: ${record.planSummary}`);
  lines.push("");
  for (const task of record.tasks) {
    const deps = task.dependencies.length ? ` ← ${task.dependencies.join(", ")}` : "";
    const parallel = task.parallelKey ? ` · parallel:${task.parallelKey}` : "";
    const review = task.requiresReview ? " · review-gate" : "";
    lines.push(`- ${task.taskId} · ${task.agentId} · ${task.phase}${parallel}${review}`);
    lines.push(`  ${task.name}${deps}`);
    lines.push(`  ${task.description}`);
  }
  return lines.join("\n");
}
