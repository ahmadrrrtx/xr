/**
 * XR Phase 06 — Canonical Reliability Taxonomy
 *
 * ONE classification model for the whole runtime. Retry decisions must never
 * be made from string-matching scattered across call sites, and "retryable"
 * must never be confused with "safe to retry": an error being RETRYABLE does
 * not make the operation SIDE_EFFECT_SAFE.
 *
 * The five concepts this module encodes (spec §CORE RELIABILITY PRINCIPLE):
 *
 *   RETRYABLE / NON_RETRYABLE          — is repeating the *request* sensible?
 *   SIDE_EFFECT_SAFE / UNSAFE          — may the *operation* be repeated at all?
 *   RECOVERABLE / NON_RECOVERABLE      — can an interrupted run be resumed?
 *
 * Recovery behavior is the JOINT decision:
 *
 *   ERROR + SIDE_EFFECT_CLASS + IDEMPOTENCY_STATE + CHECKPOINT_STATE
 *     = RECOVERY ACTION            (see `decideRetry`)
 *
 * Structured-first: KernelError codes, ProviderError kinds, ProviderAbortError
 * kinds and SQLite error codes are matched on their CODES, not messages. A
 * small, documented message fallback exists only for runtimes that surface
 * bare errors (fetch failures, child processes).
 */

import { ProviderError, type ProviderErrorKind } from "../providers/errors.ts";
import { ProviderAbortError, isCancellation, isTimeout } from "../providers/request-guard.ts";
import type { IdempotencyClass } from "./types.ts";

// ── Taxonomy ───────────────────────────────────────────────────────────────

/** Whether repeating the failed request is sensible at all. */
export type RetryClass = "retryable" | "non_retryable";

/** Recovery vocabulary for interrupted executions. */
export type RecoverabilityClass = "recoverable" | "non_recoverable";

/** Coarse failure categories used by classification, audit and UX. */
export type ErrorCategory =
  | "network"               // connection reset / DNS / socket failure
  | "timeout"               // deadline exceeded (provider or action)
  | "provider_transient"    // 503/overload — retryable provider failure
  | "provider_rate_limit"   // 429 — retryable only with budget + retry-after
  | "provider_malformed"    // structurally invalid response — NOT retryable
  | "auth"                  // invalid API key / 401 — never retry
  | "model_unavailable"     // model not found / unsupported — never retry
  | "invalid_request"       // malformed request — retry cannot fix it
  | "policy"                // policy engine denial
  | "security"              // path escape, secret leak, trust block
  | "validation"            // malformed tool call / invalid arguments
  | "tool_transient"        // tool failed, may not have done anything
  | "tool_permanent"        // tool failed deterministically
  | "database_transient"    // busy/locked — retryable with backoff
  | "database_corrupt"      // corruption / unavailable storage — NOT retryable
  | "cancellation"          // user/runtime cancellation — never "retry"
  | "unknown";

/** Full structured classification of a failure. */
export interface FailureClassification {
  /** Canonical retry verdict. */
  retryClass: RetryClass;
  /** Coarse category for audit/UX. */
  category: ErrorCategory;
  /** Stable code (error.code / provider kind / SQLITE_*), when known. */
  code: string;
  /** Provider/adapter hint: honor Retry-After when present (ms). */
  retryAfterMs?: number;
  /** Human-readable, secret-free rationale (audit-safe). */
  reason: string;
}

// ── Retry budget & backoff (spec steps 38, 39) ────────────────────────────

/** Bounded retry budget defaults. All retries in XR honor these ceilings. */
export const RETRY_BUDGET = {
  /** Default maximum attempts for a retryable operation. */
  DEFAULT_MAX_ATTEMPTS: 3,
  /** Hard ceiling on attempts regardless of caller request. */
  ABSOLUTE_MAX_ATTEMPTS: 5,
  /** Base delay for bounded exponential backoff (ms). */
  BASE_DELAY_MS: 250,
  /** Backoff cap — never exponential past this (ms). */
  MAX_DELAY_MS: 5_000,
  /** Overall deadline for one operation incl. retries (ms). */
  DEFAULT_DEADLINE_MS: 120_000,
} as const;

export interface RetryBudget {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Wall-clock deadline for ALL attempts; retries stop past it. */
  deadlineMs?: number;
  /** Provider-supplied Retry-After (ms) — honored as a floor. */
  retryAfterMs?: number;
}

/**
 * Bounded exponential backoff with deterministic-friendly jitter:
 * delay = min(cap, base * 2^(attempt-1)) ± 20%. Never infinite growth.
 * `retryAfterMs` acts as a floor (provider 429 etiquette).
 */
export function backoffDelayMs(attempt: number, budget: RetryBudget = {}, rng: () => number = Math.random): number {
  const base = budget.baseDelayMs ?? RETRY_BUDGET.BASE_DELAY_MS;
  const cap = budget.maxDelayMs ?? RETRY_BUDGET.MAX_DELAY_MS;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  const jitter = exp * (0.8 + rng() * 0.4); // ±20 %
  const floor = budget.retryAfterMs ?? 0;
  return Math.min(cap, Math.max(floor, Math.round(jitter)));
}

/** True when the attempt budget / deadline still allows another attempt. */
export function withinRetryBudget(
  attempt: number,
  startedAt: number,
  budget: RetryBudget = {},
  now: number = Date.now(),
): boolean {
  const maxAttempts = Math.min(
    budget.maxAttempts ?? RETRY_BUDGET.DEFAULT_MAX_ATTEMPTS,
    RETRY_BUDGET.ABSOLUTE_MAX_ATTEMPTS,
  );
  if (attempt >= maxAttempts) return false;
  const deadline = budget.deadlineMs ?? RETRY_BUDGET.DEFAULT_DEADLINE_MS;
  return now - startedAt < deadline;
}

// ── Provider-kind mapping (Phase 04 contract preserved) ───────────────────

const PROVIDER_KIND_CATEGORY: Record<ProviderErrorKind, ErrorCategory> = {
  authentication_failure: "auth",
  rate_limit: "provider_rate_limit",
  timeout: "timeout",
  unavailable: "provider_transient",
  invalid_request: "invalid_request",
  model_unavailable: "model_unavailable",
  unsupported_capability: "model_unavailable",
  provider_overload: "provider_transient",
  network_failure: "network",
  context_length: "invalid_request",
  content_policy_refusal: "policy",
  malformed_response: "provider_malformed",
  unknown_provider_failure: "unknown",
};

/** Provider kinds that are retryable against the SAME provider. */
const RETRYABLE_PROVIDER_KINDS: ReadonlySet<ProviderErrorKind> = new Set([
  "rate_limit",
  "timeout",
  "unavailable",
  "provider_overload",
  "network_failure",
]);

// ── SQLite / database taxonomy (spec step 28) ─────────────────────────────

const DB_TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "SQLITE_BUSY",
  "SQLITE_LOCKED",
  "SQLITE_BUSY_RECOVERY",
  "SQLITE_BUSY_SNAPSHOT",
  "SQLITE_LOCKED_SHAREDCACHE",
]);

const DB_CORRUPT_CODES: ReadonlySet<string> = new Set([
  "SQLITE_CORRUPT",
  "SQLITE_CORRUPT_VTAB",
  "SQLITE_NOTADB",
  "SQLITE_DAMAGED",
  "SQLITE_IOERR",
  "SQLITE_FULL",
  "SQLITE_READONLY",
]);

const DB_TRANSIENT_MESSAGE = /\b(database|table|disk) is locked\b|\bsqlite_busy\b/i;
const DB_CORRUPT_MESSAGE = /\bdatabase (disk image )?is (corrupt|malformed|encrypted)\b|\bdisk i\/o error\b|\bdatabase or disk is full\b/i;

// ── Message fallbacks (documented, bounded, code-first elsewhere) ─────────

const NETWORK_MESSAGE =
  /\b(ECONNRESET|ECONNREFUSED|ECONNABORTED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ETIMEDOUT|EPIPE)\b|connection (reset|closed|refused)|network (error|unreachable)|fetch failed/i;
const TIMEOUT_MESSAGE = /\b(ETIMEDOUT|ESOCKETTIMEDOUT)\b|timed? ?out|deadline exceeded/i;
const AUTH_MESSAGE = /\b(401|invalid api[- ]?key|authentication failed|unauthorized|invalid x-api-key)\b/i;
const RATE_LIMIT_MESSAGE = /\b429\b|rate ?limit|too many requests/i;
const UNAVAILABLE_MESSAGE = /\b503\b|service unavailable|server overloaded|\b502\b|\b504\b/i;
const MODEL_MISSING_MESSAGE = /\b404\b|model (not found|does not exist|is not available)|no such model/i;
const SECURITY_MESSAGE = /path escape|secret (leak|detected)|policy deni|trust.*(block|denied)|denied by policy/i;

// ── Core classification ───────────────────────────────────────────────────

/**
 * Classify any error into the canonical taxonomy. Never throws; unknown errors
 * classify as NON_RETRYABLE `unknown` (conservative: retrying unknown failures
 * is how side effects get duplicated).
 */
export function classifyError(err: unknown): FailureClassification {
  // 1. Provider layer (structured).
  if (err instanceof ProviderAbortError) {
    if (isCancellation(err)) {
      return mk("non_retryable", "cancellation", "CANCELLED", "caller cancellation is never retried");
    }
    if (isTimeout(err)) {
      return mk("retryable", "timeout", "PROVIDER_TIMEOUT", "provider request timed out before side effects are known");
    }
  }
  if (err instanceof ProviderError) {
    const category = PROVIDER_KIND_CATEGORY[err.kind] ?? "unknown";
    return {
      retryClass: RETRYABLE_PROVIDER_KINDS.has(err.kind) ? "retryable" : "non_retryable",
      category,
      code: `PROVIDER_${err.kind.toUpperCase()}`,
      retryAfterMs: err.details.retryAfterMs,
      reason: `provider ${err.providerId}: ${err.kind}`,
    };
  }

  const e = err as { code?: unknown; name?: unknown; message?: unknown; retryable?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : undefined;
  const message = typeof e?.message === "string" ? e.message : String(err ?? "");

  // 2. Database errors (structured code first, then documented fallback).
  if (code && DB_TRANSIENT_CODES.has(code)) {
    return mk("retryable", "database_transient", code, "database busy/locked — transient, bounded retry with backoff");
  }
  if (code && DB_CORRUPT_CODES.has(code)) {
    return mk("non_retryable", "database_corrupt", code, "database corruption/unavailable storage — never an automatic retry loop");
  }
  if (DB_CORRUPT_MESSAGE.test(message)) {
    return mk("non_retryable", "database_corrupt", code ?? "DB_CORRUPT", "database reported corruption or I/O damage");
  }
  if (DB_TRANSIENT_MESSAGE.test(message)) {
    return mk("retryable", "database_transient", code ?? "DB_BUSY", "database busy/locked (message match)");
  }

  // 3. Explicit structured hints from execution/tool errors.
  if (code === "TIMEOUT" || code === "EXECUTION_TIMEOUT") {
    return mk("retryable", "timeout", code, "execution timeout before known side effects");
  }
  if (code === "CANCELLED" || code === "CANCELLATION_UNSUPPORTED") {
    return mk("non_retryable", "cancellation", code, "cancellation is never retried");
  }
  if (code === "RECONCILIATION_REQUIRED" || code === "NON_IDEMPOTENT_RETRY_BLOCKED") {
    return mk("non_retryable", "tool_permanent", code, "side-effect status unknown — reconciliation, not retry");
  }
  if (code === "PATH_ESCAPE" || code === "SECRET_LEAK" || code === "TRUST_BLOCKED") {
    return mk("non_retryable", "security", code, "security boundary — retry cannot succeed and must not be attempted");
  }
  if (code === "POLICY_DENIED") {
    return mk("non_retryable", "policy", code, "policy engine denial — requires a policy change, not a retry");
  }
  if (code === "ACTION_VALIDATION_FAILED" || code === "MALFORMED_TOOL_CALL") {
    return mk("non_retryable", "validation", code, "malformed tool call / invalid arguments");
  }
  if (code === "BUDGET_EXCEEDED") {
    return mk("non_retryable", "policy", code, "budget ceiling — requires human decision");
  }

  // 4. Network / transport fallbacks (bare errors from fetch/sockets).
  if (code && ["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "EPIPE"].includes(code)) {
    return mk("retryable", "network", code, "transport failure (structured errno)");
  }
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return mk("retryable", "timeout", code, "transport timeout (structured errno)");
  }
  if (NETWORK_MESSAGE.test(message)) {
    return mk("retryable", "network", code ?? "NETWORK", "transport failure (message match)");
  }
  if (TIMEOUT_MESSAGE.test(message)) {
    return mk("retryable", "timeout", code ?? "TIMEOUT", "timeout (message match)");
  }
  if (RATE_LIMIT_MESSAGE.test(message)) {
    return mk("retryable", "provider_rate_limit", code ?? "RATE_LIMIT", "rate limited (message match)");
  }
  if (UNAVAILABLE_MESSAGE.test(message)) {
    return mk("retryable", "provider_transient", code ?? "UNAVAILABLE", "transient provider unavailability (message match)");
  }

  // 5. Deterministic failures — never retryable.
  if (AUTH_MESSAGE.test(message)) {
    return mk("non_retryable", "auth", code ?? "AUTH", "authentication failure — retrying cannot succeed");
  }
  if (MODEL_MISSING_MESSAGE.test(message)) {
    return mk("non_retryable", "model_unavailable", code ?? "MODEL_UNAVAILABLE", "model unavailable — retrying cannot succeed");
  }
  if (SECURITY_MESSAGE.test(message)) {
    return mk("non_retryable", "security", code ?? "SECURITY", "security/policy boundary");
  }

  // 6. Unknown → conservative NON_RETRYABLE.
  return mk("non_retryable", "unknown", code ?? "UNKNOWN", "unclassified failure — conservative non-retry");
}

/** Canonical predicate: is this error transient/retryable? (spec step 12). */
export function isRetryable(err: unknown): boolean {
  return classifyError(err).retryClass === "retryable";
}

/** Database-specific classification helper (spec step 28). */
export function classifyDbError(err: unknown): {
  kind: "transient" | "corrupt" | "unknown";
  retryable: boolean;
  code: string;
} {
  const c = classifyError(err);
  if (c.category === "database_transient") return { kind: "transient", retryable: true, code: c.code };
  if (c.category === "database_corrupt") return { kind: "corrupt", retryable: false, code: c.code };
  return { kind: "unknown", retryable: false, code: c.code };
}

// ── The joint retry decision (spec step 11, 40, 41, 42) ───────────────────

export interface RetryDecisionInput {
  error: unknown;
  /** Idempotency class of the operation being retried. */
  idempotency: IdempotencyClass;
  /** True when the operation may already have produced its side effect. */
  sideEffectUnknown: boolean;
  /** Attempt number that just failed (1-based). */
  attempt: number;
  /** When the operation first started (for deadline enforcement). */
  startedAt?: number;
  budget?: RetryBudget;
  /**
   * Caller override predicate (e.g. adapter policy). When supplied it is
   * consulted ONLY after the safety gates pass — it may veto a retry, never
   * authorize an unsafe one.
   */
  callerAllowsRetry?: (err: Error, attempt: number) => boolean | Promise<boolean>;
}

export type RetryVerdict = "retry" | "do_not_retry" | "reconcile";

export interface RetryDecision {
  verdict: RetryVerdict;
  classification: FailureClassification;
  /** Delay before the next attempt (0 when verdict != retry). */
  delayMs: number;
  reason: string;
}

/**
 * ERROR + SIDE_EFFECT_CLASS + IDEMPOTENCY_STATE (+ budget) = RECOVERY ACTION.
 *
 * A retry is permitted only when ALL of:
 *   1. the error classifies retryable,
 *   2. the operation is safe to repeat: naturally idempotent, or keyed
 *      idempotent carrying a stable key, or no side effect was possible yet,
 *   3. the attempt/deadline budget allows it,
 *   4. the caller predicate (if any) does not veto.
 *
 * A non-idempotent/unknown operation whose side-effect status is unknown is
 * NEVER retried — it becomes `reconcile` (at-most-once + manual reconciliation),
 * which is the only honest answer when "did it happen?" is unanswerable.
 */
export async function decideRetry(input: RetryDecisionInput): Promise<RetryDecision> {
  const classification = classifyError(input.error);

  // Cancellation is terminal for this operation.
  if (classification.category === "cancellation") {
    return { verdict: "do_not_retry", classification, delayMs: 0, reason: classification.reason };
  }

  // Safety gate first: an unsafe operation is never retried, whatever the error.
  const unsafeSideEffect =
    input.sideEffectUnknown &&
    input.idempotency !== "naturally_idempotent" &&
    input.idempotency !== "idempotent_with_key";
  if (unsafeSideEffect) {
    return {
      verdict: "reconcile",
      classification,
      delayMs: 0,
      reason:
        "side effect may already have occurred and the operation is not safely repeatable — reconciliation required, no blind retry",
    };
  }

  if (classification.retryClass === "non_retryable") {
    return { verdict: "do_not_retry", classification, delayMs: 0, reason: classification.reason };
  }

  const startedAt = input.startedAt ?? Date.now();
  if (!withinRetryBudget(input.attempt, startedAt, input.budget)) {
    return {
      verdict: "do_not_retry",
      classification,
      delayMs: 0,
      reason: "retry budget/deadline exhausted — retryable error, but bounds reached",
    };
  }

  if (input.callerAllowsRetry) {
    const asError = input.error instanceof Error ? input.error : new Error(String(input.error));
    const allowed = await input.callerAllowsRetry(asError, input.attempt);
    if (!allowed) {
      return { verdict: "do_not_retry", classification, delayMs: 0, reason: "caller retry predicate vetoed" };
    }
  }

  return {
    verdict: "retry",
    classification,
    delayMs: backoffDelayMs(input.attempt, { ...input.budget, retryAfterMs: classification.retryAfterMs }),
    reason: classification.reason,
  };
}

// ── Internals ─────────────────────────────────────────────────────────────

function mk(
  retryClass: RetryClass,
  category: ErrorCategory,
  code: string,
  reason: string,
): FailureClassification {
  return { retryClass, category, code, reason };
}
