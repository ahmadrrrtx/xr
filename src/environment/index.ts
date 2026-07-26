/**
 * XR 5.1 — Environment Interaction OS (public surface).
 */
export * from "./types.ts";
export {
  transitionSession,
  EnvironmentSessionRegistry,
  environmentSessions,
  type TransitionResult,
} from "./lifecycle.ts";
export {
  assessEnvironmentAction,
  environmentForAction,
  interactionFor,
  reversibilityFor,
  compensationFor,
} from "./classify.ts";
export {
  runEnvironmentAction,
  observeEnvironment,
  openEnvironmentSession,
  closeEnvironmentSession,
  listEnvironmentSessions,
  environmentStatus,
  environmentHistory,
  environmentDisabled,
  getEnvironmentConfig,
  visionCloudDecision,
  detectEnvironmentCapabilities,
  capabilityFor,
  type RunEnvironmentOptions,
  type RunEnvironmentResult,
  type ObserveOptions,
} from "./service.ts";
export { environmentObservations } from "./observations.ts";
export { redactSecrets, redactEnvironmentAction, checkCloudConsent } from "./privacy.ts";
export { classifyFailure, decideRecovery, recordOutcomeOnCircuit, circuitState, newRecoveryBudget } from "./recovery.ts";
export { buildEnvironmentActionNode, idempotencyFor, riskTierFor } from "./workflow-binding.ts";
export { gateVoiceControlAction } from "./providers/voice.ts";
export { decideVisionRouting } from "./providers/vision.ts";
export { capturePreImage, describeCompensation, isInsideWorkspace } from "./providers/filesystem.ts";
