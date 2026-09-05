/**
 * XR 6.1 — Enterprise Trust and Operations: Core Types
 *
 * THE single source of truth for organization policy, delegated authority,
 * audit export/retention, SLOs, incidents, supply-chain response, disaster
 * recovery, release/support, and certification evidence.
 *
 * Design rules (Phase 12):
 *   - Enterprise controls are ADDITIVE. Local/private deployments stay autonomous.
 *   - Organization policy may only RESTRICT, never expand, task-level authority.
 *   - Organization policy may NEVER hide user-visible safety information.
 *   - No second identity system: subjects reference existing Phase 11
 *     `RemoteIdentity.identityId` / business `Member.id` as opaque strings.
 *   - Audit stays tamper-evident; redaction must preserve verifiability.
 *   - No SLO is declared that cannot be measured from an existing signal.
 *   - Everything is safe to serialize — no secrets, no handles, no unbounded blobs.
 *   - Compliance language is never a substitute for an enforced control.
 *
 * Builds on:
 *   - Phase 3  Trust/Isolation   — `RiskTier`, `AuthorityGrant`
 *   - Phase 9  Capabilities      — provenance, signing, certification
 *   - Phase 10 Business layer    — `Organization`, `Member`, RBAC
 *   - Phase 11 Deployment plane  — profiles, tenancy, identity, backup
 */

import type { RiskTier } from "@xr/core/runtime/trust/types.ts";
import type { DeploymentProfileKind } from "./deployment/types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// 0. Versions and bounds
// ═══════════════════════════════════════════════════════════════════════════

export const ENTERPRISE_SCHEMA_VERSION = "xr-6.1.0/enterprise-v1";
export const POLICY_ENGINE_VERSION = "xr-6.1.0/policy-v1";
export const AUDIT_EXPORT_FORMAT_VERSION = "xr-6.1.0/audit-export-v1";
export const EVIDENCE_PACK_VERSION = "xr-6.1.0/evidence-v1";

export const ENTERPRISE_BOUNDS = {
  MAX_POLICY_RULES_PER_BUNDLE: 512,
  MAX_BUNDLE_HISTORY: 64,
  MAX_DELEGATION_DEPTH: 4,
  MAX_EXPORT_RECORDS: 100_000,
  MAX_REDACTION_RULES: 128,
  MAX_INCIDENT_EVIDENCE_ITEMS: 256,
  MAX_INCIDENT_TIMELINE_ENTRIES: 512,
  MAX_REVOCATION_ENTRIES: 4096,
  MAX_REASON_CHARS: 2000,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 1. Policy layers and precedence
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The six policy layers, ordered from least to most specific.
 *
 * Precedence rule (see `resolvePolicy`):
 *   - For SAFETY-RELEVANT settings the MOST RESTRICTIVE value across all layers
 *     wins, regardless of layer specificity. A more privileged layer can tighten
 *     but never loosen.
 *   - For NON-SAFETY preferences the MOST SPECIFIC layer wins.
 *   - No layer may set a non-overridable invariant to a weaker value.
 */
export const POLICY_LAYERS = [
  "platform_default",
  "deployment",
  "organization",
  "workspace",
  "user_task",
  "capability",
] as const;

export type PolicyLayer = (typeof POLICY_LAYERS)[number];

/** Layer specificity — higher wins for non-safety preferences. */
export const POLICY_LAYER_SPECIFICITY: Record<PolicyLayer, number> = {
  platform_default: 0,
  deployment: 1,
  organization: 2,
  workspace: 3,
  user_task: 4,
  capability: 5,
};

/**
 * Privilege of the layer — who can author it. Used to reject a lower-privileged
 * author writing a higher-privileged layer.
 */
export const POLICY_LAYER_PRIVILEGE: Record<PolicyLayer, number> = {
  platform_default: 5,
  deployment: 4,
  organization: 3,
  workspace: 2,
  user_task: 1,
  capability: 0,
};

/**
 * Policy settings that are SAFETY-RELEVANT: resolved most-restrictive-wins.
 * A privileged layer may tighten these; nothing may loosen them.
 */
export type SafetyRelevantKey =
  | "minRiskTier"
  | "requireApprovalAbove"
  | "allowNetworkEgress"
  | "allowFilesystemWrite"
  | "allowProcessSpawn"
  | "allowRemotePlacement"
  | "allowUnsignedCapabilities"
  | "allowUncertifiedCapabilities";

/**
 * Policy settings that are USER-VISIBILITY invariants. These can be turned ON by
 * any layer but can NEVER be turned off by any layer, including platform.
 * This is boundary B11 from the Phase 12 audit.
 */
export const NON_OVERRIDABLE_VISIBILITY_KEYS = [
  "showApprovalRequests",
  "showPolicyEffects",
  "showDataScope",
  "showActionProvenance",
  "showCapabilityTrust",
  "showIncidentImpact",
] as const;

export type VisibilityKey = (typeof NON_OVERRIDABLE_VISIBILITY_KEYS)[number];

export type PolicyValue = string | number | boolean;

export interface PolicyRule {
  readonly key: string;
  readonly value: PolicyValue;
  /** Layer this rule was authored at. */
  readonly layer: PolicyLayer;
  /** Human-readable justification — surfaced to users when the rule affects them. */
  readonly reason: string;
  /** Opaque subject id of the author (user/service). No new identity system. */
  readonly authoredBy: string;
  readonly authoredAt: number;
  /** Optional scope narrowing. */
  readonly organizationId?: string;
  readonly workspaceId?: string;
  readonly capabilityId?: string;
}

/** Why a particular value won during resolution. */
export type PolicyResolutionReason =
  | "only_value"
  | "most_restrictive"
  | "most_specific"
  | "invariant_floor"
  | "default";

export interface PolicyDecisionEntry {
  readonly key: string;
  readonly effectiveValue: PolicyValue;
  readonly winningLayer: PolicyLayer;
  readonly reason: PolicyResolutionReason;
  /** Every candidate considered, for full transparency. */
  readonly candidates: readonly {
    readonly layer: PolicyLayer;
    readonly value: PolicyValue;
    readonly applied: boolean;
    readonly why: string;
  }[];
  /** True when this key is safety-relevant and resolved most-restrictive. */
  readonly safetyRelevant: boolean;
  /** True when this key is a non-overridable user-visibility invariant. */
  readonly userVisible: boolean;
}

/**
 * An attempt by a policy layer to weaken a safety or visibility setting.
 * These are ALWAYS rejected and ALWAYS recorded — never silently dropped.
 */
export interface PolicyOverrideAttempt {
  readonly key: string;
  readonly layer: PolicyLayer;
  readonly attemptedValue: PolicyValue;
  readonly rejectedBecause: string;
  readonly authoredBy: string;
  readonly at: number;
  /** Severity for audit/alerting — visibility suppression is the worst case. */
  readonly severity: "warning" | "critical";
}

export interface PolicyResolution {
  readonly engineVersion: string;
  readonly resolvedAt: number;
  readonly entries: readonly PolicyDecisionEntry[];
  /** Rejected weakening attempts. Non-empty means someone tried to override. */
  readonly rejectedOverrides: readonly PolicyOverrideAttempt[];
  readonly organizationId?: string;
  readonly workspaceId?: string;
}

export interface EffectivePolicy {
  readonly resolution: PolicyResolution;
  get(key: string): PolicyValue | undefined;
  getBoolean(key: string, fallback: boolean): boolean;
  getNumber(key: string, fallback: number): number;
  /** Keys the user must be able to see, with their effective values. */
  userVisibleEffects(): readonly PolicyDecisionEntry[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Policy bundles (versioned, reversible)
// ═══════════════════════════════════════════════════════════════════════════

export type PolicyBundleState = "draft" | "active" | "superseded" | "rolled_back";

export interface PolicyBundle {
  readonly bundleId: string;
  readonly schemaVersion: string;
  readonly organizationId?: string;
  readonly workspaceId?: string;
  readonly name: string;
  readonly description: string;
  /** Monotonic version within the bundle lineage. */
  readonly version: number;
  readonly state: PolicyBundleState;
  readonly rules: readonly PolicyRule[];
  readonly createdBy: string;
  readonly createdAt: number;
  readonly activatedAt?: number;
  readonly supersededAt?: number;
  readonly rolledBackAt?: number;
  readonly rolledBackReason?: string;
  /** Previous bundle in the lineage — enables rollback. */
  readonly previousBundleId?: string;
  /** Integrity digest over the rule set. */
  readonly contentHash: string;
}

export interface PolicyBundleValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  /** Weakening attempts detected at authoring time, before activation. */
  readonly rejectedOverrides: readonly PolicyOverrideAttempt[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Delegated authority
// ═══════════════════════════════════════════════════════════════════════════

export type AuthoritySubjectKind = "user" | "service" | "ai_worker" | "workspace";

/** Opaque reference to an existing identity. No new identity store. */
export interface AuthoritySubject {
  readonly kind: AuthoritySubjectKind;
  /** `RemoteIdentity.identityId`, business `Member.id`, or `AIWorker.id`. */
  readonly subjectId: string;
  readonly displayName?: string;
  readonly organizationId?: string;
  readonly workspaceId?: string;
}

export type DelegationState = "active" | "expired" | "revoked" | "suspended" | "pending_review";

/**
 * A delegation of authority from one subject to another (typically human → AI
 * worker). The delegated scope set must be a SUBSET of the delegator's own
 * effective authority — enforced by `validateDelegation`.
 */
export interface AuthorityDelegation {
  readonly delegationId: string;
  readonly schemaVersion: string;
  readonly delegator: AuthoritySubject;
  readonly delegate: AuthoritySubject;
  /** Capability scopes granted, e.g. `fs:read`, `net:egress`, `deal:update`. */
  readonly scopes: readonly string[];
  /** Hard ceiling: delegate may never exceed this risk tier. */
  readonly maxRiskTier: RiskTier;
  /** Whether the delegate may itself delegate onward. */
  readonly canSubDelegate: boolean;
  /** Depth in the delegation chain (root = 0). */
  readonly depth: number;
  /** Chain of delegation ids from root to here. */
  readonly chain: readonly string[];
  /** Actions that always require explicit human approval, regardless of scope. */
  readonly requiresApprovalFor: readonly string[];
  readonly state: DelegationState;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revokedAt?: number;
  readonly revokedReason?: string;
  readonly revokedBy?: string;
  /** Periodic access review. */
  readonly reviewDueAt?: number;
  readonly lastReviewedAt?: number;
  readonly lastReviewedBy?: string;
  readonly reason: string;
}

export interface DelegationValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** Scopes requested but not held by the delegator — always stripped. */
  readonly deniedScopes: readonly string[];
  /** The scopes that would actually be granted. */
  readonly effectiveScopes: readonly string[];
  readonly effectiveMaxRiskTier: RiskTier;
}

export type AuthorityReviewOutcome = "affirmed" | "reduced" | "revoked" | "deferred";

export interface AuthorityReview {
  readonly reviewId: string;
  readonly delegationId: string;
  readonly reviewedBy: string;
  readonly reviewedAt: number;
  readonly outcome: AuthorityReviewOutcome;
  readonly notes: string;
  readonly scopesBefore: readonly string[];
  readonly scopesAfter: readonly string[];
  readonly nextReviewDueAt?: number;
}

/** What a subject may actually do right now, after policy + delegation. */
export interface EffectiveAuthority {
  readonly subject: AuthoritySubject;
  readonly scopes: readonly string[];
  readonly maxRiskTier: RiskTier;
  readonly requiresApprovalFor: readonly string[];
  readonly viaDelegations: readonly string[];
  /** Scopes removed by organization policy, with reasons — always user-visible. */
  readonly restrictedByPolicy: readonly { readonly scope: string; readonly reason: string }[];
  readonly computedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Audit classes, redaction, export, retention
// ═══════════════════════════════════════════════════════════════════════════

export const AUDIT_EVENT_CLASSES = [
  "security",
  "policy",
  "authority",
  "data_access",
  "administration",
  "incident",
  "supply_chain",
  "recovery",
  "execution",
  "system",
] as const;

export type AuditEventClass = (typeof AUDIT_EVENT_CLASSES)[number];

export type AuditSensitivity = "public" | "internal" | "confidential" | "restricted";

/**
 * A normalized, exportable audit record. Wraps the existing hash-chained rows
 * from `WorkspaceStore.audit()` / business `AuditTrail` without replacing them.
 */
export interface AuditRecord {
  readonly recordId: string;
  readonly sequence: number;
  readonly eventClass: AuditEventClass;
  readonly event: string;
  readonly at: number;
  readonly actorId?: string;
  readonly organizationId?: string;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly resource?: string;
  readonly resourceId?: string;
  readonly sensitivity: AuditSensitivity;
  readonly detail: Record<string, unknown>;
  /** Hash chain fields carried through from the source store. */
  readonly prevHash: string;
  readonly hash: string;
}

export type RedactionMode = "remove" | "mask" | "hash";

export interface RedactionRule {
  readonly ruleId: string;
  /** Dot-path into `detail`, or `*` for all detail fields. */
  readonly path: string;
  readonly mode: RedactionMode;
  readonly reason: string;
  /** Only apply to records at/above this sensitivity. */
  readonly appliesAtOrAbove?: AuditSensitivity;
}

/**
 * A redacted field, with a digest of the ORIGINAL value.
 *
 * This is what keeps redaction verifiable: the export commits to the original
 * record hash, and each removed/masked field carries a SHA-256 of its original
 * value. An auditor holding the original can prove the redaction is faithful;
 * an auditor without it can still verify the chain over `hash` values.
 */
export interface RedactedField {
  readonly path: string;
  readonly mode: RedactionMode;
  readonly originalDigest: string;
  readonly reason: string;
}

export interface RedactedAuditRecord extends Omit<AuditRecord, "detail"> {
  readonly detail: Record<string, unknown>;
  readonly redactedFields: readonly RedactedField[];
  /** Unchanged: the original record hash, so chain verification still works. */
  readonly originalHash: string;
}

export type ExportFormat = "jsonl" | "json" | "csv";

export interface AuditExportRequest {
  readonly requestedBy: string;
  readonly organizationId?: string;
  readonly workspaceId?: string;
  readonly fromAt?: number;
  readonly toAt?: number;
  readonly eventClasses?: readonly AuditEventClass[];
  readonly format: ExportFormat;
  readonly redactionRules: readonly RedactionRule[];
  readonly maxRecords?: number;
  /** Set false only for an authorized, logged, unredacted legal export. */
  readonly includeRestricted?: boolean;
  readonly reason: string;
}

export type ExportStatus = "complete" | "partial" | "denied" | "failed";

export interface AuditExportManifest {
  readonly exportId: string;
  readonly formatVersion: string;
  readonly status: ExportStatus;
  readonly createdAt: number;
  readonly requestedBy: string;
  readonly organizationId?: string;
  readonly workspaceId?: string;
  readonly recordCount: number;
  /** Records matching the window but withheld by access control. */
  readonly withheldCount: number;
  readonly redactedFieldCount: number;
  readonly firstSequence?: number;
  readonly lastSequence?: number;
  readonly firstHash?: string;
  readonly lastHash?: string;
  /** SHA-256 over the serialized exported records. */
  readonly contentHash: string;
  /** True when the exported subset forms an unbroken hash chain. */
  readonly chainVerified: boolean;
  readonly chainBreakAtSequence?: number;
  readonly format: ExportFormat;
  /** Populated when status is partial/failed/denied — never silent. */
  readonly incompleteReason?: string;
  readonly appliedRedactionRuleIds: readonly string[];
}

export interface AuditExportResult {
  readonly manifest: AuditExportManifest;
  readonly records: readonly RedactedAuditRecord[];
  readonly serialized: string;
}

export interface AuditExportVerification {
  readonly ok: boolean;
  readonly contentHashMatches: boolean;
  readonly chainIntact: boolean;
  readonly recordCountMatches: boolean;
  readonly errors: readonly string[];
  readonly verifiedAt: number;
}

/** Who accessed audit data — itself auditable. */
export interface AuditAccessLogEntry {
  readonly entryId: string;
  readonly at: number;
  readonly actorId: string;
  readonly action: "export" | "view" | "verify" | "redact" | "purge" | "hold";
  readonly organizationId?: string;
  readonly workspaceId?: string;
  readonly recordCount: number;
  readonly granted: boolean;
  readonly denyReason?: string;
  readonly exportId?: string;
}

export interface RetentionSchedule {
  readonly scheduleId: string;
  readonly organizationId?: string;
  readonly workspaceId?: string;
  /** Per audit event class. */
  readonly rules: readonly {
    readonly eventClass: AuditEventClass;
    readonly retainDays: number;
    readonly archiveAfterDays?: number;
    readonly deleteOnExpiry: boolean;
  }[];
  readonly createdBy: string;
  readonly createdAt: number;
  readonly version: number;
}

export interface LegalHold {
  readonly holdId: string;
  readonly organizationId?: string;
  readonly workspaceId?: string;
  readonly reason: string;
  readonly placedBy: string;
  readonly placedAt: number;
  readonly releasedAt?: number;
  readonly releasedBy?: string;
  readonly active: boolean;
  /** Optional narrowing; absent means the whole scope is held. */
  readonly eventClasses?: readonly AuditEventClass[];
  readonly fromAt?: number;
  readonly toAt?: number;
}

export type RetentionAction = "retain" | "archive" | "delete" | "hold_blocked";

export interface RetentionEvaluation {
  readonly recordId: string;
  readonly sequence: number;
  readonly action: RetentionAction;
  readonly ageDays: number;
  readonly reason: string;
  /** Set when a legal hold overrode a scheduled deletion. */
  readonly blockingHoldId?: string;
}

export interface RetentionRunResult {
  readonly runId: string;
  readonly executedAt: number;
  readonly evaluated: number;
  readonly retained: number;
  readonly archived: number;
  readonly deleted: number;
  readonly holdBlocked: number;
  /** Deletion requests refused because of a legal hold — the conflict case. */
  readonly conflicts: readonly {
    readonly recordId: string;
    readonly holdId: string;
    readonly detail: string;
  }[];
  readonly dryRun: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. SLOs and operational status
// ═══════════════════════════════════════════════════════════════════════════

export const SLO_IDS = [
  "runtime_availability",
  "task_completion",
  "task_recovery",
  "approval_delivery",
  "worker_health",
  "provider_routing_availability",
  "backup_success",
  "audit_export",
  "security_event_response",
  "upgrade_rollback",
] as const;

export type SloId = (typeof SLO_IDS)[number];

export type SloUnit = "ratio" | "milliseconds" | "count";

export interface SloDefinition {
  readonly id: SloId;
  readonly name: string;
  readonly description: string;
  readonly unit: SloUnit;
  /** Objective, e.g. 0.99 for a ratio, or a millisecond budget. */
  readonly objective: number;
  /** Rolling evaluation window. */
  readonly windowMs: number;
  /**
   * Whether XR can actually measure this from an existing signal.
   * Roadmap §6.4: do not promise SLOs that cannot be measured.
   */
  readonly measurable: boolean;
  /** The concrete signal this SLI is computed from. */
  readonly source: string;
  /** Set when `measurable` is false — states what is missing. */
  readonly unmeasurableReason?: string;
  /** Deployment profiles where this SLO applies at all. */
  readonly appliesToProfiles: readonly DeploymentProfileKind[];
}

export interface SloSample {
  readonly sloId: SloId;
  readonly at: number;
  /** Successful/total for ratio SLOs; observed value for latency SLOs. */
  readonly good: number;
  readonly total: number;
  readonly valueMs?: number;
}

export type SloStatus = "meeting" | "at_risk" | "breaching" | "unmeasurable" | "not_applicable";

export interface SloReport {
  readonly definition: SloDefinition;
  readonly status: SloStatus;
  /** Measured value: ratio in [0,1] or milliseconds. Undefined if unmeasurable. */
  readonly measured?: number;
  readonly sampleCount: number;
  readonly windowStart: number;
  readonly windowEnd: number;
  /** Remaining error budget as a ratio in [0,1]; undefined for latency SLOs. */
  readonly errorBudgetRemaining?: number;
  readonly detail: string;
}

export type AlertSeverity = "info" | "warning" | "error" | "critical";

export interface AlertCondition {
  readonly conditionId: string;
  readonly severity: AlertSeverity;
  readonly component: string;
  readonly message: string;
  readonly since: number;
  readonly remediation?: string;
  readonly sloId?: SloId;
}

export interface OperationalStatus {
  readonly generatedAt: number;
  readonly profile: DeploymentProfileKind;
  readonly overall: "healthy" | "degraded" | "critical" | "offline";
  readonly slos: readonly SloReport[];
  readonly alerts: readonly AlertCondition[];
  readonly backup: {
    readonly lastBackupAt?: number;
    readonly lastVerifiedAt?: number;
    readonly successRate?: number;
    readonly healthy: boolean;
  };
  readonly recovery: {
    readonly lastDrillAt?: number;
    readonly lastRestoreAt?: number;
    readonly rpoTargetMinutes?: number;
    readonly rtoTargetMinutes?: number;
    readonly meetingTargets?: boolean;
  };
  readonly security: {
    readonly openIncidents: number;
    readonly criticalIncidents: number;
    readonly quarantinedCapabilities: number;
    readonly revokedDelegations: number;
  };
  readonly workers: {
    readonly total: number;
    readonly healthy: number;
    readonly degraded: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Incident response
// ═══════════════════════════════════════════════════════════════════════════

export const INCIDENT_STATES = [
  "detected",
  "triaged",
  "contained",
  "quarantined",
  "remediating",
  "resolved",
  "postmortem",
] as const;

export type IncidentState = (typeof INCIDENT_STATES)[number];

export const INCIDENT_KINDS = [
  "capability_abuse",
  "credential_exposure",
  "isolation_failure",
  "tenant_data_leakage",
  "provider_compromise",
  "malicious_package",
  "audit_failure",
  "worker_compromise",
] as const;

export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

/**
 * Legal state transitions. Terminal-ish states still allow postmortem.
 * Any incident may jump straight to `contained`/`quarantined` for fast response.
 */
export const INCIDENT_TRANSITIONS: Record<IncidentState, readonly IncidentState[]> = {
  detected: ["triaged", "contained", "quarantined", "resolved"],
  triaged: ["contained", "quarantined", "remediating", "resolved"],
  contained: ["quarantined", "remediating", "resolved"],
  quarantined: ["remediating", "contained", "resolved"],
  remediating: ["contained", "quarantined", "resolved"],
  resolved: ["postmortem"],
  postmortem: [],
};

export interface IncidentEvidence {
  readonly evidenceId: string;
  readonly kind: "audit_range" | "capability_snapshot" | "worker_state" | "policy_snapshot" | "note" | "export_ref";
  readonly capturedAt: number;
  readonly capturedBy: string;
  readonly description: string;
  /** Digest of the preserved artifact — evidence is immutable once captured. */
  readonly contentHash: string;
  /** Small structured payload; large artifacts are referenced, not inlined. */
  readonly payload?: Record<string, unknown>;
  readonly ref?: string;
}

export interface IncidentTimelineEntry {
  readonly at: number;
  readonly actorId: string;
  readonly fromState?: IncidentState;
  readonly toState?: IncidentState;
  readonly action: string;
  readonly detail: string;
}

export interface IncidentResponseAction {
  readonly actionId: string;
  readonly kind:
    | "quarantine_capability"
    | "revoke_publisher"
    | "revoke_delegation"
    | "revoke_identity"
    | "disable_worker"
    | "block_provider"
    | "rotate_credential"
    | "restore_backup"
    | "notify";
  readonly targetId: string;
  readonly executedAt: number;
  readonly executedBy: string;
  readonly ok: boolean;
  readonly detail: string;
  /** True when the action is reversible (used for rollback planning). */
  readonly reversible: boolean;
}

export interface Incident {
  readonly incidentId: string;
  readonly schemaVersion: string;
  readonly kind: IncidentKind;
  readonly severity: IncidentSeverity;
  readonly state: IncidentState;
  readonly title: string;
  readonly summary: string;
  readonly organizationId?: string;
  readonly workspaceId?: string;
  readonly detectedAt: number;
  readonly detectedBy: string;
  readonly triagedAt?: number;
  readonly containedAt?: number;
  readonly resolvedAt?: number;
  readonly closedAt?: number;
  /** Affected subjects/capabilities/workers, as opaque ids. */
  readonly affected: readonly string[];
  readonly evidence: readonly IncidentEvidence[];
  readonly actions: readonly IncidentResponseAction[];
  readonly timeline: readonly IncidentTimelineEntry[];
  readonly postmortem?: IncidentPostmortem;
  /** Whether users in scope must be shown impact — cannot be suppressed. */
  readonly userVisibleImpact: boolean;
}

export interface IncidentPostmortem {
  readonly writtenBy: string;
  readonly writtenAt: number;
  readonly rootCause: string;
  readonly impact: string;
  readonly timelineSummary: string;
  readonly correctiveActions: readonly string[];
  readonly published: boolean;
}

export interface IncidentTransitionResult {
  readonly ok: boolean;
  readonly incident?: Incident;
  readonly error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Supply-chain response
// ═══════════════════════════════════════════════════════════════════════════

export type RevocationScope = "capability" | "capability_version" | "publisher";

export type RevocationReason =
  | "malicious"
  | "vulnerable"
  | "compromised_publisher"
  | "abandoned"
  | "policy_violation"
  | "unverified";

export interface RevocationEntry {
  readonly entryId: string;
  readonly scope: RevocationScope;
  /** Capability id or publisher id. */
  readonly targetId: string;
  /** Semver range for `capability_version` scope, e.g. ">=1.2.0 <1.4.1". */
  readonly versionRange?: string;
  readonly reason: RevocationReason;
  readonly detail: string;
  readonly issuedBy: string;
  readonly issuedAt: number;
  readonly organizationId?: string;
  /** Absent means permanent. */
  readonly expiresAt?: number;
  readonly revokedAt?: number;
  readonly incidentId?: string;
  /** Blocks new installs/updates while active. */
  readonly blockInstall: boolean;
  readonly active: boolean;
}

export interface InstallDecision {
  readonly allowed: boolean;
  readonly capabilityId: string;
  readonly version?: string;
  readonly reason: string;
  readonly matchedEntryId?: string;
  readonly matchedScope?: RevocationScope;
}

export type CatalogMode = "allowlist" | "denylist" | "open";

/** Organization-level capability catalog — which capabilities are permitted. */
export interface CapabilityCatalog {
  readonly catalogId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly mode: CatalogMode;
  readonly entries: readonly {
    readonly capabilityId: string;
    readonly minVersion?: string;
    readonly maxVersion?: string;
    readonly note?: string;
  }[];
  /** Require signed packages for anything in this catalog. */
  readonly requireSigned: boolean;
  readonly requireCertified: boolean;
  readonly version: number;
  readonly updatedBy: string;
  readonly updatedAt: number;
}

export interface CatalogDecision {
  readonly allowed: boolean;
  readonly capabilityId: string;
  readonly reason: string;
  readonly catalogId?: string;
  readonly mode?: CatalogMode;
}

export interface AffectedDeploymentNotice {
  readonly noticeId: string;
  readonly entryId: string;
  readonly capabilityId: string;
  readonly organizationId?: string;
  readonly workspaceIds: readonly string[];
  readonly createdAt: number;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly acknowledged: boolean;
  readonly acknowledgedAt?: number;
  readonly acknowledgedBy?: string;
  readonly recommendedAction: string;
}

export interface SupplyChainResponseResult {
  readonly ok: boolean;
  readonly entry?: RevocationEntry;
  readonly evidenceId?: string;
  readonly notices: readonly AffectedDeploymentNotice[];
  readonly incidentId?: string;
  readonly error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Backup verification and disaster recovery
// ═══════════════════════════════════════════════════════════════════════════

export type BackupVerificationStatus = "verified" | "unverified" | "corrupt" | "incomplete";

export interface BackupVerification {
  readonly verificationId: string;
  readonly backupId: string;
  readonly verifiedAt: number;
  readonly status: BackupVerificationStatus;
  /** Recomputed vs recorded manifest digest. */
  readonly manifestHashMatches: boolean;
  readonly componentsChecked: number;
  readonly componentsOk: number;
  readonly errors: readonly string[];
  /** Asserts no raw credential material is present in the backup. */
  readonly credentialSafetyChecked: boolean;
  readonly credentialSafetyOk: boolean;
}

export type RestoreMode = "full" | "partial" | "dry_run";

export interface RestorePlan {
  readonly planId: string;
  readonly backupId: string;
  readonly mode: RestoreMode;
  readonly components: readonly string[];
  readonly targetProfile: DeploymentProfileKind;
  readonly sourceProfile: DeploymentProfileKind;
  readonly crossDeployment: boolean;
  readonly requestedBy: string;
  readonly createdAt: number;
}

export interface RestorePreflight {
  readonly ok: boolean;
  readonly planId: string;
  /** Restore is REFUSED unless the backup verifies — anti restore-poisoning. */
  readonly integrityVerified: boolean;
  readonly verification?: BackupVerification;
  readonly schemaCompatible: boolean;
  readonly profileCompatible: boolean;
  readonly versionCompatible: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
}

export interface RestoreOutcome {
  readonly outcomeId: string;
  readonly planId: string;
  readonly backupId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly ok: boolean;
  readonly mode: RestoreMode;
  readonly componentsRestored: readonly string[];
  readonly componentsFailed: readonly string[];
  readonly componentsSkipped: readonly string[];
  readonly recordsRestored: number;
  /** Set when only some components applied — surfaces inconsistency risk. */
  readonly partial: boolean;
  readonly consistencyWarnings: readonly string[];
  readonly rtoMs: number;
  readonly error?: string;
}

export interface RecoveryTargets {
  readonly rpoMinutes: number;
  readonly rtoMinutes: number;
  readonly profile: DeploymentProfileKind;
}

export interface RecoveryTargetAssessment {
  readonly targets: RecoveryTargets;
  readonly measuredRpoMinutes?: number;
  readonly measuredRtoMinutes?: number;
  readonly rpoMet?: boolean;
  readonly rtoMet?: boolean;
  readonly assessedAt: number;
  readonly basis: string;
}

export interface RecoveryDrill {
  readonly drillId: string;
  readonly executedAt: number;
  readonly executedBy: string;
  readonly backupId: string;
  readonly ok: boolean;
  readonly preflight: RestorePreflight;
  readonly outcome?: RestoreOutcome;
  readonly assessment?: RecoveryTargetAssessment;
  readonly notes: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Release channels, support windows, compatibility
// ═══════════════════════════════════════════════════════════════════════════

export const RELEASE_CHANNELS = ["stable", "lts", "beta", "edge"] as const;

export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

export type SupportState = "supported" | "security_only" | "end_of_life" | "prerelease";

export interface ReleaseRecord {
  readonly version: string;
  readonly channel: ReleaseChannel;
  readonly releasedAt: number;
  /** Active support end. */
  readonly supportedUntil?: number;
  /** Security-only support end. */
  readonly securityUntil?: number;
  readonly supportState: SupportState;
  readonly notes: string;
  /** Schema/API versions this release speaks. */
  readonly compatibility: CompatibilityDeclaration;
}

export interface CompatibilityDeclaration {
  readonly pluginApiVersion: string;
  readonly capsuleSchemaVersion: string;
  readonly backupSchemaVersion: string;
  readonly policySchemaVersion: string;
  readonly auditExportFormatVersion: string;
  /** Minimum version that can upgrade directly to this release. */
  readonly minUpgradeFrom: string;
}

export interface CompatibilityCheck {
  readonly ok: boolean;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly direction: "upgrade" | "downgrade" | "same";
  readonly breaking: readonly string[];
  readonly warnings: readonly string[];
  /** Whether a documented, tested rollback path exists. */
  readonly rollbackSupported: boolean;
  readonly migrationRequired: boolean;
}

export interface SupportWindow {
  readonly version: string;
  readonly channel: ReleaseChannel;
  readonly state: SupportState;
  readonly daysRemaining?: number;
  readonly message: string;
}

export interface ReleaseArtifactEvidence {
  readonly version: string;
  readonly artifactName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly builtAt: number;
  readonly reproducible: boolean;
  readonly sbomPresent: boolean;
  readonly sbomRef?: string;
  readonly dependencyCount?: number;
}

export interface RollbackValidation {
  readonly ok: boolean;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly checks: readonly {
    readonly name: string;
    readonly passed: boolean;
    readonly detail: string;
  }[];
  /** Invariants that must survive rollback (roadmap §15). */
  readonly preservesLocalOperation: boolean;
  readonly preservesPolicySafety: boolean;
  readonly preservesAuditIntegrity: boolean;
  readonly preservesBackups: boolean;
  readonly preservesIncidentEvidence: boolean;
  readonly preservesCapabilityRevocation: boolean;
  readonly blockers: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Certification evidence
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How a control is assured. This distinction is mandatory (roadmap §10):
 * developers must know which guarantees are technical, which are operational,
 * and which require external assurance.
 */
export type AssuranceKind = "technical" | "operational" | "external_required";

export type ControlStatus = "implemented" | "partial" | "not_implemented" | "not_applicable";

export interface ControlEvidence {
  readonly controlId: string;
  readonly title: string;
  readonly description: string;
  readonly assurance: AssuranceKind;
  readonly status: ControlStatus;
  /** Source files implementing the control. */
  readonly implementedIn: readonly string[];
  /** Tests demonstrating it. */
  readonly testedBy: readonly string[];
  /** Honest statement of what this control does NOT cover. */
  readonly limitations: readonly string[];
  readonly lastVerifiedAt?: number;
}

export interface ThreatModelEntry {
  readonly threatId: string;
  readonly title: string;
  readonly description: string;
  readonly affectedBoundary: string;
  readonly mitigations: readonly string[];
  readonly residualRisk: "low" | "medium" | "high";
  readonly acceptedBy?: string;
}

export interface EvidencePack {
  readonly packId: string;
  readonly packVersion: string;
  readonly generatedAt: number;
  readonly xrVersion: string;
  readonly profile: DeploymentProfileKind;
  readonly controls: readonly ControlEvidence[];
  readonly threatModel: readonly ThreatModelEntry[];
  readonly summary: {
    readonly total: number;
    readonly implemented: number;
    readonly partial: number;
    readonly notImplemented: number;
    readonly technical: number;
    readonly operational: number;
    readonly externalRequired: number;
  };
  /**
   * ALWAYS false unless an external assessor has actually completed an audit
   * and the result was recorded out-of-band. XR never self-certifies.
   */
  readonly externallyCertified: boolean;
  readonly externalCertifications: readonly string[];
  /** Explicit, prominent statement of what this pack is not. */
  readonly disclaimer: string;
  readonly unresolvedRisks: readonly string[];
  readonly skippedControls: readonly string[];
  readonly contentHash: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. Shared helpers
// ═══════════════════════════════════════════════════════════════════════════

export function isPolicyLayer(value: string): value is PolicyLayer {
  return (POLICY_LAYERS as readonly string[]).includes(value);
}

export function isAuditEventClass(value: string): value is AuditEventClass {
  return (AUDIT_EVENT_CLASSES as readonly string[]).includes(value);
}

export function isIncidentState(value: string): value is IncidentState {
  return (INCIDENT_STATES as readonly string[]).includes(value);
}

export function isIncidentKind(value: string): value is IncidentKind {
  return (INCIDENT_KINDS as readonly string[]).includes(value);
}

export function isReleaseChannel(value: string): value is ReleaseChannel {
  return (RELEASE_CHANNELS as readonly string[]).includes(value);
}

export function isVisibilityKey(key: string): key is VisibilityKey {
  return (NON_OVERRIDABLE_VISIBILITY_KEYS as readonly string[]).includes(key);
}

export function canTransitionIncident(from: IncidentState, to: IncidentState): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

/** Sensitivity ordering for redaction thresholds. */
export const SENSITIVITY_ORDER: Record<AuditSensitivity, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};
