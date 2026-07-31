/**
 * XR Phase 2 · T1 — THE EXECUTION ENVELOPE.
 *
 * Constitution Art. VI.3: *"The Runtime provides ONE execution envelope, ONE
 * placement authority, ONE durable-execution path, ONE provider/model plane,
 * ONE context engine, ONE workflow substrate."*
 * Art. VI Violations: *"A surface calling `runAgent` directly, bypassing the
 * service."*
 *
 * ── The defect this closes ──────────────────────────────────────────────────
 *
 * Before Phase 2 there were four entry points into agent execution:
 *
 *   src/services/agent-service.ts:258   ← the intended one
 *   src/interfaces/shell/app.ts:564     ← direct runAgent()
 *   src/telegram/bot.ts:179             ← direct runAgent()
 *   src/voice/pipeline.ts:155           ← direct runAgent()
 *
 * Phase 0 · T8 bridged the *tools* for the three surfaces (the extensibility
 * bridge) but explicitly deferred execution unification to Phase 2. The result
 * was observable drift: only the `AgentService` path assembled a scoped context
 * package, audited the routing decision, and used the typed repos — the three
 * interactive surfaces hand-built `AgentDeps` and got none of it.
 *
 * ── The canonical lifecycle ─────────────────────────────────────────────────
 *
 *   intent → plan → policy → placement → action → observation → evidence → outcome
 *
 * Every consequential action flows through these phases. The envelope is the
 * ONLY caller of the agent loop; `runAgentLoop` is not exported as an entry
 * point and an architectural test fails the build if any module outside
 * `src/core/execution/` imports it.
 *
 * The envelope does not re-implement the loop, the policy gate, the router or
 * the registry — it SEQUENCES them. That is what makes it a choke point worth
 * governing (Art. IX/XIV) rather than a fifth engine.
 */

import { randomUUID } from "node:crypto";
import type { ApprovalRequest, Mode, Provider, Tool } from "../types.ts";
import type { ToolRegistryService } from "../../tools/registry-service.ts";
import type { ToolCollision } from "../../tools/registry-types.ts";

/** The eight canonical phases, in order. */
export const ENVELOPE_PHASES = [
  "intent",
  "plan",
  "policy",
  "placement",
  "action",
  "observation",
  "evidence",
  "outcome",
] as const;

export type EnvelopePhase = (typeof ENVELOPE_PHASES)[number];

/** Where the work was placed. Phase 2 unifies the record; Phase 4 owns isolation. */
export type Placement = "in_process" | "worker" | "container";

/** Which surface originated the request. Recorded on every envelope. */
export type SurfaceId = "cli" | "shell" | "telegram" | "voice" | "daemon" | "workflow" | "test";

/**
 * INTENT — what the human asked for, and on whose authority.
 * Authority is carried explicitly because intelligence never grants it (P5).
 */
export interface EnvelopeIntent {
  readonly task: string;
  readonly mode: Mode;
  readonly surface: SurfaceId;
  readonly cwd: string;
  /** Agent role for context scoping and audit attribution. */
  readonly agentRole?: string;
  readonly taskId?: string;
  readonly runId?: string;
}

/** PLAN — the model/provider selection and step budget for this run. */
export interface EnvelopePlan {
  readonly provider: Provider;
  readonly providerId: string;
  readonly modelId: string;
  readonly maxSteps: number;
  readonly systemPrompt?: string;
  /** Secret-free routing decision from the single routing authority. */
  readonly routingDecision?: import("../../intelligence/types.ts").RoutingDecision;
}

/** POLICY — the constraints the run may not exceed. Ambiguity denies (Art. IV.4). */
export interface EnvelopePolicy {
  readonly budget: { maxUsd?: number; maxTokens?: number };
  readonly pricing: { inPerMTok: number; outPerMTok: number };
  readonly egressAllowlist: readonly string[];
  readonly dryRun: boolean;
  readonly toolsAllow?: readonly string[];
  readonly toolsDeny?: readonly string[];
  readonly approve: (req: ApprovalRequest) => Promise<boolean>;
}

/** PLACEMENT — where the action runs. Phase 2 records it; Phase 4 enforces tiers. */
export interface EnvelopePlacement {
  readonly placement: Placement;
  /** The one registry every surface discovers through. */
  readonly registry: ToolRegistryService;
  readonly tools: readonly Tool[];
  readonly collisions: readonly ToolCollision[];
}

/** OBSERVATION — what the run reported back while it ran. */
export interface EnvelopeObservation {
  readonly say: (line: string) => void;
  readonly onOverBudget?: (
    meter: string,
    reason: string,
  ) => Promise<{ usd?: number; tokens?: number } | null>;
}

/** EVIDENCE — the durable record trail. Never optional, never best-effort silent. */
export interface EnvelopeEvidence {
  readonly envelopeId: string;
  readonly startedAt: number;
  /** Diagnostics accumulated while assembling the envelope (degradations). */
  readonly diagnostics: readonly string[];
}

/** OUTCOME — the verified result. Effects, not transitions (Art. III.4). */
export interface EnvelopeOutcome {
  readonly sessionId: string;
  readonly finalMessage: string;
  readonly steps: number;
  readonly stopped: "done" | "max_steps" | "error" | "budget" | "approval";
  readonly meter?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly routingDecisionId?: string;
  readonly envelopeId: string;
  readonly surface: SurfaceId;
  readonly placement: Placement;
  readonly durationMs: number;
}

/**
 * The assembled envelope. Construction is the only way to obtain one, and
 * `AgentService.execute()` is the only thing that consumes one.
 */
export interface ExecutionEnvelope {
  readonly intent: EnvelopeIntent;
  readonly plan: EnvelopePlan;
  readonly policy: EnvelopePolicy;
  readonly placement: EnvelopePlacement;
  readonly observation: EnvelopeObservation;
  readonly evidence: EnvelopeEvidence;
}

/** Allocate the envelope identity + evidence header. */
export function newEvidence(diagnostics: readonly string[] = []): EnvelopeEvidence {
  return {
    envelopeId: `env_${randomUUID().slice(0, 12)}`,
    startedAt: Date.now(),
    diagnostics: [...diagnostics],
  };
}

/**
 * Assemble an envelope from its phases. Kept as a function (not a class) so the
 * envelope stays a plain, inspectable value — an architectural test walks it.
 */
export function assembleEnvelope(parts: {
  intent: EnvelopeIntent;
  plan: EnvelopePlan;
  policy: EnvelopePolicy;
  placement: EnvelopePlacement;
  observation: EnvelopeObservation;
  evidence?: EnvelopeEvidence;
}): ExecutionEnvelope {
  return {
    intent: parts.intent,
    plan: parts.plan,
    policy: parts.policy,
    placement: parts.placement,
    observation: parts.observation,
    evidence: parts.evidence ?? newEvidence(),
  };
}

/** Build the OUTCOME phase from a completed run. */
export function toOutcome(
  envelope: ExecutionEnvelope,
  result: {
    sessionId: string;
    finalMessage: string;
    steps: number;
    stopped: EnvelopeOutcome["stopped"];
    meter?: string;
    inputTokens?: number;
    outputTokens?: number;
    routingDecisionId?: string;
  },
): EnvelopeOutcome {
  return {
    ...result,
    envelopeId: envelope.evidence.envelopeId,
    surface: envelope.intent.surface,
    placement: envelope.placement.placement,
    durationMs: Date.now() - envelope.evidence.startedAt,
  };
}
