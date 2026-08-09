/**
 * XR Phase 5 · T4 — Mid-conversation failover context preservation.
 *
 * Principle adopted (docs/historical/phases/phase5-routing/03-RESEARCH-NOTES.md · R4,
 * ContinuityBench arXiv:2607.15899): high API availability ≠ conversational
 * continuity. Stateful failover must forward the conversation; the metric is
 * CPR — Continuity Preservation Rate — the share of canonical factual anchors
 * that reach the fallback model. XR's mechanism is History-Forwarding (the
 * paper's winning strategy); this module makes it MEASURED, not asserted.
 *
 * `contextAnchors` and `measureCpr` are pure and shared by:
 *   · the runtime failover record (what was forwarded, anchors included), and
 *   · the failover-injection harness (test/intelligence/failover-cpr.test.ts)
 * so the harness measures exactly what the runtime transmits.
 *
 * Records contain NO secrets: anchors are caller-supplied canonical strings
 * (in the harness they are synthetic facts), counts, and hashes only.
 */

import { createHash } from "node:crypto";
import type { Message } from "../core/types.ts";

export interface ContextManifest {
  /** Total messages forwarded. */
  messageCount: number;
  /** Total characters forwarded. */
  totalChars: number;
  /** Anchors supplied by the caller (harness/canonical facts). */
  anchors: string[];
  /** Anchors verified present in the forwarded payload. */
  anchorsForwarded: string[];
  /** CPR for THIS failover when anchors were supplied (1 when none supplied). */
  cpr: number;
  /** SHA-256 of the serialized payload — integrity evidence, no content. */
  payloadHash: string;
}

/** Serialize the conversation exactly as a provider adapter consumes it. */
export function serializeConversation(messages: Message[]): string {
  return messages.map((m) => `${m.role}:\n${m.content}`).join("\n");
}

/**
 * Which of the caller-declared anchors are present in the payload a model
 * receives? Presence = exact substring of the serialized conversation —
 * the same check the ContinuityBench-style harness applies.
 */
export function anchorsPresent(messages: Message[], anchors: string[]): string[] {
  const hay = serializeConversation(messages);
  return anchors.filter((a) => a.length > 0 && hay.includes(a));
}

/**
 * Build the manifest for one failover forwarding event.
 * `anchors` are the canonical facts the conversation is known to depend on
 * (empty for production traffic where we do not read user content — we still
 * record counts + hash, never content).
 */
export function contextManifest(messages: Message[], anchors: string[] = []): ContextManifest {
  const serialized = serializeConversation(messages);
  const forwarded = anchorsPresent(messages, anchors);
  return {
    messageCount: messages.length,
    totalChars: serialized.length,
    anchors,
    anchorsForwarded: forwarded,
    cpr: anchors.length === 0 ? 1 : forwarded.length / anchors.length,
    payloadHash: createHash("sha256").update(serialized).digest("hex"),
  };
}

/** CPR over N failover events. */
export function aggregateCpr(samples: number[]): { mean: number; samples: number } {
  if (!samples.length) return { mean: 1, samples: 0 };
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { mean: Math.round(mean * 10000) / 10000, samples: samples.length };
}

/** CPR SLO target (Phase 5 Part 8 · T4). */
export const CPR_TARGET = 0.95;
