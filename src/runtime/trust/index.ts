/**
 * XR 4.2 — Trust and Isolation subsystem barrel.
 */
export * from "./types.ts";
export { classifyRisk, sensitiveBlockedPaths } from "./classify.ts";
export { decidePlacement, minPlacementForTier, type PlacementCapabilities, type PlacementPolicyConfig } from "./policy.ts";
export { AuthorityRegistry, createGrant, validateGrant, type GrantParams, type GrantValidity } from "./authority.ts";
export { CredentialBroker } from "./credentials.ts";
export { clampResources, NO_ENFORCEMENT, type ResourceEnforcement } from "./resources.ts";
export { shellTrustSpec, type ShellTrustSpecOptions } from "./tool-support.ts";
export { verifyEnvironment, type VerifyInput } from "./verify.ts";
export { TrustService, type TrustServiceDeps, type TrustEvaluation, type TrustOutcome, type EvaluateParams } from "./service.ts";
export { EnvironmentManager, type BackendAvailability, type ExecuteInEnvironmentInput, type ExecuteInEnvironmentOutput } from "./environment/manager.ts";
export type { EnvironmentBackend, BackendRunContext } from "./environment/backend.ts";
export { InProcessBackend } from "./environment/in-process.ts";
export { RestrictedProcessBackend } from "./environment/restricted-process.ts";
export { NamespaceSandboxBackend } from "./environment/namespace.ts";
export { ContainerBackend } from "./environment/container.ts";
