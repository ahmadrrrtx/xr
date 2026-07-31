/**
 * XR 6.0 — Placement Engine
 *
 * Selects local/private/remote placement for task capsules based on:
 *   - Privacy / data residency requirements
 *   - Hardware availability
 *   - Latency preferences
 *   - Cost considerations
 *   - Capability availability
 *   - Organization/user policy
 *   - Current worker health
 *
 * Placement decisions are explainable and manually overrideable.
 */

import type {
  PlacementDecision,
  PlacementPolicyInput,
  PlacementExplanation,
  PlacementFactor,
  PlacementOption,
  WorkerIdentity,
  WorkerState,
  DeploymentProfileKind,
  TaskCapsule,
} from "../types.ts";
import type { Placement as ExecPlacement } from "../../../execution/types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Placement Factor Weights (configurable per deployment)
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_WEIGHTS: Record<string, number> = {
  residency_compliance: 1.0,      // Must comply — hard gate
  data_classification: 0.9,       // Data sensitivity matters most after residency
  capability_match: 0.8,          // Worker must have required capabilities
  health_status: 0.7,             // Worker must be healthy
  latency_preference: 0.5,       // Prefer lower latency when possible
  cost_preference: 0.4,          // Prefer lower cost when possible
  hardware_match: 0.3,           // Hardware requirements
  user_preference: 0.6,          // User overrides matter
  availability: 0.5,             // Worker availability/capacity
};

// ═══════════════════════════════════════════════════════════════════════════
// Placement Engine
// ═══════════════════════════════════════════════════════════════════════════

export class PlacementEngine {
  private weights: Record<string, number>;

  constructor(weights?: Record<string, number>) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Make a placement decision for a task capsule.
   */
  decide(input: PlacementPolicyInput): PlacementExplanation {
    const factors: PlacementFactor[] = [];
    const options: PlacementOption[] = [];
    const capsule = input.capsule;

    // ── 1. Hard gates ────────────────────────────────────────────────

    // Check user force-local override
    if (input.userOverrides?.forceLocal) {
      factors.push({
        name: "user_override",
        weight: this.weights.user_preference,
        score: 1.0,
        reason: "User forced local placement",
      });
      return {
        decision: {
          kind: "local",
          reason: "User forced local placement",
          placement: { kind: "in_process" },
        },
        factors,
        alternativeOptions: [],
        policyVersion: "xr-6.0.0/placement-v1",
        decidedAt: Date.now(),
      };
    }

    // Check data residency hard constraints
    const residencyGate = this.checkResidencyGate(capsule, input.currentProfile);
    if (residencyGate.blocked) {
      return {
        decision: {
          kind: "blocked",
          reason: residencyGate.reason,
          remediation: residencyGate.remediation,
        },
        factors: [residencyGate.factor],
        alternativeOptions: [],
        policyVersion: "xr-6.0.0/placement-v1",
        decidedAt: Date.now(),
      };
    }

    // ── 2. Score local placement ─────────────────────────────────────

    const localScore = this.scoreLocalPlacement(capsule, input);
    if (localScore.gatePassed) {
      factors.push(...localScore.factors);
      options.push({
        kind: "local",
        score: localScore.totalScore,
        reasons: localScore.reasons,
      });
    }

    // ── 3. Score remote workers ──────────────────────────────────────

    if (capsule.placement.allowRemote) {
      for (const worker of input.availableWorkers) {
        const workerScore = this.scoreWorkerPlacement(capsule, worker, input);
        if (workerScore.gatePassed) {
          const workerFactors = workerScore.factors;
          factors.push(...workerFactors);
          options.push({
            kind: worker.profile === "managed_cloud" ? "cloud_worker" : "private_worker",
            workerId: worker.workerId,
            score: workerScore.totalScore,
            reasons: workerScore.reasons,
          });
        }
      }
    }

    // ── 4. Check forced worker override ──────────────────────────────

    if (input.userOverrides?.forceWorker) {
      const forced = options.find(o => o.workerId === input.userOverrides?.forceWorker);
      if (forced) {
        return {
          decision: forced.kind === "local"
            ? { kind: "local", reason: "User forced worker placement", placement: { kind: "in_process" } }
            : forced.kind === "cloud_worker"
              ? { kind: "cloud_worker", workerId: forced.workerId!, reason: "User forced worker" }
              : { kind: "private_worker", workerId: forced.workerId!, reason: "User forced worker" },
          factors,
          alternativeOptions: options.filter(o => o !== forced),
          policyVersion: "xr-6.0.0/placement-v1",
          decidedAt: Date.now(),
        };
      }
      // Forced worker not available
      return {
        decision: {
          kind: "blocked",
          reason: `User-forced worker ${input.userOverrides.forceWorker} is not available`,
          remediation: "Check worker health or choose a different worker",
        },
        factors,
        alternativeOptions: options,
        policyVersion: "xr-6.0.0/placement-v1",
        decidedAt: Date.now(),
      };
    }

    // ── 5. Select best option ────────────────────────────────────────

    if (options.length === 0) {
      return {
        decision: {
          kind: "blocked",
          reason: "No suitable placement found — no local or remote option passed gates",
          remediation: "Check worker availability, residency constraints, and capsule requirements",
        },
        factors,
        alternativeOptions: [],
        policyVersion: "xr-6.0.0/placement-v1",
        decidedAt: Date.now(),
      };
    }

    // Prefer local when scores are close (within 10%)
    options.sort((a, b) => b.score - a.score);
    const best = options[0];
    const localOption = options.find(o => o.kind === "local");

    let decision: PlacementDecision;
    if (best.kind === "local") {
      decision = {
        kind: "local",
        reason: "Local placement selected — best overall score",
        placement: { kind: "in_process" },
      };
    } else if (best.kind === "cloud_worker") {
      // Prefer local if score is within 10%
      if (localOption && localOption.score >= best.score * 0.9) {
        decision = {
          kind: "local",
          reason: "Local placement preferred — scores within tolerance",
          placement: { kind: "in_process" },
        };
      } else {
        decision = {
          kind: "cloud_worker",
          workerId: best.workerId!,
          reason: `Cloud worker selected — score ${best.score.toFixed(2)}`,
        };
      }
    } else {
      // private_worker
      if (localOption && localOption.score >= best.score * 0.9) {
        decision = {
          kind: "local",
          reason: "Local placement preferred — scores within tolerance",
          placement: { kind: "in_process" },
        };
      } else {
        decision = {
          kind: "private_worker",
          workerId: best.workerId!,
          reason: `Private worker selected — score ${best.score.toFixed(2)}`,
        };
      }
    }

    return {
      decision,
      factors,
      alternativeOptions: options.filter(o => o !== best),
      policyVersion: "xr-6.0.0/placement-v1",
      decidedAt: Date.now(),
    };
  }

  // ── Scoring helpers ──────────────────────────────────────────────────

  private scoreLocalPlacement(
    capsule: TaskCapsule,
    input: PlacementPolicyInput,
  ): { gatePassed: boolean; totalScore: number; factors: PlacementFactor[]; reasons: string[] } {
    const factors: PlacementFactor[] = [];
    const reasons: string[] = [];
    let totalScore = 0;
    let gatePassed = true;

    // Capsule must allow local
    if (!capsule.placement.allowLocal) {
      return { gatePassed: false, totalScore: 0, factors: [], reasons: ["Capsule does not allow local placement"] };
    }

    // Residency compliance (always passes for local — data stays here)
    const residencyScore = 1.0;
    factors.push({
      name: "residency_compliance",
      weight: this.weights.residency_compliance,
      score: residencyScore,
      reason: "Local placement always satisfies residency",
    });
    totalScore += residencyScore * this.weights.residency_compliance;

    // Data classification — local is always safe for sensitive data
    const classScore = capsule.residency.dataClassification === "restricted" ? 1.0 : 1.0;
    factors.push({
      name: "data_classification",
      weight: this.weights.data_classification,
      score: classScore,
      reason: "Local placement is safe for all data classifications",
    });
    totalScore += classScore * this.weights.data_classification;

    // Capability match — assume local has baseline capabilities
    const localCaps = ["model_call", "core_tool", "control_action", "workflow_task"];
    const requiredCaps = capsule.requirements.capabilities;
    const matchCount = requiredCaps.filter(c => localCaps.includes(c)).length;
    const capScore = requiredCaps.length === 0 ? 1.0 : matchCount / requiredCaps.length;
    factors.push({
      name: "capability_match",
      weight: this.weights.capability_match,
      score: capScore,
      reason: `Local supports ${matchCount}/${requiredCaps.length} required capabilities`,
    });
    totalScore += capScore * this.weights.capability_match;

    // Latency — local is always lowest latency
    factors.push({
      name: "latency_preference",
      weight: this.weights.latency_preference,
      score: 1.0,
      reason: "Local placement has lowest latency",
    });
    totalScore += 1.0 * this.weights.latency_preference;

    // Cost — local is free (no worker cost)
    factors.push({
      name: "cost_preference",
      weight: this.weights.cost_preference,
      score: 1.0,
      reason: "Local placement has no worker cost",
    });
    totalScore += 1.0 * this.weights.cost_preference;

    // Hardware — check GPU requirements
    if (capsule.requirements.hardware?.gpuRequired) {
      // Local may not have GPU
      factors.push({
        name: "hardware_match",
        weight: this.weights.hardware_match,
        score: 0.5,
        reason: "Local GPU availability unknown",
      });
      totalScore += 0.5 * this.weights.hardware_match;
    }

    reasons.push("Local placement evaluated");
    return { gatePassed, totalScore: Math.min(totalScore, 1.0), factors, reasons };
  }

  private scoreWorkerPlacement(
    capsule: TaskCapsule,
    worker: WorkerIdentity,
    input: PlacementPolicyInput,
  ): { gatePassed: boolean; totalScore: number; factors: PlacementFactor[]; reasons: string[] } {
    const factors: PlacementFactor[] = [];
    const reasons: string[] = [];
    let totalScore = 0;
    let gatePassed = true;

    // Excluded workers
    if (input.userOverrides?.excludeWorkers?.includes(worker.workerId)) {
      return { gatePassed: false, totalScore: 0, factors: [], reasons: ["Worker excluded by user"] };
    }

    // Worker state gate — must be active
    if (worker.state !== "active") {
      return {
        gatePassed: false,
        totalScore: 0,
        factors: [],
        reasons: [`Worker state is ${worker.state}, not active`],
      };
    }

    // Residency compliance — check worker regions
    const workerRegion = this.getWorkerRegion(worker);
    const residencyOk = capsule.residency.allowedRegions.length === 0 ||
      capsule.residency.allowedRegions.includes(workerRegion) ||
      workerRegion === "local";
    const residencyForbidden = capsule.residency.forbiddenRegions.includes(workerRegion);

    if (residencyForbidden) {
      return {
        gatePassed: false,
        totalScore: 0,
        factors: [],
        reasons: [`Worker region ${workerRegion} is forbidden by residency policy`],
      };
    }

    const residencyScore = residencyOk ? 1.0 : 0.0;
    factors.push({
      name: "residency_compliance",
      weight: this.weights.residency_compliance,
      score: residencyScore,
      reason: residencyOk
        ? `Worker region ${workerRegion} complies with residency policy`
        : `Worker region ${workerRegion} does not comply`,
    });
    totalScore += residencyScore * this.weights.residency_compliance;
    if (residencyScore === 0) gatePassed = false;

    // Data classification — restricted data on non-local workers is risky
    let classScore = 1.0;
    if (capsule.residency.dataClassification === "restricted") {
      classScore = worker.profile === "managed_cloud" ? 0.3 : 0.8;
    } else if (capsule.residency.dataClassification === "confidential") {
      classScore = worker.profile === "managed_cloud" ? 0.6 : 0.9;
    }
    factors.push({
      name: "data_classification",
      weight: this.weights.data_classification,
      score: classScore,
      reason: `Data classification ${capsule.residency.dataClassification} on ${worker.profile}`,
    });
    totalScore += classScore * this.weights.data_classification;

    // Capability match
    const requiredCaps = capsule.requirements.capabilities;
    const workerCaps = worker.capabilities;
    const matchCount = requiredCaps.filter(c => workerCaps.includes(c)).length;
    const capScore = requiredCaps.length === 0 ? 1.0 : matchCount / requiredCaps.length;
    if (matchCount < requiredCaps.length) {
      gatePassed = false; // Must have all required capabilities
    }
    factors.push({
      name: "capability_match",
      weight: this.weights.capability_match,
      score: capScore,
      reason: `Worker supports ${matchCount}/${requiredCaps.length} required capabilities`,
    });
    totalScore += capScore * this.weights.capability_match;

    // Health status
    const healthReport = input.currentWorkerHealth.find(
      h => input.availableWorkers.find(w => w.workerId === worker.workerId)
    );
    const healthScore = healthReport?.ok !== false ? 1.0 : 0.0;
    factors.push({
      name: "health_status",
      weight: this.weights.health_status,
      score: healthScore,
      reason: healthScore === 1.0 ? "Worker health is OK" : "Worker health is degraded",
    });
    totalScore += healthScore * this.weights.health_status;

    // Hardware match
    if (capsule.requirements.hardware?.gpuRequired) {
      const gpuScore = worker.hardwareProfile?.gpuAvailable ? 1.0 : 0.0;
      if (gpuScore === 0) gatePassed = false;
      factors.push({
        name: "hardware_match",
        weight: this.weights.hardware_match,
        score: gpuScore,
        reason: gpuScore === 1.0 ? "Worker has GPU" : "Worker lacks GPU",
      });
      totalScore += gpuScore * this.weights.hardware_match;
    }

    // Preference for region
    if (input.userOverrides?.preferRegion && workerRegion === input.userOverrides.preferRegion) {
      factors.push({
        name: "user_preference",
        weight: this.weights.user_preference,
        score: 1.0,
        reason: "Worker matches user preferred region",
      });
      totalScore += 1.0 * this.weights.user_preference;
    }

    reasons.push(`Worker ${worker.workerId} evaluated`);
    return { gatePassed, totalScore: Math.min(totalScore, 1.0), factors, reasons };
  }

  private checkResidencyGate(
    capsule: TaskCapsule,
    currentProfile: DeploymentProfileKind,
  ): { blocked: boolean; reason: string; remediation?: string; factor: PlacementFactor } {
    // Must-not-leave-origin check
    if (capsule.residency.mustNotLeaveOrigin) {
      if (currentProfile !== capsule.provenance.originProfile) {
        return {
          blocked: true,
          reason: "Capsule must not leave origin deployment profile",
          remediation: `Execute this task in ${capsule.provenance.originProfile} profile`,
          factor: {
            name: "residency_compliance",
            weight: this.weights.residency_compliance,
            score: 0,
            reason: "mustNotLeaveOrigin violated",
          },
        };
      }
    }

    return {
      blocked: false,
      reason: "Residency gate passed",
      factor: {
        name: "residency_compliance",
        weight: this.weights.residency_compliance,
        score: 1.0,
        reason: "Residency constraints satisfied",
      },
    };
  }

  private getWorkerRegion(worker: WorkerIdentity): string {
    // Workers don't have an explicit region in their identity;
    // derive from profile or endpoint
    if (worker.networkEndpoint) {
      return worker.networkEndpoint.host;
    }
    return "local";
  }
}
