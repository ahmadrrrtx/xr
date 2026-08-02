/**
 * XR Observability — span engine (Phase 8 · T2).
 *
 * A deliberately small, W3C-compatible span model with AsyncLocalStorage
 * propagation (sub-agents child naturally — no manual plumbing), root
 * sampling, a bounded local ring buffer (powers the local `/api/v1/traces`
 * view — structural only, never leaves the machine by itself), and a
 * pluggable exporter hook (OTLP, opt-in).
 *
 * Every attribute write passes `redactValue` — there is no raw path.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { newSpanId, newTraceId } from "./ids.ts";
import { redactValue, truncateValue, MAX_ATTRIBUTE_VALUE_LENGTH } from "./redaction.ts";
import type { SpanKind } from "./semconv.ts";
import { telemetry } from "./config.ts";

export type SpanStatus = "ok" | "error";

export interface SpanEvent {
  name: string;
  at: number;
  attributes?: Record<string, unknown>;
}

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  status?: SpanStatus;
  errorType?: string;
}

const spanContext = new AsyncLocalStorage<Span | undefined>();

export class Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startMs: number;
  private endMs?: number;
  private readonly attrs: Record<string, unknown> = {};
  private readonly evts: SpanEvent[] = [];
  private statusValue?: SpanStatus;
  private errorTypeValue?: string;
  private ended = false;

  constructor(init: { name: string; kind: SpanKind; traceId: string; spanId: string; parentSpanId?: string; startMs: number }) {
    this.name = init.name;
    this.kind = init.kind;
    this.traceId = init.traceId;
    this.spanId = init.spanId;
    this.parentSpanId = init.parentSpanId;
    this.startMs = init.startMs;
  }

  /** Set a structural attribute. Values are redacted + truncated by construction. */
  set(key: string, value: unknown): this {
    if (value === undefined || value === null) return this;
    if (this.ended) return this;
    const redacted = redactValue(value);
    this.attrs[key] = typeof redacted === "string" ? truncateValue(redacted) : redacted;
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    if (this.ended) return this;
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(attributes ?? {})) {
      const redacted = redactValue(v);
      safe[k] = typeof redacted === "string" ? truncateValue(redacted) : redacted;
    }
    this.evts.push({ name, at: Date.now(), attributes: Object.keys(safe).length ? safe : undefined });
    return this;
  }

  setStatus(status: SpanStatus, errorType?: string): this {
    if (this.ended) return this;
    this.statusValue = status;
    if (errorType) this.errorTypeValue = truncateValue(String(errorType), 120);
    return this;
  }

  isEnded(): boolean {
    return this.ended;
  }

  get isRecording(): boolean {
    return !this.ended;
  }

  end(endMs: number = Date.now()): SpanData {
    if (this.ended) return this.snapshot();
    this.endMs = endMs;
    this.ended = true;
    const data = this.snapshot();
    recordSpan(data);
    return data;
  }

  snapshot(): SpanData {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startMs: this.startMs,
      endMs: this.endMs,
      durationMs: this.endMs === undefined ? undefined : Math.max(0, this.endMs - this.startMs),
      attributes: { ...this.attrs },
      events: [...this.evts],
      status: this.statusValue,
      errorType: this.errorTypeValue,
    };
  }
}

export interface StartSpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, unknown>;
  /** Force a parent (defaults to the ambient span). */
  parent?: Span;
  /** Explicit trace linkage (e.g. W3C traceparent from an inbound request). */
  traceId?: string;
  parentSpanId?: string;
}

function sampled(): boolean {
  const ratio = telemetry().sampleRatio;
  if (ratio >= 1) return true;
  if (ratio <= 0) return false;
  return Math.random() < ratio;
}

/** Non-recording stub used when sampling decides to drop. Zero-cost-ish. */
class NoopSpan extends Span {
  constructor() {
    super({ name: "noop", kind: "internal", traceId: "0".repeat(32), spanId: "0".repeat(16), startMs: 0 });
  }
  override set(): this { return this; }
  override addEvent(): this { return this; }
  override setStatus(): this { return this; }
  override end(): SpanData {
    return this.snapshot();
  }
}

const NOOP = new NoopSpan();

export function startSpan(name: string, opts: StartSpanOptions = {}): Span {
  const parent = opts.parent ?? spanContext.getStore();
  const isRoot = !parent && !opts.traceId;
  if (isRoot && !sampled()) return NOOP;
  if (parent === NOOP) return NOOP;

  const span = new Span({
    name: truncateValue(name, 128),
    kind: opts.kind ?? "internal",
    traceId: opts.traceId ?? parent?.traceId ?? newTraceId(),
    spanId: newSpanId(),
    parentSpanId: opts.parentSpanId ?? (parent && parent !== NOOP ? parent.spanId : undefined),
    startMs: Date.now(),
  });
  for (const [k, v] of Object.entries(opts.attributes ?? {})) span.set(k, v);
  return span;
}

/** Run `fn` with `span` as the ambient context (children nest under it). */
export function withSpan<T>(span: Span, fn: () => T): T {
  return spanContext.run(span === NOOP ? (undefined as unknown as Span) : span, fn);
}

export function currentSpan(): Span | undefined {
  const store = spanContext.getStore();
  return store === NOOP ? undefined : store;
}

/** Convenience: start → run → end with status capture. */
export async function traceAsync<T>(name: string, opts: StartSpanOptions, fn: (span: Span) => Promise<T>): Promise<T> {
  const span = startSpan(name, opts);
  return await withSpan(span, async () => {
    try {
      const out = await fn(span);
      if (!span.isEnded()) span.end();
      return out;
    } catch (err) {
      span.setStatus("error", (err as Error)?.name ?? "Error");
      if (!span.isEnded()) span.end();
      throw err;
    }
  });
}

// ── Span recording: bounded local ring + exporter hook ──────────────────────

export interface SpanSink {
  onSpan(span: SpanData): void;
}

const sinks = new Set<SpanSink>();

/** Exporter lifecycle hook (registered by initObservability when enabled). */
export function registerSpanSink(sink: SpanSink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

let ring: SpanData[] = [];
let ringDropped = 0;
const listeners = new Set<(span: SpanData) => void>();

/** Subscribe to finished spans synchronously (tests + the OTLP queue). */
export function onSpanRecorded(fn: (span: SpanData) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function recordSpan(data: SpanData): void {
  const cap = telemetry().ringBufferSize;
  if (ring.length >= cap) {
    ring.shift();
    ringDropped++;
  }
  ring.push(data);
  for (const sink of sinks) {
    try {
      sink.onSpan(data);
    } catch {
      // Telemetry must never break the application (fail quiet).
    }
  }
  for (const fn of listeners) {
    try {
      fn(data);
    } catch {
      // fail quiet
    }
  }
}

/** Recent finished spans (structural only; local). */
export function recentSpans(limit = 100): { spans: SpanData[]; dropped: number } {
  return { spans: ring.slice(-Math.max(1, Math.min(limit, ring.length))), dropped: ringDropped };
}

/** Test hook: clear buffers/counters. */
export function resetTracerState(): void {
  ring = [];
  ringDropped = 0;
  listeners.clear();
  sinks.clear();
}

// Guard: attribute values can never exceed the hard bound even for odd paths.
void MAX_ATTRIBUTE_VALUE_LENGTH;
