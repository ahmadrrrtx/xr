/**
 * XR 4.1 — Unified Execution Fabric: Canonical Types
 *
 * The one execution contract that every consequential action in XR maps to.
 *
 * Design rules:
 *   - Discriminated unions only — no big bag of optional fields.
 *   - All fields are safe to serialize (no secrets, no file handles).
 *   - Payloads are bounded summaries; references point to domain-specific data.
 *   - No `unknown` at the contract boundary without an explicit `kind`.
 */

// ── Identity ──────────────────────────────────────────────────────────────

/** Stable identifiers for a unit of execution. */
export interface ExecutionId {
  /** Unique id for this execution run (e.g. "ex_<random>"). */
  readonly runId: string;
  /** Workspace this execution belongs to. */
  readonly workspaceId: string;
  /** Session id (agent session) when applicable. */
  readonly sessionId?: string;
  /** Workflow/task id when execution is part of a multi-agent workflow. */
  readonly workflowId?: string;
  readonly taskId?: string;
  /** 1-based attempt number. Retries produce a new attempt under the same runId. */
  attempt: number;
  /** Parent run id when this execution is a retry/continuation. */
  readonly parentRunId?: string;
  /** Stable correlation id (same across retries of one logical action). */
  readonly correlationId: string;
}

/** Identity of the actor that initiated the execution. */
export type ActorIdentity =
  | { kind: "user"; userId?: string; source: "cli" | "tui" | "daemon" | "telegram" | "api" }
  | { kind: "agent"; agentId: string; providerId: string; model?: string }
  | { kind: "system"; component: string }
  | { kind: "workflow"; workflowId: string; taskId?: string }
  | { kind: "plugin"; pluginId: string; operation?: string }
  | { kind: "skill"; skillId: string; version?: string }
  | { kind: "mcp"; serverId: string }
  | { kind: "research"; sessionId: string }
  | { kind: "business"; module: string; action?: string };

/** Identity of the capability being executed. */
export interface CapabilityIdentity {
  /** Capability family. */
  kind:
    | "model_call"
    | "core_tool"
    | "control_action"
    | "mcp_tool"
    | "mcp_resource"
    | "mcp_prompt"
    | "plugin_operation"
    | "skill_operation"
    | "workflow_task"
    | "research_operation"
    | "business_action";
  /** Stable name within the family (e.g. tool name, MCP tool name). */
  name: string;
  /** Optional version/variant. */
  version?: string;
  /** For MCP/plugin/skill: owner id (server/plugin/skill). */
  owner?: string;
}

/** Where the execution happens. Phase 2 supports in-process/local only. */
export type Placement =
  | { kind: "in_process"; description?: string }
  | { kind: "local"; description?: string }
  /** Extension boundary for Phase 4/5+ placements. */
  | { kind: "future"; kindName: string; description: string };

// ── Intent & Plan ─────────────────────────────────────────────────────────

/** Requested goal or operation. */
export interface ExecutionIntent {
  /** Human-readable, safe summary. Do NOT store raw secrets or full prompts. */
  summary: string;
  /** Origin/source of the intent. */
  origin: ActorIdentity;
  /** Constraints the caller specified. */
  constraints?: {
    dryRun?: boolean;
    timeoutMs?: number;
    maxAttempts?: number;
    budgetUsd?: number;
    egressAllowlist?: string[];
    cwd?: string;
    mode?: "agent" | "plan" | "ask" | "control" | "research" | "business";
  };
  /** Correlation data back to the caller (safe, e.g. CLI request id). */
  correlationMeta?: Record<string, string>;
}

/** A proposed step / task context. Plan is NOT authority. */
export interface ExecutionPlan {
  /** Domain-specific plan reference / identifier. */
  planId?: string;
  /** One-line rationale/summary for what is about to happen. */
  summary: string;
  /** Risk classification where applicable (control actions). */
  risk?: "safe" | "sensitive" | "destructive";
  /** Preview to show to user for approval (diffs, etc). Safe text only. */
  preview?: string;
  /** Domain-specific plan metadata (referenced, not embedded). */
  reference?: { kind: string; id: string };
}

// ── Policy Decision ───────────────────────────────────────────────────────

/** Result of a policy/approval/budget check. */
export type PolicyDecision =
  | { kind: "allowed"; reason?: string; by?: string; at: number }
  | { kind: "denied"; reason: string; by?: string; at: number; code?: string }
  | { kind: "requires_approval"; requestId: string; reason: string; at: number; preview?: string }
  | { kind: "approval_granted"; requestId: string; by: string; at: number }
  | { kind: "approval_denied"; requestId: string; by: string; reason: string; at: number }
  | { kind: "approval_expired"; requestId: string; at: number }
  | { kind: "budget_blocked"; reason: string; meter?: string; at: number }
  | { kind: "budget_raised"; amountUsd?: number; tokens?: number; at: number }
  | { kind: "unavailable"; reason: string; at: number }
  | { kind: "cancelled"; reason: string; at: number; by?: ActorIdentity }
  | { kind: "expired"; at: number };

/** Normalized approval request (safe — no secrets). */
export interface ApprovalRequest {
  requestId: string;
  capability: CapabilityIdentity;
  reason: string;
  preview?: string;
  /** Safe argument summary (redacted). */
  argsSummary?: string;
  createdAt: number;
  expiresAt?: number;
}

// ── Action ────────────────────────────────────────────────────────────────

/** Classification of idempotency. */
export type IdempotencyClass =
  | "naturally_idempotent"   // Repeating produces same outcome (reads, pure functions).
  | "idempotent_with_key"   // Safe to retry if same idempotency key is used.
  | "non_idempotent"        // May produce duplicate side effects — no silent retry.
  | "unknown_unsafe";       // Unknown — treat as non-idempotent.

/** Metadata about an attempted action. */
export interface ExecutionAction {
  capability: CapabilityIdentity;
  /** Safe, bounded input summary. No secrets, no unlimited payloads. */
  inputSummary: string;
  /** Input size in bytes (approximate), for observability. */
  inputBytes?: number;
  /** Idempotency classification. */
  idempotency: IdempotencyClass;
  /** Idempotency key when applicable. */
  idempotencyKey?: string;
  /** Attempt-specific timeout (ms), if any. */
  timeoutMs?: number;
  /** Whether this is a dry-run (no side effect). */
  dryRun: boolean;
  /** Placement decision. */
  placement: Placement;
  /** Reference to the policy decision that authorized this action. */
  authorizedBy?: {
    decisionKind: PolicyDecision["kind"];
    at: number;
    requestId?: string;
  };
}

// ── Observation ───────────────────────────────────────────────────────────

/** Output/return/status observed from an action. */
export interface ExecutionObservation {
  /** Short safe summary suitable for logs/UIs. */
  summary: string;
  /** Whether the underlying call reported success at the transport level. */
  transportOk: boolean;
  /** Status code / domain status when available. */
  statusCode?: string | number;
  /** Safe size estimate. */
  outputBytes?: number;
  /** Log lines / stderr where relevant (truncated). */
  logs?: string[];
  /** Domain-specific structured metadata (safe, bounded). */
  meta?: Record<string, unknown>;
  /** Did this observation produce output that should be fed back to a model? */
  modelFeedback?: string;
}

// ── Evidence & Artifact ───────────────────────────────────────────────────

/** Source / provenance record for an observation or outcome. */
export interface ExecutionEvidence {
  kind: "tool_output" | "model_response" | "audit_entry" | "file_hash" | "http_response" | "mcp_response" | "control_record" | "domain_record";
  reference: string; // audit id, hash, path, url, etc.
  recordedAt: number;
  /** Optional safe metadata (hash, status code, content-type). */
  meta?: Record<string, unknown>;
}

/** Reference to a durable artifact produced by the execution. */
export interface ExecutionArtifact {
  kind: "file" | "report" | "memory" | "db_record" | "session_summary" | "research_report" | "url";
  /** Location/reference (path, id, url). */
  ref: string;
  /** Optional content-type / short description. */
  mediaType?: string;
  description?: string;
  sizeBytes?: number;
  recordedAt: number;
}

// ── Cost ──────────────────────────────────────────────────────────────────

export interface ExecutionCost {
  /** Estimated cost before the action, when available. */
  estimatedUsd?: number;
  /** Actual cost charged (USD). */
  actualUsd?: number;
  inTokens?: number;
  outTokens?: number;
  providerId?: string;
  model?: string;
  /** Whether cost was successfully recorded. */
  state: "charged" | "blocked" | "unavailable" | "not_applicable" | "estimated_only";
}

// ── Outcome ───────────────────────────────────────────────────────────────

export type ExecutionOutcomeKind =
  | "succeeded"
  | "failed"
  | "partially_completed"
  | "cancelled"
  | "timed_out"
  | "denied"
  | "budget_stopped"
  | "unavailable"
  | "awaiting_approval"
  | "reconciliation_required"
  | "dry_run_simulated";

export interface ExecutionOutcome {
  kind: ExecutionOutcomeKind;
  /** Short safe message. */
  message: string;
  /** Stopped reason (for agent result compatibility). */
  stoppedReason?: "done" | "max_steps" | "error" | "budget" | "approval";
  /** Structured error summary (when outcome is failure/timeout/...). */
  error?: ExecutionErrorSummary;
  /** When the outcome was finalized. */
  at: number;
}

/** Safe, secret-free error summary attached to an outcome. */
export interface ExecutionErrorSummary {
  code: string;
  message: string;
  retryable: boolean;
  /** Whether the side-effect status is unknown (e.g. timeout mid-call). */
  sideEffectUnknown: boolean;
  /** Cause category for triage. */
  category?: "policy" | "validation" | "transport" | "provider" | "timeout" | "cancellation" | "unknown";
  detail?: Record<string, unknown>;
}

// ── Execution record ──────────────────────────────────────────────────────

/** State of an execution in the fabric state machine. */
export type ExecutionState =
  | "created"
  | "planned"
  | "awaiting_policy"
  | "awaiting_approval"
  | "authorized"
  | "queued"
  | "running"
  | "observing"
  | "succeeded"
  | "partially_completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "denied"
  | "budget_blocked"
  | "unavailable"
  | "reconciliation_required";

/** One historical state transition. */
export interface ExecutionTransition {
  from: ExecutionState | null;
  to: ExecutionState;
  at: number;
  reason?: string;
}

/** A complete execution record (in-memory and persisted as JSON). */
export interface ExecutionRecord {
  id: ExecutionId;
  state: ExecutionState;
  actor: ActorIdentity;
  intent: ExecutionIntent;
  plan?: ExecutionPlan;
  /** Policy/approval decisions recorded in order. */
  policy: PolicyDecision[];
  action?: ExecutionAction;
  observation?: ExecutionObservation;
  evidence: ExecutionEvidence[];
  artifacts: ExecutionArtifact[];
  cost?: ExecutionCost;
  outcome?: ExecutionOutcome;
  /** State history. */
  history: ExecutionTransition[];
  /** Timing markers. */
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  /** Adapter/version tag for migration/debug. */
  adapterVersion: string;
  /** Any duplicate-detection metadata. */
  duplicateOf?: string;
  /** Cancellation tracking. */
  cancellation?: {
    requested: boolean;
    requestedAt?: number;
    reason?: string;
    /** True if the underlying action acknowledged cancellation. */
    acknowledged?: boolean;
    /** True if a side effect may have occurred before cancellation. */
    sideEffectPossible?: boolean;
  };
  /** Timeout tracking. */
  timeout?: {
    deadlineMs?: number;
    firedAt?: number;
    stage: "before_action" | "during_action" | "after_unknown";
  };
  /** Retry linkage. */
  retryOf?: string;
  retryCount?: number;
}

// ── Safe summaries (for CLI/daemon/UX) ────────────────────────────────────

/** Safe, bounded view safe to display and send over APIs. */
export interface ExecutionSummary {
  runId: string;
  correlationId: string;
  state: ExecutionState;
  outcome?: ExecutionOutcomeKind;
  capability: string;        // `${kind}:${name}`
  actor: string;
  sessionId?: string;
  workflowId?: string;
  taskId?: string;
  attempt: number;
  placement: string;
  createdAt: number;
  updatedAt: number;
  durationMs?: number;
  costUsd?: number;
  message?: string;
  dryRun?: boolean;
}

// ── Options / constraints passed into the service ─────────────────────────

export interface ExecuteOptions {
  /** Pre-specified run id; service generates one when omitted. */
  runId?: string;
  /** Pre-specified correlation id; derived from runId when omitted. */
  correlationId?: string;
  /** Workspace id (required — every execution is scoped to a workspace). */
  workspaceId: string;
  sessionId?: string;
  workflowId?: string;
  taskId?: string;
  actor: ActorIdentity;
  intent: ExecutionIntent;
  plan?: ExecutionPlan;
  capability: CapabilityIdentity;
  placement?: Placement;
  /**
   * Idempotency classification and key. The fabric will refuse a retry that
   * would silently duplicate a non-idempotent side effect.
   */
  idempotency: IdempotencyClass;
  idempotencyKey?: string;
  /** Input summary — must already be redacted. */
  inputSummary: string;
  inputBytes?: number;
  /** Action timeout. */
  timeoutMs?: number;
  dryRun?: boolean;
  /** Maximum automatic retry attempts. 0 = no retry. */
  maxAttempts?: number;
  /** Retry policy hook: returns true if the error is retryable AND side effect is safe to retry. */
  isRetryable?: (err: Error, attempt: number) => boolean | Promise<boolean>;
  /** Backoff between retries in ms. */
  retryBackoffMs?: number;
  /** Existing ToolContext-like approval hook (bridges to policy). */
  approve?: (req: ApprovalRequest) => Promise<boolean>;
  /** Budget check hook — throws or returns false to block. */
  checkBudget?: () => { allow: boolean; reason?: string; suggestLocal?: boolean; warning?: string; meter?: string } | Promise<{ allow: boolean; reason?: string; suggestLocal?: boolean; warning?: string; meter?: string }>;
  /** Audit sink (existing audit repo). */
  audit?: (event: string, detail: Record<string, unknown>) => void;
  /** Cost recording sink (existing cost repo). */
  recordCost?: (cost: { provider: string; model?: string; inTokens: number; outTokens: number; usd: number }) => void;
  /** The actual operation to execute. MUST throw on failure; MUST return an observation on success. */
  run: (ctx: ExecutionRunContext) => Promise<ExecutionObservation>;
}

/** Context provided to the `run` callback. */
export interface ExecutionRunContext {
  /** Signal: true if cancellation was requested. */
  isCancelled: () => boolean;
  /** Returns a DeadlineReached-like reason; null if not timed out. */
  deadlineRemainingMs: () => number;
  /** Emits a progress event (not persisted as durable state). */
  progress: (msg: string, meta?: Record<string, unknown>) => void;
  /** Attach an evidence record. */
  addEvidence: (e: Omit<ExecutionEvidence, "recordedAt">) => void;
  /** Attach an artifact reference. */
  addArtifact: (a: Omit<ExecutionArtifact, "recordedAt">) => void;
  /** Record token usage/cost for the attempt (charged once). */
  recordUsage: (u: { inTokens: number; outTokens: number; usd?: number; provider?: string; model?: string; estimatedUsd?: number }) => void;
}

/** Events emitted as an execution progresses (for CLI/daemon streaming). */
export type ExecutionEvent =
  | { type: "transition"; runId: string; from: ExecutionState | null; to: ExecutionState; at: number }
  | { type: "progress"; runId: string; message: string; meta?: Record<string, unknown>; at: number }
  | { type: "awaiting_approval"; runId: string; request: ApprovalRequest; at: number }
  | { type: "outcome"; runId: string; outcome: ExecutionOutcome; at: number };

/** Listener signature for execution events. */
export type ExecutionListener = (event: ExecutionEvent) => void;

// ── Query filter for history ──────────────────────────────────────────────

export interface ExecutionQuery {
  workspaceId: string;
  sessionId?: string;
  workflowId?: string;
  taskId?: string;
  state?: ExecutionState | ExecutionState[];
  capabilityKind?: CapabilityIdentity["kind"];
  actorKind?: ActorIdentity["kind"];
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
  offset?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────

/** Payload/field size bounds for safe persistence. */
export const EXECUTION_BOUNDS = {
  MAX_SUMMARY_CHARS: 2000,
  MAX_INPUT_SUMMARY_CHARS: 4000,
  MAX_OBSERVATION_SUMMARY_CHARS: 4000,
  MAX_LOG_LINE_CHARS: 1000,
  MAX_LOGS: 10,
  MAX_MESSAGE_CHARS: 1000,
  MAX_EVIDENCE: 16,
  MAX_ARTIFACTS: 16,
  MAX_POLICY_DECISIONS: 16,
  DEFAULT_HISTORY_LIMIT: 100,
  MAX_HISTORY_LIMIT: 1000,
  DEFAULT_TIMEOUT_MS: 120_000,
  MAX_TIMEOUT_MS: 600_000,
  MAX_ATTEMPTS: 5,
} as const;

/** Adapter version stamped on every execution record in 4.1. */
export const EXECUTION_ADAPTER_VERSION = "xr-4.1.0";
