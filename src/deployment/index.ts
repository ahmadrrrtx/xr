/**
 * XR 6.0 — Local, Cloud, and Hybrid Operating Plane
 *
 * This module is the public entry point for all deployment functionality.
 * It provides deployment profiles, task capsules, placement, workers,
 * identity, synchronization, offline mode, data residency, and backup.
 *
 * One XR semantics across all deployment modes.
 */

// ── Core Types ─────────────────────────────────────────────────────────
export type {
  // Deployment profiles
  DeploymentProfileKind,
  DeploymentProfile,
  DeploymentCapabilities,
  IdentityModelKind,
  DataPathConfig,
  RecoveryConfig,
  // Task capsules
  TaskCapsule,
  CapsuleIntent,
  CapsuleAuthority,
  CapsulePlacement,
  CapsuleContext,
  CapsuleRequirements,
  CapsuleLimits,
  CapsuleRecovery,
  CapsuleArtifactRef,
  CapsuleProvenance,
  CapsuleResidency,
  CapsuleSignature,
  ContextRef,
  PlacementRequirement,
  PlacementExclusion,
  CapsuleWorkflowRef,
  TransferRecord,
  // Workers
  WorkerIdentity,
  WorkerState,
  WorkerRegistration,
  WorkerHeartbeat,
  WorkerHealthReport,
  WorkerHealthCheck,
  WorkerHardwareProfile,
  WorkerEndpoint,
  WorkerAttestation,
  WorkerResourceUsage,
  // Control/Data plane
  PlaneKind,
  PlaneIdentity,
  ControlPlaneConfig,
  DataPlaneConfig,
  DataPlaneBackend,
  // Placement
  PlacementDecision,
  PlacementPolicyInput,
  PlacementExplanation,
  PlacementFactor,
  PlacementOption,
  PlacementUserOverride,
  // Identity/Tenancy
  OrganizationIdentity,
  TenantBoundary,
  RemoteIdentity,
  // Sync
  SyncDirection,
  SyncState,
  SyncConfig,
  SyncOperation,
  SyncEntityType,
  SyncConflict,
  ConflictResolution,
  ConflictResolutionStrategy,
  SyncRetryPolicy,
  // Residency
  DataClassification,
  ResidencyPolicy,
  ResidencyDecision,
  RetentionPolicy,
  RetentionRule,
  ClassificationRule,
  // Failure
  FailureKind,
  FailureEvent,
  FailureResolution,
  // Status
  DeploymentStatus,
  PlaneStatus,
  DataPlaneStatus,
  WorkerStatusSummary,
  SyncStatusSummary,
  ResidencyStatusSummary,
  OfflineStatusSummary,
  DeploymentHealthSummary,
  DeploymentIssue,
} from "./types.ts";

export {
  DEPLOYMENT_BOUNDS,
  CAPSULE_SCHEMA_VERSION,
  DEPLOYMENT_ADAPTER_VERSION,
} from "./types.ts";

// ── Profiles ───────────────────────────────────────────────────────────
export {
  getDeploymentProfile,
  listDeploymentProfiles,
  isValidProfileKind,
  defaultProfileForEnvironment,
  validateProfileCompatibility,
  isCapabilityAvailable,
} from "./profiles.ts";

// ── Capsules ───────────────────────────────────────────────────────────
export {
  buildCapsule,
  serializeCapsule,
  deserializeCapsule,
  verifyCapsuleIntegrity,
  isCompatibleCapsuleVersion,
  redactCapsuleForControlPlane,
  redactCapsuleForAudit,
  recordCapsuleTransfer,
  isCapsuleExpired,
  isCapsuleCompatibleWithProfile,
  CapsuleValidationError,
  CapsuleIntegrityError,
} from "./capsule.ts";
export type { CapsuleBuildInput } from "./capsule.ts";

// ── Placement ──────────────────────────────────────────────────────────
export { PlacementEngine } from "./placement/engine.ts";

// ── Workers ────────────────────────────────────────────────────────────
export {
  WorkerRegistry,
  WorkerNotFoundError,
  WorkerRegistrationError,
  WorkerLifecycleError,
} from "./workers/registry.ts";
export type { WorkerRegistryDeps } from "./workers/registry.ts";

// ── Control Plane ──────────────────────────────────────────────────────
export { ControlPlaneService } from "./control-plane/service.ts";
export type { ControlPlaneServiceDeps } from "./control-plane/service.ts";

// ── Sync ───────────────────────────────────────────────────────────────
export { SyncEngine, SyncError } from "./sync/engine.ts";
export type { SyncEngineDeps, SyncVersionedEntity } from "./sync/engine.ts";

// ── Offline ────────────────────────────────────────────────────────────
export { OfflineService } from "./offline/service.ts";
export type { OfflineServiceDeps, OfflineQueuedTask, OfflineStatus } from "./offline/service.ts";

// ── Residency ──────────────────────────────────────────────────────────
export {
  ResidencyPolicyEngine,
  defaultResidencyPolicy,
  defaultRetentionPolicy,
} from "./residency/policy.ts";

// ── Identity ───────────────────────────────────────────────────────────
export { IdentityService } from "./identity/service.ts";
export type { IdentityServiceDeps } from "./identity/service.ts";

// ── Backup ─────────────────────────────────────────────────────────────
export { BackupService } from "./backup/service.ts";
export type {
  BackupServiceDeps,
  BackupManifest,
  BackupComponent,
  BackupComponentKind,
  BackupResult,
  RestoreResult,
  ExportResult,
} from "./backup/service.ts";
