/**
 * XR Phase 18 — structured progress events for a full research run.
 *
 * `runResearch()` reports through `deps.say(line)` for the CLI; the desktop
 * needs machine-readable stages. These events are emitted by the engine
 * beside the existing lines (never instead of them) and streamed by the
 * daemon as SSE frames. Shapes are deliberately small: a source on the wire
 * carries ranking metadata, never the fetched page body (the full session is
 * one GET away once the run is over).
 */

import type { Contradiction, ResearchDepth, ResearchMode, ResearchSession, ResearchStatus, Source } from "./types.ts";

/** Source projection for progress events + the completion payload. */
export interface LiteSource {
  id: string;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  type: Source["type"];
  trust: number;
  relevance: number;
  freshness: string;
  fetched: boolean;
  verified: boolean;
  fetchError?: string;
  /** Length of the fetched body (0 when not fetched). */
  contentChars: number;
  foundVia: string;
}

export function liteSource(s: Source): LiteSource {
  return {
    id: s.id,
    url: s.url,
    domain: s.domain,
    title: s.title,
    snippet: s.snippet,
    type: s.type,
    trust: s.trust,
    relevance: s.relevance,
    freshness: s.freshness?.label ?? "unknown",
    fetched: Boolean(s.fetched),
    verified: Boolean(s.verified),
    fetchError: s.fetchError,
    contentChars: s.content?.length ?? 0,
    foundVia: s.foundVia,
  };
}

/** Truthful usage numbers for a run — counted from provider `usage` frames. */
export interface RunUsage {
  inTokens: number;
  outTokens: number;
  /** USD from the pricing table; `null` when the price is unknown (Art. IV.5). */
  usd: number | null;
  local: boolean;
}

/** Completion payload: the session minus page bodies + evidence quotes trimmed. */
export interface RunResult {
  sessionId: string;
  topic: string;
  depth: ResearchDepth;
  mode: ResearchMode;
  status: ResearchStatus;
  stopReason?: string;
  report: string | null;
  shortAnswer: string | null;
  executiveSummary: string[];
  openQuestions: string[];
  overallConfidence: "high" | "medium" | "low" | null;
  sources: LiteSource[];
  contradictions: Contradiction[];
  /** Up to 5 evidence lines per source for the expanded card. */
  evidence: Record<string, string[]>;
  meter: string | null;
  usage: RunUsage;
  provider: string;
  model: string;
  startedAt: number;
  endedAt: number;
}

export function runResult(session: ResearchSession, extra: { usage: RunUsage; provider: string; model: string; startedAt: number }): RunResult {
  const evidence: Record<string, string[]> = {};
  for (const n of session.notes ?? []) {
    const line = (n.quote?.trim() || n.text?.trim() || "").slice(0, 280);
    if (!line) continue;
    const arr = evidence[n.sourceId] ?? (evidence[n.sourceId] = []);
    if (arr.length < 5) arr.push(line);
  }
  return {
    sessionId: session.id,
    topic: session.topic,
    depth: session.depth,
    mode: session.mode,
    status: session.status,
    stopReason: session.stopReason,
    report: session.finalReport ?? session.synthesis?.report ?? null,
    shortAnswer: session.synthesis?.shortAnswer ?? null,
    executiveSummary: session.synthesis?.executiveSummary ?? [],
    openQuestions: session.synthesis?.openQuestions ?? [],
    overallConfidence: session.synthesis?.overallConfidence ?? null,
    sources: session.sources.map(liteSource),
    contradictions: session.contradictions ?? [],
    evidence,
    meter: session.meter ?? null,
    usage: extra.usage,
    provider: extra.provider,
    model: extra.model,
    startedAt: extra.startedAt,
    endedAt: Date.now(),
  };
}

/** Events the engine emits during `runResearch()` (in order of appearance). */
export type ResearchRunEvent =
  | { type: "run_started"; runId: string; sessionId: string; topic: string; depth: ResearchDepth; mode: ResearchMode; provider: string; model: string; searchAvailable: boolean; publicWeb: boolean; at: number }
  | { type: "status"; runId: string; status: ResearchStatus; at: number }
  | { type: "log"; runId: string; line: string; at: number }
  | { type: "plan"; runId: string; objective: string; questions: string[]; queries: number; at: number }
  | { type: "search"; runId: string; query: string; phase: "start" | "done"; hits?: number; unavailableReason?: string; at: number }
  | { type: "sources"; runId: string; sources: LiteSource[]; at: number }
  | { type: "fetch"; runId: string; sourceId: string; phase: "start" | "ok" | "fail"; chars?: number; freshness?: string; error?: string; at: number }
  | { type: "extract"; runId: string; sourceId: string; phase: "start" | "done"; notes?: number; at: number }
  | { type: "contradictions"; runId: string; count: number; at: number }
  | { type: "budget"; runId: string; meter: string; reason?: string; at: number }
  | { type: "run_completed"; runId: string; result: RunResult; at: number }
  | { type: "run_error"; runId: string; code: string; message: string; at: number }
  | { type: "stream_end"; runId: string };

export type ResearchRunEventType = ResearchRunEvent["type"];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What the engine emits: the registry stamps `runId` + `at` before fanning out. */
export type EngineRunEvent = DistributiveOmit<ResearchRunEvent, "runId" | "at">;

/** Engine-side event sink. */
export type RunEventSink = (event: EngineRunEvent) => void;
