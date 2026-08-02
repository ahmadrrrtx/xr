/**
 * XR Phase 5 · T3/T4 — Failure classification, retry budget, degradation
 * levels, human escalation, and the context-preserving chain executor.
 *
 * Ops consensus adopted (docs/phase5-routing/03-RESEARCH-NOTES.md · R3/R4):
 *   · THREE-TIER error classification — transient / permanent / semantic —
 *     because each class wants a different reaction (retry, advance, advance
 *     + record quality-degradation for the breaker).
 *   · Jittered exponential backoff CAPPED BY A RETRY BUDGET — retries may
 *     not starve the fallback dispatch.
 *   · DEFINED degradation levels L0→L3 with visible transitions and a human
 *     escalation package when the chain exhausts — never a silent reroute,
 *     never a fake success (Constitution Art. IV.2, Art. X.3, Charter §9.5).
 *   · Context preservation: every chain advance forwards the COMPLETE
 *     conversation (History-Forwarding) and records a context manifest
 *     (counts + hash; anchors only when the caller supplies them).
 *
 * Model calls are side-effect-free at this layer (tools execute in the agent
 * loop AFTER a successful turn), so target-diverse retry is safe; in-place
 * retry is restricted to transient failures only.
 */

import type { Message, ModelTurn, Provider, Tool } from "../core/types.ts";
import {
  contextManifest,
  type ContextManifest,
} from "./failover.ts";
import type { FallbackStep } from "./types.ts";
import type { RoutingHealth, TripEvent } from "./health.ts";
import type { IntelligenceMetrics } from "./metrics.ts";
import type { ModelClass } from "./types.ts";

// ── Three-tier error classification ─────────────────────────────────────────

export type ErrorClass = "transient" | "permanent" | "semantic";

export interface ClassifiedError {
  cls: ErrorClass;
  reason: string;
}

/** A well-formed HTTP-200 that violates the model contract (invalid turn). */
export class SemanticFailure extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SemanticFailure";
  }
}

const TRANSIENT =
  /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNABORTED|socket hang up|rate.?limit|too many requests|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|overloaded|temporarily unavailable|service unavailable|upstream connect/i;
const PERMANENT =
  /\b401\b|\b403\b|\b404\b|unauthorized|forbidden|invalid api.?key|authentication|permission denied|not found|does not exist|no such model|invalid model/i;
const SEMANTIC =
  /invalid (json|response)|unparseable|parse error|schema|refus|content.?filter|safety|semantic/i;

/**
 * Classify a provider failure generically (no provider-specific branching —
 * Art. VII). Unknown errors classify PERMANENT: no in-place retry (safe side
 * of `mayFallbackOnTrigger("unknown_completion")`), but target-diverse chain
 * advance remains permitted, mirroring the existing trigger table.
 */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof SemanticFailure) {
    return { cls: "semantic", reason: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (SEMANTIC.test(msg)) return { cls: "semantic", reason: msg.slice(0, 160) };
  if (TRANSIENT.test(msg)) return { cls: "transient", reason: msg.slice(0, 160) };
  if (PERMANENT.test(msg)) return { cls: "permanent", reason: msg.slice(0, 160) };
  return { cls: "permanent", reason: `unclassified failure: ${msg.slice(0, 120)}` };
}

// ── Retry budget + jittered backoff ─────────────────────────────────────────

export interface RetryPolicy {
  /** In-place retries per target for TRANSIENT failures only. */
  maxInPlaceRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Total sleep budget across ALL retries of one chat() call, ms. */
  totalBudgetMs: number;
  jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxInPlaceRetries: 1,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  totalBudgetMs: 8_000,
  jitterRatio: 0.3,
};

/** Pure backoff — seedable, capped by both max delay and remaining budget. */
export function backoffDelay(
  attempt: number,
  policy: RetryPolicy,
  spentMs: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(policy.baseDelayMs * Math.pow(2, attempt), policy.maxDelayMs);
  const jitter = 1 + (random() * 2 - 1) * policy.jitterRatio;
  const withJitter = Math.round(base * jitter);
  return Math.max(0, Math.min(withJitter, policy.totalBudgetMs - spentMs));
}

// ── Degradation levels + escalation ─────────────────────────────────────────

export type DegradationLevel =
  | "L0_full"
  | "L1_equivalent_fallback"
  | "L2_reduced_fallback"
  | "L3_escalation";

export interface FailoverAttempt {
  providerId: string;
  modelId: string;
  errorClass: ErrorClass | "skipped";
  /** Sanitized — redaction enforced, truncated, no secrets. */
  message: string;
  durationMs: number;
  at: number;
}

export interface EscalationPackage {
  schemaVersion: 1;
  decisionId?: string;
  reason: string;
  attempts: FailoverAttempt[];
  level: "L3_escalation";
  /** Concrete repair path for the operator (Art. X.3). */
  repair: string[];
  at: number;
}

export class RoutingEscalationError extends Error {
  readonly escalation: EscalationPackage;
  constructor(pkg: EscalationPackage) {
    super(pkg.reason);
    this.name = "RoutingEscalationError";
    this.escalation = pkg;
  }
}

/** Redact anything that looks like credential material (Part 20). */
export function redactSecrets(input: string): string {
  return input
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "[redacted]")
    .replace(/(bearer)\s+[A-Za-z0-9_\-.+/=]{8,}/gi, "$1 [redacted]")
    .replace(/(api[_-]?key|token|secret|password|authorization)(\s*[=:]\s*)\S+/gi, "$1$2[redacted]")
    .slice(0, 200);
}

// ── Failover event (recorded + visible) ─────────────────────────────────────

export interface FailoverRecord {
  decisionId?: string;
  from: { providerId: string; modelId: string };
  to: { providerId: string; modelId: string };
  trigger: ErrorClass;
  level: DegradationLevel;
  /** Context evidence for THIS hop (counts + hash always). */
  context: ContextManifest;
  at: number;
}

export interface ResilientDeps {
  health: RoutingHealth;
  metrics?: IntelligenceMetrics;
  modelClass?: ModelClass;
  /** Build a provider for a chain step (single authority constructs). */
  construct(step: FallbackStep): Provider;
  /** Defense-in-depth locality re-check per hop (never silently escalate). */
  localityGuard(providerId: string): boolean;
  retry?: Partial<RetryPolicy>;
  /** Canonical anchor facts the harness wants verified (production: none). */
  contextAnchors?: string[];
  decisionId?: string;
  onFailover?(record: FailoverRecord): void;
  onTrip?(event: TripEvent): void;
  onDegradation?(level: DegradationLevel, reason: string): void;
  onOutcome?(sample: {
    providerId: string;
    modelId: string;
    success: boolean;
    latencyMs: number;
    qualityOk: boolean;
    usage?: { inTokens: number; outTokens: number };
  }): void;
  sleep?: (ms: number) => Promise<void>;
  warn?: (line: string) => void;
  random?: () => number;
}

export interface ResilientTarget {
  providerId: string;
  modelId: string;
  level: DegradationLevel;
  step?: FallbackStep;
}

/** A turn must carry SOMETHING actionable, else it is a semantic failure. */
export function validateTurn(turn: ModelTurn): { ok: boolean; reason?: string } {
  if (turn.done) return { ok: true };
  if (turn.toolCalls && turn.toolCalls.length > 0) return { ok: true };
  if (turn.message && turn.message.trim().length > 0) return { ok: true };
  return { ok: false, reason: "empty turn: no message, no tool calls, not done" };
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Executes a routing decision's fallback chain with health gating, retry
 * budget, three-tier classification, degradation levels, context preservation,
 * and honest escalation. This is NOT a second router: it executes the chain
 * the single routing authority already decided.
 */
export class ResilientProvider implements Provider {
  private readonly policy: RetryPolicy;
  private highestLevel: DegradationLevel = "L0_full";

  constructor(
    private readonly primary: Provider,
    private readonly primaryModel: string,
    private readonly chain: Array<FallbackStep & { level?: DegradationLevel }>,
    private readonly deps: ResilientDeps,
  ) {
    this.policy = { ...DEFAULT_RETRY_POLICY, ...deps.retry };
  }

  get id(): string {
    return this.primary.id;
  }

  get label(): string {
    if (!this.chain.length) return this.primary.label;
    return `${this.primary.label} → resilient chain (${this.chain.length} step${this.chain.length > 1 ? "s" : ""})`;
  }

  /** Degradation level actually reached by completed failover hops. */
  get degradationLevel(): DegradationLevel {
    return this.highestLevel;
  }

  private escalate(level: DegradationLevel, reason: string): void {
    const order: DegradationLevel[] = ["L0_full", "L1_equivalent_fallback", "L2_reduced_fallback", "L3_escalation"];
    if (order.indexOf(level) > order.indexOf(this.highestLevel)) {
      this.highestLevel = level;
      this.deps.onDegradation?.(level, reason);
    }
  }

  async chat(messages: Message[], tools: Tool[]): Promise<ModelTurn> {
    const sleep = this.deps.sleep ?? DEFAULT_SLEEP;
    const random = this.deps.random ?? Math.random;
    const warn = this.deps.warn ?? ((l: string) => console.warn(l));
    const attempts: FailoverAttempt[] = [];
    let sleptMs = 0;
    let lastError: ClassifiedError = { cls: "permanent", reason: "no target attempted" };

    const targets: ResilientTarget[] = [
      { providerId: this.primary.id, modelId: this.primaryModel, level: "L0_full" },
      ...this.chain.map((s) => ({
        providerId: s.providerId,
        modelId: s.modelId,
        level: s.level ?? "L1_equivalent_fallback",
        step: s,
      })),
    ];

    let provider: Provider = this.primary;
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;

      // Defense-in-depth: the authority filtered the chain already; the
      // executor re-checks so a constructed provider can never disagree.
      if (!this.deps.localityGuard(target.providerId)) {
        attempts.push(this.attempt(target, "skipped", `locality guard refused ${target.providerId}`, 0));
        continue;
      }

      const permit = this.deps.health.permit(target.providerId, target.modelId);
      if (permit === "deny_open") {
        attempts.push(this.attempt(target, "skipped", "circuit open — target skipped", 0));
        continue;
      }

      if (i > 0) {
        provider = this.deps.construct(target.step!);
        const manifest = contextManifest(messages, this.deps.contextAnchors ?? []);
        this.escalate(target.level, `failover to ${target.providerId}/${target.modelId}`);
        const record: FailoverRecord = {
          decisionId: this.deps.decisionId,
          from: {
            providerId: targets[i - 1]!.providerId,
            modelId: targets[i - 1]!.modelId,
          },
          to: { providerId: target.providerId, modelId: target.modelId },
          trigger: lastError.cls,
          level: target.level,
          context: manifest,
          at: Date.now(),
        };
        this.deps.onFailover?.(record);
        warn(
          `\x1b[33m! ${targets[i - 1]!.providerId}/${targets[i - 1]!.modelId} failed (${lastError.cls}). ` +
            `Failing over to ${target.providerId}/${target.modelId} [${target.level}, context: ${manifest.messageCount} messages preserved]\x1b[0m`,
        );
      }

      // In-place retry is allowed for transient failures within budget only.
      for (let retry = 0; ; retry++) {
        const t0 = Date.now();
        try {
          const turn = await provider.chat(messages, tools);
          const validation = validateTurn(turn);
          if (!validation.ok) throw new SemanticFailure(validation.reason!);
          const ms = Date.now() - t0;
          this.deps.health.record(target.providerId, target.modelId, { ok: true, latencyMs: ms, qualityOk: true });
          if (permit === "probe") this.deps.health.resolveProbe(target.providerId, target.modelId, true);
          this.deps.onOutcome?.({
            providerId: target.providerId,
            modelId: target.modelId,
            success: true,
            latencyMs: ms,
            qualityOk: true,
            usage: turn.usage,
          });
          return turn;
        } catch (e) {
          const ms = Date.now() - t0;
          const classified = classifyError(e);
          lastError = classified;
          attempts.push(this.attempt(target, classified.cls, classified.reason, ms));
          if (permit === "probe") this.deps.health.resolveProbe(target.providerId, target.modelId, false);
          // Every failed attempt is an error sample; qualityOk=false only for
          // semantic failures (the "well-formed but wrong" class the breaker
          // must see). Transient/permanent are transport/auth classes.
          const trip = this.deps.health.record(target.providerId, target.modelId, {
            ok: false,
            latencyMs: ms,
            qualityOk: classified.cls === "transient",
          });
          if (trip) this.deps.onTrip?.(trip);
          this.deps.onOutcome?.({
            providerId: target.providerId,
            modelId: target.modelId,
            success: false,
            latencyMs: ms,
            qualityOk: classified.cls === "transient",
          });

          const canRetry =
            classified.cls === "transient" &&
            retry < this.policy.maxInPlaceRetries &&
            sleptMs < this.policy.totalBudgetMs;
          if (!canRetry) break;
          const delay = backoffDelay(retry, this.policy, sleptMs, random);
          if (delay > 0) {
            sleptMs += delay;
            await sleep(delay);
          }
        }
      }
    }

    const pkg: EscalationPackage = {
      schemaVersion: 1,
      decisionId: this.deps.decisionId,
      reason:
        `No viable provider: ${attempts.length} attempt(s) across ${targets.length} target(s) failed. ` +
        `Last failure (${lastError.cls}): ${lastError.reason}`,
      attempts,
      level: "L3_escalation",
      repair: [
        "Run `xr doctor` to check provider health and credentials.",
        "Inspect the circuit breakers: `xr providers health --json`.",
        "Switch or pin a healthy provider: `xr providers set <provider> [model]`.",
        "Re-measure behavioral contracts: `xr providers measure --provider <id>`.",
      ],
      at: Date.now(),
    };
    this.escalate("L3_escalation", "fallback chain exhausted");
    this.deps.onDegradation?.("L3_escalation", "fallback chain exhausted");
    throw new RoutingEscalationError(pkg);
  }

  private attempt(
    target: ResilientTarget,
    cls: FailoverAttempt["errorClass"],
    message: string,
    durationMs: number,
  ): FailoverAttempt {
    return {
      providerId: target.providerId,
      modelId: target.modelId,
      errorClass: cls,
      message: redactSecrets(message),
      durationMs,
      at: Date.now(),
    };
  }

  async health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
    const h = await this.primary.health();
    if (h.ok) return h;
    if (this.chain.length) {
      return { ok: false, latencyMs: h.latencyMs, detail: `primary unhealthy: ${h.detail ?? "no detail"} (resilient chain: ${this.chain.length} step(s))` };
    }
    return h;
  }
}

/** OutcomeSample wiring helper — feeds the historical routing input (G2). */
export function outcomeSampleFor(
  modelClass: ModelClass,
  outcome: {
    providerId: string;
    modelId: string;
    success: boolean;
    latencyMs: number;
    qualityOk: boolean;
    costUsd?: number;
  },
): Parameters<IntelligenceMetrics["record"]>[0] {
  return {
    providerId: outcome.providerId,
    modelId: outcome.modelId,
    modelClass,
    success: outcome.success,
    latencyMs: outcome.latencyMs,
    costUsd: outcome.costUsd,
    structuredOk: outcome.qualityOk,
    at: Date.now(),
  };
}

/** Payload emitted by ResilientProvider.onOutcome (matches ResilientDeps). */
export interface ProviderOutcome {
  providerId: string;
  modelId: string;
  success: boolean;
  latencyMs: number;
  qualityOk: boolean;
  usage?: { inTokens: number; outTokens: number };
}
