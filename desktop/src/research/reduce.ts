/*
 * Research (Phase 18) — pure reducer from engine run events to the screen's
 * run slice. Kept free of React/Zustand so the root test suite can replay
 * the frames the engine actually emits (captured with curl in
 * docs/phases/18-research-notes.md §3) and assert what the UI would show.
 */
import {
  DEPTH_BUDGETS,
  citationIndex,
  followUps,
  markCited,
  mergeSources,
  phaseForStatus,
  sourceFromLite,
  type CitationIndex,
  type Contradiction,
  type EngineStatus,
  type Phase,
  type Progress,
  type RunEvent,
  type RunResult,
  type RunUsage,
  type Stats,
  type UiSource,
} from './core';

export interface RunError {
  message: string;
  code: string | null;
  /** Fetches failed because web egress is off — the card offers the Shield path. */
  egressBlocked: boolean;
}

export interface RunSlice {
  phase: Phase;
  engineStatus: EngineStatus | null;
  sessionId: string | null;
  provider: string;
  model: string;
  searchAvailable: boolean | null;
  publicWeb: boolean | null;
  startedAt: number | null;
  endedAt: number | null;
  plan: { objective: string; questions: string[] } | null;
  searches: Array<{ query: string; hits: number | null; unavailableReason?: string }>;
  sources: UiSource[];
  report: string | null;
  shortAnswer: string | null;
  citations: CitationIndex;
  contradictions: Contradiction[];
  openQuestions: string[];
  followUps: string[];
  progress: Progress;
  stats: Stats | null;
  usage: RunUsage | null;
  log: string[];
  error: RunError | null;
  partialReason: string | null;
  stopReason: string | null;
  result: RunResult | null;
  /** Fetch failures that were egress refusals (counted for the error card). */
  egressRefusals: number;
  ssrfBlocks: number;
}

export const LOG_CAP = 400;

export function emptyRun(): RunSlice {
  return {
    phase: 'idle',
    engineStatus: null,
    sessionId: null,
    provider: '',
    model: '',
    searchAvailable: null,
    publicWeb: null,
    startedAt: null,
    endedAt: null,
    plan: null,
    searches: [],
    sources: [],
    report: null,
    shortAnswer: null,
    citations: { order: [], numberFor: {} },
    contradictions: [],
    openQuestions: [],
    followUps: [],
    progress: { sourcesDiscovered: 0, sourcesFetched: 0, sourcesFailed: 0, fetchTarget: null, tokens: 0, percent: null, error: null, partial: null },
    stats: null,
    usage: null,
    log: [],
    error: null,
    partialReason: null,
    stopReason: null,
    result: null,
    egressRefusals: 0,
    ssrfBlocks: 0,
  };
}

const EGRESS_RE = /egress allow-list|allow-public-web|public web/i;
const SSRF_RE = /ssrf|private (?:address|network|ip)|blocked/i;

function pushLog(log: string[], line: string): string[] {
  const next = log.length >= LOG_CAP ? log.slice(log.length - LOG_CAP + 1) : log.slice();
  next.push(line);
  return next;
}

function percentFor(s: RunSlice): number | null {
  if (s.phase === 'done' || s.phase === 'partial' || s.phase === 'cancelled') return 100;
  if (s.phase === 'synthesizing') return 90;
  if (s.phase === 'reading') {
    const target = Math.max(1, Math.min(s.progress.fetchTarget ?? s.sources.length, s.sources.length));
    const done = s.progress.sourcesFetched + s.progress.sourcesFailed;
    return Math.min(88, 20 + Math.round((70 * Math.min(done, target)) / target));
  }
  if (s.phase === 'searching' && s.sources.length) return 18;
  return null; // indeterminate until totals are known
}

function withPercent(s: RunSlice): RunSlice {
  return { ...s, progress: { ...s.progress, percent: percentFor(s) } };
}

function setPhase(s: RunSlice, phase: Phase): RunSlice {
  if (s.phase === phase) return s;
  let next: RunSlice = { ...s, phase };
  if (phase === 'synthesizing' && s.progress.sourcesFailed > 0) {
    const attempted = s.progress.sourcesFetched + s.progress.sourcesFailed;
    next = { ...next, progress: { ...next.progress, partial: `${s.progress.sourcesFetched}/${attempted} sources reached; continuing with available.` } };
  }
  return next;
}

/** Fold one engine frame into the slice (pure; returns a new object). */
export function applyRunEvent(s: RunSlice, e: RunEvent, now = Date.now()): RunSlice {
  switch (e.type) {
    case 'run_started': {
      const target = DEPTH_BUDGETS[e.depth]?.maxFetched ?? null;
      return withPercent({
        ...s,
        phase: 'planning',
        engineStatus: 'planning',
        sessionId: e.sessionId,
        provider: e.provider,
        model: e.model,
        searchAvailable: e.searchAvailable,
        publicWeb: e.publicWeb,
        startedAt: s.startedAt ?? e.at ?? now,
        progress: { ...s.progress, fetchTarget: target },
      });
    }
    case 'status': {
      const phase = phaseForStatus(e.status);
      const next = { ...s, engineStatus: e.status };
      // Terminal statuses are settled by run_completed (which carries the result).
      if (e.status === 'done' || e.status === 'stopped') return next;
      return withPercent(setPhase(next, phase));
    }
    case 'log': {
      let next: RunSlice = { ...s, log: pushLog(s.log, e.line) };
      if (/ssrf|blocked/i.test(e.line) && /fetch|url|host|address/i.test(e.line)) next = { ...next, ssrfBlocks: next.ssrfBlocks + 1 };
      return next;
    }
    case 'plan':
      return { ...s, plan: { objective: e.objective, questions: e.questions } };
    case 'search': {
      if (e.phase === 'start') return { ...s, searches: [...s.searches, { query: e.query, hits: null }] };
      const searches = s.searches.slice();
      const i = searches.findIndex((x) => x.query === e.query && x.hits === null);
      const row = { query: e.query, hits: e.hits ?? 0, unavailableReason: e.unavailableReason };
      if (i >= 0) searches[i] = row;
      else searches.push(row);
      return { ...s, searches };
    }
    case 'sources': {
      const sources = mergeSources(s.sources, e.sources);
      const fetched = sources.filter((x) => x.status === 'fetched').length;
      const failed = sources.filter((x) => x.status === 'failed').length;
      return withPercent({
        ...s,
        sources,
        progress: { ...s.progress, sourcesDiscovered: sources.length, sourcesFetched: fetched, sourcesFailed: failed },
      });
    }
    case 'fetch': {
      const idx = s.sources.findIndex((x) => x.id === e.sourceId);
      const sources = s.sources.slice();
      if (idx < 0) return s;
      const cur = sources[idx];
      if (e.phase === 'start') {
        sources[idx] = { ...cur, status: 'reading' };
        return { ...s, sources };
      }
      if (e.phase === 'ok') {
        sources[idx] = { ...cur, status: 'fetched', contentChars: e.chars ?? cur.contentChars, freshness: e.freshness ?? cur.freshness, fetchError: undefined };
        return withPercent({ ...s, sources, progress: { ...s.progress, sourcesFetched: s.progress.sourcesFetched + 1 } });
      }
      const err = e.error ?? 'fetch failed';
      sources[idx] = { ...cur, status: 'failed', fetchError: err };
      const egress = EGRESS_RE.test(err);
      const ssrf = !egress && SSRF_RE.test(err);
      return withPercent({
        ...s,
        sources,
        egressRefusals: s.egressRefusals + (egress ? 1 : 0),
        ssrfBlocks: s.ssrfBlocks + (ssrf ? 1 : 0),
        log: ssrf ? pushLog(s.log, `  ⚠ ${cur.domain}: ${err}`) : s.log,
        progress: { ...s.progress, sourcesFailed: s.progress.sourcesFailed + 1 },
      });
    }
    case 'extract': {
      if (e.phase !== 'done') return s;
      return s;
    }
    case 'contradictions':
      return s;
    case 'budget':
      return { ...s, log: pushLog(s.log, e.reason ? `  ⏸ ${e.reason}` : `  budget ${e.meter}`) };
    case 'run_completed':
      return finalizeResult(s, e.result, now);
    case 'run_error':
      return withPercent({
        ...s,
        phase: 'error',
        endedAt: e.at ?? now,
        error: { message: e.message, code: e.code, egressBlocked: false },
        progress: { ...s.progress, error: e.message },
      });
    case 'stream_end':
    default:
      return s;
  }
}

/** Settle the slice from the engine's final RunResult (truthful numbers only). */
export function finalizeResult(s: RunSlice, r: RunResult, now = Date.now()): RunSlice {
  const evidence = r.evidence ?? {};
  // Rebuild from the engine's final list so statuses/evidence are authoritative.
  const prevSeq = new Map(s.sources.map((x) => [x.id, x.seq]));
  let seq = s.sources.length;
  const base = r.sources.map((lite) => {
    const src = sourceFromLite(lite, prevSeq.get(lite.id) ?? seq++, evidence[lite.id] ?? []);
    const prev = s.sources.find((x) => x.id === lite.id);
    return prev?.status === 'failed' && !lite.fetched ? { ...src, status: 'failed' as const, fetchError: prev.fetchError } : src;
  });
  const report = r.report && r.report.trim() ? r.report : null;
  const citations = citationIndex(report);
  const sources = markCited(base, citations);
  const fetched = sources.filter((x) => x.status === 'fetched').length;
  const failed = sources.filter((x) => x.status === 'failed').length;
  const startedAt = s.startedAt ?? r.startedAt;
  const endedAt = r.endedAt || now;
  const stats: Stats = {
    durationMs: Math.max(0, endedAt - startedAt),
    totalTokens: r.usage.inTokens + r.usage.outTokens,
    inTokens: r.usage.inTokens,
    outTokens: r.usage.outTokens,
    cost: r.usage.local ? 0 : r.usage.usd,
    local: r.usage.local,
    sourceCount: sources.length,
    citedCount: citations.order.length,
    fetchedCount: fetched,
    provider: r.provider,
    model: r.model,
  };

  let phase: Phase;
  let partialReason: string | null = null;
  let error: RunError | null = null;
  if (r.status === 'done') {
    phase = 'done';
  } else if (r.stopReason === 'cancelled') {
    phase = 'cancelled';
  } else {
    phase = 'partial';
    partialReason = /budget/i.test(r.stopReason ?? '') ? 'Budget reached — showing partial results' : `Stopped early — ${r.stopReason ?? 'engine stopped'}`;
  }

  // The final list is authoritative: the engine stamps fetchError per source.
  const egressRefusals = base.filter((x) => x.fetchError && EGRESS_RE.test(x.fetchError)).length;
  const webOff = s.searchAvailable === false || s.publicWeb === false;
  const nothingRead = fetched === 0;
  if (phase === 'done' && nothingRead) {
    // The engine finishes honestly with a snippet-only fallback; the screen
    // should not present that as a report.
    const egress = egressRefusals > 0 || (webOff && sources.length === 0);
    error = {
      message:
        sources.length === 0
          ? s.searchAvailable === false
            ? 'Web search is unavailable: the search host is not in the engine egress allow-list.'
            : 'No sources were found for this query.'
          : `Found ${sources.length} source${sources.length === 1 ? '' : 's'} but could not read any of them.`,
      code: egress ? 'egress_blocked' : 'no_sources',
      egressBlocked: egress,
    };
    phase = 'error';
  }

  // Nothing was read: the snippet-only fallback is not shown as a report, so
  // its citations must not mark cards "cited" either.
  const noReport = phase === 'error';
  return {
    ...s,
    phase,
    engineStatus: r.status,
    sessionId: r.sessionId,
    provider: r.provider || s.provider,
    model: r.model || s.model,
    startedAt,
    endedAt,
    sources: noReport ? base : sources,
    report: noReport ? null : report,
    shortAnswer: noReport ? null : r.shortAnswer,
    citations: noReport ? { order: [], numberFor: {} } : citations,
    contradictions: noReport ? [] : (r.contradictions ?? []),
    openQuestions: r.openQuestions ?? [],
    followUps: noReport ? [] : followUps(r.openQuestions ?? [], r.topic),
    stats: noReport ? { ...stats, citedCount: 0 } : stats,
    usage: r.usage,
    result: r,
    stopReason: r.stopReason ?? null,
    partialReason,
    error,
    egressRefusals,
    progress: {
      ...s.progress,
      sourcesDiscovered: sources.length,
      sourcesFetched: fetched,
      sourcesFailed: failed,
      tokens: r.usage.inTokens + r.usage.outTokens,
      percent: 100,
      error: error?.message ?? null,
      // Settle the running note ("…continuing with available.") into past tense.
      partial: failed > 0 && report ? `${fetched}/${fetched + failed} sources reached — the report uses the ones that were read.` : null,
    },
  };
}
