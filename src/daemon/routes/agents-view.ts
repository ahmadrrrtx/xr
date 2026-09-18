/**
 * Phase 4 · team-run view composer — the engine owns every number the
 * multi-agent page displays (SEC-07): progress, cost roll-ups, budget
 * partitions per node, DAG tiers and control affordances. The shell renders
 * this snapshot and forwards control verbs; it never computes any of it.
 */
import type { WorkflowRecord, WorkflowStatus, WorkflowTask } from "../../agents/types.ts";

export interface TeamNodeView {
  taskId: string;
  name: string;
  role: string;
  agentId: string;
  phase: string | null;
  status: string;
  reviewState: string;
  approvalState: string;
  blockedReason: string | null;
  tier: number;
  budget: { capUsd: number; consumedUsd: number; capTokens: number; consumedTokens: number };
  artifacts: Array<{ path: string; description?: string }>;
  startedAt: number | null;
  endedAt: number | null;
}

export interface TeamView {
  workflowId: string;
  kind: string;
  goal: string;
  status: WorkflowStatus;
  reviewState: string;
  approvalState: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number;
  progressPct: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  costUsd: number;
  costCapUsd: number;
  tokens: number;
  affordances: { pause: boolean; resume: boolean; cancel: boolean };
  nodes: TeamNodeView[];
  edges: Array<{ from: string; to: string }>;
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Which control verbs a run in `status` accepts — single source of truth for
 *  both the route guards and the page's button disabled-states. */
export function controlAffordances(status: WorkflowStatus): { pause: boolean; resume: boolean; cancel: boolean } {
  return {
    pause: status === "running",
    resume: status === "paused" || status === "blocked" || status === "failed" || status === "cancelled" || status === "awaiting_review",
    cancel: status === "running" || status === "paused" || status === "planned" || status === "awaiting_review" || status === "blocked",
  };
}

/** Longest-path tier per task = the vertical layering the page draws. */
export function taskTiers(tasks: WorkflowTask[]): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  const memo = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    if (seen.has(id)) return 0; // cycle-guard: templates are acyclic, stay safe
    seen.add(id);
    const task = byId.get(id);
    const deps = (task?.dependencies ?? []).filter((d) => byId.has(d));
    const d = deps.length === 0 ? 0 : Math.max(...deps.map((dep) => depthOf(dep, seen) + 1));
    seen.delete(id);
    memo.set(id, d);
    return d;
  };
  for (const t of tasks) depthOf(t.taskId, new Set());
  return memo;
}

export function composeTeamView(record: WorkflowRecord): TeamView {
  const parts = record.partitions ?? [];
  const costUsd = parts.reduce((a, p) => a + (p.consumedUsd || 0), 0);
  const costCapUsd = parts.reduce((a, p) => a + (p.capUsd || 0), 0);
  const tokens = parts.reduce((a, p) => a + (p.consumedTokens || 0), 0);
  const completed = record.tasks.filter((t) => t.status === "completed").length;
  const failed = record.tasks.filter((t) => t.status === "failed").length;
  const tiers = taskTiers(record.tasks);
  const nodes: TeamNodeView[] = record.tasks.map((t) => {
    const p = parts.find((pp) => pp.childId === t.taskId);
    return {
      taskId: t.taskId,
      name: t.name,
      role: t.role,
      agentId: t.agentId,
      phase: t.phase ?? null,
      status: t.status,
      reviewState: t.reviewState,
      approvalState: t.approvalState,
      blockedReason: t.blockedReason ?? null,
      tier: tiers.get(t.taskId) ?? 0,
      budget: {
        capUsd: p?.capUsd ?? 0,
        consumedUsd: p?.consumedUsd ?? 0,
        capTokens: p?.capTokens ?? 0,
        consumedTokens: p?.consumedTokens ?? 0,
      },
      artifacts: t.outputs?.artifacts ?? [],
      startedAt: t.startedAt ?? null,
      endedAt: t.endedAt ?? null,
    };
  });
  const edges = record.tasks.flatMap((t) => t.dependencies.filter((d) => record.tasks.some((x) => x.taskId === d)).map((d) => ({ from: d, to: t.taskId })));
  return {
    workflowId: record.workflowId,
    kind: record.kind,
    goal: record.goal,
    status: record.status,
    reviewState: record.reviewState,
    approvalState: record.approvalState,
    createdAt: record.createdAt,
    startedAt: record.startedAt ?? null,
    endedAt: record.endedAt ?? null,
    updatedAt: record.updatedAt,
    progressPct: record.tasks.length ? Math.round((100 * completed) / record.tasks.length) : 0,
    tasksTotal: record.tasks.length,
    tasksCompleted: completed,
    tasksFailed: failed,
    costUsd: round4(costUsd),
    costCapUsd: round4(costCapUsd),
    tokens,
    affordances: controlAffordances(record.status),
    nodes,
    edges,
  };
}
