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
