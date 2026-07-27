/**
 * XR Business OS — Main Entry Point
 * 
 * Stage 15: Business OS
 * Version is now derived from src/core/version.ts single source of truth.
 * BusinessOS is a module within XR 3.1.5 (Helios), not a separate version.
 * 
 * This is the unified API for XR Business OS.
 * It initializes all modules and provides a single entry point
 * that integrates with XR's existing architecture.
 * 
 * Usage:
 *   import { BusinessOS } from './business/index.ts';
 *   const biz = new BusinessOS(db);
 *   await biz.initialize();
 *   biz.crm.createContact(workspaceId, { name: 'John' });
 *   biz.sales.createDeal(workspaceId, { title: 'Big Deal', value: 50000 });
 *   biz.workers.deployWorker(workspaceId, 'sales_director');
 */

import { BusinessDatabase } from './core/database.ts';
import { OrganizationManager } from './core/organization.ts';
import { RBACManager } from './core/rbac.ts';
import { ContactManager } from './core/contacts.ts';
import { PipelineManager } from './core/pipeline.ts';
import { BusinessEventBus } from './core/bus.ts';
import { AuditTrail } from './core/audit.ts';

import { CRMModule } from './modules/crm/index.ts';
import { SalesModule } from './modules/sales/index.ts';
import { MarketingModule } from './modules/marketing/index.ts';
import { SupportModule } from './modules/support/index.ts';
import { ProjectsModule } from './modules/projects/index.ts';
import { KnowledgeModule } from './modules/knowledge/index.ts';
import { FinanceModule } from './modules/finance/index.ts';
import { HRModule } from './modules/hr/index.ts';
import { AnalyticsModule } from './modules/analytics/index.ts';
import { AutomationEngine } from './modules/automation/engine.ts';
import { SchedulingModule } from './modules/scheduling/index.ts';
import { CommunicationModule } from './modules/communication/index.ts';
import { DocumentsModule } from './modules/documents/index.ts';
import { MeetingsModule } from './modules/meetings/index.ts';
import { AIWorkersModule, WORKER_DEFINITIONS } from './modules/ai-workers/index.ts';

import { ConnectorRegistry } from '../integrations/registry.ts';
import { OAuthManager } from '../integrations/oauth.ts';
import { CredentialVault } from '../integrations/credentials.ts';
import { BusinessSecurityPolicies } from '../security/policies.ts';
import { CORE_VERSION, CODENAME, PKG } from '../core/version.ts';
import type { LifecycleHook } from '../core/lifecycle.ts';

// XR 5.3 — Operating Layer
import { BusinessRecordMutationService } from './core/record-mutation.ts';
import { OutcomeTracker } from './core/outcome.ts';
import { WorkerGovernanceService } from './core/worker-contract.ts';
import { AuthorityBoundaryService } from './core/authority-boundaries.ts';
import { ArtifactEvidenceService } from './core/artifact-evidence.ts';
import { ApprovalEscalationService } from './core/approval-escalation.ts';
import { LocalPrivacyService } from './core/local-privacy.ts';
import { ExecutionBridge } from './core/execution-bridge.ts';
import { BusinessOperatingLayer } from './core/operating-layer.ts';
import { applyOperatingLayerMigration } from './core/migration.ts';
import { JOURNEY_DEFINITIONS } from './core/journeys.ts';

export interface BusinessOSConfig {
  /** XR's existing SQLite database instance */
  db: any;
  /** Master encryption key for credential vault */
  masterKey?: string;
  /** Enabled modules (default: all) */
  modules?: string[];
}

export class BusinessOS implements LifecycleHook {
  // Core
  readonly db: BusinessDatabase;
  readonly orgs: OrganizationManager;
  readonly rbac: RBACManager;
  readonly contacts: ContactManager;
  readonly pipelines: PipelineManager;
  readonly bus: BusinessEventBus;
  readonly audit: AuditTrail;

  // Modules
  readonly crm: CRMModule;
  readonly sales: SalesModule;
  readonly marketing: MarketingModule;
  readonly support: SupportModule;
  readonly projects: ProjectsModule;
  readonly knowledge: KnowledgeModule;
  readonly finance: FinanceModule;
  readonly hr: HRModule;
  readonly analytics: AnalyticsModule;
  readonly automation: AutomationEngine;
  readonly scheduling: SchedulingModule;
  readonly communication: CommunicationModule;
  readonly documents: DocumentsModule;
  readonly meetings: MeetingsModule;
  readonly workers: AIWorkersModule;

  // Integrations
  readonly connectors: ConnectorRegistry;
  readonly oauth: OAuthManager;
  readonly credentials: CredentialVault;

  // Security
  readonly security: BusinessSecurityPolicies;

  // XR 5.3 — Personal and Business Operating Layer
  readonly recordMutations: BusinessRecordMutationService;
  readonly outcomes: OutcomeTracker;
  readonly workerGovernance: WorkerGovernanceService;
  readonly authority: AuthorityBoundaryService;
  readonly artifacts: ArtifactEvidenceService;
  readonly approvals: ApprovalEscalationService;
  readonly privacy: LocalPrivacyService;
  readonly executionBridge: ExecutionBridge;
  readonly operatingLayer: BusinessOperatingLayer;

  private initialized = false;

  constructor(config: BusinessOSConfig) {
    // Initialize core
    this.db = new BusinessDatabase(config.db);
    this.orgs = new OrganizationManager(this.db);
    this.rbac = new RBACManager(this.db);
    this.contacts = new ContactManager(this.db);
    this.pipelines = new PipelineManager(this.db);
    this.bus = new BusinessEventBus(this.db);
    this.audit = new AuditTrail(this.db);

    // XR 5.3 — Operating Layer Services (created first to be injected into modules)
    this.recordMutations = new BusinessRecordMutationService({ db: this.db, audit: this.audit });
    this.outcomes = new OutcomeTracker({ db: this.db });
    this.workerGovernance = new WorkerGovernanceService({ db: this.db, audit: this.audit });
    this.authority = new AuthorityBoundaryService({ db: this.db, rbac: this.rbac });
    this.artifacts = new ArtifactEvidenceService({ db: this.db });
    this.approvals = new ApprovalEscalationService({ db: this.db });
    this.privacy = new LocalPrivacyService({ db: this.db });
    this.executionBridge = new ExecutionBridge({ db: this.db, audit: this.audit });
    this.operatingLayer = new BusinessOperatingLayer({
      db: this.db,
      audit: this.audit,
      bus: this.bus,
      rbac: this.rbac,
    });

    // Initialize modules
    const moduleConfig = { db: this.db, bus: this.bus, audit: this.audit };

    this.crm = new CRMModule({ ...moduleConfig, contacts: this.contacts, pipelines: this.pipelines });
    this.sales = new SalesModule({ ...moduleConfig, pipelines: this.pipelines, contacts: this.contacts });
    this.marketing = new MarketingModule({ ...moduleConfig, contacts: this.contacts });
    this.support = new SupportModule(moduleConfig);
    this.projects = new ProjectsModule(moduleConfig);
    this.knowledge = new KnowledgeModule({ db: this.db, bus: this.bus });
    this.finance = new FinanceModule(moduleConfig);
    this.hr = new HRModule({ db: this.db, bus: this.bus });
    this.analytics = new AnalyticsModule({ db: this.db, bus: this.bus });
    this.automation = new AutomationEngine({ db: this.db, bus: this.bus });
    this.scheduling = new SchedulingModule({ db: this.db, bus: this.bus });
    this.communication = new CommunicationModule({ db: this.db, bus: this.bus });
    this.documents = new DocumentsModule({ db: this.db, bus: this.bus });
    this.meetings = new MeetingsModule({ db: this.db, bus: this.bus });
    this.workers = new AIWorkersModule({ ...moduleConfig, rbac: this.rbac, governance: this.workerGovernance });

    // Initialize integrations
    this.connectors = new ConnectorRegistry();
    this.oauth = new OAuthManager();
    this.credentials = new CredentialVault(this.db, config.masterKey ?? 'xr-business-os-default-key');

    // Initialize security
    this.security = new BusinessSecurityPolicies(this.db, this.rbac, this.audit);

    // Wire business modules into operating layer
    this.operatingLayer.setBusinessModules({
      crm: this.crm,
      sales: this.sales,
      projects: this.projects,
      documents: this.documents,
      meetings: this.meetings,
      knowledge: this.knowledge,
      finance: this.finance,
      support: this.support,
      scheduling: this.scheduling,
    });
  }

  async onInit(): Promise<void> {
    await this.initialize();
  }

  async onStart(): Promise<void> {
    // Business OS is ready; no special startup actions needed.
  }

  async onStop(): Promise<void> {
    // Graceful shutdown for business modules (best-effort).
  }

  /**
   * Initialize Business OS — creates database tables.
   * XR 5.3: also initializes operating layer (journeys, workflows, privacy).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.db.initialize();

    // XR 5.3: ensure operating layer tables
    try {
      this.db.ensureOperatingLayer();
    } catch {}

    // XR 5.3: initialize operating layer (publish templates, subscribe events)
    try {
      await this.operatingLayer.initialize();
    } catch (e) {
      console.warn('[XR Business OS] Operating layer init warning:', (e as Error).message);
    }

    this.initialized = true;

    // Startup diagnostics go to stderr so machine-readable CLI stdout
    // (notably `xr doctor --json`) remains parseable in CI and automation.
    console.error('[XR Business OS] Initialized successfully');
    console.error(`[XR Business OS] ${Object.keys(this.db.getStats()).length} tables created`);
    console.error(`[XR Business OS] Operating Layer — ${JOURNEY_DEFINITIONS.length} journeys, templates published`);
  }

  /**
   * Check if Business OS is initialized.
   */
  isInitialized(): boolean {
    return this.initialized || this.db.isInitialized();
  }

  /**
   * Get system health status.
   */
  getHealth(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    modules: Record<string, boolean>;
    stats: Record<string, number>;
  } {
    const modules: Record<string, boolean> = {
      crm: this.crm.isHealthy(),
      sales: this.sales.isHealthy(),
      marketing: this.marketing.isHealthy(),
      support: this.support.isHealthy(),
      projects: this.projects.isHealthy(),
      knowledge: this.knowledge.isHealthy(),
      finance: this.finance.isHealthy(),
      hr: this.hr.isHealthy(),
      analytics: this.analytics.isHealthy(),
      scheduling: this.scheduling.isHealthy(),
      communication: this.communication.isHealthy(),
      documents: this.documents.isHealthy(),
      meetings: this.meetings.isHealthy(),
      workers: this.workers.isHealthy(),
    };

    const healthy = Object.values(modules).filter(Boolean).length;
    const total = Object.values(modules).length;

    return {
      status: healthy === total ? 'healthy' : healthy > total / 2 ? 'degraded' : 'unhealthy',
      modules,
      stats: this.db.getStats(),
    };
  }

  /**
   * Get version info — now unified with XR core version.
   * BusinessOS is a module inside XR, not a separate product version.
   */
  getVersion(): { version: string; codename: string; stage: string; modules: string[]; pkg: string } {
    return {
      version: CORE_VERSION,
      codename: CODENAME,
      stage: `XR ${CORE_VERSION} (${CODENAME}) — Business OS Module`,
      pkg: PKG.name,
      modules: [
        'crm', 'sales', 'marketing', 'support', 'projects', 'knowledge',
        'finance', 'hr', 'analytics', 'automation', 'scheduling',
        'communication', 'documents', 'meetings', 'ai-workers',
      ],
    };
  }

  /**
   * Deploy all default AI Workers to a workspace.
   */
  deployAllWorkers(workspaceId: string): ReturnType<AIWorkersModule['deployAllDefaults']> {
    return this.workers.deployAllDefaults(workspaceId);
  }
}

// Re-export everything
export * from './core/types.ts';
export * from './core/operating-types.ts';
export * from './core/index.ts';
export { CRMModule } from './modules/crm/index.ts';
export { SalesModule } from './modules/sales/index.ts';
export { MarketingModule } from './modules/marketing/index.ts';
export { SupportModule } from './modules/support/index.ts';
export { ProjectsModule } from './modules/projects/index.ts';
export { KnowledgeModule } from './modules/knowledge/index.ts';
export { FinanceModule } from './modules/finance/index.ts';
export { HRModule } from './modules/hr/index.ts';
export { AnalyticsModule } from './modules/analytics/index.ts';
export { AutomationEngine } from './modules/automation/engine.ts';
export { SchedulingModule } from './modules/scheduling/index.ts';
export { CommunicationModule } from './modules/communication/index.ts';
export { DocumentsModule } from './modules/documents/index.ts';
export { MeetingsModule } from './modules/meetings/index.ts';
export { AIWorkersModule, WORKER_DEFINITIONS } from './modules/ai-workers/index.ts';
export { ConnectorRegistry, CONNECTORS } from '../integrations/registry.ts';
export { OAuthManager } from '../integrations/oauth.ts';
export { CredentialVault } from '../integrations/credentials.ts';
export { BusinessSecurityPolicies } from '../security/policies.ts';
export { BUSINESS_CLI_COMMANDS, BUSINESS_MODULE_IDS } from './cli.ts';

// XR 5.3 Operating Layer Exports
export { BusinessRecordMutationService } from './core/record-mutation.ts';
export { OutcomeTracker } from './core/outcome.ts';
export { WorkerGovernanceService } from './core/worker-contract.ts';
export { AuthorityBoundaryService } from './core/authority-boundaries.ts';
export { ArtifactEvidenceService } from './core/artifact-evidence.ts';
export { ApprovalEscalationService } from './core/approval-escalation.ts';
export { LocalPrivacyService } from './core/local-privacy.ts';
export { ExecutionBridge } from './core/execution-bridge.ts';
export { BusinessOperatingLayer } from './core/operating-layer.ts';
export { JOURNEY_DEFINITIONS, getJourneyById, listAllJourneys } from './core/journeys.ts';
export { getAllBusinessWorkflowTemplates, createWorkflowTemplateForJourney } from './core/workflow-templates.ts';
