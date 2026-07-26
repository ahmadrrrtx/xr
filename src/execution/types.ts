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

import type {
  CredentialRef,
  EnvironmentExecutable,
  TrustRecord,
  TrustRequest,
} from "../trust/types.ts";

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
  // XR 4.2 — risk-tiered placements (see src/trust). Only local placements
  // ship in Phase 3; the contract stays extensible for remote (Phase 11+).
  | { kind: "restricted_process"; description?: string }   // Tier 1 (process restriction, NOT a hard boundary)
  | { kind: "namespace_sandbox"; description?: string }    // Tier 2 (OS namespace sandbox)
  | { kind: "container"; description?: string }            // Tier 2 (container runtime)
  | { kind: "browser_isolated"; description?: string }     // Tier 2 (isolated browser profile)
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
  /**
   * XR 4.2 — Trust & Isolation metadata: deterministic risk tier, the
   * policy-to-placement decision, authority grant reference, credential scope,
   * resource policy, isolation verification, and cleanup/quarantine result.
   * Present only for actions that opted into the trust gate (opts.trust).
   * Contains NO raw secrets.
   */
  trust?: TrustRecord;
  /**
   * XR 4.4 — Universal Intelligence Plane routing decision (secret-free).
   * Captures why a provider/model was selected for this execution attempt.
   * Optional for backward compatibility with XR 4.3 records.
   */
  routing?: import("../intelligence/types.ts").RoutingDecisionRecord;
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
   * XR 4.2 — opt this action into deterministic risk classification and
   * risk-tiered placement. When provided (and a TrustService is wired into the
   * ExecutionService), the fabric will classify risk, decide placement, admit
   * and verify an environment for Tier 1/2 work, and FAIL CLOSED when required
   * isolation is unavailable. Tier 0 stays on the fast in-process `run` path.
   *
   *   - request: objective, already-redacted facts about the action.
   *   - executable: the command form for Tier 1/2 execution inside an
   *     environment. Required for high-risk actions (else they are blocked).
   *   - credentialRefs: broker references for task-scoped secrets (names/refs
   *     only; raw values never enter the record).
   */
  trust?: {
    request: TrustRequest;
    executable?: EnvironmentExecutable;
    credentialRefs?: CredentialRef[];
  };
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

/** Adapter version stamped on every execution record. 4.2 → 4.3 adds durable agency metadata. */
export const EXECUTION_ADAPTER_VERSION = "xr-4.3.0";

// ═══════════════════════════════════════════════════════════════════════════
// XR 4.3 — Durable Agency: Recovery, Checkpoint, Lease, and associated types
// ═══════════════════════════════════════════════════════════════════════════

// ── Recovery State ────────────────────────────────────────────────────────

/**
 * Recovery-specific classification. These extend the execution state model
 * to represent what happens between a process crash and a successful resume.
 */
export type RecoveryState =
  | "running"                    // normal execution
  | "checkpointed"               // checkpoint written, may resume
  | "interrupted"                // process died, recovery needed
  | "startup_recovery_pending"   // discovered at startup, not yet classified
  | "recoverable"                // can auto-resume
  | "resuming"                   // recovery in progress
  | "resumed"                    // recovery successful
  | "paused"                     // user paused
  | "cancellation_requested"    // cancel asked for (durable)
  | "recovery_blocked";          // cannot resume (authority/env/policy)

/** Classification of what should happen to an interrupted execution. */
export type RecoveryAction =
  | "auto_resume"             // safe to resume automatically
  | "requires_approval"       // needs user to approve resume
  | "blocked"                 // cannot resume
  | "quarantined";            // environment/quarantine issue

/** Reason for the recovery classification. */
export type RecoveryClassification =
  | "safe"                    // action hadn't started or is naturally idempotent
  | "unknown_side_effect"     // action may have executed; side effect unknown
  | "authority_expired"       // credentials/grants expired
  | "environment_lost"        // isolation environment was lost
  | "cancellation_pending"    // cancellation was requested before crash
  | "non_idempotent_unsafe";  // non-idempotent action with unknown result

// ── Checkpoint ────────────────────────────────────────────────────────────

/** Kinds of checkpoints that can be taken at safe semantic boundaries. */
export type CheckpointKind =
  | "task_accepted"
  | "plan_recorded"
  | "policy_admitted"
  | "env_admitted"
  | "step_started"
  | "step_completed"
  | "model_turn_completed"
  | "tool_call_completed"
  | "cancellation_requested"
  | "review_checkpoint_reached"
  | "cleanup_completed"
  | "recovery_decided";

/** A durable checkpoint representing a safe semantic boundary. */
export interface ExecutionCheckpoint {
  readonly checkpointId: string;
  readonly runId: string;
  readonly workflowId?: string;
  readonly taskId?: string;
  readonly kind: CheckpointKind;
  /** True if execution can be safely auto-resumed from this boundary. */
  readonly sideEffectSafe: boolean;
  /** Snapshot of authority state at checkpoint time (for revalidation). */
  readonly authoritySnapshot?: {
    readonly policyVersion: string;
    readonly placement: string;
    readonly credentialRefs: readonly string[];
    readonly checkedAt: number;
  };
  /** Environment reference if attached. */
  readonly environmentRef?: string;
  /** The last known execution state at this checkpoint. */
  readonly executionState: ExecutionState;
  /** Human-readable progress summary. */
  readonly progressSummary: string;
  /** Full snapshot of relevant execution state (bounded). */
  readonly payload: Record<string, unknown>;
  readonly attempt: number;
  readonly createdAt: number;
}

// ── Lease / Ownership ─────────────────────────────────────────────────────

/** Target type for a lease. */
export type LeaseTargetType = "execution" | "workflow" | "task" | "recovery";

/** Durable ownership lease preventing duplicate local execution. */
export interface ExecutionLease {
  readonly leaseId: string;
  readonly targetType: LeaseTargetType;
  readonly targetId: string;
  readonly workspaceId: string;
  readonly ownerPid: number;
  readonly ownerInstanceId: string;
  readonly acquiredAt: number;
  readonly expiresAt?: number;
  releasedAt?: number;
  releaseReason?: string;
  /** True if the lease owner is known to be dead. */
  stale: boolean;
}

// ── Recovery Decision ─────────────────────────────────────────────────────

/** A durable record of what was decided about an interrupted execution. */
export interface RecoveryDecision {
  readonly recoveryId: string;
  readonly targetType: LeaseTargetType;
  readonly targetId: string;
  readonly action: RecoveryAction;
  readonly classification: RecoveryClassification;
  readonly reason: string;
  /** Who made the decision. */
  readonly decidedBy: "system" | "user";
  readonly decidedAt: number;
  readonly metadata?: Record<string, unknown>;
}

// ── Durable Cancellation ──────────────────────────────────────────────────

/** A durable cancellation request that survives process restart. */
export interface DurableCancellation {
  readonly cancellationId: string;
  readonly targetType: LeaseTargetType;
  readonly targetId: string;
  readonly requestedAt: number;
  readonly requestedBy: string;
  readonly reason?: string;
  acknowledged: boolean;
  acknowledgedAt?: number;
  sideEffectPossible: boolean;
  finalState?: "cancelled" | "reconciliation_required";
}

// ── Environment Attachment ────────────────────────────────────────────────

/** Durable record of an environment attached to an execution. */
export interface EnvironmentAttachment {
  readonly attachmentId: string;
  readonly environmentId: string;
  readonly executionId: string;
  readonly workspaceId: string;
  readonly backendId: string;
  readonly placement: string;
  readonly tier: string;
  lifecycleState: "created" | "starting" | "ready" | "running" | "stopping" | "stopped" | "failed" | "quarantined";
  /** PID of the environment process, if known. */
  pid?: number;
  readonly createdAt: number;
  lastKnownAt: number;
  cleanupState?: "not_required" | "succeeded" | "partial" | "failed" | "pending";
  quarantined: boolean;
  quarantineReason?: string;
}

// ── Backpressure / Concurrency Limits ─────────────────────────────────────

export const DURABILITY_BOUNDS = {
  /** Maximum concurrent active executions across the runtime. */
  MAX_ACTIVE_EXECUTIONS: 50,
  /** Maximum concurrent recovery operations (prevents recovery storms). */
  MAX_RECOVERY_OPERATIONS: 5,
  /** Maximum active isolated environments. */
  MAX_ACTIVE_ENVIRONMENTS: 10,
  /** Maximum queued (backpressured) work items. */
  MAX_QUEUED_WORK: 100,
  /** Per-workspace maximum concurrent executions. */
  PER_WORKSPACE_CONCURRENT: 20,
  /** Checkpoint retention: keep for this many ms after terminal state (7 days). */
  CHECKPOINT_RETENTION_MS: 7 * 24 * 60 * 60 * 1000,
  /** Maximum checkpoint payload size in chars (before truncation). */
  MAX_CHECKPOINT_PAYLOAD_CHARS: 8000,
  /** Lease TTL: 5 minutes without renewal. */
  LEASE_TTL_MS: 5 * 60 * 1000,
  /** Maximum recovery retries. */
  MAX_RECOVERY_RETRIES: 3,
  /** Startup recovery timeout (ms). Recovery must complete within this. */
  RECOVERY_TIMEOUT_MS: 30_000,
} as const;

// ── Extended Query ────────────────────────────────────────────────────────

/** Query filter extended for recovery awareness. */
export interface RecoveryQuery extends ExecutionQuery {
  /** Filter by recovery-specific states. */
  recoveryState?: RecoveryState | RecoveryState[];
  /** Only return executions needing attention (interrupted, recoverable, blocked). */
  needsAttention?: boolean;
}

// ── Recovery Status for UX ────────────────────────────────────────────────

/** User-facing recovery status for CLI/daemon/dashboard. */
export interface RecoveryStatus {
  runId: string;
  targetType: LeaseTargetType;
  targetId: string;
  recoveryState: RecoveryState;
  lastCheckpoint?: CheckpointKind;
  lastCheckpointAt?: number;
  checkpointProgress?: string;
  classification?: RecoveryClassification;
  action?: RecoveryAction;
  sideEffectUnknown: boolean;
  safeToResume: boolean;
  blockedReason?: string;
  environmentState?: string;
  createdAt: number;
  interruptedAt?: number;
  decidedAt?: number;
  decidedBy?: string;
}
