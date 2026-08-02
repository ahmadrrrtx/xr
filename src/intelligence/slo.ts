/**
 * XR Phase 5 · T6 — Routing SLO collector.
 *
 * Principle adopted (docs/phase5-routing/03-RESEARCH-NOTES.md · R5): routing
 * visibility is a first-class SLO domain — which target, why, whether
 * fallback/degradation occurred, at what cost-per-quality — measured, never
 * asserted. Routing-scoped only; the full observability platform is Phase 8.
 *
 * SLOs:
 *   · selection latency       p95 < 20ms (Phase-3 budget, preserved)
 *   · fallback rate           fallbacks / selections (windowed)
 *   · degradation rate        degradation transitions / selections
 *   · cost-per-quality        avg USD vs avg measured fidelity of selections
 *   · CPR                     continuity preservation rate mean vs 0.95 target
 *
 * Storage: append-bounded JSONL ($XR_HOME/cache/intelligence/routing-slo.jsonl,
 * 500 lines — same discipline as Phase 3 stream-metrics). Secret-free:
 * ids, classes, durations, rates only.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CPR_TARGET } from "./failover.ts";
import type { ErrorClass, DegradationLevel } from "./degradation.ts";

const XR_HOME_DIR = () => process.env.XR_HOME ?? join(homedir(), ".xr");
const STORE_DIR = () => join(XR_HOME_DIR(), "cache", "intelligence");
const LOG_FILE = () => join(STORE_DIR(), "routing-slo.jsonl");
const MAX_LINES = 500;

export const SELECTION_BUDGET_MS = 20;

export type SloEvent =
  | { kind: "selection"; at: number; ms: number; mode: string; manual: boolean; unavailable: boolean }
  | { kind: "fallback"; at: number; from: string; to: string; trigger: ErrorClass; level: DegradationLevel; cpr?: number }
  | { kind: "degradation"; at: number; level: DegradationLevel; reason: string }
  | { kind: "cpq"; at: number; target: string; costUsd: number; fidelity: number }
  | { kind: "cpr"; at: number; cpr: number; source: string }
  | { kind: "breaker"; at: number; target: string; state: "open" | "closed"; reason?: string };

export interface RoutingSloReport {
  schemaVersion: 1;
  generatedAt: number;
  windowMs: number;
  selection: {
    count: number;
    p50Ms: number;
    p95Ms: number;
    budgetMs: number;
    withinBudget: boolean;
    unavailableRate: number;
    manualRate: number;
  };
  fallback: {
    total: number;
    ratePerSelection: number;
    byTrigger: Record<string, number>;
    byLevel: Record<string, number>;
  };
  degradation: { total: number; ratePerSelection: number; byLevel: Record<string, number> };
  costPerQuality: {
    samples: number;
    avgCostUsd: number;
    avgFidelity: number;
    /** USD per 0.1 fidelity point (lower is better; 0 when all-free). */
    usdPerFidelityPoint: number;
  };
  cpr: { samples: number; mean: number; target: number; met: boolean };
  breaker: { trips: number; byTarget: Record<string, number> };
}

export class RoutingSlo {
  private events: SloEvent[] = [];
  private readonly file: string | null;
  private dirty = 0;

  constructor(opts: { file?: string | null } = {}) {
    this.file = opts.file === undefined ? LOG_FILE() : opts.file;
  }

  record(event: SloEvent): void {
    let persisted = false;
    if (this.file) {
      try {
        mkdirSync(STORE_DIR(), { recursive: true });
        appendFileSync(this.file, JSON.stringify(event) + "\n");
        persisted = true;
        if (++this.dirty >= 50) {
          this.truncateIfNeeded();
          this.dirty = 0;
        }
      } catch {
        // SLO persistence is best-effort; in-process events remain.
      }
    }
    // Only retained in memory when NOT persisted — report() reads the file,
    // so persisted events must not be counted twice.
    if (!persisted) this.events.push(event);
  }

  private truncateIfNeeded(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean);
      if (lines.length > MAX_LINES) {
        writeFileSync(this.file, lines.slice(-MAX_LINES).join("\n") + "\n");
      }
    } catch {
      /* ignore */
    }
  }

  private load(): SloEvent[] {
    const loaded: SloEvent[] = [];
    if (this.file && existsSync(this.file)) {
      try {
        for (const line of readFileSync(this.file, "utf8").split("\n")) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as SloEvent;
          if (ev && typeof ev === "object" && "kind" in ev) loaded.push(ev);
        }
      } catch {
        /* corrupt lines ignored */
      }
    }
    return loaded.concat(this.events);
  }

  /** SLO report over a trailing window (default 24h). */
  report(windowMs = 24 * 60 * 60 * 1000): RoutingSloReport {
    const cutoff = Date.now() - windowMs;
    const events = this.load().filter((e) => e.at >= cutoff);

    const selections = events.filter((e): e is typeof e & { kind: "selection" } => e.kind === "selection");
    const fallbacks = events.filter((e): e is typeof e & { kind: "fallback" } => e.kind === "fallback");
    const degradations = events.filter((e): e is typeof e & { kind: "degradation" } => e.kind === "degradation");
    const cpqs = events.filter((e): e is typeof e & { kind: "cpq" } => e.kind === "cpq");
    const cprs = events.filter((e): e is typeof e & { kind: "cpr" } => e.kind === "cpr");
    const breakers = events.filter((e): e is typeof e & { kind: "breaker" } => e.kind === "breaker");

    const lat = selections.map((s) => s.ms).sort((a, b) => a - b);
    const p = (q: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]! : 0);
    const p95 = Math.round(p(0.95) * 100) / 100;

    const byTrigger: Record<string, number> = {};
    const byLevelFb: Record<string, number> = {};
    for (const f of fallbacks) {
      byTrigger[f.trigger] = (byTrigger[f.trigger] ?? 0) + 1;
      byLevelFb[f.level] = (byLevelFb[f.level] ?? 0) + 1;
    }
    const byLevelDg: Record<string, number> = {};
    for (const d of degradations) {
      byLevelDg[d.level] = (byLevelDg[d.level] ?? 0) + 1;
    }
    const byTarget: Record<string, number> = {};
    let trips = 0;
    for (const b of breakers) {
      if (b.state === "open") {
        trips++;
        byTarget[b.target] = (byTarget[b.target] ?? 0) + 1;
      }
    }

    const avgCost = cpqs.length ? cpqs.reduce((a, e) => a + e.costUsd, 0) / cpqs.length : 0;
    const avgFid = cpqs.length ? cpqs.reduce((a, e) => a + e.fidelity, 0) / cpqs.length : 0;
    const cprMean = cprs.length ? cprs.reduce((a, e) => a + e.cpr, 0) / cprs.length : 1;

    const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

    return {
      schemaVersion: 1,
      generatedAt: Date.now(),
      windowMs,
      selection: {
        count: selections.length,
        p50Ms: Math.round(p(0.5) * 100) / 100,
        p95Ms: p95,
        budgetMs: SELECTION_BUDGET_MS,
        withinBudget: p95 < SELECTION_BUDGET_MS,
        unavailableRate: selections.length ? round(selections.filter((s) => s.unavailable).length / selections.length) : 0,
        manualRate: selections.length ? round(selections.filter((s) => s.manual).length / selections.length) : 0,
      },
      fallback: {
        total: fallbacks.length,
        ratePerSelection: selections.length ? round(fallbacks.length / selections.length) : 0,
        byTrigger,
        byLevel: byLevelFb,
      },
      degradation: {
        total: degradations.length,
        ratePerSelection: selections.length ? round(degradations.length / selections.length) : 0,
        byLevel: byLevelDg,
      },
      costPerQuality: {
        samples: cpqs.length,
        avgCostUsd: round(avgCost, 6),
        avgFidelity: round(avgFid),
        usdPerFidelityPoint: avgFid > 0 ? round(avgCost / (avgFid * 10), 6) : 0,
      },
      cpr: { samples: cprs.length, mean: round(cprMean), target: CPR_TARGET, met: cprMean >= CPR_TARGET },
      breaker: { trips, byTarget },
    };
  }
}

/** Process-wide default sink (tests replace via constructor file: null). */
let defaultSlo: RoutingSlo | null = null;

export function getDefaultSlo(): RoutingSlo {
  if (!defaultSlo) defaultSlo = new RoutingSlo();
  return defaultSlo;
}

export function setDefaultSlo(slo: RoutingSlo | null): void {
  defaultSlo = slo;
}
