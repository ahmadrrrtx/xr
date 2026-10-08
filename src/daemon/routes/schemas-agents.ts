/**
 * Phase 19 — zod schemas for custom agents and visual workflows. Re-exported
 * from schemas.ts so the client generator can name them; the contract lives
 * in contract-agents.ts.
 */
import { z } from "zod/v4";

// ── Custom agents ───────────────────────────────────────────────────────────

export const CustomAgentConstitutionPatch = z.looseObject({
  askBeforeFileWrites: z.boolean().optional(),
  askBeforeShell: z.boolean().optional(),
  allowPublicWeb: z.boolean().optional(),
  memoryWrite: z.boolean().optional(),
  shareData: z.boolean().optional(),
});

export const CustomAgentInputRequest = z.looseObject({
  name: z.string().min(1).max(60),
  description: z.string().max(280).optional(),
  emoji: z.string().max(8).optional(),
  role: z.string().max(40).optional().describe("Engine AgentRole (defaults to executor)."),
  systemPrompt: z.string().min(20).max(24_000),
  tools: z.array(z.string().max(64)).max(32).optional().describe("Subset of the engine tool list (GET /api/agents → tools)."),
  provider: z.string().max(64).nullable().optional(),
  model: z.string().max(128).nullable().optional(),
  budget: z.looseObject({ perRunUsd: z.number().min(0.01).max(5).optional(), perDayUsd: z.number().min(0.01).max(5).optional() }).optional(),
  constitution: CustomAgentConstitutionPatch.optional(),
  basedOn: z.string().max(80).nullable().optional(),
});

export const CustomAgentPatchRequest = CustomAgentInputRequest.partial();

export const CustomAgentDoc = z.looseObject({
  schemaVersion: z.literal("xr-5.0.0/agent-v1"),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  emoji: z.string(),
  role: z.string(),
  systemPrompt: z.string(),
  tools: z.array(z.string()),
  provider: z.string().optional(),
  model: z.string().optional(),
  budget: z.looseObject({ perRunUsd: z.number(), perDayUsd: z.number() }),
  constitution: z.looseObject({
    askBeforeFileWrites: z.boolean(),
    askBeforeShell: z.boolean(),
    allowPublicWeb: z.boolean(),
    memoryWrite: z.boolean(),
    destructiveApproval: z.literal(true),
    shareData: z.boolean(),
  }),
  version: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
  basedOn: z.string().optional(),
});

export const CustomAgentResponse = z.looseObject({ agent: CustomAgentDoc });
export const CustomAgentListResponse = z.looseObject({ agents: z.array(CustomAgentDoc) });
export const CustomAgentDuplicateRequest = z.looseObject({ name: z.string().min(1).max(60).optional() });

// ── Workflows ───────────────────────────────────────────────────────────────

export const CanvasNodeKind = z.enum(["input", "llm", "subagent", "tool", "branch", "join", "human_approval", "human_review", "wait", "notification", "artifact", "output"]);

export const CanvasNode = z.looseObject({
  id: z.string().min(1).max(80),
  kind: CanvasNodeKind,
  label: z.string().max(120),
  position: z.looseObject({ x: z.number(), y: z.number() }),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const CanvasEdge = z.looseObject({
  id: z.string().min(1).max(120),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
});

export const CanvasGraph = z.looseObject({
  nodes: z.array(CanvasNode).max(200),
  edges: z.array(CanvasEdge).max(600),
});

export const WorkflowProblem = z.looseObject({
  severity: z.enum(["error", "warning"]),
  code: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
});

export const WorkflowGraphSummary = z.looseObject({
  nodes: z.number().int(),
  tools: z.number().int(),
  humanChecks: z.number().int(),
  llmSteps: z.number().int(),
});

export const WorkflowInspectRequest = z.looseObject({ graph: CanvasGraph });
export const WorkflowInspectResponse = z.looseObject({ ok: z.boolean(), problems: z.array(WorkflowProblem), summary: WorkflowGraphSummary });

export const WorkflowCreateRequest = z.looseObject({
  name: z.string().min(1).max(120),
  description: z.string().max(600).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  graph: CanvasGraph,
});

export const WorkflowUpdateRequest = z.looseObject({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(600).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  graph: CanvasGraph,
  /** Version the editor loaded; a stale value answers 409 so no edit is silently overwritten. */
  baseVersion: z.number().int().min(1),
});

export const WorkflowDefinitionDoc = z.looseObject({
  definitionId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.number().int(),
  schemaVersion: z.string(),
  nodes: z.array(z.looseObject({ id: z.string(), kind: z.string(), label: z.string() })),
  entryNodeIds: z.array(z.string()),
  tags: z.array(z.string()),
  publishedAt: z.number(),
  contentHash: z.string(),
  active: z.boolean(),
  parameters: z.array(z.looseObject({ name: z.string(), type: z.string(), required: z.boolean() })).optional(),
});

export const WorkflowSummary = z.looseObject({
  definitionId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.number().int(),
  nodeCount: z.number().int(),
  summary: WorkflowGraphSummary,
  tags: z.array(z.string()),
  publishedAt: z.number(),
  lastRun: z.looseObject({ runId: z.string(), state: z.string(), updatedAt: z.number() }).nullable(),
});

export const WorkflowListResponse = z.looseObject({ workflows: z.array(WorkflowSummary) });
export const WorkflowResponse = z.looseObject({
  workflow: WorkflowDefinitionDoc,
  graph: CanvasGraph,
  problems: z.array(WorkflowProblem),
  versions: z.array(z.number().int()),
});

export const WorkflowRunStartRequest = z.looseObject({
  version: z.number().int().min(1).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

export const WorkflowNodeRunState = z.looseObject({
  nodeId: z.string(),
  kind: z.string(),
  state: z.string(),
  attempt: z.number().int(),
  error: z.string().optional(),
  outputs: z.record(z.string(), z.unknown()).optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});

export const WorkflowRunView = z.looseObject({
  runId: z.string(),
  definitionId: z.string(),
  definitionVersion: z.number().int(),
  name: z.string(),
  state: z.string(),
  nodes: z.array(WorkflowNodeRunState),
  cost: z.looseObject({ estimatedUsd: z.number(), actualUsd: z.number(), tokensIn: z.number(), tokensOut: z.number() }),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  error: z.string().optional(),
  resolvedParameters: z.record(z.string(), z.unknown()),
  pendingHuman: z.array(z.looseObject({ nodeId: z.string(), approvalId: z.string(), kind: z.enum(["approval", "review"]), summary: z.string() })),
  artifacts: z.array(z.looseObject({ artifactId: z.string(), nodeId: z.string(), location: z.string() })),
});

export const WorkflowRunResponse = z.looseObject({ run: WorkflowRunView });
export const WorkflowRunListResponse = z.looseObject({
  runs: z.array(z.looseObject({ runId: z.string(), definitionId: z.string(), definitionVersion: z.number().int(), name: z.string(), state: z.string(), createdAt: z.number(), updatedAt: z.number() })),
});

export const WorkflowDecisionRequest = z.looseObject({
  nodeId: z.string().min(1),
  decision: z.enum(["approve", "deny", "changes_requested", "reject"]),
  comment: z.string().max(2000).optional(),
});

/** One SSE frame of a workflow run stream (discriminated on `type`; see src/execution/workflow/events.ts). */
export const WorkflowRunEventFrame = z.looseObject({
  type: z.enum(["run_state", "node_state", "log", "cost_update", "approval_required", "run_end", "stream_end"]),
  runId: z.string(),
});

export const WorkflowControlResponse = z.looseObject({ ok: z.boolean(), state: z.string() });
