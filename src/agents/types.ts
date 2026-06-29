/**
 * XR Stage 12 — Multi-Agent runtime types.
 *
 * The goal of this layer is to make workflows explicit, inspectable,
 * resumable, and safe. These types are intentionally verbose so every agent,
 * task, handoff, permission, and review checkpoint is first-class data.
 */

import type { RoutingStrategy } from "../providers/routing.ts";

export type AgentRole =
  | "supervisor"
  | "planner"
  | "researcher"
  | "builder"
  | "reviewer"
  | "executor"
  | "synthesizer"
  | "memory_manager"
  | "router"
  | "model_selector"
  | "security_checker"
  | "full_stack"
  | "frontend"
  | "backend"
  | "devops"
  | "mobile"
  | "data_ml"
  | "security_analyst"
  | "soc_threat_hunter"
  | "academic_research"
  | "market_research"
  | "business_sales"
  | "support_ops";

export type WorkflowKind =
  | "general"
  | "research"
  | "build"
  | "refactor"
  | "security"
  | "automation"
  | "business";

export type WorkflowStatus =
  | "planned"
  | "running"
  | "awaiting_review"
  | "blocked"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "awaiting_review"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export type ReviewState =
  | "not_required"
  | "pending"
  | "approved"
  | "changes_requested"
  | "rejected";

export type ApprovalState =
  | "not_required"
  | "pending"
  | "approved"
  | "denied";

export type CancellationState = "active" | "requested" | "cancelled";

export type MemoryScopeKind = "none" | "workflow" | "project" | "research" | "user";

export interface MemoryScope {
  kind: MemoryScopeKind;
  /** Whether the supervisor may see/summarize this agent's memory package. */
  sharedWithSupervisor: boolean;
  /** Hard cap on recalled entries for this agent. */
  maxEntries: number;
  /** Whether user/global memory is allowed in this scope. */
  includeUserMemory?: boolean;
}

export interface ToolScope {
  mode: "allowlist" | "denylist";
  tools: string[];
}

export interface AgentPermissionProfile {
  writeFiles: boolean;
  shell: boolean;
  network: boolean;
  plugins: boolean;
  mcp: boolean;
  memoryRead: boolean;
  memoryWrite: boolean;
  computerControl: boolean;
  secrets: boolean;
  destructiveExec: boolean;
}

export interface ProviderScope {
  provider?: string;
  model?: string;
  strategy?: RoutingStrategy;
  fallbacks?: string[];
}

export interface AgentDefinition {
  id: string;
  role: AgentRole;
  label: string;
  description: string;
  version: string;
  enabledByDefault: boolean;
  capabilities: string[];
  permissions: AgentPermissionProfile;
  toolScope: ToolScope;
  memoryScope: MemoryScope;
  providerScope: ProviderScope;
}

export interface WorkflowAuditEvent {
  id: string;
  ts: number;
  actor: string;
  kind:
    | "workflow.created"
    | "workflow.updated"
    | "workflow.cancel_requested"
    | "workflow.cancelled"
    | "task.created"
    | "task.ready"
    | "task.started"
    | "task.completed"
    | "task.failed"
    | "task.blocked"
    | "task.paused"
    | "review.requested"
    | "review.approved"
    | "review.changes_requested"
    | "review.rejected"
    | "handoff"
    | "note";
  message: string;
  detail?: Record<string, unknown>;
}

export interface HandoffRecord {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  reason: string;
  ts: number;
  payloadSummary?: string;
}

export interface AgentExecutionOutput {
  summary: string;
  raw?: string;
  structured?: Record<string, unknown>;
  artifacts?: Array<{ path: string; description?: string }>;
  risks?: string[];
  recommendations?: string[];
}

export interface WorkflowTask {
  workflowId: string;
  taskId: string;
  agentId: string;
  role: AgentRole;
  name: string;
  description: string;
  parentTaskId?: string;
  dependencies: string[];
  status: TaskStatus;
  inputs: Record<string, unknown>;
  outputs?: AgentExecutionOutput;
  errors: string[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  retryCount: number;
  maxRetries: number;
  permissions: AgentPermissionProfile;
  toolScope: ToolScope;
  memoryScope: MemoryScope;
  providerScope: ProviderScope;
  modelChoice?: string;
  reviewState: ReviewState;
  approvalState: ApprovalState;
  auditTrail: WorkflowAuditEvent[];
  handoffHistory: HandoffRecord[];
  cancellationState: CancellationState;
  /** Used by the runtime to fan out tasks that may run together. */
  parallelKey?: string;
  /** Higher-level phase name for CLI/status output. */
  phase?: string;
  /** Human-readable reason this task exists. */
  delegatedReason?: string;
  /** If true, downstream execution must wait for review approval. */
  requiresReview?: boolean;
  /** If a task is blocked, this explains why. */
  blockedReason?: string;
}

export interface WorkflowRecord {
  workflowId: string;
  kind: WorkflowKind;
  goal: string;
  status: WorkflowStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  currentAgentId?: string;
  reviewState: ReviewState;
  approvalState: ApprovalState;
  cancellationState: CancellationState;
  planSummary: string;
  rootTaskIds: string[];
  tasks: WorkflowTask[];
  finalOutput?: AgentExecutionOutput;
  errors: string[];
  auditTrail: WorkflowAuditEvent[];
  metadata: {
    cwd: string;
    createdBy: string;
    requestedProvider?: string;
    requestedModel?: string;
    dryRun?: boolean;
    mode?: "plan" | "run";
    tags?: string[];
  };
}

export interface WorkflowPlanRequest {
  goal: string;
  cwd: string;
  kind?: WorkflowKind;
  provider?: string;
  model?: string;
  dryRun?: boolean;
  tags?: string[];
}

export interface WorkflowRunRequest extends WorkflowPlanRequest {
  budget?: number;
  maxTokens?: number;
  maxSteps?: number;
}

export interface WorkflowSummary {
  workflowId: string;
  kind: WorkflowKind;
  goal: string;
  status: WorkflowStatus;
  reviewState: ReviewState;
  approvalState: ApprovalState;
  cancellationState: CancellationState;
  createdAt: number;
  updatedAt: number;
  currentAgentId?: string;
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksBlocked: number;
  tasksAwaitingReview: number;
}

export interface MultiAgentHealth {
  enabledAgents: number;
  totalAgents: number;
  workflows: {
    total: number;
    running: number;
    paused: number;
    blocked: number;
    failed: number;
  };
}
