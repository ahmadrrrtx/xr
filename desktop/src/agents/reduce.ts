/*
 * Workflow run events → canvas run state (Phase 19). Pure; tested.
 *
 * The engine streams `run_state / node_state / log / cost_update /
 * approval_required / run_end` (replay first, then live). This folds them
 * into what the canvas, toolbar and summary render. Nothing is scripted:
 * a node is "running" only after the engine said so.
 */
import type { NodeRunState, PendingHuman, RunCost, RunState, RunSummary, WorkflowRunEvent, WorkflowRunView } from './api';

export interface NodeRunInfo {
  state: NodeRunState;
  attempt: number;
  error?: string;
  outputs?: Record<string, unknown>;
  startedAt?: number;
  endedAt?: number;
}

export interface RunLogLine {
  at: number;
  nodeId?: string;
  line: string;
}

export interface RunProgress {
  runId: string;
  state: RunState;
  nodes: Record<string, NodeRunInfo>;
  logs: RunLogLine[];
  cost: RunCost | null;
  pendingHuman: PendingHuman[];
  summary: RunSummary | null;
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
  /** Monotonic counter so views can key on "something changed". */
  tick: number;
}

export const MAX_LOG_LINES = 400;

export function emptyProgress(runId: string): RunProgress {
  return { runId, state: 'queued', nodes: {}, logs: [], cost: null, pendingHuman: [], summary: null, startedAt: null, endedAt: null, error: null, tick: 0 };
}

export const TERMINAL_RUN_STATES: ReadonlySet<RunState> = new Set<RunState>(['completed', 'failed', 'cancelled', 'expired', 'partially_completed', 'compensation_required']);
export const ACTIVE_RUN_STATES: ReadonlySet<RunState> = new Set<RunState>(['queued', 'running', 'waiting', 'awaiting_approval', 'awaiting_review', 'paused', 'cancelling']);

export function isTerminal(state: RunState | null | undefined): boolean {
  return !!state && TERMINAL_RUN_STATES.has(state);
}

export function isActive(state: RunState | null | undefined): boolean {
  return !!state && ACTIVE_RUN_STATES.has(state);
}

const NODE_WAITING: ReadonlySet<NodeRunState> = new Set<NodeRunState>(['waiting_approval', 'waiting_review']);

export function progressFromView(v: WorkflowRunView): RunProgress {
  const nodes: Record<string, NodeRunInfo> = {};
  for (const n of v.nodes) {
    nodes[n.nodeId] = {
      state: n.state,
      attempt: n.attempt,
      ...(n.error ? { error: n.error } : {}),
      ...(n.outputs ? { outputs: n.outputs } : {}),
      ...(n.startedAt ? { startedAt: n.startedAt } : {}),
      ...(n.endedAt ? { endedAt: n.endedAt } : {}),
    };
  }
  return {
    runId: v.runId,
    state: v.state,
    nodes,
    logs: [],
    cost: v.cost ?? null,
    pendingHuman: v.pendingHuman ?? [],
    summary: null,
    startedAt: v.startedAt ?? null,
    endedAt: v.endedAt ?? null,
    error: v.error ?? null,
    tick: 1,
  };
}

export function applyRunEvent(p: RunProgress, e: WorkflowRunEvent): RunProgress {
  switch (e.type) {
    case 'run_state': {
      const startedAt = p.startedAt ?? (e.state === 'running' ? e.at : null);
      const endedAt = isTerminal(e.state) ? (p.endedAt ?? e.at) : p.endedAt;
      return { ...p, state: e.state, startedAt, endedAt, tick: p.tick + 1 };
    }
    case 'node_state': {
      const prev = p.nodes[e.nodeId];
      const info: NodeRunInfo = {
        state: e.state,
        attempt: e.attempt,
        ...(e.error ? { error: e.error } : {}),
        ...(e.outputs ? { outputs: e.outputs } : prev?.outputs ? { outputs: prev.outputs } : {}),
        ...(prev?.startedAt ? { startedAt: prev.startedAt } : e.state === 'running' ? { startedAt: e.at } : {}),
        ...(isNodeTerminal(e.state) ? { endedAt: e.at } : {}),
      };
      // A decided human node leaves the pending list.
      const pendingHuman = NODE_WAITING.has(e.state) ? p.pendingHuman : p.pendingHuman.filter((h) => h.nodeId !== e.nodeId);
      return { ...p, nodes: { ...p.nodes, [e.nodeId]: info }, pendingHuman, tick: p.tick + 1 };
    }
    case 'log': {
      const logs = [...p.logs, { at: e.at, ...(e.nodeId ? { nodeId: e.nodeId } : {}), line: e.line }];
      if (logs.length > MAX_LOG_LINES) logs.splice(0, logs.length - MAX_LOG_LINES);
      return { ...p, logs, tick: p.tick + 1 };
    }
    case 'cost_update':
      return { ...p, cost: e.cost, tick: p.tick + 1 };
    case 'approval_required': {
      if (e.kind === 'tool' || !e.approvalId) return p; // tool approvals ride the Shield modal only
      if (p.pendingHuman.some((h) => h.nodeId === e.nodeId)) return p;
      return { ...p, pendingHuman: [...p.pendingHuman, { nodeId: e.nodeId, approvalId: e.approvalId, kind: e.kind, summary: e.summary }], tick: p.tick + 1 };
    }
    case 'run_end':
      return {
        ...p,
        state: e.summary.state,
        summary: e.summary,
        cost: e.summary.cost ?? p.cost,
        endedAt: e.summary.endedAt ?? e.at,
        startedAt: p.startedAt ?? e.summary.startedAt ?? null,
        error: e.summary.error ?? p.error,
        pendingHuman: [],
        tick: p.tick + 1,
      };
    case 'stream_end':
      return p;
    default:
      return p;
  }
}

export function isNodeTerminal(s: NodeRunState): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled' || s === 'skipped' || s === 'expired' || s === 'compensated';
}

/** Edge is "live" (marching ants) while its target runs after its source finished. */
export function edgeActive(p: RunProgress | null, source: string, target: string): boolean {
  if (!p) return false;
  const s = p.nodes[source]?.state;
  const t = p.nodes[target]?.state;
  return s === 'completed' && (t === 'running' || t === 'waiting_approval' || t === 'waiting_review' || t === 'waiting_timer' || t === 'waiting_event');
}

export function edgeDone(p: RunProgress | null, source: string, target: string): boolean {
  if (!p) return false;
  return p.nodes[source]?.state === 'completed' && p.nodes[target]?.state === 'completed';
}

/** Toolbar fraction: finished nodes over known nodes (0 when unknown). */
export function runFraction(p: RunProgress | null, totalNodes: number): number {
  if (!p || totalNodes === 0) return 0;
  const done = Object.values(p.nodes).filter((n) => isNodeTerminal(n.state)).length;
  return Math.min(1, done / totalNodes);
}

export interface CompletionSummary {
  state: RunState;
  durationMs: number | null;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  nodesCompleted: number;
  nodesFailed: number;
  nodesSkipped: number;
  artifacts: number;
  error: string | null;
}

export function completionSummary(p: RunProgress, artifacts: number): CompletionSummary {
  const nodes = Object.values(p.nodes);
  return {
    state: p.state,
    durationMs: p.startedAt && p.endedAt ? Math.max(0, p.endedAt - p.startedAt) : null,
    costUsd: p.cost?.actualUsd ?? 0,
    tokensIn: p.cost?.tokensIn ?? 0,
    tokensOut: p.cost?.tokensOut ?? 0,
    nodesCompleted: nodes.filter((n) => n.state === 'completed').length,
    nodesFailed: nodes.filter((n) => n.state === 'failed').length,
    nodesSkipped: nodes.filter((n) => n.state === 'skipped').length,
    artifacts,
    error: p.error,
  };
}

export function fmtDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

export function runStateLabel(s: RunState | null): string {
  switch (s) {
    case null:
      return 'Idle';
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'waiting':
      return 'Waiting';
    case 'awaiting_approval':
      return 'Needs approval';
    case 'awaiting_review':
      return 'Needs review';
    case 'paused':
      return 'Paused';
    case 'cancelling':
      return 'Stopping';
    case 'cancelled':
      return 'Stopped';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'partially_completed':
      return 'Partly completed';
    case 'compensation_required':
      return 'Needs cleanup';
    case 'expired':
      return 'Expired';
    default:
      return String(s);
  }
}

/** Collapse engine node states into the five visual states the canvas styles. */
export function nodeRunAttr(state: NodeRunState | undefined): 'running' | 'waiting' | 'completed' | 'failed' | 'skipped' | 'cancelled' | undefined {
  switch (state) {
    case 'running':
    case 'compensating':
      return 'running';
    case 'waiting_approval':
    case 'waiting_review':
    case 'waiting_timer':
    case 'waiting_event':
      return 'waiting';
    case 'completed':
    case 'compensated':
      return 'completed';
    case 'failed':
    case 'expired':
    case 'blocked':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'cancelled':
      return 'cancelled';
    default:
      return undefined;
  }
}
