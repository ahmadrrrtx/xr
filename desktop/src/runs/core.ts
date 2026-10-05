/*
 * Control Room — pure list logic (Phase 11, brief §2/§4/§8).
 *
 * Everything the table, stats bar, charts and export need, with no React
 * and no store: filter → sort → aggregate → format, plus CSV/JSON encoders
 * and the three chart reducers. Importable by the root test tier
 * (test/desktop/runs-core.test.ts) exactly like approvalCore/orbCore.
 */
import { fmtTokens, fmtUsd } from '@/brain/format';
import type {
  AgentKind,
  Run,
  RunStatus,
  RunSummary,
  RunSurface,
} from '@/brain/types';

/* ── Filter / sort vocab ───────────────────────────────────────────────── */

export type StatusFilter =
  'all' | 'running' | 'completed' | 'failed' | 'killed';
export const STATUS_FILTERS: readonly StatusFilter[] = [
  'all',
  'running',
  'completed',
  'failed',
  'killed',
];
export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  killed: 'Killed',
};

export type DateRange = '1h' | '24h' | '7d' | '30d' | 'all';
export const DATE_RANGES: readonly DateRange[] = [
  '1h',
  '24h',
  '7d',
  '30d',
  'all',
];
export const DATE_RANGE_LABEL: Record<DateRange, string> = {
  '1h': 'Last hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  all: 'All time',
};
const HOUR = 3_600_000;
const DAY = 86_400_000;
export const DATE_RANGE_MS: Record<DateRange, number> = {
  '1h': HOUR,
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
  all: Number.POSITIVE_INFINITY,
};

export type SortColumn =
  | 'id'
  | 'title'
  | 'agent'
  | 'workspace'
  | 'model'
  | 'startedAt'
  | 'duration'
  | 'tokens'
  | 'cost';
export interface SortState {
  col: SortColumn;
  dir: 'asc' | 'desc';
}
export const DEFAULT_SORT: SortState = { col: 'startedAt', dir: 'desc' };
/** Columns whose value moves while a run is in flight (re-sort while ticking). */
export const LIVE_SORT_COLUMNS: ReadonlySet<SortColumn> = new Set([
  'duration',
  'tokens',
  'cost',
]);

export const SURFACES: readonly RunSurface[] = [
  'chat',
  'builder',
  'research',
  'voice',
  'background',
  'cli',
];

/* ── Status helpers ────────────────────────────────────────────────────── */

/** "In progress" = running OR parked at an approval gate. */
export function inProgress(status: RunStatus): boolean {
  return status === 'running' || status === 'waiting';
}

export function matchesStatus(run: RunSummary, f: StatusFilter): boolean {
  if (f === 'all') return true;
  if (f === 'running') return inProgress(run.status);
  return run.status === f;
}

/** Elapsed or settled duration. */
export function runDuration(run: RunSummary, now: number): number {
  if (run.durationMs != null) return run.durationMs;
  if (run.endedAt != null) return Math.max(0, run.endedAt - run.startedAt);
  return Math.max(0, now - run.startedAt);
}

/* ── Filtering ─────────────────────────────────────────────────────────── */

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

export function matchesSearch(run: RunSummary, q: string): boolean {
  if (!q) return true;
  const hay = [
    run.id,
    run.shortId,
    run.title,
    run.agent,
    run.workspace ?? '',
    run.model,
    run.errorSummary ?? '',
  ]
    .join('\u0000')
    .toLowerCase();
  // Every whitespace-separated term must match somewhere.
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => hay.includes(term));
}

export function inRange(
  run: RunSummary,
  range: DateRange,
  now: number
): boolean {
  const ms = DATE_RANGE_MS[range];
  if (!Number.isFinite(ms)) return true;
  return run.startedAt >= now - ms;
}

export interface FilterOpts {
  status: StatusFilter;
  search: string;
  range: DateRange;
  now: number;
  includeArchived?: boolean;
}

/** Range + search + archive gate — the status tabs count over this set. */
export function filterBase(
  runs: readonly RunSummary[],
  opts: Omit<FilterOpts, 'status'>
): RunSummary[] {
  const q = normalizeQuery(opts.search);
  const out: RunSummary[] = [];
  for (const r of runs) {
    if (r.archived && !opts.includeArchived) continue;
    if (!inRange(r, opts.range, opts.now)) continue;
    if (!matchesSearch(r, q)) continue;
    out.push(r);
  }
  return out;
}

export function filterRuns(
  runs: readonly RunSummary[],
  opts: FilterOpts
): RunSummary[] {
  return filterBase(runs, opts).filter((r) => matchesStatus(r, opts.status));
}

export type StatusCounts = Record<StatusFilter, number>;

export function statusCounts(runs: readonly RunSummary[]): StatusCounts {
  const c: StatusCounts = {
    all: 0,
    running: 0,
    completed: 0,
    failed: 0,
    killed: 0,
  };
  for (const r of runs) {
    c.all += 1;
    if (inProgress(r.status)) c.running += 1;
    else if (r.status === 'completed') c.completed += 1;
    else if (r.status === 'failed') c.failed += 1;
    else if (r.status === 'killed') c.killed += 1;
  }
  return c;
}

/* ── Sorting ───────────────────────────────────────────────────────────── */

function idNumber(run: RunSummary): number {
  const n = Number(run.shortId.replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function compareRuns(
  a: RunSummary,
  b: RunSummary,
  sort: SortState,
  now: number
): number {
  let c: number;
  switch (sort.col) {
    case 'id':
      c = idNumber(a) - idNumber(b) || a.id.localeCompare(b.id);
      break;
    case 'title':
      c = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      break;
    case 'agent':
      c = a.agent.localeCompare(b.agent, undefined, { sensitivity: 'base' });
      break;
    case 'workspace':
      c = (a.workspace ?? '\uffff').localeCompare(b.workspace ?? '\uffff');
      break;
    case 'model':
      c = a.model.localeCompare(b.model);
      break;
    case 'duration':
      c = runDuration(a, now) - runDuration(b, now);
      break;
    case 'tokens':
      c = a.tokensIn + a.tokensOut - (b.tokensIn + b.tokensOut);
      break;
    case 'cost':
      c = a.costUsd - b.costUsd;
      break;
    case 'startedAt':
    default:
      c = a.startedAt - b.startedAt;
      break;
  }
  if (c === 0 && sort.col !== 'startedAt') c = a.startedAt - b.startedAt;
  if (c === 0) c = a.id.localeCompare(b.id);
  return sort.dir === 'asc' ? c : -c;
}

export function sortRuns(
  runs: readonly RunSummary[],
  sort: SortState,
  now: number
): RunSummary[] {
  return [...runs].sort((a, b) => compareRuns(a, b, sort, now));
}

/** Click-to-sort: same column toggles direction; new column gets its natural default. */
export function nextSort(current: SortState, col: SortColumn): SortState {
  if (current.col === col) {
    return { col, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  const textual =
    col === 'title' ||
    col === 'agent' ||
    col === 'workspace' ||
    col === 'model';
  return { col, dir: textual ? 'asc' : 'desc' };
}

/* ── Aggregates ────────────────────────────────────────────────────────── */

export interface RunStats {
  runsToday: number;
  tokensToday: number;
  costToday: number;
  runningCount: number;
  failed24h: number;
}

export function startOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function aggregate(runs: readonly RunSummary[], now: number): RunStats {
  const today = startOfToday(now);
  const dayAgo = now - DAY;
  const s: RunStats = {
    runsToday: 0,
    tokensToday: 0,
    costToday: 0,
    runningCount: 0,
    failed24h: 0,
  };
  for (const r of runs) {
    if (r.archived) continue;
    if (r.startedAt >= today) {
      s.runsToday += 1;
      s.tokensToday += r.tokensIn + r.tokensOut;
      s.costToday += r.costUsd;
    }
    if (inProgress(r.status)) s.runningCount += 1;
    if (r.status === 'failed' && r.startedAt >= dayAgo) s.failed24h += 1;
  }
  return s;
}

export type SurfaceCounts = Record<RunSurface, number>;

/** In-progress runs per surface (fixed order, zeros included). */
export function surfaceCounts(runs: readonly RunSummary[]): SurfaceCounts {
  const c: SurfaceCounts = {
    chat: 0,
    builder: 0,
    research: 0,
    voice: 0,
    background: 0,
    cli: 0,
  };
  for (const r of runs) {
    if (!r.archived && inProgress(r.status)) c[r.surface] += 1;
  }
  return c;
}

/* ── Model / agent classification ──────────────────────────────────────── */

export type ModelFamily = 'openai' | 'anthropic' | 'google' | 'local' | 'other';

export function modelFamily(model: string): ModelFamily {
  const m = model.toLowerCase();
  if (m.startsWith('ollama/') || m.includes(':')) return 'local';
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3'))
    return 'openai';
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gemini')) return 'google';
  if (m.includes('llama') || m.includes('qwen') || m.includes('mistral'))
    return 'local';
  return 'other';
}

export function isLocalModel(model: string): boolean {
  return modelFamily(model) === 'local';
}

/** Chart palette slot per model (CSS var suffix, themed in themes.css). */
export function modelColorVar(model: string): string {
  switch (modelFamily(model)) {
    case 'openai':
      return 'var(--chart-openai)';
    case 'anthropic':
      return 'var(--chart-anthropic)';
    case 'google':
      return 'var(--chart-google)';
    case 'local':
      return 'var(--chart-local)';
    default:
      return 'var(--chart-other)';
  }
}

export function agentKindFor(agent: string, title = ''): AgentKind {
  const a = agent.toLowerCase();
  const t = title.toLowerCase();
  if (a.includes('coder') || a.includes('builder') || a.includes('dev'))
    return 'builder';
  if (a.includes('research') || a.includes('analyst')) return 'research';
  if (a.includes('voice')) return 'voice';
  if (
    a.includes('ops') ||
    a.includes('background') ||
    a.includes('cron') ||
    a.includes('scheduler') ||
    t.startsWith('background:')
  ) {
    return 'background';
  }
  return 'chat';
}

/** Agent chip colour slot — keyed by well-known names, kind as fallback. */
export function agentColorVar(agent: string, kind: AgentKind): string {
  const a = agent.toLowerCase();
  if (a.startsWith('coder')) return 'var(--agent-coder)';
  if (a.startsWith('research') || a.startsWith('analyst'))
    return 'var(--agent-research)';
  if (a.startsWith('writer')) return 'var(--agent-writer)';
  if (a.startsWith('ops') || a.startsWith('background'))
    return 'var(--agent-ops)';
  if (a.startsWith('planner')) return 'var(--agent-planner)';
  if (a.startsWith('main')) return 'var(--agent-main)';
  switch (kind) {
    case 'builder':
      return 'var(--agent-coder)';
    case 'research':
      return 'var(--agent-research)';
    case 'background':
      return 'var(--agent-ops)';
    case 'voice':
      return 'var(--agent-planner)';
    default:
      return 'var(--agent-main)';
  }
}

/* ── Projection from the trace-level Run ───────────────────────────────── */

export function runStatusOf(status: Run['status']): RunStatus {
  return status === 'pending' ? 'running' : status;
}

export function summaryFromRun(run: Run, prev?: RunSummary): RunSummary {
  const status = runStatusOf(run.status);
  const kind = prev?.agentKind ?? agentKindFor(run.agent, run.title);
  const ended = run.endedAt;
  return {
    id: run.id,
    shortId: run.shortId,
    title: run.title,
    agent: run.agent,
    agentKind: kind,
    workspace: run.workspace ?? prev?.workspace,
    workspaceId: prev?.workspaceId,
    model: run.model,
    status,
    startedAt: run.startedAt,
    endedAt: ended,
    durationMs: ended != null ? Math.max(0, ended - run.startedAt) : null,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    errorSummary: prev?.errorSummary,
    surface: prev?.surface ?? kind,
    archived: prev?.archived,
  };
}

/* ── Formatting (table cells) ──────────────────────────────────────────── */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Relative while recent (<1h), clock time today, "Oct 3, 14:22" otherwise. */
export function fmtStarted(ts: number, now: number): string {
  const d = Math.max(0, now - ts);
  if (d < 15_000) return 'just now';
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < HOUR) return `${Math.round(d / 60_000)}m ago`;
  const date = new Date(ts);
  if (ts >= startOfToday(now)) return hhmm(date);
  // Yesterday keeps its clock time; older days read as a date (the cell's
  // tooltip carries the full timestamp either way).
  if (ts >= startOfToday(now) - DAY) return `Yesterday ${hhmm(date)}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Full absolute timestamp for tooltips / aria. */
export function fmtStartedFull(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${hhmm(d)}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** "1.2k / 420" — prompt / completion. */
export function fmtTokenPair(tokensIn: number, tokensOut: number): string {
  return `${fmtTokens(tokensIn)} / ${fmtTokens(tokensOut)}`;
}

/** "$0.042"; a true zero (local model) reads "$0". */
export function fmtCostCell(usd: number): string {
  if (!usd || usd <= 0) return '$0';
  return fmtUsd(usd);
}

/** Compact clock for the live duration cell: 12.4s, 2:14. */
export function fmtLiveDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (m < 60) return `${m}:${String(sec).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/* ── Export ────────────────────────────────────────────────────────────── */

export const CSV_COLUMNS = [
  'Status',
  'ID',
  'Title',
  'Agent',
  'Workspace',
  'Model',
  'Started',
  'Ended',
  'Duration ms',
  'Tokens In',
  'Tokens Out',
  'Cost USD',
  'Error summary',
] as const;

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC-4180 CSV, ISO timestamps, plain machine-readable numbers. */
export function toCsv(rows: readonly RunSummary[], now: number): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.status,
        r.shortId,
        r.title,
        r.agent,
        r.workspace ?? '',
        r.model,
        new Date(r.startedAt).toISOString(),
        r.endedAt != null ? new Date(r.endedAt).toISOString() : '',
        Math.round(runDuration(r, now)),
        r.tokensIn,
        r.tokensOut,
        r.costUsd.toFixed(6),
        r.errorSummary ?? '',
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
}

export function toJson(rows: readonly RunSummary[], now: number): string {
  return JSON.stringify(
    {
      schema: 'xr.runs.v1',
      exportedAt: new Date(now).toISOString(),
      count: rows.length,
      runs: rows.map((r) => ({
        ...r,
        durationMs: Math.round(runDuration(r, now)),
      })),
    },
    null,
    2
  );
}

/** `xr-runs-2026-10-05-1422.csv` */
export function exportFilename(ext: 'csv' | 'json', now: number): string {
  const d = new Date(now);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `xr-runs-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

/* ── Charts ────────────────────────────────────────────────────────────── */

export interface HourBucket {
  /** Start of the hour (ms). */
  at: number;
  /** "12a", "1a", … "11p" */
  label: string;
  count: number;
  isCurrent: boolean;
}

export function hourLabel(hour24: number): string {
  const h = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${h}${hour24 < 12 ? 'a' : 'p'}`;
}

/** 24 buckets ending with the current hour. */
export function runsPerHour(
  runs: readonly RunSummary[],
  now: number
): HourBucket[] {
  const cur = new Date(now);
  cur.setMinutes(0, 0, 0);
  const curStart = cur.getTime();
  const buckets: HourBucket[] = [];
  for (let i = 23; i >= 0; i--) {
    const at = curStart - i * HOUR;
    buckets.push({
      at,
      label: hourLabel(new Date(at).getHours()),
      count: 0,
      isCurrent: i === 0,
    });
  }
  const first = buckets[0].at;
  for (const r of runs) {
    if (r.startedAt < first || r.startedAt >= curStart + HOUR) continue;
    const idx = Math.floor((r.startedAt - first) / HOUR);
    if (buckets[idx]) buckets[idx].count += 1;
  }
  return buckets;
}

/** Stacked-area order, bottom → top. Local stays in the legend at $0 —
 * "local is free" is the point. */
export const COST_STACK: readonly ModelFamily[] = [
  'openai',
  'anthropic',
  'google',
  'other',
  'local',
];
export const FAMILY_LABEL: Record<ModelFamily, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  local: 'Local',
  other: 'Other',
};
export function familyColorVar(f: ModelFamily): string {
  return `var(--chart-${f})`;
}

export interface DayBucket {
  /** Local midnight (ms). */
  at: number;
  /** "Oct 2" */
  label: string;
  /** Spend per model family (stack layers). */
  byFamily: Record<ModelFamily, number>;
  cloud: number;
  local: number;
  total: number;
}

function emptyFamilies(): Record<ModelFamily, number> {
  return { openai: 0, anthropic: 0, google: 0, local: 0, other: 0 };
}

/** Cost per calendar day for the last `days` days (oldest first). */
export function costPerDay(
  runs: readonly RunSummary[],
  now: number,
  days = 30
): DayBucket[] {
  const today = startOfToday(now);
  const buckets: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const at = d.getTime();
    buckets.push({
      at,
      label: `${MONTHS[d.getMonth()]} ${d.getDate()}`,
      byFamily: emptyFamilies(),
      cloud: 0,
      local: 0,
      total: 0,
    });
  }
  for (const r of runs) {
    if (r.startedAt < buckets[0].at || r.startedAt >= today + DAY) continue;
    // Binary-free: days are contiguous local midnights, but DST shifts by an
    // hour, so match by calendar day rather than dividing.
    const dayStart = startOfToday(r.startedAt);
    const b = buckets.find((x) => x.at === dayStart);
    if (!b) continue;
    const fam = modelFamily(r.model);
    b.byFamily[fam] += r.costUsd;
    if (fam === 'local') b.local += r.costUsd;
    else b.cloud += r.costUsd;
    b.total += r.costUsd;
  }
  return buckets;
}

export interface ModelSlice {
  model: string;
  tokens: number;
  share: number;
  color: string;
}

/** Top 5 models by tokens + "Other"; shares sum to 1 (or empty). */
export function tokensByModel(runs: readonly RunSummary[]): ModelSlice[] {
  const by = new Map<string, number>();
  let total = 0;
  for (const r of runs) {
    const t = r.tokensIn + r.tokensOut;
    if (t <= 0) continue;
    by.set(r.model, (by.get(r.model) ?? 0) + t);
    total += t;
  }
  if (total === 0) return [];
  const sorted = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((acc, [, t]) => acc + t, 0);
  // Two models of one family (gpt-4o / gpt-4o-mini) share a hue; the
  // second and third get progressively lighter mixes so slices stay apart.
  const seen = new Map<string, number>();
  const slices: ModelSlice[] = top.map(([model, tokens]) => {
    const base = modelColorVar(model);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const color =
      n === 0
        ? base
        : `color-mix(in oklab, ${base} ${n === 1 ? 60 : 35}%, var(--text-primary))`;
    return { model, tokens, share: tokens / total, color };
  });
  if (rest > 0) {
    slices.push({
      model: 'Other',
      tokens: rest,
      share: rest / total,
      color: 'var(--chart-other)',
    });
  }
  return slices;
}

export interface Totals {
  runs: number;
  tokens: number;
  cost: number;
  failed: number;
  /** 0–100, finished runs only; 100 when nothing finished. */
  successRate: number;
}

export function totals(runs: readonly RunSummary[]): Totals {
  let tokens = 0;
  let cost = 0;
  let failed = 0;
  let finished = 0;
  let ok = 0;
  for (const r of runs) {
    tokens += r.tokensIn + r.tokensOut;
    cost += r.costUsd;
    if (r.status === 'failed') failed += 1;
    if (r.status === 'completed' || r.status === 'failed') {
      finished += 1;
      if (r.status === 'completed') ok += 1;
    }
  }
  return {
    runs: runs.length,
    tokens,
    cost,
    failed,
    successRate: finished === 0 ? 100 : Math.round((ok / finished) * 100),
  };
}

/** Nice axis max: 1, 2, 5 × 10^n ≥ value (never truncates). */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const n = value / base;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * base;
}
