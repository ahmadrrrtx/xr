/**
 * XR 7.0 — Evaluation subsystem public barrel (Phase 13, "XR OS Supremacy").
 *
 * XR's evaluation layer: outcome-based benchmarks, hard safety gates,
 * evidence-backed certification, compatibility contracts, longitudinal
 * regression detection, and claim/evidence governance.
 *
 * Design boundary: this subsystem MEASURES the platform. It never becomes a
 * second runtime, workflow engine, policy system, or telemetry pipeline, and
 * it never mutates real user workspaces.
 */

// ── Model ────────────────────────────────────────────────────────────────
export * from "./types.ts";

// ── Provenance & integrity ───────────────────────────────────────────────
export {
  canonicalize,
  digest,
  redactEvidence,
  captureEnvironment,
  detectIsolationBackends,
  discoverCommit,
  workingTreeDirty,
  buildProvenance,
  buildConfiguration,
  computeIntegrity,
  verifyIntegrity as verifyRunIntegrity,
  seededRandom,
  type BuildProvenanceOptions,
  type CaptureEnvironmentOptions,
} from "./provenance.ts";

// ── Metrics ──────────────────────────────────────────────────────────────
export {
  METRIC_DEFINITIONS,
  MetricCollector,
  getMetricDefinition,
  listMetricDefinitions,
  assertNoConflictingMetrics,
  meanOf,
  sumOf,
} from "./metrics.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────
export {
  FixtureWorkspace,
  assertNotRealUserHome,
  fixtureRegistryDigest,
  getFixture,
  ALL_FIXTURES,
  ADVERSARIAL_FIXTURE,
  KNOWLEDGE_FIXTURE,
  KNOWLEDGE_GROUND_TRUTH,
  PROJECT_FIXTURE,
  SYNTHETIC_SECRET_FIXTURE,
  type FixtureFile,
  type FixtureSpec,
} from "./fixtures.ts";

// ── Effects ──────────────────────────────────────────────────────────────
export {
  EffectRecorder,
  findEffectViolations,
  summarizeEffects,
  type EffectViolation,
} from "./effects.ts";

// ── Verification ─────────────────────────────────────────────────────────
export {
  verifyArtifact,
  verifyState,
  verifyPredicate,
  verifyRecords,
  verifyPolicy,
  verifyEvidence,
  verifySideEffects,
  verifyComprehension,
  allRequiredSatisfied,
  anyOptionalFailed,
  satisfactionRatio,
  type ArtifactExpectation,
  type StateExpectation,
  type RecordExpectation,
  type PolicyExpectation,
  type EvidenceExpectation,
  type SideEffectExpectation,
  type ComprehensionExpectation,
} from "./verifiers.ts";

// ── Safety gates ─────────────────────────────────────────────────────────
export {
  evaluateSafetyGates,
  hasCriticalViolation,
  violatedGates,
  gatesHeldRatio,
  type GateInput,
} from "./gates.ts";

// ── Scoring ──────────────────────────────────────────────────────────────
export {
  DIMENSION_WEIGHTS,
  buildScorecard,
  scoreDimension,
  deriveConfidence,
  assertNoHiddenCriticalFailure,
  type ScorecardOptions,
} from "./scoring.ts";

// ── Runner ───────────────────────────────────────────────────────────────
export {
  EvaluationRunner,
  executeScenario,
  adjudicate,
  type RunOptions,
  type ExecuteScenarioOptions,
} from "./runner.ts";

// ── Storage ──────────────────────────────────────────────────────────────
export {
  EvaluationRepository,
  adaptStoreForEvaluation,
  type EvaluationDb,
  type StoredRun,
  type RunQuery,
} from "./repository.ts";

// ── Comparison / regression ──────────────────────────────────────────────
export {
  compareRuns,
  checkComparable,
  detectOverfitting,
  evaluateRegressionGate,
  type RegressionGate,
} from "./comparison.ts";

// ── Certification ────────────────────────────────────────────────────────
export {
  CERTIFICATION_REQUIREMENTS,
  DEFAULT_CERTIFICATION_VALIDITY_MS,
  certify,
  certifyCapability,
  effectiveStatus,
  isValidNow,
  revoke,
  revokeForInvalidatedRun,
  assertNoExternalAccreditationClaim,
  type CertifyOptions,
  type CertificationRequirement,
} from "./certification.ts";

// ── Compatibility ────────────────────────────────────────────────────────
export {
  XR_7_0_CONTRACT_BASELINE,
  buildCompatibilityReport,
  checkPublicApi,
  checkCli,
  checkSchemas,
  checkDeploymentProfiles,
  checkWorkflowLegacyDefinitions,
  type ContractBaseline,
} from "./compatibility.ts";

// ── Claims ───────────────────────────────────────────────────────────────
export {
  XR_CLAIMS,
  auditClaims,
  assertNoUnsupportedSuperiorityClaim,
  pendingCorrections,
} from "./claims.ts";

// ── Governance ───────────────────────────────────────────────────────────
export {
  PHASE13_DISCOVERED_GAPS,
  fingerprintScenario,
  fingerprintSuites,
  detectUnversionedChanges,
  assertNoUnversionedChanges,
  recordScenarioChange,
  classifyGap,
  assertNoScopeCreep,
  type ScenarioFingerprint,
  type ChangeFinding,
} from "./governance.ts";

// ── Reporting ────────────────────────────────────────────────────────────
export {
  buildRawReport,
  buildEvidenceBundle,
  verifyEvidenceBundle,
  renderScorecard,
  renderScenarioDetail,
  renderComparison,
  scorecardJson,
  type RawReport,
  type EvidenceBundle,
} from "./report.ts";

// ── Suites ───────────────────────────────────────────────────────────────
export {
  ALL_SUITES,
  getSuite,
  listSuiteIds,
  totalScenarios,
  offlineScenarioIds,
} from "./suites/index.ts";
