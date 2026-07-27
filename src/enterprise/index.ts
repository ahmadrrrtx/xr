/**
 * XR 6.1 — Enterprise Trust & Operations (Phase 12)
 *
 * Public entry point for all enterprise governance, audit, SLO,
 * incident, supply-chain, release, backup/DR, diagnostics, security
 * assessment, and governance functionality.
 *
 * Enterprise controls are additive — they never weaken local autonomy.
 * Organization policy cannot silently override task-level safety.
 */

// ── Types ──────────────────────────────────────────────────────────────
export type {
  // Organization Policy
  PolicyTier,
  PolicyTarget,
  PolicyRule,
  PolicySubject,
  PolicyEffect,
  PolicyBundle,
  PolicyEvaluation,
  // Delegated Authority
  EnterpriseRole,
  RoleDefinition,
  DelegatedAuthority,
  AuthorityReview,
  // Audit
  AuditEventClass,
  AuditExportRequest,
  AuditExportFormat,
  AuditExportResult,
  RedactionRule,
  RedactionStrategy,
  RetentionSchedule,
  LegalHold,
  // SLO
  ServiceLevelObjective,
  SLOMetric,
  SLOTarget,
  SLOWindow,
  SLOStatus,
  SLODataPoint,
  OperationalHealth,
  // Incident
  IncidentState,
  IncidentClass,
  IncidentSeverity,
  SecurityIncident,
  ContainmentAction,
  RemediationStep,
  PostmortemReport,
  IncidentEvent,
  // Vulnerability
  VulnerabilityReport,
  DisclosurePolicy,
  // Supply Chain
  SupplyChainAction,
  QuarantineRecord,
  SupplyChainStatus,
  // Release
  ReleaseChannel,
  ReleaseRecord,
  CompatibilityMatrix,
  SupportWindow,
  // Backup/DR
  BackupSchedule,
  BackupComponentKind,
  DRPlan,
  DRProcedure,
  RestoreVerification,
  // Diagnostics
  EnterpriseDiagnostic,
  DiagnosticCategory,
  DiagnosticReport,
  // Security Assessment
  SecurityAssessmentEvidence,
  SecurityFinding,
  // Governance
  GovernanceProposal,
  GovernanceCategory,
  GovernanceVote,
  ArchitectureException,
} from "./types.ts";

export {
  POLICY_PRECEDENCE,
  ENTERPRISE_ADAPTER_VERSION,
  ENTERPRISE_BOUNDS,
} from "./types.ts";

// ── Organization Policy ────────────────────────────────────────────────
export {
  OrganizationPolicyService,
  ENTERPRISE_POLICY_BUNDLES,
} from "./organization-policy.ts";
export type { OrganizationPolicyDeps } from "./organization-policy.ts";

// ── Delegated Authority ────────────────────────────────────────────────
export {
  DelegatedAuthorityService,
  ENTERPRISE_ROLES,
} from "./delegated-authority.ts";
export type { DelegatedAuthorityDeps } from "./delegated-authority.ts";

// ── Audit Export ───────────────────────────────────────────────────────
export { AuditExportService } from "./audit-export.ts";
export type { AuditExportDeps } from "./audit-export.ts";

// ── SLO Operations ─────────────────────────────────────────────────────
export {
  SLOOperationsService,
  DEFAULT_SLOS,
} from "./slo-operations.ts";
export type { SLOOperationsDeps } from "./slo-operations.ts";

// ── Incident Response ──────────────────────────────────────────────────
export { IncidentResponseService } from "./incident-response.ts";
export type { IncidentResponseDeps } from "./incident-response.ts";

// ── Vulnerability Disclosure ───────────────────────────────────────────
export {
  VulnerabilityDisclosureService,
  DEFAULT_DISCLOSURE_POLICY,
} from "./vulnerability-disclosure.ts";
export type { VulnerabilityDisclosureDeps } from "./vulnerability-disclosure.ts";

// ── Supply-Chain Response ──────────────────────────────────────────────
export { SupplyChainResponseService } from "./supply-chain-response.ts";
export type { SupplyChainResponseDeps } from "./supply-chain-response.ts";

// ── Release Channels ───────────────────────────────────────────────────
export {
  ReleaseChannelsService,
  DEFAULT_SUPPORT_WINDOWS,
} from "./release-channels.ts";
export type { ReleaseChannelsDeps } from "./release-channels.ts";

// ── Backup/DR ──────────────────────────────────────────────────────────
export {
  BackupDRService,
  DEFAULT_DR_PLAN,
  BUSINESS_CRITICAL_DR_PLAN,
} from "./backup-dr.ts";
export type { BackupDRDeps } from "./backup-dr.ts";

// ── Deployment Diagnostics ─────────────────────────────────────────────
export { DeploymentDiagnosticsService } from "./deployment-diagnostics.ts";
export type {
  DiagnosticContext,
  DeploymentDiagnosticsDeps,
} from "./deployment-diagnostics.ts";

// ── Security Assessment ────────────────────────────────────────────────
export { SecurityAssessmentService } from "./security-assessment.ts";
export type { SecurityAssessmentDeps } from "./security-assessment.ts";

// ── Governance ─────────────────────────────────────────────────────────
export { GovernanceService } from "./governance.ts";
export type { GovernanceDeps } from "./governance.ts";

// ── Master Enterprise Service (composition root) ──────────────────────

import type { OrganizationPolicyDeps } from "./organization-policy.ts";
import { OrganizationPolicyService } from "./organization-policy.ts";
import type { DelegatedAuthorityDeps } from "./delegated-authority.ts";
import { DelegatedAuthorityService } from "./delegated-authority.ts";
import type { AuditExportDeps } from "./audit-export.ts";
import { AuditExportService } from "./audit-export.ts";
import type { SLOOperationsDeps } from "./slo-operations.ts";
import { SLOOperationsService } from "./slo-operations.ts";
import type { IncidentResponseDeps } from "./incident-response.ts";
import { IncidentResponseService } from "./incident-response.ts";
import type { VulnerabilityDisclosureDeps } from "./vulnerability-disclosure.ts";
import { VulnerabilityDisclosureService } from "./vulnerability-disclosure.ts";
import type { SupplyChainResponseDeps } from "./supply-chain-response.ts";
import { SupplyChainResponseService } from "./supply-chain-response.ts";
import type { ReleaseChannelsDeps } from "./release-channels.ts";
import { ReleaseChannelsService } from "./release-channels.ts";
import type { BackupDRDeps } from "./backup-dr.ts";
import { BackupDRService } from "./backup-dr.ts";
import type { DeploymentDiagnosticsDeps, DiagnosticContext } from "./deployment-diagnostics.ts";
import { DeploymentDiagnosticsService } from "./deployment-diagnostics.ts";
import type { SecurityAssessmentDeps } from "./security-assessment.ts";
import { SecurityAssessmentService } from "./security-assessment.ts";
import type { GovernanceDeps } from "./governance.ts";
import { GovernanceService } from "./governance.ts";
import type { DeploymentProfileKind } from "../deployment/types.ts";

export interface EnterpriseServiceDeps {
  profile: DeploymentProfileKind;
  currentVersion: string;
  policy?: Partial<OrganizationPolicyDeps>;
  authority?: Partial<DelegatedAuthorityDeps>;
  auditExport?: AuditExportDeps;
  slo?: Partial<SLOOperationsDeps>;
  incident?: IncidentResponseDeps;
  vulnerability?: Partial<VulnerabilityDisclosureDeps>;
  supplyChain?: SupplyChainResponseDeps;
  backup?: Partial<BackupDRDeps>;
  diagnostics?: Partial<DeploymentDiagnosticsDeps>;
  securityAssessment?: Partial<SecurityAssessmentDeps>;
  governance?: Partial<GovernanceDeps>;
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

/**
 * The Enterprise Trust & Operations composition root.
 * This class binds all Phase 12 services into a single usable facade
 * for the runtime kernel, CLI, and daemon to consume.
 */
export class EnterpriseService {
  readonly policy: OrganizationPolicyService;
  readonly authority: DelegatedAuthorityService;
  readonly auditExport: AuditExportService;
  readonly slo: SLOOperationsService;
  readonly incident: IncidentResponseService;
  readonly vulnerability: VulnerabilityDisclosureService;
  readonly supplyChain: SupplyChainResponseService;
  readonly releases: ReleaseChannelsService;
  readonly backup: BackupDRService;
  readonly diagnostics: DeploymentDiagnosticsService;
  readonly securityAssessment: SecurityAssessmentService;
  readonly governance: GovernanceService;

  private readonly deps: EnterpriseServiceDeps;

  constructor(deps: EnterpriseServiceDeps) {
    this.deps = deps;

    const audit = deps.audit ?? (() => {});

    this.policy = new OrganizationPolicyService({
      profile: deps.profile,
      audit,
      ...deps.policy,
    });

    this.authority = new DelegatedAuthorityService({
      audit,
      ...deps.authority,
    });

    this.auditExport = new AuditExportService(deps.auditExport ?? {
      retrieveRecords: async () => [],
      countRecords: async () => 0,
      audit,
    });

    this.slo = new SLOOperationsService({
      audit,
      ...deps.slo,
    });

    this.incident = new IncidentResponseService({
      audit,
      ...deps.incident,
    });

    this.vulnerability = new VulnerabilityDisclosureService({
      audit,
      ...deps.vulnerability,
    });

    this.supplyChain = new SupplyChainResponseService({
      audit,
      ...deps.supplyChain,
    });

    this.releases = new ReleaseChannelsService({
      currentVersion: deps.currentVersion,
      audit,
    });

    this.backup = new BackupDRService({
      audit,
      ...deps.backup,
    });

    this.diagnostics = new DeploymentDiagnosticsService({
      audit,
      ...deps.diagnostics,
    });

    this.securityAssessment = new SecurityAssessmentService({
      audit,
      ...deps.securityAssessment,
    });

    this.governance = new GovernanceService({
      audit,
      ...deps.governance,
    });
  }

  /** Get the certification disclaimer (does NOT claim external cert). */
  getCertificationDisclaimer(): string {
    return this.securityAssessment.getCertificationDisclaimer();
  }

  /** Run a full enterprise health check. */
  runEnterpriseHealthCheck(ctx: DiagnosticContext) {
    return this.diagnostics.runDiagnostics(ctx);
  }
}
