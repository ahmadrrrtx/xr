/**
 * XR 4.4 — Universal Intelligence Plane public exports.
 */

export * from "./types.ts";
export * from "./capability.ts";
export {
  buildCatalog,
  findModel,
  findProvider,
  modelsForClass,
  listProviderIds,
  modelKey,
  type IntelligenceCatalog,
} from "./catalog.ts";
export { evaluateCandidate, evaluateAll } from "./evaluator.ts";
export {
  scoreCandidate,
  rankCandidates,
  DEFAULT_WEIGHTS,
  type ScoreWeights,
  type ScoreContext,
} from "./scorer.ts";
export {
  IntelligenceMetrics,
  getDefaultMetrics,
  setDefaultMetrics,
  resetDefaultMetrics,
  confidenceFromSamples,
} from "./metrics.ts";
export {
  buildFallbackChain,
  mayFallbackOnTrigger,
  nextFallback,
  advanceFallbackChain,
  type FallbackTrigger,
  type FallbackPlan,
} from "./fallback.ts";
export {
  IntelligenceRouter,
  policyFromConfig,
  mergeRequirements,
  routingDecisionToRecord,
} from "./router.ts";
export {
  IntelligenceService,
  IntelligenceRoutingError,
  type ResolveProviderResult,
} from "./service.ts";

// ── Phase 5 — AI Orchestration & Routing Quality ──────────────────────────
export {
  estimateDifficulty,
  difficultyLabel,
  fidelityFloorFor,
  type DifficultyEstimate,
  type DifficultyOptions,
} from "./difficulty.ts";
export {
  BehavioralStore,
  BehavioralEvaluator,
  behavioralView,
  confidenceFromProbeSamples,
  OVERALL_WEIGHTS,
  type BehavioralContract,
  type BehavioralView,
  type ContractSource,
  type ProbeOutcome,
  type EvaluateOptions,
} from "./behavioral.ts";
export {
  RoutingHealth,
  healthView,
  DEFAULT_BREAKER_CONFIG,
  type BreakerConfig,
  type BreakerState,
  type HealthGate,
  type Permit,
  type TripEvent,
  type RoutingHealthView,
} from "./health.ts";
export {
  ResilientProvider,
  RoutingEscalationError,
  SemanticFailure,
  classifyError,
  backoffDelay,
  redactSecrets,
  validateTurn,
  outcomeSampleFor,
  DEFAULT_RETRY_POLICY,
  type ErrorClass,
  type ClassifiedError,
  type RetryPolicy,
  type DegradationLevel,
  type FailoverAttempt,
  type FailoverRecord,
  type EscalationPackage,
  type ProviderOutcome,
  type ResilientDeps,
  type ResilientTarget,
} from "./degradation.ts";
export {
  RoutingSlo,
  getDefaultSlo,
  setDefaultSlo,
  SELECTION_BUDGET_MS,
  type SloEvent,
  type RoutingSloReport,
} from "./slo.ts";
export {
  contextManifest,
  anchorsPresent,
  serializeConversation,
  aggregateCpr,
  CPR_TARGET,
  type ContextManifest,
} from "./failover.ts";
