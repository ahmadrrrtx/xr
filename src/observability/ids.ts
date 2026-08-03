/** W3C Trace Context identifiers (Phase 8 · T2). */

import { randomBytes } from "node:crypto";

/** 32 lower-hex chars (16 bytes). */
export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

/** 16 lower-hex chars (8 bytes). */
export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

export const TRACE_ID_RE = /^[0-9a-f]{32}$/;
export const SPAN_ID_RE = /^[0-9a-f]{16}$/;

/** traceparent header (version 00). */
export function traceparent(traceId: string, spanId: string, sampled: boolean): string {
  return `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
}

export function parseTraceparent(header: string | null): { traceId: string; spanId: string; sampled: boolean } | null {
  if (!header) return null;
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header.trim());
  if (!m) return null;
  return { traceId: m[1], spanId: m[2], sampled: m[3] === "01" };
}
