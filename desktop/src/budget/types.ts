/*
 * Budget types (Phase 13, SCREEN 11). Mirrors src-tauri/src/budget/*.rs
 * field for field (camelCase on the wire). All money is USD as f64; every
 * comparison in the governor goes through the EPS in core.ts.
 */

export type BudgetTab =
  'overview' | 'history' | 'models' | 'agents' | 'workspaces' | 'settings';

export const BUDGET_TABS: ReadonlyArray<{ id: BudgetTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'history', label: 'Spend History' },
  { id: 'models', label: 'Models' },
  { id: 'agents', label: 'Agents' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'settings', label: 'Settings' },
];

export function isBudgetTab(v: unknown): v is BudgetTab {
  return BUDGET_TABS.some((t) => t.id === v);
}

/**
 * Governor state, highest priority first:
 *  paused  — manual pause, 95 % breaker or spike breaker; only the user resumes
 *  capped  — hard cap on and the usable budget (limit − reserve) is spent
 *  over    — hard cap OFF and the limit is exceeded (allowed, flagged)
 *  danger  — ≥ 85 % used (bar is red here too)
 *  warn    — ≥ notifyWarnPct used
 *  local   — monthly limit is $0: local-only mode
 *  ok
 */
export type BudgetStateId =
  'ok' | 'local' | 'warn' | 'danger' | 'capped' | 'over' | 'paused';

export type PauseReason = 'manual' | 'threshold' | 'spike' | 'emergency';

export type BillingTier = 'personal' | 'pro';

export interface BudgetSettings {
  monthlyLimit: number;
  hardCap: boolean;
  /** 0.8–1.0 — auto-pause when spent/limit reaches this (hard cap on only). */
  circuitBreakerPct: number;
  /** USD in any rolling 5-minute window — the runaway-loop breaker. */
  circuitBreakerSpendPer5min: number;
  modelDownshifting: boolean;
  /** 0–0.2 — share of the monthly limit held back for finalization. */
  finalizationReservePct: number;
  /** 0 = off. */
  dailyLimit: number;
  /** 0 = off. */
  perRequestLimit: number;
  notifyWarnPct: number;
  notifyOs: boolean;
  notifyToast: boolean;
  billingTier: BillingTier;
  perAgentCaps: Record<string, number>;
  perWorkspaceCaps: Record<string, number>;
  /** 1–28 */
  monthStartDay: number;
  paused: boolean;
  pauseReason: PauseReason | null;
  pausedAt: number | null;
  /** Cloud models with a key configured (mock: the Phase 8 provider list). */
  configuredModels: string[];
  /** Local (Ollama) models present on this machine (mock until Phase 14). */
  installedLocal: string[];
  /** The user's default chat model (mirrors settings.defaults.model). */
  defaultModel: string;
}

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = {
  monthlyLimit: 5,
  hardCap: true,
  circuitBreakerPct: 0.95,
  circuitBreakerSpendPer5min: 0.5,
  modelDownshifting: true,
  finalizationReservePct: 0.1,
  dailyLimit: 1,
  perRequestLimit: 0.25,
  notifyWarnPct: 0.8,
  notifyOs: true,
  notifyToast: true,
  billingTier: 'personal',
  perAgentCaps: {},
  perWorkspaceCaps: {},
  monthStartDay: 1,
  paused: false,
  pauseReason: null,
  pausedAt: null,
  configuredModels: [
    'claude-sonnet-4.5',
    'claude-haiku-4-6',
    'gpt-5',
    'gpt-5-mini',
    'gpt-4o',
    'gpt-4o-mini',
    'gemini-2.5-flash',
  ],
  installedLocal: ['qwen2.5:3b', 'qwen2.5-coder:3b'],
  defaultModel: 'claude-sonnet-4.5',
};

export type BudgetSettingsPatch = Partial<BudgetSettings>;

export type SpendKind =
  | 'llm_call'
  | 'tool_call'
  | 'voice'
  | 'compute'
  | 'blocked'
  | 'downshifted'
  | 'cap_set'
  | 'reset'
  | 'paused'
  | 'resumed';

export type SpendCategory = 'llm' | 'tools' | 'voice' | 'compute';

export const SPEND_CATEGORIES: readonly SpendCategory[] = [
  'llm',
  'tools',
  'voice',
  'compute',
];

export const CATEGORY_LABEL: Record<SpendCategory, string> = {
  llm: 'LLM',
  tools: 'Tools',
  voice: 'Voice',
  compute: 'Compute',
};

export type SpendSurface =
  'chat' | 'brain' | 'hud' | 'voice' | 'playground' | 'test' | 'seed';

export interface SpendEvent {
  id: string;
  ts: number;
  kind: SpendKind;
  agent: string | null;
  workspace: string | null;
  /** Chat session or Brain run id — the row links back to it. */
  sessionId: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  category: SpendCategory;
  detail: Record<string, unknown> | null;
}

export interface SpendInput {
  kind: SpendKind;
  agent?: string | null;
  workspace?: string | null;
  sessionId?: string | null;
  model?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  costUsd: number;
  category?: SpendCategory;
  detail?: Record<string, unknown> | null;
  ts?: number;
}

export type PreCallCode =
  | 'ok'
  | 'downshifted'
  | 'over-soft'
  | 'paused'
  | 'per-request'
  | 'month'
  | 'day'
  | 'agent'
  | 'workspace'
  | 'local-only'
  | 'spike';

export interface PreCallRequest {
  model: string;
  estimatedTokensIn: number;
  estimatedTokensOut: number;
  /** Override the registry estimate (tests / playground). */
  estimatedCost?: number;
  agent?: string | null;
  workspace?: string | null;
  sessionId?: string | null;
  /** Wrap-up call: may use the finalization reserve. */
  finalization?: boolean;
  surface: SpendSurface;
}

export interface PreCallCheck {
  allowed: boolean;
  code: PreCallCode;
  /** One calm sentence with a repair path (Art. X.3), null when allowed. */
  reason: string | null;
  downgradedToModel: string | null;
  /** Why the governor switched models (shown in the chat badge tooltip). */
  downshiftWhy: string | null;
  /** The model the call should run with (original or the downshift). */
  model: string;
  estimatedCost: number;
  /** Usable remaining for new work (reserve held back), after this call. */
  remaining: number;
  /** Absolute stop for in-flight work; null = no hard stop (hard cap off). */
  hardRemaining: number | null;
  state: BudgetStateId;
  /** Hard cap OFF: the call went over the limit and was allowed. */
  warning: string | null;
}

export interface BudgetOverview {
  spentToday: number;
  spentMonth: number;
  monthlyLimit: number;
  dailyLimit: number;
  pctUsedMonth: number;
  pctUsedToday: number;
  tokensInMonth: number;
  tokensOutMonth: number;
  daysUntilReset: number;
  /** "2026-10-31" — the last day of the period, local. */
  resetDate: string;
  periodStart: number;
  periodEnd: number;
  avgPerDay: number;
  projectedMonthEnd: number;
  biggestRun: {
    sessionId: string | null;
    costUsd: number;
    model: string | null;
  } | null;
  /** Usable remaining for new calls (reserve held back). */
  remaining: number;
  reserveUsd: number;
  spentLast5min: number;
  blockedMonth: number;
  downshiftedMonth: number;
  agentSpend: Record<string, number>;
  workspaceSpend: Record<string, number>;
  eventsTotal: number;
  state: BudgetStateId;
  settings: BudgetSettings;
  computedAt: number;
}

export type SpendRange = '24h' | '7d' | '30d' | 'all';

export const SPEND_RANGES: readonly SpendRange[] = ['24h', '7d', '30d', 'all'];
export const SPEND_RANGE_LABEL: Record<SpendRange, string> = {
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
  all: 'All',
};

export interface SpendFilter {
  search: string;
  category: SpendCategory | 'all';
  model: string | 'all';
  agent: string | 'all';
  kind: 'all' | 'spend' | 'blocked' | 'downshifted';
  range: SpendRange;
}

export const DEFAULT_SPEND_FILTER: SpendFilter = {
  search: '',
  category: 'all',
  model: 'all',
  agent: 'all',
  kind: 'all',
  range: '30d',
};

export type SpendSortKey = 'ts' | 'costUsd';
export interface SpendSort {
  key: SpendSortKey;
  dir: 'asc' | 'desc';
}

export interface SpendPage {
  events: SpendEvent[];
  nextCursor: string | null;
  total: number;
  totalCost: number;
}

export interface SeriesBucket {
  /** Bucket start (ms, local-aligned). */
  at: number;
  label: string;
  total: number;
  byCategory: Record<SpendCategory, number>;
}

export type BreakdownBy = 'model' | 'agent' | 'workspace' | 'category';

export interface BreakdownRow {
  key: string;
  cost: number;
  tokens: number;
  count: number;
}

export interface StateChange {
  prev: BudgetStateId;
  next: BudgetStateId;
  reason: string;
  at: number;
}
