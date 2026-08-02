/**
 * XR Observability — trace-correlated structured logs (Phase 8 · T2).
 *
 * One JSON line per record: `{ts, level, event, trace_id?, span_id?, …}`.
 * When the record is emitted inside an active span, the W3C trace/span ids
 * are attached from context (the OTel trace-correlation model). All values
 * pass the redactor before leaving the process. Logs without an active
 * span simply omit the ids.
 */

import { currentSpan } from "./tracer.ts";
import { redactValue, truncateValue } from "./redaction.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const TRUNC = 512;

export interface LogRecord {
  ts: string;
  level: LogLevel;
  event: string;
  trace_id?: string;
  span_id?: string;
  [key: string]: unknown;
}

export type LogWriter = (line: string, record: LogRecord) => void;

let writer: LogWriter = (line) => {
  process.stdout.write(line + "\n");
};

/** Inject a writer (tests; file sinks). The default writes to stdout. */
export function setLogWriter(w: LogWriter): void {
  writer = w;
}

const recordSubscribers = new Set<(record: LogRecord) => void>();

/** Subscribe to structured records (OTLP logs pipeline; tests). */
export function onLogRecord(fn: (record: LogRecord) => void): () => void {
  recordSubscribers.add(fn);
  return () => recordSubscribers.delete(fn);
}

function threshold(): number {
  const lvl = (process.env.XR_LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return LEVEL_ORDER[lvl] ?? LEVEL_ORDER.info;
}

export function structuredLog(level: LogLevel, event: string, fields: Record<string, unknown> = {}): LogRecord | null {
  if (LEVEL_ORDER[level] < threshold()) return null;
  const span = currentSpan();
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    event: truncateValue(event, 120),
  };
  if (span) {
    record.trace_id = span.traceId;
    record.span_id = span.spanId;
  }
  for (const [k, v] of Object.entries(fields)) {
    if (k === "trace_id" || k === "span_id" || k === "ts" || k === "level" || k === "event") continue;
    const redacted = redactValue(v);
    record[k] = typeof redacted === "string" ? truncateValue(redacted, TRUNC) : redacted;
  }
  const line = JSON.stringify(record);
  try {
    writer(line, record);
  } catch {
    // Logging must never break the application.
  }
  for (const fn of recordSubscribers) {
    try {
      fn(record);
    } catch {
      // fail quiet
    }
  }
  return record;
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => structuredLog("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => structuredLog("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => structuredLog("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => structuredLog("error", event, fields),
};
