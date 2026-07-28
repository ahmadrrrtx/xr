/**
 * XR 5.0 — Agent and Workflow OS: Canonical Workflow Types
 *
 * This is THE single source of truth for workflow graphs in XR. Every
 * workflow surface (CLI, API, automation, agents, future visual editor)
 * MUST compile to this model.
 *
 * Design rules:
 *   - One canonical graph model; no parallel orchestration systems.
 *   - Definitions are immutable once published (versioned).
 *   - Active runs reference a specific definition version.
 *   - Agent messages are evidence/input, not authority to skip gates.
 *   - Every node links to execution records, context packages, artifacts, and policy.
 */

import type { AgentPermissionProfile, AgentRole, ProviderScope, ToolScope } from "../agents/types.ts";
import type { ContextTier } from "../context/types.ts";
import type { IdempotencyClass } from "../execution/types.ts";

// ── 1. Workflow Definition Version ─────────────────────────────────────────

/** Schema version for the workflow definition format. */
export const WORKFLOW_DEFINITION_SCHEMA_VERSION = "xr-5.0.0/wf-v1";

/**
 * A published, immutable workflow definition. Once published, only the
 * metadata.version changes for new releases. Active runs always reference
 * the exact version they started under.
 */
export interface WorkflowDefinition {
  /** Stable id across versions. */
  readonly definitionId: string;
  /** Human-readable name. */
  name: string;
  description?: string;
  /** Monotonic version number. Starts at 1. */
  version: number;
  /** Schema version this definition was authored against. */
  schemaVersion: string;
  /** The node graph. */
  nodes: WorkflowNode[];
  /** Which node ids are entry points (no inbound dependencies within this def). */
  entryNodeIds: string[];
  /** Expected artifact/output contracts. */
  expectedArtifacts?: ArtifactContract[];
  /** Tags / categories. */
  tags: string[];
  /** Who authored this definition. */
  authoredBy: WorkflowAuthor;
  /** When this version was published. */
  publishedAt: number;
  /** Signature / hash of the definition for integrity. */
  contentHash: string;
  /** Whether this definition is active (new runs can start). */
  active: boolean;
  /** Migration notes when this version supersedes another. */
  supersedes?: string;
  /** Configurable parameters exposed to callers. */
  parameters?: WorkflowParameter[];
}

export interface WorkflowAuthor {
  kind: "user" | "system" | "agent";
  id: string;
  name?: string;
}

export interface WorkflowParameter {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  required: boolean;
  default?: unknown;
  description?: string;
}

// ── 2. Canonical Node Types ────────────────────────────────────────────────

/**
 * Every node in a workflow graph is one of these kinds.
 * The `kind` field is the discriminant — no node is "generic."
 */
export type WorkflowNodeKind =
  | "trigger"
  | "deterministic"
  | "agentic"
  | "human_approval"
  | "human_review"
  | "tool_action"
  | "wait_timer"
  | "branch"
  | "join"
  | "artifact_output"
  | "business_record"
  | "notification"
  | "completion"
  | "compensation";

/**
 * Base fields common to every node.
 */
export interface WorkflowNodeBase {
  /** Unique within the definition. */
  id: string;
  kind: WorkflowNodeKind;
  /** Display label. */
  label: string;
  description?: string;
  /** Node ids that must complete before this node is ready. */
  dependencies: string[];
  /** Idempotency classification for this node's execution. */
  idempotency: IdempotencyClass;
  /** Optional idempotency key template (resolved at runtime). */
  idempotencyKeyTemplate?: string;
  /** Timeout in ms. 0 = no timeout. */
  timeoutMs: number;
  /** Retry configuration. */
  retry: RetryPolicy;
  /** What happens on failure beyond retries. */
  onFailure: FailurePolicy;
  /** Whether this node supports compensation. */
  compensation?: CompensationPolicy;
  /** Metadata for inspection / tooling. */
  metadata?: Record<string, unknown>;
}

export interface RetryPolicy {
  maxRetries: number;
  /** Backoff between retries in ms. */
  backoffMs: number;
  /** Whether to use exponential backoff. */
  exponentialBackoff: boolean;
  /** Which error categories are retryable. */
  retryableErrors: RetryableError[];
}

export type RetryableError = "timeout" | "provider_unavailable" | "transient" | "rate_limited" | "none";

export interface FailurePolicy {
  /** What to do when this node definitively fails. */
  action: "stop_workflow" | "skip" | "escalate" | "compensate" | "continue";
  /** Node ids to trigger on escalation (e.g., notify someone). */
  escalateToNodes?: string[];
  /** Compensation node id (if action includes compensate). */
  compensateNodeId?: string;
}

export interface CompensationPolicy {
  /** Whether compensation is supported at all. */
  supported: boolean;
  /** The node id that performs compensation. */
  nodeId?: string;
  /** What compensation can do. Never claims full rollback where none exists. */
  scope: "none" | "best_effort" | "reversible_action" | "compensating_transaction";
  description: string;
}

// ── 3. Specific Node Types ─────────────────────────────────────────────────

/** Trigger node: entry point driven by an event/schedule/webhook/manual call. */
export interface TriggerNode extends WorkflowNodeBase {
  kind: "trigger";
  trigger: WorkflowTrigger;
}

export type WorkflowTrigger =
  | { type: "manual"; description?: string }
  | { type: "cron"; schedule: string; timezone?: string }
  | { type: "webhook"; path: string; method: "GET" | "POST"; secretRef?: string }
  | { type: "event"; eventName: string; filter?: Record<string, unknown> }
  | { type: "workflow"; sourceWorkflowId: string; sourceNodeId?: string };

/** Deterministic node: pure function, no LLM required. */
export interface DeterministicNode extends WorkflowNodeBase {
  kind: "deterministic";
  /** Reference to the function: e.g. "builtin:transform_json" or "skill:my_skill". */
  functionRef: string;
  /** Schema-validated inputs. */
  inputs: Record<string, unknown>;
  /** Expected output schema (optional). */
  outputSchema?: Record<string, unknown>;
  /** Whether this node has side effects. */
  hasSideEffects: boolean;
}

/** Agentic node: model-driven task executed by an agent role. */
export interface AgenticNode extends WorkflowNodeBase {
  kind: "agentic";
  /** The agent role/identity. */
  agentRole: AgentRole;
  /** Optional specific agent id override. */
  agentId?: string;
  /** Context package scope (tiers the agent may access). */
  contextScope: {
    tiers: ContextTier[];
    includeUserMemory: boolean;
    maxItems?: number;
    maxChars?: number;
  };
  /** Provider/model constraints. */
  providerScope: ProviderScope;
  /** Tool/capability scope. */
  toolScope: ToolScope;
  /** Permissions for this execution. */
  permissions: AgentPermissionProfile;
  /** Budget for this node's execution. */
  budget?: {
    maxUsd?: number;
    maxTokens?: number;
    maxSteps?: number;
  };
  /** Risk classification. */
  riskTier: "low" | "medium" | "high";
  /** Expected outputs / artifacts. */
  expectedOutputs: ArtifactContract[];
  /** Whether this node's output needs human review. */
  requiresReview: boolean;
  /** Whether this node's execution needs human approval beforehand. */
  requiresPreApproval: boolean;
  /** Success criteria (deterministic checks applied to output). */
  successCriteria?: SuccessCriterion[];
  /** The task prompt/instruction. */
  instruction: string;
  /** System prompt override. */
  systemPrompt?: string;
}

export interface SuccessCriterion {
  field: string;
  operator: "exists" | "not_empty" | "contains" | "matches" | "gte" | "lte";
  value?: unknown;
  description: string;
}

/** Human approval node: a person must approve before downstream nodes execute. */
export interface HumanApprovalNode extends WorkflowNodeBase {
  kind: "human_approval";
  /** What is being requested for approval. */
  request: {
    summary: string;
    detail: string;
    /** References to evidence the approver should see. */
    evidenceRefs: EvidenceRef[];
    /** Risk classification of what's being approved. */
    riskLevel: "low" | "medium" | "high";
    /** The scope of what's being approved. */
    scope: string;
  };
  /** Who can approve. */
  approver: ApproverSpec;
  /** How long before the request expires. */
  expiresInMs: number;
  /** What happens on approval. */
  onApproval: { nextNodes: string[] };
  /** What happens on denial. */
  onDenial: { action: "stop_workflow" | "escalate" | "skip"; escalateToNodes?: string[] };
  /** What happens on expiry. */
  onExpiry: { action: "deny" | "escalate" | "auto_approve"; escalateToNodes?: string[] };
}

export interface ApproverSpec {
  /** Who may approve: a specific user, a role, or any human. */
  kind: "any_human" | "specific_user" | "workspace_owner" | "any_reviewer";
  userId?: string;
  role?: string;
}

export interface EvidenceRef {
  kind: "execution_record" | "context_item" | "artifact" | "file" | "url";
  ref: string;
  label: string;
}

/** Human review node: a person reviews output and can request changes. */
export interface HumanReviewNode extends WorkflowNodeBase {
  kind: "human_review";
  /** What is being reviewed. */
  request: {
    summary: string;
    detail: string;
    /** Node ids whose outputs are under review. */
    reviewTargetNodes: string[];
    evidenceRefs: EvidenceRef[];
  };
  /** Who can review. */
  reviewer: ApproverSpec;
  /** How long before the review request expires. */
  expiresInMs: number;
  /** What happens on approve. */
  onApprove: { nextNodes: string[] };
  /** What happens on changes requested. */
  onChangeRequested: { action: "retry_targets" | "escalate"; escalateToNodes?: string[] };
  /** What happens on expiry. */
  onExpiry: { action: "auto_approve" | "escalate" | "block"; escalateToNodes?: string[] };
}

/** Tool action node: capability invocation without an LLM. */
export interface ToolActionNode extends WorkflowNodeBase {
  kind: "tool_action";
  capability: {
    family: "core_tool" | "mcp_tool" | "plugin_operation" | "skill_operation" | "control_action";
    name: string;
    owner?: string;
    version?: string;
  };
  /** Redacted input summary. */
  inputSummary: string;
  /** Raw input (will be redacted before persistence). */
  inputs: Record<string, unknown>;
  /** Risk classification. */
  riskTier: "low" | "medium" | "high";
  /** Whether pre-approval is required. */
  requiresApproval: boolean;
}

/** Wait/timer node: pause the workflow for a duration or until a time. */
export interface WaitTimerNode extends WorkflowNodeBase {
  kind: "wait_timer";
  timer: { type: "delay"; durationMs: number } | { type: "deadline"; timestamp: number } | { type: "event"; eventName: string; timeoutMs?: number };
}

/** Branch/condition node: evaluate a condition and follow one branch. */
export interface BranchNode extends WorkflowNodeBase {
  kind: "branch";
  /** Deterministic condition. */
  condition: BranchCondition;
  /** Node ids to trigger when condition is true. */
  trueNodes: string[];
  /** Node ids to trigger when condition is false. */
  falseNodes: string[];
  /** Default path when condition can't be evaluated. */
  defaultNodes: string[];
}

export type BranchCondition =
  | { type: "field_compare"; field: string; operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in"; value: unknown }
  | { type: "field_exists"; field: string }
  | { type: "field_is_empty"; field: string }
  | { type: "review_approved"; nodeId: string }
  | { type: "review_changes_requested"; nodeId: string }
  | { type: "approval_granted"; nodeId: string }
  | { type: "approval_denied"; nodeId: string }
  | { type: "expression"; expression: string; description: string };

/** Join node: waits for all specified dependencies, then emits. */
export interface JoinNode extends WorkflowNodeBase {
  kind: "join";
  /** Strategy for joining. */
  strategy: "all" | "any" | "n_of_m";
  /** Number required when strategy is n_of_m. */
  n?: number;
  /** Timeout for join (ms). 0 = no timeout. */
  timeoutMs: number;
  /** What happens on timeout. */
  onTimeout: "proceed_partial" | "fail" | "skip";
}

/** Artifact output node: produces a structured artifact. */
export interface ArtifactOutputNode extends WorkflowNodeBase {
  kind: "artifact_output";
  artifact: ArtifactContract;
  /** Which node id produced the raw content. */
  sourceNodeId: string;
}

export interface ArtifactContract {
  /** Artifact kind. */
  type: "report" | "code" | "document" | "dataset" | "configuration" | "evidence_package" | "decision_record" | "custom";
  /** Expected format. */
  format: string;
  /** Schema for validation (optional). */
  schema?: Record<string, unknown>;
  /** Human-readable description. */
  description: string;
  /** Where the artifact is stored. */
  storagePath?: string;
}

/** Business record node: mutates a business module record. */
export interface BusinessRecordNode extends WorkflowNodeBase {
  kind: "business_record";
  /** Business module. */
  module: string;
  /** Operation: create, update, delete. */
  operation: "create" | "update" | "delete";
  /** Entity type. */
  entity: string;
  /** The data to apply. */
  data: Record<string, unknown>;
  /** Whether this is reversible. */
  reversible: boolean;
}

/** Notification node: sends a notification/escalation. */
export interface NotificationNode extends WorkflowNodeBase {
  kind: "notification";
  /** Delivery channel. */
  channels: NotificationChannel[];
  /** Severity. */
  severity: "info" | "warning" | "critical";
  /** Message template. */
  message: string;
  /** Recipients. */
  recipients: NotificationRecipient[];
}

export type NotificationChannel = "dashboard" | "cli" | "webhook" | "email" | "telegram";

export interface NotificationRecipient {
  kind: "user" | "role" | "webhook_url";
  id: string;
}

/** Completion node: marks successful workflow end. */
export interface CompletionNode extends WorkflowNodeBase {
  kind: "completion";
  /** The outcome summary. */
  outcome: "success" | "partial_success" | "no_op";
  /** Final message template. */
  message: string;
}

/** Compensation node: attempts to reverse/compensate prior actions. */
export interface CompensationNode extends WorkflowNodeBase {
  kind: "compensation";
  /** Which node ids to compensate. */
  targetNodeIds: string[];
  /** Compensation scope declaration. */
  scope: CompensationPolicy;
}

/** Union of all node types. */
export type WorkflowNode =
  | TriggerNode
  | DeterministicNode
  | AgenticNode
  | HumanApprovalNode
  | HumanReviewNode
  | ToolActionNode
  | WaitTimerNode
  | BranchNode
  | JoinNode
  | ArtifactOutputNode
  | BusinessRecordNode
  | NotificationNode
  | CompletionNode
  | CompensationNode;

// ── 4. Workflow Run State ──────────────────────────────────────────────────

export type WorkflowRunState =
  | "draft"
  | "published"
  | "queued"
  | "running"
  | "waiting"
  | "awaiting_approval"
  | "awaiting_review"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "partially_completed"
  | "failed"
  | "completed"
  | "compensation_required"
  | "blocked"
  | "expired";

export type WorkflowNodeState =
  | "pending"
  | "ready"
  | "running"
  | "waiting_approval"
  | "waiting_review"
  | "waiting_timer"
  | "waiting_event"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped"
  | "compensating"
  | "compensated"
  | "blocked"
  | "timed_out"
  | "expired";

/** State transition validation — only these transitions are permitted. */
export const VALID_RUN_STATE_TRANSITIONS: Record<WorkflowRunState, readonly WorkflowRunState[]> = {
  draft: ["published"],
  published: ["queued"],
  queued: ["running", "cancelling", "cancelled", "expired"],
  running: ["waiting", "awaiting_approval", "awaiting_review", "paused", "cancelling", "completed", "partially_completed", "failed", "blocked"],
  waiting: ["running", "cancelling", "expired"],
  awaiting_approval: ["running", "cancelling", "failed", "expired"],
  awaiting_review: ["running", "cancelling", "failed", "expired"],
  paused: ["running", "cancelling", "expired"],
  cancelling: ["cancelled", "failed"],
  cancelled: [],
  partially_completed: ["compensation_required", "completed", "failed"],
  failed: ["compensation_required"],
  completed: [],
  compensation_required: ["compensating" as unknown as WorkflowRunState] as any,
  blocked: ["running", "cancelled", "expired"],
  expired: [],
};

export function isValidWorkflowTransition(from: WorkflowRunState, to: WorkflowRunState): boolean {
  const allowed = VALID_RUN_STATE_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

// ── 5. Workflow Run Instance ───────────────────────────────────────────────

/** A concrete run of a workflow definition. */
export interface WorkflowRun {
  /** Unique run id. */
  runId: string;
  /** The definition + version this run is based on. */
  definitionId: string;
  definitionVersion: number;
  /** Current run state. */
  state: WorkflowRunState;
  /** Snapshot of the definition at start time (immutable for this run). */
  definitionSnapshot: WorkflowDefinition;
  /** Per-node execution state. */
  nodeStates: Map<string, WorkflowNodeStateDetail>;
  /** Execution records linked to this run. */
  executionRefs: ExecutionRef[];
  /** Context package ids associated with this run. */
  contextPackageIds: string[];
  /** Artifacts produced during this run. */
  artifacts: WorkflowArtifact[];
  /** Human decisions recorded. */
  humanDecisions: HumanDecision[];
  /** Aggregate cost. */
  cost: WorkflowCost;
  /** Timing. */
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  /** The trigger that initiated this run. */
  initiatedBy: WorkflowTrigger;
  /** Parameters resolved at start time. */
  resolvedParameters: Record<string, unknown>;
  /** The error that caused failure (if any). */
  error?: string;
  /** Error chain for diagnosis. */
  errorChain: WorkflowErrorEntry[];
  /** Run tags. */
  tags: string[];
  /** Policy decisions made during this run. */
  policyDecisions: WorkflowPolicyDecision[];
  /** Content hash for integrity. */
  contentHash: string;
}

export interface WorkflowNodeStateDetail {
  nodeId: string;
  kind: WorkflowNodeKind;
  state: WorkflowNodeState;
  /** Input data snapshot. */
  inputs: Record<string, unknown>;
  /** Output data snapshot. */
  outputs?: Record<string, unknown>;
  /** Error if failed. */
  error?: string;
  /** Attempt count. */
  attempt: number;
  /** Execution ref for this node's execution record. */
  executionRef?: string;
  /** Timing. */
  startedAt?: number;
  endedAt?: number;
  /** Human decision ref if this is a human node. */
  humanDecisionRef?: string;
  /** Retry history. */
  retryHistory: NodeRetryEntry[];
}

export interface NodeRetryEntry {
  attempt: number;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export interface ExecutionRef {
  runId: string;
  nodeId: string;
  executionId: string;
}

export interface WorkflowArtifact {
  artifactId: string;
  nodeId: string;
  contract: ArtifactContract;
  /** Reference to the actual artifact content. */
  location: string;
  /** Content hash. */
  contentHash: string;
  createdAt: number;
}

export interface WorkflowCost {
  estimatedUsd: number;
  actualUsd: number;
  tokensIn: number;
  tokensOut: number;
  breakdown: Record<string, { usd: number; tokensIn: number; tokensOut: number }>;
}

export interface WorkflowErrorEntry {
  nodeId: string;
  error: string;
  timestamp: number;
  retryable: boolean;
}

export interface WorkflowPolicyDecision {
  nodeId: string;
  decision: "allowed" | "denied" | "requires_approval";
  reason: string;
  by: string;
  at: number;
}

// ── 6. Human Decision ──────────────────────────────────────────────────────

export interface HumanDecision {
  decisionId: string;
  runId: string;
  nodeId: string;
  kind: "approval" | "review";
  /** Who made the decision. */
  decidedBy: {
    kind: "user";
    userId: string;
    name?: string;
  };
  /** The decision. */
  decision: HumanDecisionOutcome;
  /** Optional comment. */
  comment?: string;
  /** What evidence was shown to the decider. */
  evidenceShown: EvidenceRef[];
  /** When the request was created. */
  requestedAt: number;
  /** When the decision was made. */
  decidedAt: number;
  /** When the request would have expired. */
  expiresAt: number;
  /** The resulting workflow state transition. */
  resultingTransition: WorkflowRunState;
}

export type HumanDecisionOutcome =
  | { approval: "approved" }
  | { approval: "denied"; reason?: string }
  | { review: "approved" }
  | { review: "changes_requested"; changes: string }
  | { review: "rejected"; reason: string }
  | { expiry: "expired" };

// ── 7. Workflow Inspection ─────────────────────────────────────────────────

export interface WorkflowRunSummary {
  runId: string;
  definitionId: string;
  definitionVersion: number;
  name: string;
  state: WorkflowRunState;
  nodeCount: number;
  nodesCompleted: number;
  nodesFailed: number;
  nodesBlocked: number;
  nodesAwaitingHuman: number;
  cost: WorkflowCost;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export interface WorkflowInspection {
  run: WorkflowRunSummary;
  nodeStates: WorkflowNodeStateDetail[];
  humanDecisions: HumanDecision[];
  artifacts: WorkflowArtifact[];
  executionRefs: ExecutionRef[];
  errorChain: WorkflowErrorEntry[];
}

// ── 8. Helpers ─────────────────────────────────────────────────────────────

export const TERMINAL_RUN_STATES: ReadonlySet<WorkflowRunState> = new Set([
  "completed",
  "cancelled",
  "failed",
  "expired",
]);

export const ACTIVE_RUN_STATES: ReadonlySet<WorkflowRunState> = new Set([
  "queued",
  "running",
  "waiting",
  "awaiting_approval",
  "awaiting_review",
  "paused",
  "cancelling",
  "blocked",
  "compensation_required",
]);

export const HUMAN_WAITING_STATES: ReadonlySet<WorkflowRunState> = new Set([
  "awaiting_approval",
  "awaiting_review",
]);

export function isTerminal(state: WorkflowRunState): boolean {
  return TERMINAL_RUN_STATES.has(state);
}

export function isActive(state: WorkflowRunState): boolean {
  return ACTIVE_RUN_STATES.has(state);
}

export function isAwaitingHuman(state: WorkflowRunState): boolean {
  return HUMAN_WAITING_STATES.has(state);
}

/**
 * Deterministic canonical JSON: object keys sorted recursively, so two
 * structurally identical definitions always serialize identically.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "number" && value === 0 ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([k, v]) => [k, sortDeep(v)]));
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortDeep((value as Record<string, unknown>)[key]);
  }
  return out;
}

/**
 * LEGACY (XR 5.0–6.1) content hash.
 *
 * It covered only `definitionId`, `version`, node `id`+`kind`, and
 * `entryNodeIds`. That means a published definition could be modified —
 * changing a tool's command inputs, its target capability, its risk tier, or
 * flipping `requiresApproval` to false — and still pass `verifyIntegrity`.
 *
 * Retained ONLY so definitions published before XR 7.0 continue to load
 * (no destructive migration). Never use it to hash new definitions.
 *
 * @deprecated Use {@link hashDefinition}.
 */
export function hashDefinitionLegacyV1(def: Omit<WorkflowDefinition, "contentHash" | "publishedAt">): string {
  const canonical = JSON.stringify({
    definitionId: def.definitionId,
    version: def.version,
    nodes: def.nodes.map(n => ({ id: n.id, kind: n.kind })),
    entryNodeIds: def.entryNodeIds,
  });
  return fnv1a(canonical);
}

function fnv1a(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Compute a deterministic content hash over a definition.
 *
 * XR 7.0: this now covers the FULL executable semantics of the definition —
 * every node in its entirety, plus the graph and the definition metadata that
 * affects behaviour. Previously only node id + kind were hashed, so a
 * published workflow's actual commands could be altered undetected.
 *
 * Note on threat model: this is a non-keyed hash, so it provides tamper
 * EVIDENCE against modification of stored/transported definitions, not
 * authenticated integrity against an attacker who can also rewrite the stored
 * hash. Capability/package signing covers that separate case.
 */
export function hashDefinition(def: Omit<WorkflowDefinition, "contentHash" | "publishedAt">): string {
  const canonical = canonicalJson({
    schema: "xr-7.0.0/wf-hash-v2",
    definitionId: def.definitionId,
    name: def.name,
    description: def.description ?? null,
    version: def.version,
    schemaVersion: def.schemaVersion,
    // Full node content — not just id and kind.
    nodes: def.nodes,
    entryNodeIds: def.entryNodeIds,
    expectedArtifacts: def.expectedArtifacts ?? null,
    parameters: def.parameters ?? null,
    tags: def.tags,
    authoredBy: def.authoredBy,
    active: def.active,
    supersedes: def.supersedes ?? null,
  });
  return `v2:${fnv1a(canonical)}${fnv1a(`${canonical.length}:${canonical}`)}`;
}

/** How a definition's stored hash was verified. */
export type DefinitionIntegrityLevel = "v2" | "legacy_v1" | "invalid";

export interface DefinitionIntegrityResult {
  /** True when the stored hash matches under v2 or the retained legacy scheme. */
  valid: boolean;
  level: DefinitionIntegrityLevel;
  detail: string;
}

/**
 * Verify a definition's content hash, reporting WHICH scheme matched.
 *
 * `legacy_v1` means the definition predates XR 7.0 and is only weakly
 * covered: re-publishing it upgrades it to full coverage.
 */
export function checkDefinitionIntegrity(def: WorkflowDefinition): DefinitionIntegrityResult {
  if (def.contentHash === hashDefinition(def)) {
    return { valid: true, level: "v2", detail: "content hash covers the full definition (XR 7.0 scheme)" };
  }
  if (def.contentHash === hashDefinitionLegacyV1(def)) {
    return {
      valid: true,
      level: "legacy_v1",
      detail:
        "definition was published before XR 7.0 and carries a legacy hash that covers only the graph shape " +
        "(node ids and kinds). Re-publish this definition to obtain full-content integrity coverage.",
    };
  }
  return { valid: false, level: "invalid", detail: "content hash does not match the definition" };
}
