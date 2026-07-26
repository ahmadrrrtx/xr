/**
 * XR 4.4 — Bounded historical outcome metrics for routing.
 *
 * Not an ML system. Stores compact per-(provider, model, class) stats with
 * confidence/coverage gates. No prompts, no secrets, no raw workspace content.
 */

import type { ModelClass, ModelOutcomeStats, OutcomeSample } from "./types.ts";

const DEFAULT_MAX_SAMPLES = 200;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30d

export interface MetricsStoreOptions {
  maxSamples?: number;
  retentionMs?: number;
}

export class IntelligenceMetrics {
  private samples: OutcomeSample[] = [];
  private readonly maxSamples: number;
  private readonly retentionMs: number;

  constructor(opts: MetricsStoreOptions = {}) {
    this.maxSamples = opts.maxSamples ?? DEFAULT_MAX_SAMPLES;
    this.retentionMs = opts.retentionMs ?? DEFAULT_RETENTION_MS;
  }

  /** Record a single outcome. Drops oldest when over capacity. */
  record(sample: OutcomeSample): void {
    this.samples.push({
      ...sample,
      at: sample.at || Date.now(),
    });
    this.prune();
  }

  /** Bulk import (e.g. from durable store). Validates shape lightly. */
  importSamples(samples: OutcomeSample[]): void {
    for (const s of samples) {
      if (!s.providerId || !s.modelId) continue;
      this.samples.push({ ...s, at: s.at || Date.now() });
    }
    this.prune();
  }

  clear(): void {
    this.samples = [];
  }

  size(): number {
    return this.samples.length;
  }

  snapshot(): OutcomeSample[] {
    return this.samples.slice();
  }

  statsFor(
    providerId: string,
    modelId: string,
    modelClass?: ModelClass,
  ): ModelOutcomeStats | null {
    const now = Date.now();
    let rows = this.samples.filter(
      (s) =>
        s.providerId === providerId &&
        s.modelId === modelId &&
        now - s.at <= this.retentionMs,
    );
    if (modelClass) {
      const classRows = rows.filter((s) => s.modelClass === modelClass);
      // Prefer class-specific when enough samples; else fall back to all
      if (classRows.length >= 3) rows = classRows;
    }
    if (!rows.length) return null;

    const samples = rows.length;
    const successes = rows.filter((s) => s.success).length;
    const successRate = successes / samples;
    const lat = rows.map((s) => s.latencyMs).filter((n): n is number => typeof n === "number");
    const costs = rows.map((s) => s.costUsd).filter((n): n is number => typeof n === "number");
    const structured = rows
      .map((s) => s.structuredOk)
      .filter((n): n is boolean => typeof n === "boolean");

    // Confidence: grows with samples, caps at 1. Sparse <3 → low.
    const confidence = confidenceFromSamples(samples);

    return {
      providerId,
      modelId,
      modelClass: modelClass ?? rows[0]!.modelClass,
      samples,
      successRate,
      avgLatencyMs: lat.length ? avg(lat) : undefined,
      avgCostUsd: costs.length ? avg(costs) : undefined,
      structuredOkRate: structured.length
        ? structured.filter(Boolean).length / structured.length
        : undefined,
      confidence,
      lastAt: Math.max(...rows.map((r) => r.at)),
    };
  }

  private prune(): void {
    const cutoff = Date.now() - this.retentionMs;
    this.samples = this.samples.filter((s) => s.at >= cutoff);
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples
        .sort((a, b) => b.at - a.at)
        .slice(0, this.maxSamples);
    }
  }
}

export function confidenceFromSamples(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 0.15;
  if (n === 2) return 0.25;
  if (n < 5) return 0.4;
  if (n < 10) return 0.6;
  if (n < 25) return 0.8;
  return 1;
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Process-wide default metrics sink (tests may replace). */
let defaultMetrics: IntelligenceMetrics | null = null;

export function getDefaultMetrics(): IntelligenceMetrics {
  if (!defaultMetrics) defaultMetrics = new IntelligenceMetrics();
  return defaultMetrics;
}

export function setDefaultMetrics(m: IntelligenceMetrics | null): void {
  defaultMetrics = m;
}

export function resetDefaultMetrics(): void {
  defaultMetrics = new IntelligenceMetrics();
}
