/**
 * XR Phase 2 · T1 — the envelope runner: the SOLE caller of the agent loop.
 *
 * `src/core/agent.ts` exports the loop. This module is the only place in the
 * codebase permitted to invoke it, and `test/core/no-bypass.test.ts` fails the
 * build if that ever stops being true.
 *
 * Everything here is translation, not policy: the envelope's already-decided
 * phases are mapped onto the loop's `AgentDeps` shape. No decision is made or
 * re-made at this layer — that is what keeps the envelope a single authority
 * rather than a second one.
 */

import { runAgentLoop, type AgentDeps } from "../agent.ts";
import type { ContextPackage } from "../../context/types.ts";
import type { MemoryStore } from "../../context/memory/store.ts";
import type { AuditRepo } from "../../state/repos/audit-repo.ts";
import type { CostRepo } from "../../state/repos/cost-repo.ts";
import type { SessionRepo } from "../../state/repos/session-repo.ts";
import type { UserMemoryRepo } from "../../state/repos/user-memory-repo.ts";
import type { WorkspaceStore } from "../../state/workspace-store.ts";
import { toOutcome, type EnvelopeOutcome, type ExecutionEnvelope, type Placement } from "./envelope.ts";

/**
 * Stores the envelope writes its EVIDENCE through. Supplied by the caller so
 * the envelope never opens a connection (Phase 1 single-writer invariant).
 */
export interface EnvelopeStores {
  readonly store?: WorkspaceStore;
  readonly sessionStore?: SessionRepo;
  readonly auditStore?: AuditRepo;
  readonly costStore?: CostRepo;
  readonly userMemoryStore?: UserMemoryRepo;
}

/** Context/memory wiring for the run. */
export interface EnvelopeContext {
  readonly memory?: { enabled: boolean; recallLimit?: number; semantic?: boolean };
  readonly memoryStore?: MemoryStore;
  readonly sessionSummary?: { enabled: boolean; minTurns?: number };
  readonly contextPackage?: ContextPackage;
  readonly contextMode?: "legacy" | "context" | "both";
  /**
   * Phase 4 · T1 — the Trust service. When supplied, the loop wires
   * `runIsolated` into every tool context and the OUTCOME's recorded
   * placement reflects the strongest placement the trust gate actually
   * enforced during the run (never a label the run did not earn).
   */
  readonly trust?: import("../../runtime/trust/service.ts").TrustService;
  /** Phase 4 · T1 — hardened mode flag (fail-closed for high-risk tools). */
  readonly hardened?: boolean;
  /** Phase 4 · T4 — explicit raw-IP/loopback destinations (local runtimes). */
  readonly allowedHosts?: readonly string[];
  /**
   * Phase 7 · T1 — optional tool-use recorder forwarded to every tool call of
   * the run (feeds the capability provenance graph). Plain callback type:
   * the kernel stays free of platform imports; the wire-up lives in the
   * caller (AgentService) which resolves it from the service registry.
   */
  readonly onToolUse?: (info: { tool: string; ok: boolean; error?: string }) => void;
  /**
   * Phase 05 — canonical streaming event sink, forwarded to the loop so token
   * / tool_call / tool_result / status / usage events reach the surface.
   */
  readonly onStreamEvent?: import("../types.ts").StreamEventSink;
  /**
   * Phase 6 — orchestration-plane passthrough wiring (see AgentDeps).
   */
  readonly partition?: import("../../cost/governor.ts").PartitionRef;
  readonly sessionId?: string;
  readonly resumeFrom?: import("../agent.ts").ResumeFrom;
  readonly checkpointSink?: (kind: string, payload: Record<string, unknown>) => void;
  readonly taskLedger?: import("../../execution/task-runtime.ts").TaskRunLedger;
  readonly agentIdentity?: import("../../agents/identity.ts").AgentIdentity;
  /**
   * A-19 — cooperative cancellation for this run, forwarded to the loop.
   * Surfaces abort their own runs (Shell Ctrl+C/Esc, `xr run` SIGINT, workflow
   * stop); the loop observes the signal at its checkpoints.
   */
  readonly signal?: AbortSignal;
}

/**
 * Execute an assembled envelope.
 *
 * The ACTION phase runs the loop; OBSERVATION streams through
 * `envelope.observation.say`; EVIDENCE is written by the loop into the audit /
 * session / cost repos; OUTCOME is returned as a typed, effect-bearing record.
 */
export async function runEnvelope(
  envelope: ExecutionEnvelope,
  stores: EnvelopeStores,
  context: EnvelopeContext = {},
): Promise<EnvelopeOutcome> {
  const { intent, plan, policy, placement, observation } = envelope;

  const deps: AgentDeps = {
    provider: plan.provider,
    ...(stores.store ? { store: stores.store } : {}),
    ...(stores.sessionStore ? { sessionStore: stores.sessionStore } : {}),
    ...(stores.auditStore ? { auditStore: stores.auditStore } : {}),
    ...(stores.costStore ? { costStore: stores.costStore } : {}),
    ...(stores.userMemoryStore ? { userMemoryStore: stores.userMemoryStore } : {}),
    cwd: intent.cwd,
    ...(plan.systemPrompt ? { systemPrompt: plan.systemPrompt } : {}),
    say: observation.say,
    approve: policy.approve,
    ...(observation.onOverBudget ? { onOverBudget: observation.onOverBudget } : {}),
    budget: { ...policy.budget },
    pricing: { ...policy.pricing },
    // Phase 2 · F-06 — real deny-lists reach the loop from workspace config.
    ...(policy.deniedPermissions ? { deniedPermissions: policy.deniedPermissions } : {}),
    maxSteps: plan.maxSteps,
    egressAllowlist: [...policy.egressAllowlist],
    dryRun: policy.dryRun,
    ...(context.memory ? { memory: { ...context.memory } } : {}),
    ...(context.memoryStore ? { memoryStore: context.memoryStore } : {}),
    ...(context.sessionSummary ? { sessionSummary: { ...context.sessionSummary } } : {}),
    ...(context.contextPackage ? { contextPackage: context.contextPackage } : {}),
    ...(context.contextMode ? { contextMode: context.contextMode } : {}),
    ...(plan.routingDecision ? { routingDecision: plan.routingDecision } : {}),
    /**
     * Phase 2 · T1+T2 — the loop receives the ALREADY-ARBITRATED tool set from
     * the one registry, plus the registry itself so it can resolve a call by
     * qualified id. It no longer merges `extraTools` by hand, which is what
     * made bare-name collisions resolvable two different ways.
     */
    toolRegistry: placement.registry,
    envelopeId: envelope.evidence.envelopeId,
    surface: intent.surface,
    // Phase 4 · T1 — enforce placement on the canonical path: the loop wires
    // the Trust service into every tool context and carries hardened mode.
    ...(context.trust ? { trust: context.trust } : {}),
    ...(context.hardened !== undefined ? { hardened: context.hardened } : {}),
    ...(context.allowedHosts ? { allowedHosts: context.allowedHosts } : {}),
    ...(context.onToolUse ? { onToolUse: context.onToolUse } : {}),
    ...(context.onStreamEvent ? { onStreamEvent: context.onStreamEvent } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
    runId: envelope.evidence.envelopeId,
    // Phase 6 — orchestration-plane wiring, passed through untouched: the
    // envelope assembles it, the loop consumes it, the runner forwards.
    ...(context.partition ? { partition: context.partition } : {}),
    sessionId: context.sessionId,
    ...(context.resumeFrom ? { resumeFrom: context.resumeFrom } : {}),
    ...(context.checkpointSink ? { checkpointSink: context.checkpointSink } : {}),
    ...(context.taskLedger ? { taskLedger: context.taskLedger } : {}),
    ...(context.agentIdentity ? { agentIdentity: context.agentIdentity } : {}),
  };

  const result = await runAgentLoop(intent.task, intent.mode, deps);
  const outcome = toOutcome(envelope, result);
  // Phase 4 · T1 — the recorded placement is the strongest placement the trust
  // gate actually enforced this run (escalate-only lattice), not a label.
  if (context.trust) {
    const enforced = context.trust.runPlacement(envelope.evidence.envelopeId);
    context.trust.releaseRun(envelope.evidence.envelopeId);
    return { ...outcome, placement: toEnvelopePlacement(enforced) };
  }
  return outcome;
}

/**
 * Map the trust lattice's placement onto the envelope's coarse Placement
 * union (Phase 2 shape; the fine-grained kind lives in the trust record).
 * Any OS-enforced boundary is "container"-class for the envelope's purposes.
 */
function toEnvelopePlacement(kind: import("../../runtime/trust/types.ts").PlacementKind): Placement {
  switch (kind) {
    case "in_process":
      return "in_process";
    case "restricted_process":
      return "worker";
    default:
      return "container";
  }
}
