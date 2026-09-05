/**
 * XR 6.1 — Enterprise Trust and Operations.
 *
 * Public entry point for organization policy, delegated authority, audit
 * export/retention, SLOs, incidents, supply-chain response, disaster recovery,
 * release/support, and certification evidence.
 *
 * LOCAL AUTONOMY GUARANTEE
 * ------------------------
 * `createEnterpriseServices()` constructs every service with pure in-memory
 * state and injected side-effect handlers. It performs NO network I/O, opens
 * NO database, and requires NO control plane. A `personal_local` deployment
 * gets the full API surface offline, with organization administration simply
 * reporting "not applicable".
 *
 * This is enforced by `test/enterprise/governance-matrix.test.ts`.
 */

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  // Policy
  PolicyLayer,
  PolicyValue,
  PolicyRule,
  PolicyResolution,
  PolicyResolutionReason,
  PolicyDecisionEntry,
  PolicyOverrideAttempt,
  EffectivePolicy,
  PolicyBundle,
  PolicyBundleState,
  PolicyBundleValidation,
  SafetyRelevantKey,
  VisibilityKey,
  // Authority
  AuthoritySubject,
  AuthoritySubjectKind,
  AuthorityDelegation,
  DelegationState,
  DelegationValidation,
  AuthorityReview,
  AuthorityReviewOutcome,
  EffectiveAuthority,
  // Audit
  AuditEventClass,
  AuditSensitivity,
  AuditRecord,
  RedactionRule,
  RedactionMode,
  RedactedField,
  RedactedAuditRecord,
  ExportFormat,
  ExportStatus,
  AuditExportRequest,
  AuditExportManifest,
  AuditExportResult,
  AuditExportVerification,
  AuditAccessLogEntry,
  RetentionSchedule,
  RetentionRunResult,
  RetentionEvaluation,
  RetentionAction,
  LegalHold,
  // Operations
  SloId,
  SloUnit,
  SloDefinition,
  SloSample,
  SloStatus,
  SloReport,
  AlertSeverity,
  AlertCondition,
  OperationalStatus,
  // Incidents
  Incident,
  IncidentKind,
  IncidentState,
  IncidentSeverity,
  IncidentEvidence,
  IncidentTimelineEntry,
  IncidentResponseAction,
  IncidentPostmortem,
  IncidentTransitionResult,
  // Supply chain
  RevocationScope,
  RevocationReason,
  RevocationEntry,
  InstallDecision,
  CatalogMode,
  CapabilityCatalog,
  CatalogDecision,
  AffectedDeploymentNotice,
  SupplyChainResponseResult,
  // Recovery
  BackupVerification,
  BackupVerificationStatus,
  RestoreMode,
  RestorePlan,
  RestorePreflight,
  RestoreOutcome,
  RecoveryTargets,
  RecoveryTargetAssessment,
  RecoveryDrill,
  // Release
  ReleaseChannel,
  SupportState,
  ReleaseRecord,
  CompatibilityDeclaration,
  CompatibilityCheck,
  SupportWindow,
  ReleaseArtifactEvidence,
  RollbackValidation,
  // Certification
  AssuranceKind,
  ControlStatus,
  ControlEvidence,
  ThreatModelEntry,
  EvidencePack,
} from "./types.ts";

export {
  ENTERPRISE_SCHEMA_VERSION,
  POLICY_ENGINE_VERSION,
  AUDIT_EXPORT_FORMAT_VERSION,
  EVIDENCE_PACK_VERSION,
  ENTERPRISE_BOUNDS,
  POLICY_LAYERS,
  POLICY_LAYER_SPECIFICITY,
  POLICY_LAYER_PRIVILEGE,
  NON_OVERRIDABLE_VISIBILITY_KEYS,
  AUDIT_EVENT_CLASSES,
  SLO_IDS,
  INCIDENT_STATES,
  INCIDENT_KINDS,
  INCIDENT_TRANSITIONS,
  RELEASE_CHANNELS,
  SENSITIVITY_ORDER,
  isPolicyLayer,
  isAuditEventClass,
  isIncidentState,
  isIncidentKind,
  isReleaseChannel,
  isVisibilityKey,
  canTransitionIncident,
} from "./types.ts";

// ── Policy ─────────────────────────────────────────────────────────────────
export {
  SAFETY_KEY_SPECS,
  VISIBILITY_INVARIANT_FLOOR,
  VISIBILITY_KEY_DESCRIPTIONS,
  POLICY_LAYER_DESCRIPTIONS,
  isSafetyRelevantKey,
  getSafetyKeySpec,
  compareRestrictiveness,
  moreRestrictive,
  isVisibilitySuppression,
  canAuthorLayer,
  layerSpecificity,
  layerPrivilege,
  allPolicyLayers,
  type RestrictivenessKind,
  type SafetyKeySpec,
} from "./policy/layers.ts";

export {
  resolvePolicy,
  createEffectivePolicy,
  evaluatePolicy,
  explainPolicyKey,
  summarizeRejectedOverrides,
  type ResolvePolicyOptions,
  type PolicyExplanation,
} from "./policy/engine.ts";

export {
  PolicyBundleStore,
  validateBundleRules,
  hashRules,
  policyRule,
  type PolicyBundleStoreDeps,
  type CreateBundleParams,
  type BundleOperationResult,
  type ValidateBundleOptions,
} from "./policy/bundles.ts";

// ── Authority ──────────────────────────────────────────────────────────────
export {
  DelegationRegistry,
  validateDelegation,
  scopeHeld,
  minRiskTier,
  rootAuthority,
  type DelegationRegistryDeps,
  type CreateDelegationParams,
  type DelegationResult,
  type ValidateDelegationParams,
} from "./authority/delegation.ts";

// ── Audit ──────────────────────────────────────────────────────────────────
export {
  redactRecord,
  redactRecords,
  proveRedactionFaithful,
  detectRedactionBypass,
  digestValue,
  DEFAULT_REDACTION_RULES,
  DEFAULT_SENSITIVE_PATTERNS,
  type RedactionOptions,
  type RedactionOutcome,
  type RedactionProofResult,
} from "./audit/redaction.ts";

export {
  AuditExportService,
  LOCAL_EXPORT_AUTHORIZER,
  verifyExportedChain,
  classifyAuditEvent,
  defaultSensitivity,
  adaptWorkspaceAuditRows,
  type AuditExportServiceDeps,
  type AuditExportAuthorizer,
  type ChainCheck,
  type RawAuditRow,
} from "./audit/export.ts";

export {
  RetentionService,
  defaultRetentionSchedule,
  DEFAULT_RETENTION_DAYS,
  type RetentionServiceDeps,
} from "./audit/retention.ts";

// ── Operations ─────────────────────────────────────────────────────────────
export {
  SloRegistry,
  SLO_CATALOG,
  listSloDefinitions,
  getSloDefinition,
  computeSlo,
  type SloRegistryDeps,
  type SloComputeOptions,
} from "./operations/slo.ts";

export {
  buildOperationalStatus,
  alertsAtOrAbove,
  summarizeStatus,
  type BuildStatusInput,
} from "./operations/status.ts";

// ── Incidents ──────────────────────────────────────────────────────────────
export {
  IncidentService,
  impliesUserVisibleImpact,
  type IncidentServiceDeps,
  type DeclareIncidentParams,
  type ResponseHandlers,
  type ResponseHandlerResult,
  type ResponseActionKind,
} from "./incidents/workflow.ts";

// ── Supply chain ───────────────────────────────────────────────────────────
export {
  SupplyChainResponseService,
  parseSemver,
  compareSemver,
  satisfiesRange,
  type SupplyChainDeps,
  type CapabilitySnapshot,
} from "./supplychain/response.ts";

// ── Recovery ───────────────────────────────────────────────────────────────
export {
  RecoveryOperations,
  CONSISTENCY_GROUPS,
  isProfileRestoreCompatible,
  scanObjectForCredentials,
  digestBackupContent,
  type RecoveryOperationsDeps,
} from "./recovery/operations.ts";

// ── Release ────────────────────────────────────────────────────────────────
export {
  ReleaseRegistry,
  validateRollback,
  currentCompatibility,
  CHANNEL_SUPPORT_DAYS,
  CHANNEL_DESCRIPTIONS,
  type ReleaseRegistryDeps,
  type RollbackInvariantProbe,
} from "./release/channels.ts";

// ── Certification ──────────────────────────────────────────────────────────
export {
  buildEvidencePack,
  assertNoFalseCertificationClaim,
  renderEvidenceSummary,
  PHASE12_CONTROLS,
  PHASE12_THREAT_MODEL,
  EVIDENCE_DISCLAIMER,
  type BuildEvidencePackParams,
} from "./certification/evidence.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Composed service bundle
// ═══════════════════════════════════════════════════════════════════════════

import type { DeploymentProfileKind } from "./deployment/types.ts";
import { getDeploymentProfile } from "./deployment/profiles.ts";
import { PolicyBundleStore } from "./policy/bundles.ts";
import { DelegationRegistry } from "./authority/delegation.ts";
import { AuditExportService, type AuditExportAuthorizer } from "./audit/export.ts";
import { RetentionService } from "./audit/retention.ts";
import { SloRegistry } from "./operations/slo.ts";
import { IncidentService, type ResponseHandlers } from "./incidents/workflow.ts";
import { SupplyChainResponseService, type SupplyChainDeps } from "./supplychain/response.ts";
import { RecoveryOperations, type RecoveryOperationsDeps } from "./recovery/operations.ts";
import { ReleaseRegistry } from "./release/channels.ts";
import type { AuditRecord } from "./types.ts";

export interface EnterpriseServices {
  readonly profile: DeploymentProfileKind;
  /** True when this profile supports organization administration at all. */
  readonly organizationAdministrationAvailable: boolean;
  /** True when this profile can operate with no control plane. */
  readonly localAutonomy: boolean;
  readonly policy: PolicyBundleStore;
  readonly authority: DelegationRegistry;
  readonly auditExport: AuditExportService;
  readonly retention: RetentionService;
  readonly slo: SloRegistry;
  readonly incidents: IncidentService;
  readonly supplyChain: SupplyChainResponseService;
  readonly recovery: RecoveryOperations;
  readonly releases: ReleaseRegistry;
}

export interface CreateEnterpriseServicesOptions {
  readonly profile: DeploymentProfileKind;
  readonly currentVersion: string;
  /** Audit sink — typically `WorkspaceStore.audit`. Optional for local use. */
  readonly audit?: (event: string, detail: Record<string, unknown>) => void;
  readonly now?: () => number;
  /** Audit record source for export. Defaults to an empty set. */
  readonly auditSource?: () => readonly AuditRecord[];
  readonly exportAuthorizer?: AuditExportAuthorizer;
  readonly incidentHandlers?: ResponseHandlers;
  readonly supplyChain?: Omit<SupplyChainDeps, "audit" | "now">;
  readonly recovery?: Omit<RecoveryOperationsDeps, "audit" | "now" | "currentVersion" | "currentProfile">;
}

/**
 * Construct the full enterprise service bundle.
 *
 * Performs no I/O. Safe to call in `personal_local` with no arguments beyond
 * the profile and version.
 */
export function createEnterpriseServices(options: CreateEnterpriseServicesOptions): EnterpriseServices {
  const { profile, audit, now } = options;
  const profileDef = getDeploymentProfile(profile);

  const incidents = new IncidentService({ audit, now, handlers: options.incidentHandlers });

  const supplyChain = new SupplyChainResponseService({
    audit,
    now,
    ...options.supplyChain,
    declareIncident:
      options.supplyChain?.declareIncident ??
      ((params) =>
        incidents.declare({
          kind: params.reason === "compromised_publisher" ? "provider_compromise" : "malicious_package",
          severity: "critical",
          title: `Capability revoked: ${params.capabilityId}`,
          summary: params.detail,
          detectedBy: params.actorId,
          affected: [params.capabilityId],
        }).incidentId),
  });

  const recovery = new RecoveryOperations({
    audit,
    now,
    currentVersion: options.currentVersion,
    currentProfile: profile,
    getManifest: options.recovery?.getManifest ?? (() => undefined),
    recomputeIntegrityHash: options.recovery?.recomputeIntegrityHash,
    scanForCredentials: options.recovery?.scanForCredentials,
    applyComponent: options.recovery?.applyComponent,
    targets:
      options.recovery?.targets ??
      (profileDef.recovery.rpoMinutes !== undefined && profileDef.recovery.rtoMinutes !== undefined
        ? {
            rpoMinutes: profileDef.recovery.rpoMinutes,
            rtoMinutes: profileDef.recovery.rtoMinutes,
            profile,
          }
        : undefined),
  });

  return {
    profile,
    organizationAdministrationAvailable: profileDef.capabilities.organizationTenancy,
    localAutonomy: !profileDef.capabilities.controlPlane || profileDef.offlineSupported,
    policy: new PolicyBundleStore({ audit, now }),
    authority: new DelegationRegistry({ audit, now }),
    auditExport: new AuditExportService({
      source: options.auditSource ?? (() => []),
      authorizer: options.exportAuthorizer,
      audit,
      now,
    }),
    retention: new RetentionService({ audit, now }),
    slo: new SloRegistry({ now, profile }),
    incidents,
    supplyChain,
    recovery,
    releases: new ReleaseRegistry({ audit, now }),
  };
}
