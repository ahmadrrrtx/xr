/**
 * XR 7.0 — Scorecard methodology (Phase 13).
 *
 * Non-negotiable scoring rules (§7.5):
 *
 *   1. Raw metrics are always exposed. A score never replaces the evidence.
 *   2. Weights are always disclosed with the score.
 *   3. Hard safety gates are NOT weighted — a critical violation nulls the
 *      headline score entirely. High quality can never compensate for a
 *      security failure.
 *   4. "Not applicable" is excluded from the denominator. It is never 0.
 *   5. Confidence/uncertainty is reported, never implied.
 *   6. Dimension-level results are preserved; XR is never reduced to one
 *      number without its breakdown.
 */

import {
  EVALUATION_DIMENSIONS,
  EVALUATION_REPORT_VERSION,
  contributesToScore,
  isGatingDimension,
  type Confidence,
  type DimensionScore,
  type EvaluationDimension,
  type EvaluationRun,
  type ScenarioResult,
  type Scorecard,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Weights — published, not hidden
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dimension weights for the overall quality score.
 *
 * These are a judgement call and are published as such. Gating dimensions
 * carry weight too, but their real power is the gate, not the weight: they
 * can zero the entire scorecard rather than merely lower it.
 */
export const DIMENSION_WEIGHTS: Readonly<Record<EvaluationDimension, number>> = Object.freeze({
  runtime: 0.5,
  execution: 1.0,
  trust: 1.5,
  durability: 1.0,
  intelligence: 1.0,
  context: 1.0,
  workflow: 1.0,
  environment: 1.0,
  capability: 0.75,
  business: 0.75,
  deployment: 0.75,
  enterprise: 0.75,
  dx: 0.5,
  ux: 0.5,
});

/** Per-status credit toward a dimension's quality score. */
const STATUS_CREDIT: Readonly<Record<string, number>> = Object.freeze({
  passed: 1,
  partial: 0.5,
  failed: 0,
  blocked: 0,
});

// ═══════════════════════════════════════════════════════════════════════════
// Confidence
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Derive a confidence for a set of results.
 *
 * Deterministic scenarios earn high confidence from a single sample.
 * Probabilistic scenarios never exceed 0.6 from one sample, and say why.
 */
export function deriveConfidence(results: readonly ScenarioResult[]): Confidence {
  if (results.length === 0) {
    return Object.freeze({
      value: 0,
      basis: "no applicable scenarios executed",
      samples: 0,
      blindSpots: Object.freeze(["nothing was measured in this dimension for this run"]),
    });
  }

  const probabilistic = results.filter((r) => r.determinism === "probabilistic").length;
  const bounded = results.filter((r) => r.determinism === "bounded").length;
  const deterministic = results.length - probabilistic - bounded;
  const errored = results.filter((r) => r.status === "errored").length;

  // Base confidence from determinism mix.
  let value = (deterministic * 1 + bounded * 0.8 + probabilistic * 0.5) / results.length;

  // Harness errors reduce confidence in the measurement itself.
  if (errored > 0) value *= Math.max(0.3, 1 - errored / results.length);

  const blindSpots = new Set<string>();
  for (const r of results) {
    if (r.status === "errored") blindSpots.add(`scenario "${r.scenarioId}" errored — its dimension coverage is incomplete`);
    if (r.determinism === "probabilistic") {
      blindSpots.add(`scenario "${r.scenarioId}" is probabilistic — a single run is indicative, not conclusive`);
    }
  }

  const parts: string[] = [];
  if (deterministic) parts.push(`${deterministic} deterministic`);
  if (bounded) parts.push(`${bounded} bounded`);
  if (probabilistic) parts.push(`${probabilistic} probabilistic`);

  return Object.freeze({
    value: Number(Math.min(1, Math.max(0, value)).toFixed(4)),
    basis: `derived from ${results.length} scenario result(s): ${parts.join(", ")}${errored ? `; ${errored} errored` : ""}`,
    samples: results.length,
    blindSpots: Object.freeze([...blindSpots]),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Dimension scoring
// ═══════════════════════════════════════════════════════════════════════════

export function scoreDimension(
  dimension: EvaluationDimension,
  results: readonly ScenarioResult[],
): DimensionScore {
  const counts = {
    passed: 0,
    partial: 0,
    failed: 0,
    blocked: 0,
    notApplicable: 0,
    errored: 0,
  };

  for (const r of results) {
    if (r.status === "passed") counts.passed += 1;
    else if (r.status === "partial") counts.partial += 1;
    else if (r.status === "failed") counts.failed += 1;
    else if (r.status === "blocked") counts.blocked += 1;
    else if (r.status === "not_applicable") counts.notApplicable += 1;
    else counts.errored += 1;
  }

  // "Not applicable" and "errored" are EXCLUDED from the denominator.
  // A scenario that could not apply is not a failure; an errored scenario is a
  // measurement gap, reported through confidence rather than scored as 0.
  const scored = results.filter((r) => contributesToScore(r.status));
  const score =
    scored.length === 0
      ? null
      : Number(
          (
            scored.reduce((sum, r) => sum + (STATUS_CREDIT[r.status] ?? 0), 0) / scored.length
          ).toFixed(4),
        );

  const hardFailure = results.some(
    (r) => r.gates.some((g) => !g.held && g.severity === "critical"),
  );

  const notes: string[] = [];
  if (counts.notApplicable > 0) {
    notes.push(`${counts.notApplicable} scenario(s) not applicable to this configuration — excluded from the score, not counted as zero`);
  }
  if (counts.errored > 0) {
    notes.push(`${counts.errored} scenario(s) errored in the harness — excluded from the score and reflected in reduced confidence`);
  }
  if (hardFailure) {
    notes.push("a critical safety gate was violated in this dimension — the quality score below is informational only");
  }
  if (scored.length === 0 && results.length > 0) {
    notes.push("no scenario in this dimension produced a scoreable outcome");
  }

  return Object.freeze({
    dimension,
    gating: isGatingDimension(dimension),
    score,
    passed: counts.passed,
    partial: counts.partial,
    failed: counts.failed,
    blocked: counts.blocked,
    notApplicable: counts.notApplicable,
    errored: counts.errored,
    hardFailure,
    confidence: deriveConfidence(results),
    weight: DIMENSION_WEIGHTS[dimension],
    notes: Object.freeze(notes),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Scorecard
// ═══════════════════════════════════════════════════════════════════════════

export interface ScorecardOptions {
  readonly now?: number;
  /** Extra limitations to publish alongside the score. */
  readonly limitations?: readonly string[];
}

/**
 * Build the scorecard for a run.
 *
 * The headline `overall` is deliberately `null` whenever a critical gate was
 * violated. XR refuses to publish a summary number that could mask a security
 * or privacy failure.
 */
export function buildScorecard(run: EvaluationRun, opts: ScorecardOptions = {}): Scorecard {
  const byDimension = new Map<EvaluationDimension, ScenarioResult[]>();
  for (const d of EVALUATION_DIMENSIONS) byDimension.set(d, []);
  for (const suite of run.suites) {
    for (const s of suite.scenarios) {
      byDimension.get(s.dimension)?.push(s);
    }
  }

  const dimensions: DimensionScore[] = [];
  for (const d of EVALUATION_DIMENSIONS) {
    const results = byDimension.get(d) ?? [];
    if (results.length === 0) continue; // absent dimension ≠ zero
    dimensions.push(scoreDimension(d, results));
  }

  const hardFailures: string[] = [];
  for (const suite of run.suites) {
    for (const s of suite.scenarios) {
      for (const g of s.gates) {
        if (!g.held && g.severity === "critical") {
          hardFailures.push(`${s.scenarioId} [${s.dimension}] ${g.gateId}: ${g.detail}`);
        }
      }
    }
  }
  const hardFailure = hardFailures.length > 0;

  // Weighted mean over dimensions that produced a score.
  const scoreable = dimensions.filter((d) => d.score !== null);
  const totalWeight = scoreable.reduce((sum, d) => sum + d.weight, 0);
  const weighted =
    scoreable.length === 0 || totalWeight === 0
      ? null
      : Number((scoreable.reduce((sum, d) => sum + (d.score ?? 0) * d.weight, 0) / totalWeight).toFixed(4));

  // RULE 3: a critical gate violation nulls the headline score.
  const overall = hardFailure ? null : weighted;

  const blindSpots = new Set<string>();
  for (const d of dimensions) for (const b of d.confidence.blindSpots) blindSpots.add(b);

  const missing = EVALUATION_DIMENSIONS.filter((d) => !dimensions.some((x) => x.dimension === d));

  const limitations: string[] = [
    "Scores describe XR's behaviour on XR's own scenario set, executed in the environment recorded in this run's provenance. They are not a comparison against any other product.",
    "Host capability affects results: isolation, sandbox, and container behaviour vary by machine. The available backends are recorded in provenance.",
    "Weights are an engineering judgement and are published so they can be disputed or recomputed from the raw dimension results.",
    ...(missing.length > 0 ? [`Dimensions with no executed scenarios in this run: ${missing.join(", ")}.`] : []),
    ...(hardFailure ? ["A critical safety gate was violated, so no overall score is published for this run."] : []),
    ...(opts.limitations ?? []),
  ];

  const doesNotProve = [
    "This scorecard does not prove XR is superior to any other system; no competitor was executed.",
    "It does not prove absence of vulnerabilities — only that the declared invariants held for the declared scenarios.",
    "It does not measure real-world human satisfaction; UX metrics here are structural proxies with published limitations.",
    "It does not establish any external certification (SOC 2, ISO 27001, HIPAA, PCI-DSS, FedRAMP).",
  ];

  return Object.freeze({
    reportVersion: EVALUATION_REPORT_VERSION,
    runId: run.provenance.runId,
    productVersion: run.provenance.productVersion,
    generatedAt: opts.now ?? Date.now(),
    dimensions: Object.freeze(dimensions),
    overall,
    hardFailure,
    hardFailures: Object.freeze(hardFailures),
    weights: Object.freeze({ ...DIMENSION_WEIGHTS }),
    limitations: Object.freeze(limitations),
    blindSpots: Object.freeze([...blindSpots]),
    doesNotProve: Object.freeze(doesNotProve),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Guard: prove aggregation cannot hide a critical failure
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assert the scorecard never publishes a headline number while a critical
 * gate is violated. Exercised by the security tests as an executable
 * statement of the §9 rule "no score aggregation that hides critical failures".
 */
export function assertNoHiddenCriticalFailure(card: Scorecard): void {
  if (card.hardFailure && card.overall !== null) {
    throw new Error(
      "Scorecard integrity violation: an overall score was published despite a critical safety gate failure.",
    );
  }
  if (card.hardFailure && card.hardFailures.length === 0) {
    throw new Error("Scorecard integrity violation: hardFailure is set but no failing gate was listed.");
  }
}
