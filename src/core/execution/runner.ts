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
import type { MemoryStore } from "../../memory/store.ts";
import type { AuditRepo } from "../../state/repos/audit-repo.ts";
import type { CostRepo } from "../../state/repos/cost-repo.ts";
import type { SessionRepo } from "../../state/repos/session-repo.ts";
import type { UserMemoryRepo } from "../../state/repos/user-memory-repo.ts";
import type { WorkspaceStore } from "../../state/workspace-store.ts";
import { toOutcome, type EnvelopeOutcome, type ExecutionEnvelope } from "./envelope.ts";

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
  };

  const result = await runAgentLoop(intent.task, intent.mode, deps);
  return toOutcome(envelope, result);
}
