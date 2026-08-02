/**
 * XR Observability — OTLP/HTTP+JSON exporter (Phase 8 · T2).
 *
 * Speaks standard OTLP over HTTP to any local (or explicitly chosen)
 * endpoint — the default is the standalone Aspire Dashboard viewer at
 * http://127.0.0.1:4318. Batched (time/size), fail-quiet with exponential
 * backoff, and INERT unless telemetry is enabled: when disabled the
 * exporter performs ZERO network operations (Privacy-gate tested with an
 * instrumented fetch).
 */

import type { SpanData } from "./tracer.ts";
import { onSpanRecorded } from "./tracer.ts";
import type { LogRecord } from "./logs.ts";
import { onLogRecord } from "./logs.ts";
import { snapshotMetrics, type LabelSet } from "./metrics.ts";
import { telemetry, type TelemetryConfig } from "./config.ts";
import { GENAI, SERVICE_ATTRS } from "./semconv.ts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type AttrValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };

function attrValue(v: unknown): AttrValue {
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: String(v) };
}

function attrs(map: Record<string, unknown>): Array<{ key: string; value: AttrValue }> {
  return Object.entries(map).map(([key, value]) => ({ key, value: attrValue(value) }));
}

const SPAN_KIND: Record<string, number> = { internal: 1, server: 2, client: 3, producer: 4, consumer: 5 };

function ns(ms: number): string {
  return String(Math.round(ms * 1_000_000));
}

function spanToOtlp(span: SpanData): Record<string, unknown> {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    name: span.name,
    kind: SPAN_KIND[span.kind] ?? 1,
    startTimeUnixNano: ns(span.startMs),
    endTimeUnixNano: ns(span.endMs ?? span.startMs),
    attributes: attrs(span.attributes),
    ...(span.events.length > 0
      ? {
          events: span.events.map((e) => ({
            timeUnixNano: ns(e.at),
            name: e.name,
            ...(e.attributes ? { attributes: attrs(e.attributes) } : {}),
          })),
        }
      : {}),
    status: {
      code: span.status === "error" ? 2 : 1,
      ...(span.errorType ? { message: span.errorType } : {}),
    },
  };
}

function resourceAttributes(cfg: TelemetryConfig, version: string): Array<{ key: string; value: AttrValue }> {
  return attrs({
    [SERVICE_ATTRS.SERVICE_NAME]: cfg.serviceName,
    [SERVICE_ATTRS.SERVICE_VERSION]: version,
    [SERVICE_ATTRS.TELEMETRY_SDK]: "xr-observability",
  });
}

export interface OtlpExporterOptions {
  fetchImpl?: FetchLike;
  version?: string;
  /** Flush immediately when the queue reaches this size. */
  batchMax?: number;
  /** Override backoff base for tests (ms). */
  backoffBaseMs?: number;
}

/**
 * Batched exporter. `start()` subscribes to spans (+logs when enabled) and
 * arms the flush timer; `stop()` unsubscribes and flushes. When telemetry
 * is disabled `start()` is never called by the lifecycle — and even if it
 * were, `flush()` short-circuits before any network activity.
 */
export class OtlpExporter {
  private spans: SpanData[] = [];
  private logs: LogRecord[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeSpan: (() => void) | null = null;
  private unsubscribeLog: (() => void) | null = null;
  private consecutiveFailures = 0;
  private nextRetryAt = 0;
  private flushing = false;
  private readonly fetchImpl: FetchLike;
  private readonly version: string;
  private readonly batchMax: number;
  private readonly backoffBase: number;
  /** Observability of the exporter itself (bounded counters). */
  readonly stats = { sentSpans: 0, sentMetrics: 0, sentLogs: 0, failedFlushes: 0, droppedBatches: 0 };

  constructor(opts: OtlpExporterOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((globalThis as { fetch: FetchLike }).fetch);
    this.version = opts.version ?? "dev";
    this.batchMax = opts.batchMax ?? 100;
    this.backoffBase = opts.backoffBaseMs ?? 1000;
  }

  start(): void {
    const cfg = telemetry();
    if (!cfg.enabled) return; // inert when opt-out (default)
    this.unsubscribeSpan = onSpanRecorded((span) => {
      this.spans.push(span);
      if (this.spans.length >= this.batchMax) void this.flush();
    });
    if (cfg.exportLogs) {
      this.unsubscribeLog = onLogRecord((record) => {
        this.logs.push(record);
      });
    }
    this.timer = setInterval(() => void this.flush(), cfg.batchIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.unsubscribeSpan?.();
    this.unsubscribeLog?.();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  queueSize(): number {
    return this.spans.length + this.logs.length;
  }

  /** Flush pending batches. Never throws. */
  async flush(): Promise<void> {
    const cfg = telemetry();
    if (!cfg.enabled || this.flushing) return;
    if (Date.now() < this.nextRetryAt) return;
    this.flushing = true;
    try {
      const spans = this.spans.splice(0, this.spans.length);
      const logs = this.logs.splice(0, this.logs.length);
      let ok = true;
      if (spans.length > 0) {
        ok = (await this.post(`${cfg.endpoint}/v1/traces`, this.tracesPayload(cfg, spans))) && ok;
        if (ok) this.stats.sentSpans += spans.length;
      }
      if (ok && cfg.exportMetrics) {
        const payload = this.metricsPayload(cfg);
        if (payload) {
          ok = await this.post(`${cfg.endpoint}/v1/metrics`, payload);
          if (ok) this.stats.sentMetrics++;
        }
      }
      if (ok && cfg.exportLogs && logs.length > 0) {
        ok = (await this.post(`${cfg.endpoint}/v1/logs`, this.logsPayload(cfg, logs))) && ok;
        if (ok) this.stats.sentLogs += logs.length;
      }
      if (!ok) {
        this.stats.failedFlushes++;
        this.consecutiveFailures++;
        this.nextRetryAt = Date.now() + Math.min(60_000, this.backoffBase * 2 ** Math.min(this.consecutiveFailures, 6));
        // Failed batches are dropped (bounded memory), never retried into an unbounded queue.
        this.stats.droppedBatches++;
      } else {
        this.consecutiveFailures = 0;
      }
    } finally {
      this.flushing = false;
    }
  }

  private async post(url: string, body: unknown): Promise<boolean> {
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  private tracesPayload(cfg: TelemetryConfig, spans: SpanData[]): Record<string, unknown> {
    return {
      resourceSpans: [
        {
          resource: { attributes: resourceAttributes(cfg, this.version) },
          scopeSpans: [
            {
              scope: { name: "xr.observability", version: this.version },
              spans: spans.map(spanToOtlp),
            },
          ],
        },
      ],
    };
  }

  private metricsPayload(cfg: TelemetryConfig): Record<string, unknown> | null {
    const resources = resourceAttributes(cfg, this.version);
    const out: Array<Record<string, unknown>> = [];
    for (const m of snapshotMetrics()) {
      const now = ns(Date.now());
      if (m.type === "counter") {
        const points = (m.series as Array<{ labels: LabelSet; value: number }>).map((s) => ({
          attributes: attrs(s.labels),
          startTimeUnixNano: now,
          timeUnixNano: now,
          asInt: String(s.value),
        }));
        if (points.length === 0) continue;
        out.push({
          name: m.name,
          description: m.help,
          sum: { dataPoints: points, aggregationTemporality: 2, isMonotonic: true },
        });
      } else if (m.type === "gauge") {
        const points = (m.series as Array<{ labels: LabelSet; value: number }>).map((s) => ({
          attributes: attrs(s.labels),
          timeUnixNano: now,
          asDouble: s.value,
        }));
        if (points.length === 0) continue;
        out.push({ name: m.name, description: m.help, gauge: { dataPoints: points } });
      } else {
        const points = (m.series as Array<{ labels: LabelSet; buckets: number[]; edges: number[]; sum: number; count: number }>).map((s) => ({
          attributes: attrs(s.labels),
          startTimeUnixNano: now,
          timeUnixNano: now,
          count: String(s.count),
          sum: Math.round(s.sum * 1000) / 1000,
          bucketCounts: (() => {
            const counts: string[] = [];
            let prev = 0;
            for (const c of s.buckets) {
              counts.push(String(c - prev));
              prev = c;
            }
            return counts;
          })(),
          explicitBounds: s.edges,
        }));
        if (points.length === 0) continue;
        out.push({
          name: m.name,
          description: m.help,
          histogram: { dataPoints: points, aggregationTemporality: 2 },
        });
      }
    }
    if (out.length === 0) return null;
    return {
      resourceMetrics: [
        {
          resource: { attributes: resources },
          scopeMetrics: [{ scope: { name: "xr.observability", version: this.version }, metrics: out }],
        },
      ],
    };
  }

  private logsPayload(cfg: TelemetryConfig, records: LogRecord[]): Record<string, unknown> {
    const severity: Record<string, number> = { debug: 5, info: 9, warn: 13, error: 17 };
    return {
      resourceLogs: [
        {
          resource: { attributes: resourceAttributes(cfg, this.version) },
          scopeLogs: [
            {
              scope: { name: "xr.observability", version: this.version },
              logRecords: records.map((r) => {
                const { ts, level, event, trace_id, span_id, ...rest } = r;
                return {
                  timeUnixNano: String(new Date(ts).getTime() * 1_000_000),
                  severityNumber: severity[level] ?? 9,
                  severityText: level.toUpperCase(),
                  body: { stringValue: event },
                  attributes: attrs(rest),
                  ...(trace_id ? { traceId: trace_id } : {}),
                  ...(span_id ? { spanId: span_id } : {}),
                };
              }),
            },
          ],
        },
      ],
    };
  }

  /** Test hook: OTLP serialization of a single span (no batching involved). */
  spanPayloadForTest(span: SpanData): Record<string, unknown> {
    return this.tracesPayload(telemetry(), [span]);
  }
}

/** The GenAI semantic-convention attribute keys this exporter may carry. */
export const EXPORTED_GENAI_ATTRIBUTES = Object.freeze(Object.values(GENAI));
