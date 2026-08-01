/**
 * XR 4.2 — Trust Service
 *
 * Orchestrates the policy-to-placement lifecycle for a single action:
 *
 *   Action Request → Risk Classification → (permissions/approval already done
 *   by the fabric) → Placement Decision → Authority Grant → Environment
 *   Admission → Verification → Execution → Cleanup → Record.
 *
 * Tier 0 returns control to the fabric's fast in-process path. Tier 1/2 are
 * dispatched into an environment. When required isolation is unavailable or
 * verification fails, the action is BLOCKED (fail closed) — it is never run in
 * the unrestricted host process.
 */
import type { ExecutionObservation } from "../../execution/types.ts";
import { AuthorityRegistry, createGrant } from "./authority.ts";
import { classifyRisk } from "./classify.ts";
import type { CredentialBroker } from "./credentials.ts";
import type { EnvironmentManager } from "./environment/manager.ts";
import {
  decidePlacement,
  decidePlacementForTier,
  type PlacementPolicyConfig,
} from "./policy.ts";
import { effectiveTier, mergePlacements } from "./lattice.ts";
import {
  TRUST_POLICY_VERSION,
  type AuthorityGrant,
  type CredentialRef,
  type EnvironmentExecutable,
  type PlacementKind,
  type RiskClassification,
  type RiskTier,
  type TrustRecord,
  type TrustRequest,
} from "./types.ts";

export type TrustOutcome =
  | { kind: "in_process_ok" }
  | { kind: "ran_in_environment"; observation: ExecutionObservation }
  | { kind: "blocked"; reason: string; remediation?: string };

export interface TrustEvaluation {
  trust: TrustRecord;
  outcome: TrustOutcome;
}

export interface EvaluateParams {
  request: TrustRequest;
  runId: string;
  correlationId: string;
  workspaceId: string;
  actor: string;
  capability: string;
  approvalRef?: string;
  executable?: EnvironmentExecutable;
  credentialRefs?: readonly CredentialRef[];
}

export interface TrustServiceDeps {
  manager: EnvironmentManager;
  registry: AuthorityRegistry;
  broker: CredentialBroker;
  config?: PlacementPolicyConfig;
  /**
   * Phase 4 · T1 — hardened-mode resolver (lazy, so the trust service never
   * depends on the config service). Defaults to true (fail-closed).
   */
  hardened?: () => boolean;
}

export class TrustService {
  /**
   * Phase 4 · T1 — per-run escalate-only state.
   *
   * Once a run has executed at tier X (or a capability declared minimum X),
   * every later action in the same run is evaluated at max(classified, X):
   * agents/capabilities may only ESCALATE isolation within a run, never
   * downgrade (Art. IX.2). `runPlacements` tracks the strongest placement
   * actually enforced so the execution envelope can record the truth.
   */
  private readonly runTiers = new Map<string, RiskTier>();
  private readonly runPlacements = new Map<string, PlacementKind>();

  constructor(private readonly deps: TrustServiceDeps) {}

  /** True when hardened mode is active (fail-closed everywhere). */
  get hardened(): boolean {
    if (this.deps.hardened) return this.deps.hardened();
    return this.deps.config?.hardened ?? true;
  }

  /** The effective placement policy config (hardened folded in). */
  private placementConfig(): PlacementPolicyConfig {
    return { ...this.deps.config, hardened: this.hardened };
  }

  /** The most restrictive tier this run has reached (or tier0). */
  escalatedTier(runId: string): RiskTier {
    return this.runTiers.get(runId) ?? "tier0_in_process";
  }

  /** The strongest placement actually enforced this run (or in_process). */
  runPlacement(runId: string): PlacementKind {
    return this.runPlacements.get(runId) ?? "in_process";
  }

  /** Forget per-run escalation state (end of run). */
  releaseRun(runId: string): void {
    this.runTiers.delete(runId);
    this.runPlacements.delete(runId);
  }

  /**
   * Merge an already-enforced placement into the run's record. Used when a
   * tool executes through the fabric with an explicit placement that bypassed
   * evaluate() (e.g. host-authority elevated gates): the recorded run
   * placement must still reflect the strongest boundary actually applied.
   */
  noteRunPlacement(runId: string, placement: PlacementKind): void {
    const current = this.runPlacements.get(runId);
    this.runPlacements.set(runId, current === undefined ? placement : mergePlacements(current, placement));
  }

  // ── Lifecycle (registered as a kernel lifecycle participant) ────────────

  /** Detect available isolation backends. Runs once at kernel init. */
  async onInit(): Promise<void> {
    await this.deps.manager.init();
  }

  /** Idempotent readiness check (used by lazy consumers like the daemon). */
  async ensureReady(): Promise<void> {
    await this.deps.manager.init();
  }

  async onStart(): Promise<void> {
    // Ready to admit executions once backends are detected.
  }

  /** Revoke lingering credentials on shutdown. */
  async onStop(): Promise<void> {
    await this.deps.manager.shutdown();
  }

  /** Safe health snapshot (no secrets, no sensitive paths). */
  health(): {
    ready: boolean;
    backends: import("./environment/manager.ts").BackendAvailability[];
    activeEnvironments: number;
    cleanupFailures: number;
    quarantined: number;
    activeCredentials: number;
    activeGrants: number;
  } {
    return { ...this.deps.manager.health(), activeGrants: this.deps.registry.activeCount() };
  }

  /** Revoke all grants for a workspace (e.g. on workspace switch). */
  revokeWorkspace(workspaceId: string, reason = "workspace_switch"): number {
    return this.deps.registry.revokeWorkspace(workspaceId, reason);
  }

  /** Classify only (for UX/CLI pre-action summaries). */
  classify(request: TrustRequest): RiskClassification {
    return classifyRisk(request);
  }

  /** Current host placement capabilities (which backends are usable). */
  capabilities(): import("./policy.ts").PlacementCapabilities {
    return this.deps.manager.capabilities();
  }

  /** Classify + decide placement (no execution). For pre-action UX/summaries. */
  decide(request: TrustRequest): { classification: RiskClassification; decision: import("./types.ts").PlacementDecision } {
    const classification = classifyRisk(request);
    // Phase 4 · T1 — the lattice applies even to the pre-action summary: a
    // capability-declared minimum tier is folded in so the user sees the
    // EFFECTIVE placement, never a downgraded one.
    const tier = effectiveTier(classification.tier, request.minimumTier, undefined);
    const decision =
      tier === classification.tier
        ? decidePlacement(classification, this.deps.manager.capabilities(), this.placementConfig())
        : decidePlacementForTier(tier, this.deps.manager.capabilities(), this.placementConfig());
    return { classification, decision };
  }

  async evaluate(params: EvaluateParams): Promise<TrustEvaluation> {
    const { manager, registry, broker } = this.deps;
    let classification = classifyRisk(params.request);

    // Phase 4 · T1 — escalate-only lattice merge: effective tier = max(
    // classifier tier, capability-declared minimum, run-escalated tier).
    const escalated = this.runTiers.get(params.runId) ?? "tier0_in_process";
    const tier = effectiveTier(classification.tier, params.request.minimumTier, escalated);
    if (tier !== classification.tier) {
      // Lattice raised the bar: re-derive the classification record's tier so
      // the audit shows the EFFECTIVE tier, and decisions follow it.
      classification = {
        ...classification,
        tier,
        reasons: [
          ...classification.reasons,
          `lattice escalation: effective ${tier} (classified ${classification.tier}${
            (params.request.minimumTier && params.request.minimumTier !== classification.tier)
              ? `, capability declares ${params.request.minimumTier}`
              : ""
          }${escalated !== "tier0_in_process" ? `, run escalated to ${escalated}` : ""})`,
        ],
      };
    }

    const baseTrust = {
      classification: {
        tier: classification.tier,
        reasons: classification.reasons,
        requiredApprovalLevel: classification.requiredApprovalLevel,
        classifierVersion: classification.classifierVersion,
      },
    } as const;

    // 0. Host-authority short-circuit. Actions that legitimately require host
    //    authority (GUI / computer-use / host browser) are inherently host-bound
    //    and CANNOT run in a sandbox. They are admitted in-process with an
    //    explicit elevated gate — REGARDLESS of whether an isolation backend
    //    exists — while still classified high-risk for approval/audit. This must
    //    precede the placement decision so it is not mistaken for a
    //    "no backend → blocked" case on hosts without a sandbox (e.g. Windows).
    if (params.request.requiresHostAuthority) {
      const hostDecision = {
        kind: "admitted" as const,
        requestedTier: classification.tier,
        placement: "in_process" as const,
        reason: "host-authority action (cannot be isolated): admitted in-process with elevated human gate + full audit",
        remediation: "Ensure elevated approval and review; this action retains host authority by necessity.",
        decidedAt: Date.now(),
        policyVersion: TRUST_POLICY_VERSION,
      };
      // The run has used host authority: escalate the run tier so no later
      // action can pretend the run never touched the host (escalate-only).
      this.runTiers.set(params.runId, classification.tier);
      return {
        trust: { ...baseTrust, decision: hostDecision },
        outcome: { kind: "in_process_ok" },
      };
    }

    // 1. Placement decision (fail-closed for unavailable high-risk isolation).
    //    The decision follows the EFFECTIVE (lattice-merged) tier.
    const decision =
      classification.tier === baseTrust.classification.tier
        ? decidePlacement(classification, manager.capabilities(), this.placementConfig())
        : decidePlacementForTier(classification.tier, manager.capabilities(), this.placementConfig());

    // 2. Record the escalation BEFORE any outcome so the run lattice is
    //    monotone: this action's tier now bounds every later action.
    this.runTiers.set(params.runId, tier);

    // 2b. Tier 0 → hand back to the fabric's fast in-process path.
    if (decision.kind === "in_process_ok") {
      return {
        trust: { ...baseTrust, decision },
        outcome: { kind: "in_process_ok" },
      };
    }

    // 3. Blocked → record and refuse.
    if (decision.kind === "blocked") {
      return {
        trust: { ...baseTrust, decision, quarantined: false },
        outcome: { kind: "blocked", reason: decision.reason, remediation: decision.remediation },
      };
    }

    // 4. Admitted, but the adapter provided no isolated-executable form.
    //    (requiresHostAuthority was already handled in step 0.)
    if (!params.executable) {
      // 4a. Sandboxable HIGH-RISK work (shell/code) MUST be isolated. With no
      //     executable there is no isolated path → FAIL CLOSED (never in-process).
      if (classification.tier === "tier2_isolated") {
        const reason = `action classified ${classification.tier} requires an isolated execution path, but the adapter provided none (refusing in-process execution)`;
        return {
          trust: {
            ...baseTrust,
            decision: { ...decision, kind: "blocked", reason },
          },
          outcome: { kind: "blocked", reason, remediation: "Adapter must supply an EnvironmentExecutable for high-risk actions." },
        };
      }
      // 4b. Tier-1 (medium-risk, capability-confined) runs in-process with an
      //     EXPLICIT, RECORDED policy-only boundary decision. Not a silent
      //     downgrade of high-risk work — the capability does its own confinement.
      return {
        trust: {
          ...baseTrust,
          decision: {
            ...decision,
            kind: "admitted",
            placement: "in_process",
            reason: "tier1 policy-only boundary (in-process; capability performs its own confinement)",
            remediation: "Provide an EnvironmentExecutable to enforce a real OS boundary.",
          },
        },
        outcome: { kind: "in_process_ok" },
      };
    }

    // 5. Authority grant (task-scoped, bounded, revocable).
    const grant: AuthorityGrant = createGrant(
      {
        actor: params.actor,
        executionId: params.runId,
        correlationId: params.correlationId,
        workspaceId: params.workspaceId,
        capability: params.capability,
        approvalRef: params.approvalRef,
      },
      classification,
    );
    if (params.credentialRefs && params.credentialRefs.length > 0) {
      grant.credentials = broker.scopeFor(params.credentialRefs, classification.requiredCredentialMode);
    }
    registry.register(grant);

    try {
      const exec = await manager.executeInEnvironment({ decision, exec: params.executable, grant });

      if (exec.blocked) {
        return {
          trust: {
            ...baseTrust,
            decision: { ...decision, kind: "blocked", reason: exec.reason, remediation: exec.remediation },
            authorityGrantId: grant.grantId,
            credentialScope: grant.credentials,
            resources: grant.resources,
            verification: exec.verification,
            quarantined: false,
          },
          outcome: { kind: "blocked", reason: exec.reason, remediation: exec.remediation },
        };
      }

      const { result, verification, cleanup, environmentId, quarantined } = exec.output;
      // Phase 4 · T1 — the run's recorded placement merges this action's
      // enforced placement (escalate-only, monotone within the run).
      this.noteRunPlacement(params.runId, decision.placement);
      const observation = toObservation(result, broker, {
        placement: decision.placement,
        environmentId,
        tier: classification.tier,
      });

      return {
        trust: {
          ...baseTrust,
          decision: { ...decision, environmentId },
          authorityGrantId: grant.grantId,
          credentialScope: grant.credentials,
          resources: grant.resources,
          verification,
          cleanup,
          quarantined,
        },
        outcome: { kind: "ran_in_environment", observation },
      };
    } finally {
      // Always revoke the grant; never let authority outlive the action.
      registry.revoke(grant.grantId, "execution finished");
      registry.prune();
    }
  }
}

function toObservation(
  result: import("./types.ts").EnvironmentRunResult,
  broker: CredentialBroker,
  meta: { placement: string; environmentId: string; tier: string },
): ExecutionObservation {
  const stdout = broker.redact(result.stdout);
  const stderr = broker.redact(result.stderr);
  const summary =
    result.timedOut
      ? `isolated execution timed out (${meta.placement})`
      : result.ok
        ? `isolated execution succeeded via ${meta.placement}`
        : `isolated execution failed via ${meta.placement} (exit=${result.exitCode})`;
  const logs = stderr
    .split("\n")
    .filter((l) => l.length > 0)
    .slice(0, 10);
  return {
    summary,
    transportOk: result.ok,
    statusCode: result.exitCode ?? undefined,
    outputBytes: stdout.length + stderr.length,
    logs,
    meta: {
      placement: meta.placement,
      environmentId: meta.environmentId,
      tier: meta.tier,
      timedOut: result.timedOut,
      outputTruncated: result.outputTruncated,
      boundaryEvent: result.boundaryEvent,
      stdout: stdout.slice(0, 4000),
    },
    modelFeedback: stdout.slice(0, 4000),
  };
}
