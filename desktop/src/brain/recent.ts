import type { Run, SpanStatus } from './types';

export interface RecentRun {
  id: string;
  shortId: string;
  title: string;
  agent: string;
  model: string;
  status: SpanStatus;
  startedAgo: number;
  durationMs: number;
  cost: number;
}

/** Only observed engine runs belong in a real-history table, never demo fixtures. */
export function realRecentRuns(order: string[], runs: Record<string, Run>, now: number): RecentRun[] {
  const seen = new Set<string>();
  const out: RecentRun[] = [];
  for (const id of order) {
    const r = runs[id];
    if (!r || r.source !== 'engine' || seen.has(id)) continue;
    seen.add(id);
    out.push({ id: r.id, shortId: r.shortId, title: r.title, agent: r.agent,
      model: r.model, status: r.status, startedAgo: now - r.startedAt,
      durationMs: (r.endedAt ?? now) - r.startedAt, cost: r.costUsd });
    if (out.length === 10) break;
  }
  return out;
}
