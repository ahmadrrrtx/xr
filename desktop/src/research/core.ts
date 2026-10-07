/*
 * Research (Phase 18) — pure helpers shared by the store, the screen and the
 * root test suite (test/desktop/research-core.test.ts imports this file
 * relatively, so it must stay dependency-free).
 *
 * The engine is the source of truth: these functions only reshape what
 * `runResearch()` already emits (src/research/run-events.ts) into what the
 * three columns render. Nothing here invents numbers.
 */

// ─── Engine event shapes (mirrors src/research/run-events.ts) ──────────────

export type EngineDepth = 'quick' | 'deep' | 'thorough';
export type EngineMode = 'quick' | 'deep' | 'academic';
export type EngineStatus =
  | 'planning'
  | 'discovering'
  | 'ranking'
  | 'fetching'
  | 'extracting'
  | 'checking'
  | 'synthesizing'
  | 'done'
  | 'stopped';
export type SourceType = 'official' | 'paper' | 'news' | 'blog' | 'forum' | 'docs' | 'local' | 'unknown' | string;

export interface LiteSource {
  id: string;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  type: SourceType;
  trust: number;
  relevance: number;
  freshness: string;
  fetched: boolean;
  verified: boolean;
  fetchError?: string;
  contentChars: number;
  foundVia: string;
}

export interface RunUsage {
  inTokens: number;
  outTokens: number;
  /** USD from the engine's pricing table; null when the price is unknown. */
  usd: number | null;
  local: boolean;
}

export interface Contradiction {
  id: string;
  topic: string;
  sourceIds: string[];
  evidenceIds: string[];
  description: string;
  severity: 'low' | 'medium' | 'high' | string;
  status?: string;
}

export interface RunResult {
  sessionId: string;
  topic: string;
  depth: EngineDepth;
  mode: EngineMode;
  status: EngineStatus;
  stopReason?: string;
  report: string | null;
  shortAnswer: string | null;
  executiveSummary: string[];
  openQuestions: string[];
  overallConfidence: string | null;
  sources: LiteSource[];
  contradictions: Contradiction[];
  /** sourceId → up to five evidence lines (quotes first). */
  evidence: Record<string, string[]>;
  meter: string | null;
  usage: RunUsage;
  provider: string;
  model: string;
  startedAt: number;
  endedAt: number;
}

export type RunEvent =
  | { type: 'run_started'; runId: string; sessionId: string; topic: string; depth: EngineDepth; mode: EngineMode; provider: string; model: string; searchAvailable: boolean; publicWeb: boolean; at: number }
  | { type: 'status'; runId: string; status: EngineStatus; at: number }
  | { type: 'log'; runId: string; line: string; at: number }
  | { type: 'plan'; runId: string; objective: string; questions: string[]; queries: number; at: number }
  | { type: 'search'; runId: string; query: string; phase: 'start' | 'done'; hits?: number; unavailableReason?: string; at: number }
  | { type: 'sources'; runId: string; sources: LiteSource[]; at: number }
  | { type: 'fetch'; runId: string; sourceId: string; phase: 'start' | 'ok' | 'fail'; chars?: number; freshness?: string; error?: string; at: number }
  | { type: 'extract'; runId: string; sourceId: string; phase: 'start' | 'done'; notes?: number; at: number }
  | { type: 'contradictions'; runId: string; count: number; at: number }
  | { type: 'budget'; runId: string; meter: string; reason?: string; at: number }
  | { type: 'run_completed'; runId: string; result: RunResult; at: number }
  | { type: 'run_error'; runId: string; code: string; message: string; at: number }
  | { type: 'stream_end'; runId: string };

/** Parse one SSE payload; `[DONE]` and junk return null. */
export function parseRunEvent(payload: string): RunEvent | null {
  if (!payload || payload === '[DONE]') return null;
  try {
    const v = JSON.parse(payload) as { type?: unknown };
    return v && typeof v === 'object' && typeof v.type === 'string' ? (v as RunEvent) : null;
  } catch {
    return null;
  }
}

// ─── UI model ──────────────────────────────────────────────────────────────

export type Phase =
  | 'idle'
  | 'planning'
  | 'searching'
  | 'reading'
  | 'synthesizing'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'partial';

export type UiDepth = 'quick' | 'standard' | 'deep' | 'academic';
export type SourceStatus = 'discovering' | 'found' | 'reading' | 'fetched' | 'failed';

export interface UiSource {
  id: string;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  type: SourceType;
  trust: number;
  relevance: number;
  freshness: string;
  status: SourceStatus;
  cited: boolean;
  fetchError?: string;
  contentChars: number;
  foundVia: string;
  /** Evidence lines (from run_completed). */
  evidence: string[];
  /** Order of arrival, for the first-30 slide-in cap. */
  seq: number;
}

export interface PlanStep {
  id: string;
  label: string;
  state: 'pending' | 'active' | 'done' | 'failed';
}

export interface Progress {
  sourcesDiscovered: number;
  sourcesFetched: number;
  sourcesFailed: number;
  /** Engine fetch cap for the depth (known once run_started names the depth). */
  fetchTarget: number | null;
  tokens: number;
  /** 0–100 or null while indeterminate. */
  percent: number | null;
  error: string | null;
  partial: string | null;
}

export interface Stats {
  durationMs: number;
  totalTokens: number;
  inTokens: number;
  outTokens: number;
  /** USD; null = unknown price. */
  cost: number | null;
  local: boolean;
  sourceCount: number;
  citedCount: number;
  fetchedCount: number;
  provider: string;
  model: string;
}

export interface Budgets {
  maxQueries: number;
  resultsPerQuery: number;
  maxSources: number;
  maxFetched: number;
  maxQuestions: number;
  maxEvidencePerSource: number;
}

/** Engine DEPTH_BUDGETS (src/research/budget.ts) — the only truthful hints. */
export const DEPTH_BUDGETS: Record<EngineDepth, Budgets> = {
  quick: { maxQueries: 4, resultsPerQuery: 6, maxSources: 10, maxFetched: 5, maxQuestions: 4, maxEvidencePerSource: 5 },
  deep: { maxQueries: 10, resultsPerQuery: 8, maxSources: 28, maxFetched: 16, maxQuestions: 8, maxEvidencePerSource: 8 },
  thorough: { maxQueries: 14, resultsPerQuery: 8, maxSources: 40, maxFetched: 24, maxQuestions: 10, maxEvidencePerSource: 8 },
};

/** UI depth → engine depth. Academic is not wired yet (needs the papers lane). */
export function engineDepthFor(d: UiDepth): EngineDepth {
  if (d === 'quick') return 'quick';
  if (d === 'deep' || d === 'academic') return 'thorough';
  return 'deep'; // standard
}

export function engineModeFor(d: UiDepth): EngineMode {
  if (d === 'quick') return 'quick';
  if (d === 'academic') return 'academic';
  return 'deep';
}

export function depthHint(d: UiDepth, budgets: Record<EngineDepth, Budgets> = DEPTH_BUDGETS): string {
  const b = budgets[engineDepthFor(d)];
  return `up to ${b.maxQueries} searches · reads ${b.maxFetched} of ${b.maxSources} sources`;
}

export function phaseForStatus(s: EngineStatus): Phase {
  switch (s) {
    case 'planning':
      return 'planning';
    case 'discovering':
    case 'ranking':
      return 'searching';
    case 'fetching':
    case 'extracting':
      return 'reading';
    case 'checking': // contradiction pass — the write-up has begun
    case 'synthesizing':
      return 'synthesizing';
    case 'done':
      return 'done';
    case 'stopped':
      return 'partial';
    default:
      return 'planning';
  }
}

export const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Idle',
  planning: 'Planning',
  searching: 'Searching',
  reading: 'Reading sources',
  synthesizing: 'Writing report',
  done: 'Done',
  error: 'Stopped',
  cancelled: 'Cancelled',
  partial: 'Partial',
};

export const PLAN_STEP_IDS = ['plan', 'search', 'read', 'synthesize'] as const;

export function planSteps(phase: Phase): PlanStep[] {
  const order: Record<(typeof PLAN_STEP_IDS)[number], Phase[]> = {
    plan: ['planning'],
    search: ['searching'],
    read: ['reading'],
    synthesize: ['synthesizing'],
  };
  const labels = { plan: 'Plan', search: 'Search', read: 'Read', synthesize: 'Synthesize' };
  const rank: Record<Phase, number> = { idle: -1, planning: 0, searching: 1, reading: 2, synthesizing: 3, done: 4, partial: 4, cancelled: 4, error: 4 };
  const r = rank[phase];
  return PLAN_STEP_IDS.map((id, i) => ({
    id,
    label: labels[id],
    state: order[id].includes(phase) ? 'active' : r > i ? 'done' : 'pending',
  }));
}

export function isRunningPhase(p: Phase): boolean {
  return p === 'planning' || p === 'searching' || p === 'reading' || p === 'synthesizing';
}

/** Phase announcement for the aria-live region (brief §10). */
export function announcementFor(prev: Phase, next: Phase, sources: number): string | null {
  if (prev === next) return null;
  switch (next) {
    case 'planning':
      return 'Planning';
    case 'searching':
      return 'Searching';
    case 'reading':
      return sources > 0 ? `Found ${sources} source${sources === 1 ? '' : 's'}` : 'Reading sources';
    case 'synthesizing':
      return 'Writing report';
    case 'done':
      return 'Done';
    case 'partial':
      return 'Finished with partial results';
    case 'cancelled':
      return 'Cancelled';
    case 'error':
      return 'Research stopped';
    default:
      return null;
  }
}

// ─── Sources ───────────────────────────────────────────────────────────────

export function sourceFromLite(s: LiteSource, seq: number, evidence: string[] = []): UiSource {
  return {
    id: s.id,
    url: s.url,
    domain: s.domain,
    title: s.title || s.domain,
    snippet: s.snippet ?? '',
    type: s.type,
    trust: clamp01(s.trust),
    relevance: clamp01(s.relevance),
    freshness: s.freshness || 'unknown',
    status: s.fetchError ? 'failed' : s.fetched ? 'fetched' : 'found',
    cited: false,
    fetchError: s.fetchError,
    contentChars: s.contentChars ?? 0,
    foundVia: s.foundVia ?? '',
    evidence,
    seq,
  };
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function isLocalSource(s: Pick<UiSource, 'type' | 'url'>): boolean {
  return s.type === 'local' || s.url.startsWith('local://');
}

/** Merge a `sources` frame into the current list, keeping arrival order + statuses. */
export function mergeSources(current: UiSource[], incoming: LiteSource[]): UiSource[] {
  const byId = new Map(current.map((s) => [s.id, s]));
  let seq = current.length;
  const out: UiSource[] = [];
  const seen = new Set<string>();
  for (const lite of incoming) {
    const prev = byId.get(lite.id);
    seen.add(lite.id);
    if (prev) {
      const status: SourceStatus = prev.status === 'reading' ? 'reading' : lite.fetchError ? 'failed' : lite.fetched ? 'fetched' : prev.status;
      out.push({ ...prev, title: lite.title || prev.title, snippet: lite.snippet || prev.snippet, trust: clamp01(lite.trust), relevance: clamp01(lite.relevance), status });
    } else {
      out.push(sourceFromLite(lite, seq++));
    }
  }
  // Sources the engine dropped (dedupe/ranking) stay visible only if they
  // were already read — otherwise the list truthfully follows the engine.
  for (const prev of current) if (!seen.has(prev.id) && prev.status === 'fetched') out.push(prev);
  return out;
}

// ─── Citations ─────────────────────────────────────────────────────────────

export const CITATION_RE = /\[(s\d+)\]/g;

export interface CitationIndex {
  /** Source ids in first-appearance order (1-based display numbers). */
  order: string[];
  numberFor: Record<string, number>;
}

export function citationIndex(report: string | null | undefined): CitationIndex {
  const order: string[] = [];
  const numberFor: Record<string, number> = {};
  if (!report) return { order, numberFor };
  for (const m of report.matchAll(CITATION_RE)) {
    const id = m[1];
    if (!(id in numberFor)) {
      order.push(id);
      numberFor[id] = order.length;
    }
  }
  return { order, numberFor };
}

/**
 * Rewrite `[s3]` markers into markdown links `[2](#cite-s3)` so the renderer
 * can turn them into superscripts anywhere inline (paragraphs, list items,
 * table cells, quotes) — fenced/inline code is left untouched.
 */
export function rewriteCitations(report: string, index: CitationIndex): string {
  const segments = report.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return segments
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // code
      return seg.replace(CITATION_RE, (m, id: string) => {
        const n = index.numberFor[id];
        return n ? `[${n}](#cite-${id})` : m;
      });
    })
    .join('');
}

export function markCited(sources: UiSource[], index: CitationIndex): UiSource[] {
  return sources.map((s) => ({ ...s, cited: Boolean(index.numberFor[s.id]) }));
}

// ─── Formatting ────────────────────────────────────────────────────────────

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/** "$0.0123" · "local" (local models) · "unknown" (no price on file). */
export function fmtCost(cost: number | null, local: boolean): string {
  if (local) return 'local';
  if (cost == null) return 'unknown';
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function fmtAgo(ms: number, now = Date.now()): string {
  const d = Math.max(0, now - ms);
  if (d < 45_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return `${Math.round(d / 86_400_000)} d ago`;
}

export function statsLine(s: Stats): string {
  const parts = [`${s.sourceCount} source${s.sourceCount === 1 ? '' : 's'}`, fmtDuration(s.durationMs), `${fmtTokens(s.totalTokens)} tokens`];
  parts.push(fmtCost(s.cost, s.local));
  return parts.join(' • ');
}

export function slugify(q: string, max = 48): string {
  const s = q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return s || 'research';
}

export function isoDate(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** `research/<slug>-<date>.md` — always relative, never escapes the root. */
export function workspaceReportPath(query: string, ts = Date.now()): string {
  return `research/${slugify(query)}-${isoDate(ts)}.md`;
}

// ─── Follow-ups ────────────────────────────────────────────────────────────

export function followUps(openQuestions: string[], topic: string): string[] {
  const clean = openQuestions.map((q) => q.trim()).filter((q) => q.length > 8 && q.length <= 140);
  const uniq = [...new Set(clean)].slice(0, 4);
  const t = topic.trim().replace(/[?.!]+$/, '') || 'this';
  const defaults = [`What are the main criticisms of ${t}?`, `How has ${t} changed in the last year?`, `Who are the key sources on ${t}?`, `What should I verify before relying on ${t}?`];
  for (const d of defaults) {
    if (uniq.length >= 4) break;
    if (!uniq.includes(d)) uniq.push(d);
  }
  return uniq.slice(0, 4);
}

export const QUICK_STARTS = [
  'Compare Rust async runtimes for a high-throughput API',
  'What changed in the EU AI Act implementation timeline?',
  'State of local LLM inference on consumer GPUs',
  'Evidence on four-day work weeks and productivity',
];

// ─── Export document ───────────────────────────────────────────────────────

export interface ExportInput {
  topic: string;
  report: string;
  sources: UiSource[];
  index: CitationIndex;
  stats: Stats | null;
  contradictions: Contradiction[];
  generatedAt: number;
  depth: UiDepth;
}

/** Markdown file: report with numbered citations, then a cited-sources list. */
export function exportMarkdown(input: ExportInput): string {
  const body = rewriteCitations(input.report, input.index)
    // Links stay readable outside the app: `[2](#cite-s3)` → `[2]`.
    .replace(/\[(\d+)\]\(#cite-s\d+\)/g, '[$1]');
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: ${JSON.stringify(input.topic)}`);
  lines.push(`generated: ${new Date(input.generatedAt).toISOString()}`);
  lines.push(`depth: ${input.depth}`);
  if (input.stats) {
    lines.push(`sources: ${input.stats.sourceCount}`);
    lines.push(`cited: ${input.stats.citedCount}`);
    lines.push(`tokens: ${input.stats.totalTokens}`);
    lines.push(`cost: ${fmtCost(input.stats.cost, input.stats.local)}`);
    lines.push(`model: ${input.stats.provider}/${input.stats.model}`);
  }
  lines.push('generator: XR Research');
  lines.push('---', '');
  lines.push(body.trim(), '');
  if (input.contradictions.length) {
    lines.push('## Conflicting sources', '');
    for (const c of input.contradictions) {
      // The engine phrases these with raw ids ("s3 reports…") — use the reader's numbers.
      const text = c.description.replace(/\b(s\d+)\b/g, (m, id: string) => (input.index.numberFor[id] ? `source [${input.index.numberFor[id]}]` : m));
      const mentioned = new Set([...c.description.matchAll(/\b(s\d+)\b/g)].map((m) => m[1]));
      const nums = c.sourceIds.filter((id) => !mentioned.has(id)).map((id) => input.index.numberFor[id]).filter(Boolean);
      lines.push(`- ${text}${nums.length ? ` [${nums.join('][')}]` : ''}`);
    }
    lines.push('');
  }
  if (input.index.order.length) {
    lines.push('## Sources cited', '');
    input.index.order.forEach((id, i) => {
      const s = byId.get(id);
      if (!s) return;
      lines.push(isLocalSource(s) ? `${i + 1}. ${s.url.replace('local://', '')} (local file)` : `${i + 1}. ${s.title} — ${s.url}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Persisted-session → UI (past sessions, voice follow) ──────────────────

/** The engine's stored ResearchSession (src/research/types.ts), loosely typed. */
export interface StoredSession {
  id: string;
  topic: string;
  depth: EngineDepth;
  mode: EngineMode;
  status: EngineStatus;
  stopReason?: string;
  startedAt?: number;
  endedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  sources: Array<{
    id: string;
    url: string;
    domain: string;
    title: string;
    snippet?: string;
    type?: string;
    trust?: number;
    relevance?: number;
    freshness?: { label?: string } | string;
    fetched?: boolean;
    verified?: boolean;
    fetchError?: string;
    content?: string;
    foundVia?: string;
  }>;
  notes?: Array<{ id: string; sourceId: string; text?: string; quote?: string }>;
  contradictions?: Contradiction[];
  synthesis?: { shortAnswer?: string; executiveSummary?: string[]; report?: string; openQuestions?: string[]; overallConfidence?: string } | null;
  finalReport?: string | null;
  meter?: string;
}

export function liteFromStored(s: StoredSession['sources'][number]): LiteSource {
  const fresh = typeof s.freshness === 'string' ? s.freshness : (s.freshness?.label ?? 'unknown');
  return {
    id: s.id,
    url: s.url,
    domain: s.domain,
    title: s.title,
    snippet: s.snippet ?? '',
    type: s.type ?? 'unknown',
    trust: s.trust ?? 0,
    relevance: s.relevance ?? 0,
    freshness: fresh,
    fetched: Boolean(s.fetched),
    verified: Boolean(s.verified),
    fetchError: s.fetchError,
    contentChars: s.content?.length ?? 0,
    foundVia: s.foundVia ?? '',
  };
}

export function evidenceByStoredSource(notes: StoredSession['notes']): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const n of notes ?? []) {
    const line = (n.quote?.trim() || n.text?.trim() || '').slice(0, 280);
    if (!line) continue;
    const arr = out[n.sourceId] ?? (out[n.sourceId] = []);
    if (arr.length < 5) arr.push(line);
  }
  return out;
}

export function uiDepthForEngine(d: EngineDepth, mode?: EngineMode): UiDepth {
  if (mode === 'academic') return 'academic';
  if (d === 'quick') return 'quick';
  if (d === 'thorough') return 'deep';
  return 'standard';
}
