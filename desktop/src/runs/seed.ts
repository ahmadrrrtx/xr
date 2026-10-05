/*
 * Control Room — deterministic mock history (Phase 11, brief §1).
 *
 * Two sources, one list:
 *   1. The four canned Brain flavours (medium/error/long/short) — their
 *      numbers come from `materialize()` so a row and its trace agree.
 *      (`mock-waiting` is Brain's live approval demo, not history;
 *      `mock-stress` is listed with its documented totals — materialising
 *      10k spans on every boot buys nothing for a list row.)
 *   2. ~60 generated runs over the last 30 days from a fixed RNG seed:
 *      same ids/titles/agents/models/tokens/costs on every boot; start
 *      times are fractions of calendar days (today: of the elapsed part of
 *      the day), so per-day/per-hour counts are stable too.
 *
 * Only FINISHED states are seeded — a status dot must reflect a real state
 * (design law 2). Live rows come from real mock streams.
 *
 * Generated ids embed a flavour suffix (`run-0812-error`) so `/brain/:id`
 * renders a trace whose shape matches the row (failed → error script).
 */
import { materialize } from '@/brain/mock';
import { rngFrom, type Rng } from '@/brain/rng';
import type {
  AgentKind,
  RunStatus,
  RunSummary,
  RunSurface,
} from '@/brain/types';

import { agentKindFor, startOfToday } from './core';

const DAY = 86_400_000;
const MIN = 60_000;

/* ── Vocabulary ────────────────────────────────────────────────────────── */

interface AgentDef {
  name: string;
  kind: AgentKind;
  weight: number;
  titles: readonly string[];
  workspaces: readonly (string | undefined)[];
}

const AGENTS: readonly AgentDef[] = [
  {
    name: 'Main',
    kind: 'chat',
    weight: 34,
    titles: [
      'Summarize the standup notes',
      'Draft reply to the vendor thread',
      'Explain the OAuth refresh flow',
      'Turn these bullet points into an email',
      'Compare the two pricing proposals',
      'Rewrite the release notes for customers',
      'What changed in the Tauri v2 window API?',
      'Plan the week from my calendar',
      'Translate the onboarding copy to Urdu',
      'Outline the Q4 roadmap doc',
      'Find the duplicate invoices in this CSV',
      'Quick question: regex for ISO dates',
    ],
    workspaces: [undefined, undefined, 'xr-desktop', 'q3-reports'],
  },
  {
    name: 'Coder',
    kind: 'builder',
    weight: 26,
    titles: [
      'Refactor auth middleware',
      'Add unit tests for the cache layer',
      'Fix flaky workspace spawn test',
      'Migrate settings store to v2 schema',
      'Optimize SQLite indexes for sessions',
      'Update dependencies and fix breakage',
      'Implement CSV export for audit log',
      'Type the Tauri event payloads',
      'Debug memory growth in the orb window',
      'Write a migration for the runs table',
    ],
    workspaces: ['xr-desktop', 'xr-desktop', 'acme-platform', 'infra'],
  },
  {
    name: 'Research',
    kind: 'research',
    weight: 16,
    titles: [
      'Research: vector DB options for local memory',
      'Research: agentic AI trust frameworks',
      'Compare STT engines for offline use',
      'Investigate API timeout root cause',
      'Survey: approval UX in developer tools',
      'Literature scan: egress proxy patterns',
    ],
    workspaces: ['q3-reports', undefined, 'docs'],
  },
  {
    name: 'Writer',
    kind: 'chat',
    weight: 10,
    titles: [
      'Write docs: rate limiting',
      'Draft the incident postmortem',
      'Generate the weekly report',
      'Polish the Skills Store listing copy',
      'Edit the security policy for clarity',
    ],
    workspaces: ['docs', 'docs', undefined],
  },
  {
    name: 'Ops',
    kind: 'background',
    weight: 10,
    titles: [
      'Background: sync metrics',
      'Background: nightly memory compaction',
      'Background: check for updates',
      'Background: re-index workspace files',
      'Background: rotate audit chain segment',
    ],
    workspaces: ['infra', undefined],
  },
  {
    name: 'Planner',
    kind: 'chat',
    weight: 4,
    titles: [
      'Plan: multi-step deploy of staging',
      'Plan: triage support backlog',
    ],
    workspaces: ['acme-platform', undefined],
  },
];

interface ModelDef {
  name: string;
  weight: number;
  /** USD per 1M tokens (in, out). Local = 0. */
  priceIn: number;
  priceOut: number;
}

const MODELS: readonly ModelDef[] = [
  { name: 'gpt-4o', weight: 28, priceIn: 2.5, priceOut: 10 },
  { name: 'gpt-4o-mini', weight: 18, priceIn: 0.15, priceOut: 0.6 },
  { name: 'claude-3.5-sonnet', weight: 22, priceIn: 3, priceOut: 15 },
  { name: 'gemini-pro', weight: 10, priceIn: 1.25, priceOut: 5 },
  { name: 'ollama/qwen2.5:7b', weight: 14, priceIn: 0, priceOut: 0 },
  { name: 'ollama/llama3.1:8b', weight: 8, priceIn: 0, priceOut: 0 },
];

const ERRORS: readonly string[] = [
  'Tool timeout: shell.exec exceeded 30s',
  'Provider rate limit (429) after 3 retries',
  'Approval denied by user',
  'Context window exceeded (131k tokens)',
  'fs.writeFile: EACCES /etc/hosts',
  'Network unreachable: api.openai.com',
  'Subagent returned malformed JSON',
];

/** Run counts per day back (0 = today). Heavier in the last 48 h. */
const RUNS_PER_DAY: readonly number[] = [
  8,
  6,
  4,
  2,
  3,
  3,
  2, // this week
  2,
  2,
  1,
  0,
  2,
  1,
  2, // last week
  2,
  1,
  0,
  1,
  2,
  1,
  1, // …
  1,
  0,
  2,
  1,
  1,
  0,
  1,
  2,
  1,
];

/* ── Helpers ───────────────────────────────────────────────────────────── */

function weighted<T extends { weight: number }>(
  rng: Rng,
  items: readonly T[]
): T {
  const total = items.reduce((a, i) => a + i.weight, 0);
  let roll = rng() * total;
  for (const it of items) {
    roll -= it.weight;
    if (roll <= 0) return it;
  }
  return items[items.length - 1];
}

function pickFrom<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

/** Log-uniform between min and max (durations/tokens span 2–3 decades). */
function logUniform(rng: Rng, min: number, max: number): number {
  const a = Math.log(min);
  const b = Math.log(max);
  return Math.exp(a + (b - a) * rng());
}

function flavorFor(status: RunStatus, durationMs: number): string {
  if (status === 'failed') return 'error';
  if (durationMs < 8_000) return 'short';
  if (durationMs < 60_000) return 'medium';
  return 'long';
}

/* ── Canned Brain flavours (rows must agree with their traces) ─────────── */

interface Canned {
  id: string;
  shortId: string;
  agoMs: number;
  surface: RunSurface;
  workspace?: string;
}

const CANNED: readonly Canned[] = [
  { id: 'mock-medium', shortId: '#847', agoMs: 14 * MIN, surface: 'chat' },
  {
    id: 'mock-error',
    shortId: '#303',
    agoMs: 42 * MIN,
    surface: 'builder',
    workspace: 'acme-platform',
  },
  {
    id: 'mock-long',
    shortId: '#512',
    agoMs: 3 * 60 * MIN,
    surface: 'research',
    workspace: 'q3-reports',
  },
  { id: 'mock-short', shortId: '#101', agoMs: 6 * 60 * MIN, surface: 'chat' },
];

function cannedRows(now: number): RunSummary[] {
  const rows: RunSummary[] = [];
  for (const c of CANNED) {
    const flavor = c.id.replace('mock-', '') as
      'medium' | 'error' | 'long' | 'short';
    const startedAt = now - c.agoMs;
    const mat = materialize(
      c.id,
      flavor,
      startedAt,
      Number.POSITIVE_INFINITY,
      now
    );
    const run = mat.run;
    const failing = Object.values(mat.spans).find(
      (s) => s.status === 'failed' && s.error
    );
    const status: RunStatus =
      run.status === 'pending' ? 'completed' : run.status;
    rows.push({
      id: c.id,
      shortId: c.shortId,
      title: run.title,
      agent: run.agent,
      agentKind: agentKindFor(run.agent, run.title),
      workspace: c.workspace ?? run.workspace,
      model: run.model,
      status,
      startedAt,
      endedAt: run.endedAt,
      durationMs: run.endedAt != null ? run.endedAt - startedAt : null,
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      costUsd: run.costUsd,
      errorSummary: failing?.error
        ? `${failing.error.name}: ${failing.error.message}`
        : undefined,
      surface: c.surface,
    });
  }
  // Stress run — documented totals (Brain's index lists the same numbers).
  rows.push({
    id: 'mock-stress',
    shortId: '#900',
    title: 'Stress: 10,000-span ingest',
    agent: 'Main',
    agentKind: 'background',
    model: 'gpt-4o-mini',
    status: 'completed',
    startedAt: now - 26 * 60 * MIN,
    endedAt: now - 26 * 60 * MIN + 30_000,
    durationMs: 30_000,
    tokensIn: 318_400,
    tokensOut: 62_100,
    costUsd: 0.31,
    surface: 'cli',
  });
  return rows;
}

/* ── Generated history ─────────────────────────────────────────────────── */

export const SEED_KEY = 'xr-runs-seed-v1';

export interface SeedOptions {
  /** Days of history (default 30). */
  days?: number;
  /** Include the canned Brain flavours (default true). */
  canned?: boolean;
}

export function seedMockHistory(
  now: number,
  opts: SeedOptions = {}
): RunSummary[] {
  const days = opts.days ?? 30;
  const rng = rngFrom(SEED_KEY);
  const today = startOfToday(now);
  const elapsedToday = Math.max(10 * MIN, now - today - 3 * MIN);
  const out: RunSummary[] = [];

  // Oldest first so sequential ids read chronologically.
  const slots: { dayBack: number; frac: number }[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const n = RUNS_PER_DAY[d] ?? 1;
    for (let k = 0; k < n; k++) slots.push({ dayBack: d, frac: rng() });
  }
  slots.sort((a, b) => b.dayBack - a.dayBack || a.frac - b.frac);

  let num = 847 - slots.length - 1; // the newest generated run lands just under #847
  const seenStart = new Set<number>();
  for (const slot of slots) {
    num += 1;
    const agentDef = weighted(rng, AGENTS);
    const modelDef = weighted(rng, MODELS);
    const title = pickFrom(rng, agentDef.titles);
    const workspace = pickFrom(rng, agentDef.workspaces);

    // Status mix: ~86% completed, ~9% failed, ~5% killed.
    const roll = rng();
    const status: RunStatus =
      roll < 0.86 ? 'completed' : roll < 0.95 ? 'failed' : 'killed';

    const durationMs = Math.round(
      status === 'failed'
        ? logUniform(rng, 1_500, 45_000)
        : logUniform(rng, 500, 120_000)
    );
    // Tokens scale loosely with duration; killed/failed runs stop early.
    const scale = status === 'completed' ? 1 : 0.45;
    const tokensIn = Math.round(logUniform(rng, 200, 28_000) * scale);
    const tokensOut = Math.round(logUniform(rng, 60, 12_000) * scale);
    const costUsd =
      (tokensIn * modelDef.priceIn + tokensOut * modelDef.priceOut) / 1_000_000;

    const dayStart = today - slot.dayBack * DAY;
    let startedAt =
      slot.dayBack === 0
        ? dayStart + Math.floor(slot.frac * elapsedToday)
        : dayStart + Math.floor(slot.frac * (DAY - durationMs - MIN));
    while (seenStart.has(startedAt)) startedAt += 1;
    seenStart.add(startedAt);

    const surface: RunSurface =
      agentDef.kind === 'background'
        ? rng() < 0.3
          ? 'cli'
          : 'background'
        : agentDef.kind;

    const padded = String(num).padStart(4, '0');
    out.push({
      id: `run-${padded}-${flavorFor(status, durationMs)}`,
      shortId: `#${num}`,
      title,
      agent: agentDef.name,
      agentKind: agentDef.kind,
      workspace,
      model: modelDef.name,
      status,
      startedAt,
      endedAt: startedAt + durationMs,
      durationMs,
      tokensIn,
      tokensOut,
      costUsd,
      errorSummary: status === 'failed' ? pickFrom(rng, ERRORS) : undefined,
      surface,
    });
  }

  if (opts.canned !== false) out.push(...cannedRows(now));
  return out;
}

/* ── Dev-only stress seed (10k rows, virtualisation check) ─────────────── */

export function seedStress(now: number, count = 10_000): RunSummary[] {
  const rng = rngFrom(`${SEED_KEY}:stress:${count}`);
  const out: RunSummary[] = new Array(count);
  const span = 29 * DAY; // all inside the default 30-day window
  for (let i = 0; i < count; i++) {
    const agentDef = weighted(rng, AGENTS);
    const modelDef = weighted(rng, MODELS);
    const roll = rng();
    const status: RunStatus =
      roll < 0.9 ? 'completed' : roll < 0.97 ? 'failed' : 'killed';
    const durationMs = Math.round(logUniform(rng, 500, 120_000));
    const tokensIn = Math.round(logUniform(rng, 200, 28_000));
    const tokensOut = Math.round(logUniform(rng, 60, 12_000));
    const startedAt = now - 5 * MIN - Math.floor(rng() * span);
    const num = 100_000 + i;
    out[i] = {
      id: `stress-${num}-${flavorFor(status, durationMs)}`,
      shortId: `#${num}`,
      title: pickFrom(rng, agentDef.titles),
      agent: agentDef.name,
      agentKind: agentDef.kind,
      workspace: pickFrom(rng, agentDef.workspaces),
      model: modelDef.name,
      status,
      startedAt,
      endedAt: startedAt + durationMs,
      durationMs,
      tokensIn,
      tokensOut,
      costUsd:
        (tokensIn * modelDef.priceIn + tokensOut * modelDef.priceOut) /
        1_000_000,
      errorSummary: status === 'failed' ? pickFrom(rng, ERRORS) : undefined,
      surface: agentDef.kind,
    };
  }
  return out;
}
