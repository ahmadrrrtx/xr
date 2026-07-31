/**
 * XR 5.0 — Workflow Node Factory Functions
 *
 * Typed constructors for every canonical node type. Each function enforces
 * required fields and provides sensible defaults.
 */

import { randomUUID } from "node:crypto";
import type { AgentPermissionProfile, AgentRole, MemoryScope, ProviderScope, ToolScope } from "../../agents/types.ts";
import type { ContextTier } from "../../context/types.ts";
import type { IdempotencyClass } from "../types.ts";
import type {
  AgenticNode,
  ApproverSpec,
  ArtifactContract,
  ArtifactOutputNode,
  BranchCondition,
  BranchNode,
  BusinessRecordNode,
  CompensationNode,
  CompensationPolicy,
  CompletionNode,
  DeterministicNode,
  FailurePolicy,
  HumanApprovalNode,
  HumanReviewNode,
  JoinNode,
  NotificationChannel,
  NotificationNode,
  NotificationRecipient,
  RetryPolicy,
  ToolActionNode,
  TriggerNode,
  WaitTimerNode,
  WorkflowNode,
  WorkflowTrigger,
} from "./types.ts";

function nid(): string {
  return `n_${randomUUID().slice(0, 8)}`;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_RETRY: RetryPolicy = {
  maxRetries: 0,
  backoffMs: 1000,
  exponentialBackoff: true,
  retryableErrors: ["transient"],
};

const DEFAULT_FAILURE: FailurePolicy = {
  action: "stop_workflow",
};

const DEFAULT_IDEMPOTENCY: IdempotencyClass = "non_idempotent";

// ── Trigger Node ───────────────────────────────────────────────────────────

export function trigger(
  label: string,
  triggerConfig: WorkflowTrigger,
  opts: Partial<Pick<TriggerNode, "description" | "dependencies" | "metadata">> = {},
): TriggerNode {
  return {
    id: nid(),
    kind: "trigger",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: "naturally_idempotent",
    timeoutMs: 0,
    retry: DEFAULT_RETRY,
    onFailure: DEFAULT_FAILURE,
    trigger: triggerConfig,
    metadata: opts.metadata,
  };
}

// ── Deterministic Node ─────────────────────────────────────────────────────

export function deterministic(
  label: string,
  functionRef: string,
  inputs: Record<string, unknown>,
  opts: Partial<Pick<DeterministicNode, "description" | "dependencies" | "outputSchema" | "hasSideEffects" | "idempotency" | "timeoutMs" | "retry" | "onFailure" | "metadata">> = {},
): DeterministicNode {
  return {
    id: nid(),
    kind: "deterministic",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: opts.idempotency ?? (opts.hasSideEffects ? "non_idempotent" : "naturally_idempotent"),
    timeoutMs: opts.timeoutMs ?? 30_000,
    retry: opts.retry ?? DEFAULT_RETRY,
    onFailure: opts.onFailure ?? DEFAULT_FAILURE,
    functionRef,
    inputs,
    outputSchema: opts.outputSchema,
    hasSideEffects: opts.hasSideEffects ?? false,
    metadata: opts.metadata,
  };
}

// ── Agentic Node ───────────────────────────────────────────────────────────

export function agentic(
  label: string,
  instruction: string,
  agentRole: AgentRole,
  opts: Partial<Pick<AgenticNode, "description" | "dependencies" | "agentId" | "contextScope" | "providerScope" | "toolScope" | "permissions" | "budget" | "riskTier" | "expectedOutputs" | "requiresReview" | "requiresPreApproval" | "successCriteria" | "systemPrompt" | "idempotency" | "timeoutMs" | "retry" | "onFailure" | "compensation" | "metadata">> = {},
): AgenticNode {
  return {
    id: nid(),
    kind: "agentic",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: opts.idempotency ?? DEFAULT_IDEMPOTENCY,
    timeoutMs: opts.timeoutMs ?? 300_000,
    retry: opts.retry ?? { ...DEFAULT_RETRY, maxRetries: 1 },
    onFailure: opts.onFailure ?? DEFAULT_FAILURE,
    compensation: opts.compensation,
    agentRole,
    agentId: opts.agentId,
    contextScope: opts.contextScope ?? {
      tiers: ["immediate", "recent", "task_summary"] as ContextTier[],
      includeUserMemory: false,
    },
    providerScope: opts.providerScope ?? {},
    toolScope: opts.toolScope ?? { mode: "allowlist", tools: [] },
    permissions: opts.permissions ?? {
      writeFiles: false,
      shell: false,
      network: true,
      plugins: false,
      mcp: false,
      memoryRead: true,
      memoryWrite: false,
      computerControl: false,
      secrets: false,
      destructiveExec: false,
    },
    budget: opts.budget,
    riskTier: opts.riskTier ?? "medium",
    expectedOutputs: opts.expectedOutputs ?? [],
    requiresReview: opts.requiresReview ?? false,
    requiresPreApproval: opts.requiresPreApproval ?? false,
    successCriteria: opts.successCriteria,
    instruction,
    systemPrompt: opts.systemPrompt,
    metadata: opts.metadata,
  };
}

// ── Human Approval Node ────────────────────────────────────────────────────

export function humanApproval(
  label: string,
  summary: string,
  detail: string,
  approver: ApproverSpec,
  opts: {
    description?: string;
    dependencies?: string[];
    evidenceRefs?: HumanApprovalNode["request"]["evidenceRefs"];
    riskLevel?: HumanApprovalNode["request"]["riskLevel"];
    scope?: string;
    expiresInMs?: number;
    onApproval?: HumanApprovalNode["onApproval"];
    onDenial?: HumanApprovalNode["onDenial"];
    onExpiry?: HumanApprovalNode["onExpiry"];
    metadata?: Record<string, unknown>;
  } = {},
): HumanApprovalNode {
  return {
    id: nid(),
    kind: "human_approval",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: "naturally_idempotent",
    timeoutMs: opts.expiresInMs ?? 86_400_000,
    retry: { ...DEFAULT_RETRY, maxRetries: 0 },
    onFailure: {
      action: "escalate",
      escalateToNodes: opts.onExpiry?.escalateToNodes ?? [],
    },
    request: {
      summary,
      detail,
      evidenceRefs: opts.evidenceRefs ?? [],
      riskLevel: opts.riskLevel ?? "medium",
      scope: opts.scope ?? "workflow_action",
    },
    approver,
    expiresInMs: opts.expiresInMs ?? 86_400_000,
    onApproval: opts.onApproval ?? { nextNodes: [] },
    onDenial: opts.onDenial ?? { action: "stop_workflow" },
    onExpiry: opts.onExpiry ?? { action: "deny" },
    metadata: opts.metadata,
  };
}

// ── Human Review Node ──────────────────────────────────────────────────────

export function humanReview(
  label: string,
  summary: string,
  reviewTargetNodes: string[],
  reviewer: ApproverSpec,
  opts: {
    description?: string;
    dependencies?: string[];
    detail?: string;
    evidenceRefs?: HumanReviewNode["request"]["evidenceRefs"];
    expiresInMs?: number;
    onApprove?: HumanReviewNode["onApprove"];
    onChangeRequested?: HumanReviewNode["onChangeRequested"];
    onExpiry?: HumanReviewNode["onExpiry"];
    metadata?: Record<string, unknown>;
  } = {},
): HumanReviewNode {
  return {
    id: nid(),
    kind: "human_review",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: "naturally_idempotent",
    timeoutMs: opts.expiresInMs ?? 86_400_000,
    retry: { ...DEFAULT_RETRY, maxRetries: 0 },
    onFailure: {
      action: "escalate",
      escalateToNodes: opts.onExpiry?.escalateToNodes ?? [],
    },
    request: {
      summary,
      detail: opts.detail ?? summary,
      reviewTargetNodes,
      evidenceRefs: opts.evidenceRefs ?? [],
    },
    reviewer,
    expiresInMs: opts.expiresInMs ?? 86_400_000,
    onApprove: opts.onApprove ?? { nextNodes: [] },
    onChangeRequested: opts.onChangeRequested ?? { action: "retry_targets" },
    onExpiry: opts.onExpiry ?? { action: "auto_approve" },
    metadata: opts.metadata,
  };
}

// ── Tool Action Node ───────────────────────────────────────────────────────

export function toolAction(
  label: string,
  capability: ToolActionNode["capability"],
  inputs: Record<string, unknown>,
  opts: Partial<Pick<ToolActionNode, "description" | "dependencies" | "inputSummary" | "riskTier" | "requiresApproval" | "idempotency" | "timeoutMs" | "retry" | "onFailure" | "metadata">> = {},
): ToolActionNode {
  return {
    id: nid(),
    kind: "tool_action",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: opts.idempotency ?? DEFAULT_IDEMPOTENCY,
    timeoutMs: opts.timeoutMs ?? 60_000,
    retry: opts.retry ?? DEFAULT_RETRY,
    onFailure: opts.onFailure ?? DEFAULT_FAILURE,
    capability,
    inputSummary: opts.inputSummary ?? label,
    inputs,
    riskTier: opts.riskTier ?? "medium",
    requiresApproval: opts.requiresApproval ?? false,
    metadata: opts.metadata,
  };
}

// ── Wait/Timer Node ────────────────────────────────────────────────────────

export function waitTimer(
  label: string,
  timer: WaitTimerNode["timer"],
  opts: Partial<Pick<WaitTimerNode, "description" | "dependencies" | "timeoutMs" | "metadata">> = {},
): WaitTimerNode {
  return {
    id: nid(),
    kind: "wait_timer",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: "naturally_idempotent",
    timeoutMs: opts.timeoutMs ?? (timer.type === "delay" ? timer.durationMs + 60_000 : 0),
    retry: { ...DEFAULT_RETRY, maxRetries: 0 },
    onFailure: { action: "skip" },
    timer,
    metadata: opts.metadata,
  };
}

// ── Branch Node ────────────────────────────────────────────────────────────

export function branch(
  label: string,
  condition: BranchCondition,
  trueNodes: string[],
  falseNodes: string[],
  opts: Partial<Pick<BranchNode, "description" | "dependencies" | "defaultNodes" | "metadata">> = {},
): BranchNode {
  return {
    id: nid(),
    kind: "branch",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: "naturally_idempotent",
    timeoutMs: 5_000,
    retry: { ...DEFAULT_RETRY, maxRetries: 0 },
    onFailure: { action: "skip" },
    condition,
    trueNodes,
    falseNodes,
    defaultNodes: opts.defaultNodes ?? falseNodes,
    metadata: opts.metadata,
  };
}

// ── Join Node ──────────────────────────────────────────────────────────────

export function join(
  label: string,
  strategy: JoinNode["strategy"],
  opts: Partial<Pick<JoinNode, "description" | "dependencies" | "n" | "timeoutMs" | "onTimeout" | "metadata">> = {},
): JoinNode {
  const timeoutMs = opts.timeoutMs ?? 0;
  return {
    id: nid(),
    kind: "join",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: "naturally_idempotent",
    timeoutMs,
    retry: { ...DEFAULT_RETRY, maxRetries: 0 },
    onFailure: { action: "skip" },
    strategy,
    n: opts.n,
    onTimeout: opts.onTimeout ?? "proceed_partial",
    metadata: opts.metadata,
  };
}

// ── Artifact Output Node ───────────────────────────────────────────────────

export function artifactOutput(
  label: string,
  artifact: ArtifactContract,
  sourceNodeId: string,
  opts: Partial<Pick<ArtifactOutputNode, "description" | "dependencies" | "metadata">> = {},
): ArtifactOutputNode {
  return {
    id: nid(),
    kind: "artifact_output",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: "idempotent_with_key",
    timeoutMs: 30_000,
    retry: { ...DEFAULT_RETRY, maxRetries: 1 },
    onFailure: { action: "skip" },
    artifact,
    sourceNodeId,
    metadata: opts.metadata,
  };
}

// ── Business Record Node ───────────────────────────────────────────────────

export function businessRecord(
  label: string,
  module: string,
  operation: BusinessRecordNode["operation"],
  entity: string,
  data: Record<string, unknown>,
  opts: Partial<Pick<BusinessRecordNode, "description" | "dependencies" | "reversible" | "idempotency" | "retry" | "onFailure" | "metadata">> = {},
): BusinessRecordNode {
  return {
    id: nid(),
    kind: "business_record",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: opts.idempotency ?? (operation === "create" ? "idempotent_with_key" : "non_idempotent"),
    timeoutMs: 30_000,
    retry: opts.retry ?? { ...DEFAULT_RETRY, maxRetries: 1, retryableErrors: ["transient", "timeout"] },
    onFailure: opts.onFailure ?? { action: "stop_workflow" },
    module,
    operation,
    entity,
    data,
    reversible: opts.reversible ?? false,
    metadata: opts.metadata,
  };
}

// ── Notification Node ──────────────────────────────────────────────────────

export function notification(
  label: string,
  message: string,
  channels: NotificationChannel[],
  recipients: NotificationRecipient[],
  opts: Partial<Pick<NotificationNode, "description" | "dependencies" | "severity" | "metadata">> = {},
): NotificationNode {
  return {
    id: nid(),
    kind: "notification",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: "naturally_idempotent",
    timeoutMs: 10_000,
    retry: { ...DEFAULT_RETRY, maxRetries: 0 },
    onFailure: { action: "skip" },
    channels,
    severity: opts.severity ?? "info",
    message,
    recipients,
    metadata: opts.metadata,
  };
}

// ── Completion Node ────────────────────────────────────────────────────────

export function completion(
  label: string,
  message: string,
  opts: Partial<Pick<CompletionNode, "description" | "dependencies" | "outcome" | "metadata">> = {},
): CompletionNode {
  return {
    id: nid(),
    kind: "completion",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: "naturally_idempotent",
    timeoutMs: 5_000,
    retry: { ...DEFAULT_RETRY, maxRetries: 0 },
    onFailure: { action: "stop_workflow" },
    outcome: opts.outcome ?? "success",
    message,
    metadata: opts.metadata,
  };
}

// ── Compensation Node ──────────────────────────────────────────────────────

export function compensation(
  label: string,
  targetNodeIds: string[],
  scope: CompensationPolicy,
  opts: Partial<Pick<CompensationNode, "description" | "dependencies" | "timeoutMs" | "retry" | "metadata">> = {},
): CompensationNode {
  return {
    id: nid(),
    kind: "compensation",
    label,
    description: opts.description,
    dependencies: opts.dependencies ?? [],
    idempotency: "non_idempotent",
    timeoutMs: opts.timeoutMs ?? 300_000,
    retry: opts.retry ?? { ...DEFAULT_RETRY, maxRetries: 1 },
    onFailure: { action: "escalate" },
    targetNodeIds,
    scope,
    metadata: opts.metadata,
  };
}

// ── Utility ────────────────────────────────────────────────────────────────

/** Get all node ids that are downstream of a given node (transitive closure over dependencies). */
export function downstreamNodes(nodes: WorkflowNode[], startIds: string[]): Set<string> {
  const graph = new Map<string, string[]>();
  for (const n of nodes) {
    graph.set(n.id, n.dependencies ?? []);
  }
  const reverse = new Map<string, string[]>();
  for (const [id, deps] of graph) {
    for (const dep of deps) {
      const list = reverse.get(dep) ?? [];
      if (!list.includes(id)) list.push(id);
      reverse.set(dep, list);
    }
  }
  const visited = new Set<string>();
  const queue = [...startIds];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of reverse.get(id) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  // Remove the start nodes
  for (const id of startIds) visited.delete(id);
  return visited;
}

/** Get the entry point nodes (nodes with no inbound dependencies). */
export function entryNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  const hasDep = new Set<string>();
  for (const n of nodes) {
    for (const d of n.dependencies) hasDep.add(d);
  }
  return nodes.filter(n => !hasDep.has(n.id));
}

/** Validate a node graph: no cycles, no missing dependencies, triggers first. */
export function validateGraph(nodes: WorkflowNode[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set(nodes.map(n => n.id));

  // Check duplicate ids
  if (ids.size !== nodes.length) {
    errors.push("Duplicate node ids detected");
  }

  // Check missing dependency references
  for (const n of nodes) {
    for (const dep of n.dependencies) {
      if (!ids.has(dep)) {
        errors.push(`Node ${n.id} depends on missing node ${dep}`);
      }
    }
  }

  // Check cycles (DFS)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    color.set(n.id, WHITE);
    adj.set(n.id, [...n.dependencies]);
  }

  function dfs(id: string): boolean {
    color.set(id, GRAY);
    for (const dep of adj.get(id) ?? []) {
      const c = color.get(dep);
      if (c === GRAY) {
        errors.push(`Cycle detected: ${id} -> ${dep}`);
        return false;
      }
      if (c === WHITE) {
        if (!dfs(dep)) return false;
      }
    }
    color.set(id, BLACK);
    return true;
  }

  for (const n of nodes) {
    if (color.get(n.id) === WHITE) {
      dfs(n.id);
    }
  }

  // Check trigger nodes are at the root
  const triggers = nodes.filter(n => n.kind === "trigger");
  for (const t of triggers) {
    if (t.dependencies.length > 0) {
      errors.push(`Trigger node ${t.id} should have no dependencies`);
    }
  }

  return { valid: errors.length === 0, errors };
}
