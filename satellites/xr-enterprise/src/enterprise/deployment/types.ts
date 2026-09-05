/**
 * XR 6.0 — Local, Cloud, and Hybrid Operating Plane: Core Deployment Types
 *
 * This is THE single source of truth for deployment profiles, task capsules,
 * placement, identity, tenancy, synchronization, and resilience contracts.
 *
 * Design rules:
 *   - One XR semantics across all deployment modes.
 *   - Cloud/remote extends XR's operating plane; it does NOT create a second semantics.
 *   - Control plane must not automatically receive sensitive payloads.
 *   - Capsules do not embed raw secrets.
 *   - Everything is safe to serialize — no secrets, no file handles, no unbounded payloads.
 *   - All contracts are versioned for forward/backward compatibility.
 *
 * Phase 11 builds on Phases 1–10 contracts:
 *   - Execution fabric (Phase 2) — Placement extended with remote kinds
 *   - Trust/Isolation (Phase 3) — authority and risk tiers preserved
 *   - Durable agency (Phase 4) — checkpoints/leases/recovery preserved
 *   - Intelligence plane (Phase 5) — routing preserved, locality-aware
 *   - Knowledge/context (Phase 6) — provenance preserved across transfers
 *   - Workflow OS (Phase 7) — workflow portability
 *   - Capability ecosystem (Phase 9) — capability metadata preserved
 *   - Business operating layer (Phase 10) — outcome/authority preserved
 */

import type { ExecutionId, ActorIdentity, CapabilityIdentity, Placement } from "@xr/core/execution/types.ts";
import type { RiskTier, AuthorityGrant } from "@xr/core/runtime/trust/types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// 1. Deployment Profiles
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The five supported deployment profiles. Each declares its capabilities,
 * limitations, identity model, data paths, and recovery semantics.
 */
export type DeploymentProfileKind =
  | "personal_local"       // Single machine, no cloud dependency
  | "private_local_server" // One trusted local/private server
  | "team_private"         // Multiple users/workspaces with private workers
  | "managed_cloud"        // Hosted control/data plane
  | "hybrid";              // Local-sensitive + remote-approved

export interface DeploymentProfile {
  readonly kind: DeploymentProfileKind;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  /** What capabilities this profile supports. */
  readonly capabilities: DeploymentCapabilities;
  /** What this profile cannot do. */
  readonly limitations: readonly string[];
  /** Identity model for this profile. */
  readonly identityModel: IdentityModelKind;
  /** Data storage paths. */
  readonly dataPaths: DataPathConfig;
  /** Whether offline operation is supported. */
  readonly offlineSupported: boolean;
  /** Whether remote workers are supported. */
  readonly remoteWorkersSupported: boolean;
  /** Whether multi-user is supported. */
  readonly multiUserSupported: boolean;
  /** Recovery/backup requirements. */
  readonly recovery: RecoveryConfig;
}

export interface DeploymentCapabilities {
  readonly localExecution: boolean;
  readonly remoteExecution: boolean;
  readonly hybridPlacement: boolean;
  readonly multiWorkspace: boolean;
  readonly organizationTenancy: boolean;
  readonly dataResidency: boolean;
  readonly offlineMode: boolean;
  readonly workerPool: boolean;
  readonly controlPlane: boolean;
  readonly managedBackups: boolean;
}

export type IdentityModelKind =
  | "single_user_local"
  | "private_token"
  | "workspace_scoped"
  | "organization_rbac"
  | "managed_auth";

export interface DataPathConfig {
  readonly stateRoot: string;
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly cacheRoot: string;
  readonly logRoot: string;
  readonly backupRoot?: string;
  readonly remoteDataPolicy: "local_only" | "local_preferred" | "cloud_allowed" | "cloud_required";
}

export interface RecoveryConfig {
  readonly localBackupSupported: boolean;
  readonly remoteReplicationSupported: boolean;
  readonly disasterRecoverySupported: boolean;
  readonly rpoMinutes?: number;
  readonly rtoMinutes?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Portable Task Capsules
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A portable, versioned, integrity-checked representation of a unit of work
 * that can move between local, private, and remote placements without losing
 * authority, provenance, or policy semantics.
 *
 * Capsules NEVER embed raw secrets. Credentials are referenced by opaque ref
 * and resolved at the execution boundary by the credential broker.
 */
export interface TaskCapsule {
  /** Capsule format version for compatibility checks. */
  readonly schemaVersion: string;
  /** Unique capsule identifier. */
  readonly capsuleId: string;
  /** Creation timestamp (ms). */
  readonly createdAt: number;
  /** The execution identity this capsule carries. */
  readonly executionId: ExecutionId;
  /** Who initiated the work. */
  readonly actor: ActorIdentity;
  /** Human-readable intent/goal (safe, no secrets). */
  readonly intent: CapsuleIntent;
  /** Workflow reference (if part of a workflow). */
  readonly workflowRef?: CapsuleWorkflowRef;
  /** Authority/policy references. */
  readonly authority: CapsuleAuthority;
  /** Placement requirements and preferences. */
  readonly placement: CapsulePlacement;
  /** Context package references (not raw context). */
  readonly context: CapsuleContext;
  /** Capability/provider requirements. */
  readonly requirements: CapsuleRequirements;
  /** Cost/resource limits. */
  readonly limits: CapsuleLimits;
  /** Checkpoint/recovery state (when capsule is a transfer/resume). */
  readonly recovery?: CapsuleRecovery;
  /** Artifact references (not raw artifact data). */
  readonly artifacts: readonly CapsuleArtifactRef[];
  /** Audit/provenance chain. */
  readonly provenance: CapsuleProvenance;
  /** Data residency/retention rules. */
  readonly residency: CapsuleResidency;
  /** Integrity hash of the capsule payload. */
  readonly integrityHash: string;
  /** Signature (when signed by control plane). */
  readonly signature?: CapsuleSignature;
}

export interface CapsuleIntent {
  readonly summary: string;
  readonly mode: "agent" | "plan" | "ask" | "control" | "research" | "business";
  readonly constraints?: {
    readonly dryRun?: boolean;
    readonly timeoutMs?: number;
    readonly maxAttempts?: number;
    readonly budgetUsd?: number;
  };
}

export interface CapsuleWorkflowRef {
  readonly definitionId: string;
  readonly version: number;
  readonly nodeId?: string;
  readonly runId?: string;
}

export interface CapsuleAuthority {
  readonly policyVersion: string;
  readonly riskTier: RiskTier;
  readonly approvalRef?: string;
  readonly grantRef?: string;
  readonly permissionsHash?: string;
}

export interface CapsulePlacement {
  readonly required: readonly PlacementRequirement[];
  readonly preferred: readonly PlacementRequirement[];
  readonly excluded: readonly PlacementExclusion[];
  readonly allowRemote: boolean;
  readonly allowLocal: boolean;
}

export interface PlacementRequirement {
  readonly kind: string;
  readonly value: string;
  readonly reason: string;
}

export interface PlacementExclusion {
  readonly kind: string;
  readonly value: string;
  readonly reason: string;
}

export interface CapsuleContext {
  /** References to context packages (memory, knowledge, evidence). */
  readonly contextRefs: readonly ContextRef[];
  /** Consent scope for context usage. */
  readonly consentScope: string;
  /** Whether sensitive context may be transferred. */
  readonly sensitiveContextTransfer: boolean;
}

export interface ContextRef {
  readonly kind: "memory" | "knowledge" | "evidence" | "artifact" | "instruction";
  readonly refId: string;
  readonly scope: string;
  readonly trustLevel: "trusted" | "quarantined";
}

export interface CapsuleRequirements {
  readonly capabilities: readonly string[];
  readonly providers: readonly string[];
  readonly modalities: readonly string[];
  readonly hardware?: {
    readonly gpuRequired?: boolean;
    readonly minMemoryMb?: number;
  };
}

export interface CapsuleLimits {
  readonly maxCostUsd: number;
  readonly maxDurationMs: number;
  readonly maxTokens?: number;
  readonly maxRetries: number;
}

export interface CapsuleRecovery {
  readonly checkpointId?: string;
  readonly lastKnownState: string;
  readonly sideEffectSafe: boolean;
  readonly resumable: boolean;
}

export interface CapsuleArtifactRef {
  readonly kind: string;
  readonly ref: string;
  readonly hash?: string;
  readonly transferPolicy: "reference_only" | "encrypted" | "scoped" | "full";
}

export interface CapsuleProvenance {
  readonly originInstanceId: string;
  readonly originWorkspaceId: string;
  readonly originProfile: DeploymentProfileKind;
  readonly transferChain: readonly TransferRecord[];
  readonly auditTrailRef: string;
}

export interface TransferRecord {
  readonly from: string;
  readonly to: string;
  readonly at: number;
  readonly reason: string;
  readonly approvedBy?: string;
}

export interface CapsuleResidency {
  readonly allowedRegions: readonly string[];
  readonly forbiddenRegions: readonly string[];
  readonly retentionDays: number;
  readonly dataClassification: "public" | "internal" | "confidential" | "restricted";
  readonly mustNotLeaveOrigin: boolean;
}

export interface CapsuleSignature {
  readonly algorithm: string;
  readonly signedBy: string;
  readonly signedAt: number;
  readonly signature: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Worker Identity and Registration
// ═══════════════════════════════════════════════════════════════════════════

export type WorkerState =
  | "registering"
  | "attesting"
  | "active"
  | "draining"
  | "drained"
  | "revoked"
  | "offline"
  | "quarantined";

export interface WorkerIdentity {
  readonly workerId: string;
  readonly instanceId: string;
  readonly profile: DeploymentProfileKind;
  readonly registeredAt: number;
  readonly lastSeenAt: number;
  readonly state: WorkerState;
  readonly capabilities: readonly string[];
  readonly hardwareProfile?: WorkerHardwareProfile;
  readonly networkEndpoint?: WorkerEndpoint;
  readonly attestation?: WorkerAttestation;
  readonly revokedAt?: number;
  readonly revokeReason?: string;
}

export interface WorkerHardwareProfile {
  readonly cpuCores: number;
  readonly memoryMb: number;
  readonly gpuAvailable: boolean;
  readonly gpuModel?: string;
  readonly diskGb?: number;
}

export interface WorkerEndpoint {
  readonly protocol: "https" | "wss" | "grpc";
  readonly host: string;
  readonly port: number;
  readonly path?: string;
}

export interface WorkerAttestation {
  readonly method: "self_signed" | "ca_signed" | "tpm" | "hardware_token";
  readonly publicKeyFingerprint: string;
  readonly attestedAt: number;
  readonly expiresAt: number;
  readonly verified: boolean;
}

export interface WorkerRegistration {
  readonly workerId: string;
  readonly profile: DeploymentProfileKind;
  readonly endpoint: WorkerEndpoint;
  readonly capabilities: readonly string[];
  readonly hardware?: WorkerHardwareProfile;
  readonly attestation: WorkerAttestation;
  readonly workspaceIds: readonly string[];
  readonly organizationId?: string;
  readonly requestedAt: number;
}

export interface WorkerHeartbeat {
  readonly workerId: string;
  readonly instanceId: string;
  readonly at: number;
  readonly state: WorkerState;
  readonly activeTaskCount: number;
  readonly activeTaskIds: readonly string[];
  readonly health: WorkerHealthReport;
  readonly resourceUsage?: WorkerResourceUsage;
}

export interface WorkerHealthReport {
  readonly ok: boolean;
  readonly checks: readonly WorkerHealthCheck[];
  readonly uptimeMs: number;
  readonly lastErrorAt?: number;
  readonly lastErrorMessage?: string;
}

export interface WorkerHealthCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
  readonly durationMs?: number;
}

export interface WorkerResourceUsage {
  readonly cpuPercent: number;
  readonly memoryUsedMb: number;
  readonly memoryTotalMb: number;
  readonly diskUsedMb?: number;
  readonly diskTotalMb?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Control Plane / Data Plane Separation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Control plane: identity, scheduling/placement decisions, policy, workflow
 * metadata, status. Does NOT automatically receive sensitive payloads.
 *
 * Data plane: actual model/tool/environment execution and sensitive data.
 *
 * Local plane: offline/local operation and cached state.
 */
export type PlaneKind = "control" | "data" | "local";

export interface PlaneIdentity {
  readonly planeId: string;
  readonly kind: PlaneKind;
  readonly profile: DeploymentProfileKind;
  readonly endpoint?: string;
  readonly trustLevel: "self" | "private" | "managed" | "untrusted";
}

export interface ControlPlaneConfig {
  readonly enabled: boolean;
  readonly endpoint?: string;
  readonly trustLevel: "self" | "private" | "managed";
  /** Whether the control plane may receive task summaries (not raw data). */
  readonly summaryOnly: boolean;
  /** Whether the control plane may receive context references. */
  readonly contextRefsAllowed: boolean;
  /** Whether the control plane may receive artifacts. */
  readonly artifactsAllowed: boolean;
  /** Maximum heartbeat interval for workers. */
  readonly heartbeatIntervalMs: number;
  /** Worker registration policy. */
  readonly workerRegistration: "auto" | "manual" | "admin_approved";
}

export interface DataPlaneConfig {
  readonly executionBackends: readonly DataPlaneBackend[];
  readonly defaultBackend: string;
  readonly sensitiveDataHandling: "local_only" | "encrypted_transfer" | "allowed";
}

export interface DataPlaneBackend {
  readonly backendId: string;
  readonly kind: "local_process" | "local_container" | "private_worker" | "cloud_worker";
  readonly endpoint?: string;
  readonly trustLevel: "self" | "private" | "managed";
  readonly regions?: readonly string[];
  readonly capabilities: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Placement Policy
// ═══════════════════════════════════════════════════════════════════════════

export type PlacementDecision =
  | { kind: "local"; reason: string; placement: Placement }
  | { kind: "private_worker"; workerId: string; reason: string }
  | { kind: "cloud_worker"; workerId: string; reason: string }
  | { kind: "blocked"; reason: string; remediation?: string }
  | { kind: "deferred"; reason: string; retryAfterMs?: number };

export interface PlacementPolicyInput {
  readonly capsule: TaskCapsule;
  readonly currentProfile: DeploymentProfileKind;
  readonly availableWorkers: readonly WorkerIdentity[];
  readonly userOverrides?: PlacementUserOverride;
  readonly currentWorkerHealth: readonly WorkerHealthReport[];
}

export interface PlacementUserOverride {
  readonly forceLocal?: boolean;
  readonly forceWorker?: string;
  readonly excludeWorkers?: readonly string[];
  readonly preferRegion?: string;
}

export interface PlacementExplanation {
  readonly decision: PlacementDecision;
  readonly factors: readonly PlacementFactor[];
  readonly alternativeOptions: readonly PlacementOption[];
  readonly policyVersion: string;
  readonly decidedAt: number;
}

export interface PlacementFactor {
  readonly name: string;
  readonly weight: number;
  readonly score: number;
  readonly reason: string;
}

export interface PlacementOption {
  readonly kind: string;
  readonly workerId?: string;
  readonly score: number;
  readonly reasons: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Identity and Tenancy
// ═══════════════════════════════════════════════════════════════════════════

export interface OrganizationIdentity {
  readonly organizationId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly plan: "personal" | "team" | "enterprise";
  readonly maxWorkspaces: number;
  readonly maxWorkers: number;
  readonly dataResidencyRegion?: string;
}

export interface TenantBoundary {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly isolationLevel: "shared_process" | "shared_db_separate_tables" | "separate_db" | "separate_instance";
  readonly dataBoundary: "workspace" | "organization" | "global";
}

export interface RemoteIdentity {
  readonly identityId: string;
  readonly kind: "user" | "worker" | "service" | "organization";
  readonly organizationId?: string;
  readonly workspaceIds: readonly string[];
  readonly scopes: readonly string[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revoked: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Synchronization
// ═══════════════════════════════════════════════════════════════════════════

export type SyncDirection = "local_to_remote" | "remote_to_local" | "bidirectional" | "local_only";

export type SyncState =
  | "idle"
  | "syncing"
  | "conflict_detected"
  | "resolving"
  | "synced"
  | "offline"
  | "error";

export interface SyncConfig {
  readonly direction: SyncDirection;
  readonly intervalMs: number;
  readonly conflictResolution: ConflictResolutionStrategy;
  readonly maxBatchSize: number;
  readonly retryPolicy: SyncRetryPolicy;
}

export type ConflictResolutionStrategy =
  | "local_wins"
  | "remote_wins"
  | "manual"
  | "merge_safe_fields"
  | "authoritative_source";

export interface SyncRetryPolicy {
  readonly maxRetries: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  readonly jitterFactor: number;
}

export interface SyncOperation {
  readonly operationId: string;
  readonly direction: SyncDirection;
  readonly entityType: SyncEntityType;
  readonly entityId: string;
  state: SyncState;
  readonly localVersion: number;
  readonly remoteVersion?: number;
  conflict?: SyncConflict;
  readonly startedAt: number;
  completedAt?: number;
  error?: string;
}

export type SyncEntityType =
  | "task_capsule"
  | "execution_record"
  | "checkpoint"
  | "artifact"
  | "workflow_state"
  | "audit_record"
  | "worker_state"
  | "policy_update"
  | "context_ref";

export interface SyncConflict {
  readonly conflictId: string;
  readonly entityType: SyncEntityType;
  readonly entityId: string;
  readonly localVersion: number;
  readonly remoteVersion: number;
  readonly localModifiedAt: number;
  readonly remoteModifiedAt: number;
  resolution?: ConflictResolution;
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface ConflictResolution {
  readonly strategy: ConflictResolutionStrategy;
  readonly winner: "local" | "remote" | "merged";
  readonly mergedPayload?: Record<string, unknown>;
  readonly reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Data Residency and Retention
// ═══════════════════════════════════════════════════════════════════════════

export type DataClassification = "public" | "internal" | "confidential" | "restricted";

export interface ResidencyPolicy {
  readonly allowedRegions: readonly string[];
  readonly forbiddenRegions: readonly string[];
  readonly defaultRetention: RetentionPolicy;
  readonly classificationRules: readonly ClassificationRule[];
}

export interface RetentionPolicy {
  readonly executionRecords: RetentionRule;
  readonly auditRecords: RetentionRule;
  readonly artifacts: RetentionRule;
  readonly contextData: RetentionRule;
  readonly checkpoints: RetentionRule;
}

export interface RetentionRule {
  readonly retentionDays: number;
  readonly archiveAfterDays?: number;
  readonly deleteOnExpiry: boolean;
  readonly legalHoldCapable: boolean;
}

export interface ClassificationRule {
  readonly entityType: string;
  readonly classification: DataClassification;
  readonly residencyRequirement: "origin_only" | "region_pinned" | "any_allowed";
  readonly transferAllowed: boolean;
}

export interface ResidencyDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly classification: DataClassification;
  readonly applicableRegion?: string;
  readonly policyVersion: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Failure Model and Partition Handling
// ═══════════════════════════════════════════════════════════════════════════

export type FailureKind =
  | "network_partition"
  | "worker_crash"
  | "control_plane_outage"
  | "local_runtime_outage"
  | "duplicate_delivery"
  | "delayed_delivery"
  | "credential_expiry"
  | "data_transfer_failure"
  | "provider_outage"
  | "partial_artifact_transfer"
  | "task_unknown_completion"
  | "disk_full"
  | "memory_exhausted";

export interface FailureEvent {
  readonly eventId: string;
  readonly kind: FailureKind;
  readonly source: string;
  readonly targetId?: string;
  readonly detectedAt: number;
  readonly severity: "warning" | "degraded" | "critical";
  readonly description: string;
  readonly autoRecoverable: boolean;
  readonly resolution?: FailureResolution;
}

export interface FailureResolution {
  readonly strategy: "retry" | "failover" | "fallback_local" | "manual_intervention" | "quarantine" | "ignore";
  readonly executedAt: number;
  readonly result: "resolved" | "partial" | "failed" | "pending";
  readonly detail?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Deployment Status (for CLI/daemon/dashboard)
// ═══════════════════════════════════════════════════════════════════════════

export interface DeploymentStatus {
  readonly profile: DeploymentProfileKind;
  readonly profileName: string;
  readonly version: string;
  readonly localPlane: PlaneStatus;
  readonly controlPlane?: PlaneStatus;
  readonly dataPlanes: readonly DataPlaneStatus[];
  readonly workers: readonly WorkerStatusSummary[];
  readonly sync: SyncStatusSummary;
  readonly residency: ResidencyStatusSummary;
  readonly offline: OfflineStatusSummary;
  readonly health: DeploymentHealthSummary;
}

export interface PlaneStatus {
  readonly planeId: string;
  readonly kind: PlaneKind;
  readonly reachable: boolean;
  readonly latencyMs?: number;
  readonly lastHeartbeatAt?: number;
  readonly version?: string;
}

export interface DataPlaneStatus {
  readonly backendId: string;
  readonly kind: string;
  readonly reachable: boolean;
  readonly activeTasks: number;
  readonly queuedTasks: number;
  readonly lastHeartbeatAt?: number;
}

export interface WorkerStatusSummary {
  readonly workerId: string;
  readonly state: WorkerState;
  readonly activeTasks: number;
  readonly lastHeartbeatAt: number;
  readonly healthOk: boolean;
}

export interface SyncStatusSummary {
  readonly state: SyncState;
  readonly lastSyncAt?: number;
  readonly pendingOps: number;
  readonly conflicts: number;
  readonly errors: number;
}

export interface ResidencyStatusSummary {
  readonly policyVersion: string;
  readonly entitiesInViolation: number;
  readonly lastCheckAt: number;
}

export interface OfflineStatusSummary {
  readonly isOffline: boolean;
  readonly offlineSince?: number;
  readonly queuedTasks: number;
  readonly availableLocalTasks: number;
  readonly blockedRemoteTasks: number;
}

export interface DeploymentHealthSummary {
  readonly overall: "healthy" | "degraded" | "critical" | "offline";
  readonly issues: readonly DeploymentIssue[];
}

export interface DeploymentIssue {
  readonly severity: "info" | "warning" | "error" | "critical";
  readonly component: string;
  readonly message: string;
  readonly since: number;
  readonly remediation?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Bounds and Constants
// ═══════════════════════════════════════════════════════════════════════════

export const DEPLOYMENT_BOUNDS = {
  MAX_CAPSULE_INTENT_CHARS: 2000,
  MAX_CAPSULE_CONTEXT_REFS: 32,
  MAX_CAPSULE_ARTIFACT_REFS: 64,
  MAX_CAPSULE_REQUIREMENTS: 16,
  MAX_TRANSFER_CHAIN: 10,
  MAX_WORKERS_PER_PROFILE: 100,
  MAX_WORKER_CAPABILITIES: 64,
  MAX_PLACEMENT_FACTORS: 16,
  MAX_SYNC_BATCH_SIZE: 100,
  MAX_SYNC_RETRIES: 5,
  MAX_CONFLICT_RETENTION_DAYS: 30,
  DEFAULT_HEARTBEAT_INTERVAL_MS: 30_000,
  DEFAULT_SYNC_INTERVAL_MS: 60_000,
  WORKER_TIMEOUT_MS: 90_000,
  WORKER_ATTESTATION_MAX_AGE_MS: 24 * 60 * 60 * 1000,
  CAPSULE_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
} as const;

/** Schema version for task capsules. */
export const CAPSULE_SCHEMA_VERSION = "xr-6.0.0/capsule-v1";

/** Deployment module adapter version. */
export const DEPLOYMENT_ADAPTER_VERSION = "xr-6.0.0";
