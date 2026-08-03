/**
 * XR Observability — telemetry configuration (Phase 8 · T2).
 *
 * Constitution Article XXI (non-negotiable):
 *   · Telemetry is OPT-IN. `enabled` defaults to false; when disabled the
 *     runtime performs ZERO telemetry network calls (proven by
 *     test/observability/privacy.test.ts).
 *   · Structural-by-default: durations, model/provider/tool names, token
 *     counts, placements, SLOs. Prompt/tool CONTENT requires an explicit,
 *     per-flag opt-in (content.prompt / content.toolArgs).
 *   · Local-first: the default OTLP endpoint is the local viewer
 *     (http://127.0.0.1:4318 — the standalone Aspire Dashboard). No
 *     mandatory cloud, no cloud default.
 *
 * Resolution order (later wins): built-in defaults → config file
 * (`telemetry:` section) → environment variables (XR_TELEMETRY_*).
 */

export interface TelemetryConfig {
  /** Master switch. DEFAULT FALSE — opt-in only. */
  enabled: boolean;
  /** OTLP/HTTP base URL (no trailing slash). Default: the local viewer. */
  endpoint: string;
  /** OTLP service name (resource attribute service.name). */
  serviceName: string;
  /** Root sampling ratio 0..1 (children inherit the decision). */
  sampleRatio: number;
  /** Explicit per-flag content opt-ins. BOTH default to false. */
  content: {
    /** Capture prompt text on gen_ai spans (redactor still applies). */
    prompt: boolean;
    /** Capture tool argument shapes (names only, never values, unless prompt also allows). */
    toolArgs: boolean;
  };
  /** Also push metrics/logs over OTLP (traces are the primary signal). */
  exportMetrics: boolean;
  exportLogs: boolean;
  /** Batching: flush interval and max batch size (bounded overhead). */
  batchIntervalMs: number;
  batchMax: number;
  /** Local recent-spans ring buffer size (powers the local traces view). */
  ringBufferSize: number;
  /** Cardinality budgets: metric name → max distinct values per label. */
  cardinality: Record<string, number>;
}

export const DEFAULT_CARDINALITY_BUDGETS: Record<string, number> = {
  xr_http_requests_total: 80, // route ids are a closed set
  xr_http_request_duration_ms: 80,
  gen_ai_client_operation_duration: 40, // provider × model pairs in use
  xr_llm_tokens_total: 40,
  xr_routing_decisions_total: 40,
  xr_isolation_placements_total: 24, // tier × backend × outcome — closed enums
  xr_capability_executions_total: 200, // tool names are namespaced and bounded
  default: 64,
};

export function defaultTelemetryConfig(): TelemetryConfig {
  return {
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
    cardinality: { ...DEFAULT_CARDINALITY_BUDGETS },
  };
}

function bool(v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(s)) return true;
  if (["0", "false", "off", "no"].includes(s)) return false;
  return undefined;
}

/** Shape accepted in the config file under `telemetry:` (all optional). */
export interface TelemetryFileConfig {
  enabled?: boolean;
  endpoint?: string;
  serviceName?: string;
  sampleRatio?: number;
  content?: { prompt?: boolean; toolArgs?: boolean };
  exportMetrics?: boolean;
  exportLogs?: boolean;
  batchIntervalMs?: number;
  batchMax?: number;
  ringBufferSize?: number;
  cardinality?: Record<string, number>;
}

export function resolveTelemetryConfig(
  file?: TelemetryFileConfig,
  env: NodeJS.ProcessEnv = process.env,
): TelemetryConfig {
  const cfg = defaultTelemetryConfig();

  if (file) {
    if (file.enabled !== undefined) cfg.enabled = file.enabled;
    if (typeof file.endpoint === "string" && file.endpoint.trim()) cfg.endpoint = file.endpoint.replace(/\/+$/, "");
    if (typeof file.serviceName === "string" && file.serviceName.trim()) cfg.serviceName = file.serviceName.trim();
    if (typeof file.sampleRatio === "number" && file.sampleRatio >= 0 && file.sampleRatio <= 1) cfg.sampleRatio = file.sampleRatio;
    if (file.content) {
      cfg.content.prompt = file.content.prompt === true;
      cfg.content.toolArgs = file.content.toolArgs === true;
    }
    if (file.exportMetrics !== undefined) cfg.exportMetrics = file.exportMetrics === true;
    if (file.exportLogs !== undefined) cfg.exportLogs = file.exportLogs === true;
    if (typeof file.batchIntervalMs === "number" && file.batchIntervalMs >= 500) cfg.batchIntervalMs = file.batchIntervalMs;
    if (typeof file.batchMax === "number" && file.batchMax >= 1) cfg.batchMax = file.batchMax;
    if (typeof file.ringBufferSize === "number" && file.ringBufferSize >= 16) cfg.ringBufferSize = Math.min(file.ringBufferSize, 16_384);
    if (file.cardinality && typeof file.cardinality === "object") {
      cfg.cardinality = { ...cfg.cardinality, ...file.cardinality };
    }
  }

  const envEnabled = bool(env.XR_TELEMETRY_ENABLED ?? env.XR_TELEMETRY);
  if (envEnabled !== undefined) cfg.enabled = envEnabled;
  if (env.XR_TELEMETRY_ENDPOINT?.trim()) cfg.endpoint = env.XR_TELEMETRY_ENDPOINT.trim().replace(/\/+$/, "");
  if (env.XR_TELEMETRY_SERVICE_NAME?.trim()) cfg.serviceName = env.XR_TELEMETRY_SERVICE_NAME.trim();
  const sample = Number(env.XR_TELEMETRY_SAMPLE);
  if (Number.isFinite(sample) && sample >= 0 && sample <= 1 && env.XR_TELEMETRY_SAMPLE !== undefined) cfg.sampleRatio = sample;
  const prompt = bool(env.XR_TELEMETRY_CONTENT_PROMPT);
  if (prompt !== undefined) cfg.content.prompt = prompt;
  const toolArgs = bool(env.XR_TELEMETRY_CONTENT_TOOL_ARGS);
  if (toolArgs !== undefined) cfg.content.toolArgs = toolArgs;

  return cfg;
}

/** Process-wide active config (set by initObservability; tests may reset). */
let active: TelemetryConfig = defaultTelemetryConfig();

export function setTelemetryConfig(cfg: TelemetryConfig): void {
  active = cfg;
}

export function telemetry(): TelemetryConfig {
  return active;
}
