/**
 * XR 7.0 — Longitudinal comparison and regression detection (Phase 13).
 *
 * Rules:
 *   - Never compare incompatible runs. Different scenario registries,
 *     deployment profiles, or locality policies produce different meanings.
 *   - Security and privacy regressions are ALWAYS critical, regardless of
 *     quality improvements elsewhere.
 *   - Scenarios present in only one run are reported, never silently dropped.
 *   - Overfitting is detectable: if the development set improves while the
 *     independent set does not, say so.
 */

import {
  isGatingDimension,
  type ComparisonResult,
  type EvaluationRun,
  type RegressionFinding,
  type RegressionKind,
  type ScenarioResult,
  type ScenarioStatus,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Comparability
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determine whether two runs may be compared at all.
 *
 * This is deliberately strict. A benchmark comparison across mismatched
 * configurations is worse than no comparison, because it looks authoritative.
 */
export function checkComparable(baseline: EvaluationRun, candidate: EvaluationRun): string[] {
  const reasons: string[] = [];

  if (baseline.provenance.registryDigest !== candidate.provenance.registryDigest) {
    reasons.push(
      "scenario registries differ — one run used different scenario definitions, so per-scenario comparison " +
        "is only valid for scenarios whose id AND version match",
    );
  }
  if (baseline.provenance.configuration.deploymentProfile !== candidate.provenance.configuration.deploymentProfile) {
    reasons.push(
      `deployment profiles differ ("${baseline.provenance.configuration.deploymentProfile}" vs ` +
        `"${candidate.provenance.configuration.deploymentProfile}")`,
    );
  }
  if (baseline.provenance.configuration.localityPolicy !== candidate.provenance.configuration.localityPolicy) {
    reasons.push(
      `locality policies differ ("${baseline.provenance.configuration.localityPolicy}" vs ` +
        `"${candidate.provenance.configuration.localityPolicy}")`,
    );
  }
  if (baseline.provenance.schemaVersion !== candidate.provenance.schemaVersion) {
    reasons.push(
      `result schema versions differ ("${baseline.provenance.schemaVersion}" vs "${candidate.provenance.schemaVersion}")`,
    );
  }
  if (baseline.invalidation) reasons.push(`baseline run was invalidated: ${baseline.invalidation.reason}`);
  if (candidate.invalidation) reasons.push(`candidate run was invalidated: ${candidate.invalidation.reason}`);

  // Environment differences do not block comparison but are disclosed by the
  // caller through provenance; isolation availability materially affects trust.
  const b = baseline.provenance.environment;
  const c = candidate.provenance.environment;
  if (b.isolationBackends.join(",") !== c.isolationBackends.join(",")) {
    reasons.push(
      `available isolation backends differ ([${b.isolationBackends.join(", ")}] vs [${c.isolationBackends.join(", ")}]) — ` +
        "trust results are host-dependent and may not be comparable",
    );
  }

  return reasons;
}

// ═══════════════════════════════════════════════════════════════════════════
// Status ordering
// ═══════════════════════════════════════════════════════════════════════════

/** Ordinal quality of a status. Higher is better. */
const STATUS_RANK: Readonly<Record<ScenarioStatus, number>> = Object.freeze({
  passed: 4,
  partial: 3,
  failed: 1,
  blocked: 0,
  errored: 2,
  not_applicable: -1, // excluded from directional comparison
});

function comparable(status: ScenarioStatus): boolean {
  return status !== "not_applicable";
}

// ═══════════════════════════════════════════════════════════════════════════
// Regression classification
// ═══════════════════════════════════════════════════════════════════════════

/** Map a dimension to the regression kind it represents. */
function regressionKindFor(dimension: string): RegressionKind {
  switch (dimension) {
    case "trust":
    case "capability":
      return "security";
    case "context":
    case "environment":
      return "privacy";
    case "durability":
    case "execution":
    case "runtime":
    case "workflow":
      return "reliability";
    case "intelligence":
      return "cost";
    case "dx":
    case "ux":
      return "experience";
    case "enterprise":
      return "capability";
    default:
      return "reliability";
  }
}

/**
 * Severity of a status change.
 *
 * A regression in a gating dimension is ALWAYS critical: §15 requires that
 * security/privacy regressions cannot be hidden by quality gains.
 */
function severityFor(dimension: string, from: ScenarioStatus, to: ScenarioStatus): RegressionFinding["severity"] {
  if (isGatingDimension(dimension as never)) return "critical";
  if (to === "blocked" || to === "failed") return "major";
  if (from === "passed" && to === "partial") return "minor";
  return "minor";
}

// ═══════════════════════════════════════════════════════════════════════════
// Comparison
// ═══════════════════════════════════════════════════════════════════════════

function indexScenarios(run: EvaluationRun): Map<string, ScenarioResult> {
  const map = new Map<string, ScenarioResult>();
  for (const suite of run.suites) {
    for (const s of suite.scenarios) map.set(s.scenarioId, s);
  }
  return map;
}

export function compareRuns(baseline: EvaluationRun, candidate: EvaluationRun): ComparisonResult {
  const incomparableReasons = checkComparable(baseline, candidate);

  const baseIndex = indexScenarios(baseline);
  const candIndex = indexScenarios(candidate);

  const regressions: RegressionFinding[] = [];
  const improvements: RegressionFinding[] = [];
  let unchanged = 0;

  for (const [scenarioId, base] of baseIndex) {
    const cand = candIndex.get(scenarioId);
    if (!cand) continue;

    // Never compare across scenario versions: the task itself changed.
    if (base.scenarioVersion !== cand.scenarioVersion) {
      incomparableReasons.push(
        `scenario "${scenarioId}" changed version (${base.scenarioVersion} → ${cand.scenarioVersion}); ` +
          "its results are not directly comparable",
      );
      continue;
    }

    if (!comparable(base.status) || !comparable(cand.status)) {
      // A scenario becoming N/A (or ceasing to be) is a coverage change, not a
      // quality change. Report it as a finding so it cannot hide a loss.
      if (base.status !== cand.status) {
        incomparableReasons.push(
          `scenario "${scenarioId}" applicability changed ("${base.status}" → "${cand.status}")`,
        );
      }
      continue;
    }

    const from = STATUS_RANK[base.status];
    const to = STATUS_RANK[cand.status];

    if (to < from) {
      regressions.push({
        kind: regressionKindFor(base.dimension),
        dimension: base.dimension,
        scenarioId,
        baselineStatus: base.status,
        candidateStatus: cand.status,
        detail: `${base.status} → ${cand.status}: ${cand.statusReason}`,
        severity: severityFor(base.dimension, base.status, cand.status),
      });
    } else if (to > from) {
      improvements.push({
        kind: regressionKindFor(base.dimension),
        dimension: base.dimension,
        scenarioId,
        baselineStatus: base.status,
        candidateStatus: cand.status,
        detail: `${base.status} → ${cand.status}`,
        severity: "minor",
      });
    } else {
      unchanged += 1;
    }
  }

  // A newly-violated hard gate is a critical security regression even when the
  // overall status happens to be unchanged.
  for (const [scenarioId, cand] of candIndex) {
    const base = baseIndex.get(scenarioId);
    if (!base) continue;
    const baseViolated = base.gates.some((g) => !g.held && g.severity === "critical");
    const candViolated = cand.gates.some((g) => !g.held && g.severity === "critical");
    if (candViolated && !baseViolated && !regressions.some((r) => r.scenarioId === scenarioId)) {
      regressions.push({
        kind: "security",
        dimension: cand.dimension,
        scenarioId,
        baselineStatus: base.status,
        candidateStatus: cand.status,
        detail: `a critical safety gate began failing: ${cand.gates.filter((g) => !g.held).map((g) => g.gateId).join(", ")}`,
        severity: "critical",
      });
    }
  }

  const onlyInBaseline = [...baseIndex.keys()].filter((id) => !candIndex.has(id));
  const onlyInCandidate = [...candIndex.keys()].filter((id) => !baseIndex.has(id));

  const overfit = detectOverfitting(baseline, candidate);

  return Object.freeze({
    comparable: incomparableReasons.length === 0,
    incomparableReasons: Object.freeze(incomparableReasons),
    baselineRunId: baseline.provenance.runId,
    candidateRunId: candidate.provenance.runId,
    regressions: Object.freeze(regressions),
    improvements: Object.freeze(improvements),
    unchanged,
    onlyInBaseline: Object.freeze(onlyInBaseline),
    onlyInCandidate: Object.freeze(onlyInCandidate),
    overfittingSuspected: overfit.suspected,
    ...(overfit.detail ? { overfittingDetail: overfit.detail } : {}),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Overfitting detection (§7.4)
// ═══════════════════════════════════════════════════════════════════════════

function passRate(run: EvaluationRun, set: string): number | null {
  const results: ScenarioResult[] = [];
  for (const suite of run.suites) for (const s of suite.scenarios) if (s.set === set) results.push(s);
  const scoreable = results.filter((r) => comparable(r.status) && r.status !== "errored");
  if (scoreable.length === 0) return null;
  return scoreable.filter((r) => r.status === "passed").length / scoreable.length;
}

/**
 * Detect the classic benchmark failure mode: the development set improves
 * while the held-out independent set does not.
 */
export function detectOverfitting(
  baseline: EvaluationRun,
  candidate: EvaluationRun,
): { suspected: boolean; detail?: string } {
  const devBefore = passRate(baseline, "development");
  const devAfter = passRate(candidate, "development");
  const indBefore = passRate(baseline, "independent");
  const indAfter = passRate(candidate, "independent");

  if (devBefore === null || devAfter === null || indBefore === null || indAfter === null) {
    return { suspected: false };
  }

  const devDelta = devAfter - devBefore;
  const indDelta = indAfter - indBefore;

  if (devDelta > 0.05 && indDelta <= 0) {
    return {
      suspected: true,
      detail:
        `the development scenario set improved by ${(devDelta * 100).toFixed(1)} points while the held-out ` +
        `independent set changed by ${(indDelta * 100).toFixed(1)} points. This is the signature of tuning to ` +
        `the benchmark rather than improving the platform.`,
    };
  }
  return { suspected: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// Release gate
// ═══════════════════════════════════════════════════════════════════════════

export interface RegressionGate {
  readonly pass: boolean;
  readonly criticalCount: number;
  readonly majorCount: number;
  readonly reasons: readonly string[];
}

/**
 * Decide whether a comparison permits a release.
 *
 * Any critical regression blocks. Quality improvements do not offset it.
 */
export function evaluateRegressionGate(comparison: ComparisonResult): RegressionGate {
  const critical = comparison.regressions.filter((r) => r.severity === "critical");
  const major = comparison.regressions.filter((r) => r.severity === "major");
  const reasons: string[] = [];

  for (const r of critical) {
    reasons.push(`CRITICAL ${r.kind} regression in ${r.dimension}: ${r.scenarioId} (${r.detail})`);
  }
  for (const r of major) {
    reasons.push(`major ${r.kind} regression in ${r.dimension}: ${r.scenarioId} (${r.detail})`);
  }
  if (comparison.overfittingSuspected) {
    reasons.push(`possible benchmark overfitting: ${comparison.overfittingDetail}`);
  }

  return Object.freeze({
    pass: critical.length === 0,
    criticalCount: critical.length,
    majorCount: major.length,
    reasons: Object.freeze(reasons),
  });
}
