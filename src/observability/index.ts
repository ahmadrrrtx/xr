/**
 * XR Observability — public facade (Phase 8 · T2).
 *
 * One import surface for the observability plane. Lifecycle:
 *
 *   initObservability({ version })   — resolve config (file+env), start the
 *                                      OTLP exporter ONLY when enabled.
 *   shutdownObservability()          — stop exporter (final flush), clean.
 *
 * The daemon and CLI boot paths call init; test setups call reset*.
 * Default state (no init): telemetry disabled, zero network activity.
 */

import { resolveTelemetryConfig, setTelemetryConfig, telemetry, type TelemetryFileConfig, type TelemetryConfig } from "./config.ts";
import { OtlpExporter } from "./otlp.ts";
import { resetMetrics } from "./metrics.ts";
import { resetTracerState } from "./tracer.ts";

export interface ObservabilityHandle {
  config: TelemetryConfig;
  exporter: OtlpExporter | null;
}

let active: ObservabilityHandle | null = null;

export function initObservability(opts: {
  fileConfig?: TelemetryFileConfig;
  env?: NodeJS.ProcessEnv;
  version?: string;
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
} = {}): ObservabilityHandle {
  if (active) return active;
  const cfg = resolveTelemetryConfig(opts.fileConfig, opts.env);
  setTelemetryConfig(cfg);
  let exporter: OtlpExporter | null = null;
  if (cfg.enabled) {
    exporter = new OtlpExporter({ fetchImpl: opts.fetchImpl, version: opts.version });
    exporter.start();
  }
  active = { config: cfg, exporter };
  return active;
}

export async function shutdownObservability(): Promise<void> {
  if (!active) return;
  await active.exporter?.stop();
  active = null;
}

/** Test hook: full reset (config defaults, buffers empty, no exporter). */
export async function resetObservability(): Promise<void> {
  await shutdownObservability();
  setTelemetryConfig({
    enabled: false,
    endpoint: "http://127.0.0.1:4318",
    serviceName: "xr",
    sampleRatio: 1,
    content: { prompt: false, toolArgs: false },
    exportMetrics: true,
    exportLogs: true,
    batchIntervalMs: 5000,
    batchMax: 100,
    ringBufferSize: 512,
    cardinality: {
      xr_http_requests_total: 80,
      xr_http_request_duration_ms: 80,
      gen_ai_client_operation_duration: 40,
      xr_llm_tokens_total: 40,
      xr_routing_decisions_total: 40,
      xr_isolation_placements_total: 24,
      xr_capability_executions_total: 200,
      default: 64,
    },
  });
  resetTracerState();
  resetMetrics();
}

export {
  telemetry,
  resolveTelemetryConfig,
  setTelemetryConfig,
  defaultTelemetryConfig,
  type TelemetryConfig,
  type TelemetryFileConfig,
} from "./config.ts";
export { Span, startSpan, withSpan, currentSpan, traceAsync, recentSpans, resetTracerState, onSpanRecorded, type SpanData } from "./tracer.ts";
export { newTraceId, newSpanId, traceparent, parseTraceparent, TRACE_ID_RE, SPAN_ID_RE } from "./ids.ts";
export { redactString, redactAttributes, redactValue, truncateValue } from "./redaction.ts";
export { xrMetrics, renderPrometheus, snapshotMetrics, resetMetrics, registerMetric, Counter, Gauge, Histogram } from "./metrics.ts";
export { structuredLog, log, setLogWriter, onLogRecord, type LogRecord } from "./logs.ts";
export { OtlpExporter } from "./otlp.ts";
export {
  httpServerSpan,
  endHttpServerSpan,
  chatSpan,
  endChatSpan,
  toolSpan,
  agentSpan,
  envelopeSpan,
  routingSpan,
  endRoutingSpan,
  placementSpan,
  endPlacementSpan,
} from "./instrument.ts";
export { GENAI, HTTP, XR_ATTR } from "./semconv.ts";
