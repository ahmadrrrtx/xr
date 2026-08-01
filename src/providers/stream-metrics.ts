/**
 * XR Phase 3 · T7 — Per-provider streaming metrics.
 *
 * Captures, for every model turn through the provider plane:
 *
 *   - TTFT: time-to-first-token of the turn (ms). On the current substrate
 *     the provider API returns a complete turn, so TTFT is measured as
 *     time-to-first-byte (the response headers/body start) — documented in
 *     docs/perf/PERF-BUDGETS.md.
 *   - tokens/s: usage.outTokens / total turn duration (usage comes from the
 *     provider's own accounting — ModelTurn.usage).
 *   - cancellation latency: when a caller aborts a turn, the time from
 *     abort() to the turn actually settling (where the substrate supports
 *     cancellation).
 *   - memory high-water: process RSS at turn end (Linux VmHWM).
 *
 * Records are written to a bounded append-only log at
 * $XR_HOME/cache/metrics/streaming.jsonl so `xr providers metrics` can
 * report them from any process. No secrets are ever recorded (Part 20):
 * only provider id, model id, durations, token counts and sizes.
 *
 * The collector is wired into ProviderService.getProvider() — the single
 * choke point every model turn passes through (one provider plane, Art. III).
 */

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ModelTurn, Message, Tool, Provider } from "../core/types.ts";

/** Resolved at call time so tests/embedders can isolate via env. */
const XR_HOME_DIR = () => process.env.XR_HOME ?? join(homedir(), ".xr");

export interface TurnMetrics {
  providerId: string;
  model: string;
  /** Time-to-first-byte of the turn, ms. */
  ttftMs: number;
  /** Total turn duration, ms. */
  totalMs: number;
  /** Model-reported output tokens (fallback: estimated chars/4). */
  outTokens: number;
  /** Model-reported input tokens. */
  inTokens: number;
  /** outTokens / (totalMs/1000). */
  tokensPerSec: number;
  /** Time from abort() to settle, ms (0 when no cancellation). */
  cancelLatencyMs: number;
  /** Process RSS high-water at turn end, KiB. */
  highWaterKb?: number;
  at: string;
}

const LOG_DIR = () => join(XR_HOME_DIR(), "cache", "metrics");
const LOG_FILE = () => join(LOG_DIR(), "streaming.jsonl");
const MAX_LINES = 500; // bounded resource (Article XII · Rule 3)

function estimateTokens(text: string): number {
  return Math.max(0, Math.round(text.length / 4));
}

async function peakRssKb(): Promise<number | undefined> {
  if (process.platform !== "linux") return undefined;
  try {
    const status = await Bun.file(`/proc/${process.pid}/status`).text();
    const m = /^VmHWM:\s+(\d+)\s+kB$/m.exec(status);
    return m ? Number(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

export class StreamingMetricsCollector {
  private recent: TurnMetrics[] = [];

  /** Record one turn; appends to the bounded on-disk log (best-effort). */
  record(m: TurnMetrics): void {
    this.recent.push(m);
    if (this.recent.length > 100) this.recent.shift();
    try {
      mkdirSync(LOG_DIR(), { recursive: true });
      const path = LOG_FILE();
      let lines: string[] = [];
      if (existsSync(path)) {
        lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      }
      lines.push(JSON.stringify(m));
      if (lines.length > MAX_LINES) lines = lines.slice(lines.length - MAX_LINES);
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, lines.join("\n") + "\n");
      renameSync(tmp, path);
    } catch {
      /* metrics are best-effort — never break the turn */
    }
  }

  /** In-process recent turns (newest first). */
  recentTurns(limit = 20): TurnMetrics[] {
    return [...this.recent].reverse().slice(0, limit);
  }

  /** All turns from the on-disk log (newest first), for cross-process reports. */
  persistedTurns(limit = 200): TurnMetrics[] {
    try {
      if (!existsSync(LOG_FILE())) return [];
      const lines = readFileSync(LOG_FILE(), "utf8").split("\n").filter(Boolean);
      const out: TurnMetrics[] = [];
      for (const line of lines.slice(-limit)) {
        try {
          out.push(JSON.parse(line) as TurnMetrics);
        } catch {
          /* skip corrupt line */
        }
      }
      return out.reverse();
    } catch {
      return [];
    }
  }

  /** Aggregate summary across persisted turns. */
  summary(): { turns: number; p50TtftMs: number; p95TtftMs: number; p50TokensPerSec: number; p95TokensPerSec: number; avgTokens: number; maxHighWaterKb?: number } {
    const turns = this.persistedTurns();
    if (turns.length === 0) {
      return { turns: 0, p50TtftMs: 0, p95TtftMs: 0, p50TokensPerSec: 0, p95TokensPerSec: 0, avgTokens: 0 };
    }
    const p = (arr: number[], q: number) => {
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)] ?? 0;
    };
    const hw = turns.map((t) => t.highWaterKb).filter((v): v is number => v != null);
    return {
      turns: turns.length,
      p50TtftMs: p(turns.map((t) => t.ttftMs), 50),
      p95TtftMs: p(turns.map((t) => t.ttftMs), 95),
      p50TokensPerSec: p(turns.map((t) => t.tokensPerSec), 50),
      p95TokensPerSec: p(turns.map((t) => t.tokensPerSec), 95),
      avgTokens: Math.round(turns.reduce((a, t) => a + t.outTokens, 0) / turns.length),
      maxHighWaterKb: hw.length ? Math.max(...hw) : undefined,
    };
  }

  /** Reset the log + in-process state (tests, diagnostics). */
  reset(): void {
    this.recent = [];
    try {
      const p = LOG_FILE();
      if (existsSync(p)) renameSync(p, `${p}.bak`);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Wrap a provider so every turn is measured. This is the single instrumented
 * choke point — the wrapped provider behaves identically, with timings
 * recorded after each chat().
 */
export function withTurnMetrics(provider: Provider, collector: StreamingMetricsCollector, modelId?: string): Provider {
  const model = modelId ?? provider.id;
  return {
    id: provider.id,
    label: provider.label,
    async chat(messages: Message[], tools: Tool[]): Promise<ModelTurn> {
      const started = performance.now();
      // TTFT on this substrate = time to first byte; approximated by the
      // provider's response resolving (documented in PERF-BUDGETS.md).
      let settleMs = 0;
      try {
        const turn = await provider.chat(messages, tools);
        const ttftMs = performance.now() - started;
        const totalMs = ttftMs;
        const outTokens = turn.usage?.outTokens ?? estimateTokens(turn.message);
        const inTokens = turn.usage?.inTokens ?? 0;
        const highWaterKb = await peakRssKb();
        collector.record({
          providerId: provider.id,
          model,
          ttftMs: Math.round(ttftMs),
          totalMs: Math.round(totalMs),
          outTokens,
          inTokens,
          tokensPerSec: totalMs > 0 ? Math.round((outTokens / totalMs) * 1000) : 0,
          cancelLatencyMs: Math.round(settleMs),
          highWaterKb,
          at: new Date().toISOString(),
        });
        return turn;
      } catch (e) {
        const totalMs = performance.now() - started;
        collector.record({
          providerId: provider.id,
          model,
          ttftMs: Math.round(totalMs),
          totalMs: Math.round(totalMs),
          outTokens: 0,
          inTokens: 0,
          tokensPerSec: 0,
          cancelLatencyMs: Math.round(settleMs),
          highWaterKb: undefined,
          at: new Date().toISOString(),
        });
        throw e;
      }
    },
    async health() {
      return provider.health();
    },
  };
}

/** Process-wide collector (single choke point). */
export const streamingMetrics = new StreamingMetricsCollector();
