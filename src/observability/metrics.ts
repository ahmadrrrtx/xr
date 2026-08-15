/**
 * XR Observability — metrics registry + Prometheus exposition (Phase 8 · T2).
 *
 * Cardinality is BUDGETED (Art. XXI.3): every series label value passes the
 * per-metric budget; overflow folds into the sentinel label value
 * "xr_other" and increments `xr_cardinality_overflow_total`. User input is
 * never a label value (labels come from closed enumerations or bounded,
 * namespaced identifiers only).
 *
 * The `/metrics` endpoint renders `renderPrometheus()` — the same registry
 * feeds the OTLP exporter when telemetry is enabled.
 */

import { redactString, truncateValue } from "./redaction.ts";
import { telemetry } from "./config.ts";

export type LabelSet = Record<string, string>;

function labelKey(labels: LabelSet): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join(",");
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n");
}

export function renderLabels(labels: LabelSet): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return `{${keys.map((k) => `${k}="${escapeLabelValue(labels[k])}"`).join(",")}}`;
}

const OVERFLOW_SENTINEL = "xr_other";

/** Per-metric label cardinality guard. */
class CardinalityGuard {
  private seen = new Map<string, Map<string, Set<string>>>(); // metric → label → values
  private overflow = new Map<string, number>(); // `${metric}|${label}` → count

  check(metric: string, labels: LabelSet): LabelSet {
    const out: LabelSet = {};
    const budget = telemetry().cardinality[metric] ?? telemetry().cardinality["default"] ?? 64;
    for (const [k, v] of Object.entries(labels)) {
      const safe = truncateValue(redactString(String(v)), 64);
      let byLabel = this.seen.get(metric);
      if (!byLabel) {
        byLabel = new Map();
        this.seen.set(metric, byLabel);
      }
      let values = byLabel.get(k);
      if (!values) {
        values = new Set();
        byLabel.set(k, values);
      }
      if (values.has(safe) || values.size < budget) {
        values.add(safe);
        out[k] = safe;
      } else {
        out[k] = OVERFLOW_SENTINEL;
        const key = `${metric}|${k}`;
        this.overflow.set(key, (this.overflow.get(key) ?? 0) + 1);
      }
    }
    return out;
  }

  /** Drain accumulated overflow events (each event rendered exactly once). */
  drainOverflow(): Array<{ metric: string; label: string; count: number }> {
    const out = [...this.overflow.entries()].map(([k, count]) => {
      const [metric, label] = k.split("|");
      return { metric, label, count };
    });
    this.overflow.clear();
    return out;
  }

  reset(): void {
    this.seen.clear();
    this.overflow.clear();
  }
}

abstract class Metric {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: "counter" | "gauge" | "histogram",
  ) {}
  abstract render(guard: CardinalityGuard): string;
}

export class Counter extends Metric {
  private values = new Map<string, { labels: LabelSet; value: number }>();

  constructor(name: string, help: string) {
    super(name, help, "counter");
  }

  inc(labels: LabelSet = {}, by = 1): void {
    const key = labelKey(labels);
    const existing = this.values.get(key);
    if (existing) existing.value += by;
    else this.values.set(key, { labels: { ...labels }, value: by });
  }

  snapshot(): Array<{ labels: LabelSet; value: number }> {
    return [...this.values.values()].map((v) => ({ labels: { ...v.labels }, value: v.value }));
  }

  render(guard: CardinalityGuard): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(guard.check(this.name, labels))} ${value}`);
    }
    return lines.join("\n");
  }
}

export class Gauge extends Metric {
  private values = new Map<string, { labels: LabelSet; value: number }>();

  constructor(name: string, help: string) {
    super(name, help, "gauge");
  }

  set(labels: LabelSet = {}, value: number): void {
    this.values.set(labelKey(labels), { labels: { ...labels }, value });
  }

  snapshot(): Array<{ labels: LabelSet; value: number }> {
    return [...this.values.values()].map((v) => ({ labels: { ...v.labels }, value: v.value }));
  }

  render(guard: CardinalityGuard): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(guard.check(this.name, labels))} ${value}`);
    }
    return lines.join("\n");
  }
}

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export class Histogram extends Metric {
  private values = new Map<string, { labels: LabelSet; buckets: number[]; sum: number; count: number }>();

  constructor(
    name: string,
    help: string,
    private readonly bucketEdges: number[] = DEFAULT_BUCKETS,
  ) {
    super(name, help, "histogram");
  }

  observe(labels: LabelSet = {}, value: number): void {
    const key = labelKey(labels);
    let entry = this.values.get(key);
    if (!entry) {
      entry = { labels: { ...labels }, buckets: new Array(this.bucketEdges.length + 1).fill(0), sum: 0, count: 0 };
      this.values.set(key, entry);
    }
    entry.sum += value;
    entry.count += 1;
    for (let i = 0; i <= this.bucketEdges.length; i++) {
      if (i === this.bucketEdges.length || value <= this.bucketEdges[i]) {
        entry.buckets[i] += 1; // _count of observations ≤ edge (cumulative below)
        break;
      }
    }
  }

  snapshot(): Array<{ labels: LabelSet; buckets: number[]; edges: number[]; sum: number; count: number }> {
    return [...this.values.values()].map((v) => ({
      labels: { ...v.labels },
      buckets: [...v.buckets],
      edges: [...this.bucketEdges],
      sum: v.sum,
      count: v.count,
    }));
  }

  render(guard: CardinalityGuard): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, buckets, sum, count } of this.values.values()) {
      const safeLabels = guard.check(this.name, labels);
      let cumulative = 0;
      for (let i = 0; i < this.bucketEdges.length; i++) {
        cumulative += buckets[i];
        lines.push(`${this.name}_bucket${renderLabels({ ...safeLabels, le: String(this.bucketEdges[i]) })} ${cumulative}`);
      }
      lines.push(`${this.name}_bucket${renderLabels({ ...safeLabels, le: "+Inf" })} ${count}`);
      lines.push(`${this.name}_sum${renderLabels(safeLabels)} ${Math.round(sum * 1000) / 1000}`);
      lines.push(`${this.name}_count${renderLabels(safeLabels)} ${count}`);
    }
    return lines.join("\n");
  }
}

// ── Registry ────────────────────────────────────────────────────────────────

const guard = new CardinalityGuard();
const metrics = new Map<string, Metric>();

function register<M extends Metric>(m: M): M {
  metrics.set(m.name, m);
  return m;
}

/** Register a custom metric (plugins/subsystems). Budgeted like all others. */
export function registerMetric<M extends Metric>(m: M): M {
  if (metrics.has(m.name)) throw new Error(`metric "${m.name}" already registered`);
  return register(m);
}

export const xrMetrics = {
  httpRequests: register(new Counter("xr_http_requests_total", "Daemon API requests by route, method, and status.")),
  httpDuration: register(new Histogram("xr_http_request_duration_ms", "Daemon API request duration (ms).")),
  llmDuration: register(new Histogram("gen_ai_client_operation_duration", "GenAI client operation duration (ms).")),
  llmTokens: register(new Counter("xr_llm_tokens_total", "LLM token usage by provider/model and direction (counts, never content).")),
  routingDecisions: register(new Counter("xr_routing_decisions_total", "Routing decisions by target provider and reason.")),
  routingLatency: register(new Histogram("xr_routing_selection_ms", "Routing selection latency (ms).", [1, 2, 5, 10, 20, 50, 100])),
  placements: register(new Counter("xr_isolation_placements_total", "Isolation placements by tier/backend/outcome.")),
  capabilityExec: register(new Counter("xr_capability_executions_total", "Canonical-envelope executions by capability kind and outcome.")),
  cardinalityOverflow: register(new Counter("xr_cardinality_overflow_total", "Label-values folded into xr_other by cardinality budgets.")),
  // ── Phase 01 · runtime performance observability ──────────────────────────
  runtimeDetectionDuration: register(new Histogram("xr_runtime_detection_duration_ms", "Per-runtime detection duration (ms) by runtime id.")),
  providerHealthDuration: register(new Histogram("xr_provider_health_duration_ms", "Bounded provider health-probe duration (ms) by provider.")),
  hardwareDetectionDuration: register(new Histogram("xr_hardware_detection_duration_ms", "Hardware detection duration (ms).")),
  runtimeCacheHits: register(new Counter("xr_runtime_cache_hits_total", "Runtime detection cache hits.")),
  runtimeCacheMisses: register(new Counter("xr_runtime_cache_misses_total", "Runtime detection cache misses (full detections started).")),
  runtimeCacheRefreshes: register(new Counter("xr_runtime_cache_refreshes_total", "Background (stale-while-revalidate) runtime detections.")),
  providerHealthCacheHits: register(new Counter("xr_provider_health_cache_hits_total", "Provider health cache hits.")),
  providerHealthCacheMisses: register(new Counter("xr_provider_health_cache_misses_total", "Provider health cache misses (probes started).")),
  providerHealthCacheRefreshes: register(new Counter("xr_provider_health_cache_refreshes_total", "Background provider health refreshes.")),
  catalogCacheHits: register(new Counter("xr_catalog_cache_hits_total", "Intelligence catalog cache hits.")),
  catalogCacheMisses: register(new Counter("xr_catalog_cache_misses_total", "Intelligence catalog cache misses (rebuilds started).")),
  catalogCacheRefreshes: register(new Counter("xr_catalog_cache_refreshes_total", "Background catalog rebuilds.")),
  hardwareCacheHits: register(new Counter("xr_hardware_cache_hits_total", "Hardware specs cache hits.")),
  hardwareCacheMisses: register(new Counter("xr_hardware_cache_misses_total", "Hardware specs cache misses (detections started).")),
  hardwareCacheRefreshes: register(new Counter("xr_hardware_cache_refreshes_total", "Background hardware detections.")),
  deduplicatedRequests: register(new Counter("xr_deduplicated_requests_total", "Requests folded onto an in-flight operation by resource.")),
};

export function metric(name: string): Metric | undefined {
  return metrics.get(name);
}

export interface MetricSnapshot {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
  series: unknown;
}

/** Structured snapshot of every series (feeds the OTLP exporter). */
export function snapshotMetrics(): MetricSnapshot[] {
  const out: MetricSnapshot[] = [];
  for (const m of metrics.values()) {
    if (m instanceof Counter) out.push({ name: m.name, help: m.help, type: "counter", series: m.snapshot() });
    else if (m instanceof Gauge) out.push({ name: m.name, help: m.help, type: "gauge", series: m.snapshot() });
    else if (m instanceof Histogram) out.push({ name: m.name, help: m.help, type: "histogram", series: m.snapshot() });
  }
  return out;
}

/** Prometheus text exposition format (v0.0.4). */
export function renderPrometheus(): string {
  const out: string[] = [];
  for (const m of metrics.values()) out.push(m.render(guard));
  for (const { metric: name, label, count } of guard.drainOverflow()) {
    (xrMetrics.cardinalityOverflow as Counter).inc({ metric: name, label }, count);
  }
  out.push("# EOF");
  return out.join("\n") + "\n";
}

/** Test hook: clear all series + cardinality state. */
export function resetMetrics(): void {
  metrics.clear();
  guard.reset();
  // Re-register so xrMetrics references stay valid for later writes.
  for (const [k, m] of Object.entries(xrMetrics)) {
    void k;
    metrics.set(m.name, m);
    if (m instanceof Counter) (m as unknown as { values: Map<string, unknown> }).values.clear();
    if (m instanceof Gauge) (m as unknown as { values: Map<string, unknown> }).values.clear();
    if (m instanceof Histogram) (m as unknown as { values: Map<string, unknown> }).values.clear();
  }
}
