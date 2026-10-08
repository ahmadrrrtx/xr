/*
 * Agents + Workflows (Phase 19) — engine client. Every call goes through the
 * paired engine link (`engineFetch`, base …/api/v1).
 *
 * Routes (src/daemon/routes/custom-agents.routes.ts, workflows.routes.ts):
 *   GET    /agents                          → { agents[], tools[] , … }
 *   GET    /agents/custom                   → { agents: CustomAgent[] }
 *   POST   /agents/custom                   → 201 { agent }
 *   POST   /agents/custom/import            → 201 { agent }
 *   GET/PATCH/DELETE /agents/custom/{id}    → { agent } | { ok }
 *   POST   /agents/custom/{id}/duplicate    → 201 { agent }
 *   GET    /workflows                       → { workflows: WorkflowSummary[] }
 *   POST   /workflows                       → 201 { workflow, graph, problems, versions }
 *   POST   /workflows/inspect               → { ok, problems, summary }
 *   GET    /workflows/{id}?version=         → { workflow, graph, problems, versions }
 *   PATCH  /workflows/{id}                  → { workflow, graph, problems, versions } (409 stale)
 *   DELETE /workflows/{id}                  → { ok }
 *   POST   /workflows/{id}/run              → 202 { run }
 *   GET    /workflows/runs?limit=           → { runs }
 *   GET    /workflows/runs/{runId}          → { run }
 *   GET    /workflows/runs/{runId}/stream   → SSE (replay + live) … stream_end, [DONE]
 *   POST   /workflows/runs/{runId}/cancel|pause|resume → { ok, state }
 *   POST   /workflows/runs/{runId}/human-decision      → { run }
 */
import { engineFetch, engineJson, enginePost, EngineHttpError } from '@/engine/transport';
import { readSse } from '@/engine/sse';

import type { AgentSummary, CustomAgent, CustomAgentInput, EngineTool } from './core';

/* ── Agents ───────────────────────────────────────────────────────────── */

export interface AgentsIndex {
  agents: AgentSummary[];
  tools: EngineTool[];
}

export async function fetchAgentsIndex(): Promise<AgentsIndex> {
  const j = await engineJson<{ agents?: AgentSummary[]; tools?: EngineTool[] }>('/agents');
  return { agents: j.agents ?? [], tools: j.tools ?? [] };
}

export async function createCustomAgent(input: CustomAgentInput): Promise<CustomAgent> {
  return (await enginePost<{ agent: CustomAgent }>('/agents/custom', input)).agent;
}

export async function updateCustomAgent(id: string, patch: Partial<CustomAgentInput>): Promise<CustomAgent> {
  return (
    await engineJson<{ agent: CustomAgent }>(`/agents/custom/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  ).agent;
}

export async function deleteCustomAgent(id: string): Promise<void> {
  await engineJson<{ ok: boolean }>(`/agents/custom/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function duplicateCustomAgent(id: string): Promise<CustomAgent> {
  return (await enginePost<{ agent: CustomAgent }>(`/agents/custom/${encodeURIComponent(id)}/duplicate`, {})).agent;
}

export async function importCustomAgent(doc: Record<string, unknown>): Promise<CustomAgent> {
  return (await enginePost<{ agent: CustomAgent }>('/agents/custom/import', doc)).agent;
}

/** Field problems from a 400/422 (`errors[{path,message}]`), else the title. */
export function describeEngineError(e: unknown): { message: string; problems: Array<{ path: string; message: string }> } {
  if (e instanceof EngineHttpError) {
    const body = e.body ?? {};
    const errors = Array.isArray(body.errors) ? (body.errors as Array<Record<string, unknown>>) : [];
    const problems = errors
      .map((p) => ({ path: String(p.path ?? ''), message: String(p.message ?? '') }))
      .filter((p) => p.message);
    const detail = typeof body.detail === 'string' ? body.detail : typeof body.title === 'string' ? body.title : '';
    return { message: detail || problems[0]?.message || `Engine answered ${e.status}`, problems };
  }
  return { message: e instanceof Error ? e.message : String(e), problems: [] };
}

/* ── Workflows ────────────────────────────────────────────────────────── */

export type CanvasNodeKind =
  | 'input'
  | 'llm'
  | 'subagent'
  | 'tool'
  | 'branch'
  | 'join'
  | 'human_approval'
  | 'human_review'
  | 'wait'
  | 'notification'
  | 'artifact'
  | 'output';

export interface CanvasNode {
  id: string;
  kind: CanvasNodeKind;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

export interface CanvasGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface WorkflowProblem {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
}

export interface GraphSummary {
  nodes: number;
  tools: number;
  humanChecks: number;
  llmSteps: number;
}

export interface WorkflowSummary {
  definitionId: string;
  name: string;
  description?: string;
  version: number;
  nodeCount: number;
  summary: GraphSummary;
  tags: string[];
  publishedAt: number;
  lastRun: { runId: string; state: string; createdAt: number; endedAt?: number } | null;
}

export interface WorkflowParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
}

/** The canonical definition as published (subset the UI reads). */
export interface WorkflowDefinitionDoc {
  definitionId: string;
  name: string;
  description?: string;
  version: number;
  schemaVersion: string;
  nodes: Array<{ id: string; kind: string; label: string }>;
  entryNodeIds: string[];
  tags: string[];
  publishedAt: number;
  contentHash: string;
  active: boolean;
  supersedes?: string;
  parameters?: WorkflowParameter[];
}

export interface WorkflowDocument {
  workflow: WorkflowDefinitionDoc;
  graph: CanvasGraph;
  problems: WorkflowProblem[];
  versions: number[];
}

/** src/execution/workflow/types.ts `WorkflowRunState`. */
export type RunState =
  | 'draft'
  | 'published'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'awaiting_approval'
  | 'awaiting_review'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'partially_completed'
  | 'failed'
  | 'completed'
  | 'compensation_required'
  | 'expired';

/** src/execution/workflow/types.ts `WorkflowNodeState`. */
export type NodeRunState =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting_approval'
  | 'waiting_review'
  | 'waiting_timer'
  | 'waiting_event'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'compensating'
  | 'compensated'
  | 'blocked'
  | 'expired';

export interface RunNodeView {
  nodeId: string;
  kind: string;
  state: NodeRunState;
  attempt: number;
  error?: string;
  outputs?: Record<string, unknown>;
  startedAt?: number;
  endedAt?: number;
}

/** src/execution/workflow/types.ts `WorkflowCost`. */
export interface RunCost {
  estimatedUsd: number;
  actualUsd: number;
  tokensIn: number;
  tokensOut: number;
  breakdown: Record<string, { usd: number; tokensIn: number; tokensOut: number }>;
}

export interface RunSummary {
  runId: string;
  definitionId: string;
  definitionVersion: number;
  name: string;
  state: RunState;
  nodeCount: number;
  nodesCompleted: number;
  nodesFailed: number;
  nodesBlocked: number;
  nodesAwaitingHuman: number;
  cost: RunCost;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export interface PendingHuman {
  nodeId: string;
  approvalId: string;
  kind: 'approval' | 'review';
  summary: string;
}

export interface WorkflowRunView {
  runId: string;
  definitionId: string;
  definitionVersion: number;
  name: string;
  state: RunState;
  nodes: RunNodeView[];
  cost: RunCost;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  resolvedParameters: Record<string, unknown>;
  pendingHuman: PendingHuman[];
  artifacts: Array<{ artifactId: string; nodeId: string; location: string }>;
}

export type RunListItem = RunSummary;

/** SSE frames on `/workflows/runs/{id}/stream` (src/execution/workflow/events.ts). */
export type WorkflowRunEvent =
  | { type: 'run_state'; runId: string; state: RunState; at: number }
  | { type: 'node_state'; runId: string; nodeId: string; kind: string; state: NodeRunState; attempt: number; error?: string; outputs?: Record<string, unknown>; at: number }
  | { type: 'log'; runId: string; nodeId?: string; line: string; at: number }
  | { type: 'cost_update'; runId: string; cost: RunCost; at: number }
  | { type: 'approval_required'; runId: string; nodeId: string; approvalId: string | null; kind: 'approval' | 'review' | 'tool'; summary: string; at: number }
  | { type: 'run_end'; runId: string; summary: RunSummary; at: number }
  | { type: 'stream_end'; runId: string };

export function parseRunEvent(payload: string): WorkflowRunEvent | null {
  if (payload === '[DONE]') return null;
  try {
    const j = JSON.parse(payload) as Record<string, unknown>;
    if (!j || typeof j.type !== 'string') return null;
    return j as unknown as WorkflowRunEvent;
  } catch {
    return null;
  }
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  return (await engineJson<{ workflows: WorkflowSummary[] }>('/workflows')).workflows;
}

export function getWorkflow(id: string, version?: number): Promise<WorkflowDocument> {
  const qs = version ? `?version=${version}` : '';
  return engineJson<WorkflowDocument>(`/workflows/${encodeURIComponent(id)}${qs}`);
}

export interface SaveWorkflowInput {
  name: string;
  description?: string;
  graph: CanvasGraph;
  tags?: string[];
}

export function createWorkflow(input: SaveWorkflowInput): Promise<WorkflowDocument> {
  return enginePost<WorkflowDocument>('/workflows', input);
}

export function updateWorkflow(id: string, input: SaveWorkflowInput & { baseVersion: number }): Promise<WorkflowDocument> {
  return engineJson<WorkflowDocument>(`/workflows/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteWorkflow(id: string): Promise<void> {
  await engineJson<{ ok: boolean }>(`/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function inspectGraph(graph: CanvasGraph): Promise<{ ok: boolean; problems: WorkflowProblem[]; summary: GraphSummary }> {
  return enginePost('/workflows/inspect', { graph });
}

export async function startWorkflowRun(id: string, input: { version?: number; parameters?: Record<string, unknown> }): Promise<WorkflowRunView> {
  return (await enginePost<{ run: WorkflowRunView }>(`/workflows/${encodeURIComponent(id)}/run`, input)).run;
}

export async function getRun(runId: string): Promise<WorkflowRunView> {
  return (await engineJson<{ run: WorkflowRunView }>(`/workflows/runs/${encodeURIComponent(runId)}`)).run;
}

export async function listRuns(opts: { definitionId?: string; limit?: number } = {}): Promise<RunListItem[]> {
  if (opts.definitionId) {
    return (await engineJson<{ runs: RunListItem[] }>(`/workflows/${encodeURIComponent(opts.definitionId)}/runs`)).runs;
  }
  return (await engineJson<{ runs: RunListItem[] }>(`/workflows/runs?limit=${opts.limit ?? 50}`)).runs;
}

export function controlRun(runId: string, action: 'cancel' | 'pause' | 'resume'): Promise<{ ok: boolean; state: RunState }> {
  return enginePost(`/workflows/runs/${encodeURIComponent(runId)}/${action}`, {});
}

export type HumanDecision = 'approve' | 'deny' | 'changes_requested' | 'reject';

export async function decideHuman(runId: string, input: { nodeId: string; decision: HumanDecision; comment?: string }): Promise<WorkflowRunView> {
  return (await enginePost<{ run: WorkflowRunView }>(`/workflows/runs/${encodeURIComponent(runId)}/human-decision`, input)).run;
}

/** Pump the run stream (replay + live); resolves when the engine closes it. */
export async function streamRun(runId: string, onEvent: (e: WorkflowRunEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await engineFetch(`/workflows/runs/${encodeURIComponent(runId)}/stream`, {
    headers: { accept: 'text/event-stream' },
    signal,
  });
  if (!res.ok) {
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    throw new EngineHttpError(res.status, '/workflows/runs/stream', body);
  }
  await readSse(
    res,
    (payload) => {
      const e = parseRunEvent(payload);
      if (e) onEvent(e);
    },
    signal,
  );
}
