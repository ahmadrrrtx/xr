/**
 * XR 5.1 — Bounded environment recovery (§7.7).
 *
 * Self-healing here is deliberately small:
 *   - at most ONE automatic re-observe retry for perceptual failures;
 *   - irreversible / unknown-side-effect failures NEVER auto-retry;
 *   - a per-session circuit breaker stops repeated failure loops;
 *   - every decision is audited and user-visible.
 *
 * There is no unrestricted autonomous repair anywhere in this module.
 */
import { ENVIRONMENT_BOUNDS, type EnvironmentSession, type Reversibility } from "./types.ts";

// ── Error taxonomy ────────────────────────────────────────────────────────

export type RecoveryKind =
  /** Perception-related: worth ONE retry after a mandatory re-observation. */
  | "retryable_reobserve"
  /** Never retried automatically: policy/capability/user decisions. */
  | "terminal";

const REOBSERVE_PATTERNS: ReadonlyArray<RegExp> = [
  /waiting for selector/i,
  /selector.*not found/i,
  /element is not attached/i,
  /element.*not visible/i,
  /stale element/i,
  /navigation timeout/i,
  /timeout \d+ms exceeded/i,
  /target closed/i,
  /page crashed/i,
  /frame was detached/i,
];

export function classifyFailure(message: string): RecoveryKind {
  const m = message.toLowerCase();
  if (/denied|permission|not granted|disabled|blocked by policy|invalid action|schema|not implemented/.test(m)) {
    return "terminal";
  }
  if (REOBSERVE_PATTERNS.some((re) => re.test(message))) return "retryable_reobserve";
  return "terminal";
}

// ── Retry budget ──────────────────────────────────────────────────────────

export interface RecoveryDecision {
  retry: boolean;
  kind?: "reobserve_retry";
  reason: string;
}

export interface RecoveryBudgetState {
  retriesUsed: number;
}

export function newRecoveryBudget(): RecoveryBudgetState {
  return { retriesUsed: 0 };
}

/**
 * Decide whether an automatic re-observe retry is permitted. A retry is allowed
 * only when ALL hold:
 *   - failure is perceptual (retryable_reobserve);
 *   - the action is reversible or compensatable (never irreversible/unknown);
 *   - the retry budget (1) has not been spent;
 *   - the session circuit is closed.
 */
export function decideRecovery(params: {
  failureMessage: string;
  reversibility: Reversibility;
  sideEffectUnknown: boolean;
  budget: RecoveryBudgetState;
  session?: EnvironmentSession;
  maxRetries?: number;
}): RecoveryDecision {
  const max = params.maxRetries ?? ENVIRONMENT_BOUNDS.MAX_REOBSERVE_RETRIES;
  if (params.sideEffectUnknown) {
    return { retry: false, reason: "side effect is unknown — never auto-retry; human review required" };
  }
  if (params.reversibility === "irreversible" || params.reversibility === "unknown") {
    return { retry: false, reason: `reversibility is '${params.reversibility}' — automatic retry is not permitted` };
  }
  if (classifyFailure(params.failureMessage) !== "retryable_reobserve") {
    return { retry: false, reason: "failure is not a recoverable perception error" };
  }
  if (params.budget.retriesUsed >= max) {
    return { retry: false, reason: `re-observe retry budget exhausted (${max})` };
  }
  const s = params.session;
  if (s?.circuitOpenUntil && Date.now() < s.circuitOpenUntil) {
    return { retry: false, reason: "session circuit breaker is open" };
  }
  return { retry: true, kind: "reobserve_retry", reason: "perception failure; retrying once after re-observation" };
}

// ── Circuit breaker ───────────────────────────────────────────────────────

export interface CircuitEvent {
  opened: boolean;
  consecutiveFailures: number;
  cooldownUntil?: number;
  reason?: string;
}

/** Record an outcome on the session; opens the circuit at the threshold. */
export function recordOutcomeOnCircuit(
  session: EnvironmentSession,
  ok: boolean,
  now = Date.now(),
  opts: { threshold?: number; cooldownMs?: number } = {},
): CircuitEvent {
  const threshold = opts.threshold ?? ENVIRONMENT_BOUNDS.CIRCUIT_FAILURE_THRESHOLD;
  const cooldownMs = opts.cooldownMs ?? ENVIRONMENT_BOUNDS.CIRCUIT_COOLDOWN_MS;
  if (ok) {
    session.consecutiveFailures = 0;
    return { opened: false, consecutiveFailures: 0 };
  }
  session.consecutiveFailures += 1;
  if (session.consecutiveFailures >= threshold) {
    session.circuitOpenUntil = now + cooldownMs;
    return {
      opened: true,
      consecutiveFailures: session.consecutiveFailures,
      cooldownUntil: session.circuitOpenUntil,
      reason: `${session.consecutiveFailures} consecutive failures — circuit open for ${Math.round(cooldownMs / 1000)}s; human review recommended`,
    };
  }
  return { opened: false, consecutiveFailures: session.consecutiveFailures };
}

export function circuitState(session: EnvironmentSession, now = Date.now()): {
  open: boolean;
  remainingMs: number;
  consecutiveFailures: number;
} {
  const remaining = session.circuitOpenUntil ? Math.max(0, session.circuitOpenUntil - now) : 0;
  if (session.circuitOpenUntil && remaining === 0) {
    // Half-open: allow a probe; count stays until a success resets it.
    return { open: false, remainingMs: 0, consecutiveFailures: session.consecutiveFailures };
  }
  return { open: remaining > 0, remainingMs: remaining, consecutiveFailures: session.consecutiveFailures };
}
