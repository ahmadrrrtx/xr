/*
 * Deterministic demo spend (Phase 13). Seeded once per install so Spend
 * History has ~220 rows and the 30-day chart has a shape; today is left
 * empty so a fresh install still reads "Today $0.00". Ported line for line
 * to src-tauri/src/budget/governor.rs (`seed_events`) — the vector test in
 * test/desktop/budget-core.test.ts pins both.
 */
import { estimateCost, round6 } from './models';
import { DAY_MS, localDayStart } from './period';
import type { SpendCategory, SpendEvent, SpendKind } from './types';

export const SEED_VERSION = 1;
export const SEED_RNG = 0x1317_b0d6;

/** mulberry32 — 32-bit integer ops only, so Rust matches bit for bit. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Weighted<T> {
  v: T;
  w: number;
}

function pick<T>(rand: () => number, table: readonly Weighted<T>[]): T {
  const r = rand();
  let acc = 0;
  for (const row of table) {
    acc += row.w;
    if (r < acc) return row.v;
  }
  return table[table.length - 1].v;
}

const AGENTS: readonly Weighted<string>[] = [
  { v: 'main', w: 0.45 },
  { v: 'coder', w: 0.25 },
  { v: 'research', w: 0.2 },
  { v: 'writer', w: 0.1 },
];

const WORKSPACES: readonly Weighted<string>[] = [
  { v: 'xr', w: 0.55 },
  { v: 'client-acme', w: 0.3 },
  { v: 'personal', w: 0.15 },
];

const MODELS: readonly Weighted<string>[] = [
  { v: 'claude-sonnet-4.5', w: 0.35 },
  { v: 'gpt-5-mini', w: 0.2 },
  { v: 'claude-haiku-4-6', w: 0.15 },
  { v: 'gpt-4o-mini', w: 0.1 },
  { v: 'gemini-2.5-flash', w: 0.1 },
  { v: 'qwen2.5:3b', w: 0.07 },
  { v: 'gpt-5', w: 0.03 },
];

const KINDS: readonly Weighted<SpendKind>[] = [
  { v: 'llm_call', w: 0.85 },
  { v: 'tool_call', w: 0.08 },
  { v: 'voice', w: 0.04 },
  { v: 'compute', w: 0.03 },
];

const TOOLS = [
  'web_search',
  'read_file',
  'shell',
  'gmail',
  'calendar',
  'browser',
];

function categoryOf(kind: SpendKind): SpendCategory {
  switch (kind) {
    case 'tool_call':
      return 'tools';
    case 'voice':
      return 'voice';
    case 'compute':
      return 'compute';
    default:
      return 'llm';
  }
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

/**
 * ~220 events across the 30 local days before `now` (none today).
 * `tzOffsetMin` = `new Date().getTimezoneOffset()`.
 */
export function seedEvents(now: number, tzOffsetMin: number): SpendEvent[] {
  const rand = mulberry32(SEED_RNG);
  const todayStart = localDayStart(now, tzOffsetMin);
  const out: SpendEvent[] = [];
  let n = 0;
  const next = (): string => {
    n += 1;
    return `sp_seed_${pad4(n)}`;
  };

  for (let back = 30; back >= 1; back--) {
    const dayStart = todayStart - back * DAY_MS;
    const count = 4 + Math.floor(rand() * 8);
    for (let i = 0; i < count; i++) {
      const hour = 9 + Math.floor(rand() * 12);
      const minute = Math.floor(rand() * 60);
      const second = Math.floor(rand() * 60);
      const ts = dayStart + ((hour * 60 + minute) * 60 + second) * 1000;
      const kind = pick(rand, KINDS);
      const agent = pick(rand, AGENTS);
      const workspace = pick(rand, WORKSPACES);
      const sessionHex = Math.floor(rand() * 0xffff)
        .toString(16)
        .padStart(4, '0');
      const sessionId =
        agent === 'main' ? `chat-${sessionHex}` : `run-${sessionHex}`;
      let model: string | null = null;
      let tokensIn = 0;
      let tokensOut = 0;
      let costUsd: number;
      let detail: Record<string, unknown> | null = null;
      if (kind === 'llm_call') {
        model = pick(rand, MODELS);
        tokensIn = 300 + Math.floor(rand() * 2500);
        tokensOut = 100 + Math.floor(rand() * 1200);
        costUsd = estimateCost(model, tokensIn, tokensOut);
      } else if (kind === 'tool_call') {
        const tool = TOOLS[Math.floor(rand() * TOOLS.length)];
        costUsd = round6(0.001 + rand() * 0.019);
        detail = { tool };
      } else if (kind === 'voice') {
        const seconds = 20 + Math.floor(rand() * 160);
        costUsd = round6(seconds * 0.00025);
        model = 'tts-1';
        detail = { seconds };
      } else {
        costUsd = round6(0.002 + rand() * 0.048);
        detail = { job: 'embeddings' };
      }
      out.push({
        id: next(),
        ts,
        kind,
        agent,
        workspace,
        sessionId,
        model,
        tokensIn,
        tokensOut,
        costUsd,
        category: categoryOf(kind),
        detail,
      });
    }
  }

  // A few governor decisions so History shows every kind icon.
  const governor: Array<{ back: number; kind: 'blocked' | 'downshifted' }> = [
    { back: 26, kind: 'downshifted' },
    { back: 19, kind: 'blocked' },
    { back: 12, kind: 'downshifted' },
    { back: 9, kind: 'blocked' },
    { back: 4, kind: 'downshifted' },
    { back: 2, kind: 'blocked' },
  ];
  for (const g of governor) {
    const dayStart = todayStart - g.back * DAY_MS;
    const hour = 9 + Math.floor(rand() * 12);
    const minute = Math.floor(rand() * 60);
    const ts = dayStart + (hour * 60 + minute) * 60 * 1000;
    const agent = pick(rand, AGENTS);
    const workspace = pick(rand, WORKSPACES);
    out.push(
      g.kind === 'blocked'
        ? {
            id: next(),
            ts,
            kind: 'blocked',
            agent,
            workspace,
            sessionId: `run-${Math.floor(rand() * 0xffff)
              .toString(16)
              .padStart(4, '0')}`,
            model: 'claude-opus-4-6',
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
            category: 'llm',
            detail: {
              code: 'per-request',
              estimatedCost: round6(0.26 + rand() * 0.2),
            },
          }
        : {
            id: next(),
            ts,
            kind: 'downshifted',
            agent,
            workspace,
            sessionId: `chat-${Math.floor(rand() * 0xffff)
              .toString(16)
              .padStart(4, '0')}`,
            model: 'gpt-5-mini',
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
            category: 'llm',
            detail: { from: 'gpt-5', to: 'gpt-5-mini' },
          }
    );
  }

  out.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  return out;
}
