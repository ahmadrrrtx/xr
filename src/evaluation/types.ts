/**
 * XR 7.0 — Evaluation model (Phase 13, "XR OS Supremacy").
 *
 * This file defines the versioned data model for outcome-based evaluation.
 *
 * Design rules (from the Phase 13 contract):
 *   - A result is meaningless without provenance. Every result carries the
 *     environment, commit, config, scenario version, provider/model, policy,
 *     and timestamp that produced it.
 *   - Outcomes are VERIFIED, never inferred from response text.
 *   - Security/privacy/correctness are GATING dimensions. A hard-gate
 *     violation can never be averaged away by high quality elsewhere.
 *   - "Not applicable" is a first-class status. It is never scored as zero.
 *   - Uncertainty is disclosed, not hidden.
 *
 * This module intentionally contains no execution logic — it is the contract
 * that the runner, verifiers, gates, scoring, repository, and reports share.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Schema versions
// ═══════════════════════════════════════════════════════════════════════════

/** Bump when the persisted result shape changes in a breaking way. */
export const EVALUATION_SCHEMA_VERSION = "xr-7.0.0/evaluation-v1";

/** Bump when the scorecard/report shape changes in a breaking way. */
export const EVALUATION_REPORT_VERSION = "xr-7.0.0/evaluation-report-v1";

/** Bump when the certification record shape changes in a breaking way. */
export const EVALUATION_CERTIFICATION_VERSION = "xr-7.0.0/evaluation-certification-v1";

/** Identifies the harness itself, so results from different harnesses are comparable-checkable. */
export const EVALUATION_HARNESS_ID = "xr-evaluation-harness";

/** Harness version. Distinct from the product version on purpose. */
export const EVALUATION_HARNESS_VERSION = "1.0.0";

// ═══════════════════════════════════════════════════════════════════════════
// Dimensions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The platform dimensions XR measures. These mirror the architectural stack
 * plus the two human-facing dimensions.
 */
export const EVALUATION_DIMENSIONS = [
  "runtime",
  "execution",
  "trust",
  "durability",
  "intelligence",
  "context",
  "workflow",
  "environment",
  "capability",
  "business",
  "deployment",
  "enterprise",
  "dx",
  "ux",
] as const;

export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number];

/**
 * Dimensions whose failure is a HARD failure for the whole scorecard.
 *
 * Rationale: a platform that leaks data, escapes isolation, or corrupts an
 * outcome is not "mostly good". Quality gains in other dimensions must never
 * compensate. `scoring.ts` enforces this; it is not merely a weight.
 */
export const GATING_DIMENSIONS: readonly EvaluationDimension[] = Object.freeze([
  "trust",
  "context",
  "environment",
  "capability",
  "enterprise",
]);

export function isGatingDimension(d: EvaluationDimension): boolean {
  return GATING_DIMENSIONS.includes(d);
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario sets — overfitting protection (§7.4)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Separating development / validation / independent sets makes benchmark
 * overfitting visible: if `development` improves while `independent`
 * stagnates or regresses, the harness reports it.
 */
export const SCENARIO_SETS = ["development", "validation", "independent"] as const;
export type ScenarioSet = (typeof SCENARIO_SETS)[number];

// ═══════════════════════════════════════════════════════════════════════════
// Outcome status
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scenario outcome.
 *
 *   passed        — every verifier satisfied and no gate violated
 *   partial       — the useful outcome was only partly achieved, honestly reported
 *   failed        — a verifier was not satisfied
 *   blocked       — a hard safety gate stopped it, OR a precondition was refused
 *   not_applicable— does not apply to this profile/environment (never scored 0)
 *   errored       — the harness itself failed (never silently a "pass")
 */
export const SCENARIO_STATUSES = [
  "passed",
  "partial",
  "failed",
  "blocked",
  "not_applicable",
  "errored",
] as const;

export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

/** Statuses that contribute to a quality score. Others are excluded, not zeroed. */
export function contributesToScore(s: ScenarioStatus): boolean {
  return s === "passed" || s === "partial" || s === "failed" || s === "blocked";
}

// ═══════════════════════════════════════════════════════════════════════════
// Determinism / confidence
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How reproducible a scenario is.
 *
 *   deterministic  — same fixture + config ⇒ identical verified outcome
 *   bounded        — varies within a declared tolerance (e.g. timing)
 *   probabilistic  — depends on a model/provider; MUST be labelled as such
 */
export const DETERMINISM_KINDS = ["deterministic", "bounded", "probabilistic"] as const;
export type DeterminismKind = (typeof DETERMINISM_KINDS)[number];

export interface Confidence {
  /** 0..1. For deterministic scenarios this is 1 with a single sample. */
  readonly value: number;
  /** How the confidence was derived — never an unexplained number. */
  readonly basis: string;
  /** Sample count backing the result. */
  readonly samples: number;
  /** Known blind spots for this specific measurement. */
  readonly blindSpots: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Metrics
// ═══════════════════════════════════════════════════════════════════════════

export const METRIC_UNITS = [
  "count",
  "milliseconds",
  "bytes",
  "usd",
  "ratio",
  "boolean",
  "score",
] as const;

export type MetricUnit = (typeof METRIC_UNITS)[number];

/** Whether a higher value is better, lower is better, or neither. */
export const METRIC_DIRECTIONS = ["higher_better", "lower_better", "neutral"] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

/**
 * A metric definition. Opaque metrics are forbidden — every metric must state
 * what it means and how it is derived, so a reader can dispute it.
 */
export interface MetricDefinition {
  readonly id: string;
  readonly title: string;
  /** Plain-language definition. Required. No opaque metrics. */
  readonly meaning: string;
  readonly unit: MetricUnit;
  readonly direction: MetricDirection;
  /** Where the number comes from (which contract/collector). */
  readonly source: string;
  /** What this metric explicitly does NOT capture. */
  readonly limitations: readonly string[];
}

export interface MetricSample {
  readonly metricId: string;
  readonly value: number;
  /** Optional per-sample note (e.g. "no isolation backend on this host"). */
  readonly note?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Effects — what a scenario actually did
// ═══════════════════════════════════════════════════════════════════════════

export const EFFECT_KINDS = [
  "fs_read",
  "fs_write",
  "network",
  "process_spawn",
  "credential_access",
  "policy_decision",
  "audit_write",
  "state_transition",
  "approval_request",
] as const;

export type EffectKind = (typeof EFFECT_KINDS)[number];

/**
 * A recorded effect. Side-effect correctness is part of the outcome, so
 * effects are evidence, not debug logging.
 */
export interface RecordedEffect {
  readonly kind: EffectKind;
  /** Already-redacted target descriptor. Never a raw secret or absolute host path. */
  readonly target: string;
  /** True when the effect was allowed; false when refused/blocked. */
  readonly allowed: boolean;
  readonly detail?: string;
  readonly at: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Verification
// ═══════════════════════════════════════════════════════════════════════════

export const VERIFIER_KINDS = [
  "artifact",
  "state",
  "record",
  "policy",
  "evidence",
  "side_effect",
  "no_side_effect",
  "comprehension",
] as const;

export type VerifierKind = (typeof VERIFIER_KINDS)[number];

/** The result of one outcome verifier. */
export interface VerificationResult {
  readonly id: string;
  readonly kind: VerifierKind;
  readonly satisfied: boolean;
  /** Why it was or was not satisfied. Always human-readable. */
  readonly detail: string;
  /**
   * True when this verifier is required for the scenario to pass.
   * A non-required verifier that fails yields `partial`, not `failed`.
   */
  readonly required: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Safety gates
// ═══════════════════════════════════════════════════════════════════════════

export const SAFETY_GATE_IDS = [
  "no_real_user_data",
  "no_secret_in_artifact",
  "no_unexpected_network",
  "no_unexpected_process_spawn",
  "no_policy_bypass",
  "no_isolation_downgrade",
  "no_untrusted_instruction_promotion",
  "no_workspace_escape",
  "no_result_falsification",
] as const;

export type SafetyGateId = (typeof SAFETY_GATE_IDS)[number];

export interface SafetyGateResult {
  readonly gateId: SafetyGateId;
  /** True when the invariant HELD. */
  readonly held: boolean;
  readonly detail: string;
  /**
   * Severity of a violation. `critical` violations force `blocked` and make
   * the entire suite fail regardless of quality scores.
   */
  readonly severity: "critical" | "high";
}

// ═══════════════════════════════════════════════════════════════════════════
// Provenance
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Environment capture. Deliberately coarse: enough to compare runs, not
 * enough to fingerprint a user's machine or leak infrastructure detail.
 */
export interface EvaluationEnvironment {
  readonly platform: string;
  readonly arch: string;
  readonly runtime: string;
  readonly runtimeVersion: string;
  readonly cpuCount: number;
  /** Coarse memory bucket in GiB — not exact, to avoid fingerprinting. */
  readonly memoryGiB: number;
  /** Isolation backends actually available on this host. Affects trust results. */
  readonly isolationBackends: readonly string[];
  /** True when the run was executed with no network access permitted. */
  readonly offline: boolean;
  /** True when running as root (weakens sandbox guarantees). */
  readonly elevated: boolean;
}

/** Configuration under which a run happened. Part of comparability. */
export interface EvaluationConfiguration {
  readonly deploymentProfile: string;
  readonly localityPolicy: string;
  /** Provider/model if the scenario used one. Absent for pure-contract scenarios. */
  readonly providerId?: string;
  readonly modelId?: string;
  /** Policy digest so two runs under different policy are never compared. */
  readonly policyDigest: string;
  /** Set of scenarios executed (development/validation/independent). */
  readonly scenarioSets: readonly ScenarioSet[];
}

export interface RunProvenance {
  readonly runId: string;
  readonly harnessId: string;
  readonly harnessVersion: string;
  readonly schemaVersion: string;
  /** Product version under test. */
  readonly productVersion: string;
  /** Commit under test, when discoverable. `unknown` is honest, not fatal. */
  readonly commit: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly environment: EvaluationEnvironment;
  readonly configuration: EvaluationConfiguration;
  /** Digest of the scenario registry — detects unversioned scenario edits. */
  readonly registryDigest: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario definition
// ═══════════════════════════════════════════════════════════════════════════

/** Resource budget for a scenario. Exceeding it is a reported failure, not a hang. */
export interface ScenarioBudget {
  readonly wallClockMs: number;
  /** Maximum external effects the scenario is allowed to produce. */
  readonly maxEffects: number;
}

/**
 * Effects a scenario is permitted to produce. Anything outside this set trips
 * a safety gate. This is how "accidental cloud dependence" is caught.
 */
export interface AllowedEffects {
  readonly network: boolean;
  readonly processSpawn: boolean;
  readonly fsWriteInsideFixture: boolean;
  readonly credentialAccess: boolean;
}

export const NO_EXTERNAL_EFFECTS: AllowedEffects = Object.freeze({
  network: false,
  processSpawn: false,
  fsWriteInsideFixture: true,
  credentialAccess: false,
});

/** What the harness hands a scenario at execution time. */
export interface ScenarioContext {
  /** Isolated fixture root. Never a real user workspace. */
  readonly fixtureRoot: string;
  /** Records an effect. Gates read these. */
  readonly recordEffect: (e: Omit<RecordedEffect, "at">) => void;
  /** Records a metric sample. */
  readonly recordMetric: (m: MetricSample) => void;
  /** Adds a redacted evidence note. */
  readonly note: (text: string) => void;
  /** Deterministic clock for reproducibility. */
  readonly now: () => number;
  /** Deterministic pseudo-random source, seeded per scenario. */
  readonly random: () => number;
  /** True when the harness is running in offline mode. */
  readonly offline: boolean;
  /** The deployment profile this run targets. */
  readonly deploymentProfile: string;
}

/** What a scenario returns. The harness — not the scenario — decides the status. */
export interface ScenarioOutcome {
  /**
   * Verifications the scenario performed. A scenario CANNOT self-declare
   * "passed"; it reports verifications and the runner adjudicates.
   */
  readonly verifications: readonly VerificationResult[];
  /** Optional explicit not-applicable signal with a reason. */
  readonly notApplicable?: string;
  /** Optional declaration that the useful outcome was only partly achieved. */
  readonly partialReason?: string;
  /** Additional redacted evidence for the report. */
  readonly evidence?: readonly string[];
}

export interface ScenarioDefinition {
  readonly id: string;
  /**
   * Scenario version. MUST be bumped when the task, fixture, or expected
   * outcome changes. `governance.ts` enforces this.
   */
  readonly version: number;
  readonly title: string;
  /** The realistic task being represented. */
  readonly intent: string;
  /** What a correct outcome looks like, in plain language. */
  readonly expectedOutcome: string;
  readonly dimension: EvaluationDimension;
  readonly set: ScenarioSet;
  readonly determinism: DeterminismKind;
  /** Contracts this scenario exercises — used for the contract map. */
  readonly contracts: readonly string[];
  /** Deployment profiles this scenario applies to. Empty = all. */
  readonly profiles: readonly string[];
  /** True when the scenario runs with no network at all. */
  readonly offlineCapable: boolean;
  readonly allowedEffects: AllowedEffects;
  readonly budget: ScenarioBudget;
  /** Known blind spots — surfaced in the report, never hidden. */
  readonly blindSpots: readonly string[];
  /** The scenario body. */
  readonly run: (ctx: ScenarioContext) => Promise<ScenarioOutcome> | ScenarioOutcome;
}

export interface SuiteDefinition {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly dimension: EvaluationDimension;
  readonly description: string;
  readonly scenarios: readonly ScenarioDefinition[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════════════

export interface ScenarioResult {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly suiteId: string;
  readonly dimension: EvaluationDimension;
  readonly set: ScenarioSet;
  readonly determinism: DeterminismKind;
  readonly status: ScenarioStatus;
  /** Why the status is what it is. Always populated. */
  readonly statusReason: string;
  readonly verifications: readonly VerificationResult[];
  readonly gates: readonly SafetyGateResult[];
  readonly metrics: readonly MetricSample[];
  readonly effects: readonly RecordedEffect[];
  readonly evidence: readonly string[];
  readonly confidence: Confidence;
  readonly durationMs: number;
  readonly startedAt: number;
  /** Populated only for `errored`. Redacted. */
  readonly error?: string;
}

export interface SuiteResult {
  readonly suiteId: string;
  readonly suiteVersion: number;
  readonly dimension: EvaluationDimension;
  readonly scenarios: readonly ScenarioResult[];
  readonly durationMs: number;
}

export interface EvaluationRun {
  readonly provenance: RunProvenance;
  readonly suites: readonly SuiteResult[];
  /** Integrity hash over the canonical result body. */
  readonly integrity: ResultIntegrity;
  /**
   * Set when a run has been invalidated (scenario/config integrity
   * compromised). Invalidated runs are PRESERVED and marked, never deleted.
   */
  readonly invalidation?: RunInvalidation;
}

export interface ResultIntegrity {
  readonly algorithm: "sha256";
  /** Hash of the canonical JSON body (excluding this field). */
  readonly digest: string;
  /** Hash of the scenario registry that produced it. */
  readonly registryDigest: string;
}

export interface RunInvalidation {
  readonly invalidatedAt: number;
  readonly reason: string;
  readonly invalidatedBy: string;
  /** Transparency requirement: the original result stays readable. */
  readonly originalDigest: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scorecard
// ═══════════════════════════════════════════════════════════════════════════

export interface DimensionScore {
  readonly dimension: EvaluationDimension;
  readonly gating: boolean;
  /** null when nothing applicable ran — never coerced to 0. */
  readonly score: number | null;
  readonly passed: number;
  readonly partial: number;
  readonly failed: number;
  readonly blocked: number;
  readonly notApplicable: number;
  readonly errored: number;
  /** True when a critical gate was violated in this dimension. */
  readonly hardFailure: boolean;
  readonly confidence: Confidence;
  readonly weight: number;
  readonly notes: readonly string[];
}

export interface Scorecard {
  readonly reportVersion: string;
  readonly runId: string;
  readonly productVersion: string;
  readonly generatedAt: number;
  readonly dimensions: readonly DimensionScore[];
  /**
   * Overall quality score across NON-gating and passing-gate dimensions.
   * null when a hard gate failed — XR refuses to publish a headline number
   * that hides a security failure.
   */
  readonly overall: number | null;
  /** True when any critical safety gate was violated anywhere. */
  readonly hardFailure: boolean;
  readonly hardFailures: readonly string[];
  /** Weights are always disclosed alongside the score. */
  readonly weights: Readonly<Record<string, number>>;
  readonly limitations: readonly string[];
  readonly blindSpots: readonly string[];
  /** Explicit statement of what this scorecard does NOT prove. */
  readonly doesNotProve: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Comparison / regression
// ═══════════════════════════════════════════════════════════════════════════

export const REGRESSION_KINDS = [
  "reliability",
  "security",
  "privacy",
  "cost",
  "latency",
  "capability",
  "experience",
  "documentation",
] as const;

export type RegressionKind = (typeof REGRESSION_KINDS)[number];

export interface RegressionFinding {
  readonly kind: RegressionKind;
  readonly dimension: EvaluationDimension;
  readonly scenarioId: string;
  readonly baselineStatus: ScenarioStatus;
  readonly candidateStatus: ScenarioStatus;
  readonly detail: string;
  /** Security/privacy regressions are always `critical`. */
  readonly severity: "critical" | "major" | "minor";
}

export interface ComparisonResult {
  readonly comparable: boolean;
  /** Populated when the runs cannot be compared. */
  readonly incomparableReasons: readonly string[];
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  readonly regressions: readonly RegressionFinding[];
  readonly improvements: readonly RegressionFinding[];
  readonly unchanged: number;
  /** Scenarios present in one run only — never silently ignored. */
  readonly onlyInBaseline: readonly string[];
  readonly onlyInCandidate: readonly string[];
  /** True when overfitting is suspected (dev improves, independent does not). */
  readonly overfittingSuspected: boolean;
  readonly overfittingDetail?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Certification
// ═══════════════════════════════════════════════════════════════════════════

export const CERTIFICATION_TARGETS = [
  "provider",
  "capability",
  "workflow",
  "deployment_profile",
  "runtime_version",
] as const;

export type CertificationTarget = (typeof CERTIFICATION_TARGETS)[number];

export const CERTIFICATION_STATUSES = [
  "certified",
  "provisional",
  "not_certified",
  "expired",
  "revoked",
  "insufficient_evidence",
] as const;

export type CertificationStatus = (typeof CERTIFICATION_STATUSES)[number];

export interface CertificationEvidenceRef {
  /** Which run produced the evidence. */
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly status: ScenarioStatus;
  /** Digest of the run, so evidence cannot be swapped silently. */
  readonly runDigest: string;
}

export interface CertificationRecord {
  readonly version: string;
  readonly certificationId: string;
  readonly target: CertificationTarget;
  readonly subjectId: string;
  readonly subjectVersion: string;
  readonly status: CertificationStatus;
  readonly issuedAt: number;
  /** Certifications always expire. A permanent certification is a lie over time. */
  readonly expiresAt: number;
  /** Product version the certification was issued against. */
  readonly productVersion: string;
  readonly evidence: readonly CertificationEvidenceRef[];
  /** Requirements that were not met, when not certified. */
  readonly unmetRequirements: readonly string[];
  readonly limitations: readonly string[];
  /** Populated on revocation. Preserved for history. */
  readonly revocation?: {
    readonly revokedAt: number;
    readonly reason: string;
    readonly revokedBy: string;
  };
  /**
   * True when certification relied only on the subject's own claims.
   * Independent evidence is required for `certified`.
   */
  readonly selfReportedOnly: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Compatibility
// ═══════════════════════════════════════════════════════════════════════════

export const COMPATIBILITY_SURFACES = [
  "public_api",
  "cli",
  "workflow_definition",
  "capability_manifest",
  "task_capsule",
  "context_package",
  "execution_record",
  "workspace_data",
  "deployment_profile",
  "provider_adapter",
] as const;

export type CompatibilitySurface = (typeof COMPATIBILITY_SURFACES)[number];

export interface CompatibilityCheck {
  readonly surface: CompatibilitySurface;
  readonly id: string;
  readonly description: string;
  readonly compatible: boolean;
  /** `breaking` means a consumer will break; `additive` is safe growth. */
  readonly change: "none" | "additive" | "breaking" | "unknown";
  readonly detail: string;
}

export interface CompatibilityReport {
  readonly productVersion: string;
  readonly generatedAt: number;
  readonly checks: readonly CompatibilityCheck[];
  readonly breakingCount: number;
  readonly compatible: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Claims
// ═══════════════════════════════════════════════════════════════════════════

export const CLAIM_CLASSIFICATIONS = [
  "verified_by_benchmark",
  "verified_by_contract",
  "documented_limitation",
  "unsupported",
  "product_vision",
] as const;

export type ClaimClassification = (typeof CLAIM_CLASSIFICATIONS)[number];

export interface ClaimRecord {
  readonly id: string;
  /** The claim exactly as it appears publicly. */
  readonly statement: string;
  /** Where it appears. */
  readonly sources: readonly string[];
  readonly classification: ClaimClassification;
  /** Scenario ids that substantiate it. Required for benchmark-verified claims. */
  readonly evidenceScenarios: readonly string[];
  /** Tests that substantiate it, for contract-verified claims. */
  readonly evidenceTests: readonly string[];
  /** What the evidence does NOT establish. Always required. */
  readonly doesNotProve: string;
  /** Correction required before the claim may be published as fact. */
  readonly requiredCorrection?: string;
}

export interface ClaimAuditResult {
  readonly generatedAt: number;
  readonly claims: readonly ClaimRecord[];
  readonly unsupported: readonly string[];
  /** True when every non-vision claim has evidence. */
  readonly clean: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Governance
// ═══════════════════════════════════════════════════════════════════════════

export const GAP_CLASSIFICATIONS = [
  "correctness_defect",
  "security_defect",
  "performance_reliability_defect",
  "documentation_ux_defect",
  "future_product_work",
] as const;

export type GapClassification = (typeof GAP_CLASSIFICATIONS)[number];

/**
 * A gap discovered by evaluation. §7.9: evaluation must not create
 * uncontrolled roadmap expansion, so every gap needs a class and an owner.
 */
export interface DiscoveredGap {
  readonly id: string;
  readonly summary: string;
  readonly classification: GapClassification;
  readonly owner: string;
  /** Only the first four classes may be fixed inside a measurement phase. */
  readonly fixableInPhase: boolean;
  readonly detail: string;
}

export interface ScenarioChangeRecord {
  readonly scenarioId: string;
  readonly fromVersion: number | null;
  readonly toVersion: number;
  readonly reason: string;
  readonly approvedBy: string;
  readonly at: number;
  /** Prior results are invalidated for comparison when semantics changed. */
  readonly invalidatesPriorResults: boolean;
}
