/**
 * XR 6.1 — Enterprise Trust & Operations: Canonical Types
 *
 * This file is THE single source of truth for all enterprise trust and
 * operations contracts. It builds on Phase 11 deployment types and extends
 * them with organizational governance, audit, SLO, incident, supply-chain,
 * release, and certification semantics.
 *
 * Design rules:
 *   - Enterprise controls are additive — they never weaken local autonomy.
 *   - Organization policy cannot silently override task-level safety.
 *   - Audit records are tamper-evident with integrity verification.
 *   - All contracts are versioned and serializable.
 *   - No cloud dependency is mandatory for enterprise features.
 *
 * Phase 12 builds on Phases 1–11 contracts:
 *   - Execution fabric (Phase 2) — all operations recorded
 *   - Trust/Isolation (Phase 3) — authority preserved
 *   - Durable agency (Phase 4) — resumable operations
 *   - Capability ecosystem (Phase 9) — supply-chain response
 *   - Deployment plane (Phase 11) — profiles, identity, tenancy
 */

import type { DeploymentProfileKind } from "../deployment/types.ts";
import type { RiskTier } from "../trust/types.ts";

// Re-export types needed by other enterprise modules.
export type { DeploymentProfileKind };

// ═══════════════════════════════════════════════════════════════════════════
// 1. Organization Policy
// ═══════════════════════════════════════════════════════════════════════════

/** Precedence tiers for policy evaluation. Lower numbers = higher priority. */
export const POLICY_PRECEDENCE = {
  task_override: 10,
  user: 20,
  workspace: 30,
  project: 40,
  organization: 50,
  deployment: 60,
  platform_default: 100,
} as const;

export type PolicyTier = keyof typeof POLICY_PRECEDENCE;

export interface PolicyTarget {
  readonly kind: "organization" | "workspace" | "project" | "user" | "task" | "capability";
  readonly id: string;
  /** Human-readable scope label for audit/UX. */
  readonly label: string;
}

export interface PolicyRule {
  readonly id: string;
  readonly tier: PolicyTier;
  readonly target: PolicyTarget;
  /** What this rule controls. */
  readonly subjects: readonly PolicySubject[];
  /** Allow | Deny | RequireApproval | AuditOnly. */
  readonly effect: PolicyEffect;
  /** JSON Schema for conditions that must be satisfied. */
  readonly conditions?: Record<string, unknown>;
  /** Human-readable reason — shown in approvals and audit. */
  readonly reason: string;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly createdBy: string;
}

export type PolicySubject =
  | "model.selection"
  | "model.routing"
  | "capability.install"
  | "capability.update"
  | "capability.remove"
  | "capability.invoke"
  | "data.export"
  | "data.delete"
  | "data.redact"
  | "audit.view"
  | "audit.export"
  | "audit.retention"
  | "worker.create"
  | "worker.drain"
  | "worker.revoke"
  | "deployment.place"
  | "deployment.transfer"
  | "credential.create"
  | "credential.read"
  | "credential.revoke"
  | "network.egress"
  | "network.ingress"
  | "memory.read"
  | "memory.write"
  | "memory.share"
  | "approval.override"
  | "incident.create"
  | "incident.resolve"
  | "backup.create"
  | "backup.restore"
  | "backup.delete"
  | "slo.configure"
  | "release.channel"
  | "release.rollback"
  | "governance.vote"
  | "organization.admin";

export type PolicyEffect = "allow" | "deny" | "require_approval" | "audit_only";

export interface PolicyBundle {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  /** Which profile(s) this bundle applies to. */
  readonly applicableProfiles: readonly DeploymentProfileKind[];
  /** Pre-configured rules in this bundle. */
  readonly rules: readonly PolicyRule[];
  readonly metadata: Record<string, string>;
}

export interface PolicyEvaluation {
  readonly requestId: string;
  readonly subject: PolicySubject;
  readonly target: PolicyTarget;
  readonly matchedRules: readonly PolicyRule[];
  /** Final effect after precedence resolution. */
  readonly effectiveEffect: PolicyEffect;
  /** If denied, why. */
  readonly denialReason?: string;
  readonly evaluatedAt: number;
  /** Hash for audit integrity. */
  readonly integrityHash: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Delegated Authority and Roles
// ═══════════════════════════════════════════════════════════════════════════

export type EnterpriseRole =
  | "org_owner"
  | "org_admin"
  | "security_admin"
  | "compliance_officer"
  | "workspace_admin"
  | "audit_viewer"
  | "incident_responder"
  | "backup_operator"
  | "capability_manager"
  | "slo_viewer"
  | "release_manager"
  | "ai_worker"
  | "ai_worker_restricted"
  | "readonly_user";

export interface RoleDefinition {
  readonly role: EnterpriseRole;
  readonly label: string;
  readonly description: string;
  readonly inherits: readonly EnterpriseRole[];
  readonly allowedSubjects: readonly PolicySubject[];
  /** Maximum risk tier this role can authorize. */
  readonly maxRiskTier: RiskTier;
  /** Whether this role can delegate its authority. */
  readonly canDelegate: boolean;
  /** Maximum delegation depth. */
  readonly maxDelegationDepth: number;
  /** Whether this role requires MFA. */
  readonly requiresMfa: boolean;
}

export interface DelegatedAuthority {
  readonly id: string;
  readonly granter: string;
  readonly grantee: string;
  readonly role: EnterpriseRole;
  readonly scopedSubjects: readonly PolicySubject[];
  readonly scopedWorkspaces: readonly string[];
  readonly scopedCapabilities: readonly string[];
  readonly maxRiskTier: RiskTier;
  readonly depth: number;
  readonly expiresAt?: number;
  readonly grantedAt: number;
  readonly revokedAt?: number;
  readonly justification: string;
  readonly approvedBy?: string;
}

export interface AuthorityReview {
  readonly id: string;
  readonly authorityId: string;
  readonly reviewer: string;
  readonly decision: "approved" | "rejected" | "modified";
  readonly reason: string;
  readonly reviewedAt: number;
  readonly nextReviewDue: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Audit Export, Retention, and Redaction
// ═══════════════════════════════════════════════════════════════════════════

export type AuditEventClass =
  | "execution"
  | "policy_decision"
  | "identity"
  | "authority"
  | "capability_lifecycle"
  | "data_access"
  | "credential"
  | "network"
  | "incident"
  | "backup"
  | "deployment"
  | "release"
  | "governance"
  | "security";

export interface AuditExportRequest {
  readonly id: string;
  readonly requestedBy: string;
  readonly scopes: readonly AuditEventClass[];
  readonly timeRange?: { start: number; end: number };
  readonly workspaceFilter?: readonly string[];
  readonly format: AuditExportFormat;
  readonly redactionRules: readonly RedactionRule[];
  readonly includeIntegrityProofs: boolean;
  readonly retentionLabel?: string;
  readonly legalHoldId?: string;
}

export type AuditExportFormat = "json" | "json_lines" | "csv" | "signed_bundle";

export interface RedactionRule {
  readonly field: string;
  readonly strategy: RedactionStrategy;
  /** Optional regex for pattern-based redaction. */
  readonly pattern?: string;
}

export type RedactionStrategy =
  | "full_mask"
  | "partial_mask"
  | "hash"
  | "remove"
  | "tokenize";

export interface AuditExportResult {
  readonly ok: boolean;
  readonly exportId: string;
  readonly recordCount: number;
  readonly format: AuditExportFormat;
  readonly sizeBytes: number;
  readonly integrityHash: string;
  readonly redactionApplied: number;
  readonly error?: string;
  readonly warnings: readonly string[];
}

export interface RetentionSchedule {
  readonly id: string;
  readonly eventClass: AuditEventClass;
  readonly durationDays: number;
  readonly gracePeriodDays: number;
  readonly action: "archive" | "delete" | "anonymize";
  readonly legalHoldOverride: boolean;
}

export interface LegalHold {
  readonly id: string;
  readonly reason: string;
  readonly scope: readonly AuditEventClass[];
  readonly workspaceFilter?: readonly string[];
  readonly timeRange?: { start: number; end: number };
  readonly placedBy: string;
  readonly placedAt: number;
  readonly expiresAt?: number;
  readonly active: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. SLOs and Operational Metrics
// ═══════════════════════════════════════════════════════════════════════════

export interface ServiceLevelObjective {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly metric: SLOMetric;
  readonly target: SLOTarget;
  readonly window: SLOWindow;
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly enabled: boolean;
}

export type SLOMetric =
  | "runtime.availability"
  | "task.completion_rate"
  | "task.recovery_rate"
  | "approval.delivery_time_ms"
  | "worker.health"
  | "provider.routing.availability"
  | "backup.success_rate"
  | "audit.export.availability"
  | "security.detection_time_ms"
  | "security.response_time_ms"
  | "upgrade.success_rate"
  | "rollback.success_rate"
  | "sync.latency_ms"
  | "sync.conflict_rate";

export interface SLOTarget {
  readonly kind: "percentile" | "minimum" | "maximum" | "rate";
  readonly value: number;
  /** P50, P95, P99 etc. */
  readonly percentile?: number;
  readonly unit: string;
}

export interface SLOWindow {
  readonly durationMs: number;
  readonly evaluationIntervalMs: number;
  readonly minimumSamples: number;
}

export interface SLOStatus {
  readonly slo: ServiceLevelObjective;
  readonly currentValue: number;
  readonly meetsTarget: boolean;
  readonly trend: "improving" | "stable" | "degrading";
  readonly samples: number;
  readonly lastEvaluatedAt: number;
  readonly history: readonly SLODataPoint[];
}

export interface SLODataPoint {
  readonly timestamp: number;
  readonly value: number;
  readonly label?: string;
}

export interface OperationalHealth {
  readonly overall: "healthy" | "degraded" | "unhealthy" | "critical";
  readonly slos: readonly SLOStatus[];
  readonly activeIncidents: number;
  readonly unresolvedVulnerabilities: number;
  readonly backupStatus: "ok" | "stale" | "failed" | "none";
  readonly workerPoolStatus: "ok" | "degraded" | "critical";
  readonly syncStatus: "ok" | "lagging" | "conflicted" | "offline";
  readonly lastBackupAt?: number;
  readonly issuesRequiringAttention: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Incident Response
// ═══════════════════════════════════════════════════════════════════════════

export type IncidentState =
  | "detected"
  | "triaged"
  | "contained"
  | "quarantined"
  | "remediating"
  | "resolved"
  | "postmortem";

export type IncidentClass =
  | "capability_abuse"
  | "credential_exposure"
  | "isolation_failure"
  | "tenant_leakage"
  | "data_leakage"
  | "provider_compromise"
  | "malicious_package"
  | "audit_failure"
  | "worker_compromise"
  | "policy_bypass"
  | "supply_chain"
  | "network_intrusion";

export type IncidentSeverity = "critical" | "high" | "medium" | "low" | "informational";

export interface SecurityIncident {
  readonly id: string;
  readonly title: string;
  readonly class: IncidentClass;
  readonly severity: IncidentSeverity;
  readonly state: IncidentState;
  readonly detectedAt: number;
  readonly detectedBy: string;
  readonly affectedWorkspaces: readonly string[];
  readonly affectedCapabilities: readonly string[];
  readonly affectedWorkers: readonly string[];
  readonly description: string;
  readonly containmentActions: readonly ContainmentAction[];
  readonly remediationSteps: readonly RemediationStep[];
  readonly postmortem?: PostmortemReport;
  readonly timeline: readonly IncidentEvent[];
}

export interface ContainmentAction {
  readonly action: "quarantine_worker" | "revoke_credential" | "revoke_capability" |
    "block_network" | "isolate_workspace" | "halt_deployment" | "notify_admin";
  readonly target: string;
  readonly takenAt: number;
  readonly takenBy: string;
  readonly reversible: boolean;
}

export interface RemediationStep {
  readonly id: string;
  readonly description: string;
  readonly status: "pending" | "in_progress" | "completed" | "blocked";
  readonly assignedTo?: string;
  readonly startedAt?: number;
  readonly completedAt?: number;
}

export interface PostmortemReport {
  readonly summary: string;
  readonly rootCause: string;
  readonly impact: { workspaces: number; capabilities: number; dataExposed: boolean };
  readonly timeline: readonly string[];
  readonly lessonsLearned: readonly string[];
  readonly preventionMeasures: readonly string[];
  readonly authoredBy: string;
  readonly reviewedBy: readonly string[];
  readonly publishedAt: number;
}

export interface IncidentEvent {
  readonly timestamp: number;
  readonly actor: string;
  readonly action: string;
  readonly detail: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Vulnerability Disclosure and Response
// ═══════════════════════════════════════════════════════════════════════════

export interface VulnerabilityReport {
  readonly id: string;
  readonly cveId?: string;
  readonly title: string;
  readonly severity: "critical" | "high" | "medium" | "low" | "none";
  readonly cvssScore?: number;
  readonly affectedVersions: readonly string[];
  readonly fixedVersion?: string;
  readonly description: string;
  readonly workaround?: string;
  readonly reportedBy: string;
  readonly reportedAt: number;
  readonly disclosedAt?: number;
  readonly fixedAt?: number;
  readonly state: "reported" | "confirmed" | "fix_in_progress" | "fixed" | "disclosed" | "disputed";
  readonly references: readonly string[];
}

export interface DisclosurePolicy {
  readonly embargoPeriodDays: number;
  readonly coordinatedDisclosure: boolean;
  readonly bugBountyUrl?: string;
  readonly securityContact: string;
  readonly pgpKey?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Capability Supply-Chain Response
// ═══════════════════════════════════════════════════════════════════════════

export interface SupplyChainAction {
  readonly id: string;
  readonly kind: "revoke_publisher" | "quarantine_package" | "quarantine_version" |
    "notify_deployments" | "block_install" | "block_update" | "restore_safe_version";
  readonly target: { publisher?: string; capabilityId?: string; version?: string };
  readonly reason: string;
  readonly incidentRef?: string;
  readonly executedAt: number;
  readonly executedBy: string;
  readonly evidenceHash: string;
}

export interface QuarantineRecord {
  readonly id: string;
  readonly capabilityId: string;
  readonly version?: string;
  readonly publisherId?: string;
  readonly quarantinedAt: number;
  readonly reason: string;
  readonly incidentRef?: string;
  readonly active: boolean;
  readonly safeVersion?: string;
}

export interface SupplyChainStatus {
  readonly activeQuarantines: readonly QuarantineRecord[];
  readonly blockedPublishers: readonly string[];
  readonly recentActions: readonly SupplyChainAction[];
  readonly affectedDeployments: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Release Channels and Support
// ═══════════════════════════════════════════════════════════════════════════

export type ReleaseChannel = "stable" | "lts" | "candidate" | "beta" | "edge";

export interface ReleaseRecord {
  readonly version: string;
  readonly channel: ReleaseChannel;
  readonly publishedAt: number;
  readonly eolDate?: number;
  readonly supportedUntil?: number;
  readonly breakingChanges: readonly string[];
  readonly migrationGuide?: string;
  readonly rollbackTarget?: string;
  readonly sbomUrl?: string;
  readonly releaseNotes: string;
  readonly securityFixes: readonly string[];
}

export interface CompatibilityMatrix {
  readonly version: string;
  readonly supportedProfiles: readonly DeploymentProfileKind[];
  readonly minimumPhaseLevel: number;
  readonly apiVersions: readonly string[];
  readonly databaseSchemaVersion: number;
  readonly capabilitySchemaVersion: number;
}

export interface SupportWindow {
  readonly channel: ReleaseChannel;
  readonly securityPatchesMonths: number;
  readonly bugFixesMonths: number;
  readonly technicalSupportMonths: number;
  readonly extendedSupportAvailable: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Backup and Disaster Recovery Operations
// ═══════════════════════════════════════════════════════════════════════════

export interface BackupSchedule {
  readonly id: string;
  readonly scope: "workspace" | "organization" | "full_deployment";
  readonly frequencyMinutes: number;
  readonly retentionCount: number;
  readonly encrypted: boolean;
  readonly components: readonly BackupComponentKind;
  readonly verifyAfterCreate: boolean;
  readonly enabled: boolean;
}

export type BackupComponentKind =
  | "execution_records"
  | "workflow_states"
  | "checkpoints"
  | "audit_records"
  | "artifacts_metadata"
  | "workspace_config"
  | "memory_records"
  | "user_preferences"
  | "policy_records"
  | "enterprise_policies"
  | "incident_records"
  | "delegated_authorities"
  | "capability_catalogs"
  | "slo_configurations"
  | "release_state";

export interface DRPlan {
  readonly id: string;
  readonly name: string;
  readonly rpoMinutes: number;
  readonly rtoMinutes: number;
  readonly lastTestedAt?: number;
  readonly testResult?: "pass" | "fail" | "partial";
  readonly procedures: readonly DRProcedure[];
  readonly verifiedAt?: number;
}

export interface DRProcedure {
  readonly step: number;
  readonly action: string;
  readonly expectedDurationMinutes: number;
  readonly rollbackStep?: string;
}

export interface RestoreVerification {
  readonly id: string;
  readonly backupId: string;
  readonly verifiedAt: number;
  readonly result: "pass" | "fail" | "partial";
  readonly checksRun: number;
  readonly checksPassed: number;
  readonly details: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Deployment Diagnostics
// ═══════════════════════════════════════════════════════════════════════════

export interface EnterpriseDiagnostic {
  readonly id: string;
  readonly category: DiagnosticCategory;
  readonly name: string;
  readonly status: "pass" | "fail" | "warn" | "skip";
  readonly detail: string;
  readonly recommendation?: string;
  readonly checkedAt: number;
}

export type DiagnosticCategory =
  | "connectivity"
  | "identity"
  | "policy"
  | "audit_integrity"
  | "backup"
  | "security"
  | "performance"
  | "compatibility"
  | "certification";

export interface DiagnosticReport {
  readonly runAt: number;
  readonly overallHealth: OperationalHealth["overall"];
  readonly diagnostics: readonly EnterpriseDiagnostic[];
  readonly failCount: number;
  readonly warnCount: number;
  readonly summary: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. Security Assessment Evidence
// ═══════════════════════════════════════════════════════════════════════════

export interface SecurityAssessmentEvidence {
  readonly id: string;
  readonly assessmentType: "self" | "third_party" | "penetration_test" | "vulnerability_scan";
  readonly conductedBy: string;
  readonly conductedAt: number;
  readonly scope: readonly string[];
  readonly findings: readonly SecurityFinding[];
  readonly overallRating: "pass" | "conditional_pass" | "fail";
  readonly evidenceReferences: readonly string[];
}

export interface SecurityFinding {
  readonly id: string;
  readonly severity: "critical" | "high" | "medium" | "low" | "info";
  readonly category: string;
  readonly description: string;
  readonly remediation: string;
  readonly status: "open" | "in_progress" | "resolved" | "accepted_risk" | "wont_fix";
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. Governance
// ═══════════════════════════════════════════════════════════════════════════

export interface GovernanceProposal {
  readonly id: string;
  readonly title: string;
  readonly category: GovernanceCategory;
  readonly description: string;
  readonly proposedBy: string;
  readonly proposedAt: number;
  readonly status: "draft" | "open" | "accepted" | "rejected" | "withdrawn" | "implemented";
  readonly votes: readonly GovernanceVote[];
  readonly implementedIn?: string;
  readonly architecturalImpact: "none" | "low" | "medium" | "high" | "breaking";
}

export type GovernanceCategory =
  | "architecture"
  | "security"
  | "release"
  | "dependency"
  | "deprecation"
  | "process"
  | "community";

export interface GovernanceVote {
  readonly voter: string;
  readonly decision: "approve" | "reject" | "abstain";
  readonly reason: string;
  readonly votedAt: number;
}

export interface ArchitectureException {
  readonly id: string;
  readonly invariant: string;
  readonly violation: string;
  readonly justification: string;
  readonly riskBoundedBy: string;
  readonly migrationPath: string;
  readonly owner: string;
  readonly approvedBy: readonly string[];
  readonly approvedAt: number;
  readonly reviewDate: number;
  readonly status: "active" | "resolved" | "expired";
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

export const ENTERPRISE_ADAPTER_VERSION = 1;

export const ENTERPRISE_BOUNDS = {
  /** Maximum rules per policy bundle. */
  MAX_BUNDLE_RULES: 200,
  /** Maximum delegated authority chain depth. */
  MAX_DELEGATION_DEPTH: 5,
  /** Maximum audit export batch size. */
  MAX_EXPORT_BATCH: 50000,
  /** Maximum SLO evaluation history. */
  MAX_SLO_HISTORY: 1000,
  /** Maximum incident timeline events. */
  MAX_INCIDENT_TIMELINE: 500,
  /** Default retention days for audit records. */
  DEFAULT_RETENTION_DAYS: 365,
  /** Maximum retention days. */
  MAX_RETENTION_DAYS: 2555, // 7 years
  /** Maximum backup retention count. */
  MAX_BACKUP_RETENTION: 100,
  /** Minimum SLO evaluation interval (ms). */
  MIN_SLO_EVAL_INTERVAL_MS: 60_000, // 1 minute
} as const;
