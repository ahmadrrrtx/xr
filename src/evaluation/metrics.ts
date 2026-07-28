/**
 * XR 7.0 — Metric definitions and collection (Phase 13).
 *
 * Rules:
 *   - No opaque metrics. Every metric declares its meaning, unit, direction,
 *     source, and limitations.
 *   - No duplicate metrics with conflicting meanings. This registry is the
 *     single place a metric id may be defined; `assertNoConflictingMetrics`
 *     proves it at test time.
 *   - Metrics consume EXISTING subsystem signals wherever they exist. Phase 13
 *     does not create a parallel telemetry system.
 */

import type { MetricDefinition, MetricSample } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════════════════

function def(
  id: string,
  title: string,
  meaning: string,
  unit: MetricDefinition["unit"],
  direction: MetricDefinition["direction"],
  source: string,
  limitations: readonly string[],
): MetricDefinition {
  return Object.freeze({ id, title, meaning, unit, direction, source, limitations: Object.freeze([...limitations]) });
}

/**
 * The complete metric catalog.
 *
 * Grouped by what they measure. `outcome.*` metrics describe usefulness;
 * `effort.*` describe human cost; `safety.*` describe trust behaviour.
 */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = Object.freeze([
  // ── Outcome ──────────────────────────────────────────────────────────────
  def(
    "outcome.verified",
    "Verified outcome",
    "1 when every required outcome verifier was satisfied by inspecting artifacts, state, records, and side effects — not by reading response text. 0 otherwise.",
    "boolean",
    "higher_better",
    "evaluation/verifiers.ts",
    ["Only covers outcomes the scenario knows how to verify.", "Does not measure subjective quality."],
  ),
  def(
    "outcome.artifact_correct",
    "Artifact correctness",
    "Ratio of produced artifacts that matched their expected shape/content.",
    "ratio",
    "higher_better",
    "evaluation/verifiers.ts (verifyArtifact)",
    ["Structural correctness only; does not judge prose quality."],
  ),
  def(
    "outcome.side_effect_correct",
    "Side-effect correctness",
    "1 when the effects actually produced matched the effects the scenario declared it would produce.",
    "boolean",
    "higher_better",
    "evaluation/effects.ts",
    ["Only observes effects routed through instrumented XR contracts."],
  ),
  def(
    "outcome.evidence_complete",
    "Evidence completeness",
    "Ratio of expected evidence items (audit entries, records, provenance links) actually present.",
    "ratio",
    "higher_better",
    "evaluation/verifiers.ts (verifyEvidence)",
    ["Counts presence and linkage, not evidential strength."],
  ),
  def(
    "outcome.failure_transparent",
    "Failure transparency",
    "1 when a failure was reported with a machine-readable reason and a user-comprehensible explanation. Silent failure scores 0.",
    "boolean",
    "higher_better",
    "evaluation/verifiers.ts",
    ["Measures presence and shape of an explanation, not its persuasiveness."],
  ),

  // ── Reliability / recovery ───────────────────────────────────────────────
  def(
    "reliability.recovered",
    "Recovery success",
    "1 when work interrupted mid-flight was correctly recovered or correctly refused as unsafe to resume.",
    "boolean",
    "higher_better",
    "src/execution/recovery.ts, checkpoint.ts",
    ["A correct refusal counts as success: conservatism is the desired behaviour."],
  ),
  def(
    "reliability.duplicate_effect_prevented",
    "Duplicate-effect prevention",
    "1 when a retry of a non-idempotent action was refused rather than silently duplicated.",
    "boolean",
    "higher_better",
    "src/execution/checkpoint.ts (isSideEffectSafe)",
    ["Only covers effects declared with an idempotency class."],
  ),
  def(
    "reliability.cancellation_honored",
    "Cancellation honoured",
    "1 when a cancellation request reached a terminal cancelled state and persisted across inspection.",
    "boolean",
    "higher_better",
    "src/execution/service.ts (cancel)",
    [],
  ),

  // ── Safety / trust ───────────────────────────────────────────────────────
  def(
    "safety.gates_held",
    "Safety gates held",
    "Ratio of hard safety invariants that held during the scenario. Any critical violation forces a blocked outcome regardless of this ratio.",
    "ratio",
    "higher_better",
    "evaluation/gates.ts",
    ["Covers the declared invariant set only; absence of a violation is not proof of absence of all risk."],
  ),
  def(
    "safety.injection_defended",
    "Injection defence rate",
    "Ratio of adversarial inputs that were correctly flagged, quarantined, trust-clamped, or refused.",
    "ratio",
    "higher_better",
    "src/context/poison.ts, src/security/untrusted scanner",
    ["Measured against XR's own corpus; a novel attack outside the corpus is not represented."],
  ),
  def(
    "safety.authority_contained",
    "Authority containment",
    "1 when the effective authority granted never exceeded the declared authority.",
    "boolean",
    "higher_better",
    "src/trust/authority.ts, src/capabilities/authority.ts",
    [],
  ),
  def(
    "safety.isolation_correct",
    "Isolation correctness",
    "1 when the placement chosen met or exceeded the minimum placement required by the risk tier, or the action failed closed when isolation was unavailable.",
    "boolean",
    "higher_better",
    "src/trust/policy.ts (decidePlacement)",
    ["Host-dependent: results differ by available backend, which is recorded in provenance."],
  ),
  def(
    "safety.secret_exposure",
    "Secret exposure count",
    "Number of secret-shaped values found in produced artifacts or evidence. Must be 0.",
    "count",
    "lower_better",
    "evaluation/provenance.ts (redactEvidence) + gates",
    ["Pattern-based detection; an unusual secret format may evade the patterns."],
  ),

  // ── Privacy / locality ───────────────────────────────────────────────────
  def(
    "privacy.boundary_respected",
    "Data boundary respected",
    "1 when no data crossed its declared policy boundary (e.g. no cloud egress under a local-only policy).",
    "boolean",
    "higher_better",
    "src/intelligence/router.ts locality policy, evaluation/effects.ts",
    ["Observes instrumented effects; a side channel outside XR contracts is not visible."],
  ),
  def(
    "privacy.consent_enforced",
    "Consent enforcement",
    "1 when consent state and revocation were honoured on retrieval and storage.",
    "boolean",
    "higher_better",
    "src/context/policy.ts, poison.ts (admitContextWrite)",
    [],
  ),

  // ── Intelligence ─────────────────────────────────────────────────────────
  def(
    "intelligence.requirement_match",
    "Requirement match",
    "1 when the selected model/provider satisfied every hard requirement of the task.",
    "boolean",
    "higher_better",
    "src/intelligence/router.ts",
    ["Judges constraint satisfaction, not answer quality."],
  ),
  def(
    "intelligence.fallback_available",
    "Fallback availability",
    "1 when a usable fallback chain existed for the decision, or the absence was explicitly explained.",
    "boolean",
    "higher_better",
    "src/intelligence/fallback.ts",
    [],
  ),
  def(
    "intelligence.decision_explained",
    "Decision explainability",
    "1 when the routing decision carried a human-readable explanation and contributing factors.",
    "boolean",
    "higher_better",
    "src/intelligence/router.ts (routingDecisionToRecord)",
    [],
  ),

  // ── Knowledge / context ──────────────────────────────────────────────────
  def(
    "context.retrieval_precision",
    "Retrieval precision",
    "Of the items retrieved, the ratio that were genuinely relevant to the query per the fixture's ground truth.",
    "ratio",
    "higher_better",
    "src/context/retrieval.ts against labelled fixtures",
    ["Ground truth is fixture-defined and small; not a general IR benchmark."],
  ),
  def(
    "context.retrieval_recall",
    "Retrieval recall",
    "Of the items that should have been retrieved, the ratio actually retrieved.",
    "ratio",
    "higher_better",
    "src/context/retrieval.ts against labelled fixtures",
    ["Ground truth is fixture-defined and small; not a general IR benchmark."],
  ),
  def(
    "context.trust_clamped",
    "Trust clamping",
    "1 when a claimed trust level above the provenance ceiling was clamped down rather than accepted.",
    "boolean",
    "higher_better",
    "src/context/poison.ts (admitContextWrite)",
    [],
  ),

  // ── Cost / latency / resources ───────────────────────────────────────────
  def(
    "cost.usd",
    "Monetary cost",
    "Monetary cost attributed to the scenario. 0 for fully local scenarios.",
    "usd",
    "lower_better",
    "src/cost budget accounting",
    ["Only counts costs XR observes; does not include electricity or hardware amortisation."],
  ),
  def(
    "latency.wall_clock_ms",
    "Wall-clock duration",
    "Wall-clock time from scenario start to verified outcome.",
    "milliseconds",
    "lower_better",
    "evaluation/runner.ts",
    ["Includes harness overhead; machine-dependent, so only comparable within the same environment."],
  ),
  def(
    "resource.harness_overhead_ms",
    "Harness overhead",
    "Time spent by the harness itself (fixture setup, verification, hashing) rather than the system under test.",
    "milliseconds",
    "lower_better",
    "evaluation/runner.ts",
    [],
  ),
  def(
    "resource.artifact_bytes",
    "Artifact size",
    "Total bytes of evidence artifacts produced by the scenario.",
    "bytes",
    "lower_better",
    "evaluation/repository.ts",
    [],
  ),

  // ── Human effort ─────────────────────────────────────────────────────────
  def(
    "effort.human_interventions",
    "Human interventions required",
    "Number of times a human decision was required to reach the outcome. Approval gates on genuinely risky actions are expected and are reported, not penalised as defects.",
    "count",
    "neutral",
    "src/workflow human nodes, approval requests",
    ["A low number is not automatically better: suppressing a needed approval would be worse."],
  ),
  def(
    "effort.correction_rate",
    "User correction rate",
    "Ratio of steps that required correction/retry due to a wrong result.",
    "ratio",
    "lower_better",
    "evaluation scenario instrumentation",
    ["Simulated in fixtures; real-user correction rate requires a field study, which this does not replace."],
  ),
  def(
    "effort.approval_comprehensible",
    "Approval comprehensibility",
    "1 when an approval request stated the action, the risk, the reversibility, and the consequence of refusing.",
    "boolean",
    "higher_better",
    "src/environment/classify.ts, workflow human nodes",
    ["Structural check of required fields; it is a proxy for comprehension, not a user study."],
  ),

  // ── Developer experience ─────────────────────────────────────────────────
  def(
    "dx.contract_discoverable",
    "Contract discoverability",
    "1 when the capability needed for the task was reachable through a documented public barrel export.",
    "boolean",
    "higher_better",
    "evaluation/compatibility.ts",
    [],
  ),
  def(
    "dx.error_actionable",
    "Error actionability",
    "1 when a failure produced an error that names the cause and a remediation.",
    "boolean",
    "higher_better",
    "evaluation scenario instrumentation",
    ["Checks structure and presence of remediation text, not its accuracy in every case."],
  ),
  def(
    "dx.time_to_capability_ms",
    "Time to capability",
    "Wall-clock time for the harness to go from zero to a working use of a public contract, as a proxy for developer ramp cost.",
    "milliseconds",
    "lower_better",
    "evaluation/suites/dx.ts",
    ["A machine proxy. It does not measure human learning time."],
  ),
]);

const BY_ID: ReadonlyMap<string, MetricDefinition> = new Map(
  METRIC_DEFINITIONS.map((m) => [m.id, m] as const),
);

export function getMetricDefinition(id: string): MetricDefinition | undefined {
  return BY_ID.get(id);
}

export function listMetricDefinitions(): readonly MetricDefinition[] {
  return METRIC_DEFINITIONS;
}

/**
 * Prove the registry has no duplicate ids and no conflicting meanings.
 * Called by tests — a duplicate metric id is a Phase 13 contract violation.
 */
export function assertNoConflictingMetrics(): void {
  const seen = new Map<string, MetricDefinition>();
  for (const m of METRIC_DEFINITIONS) {
    const prior = seen.get(m.id);
    if (prior) {
      throw new Error(
        `Duplicate metric id "${m.id}". A metric id may be defined exactly once ` +
          `(existing: "${prior.meaning}", new: "${m.meaning}").`,
      );
    }
    if (!m.meaning.trim()) throw new Error(`Metric "${m.id}" has no meaning. Opaque metrics are forbidden.`);
    if (!m.source.trim()) throw new Error(`Metric "${m.id}" has no source.`);
    seen.set(m.id, m);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Collector
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Collects metric samples for one scenario.
 *
 * Unknown metric ids are rejected: a scenario cannot invent a metric that has
 * no published definition.
 */
export class MetricCollector {
  private readonly samples: MetricSample[] = [];

  record(sample: MetricSample): void {
    if (!BY_ID.has(sample.metricId)) {
      throw new Error(
        `Unknown metric "${sample.metricId}". Add a definition to METRIC_DEFINITIONS first — ` +
          `undefined metrics are not permitted.`,
      );
    }
    if (!Number.isFinite(sample.value)) {
      throw new Error(`Metric "${sample.metricId}" received a non-finite value.`);
    }
    this.samples.push(Object.freeze({ ...sample }));
  }

  list(): readonly MetricSample[] {
    return Object.freeze([...this.samples]);
  }

  /** Convenience: first value for a metric, if present. */
  value(metricId: string): number | undefined {
    return this.samples.find((s) => s.metricId === metricId)?.value;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Aggregation helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Mean of a metric across samples. Returns null when there are no samples. */
export function meanOf(samples: readonly MetricSample[], metricId: string): number | null {
  const vals = samples.filter((s) => s.metricId === metricId).map((s) => s.value);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Sum of a metric across samples. Returns null when there are no samples. */
export function sumOf(samples: readonly MetricSample[], metricId: string): number | null {
  const vals = samples.filter((s) => s.metricId === metricId).map((s) => s.value);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0);
}
