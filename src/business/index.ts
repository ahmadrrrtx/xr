/**
 * XR Business OS — Main Entry Point
 * 
 * Stage 15: Business OS
 * 
 * This is the unified API for XR Business OS.
 * It initializes all modules and provides a single entry point
 * that integrates with XR's existing architecture.
 * 
 * Usage:
 *   import { BusinessOS } from './business/index.js';
 *   const biz = new BusinessOS(db);
 *   await biz.initialize();
 *   biz.crm.createContact(workspaceId, { name: 'John' });
 *   biz.sales.createDeal(workspaceId, { title: 'Big Deal', value: 50000 });
 *   biz.workers.deployWorker(workspaceId, 'sales_director');
 */

import { BusinessDatabase } from './core/database.js';
import { OrganizationManager } from './core/organization.js';
import { RBACManager } from './core/rbac.js';
import { ContactManager } from './core/contacts.js';
import { PipelineManager } from './core/pipeline.js';
import { BusinessEventBus } from './core/bus.js';
import { AuditTrail } from './core/audit.js';

import { CRMModule } from './modules/crm/index.js';
import { SalesModule } from './modules/sales/index.js';
import { MarketingModule } from './modules/marketing/index.js';
import { SupportModule } from './modules/support/index.js';
import { ProjectsModule } from './modules/projects/index.js';
import { KnowledgeModule } from './modules/knowledge/index.js';
import { FinanceModule } from './modules/finance/index.js';
import { HRModule } from './modules/hr/index.js';
import { AnalyticsModule } from './modules/analytics/index.js';
import { AutomationEngine } from './modules/automation/engine.js';
import { SchedulingModule } from './modules/scheduling/index.js';
import { CommunicationModule } from './modules/communication/index.js';
import { DocumentsModule } from './modules/documents/index.js';
import { MeetingsModule } from './modules/meetings/index.js';
import { AIWorkersModule, WORKER_DEFINITIONS } from './modules/ai-workers/index.js';

import { ConnectorRegistry } from '../integrations/registry.js';
import { OAuthManager } from '../integrations/oauth.js';
import { CredentialVault } from '../integrations/credentials.js';
import { BusinessSecurityPolicies } from '../security/policies.js';

export interface BusinessOSConfig {
  /** XR's existing SQLite database instance */
  db: any;
  /** Master encryption key for credential vault */
  masterKey?: string;
  /** Enabled modules (default: all) */
  modules?: string[];
}

export class BusinessOS {
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
    this.workers = new AIWorkersModule({ ...moduleConfig, rbac: this.rbac });

    // Initialize integrations
    this.connectors = new ConnectorRegistry();
    this.oauth = new OAuthManager();
    this.credentials = new CredentialVault(this.db, config.masterKey ?? 'xr-business-os-default-key');

    // Initialize security
    this.security = new BusinessSecurityPolicies(this.db, this.rbac, this.audit);
  }

  /**
   * Initialize Business OS — creates database tables.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.db.initialize();
    this.initialized = true;

    console.log('[XR Business OS] Initialized successfully');
    console.log(`[XR Business OS] ${Object.keys(this.db.getStats()).length} tables created`);
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
   * Get version info.
   */
  getVersion(): { version: string; stage: string; modules: string[] } {
    return {
      version: '15.0.0',
      stage: 'XR 15 Business OS',
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
export * from './core/types.js';
export * from './core/index.js';
export { CRMModule } from './modules/crm/index.js';
export { SalesModule } from './modules/sales/index.js';
export { MarketingModule } from './modules/marketing/index.js';
export { SupportModule } from './modules/support/index.js';
export { ProjectsModule } from './modules/projects/index.js';
export { KnowledgeModule } from './modules/knowledge/index.js';
export { FinanceModule } from './modules/finance/index.js';
export { HRModule } from './modules/hr/index.js';
export { AnalyticsModule } from './modules/analytics/index.js';
export { AutomationEngine } from './modules/automation/engine.js';
export { SchedulingModule } from './modules/scheduling/index.js';
export { CommunicationModule } from './modules/communication/index.js';
export { DocumentsModule } from './modules/documents/index.js';
export { MeetingsModule } from './modules/meetings/index.js';
export { AIWorkersModule, WORKER_DEFINITIONS } from './modules/ai-workers/index.js';
export { ConnectorRegistry, CONNECTORS } from '../integrations/registry.js';
export { OAuthManager } from '../integrations/oauth.js';
export { CredentialVault } from '../integrations/credentials.js';
export { BusinessSecurityPolicies } from '../security/policies.js';
export { BUSINESS_CLI_COMMANDS, BUSINESS_MODULE_IDS } from './cli.js';
