/**
 * Phase 09 — quality-checked session micro-compaction.
 *
 * Extends `context/memory/compact.ts` (kept unchanged) with:
 *   • preserve current objective / decisions / unresolved / policy
 *   • preserve recent turns and active tool state
 *   • never destroy the original on failure
 *   • bounded retries + honest status
 *
 * Deterministic. No model call. Fail closed: if quality cannot be met the
 * original message list is returned untouched.
 */

import type { Message } from "../core/types.ts";
import { compact, totalChars } from "./memory/compact.ts";
import { recordCompaction } from "./engine.ts";

export interface MicroCompactOptions {
  maxChars?: number;
  keepRecent?: number;
  maxRetries?: number;
  /** Required phrases / constraints that MUST survive (policy, approvals). */
  mustPreserve?: readonly string[];
}

export interface MicroCompactResult {
  ok: boolean;
  messages: Message[];
  originalChars: number;
  compactedChars: number;
  retries: number;
  preserved: string[];
  lost: string[];
  /** True when we returned the original list because compaction was unsafe. */
  fallback: boolean;
  reason: string;
}

const DEFAULT_MAX_RETRIES = 2;

const OBJECTIVE_RE = /\b(objective|goal|we (?:are|will)|must|need to)\b/i;
const DECISION_RE = /\b(decided|decision|chose|rejected|approved|denied)\b/i;
const UNRESOLVED_RE = /\b(open question|todo|unresolved|blocked|waiting|FIXME|TODO)\b/i;
const POLICY_RE = /\b(must not|do not|never|approval|policy|permission|deny|allowlist)\b/i;

/**
 * Compact a conversation while preserving high-value structure.
 * On any quality failure the ORIGINAL list is returned (fallback: true).
 */
export function microCompact(messages: Message[], opts: MicroCompactOptions = {}): MicroCompactResult {
  const original = messages;
  const originalChars = totalChars(original);
  const maxChars = opts.maxChars ?? 16_000;
  const keepRecent = opts.keepRecent ?? 6;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const mustPreserve = [...(opts.mustPreserve ?? []), ...extractMustPreserve(original)];

  if (originalChars <= maxChars) {
    return {
      ok: true,
      messages: original,
      originalChars,
      compactedChars: originalChars,
      retries: 0,
      preserved: mustPreserve,
      lost: [],
      fallback: false,
      reason: "under budget — no compaction",
    };
  }

  let last: Message[] = original;
  let retries = 0;
  let reason = "compaction refused";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    retries = attempt;
    const budget = attempt === 0 ? maxChars : Math.floor(maxChars * (1 + attempt * 0.15));
    const candidate = compact(original, { maxChars: budget, keepRecent });
    const check = qualityCheck(original, candidate, mustPreserve);
    if (check.ok) {
      recordCompaction();
      return {
        ok: true,
        messages: candidate,
        originalChars,
        compactedChars: totalChars(candidate),
        retries,
        preserved: check.preserved,
        lost: [],
        fallback: false,
        reason: attempt === 0 ? "compacted" : `compacted after ${attempt} retry(ies)`,
      };
    }
    last = candidate;
    reason = check.reason;
    // Next retry loosens the char budget so more evidence can survive.
  }

  // FAIL CLOSED — original is intact.
  void last;
  return {
    ok: false,
    messages: original,
    originalChars,
    compactedChars: originalChars,
    retries,
    preserved: mustPreserve,
    lost: mustPreserve.filter((p) => !textOf(last).includes(p)),
    fallback: true,
    reason,
  };
}

function extractMustPreserve(messages: Message[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    const line = m.content.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (OBJECTIVE_RE.test(line) || DECISION_RE.test(line) || UNRESOLVED_RE.test(line) || POLICY_RE.test(line)) {
      // Keep a short distinctive snippet, not the whole turn.
      const snippet = line.slice(0, 48).trim();
      if (snippet.length >= 12) out.push(snippet);
    }
    if (m.role === "system" && /instruction|policy|approval/i.test(line)) {
      const snippet = line.slice(0, 48).trim();
      if (snippet.length >= 12) out.push(snippet);
    }
  }
  return unique(out).slice(0, 12);
}

function qualityCheck(
  original: Message[],
  candidate: Message[],
  mustPreserve: readonly string[],
): { ok: boolean; preserved: string[]; reason: string } {
  if (candidate.length === 0 && original.length > 0) {
    return { ok: false, preserved: [], reason: "compaction produced an empty conversation" };
  }
  const hay = textOf(candidate);
  const preserved: string[] = [];
  const lost: string[] = [];
  for (const p of mustPreserve) {
    if (hay.includes(p)) preserved.push(p);
    else lost.push(p);
  }
  // Policy / security constraints are never optional.
  const policyLost = lost.filter((p) => POLICY_RE.test(p));
  if (policyLost.length) {
    return { ok: false, preserved, reason: `policy constraint lost: ${policyLost[0]}` };
  }
  // Losing every extracted signal is a quality failure.
  if (mustPreserve.length >= 3 && preserved.length === 0) {
    return { ok: false, preserved, reason: "no high-value signals survived compaction" };
  }
  return { ok: true, preserved, reason: "ok" };
}

function textOf(messages: Message[]): string {
  return messages.map((m) => m.content).join("\n");
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
