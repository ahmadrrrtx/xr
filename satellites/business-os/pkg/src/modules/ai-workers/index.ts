/**
 * XR Business OS — AI Workers Module — XR 5.3 Governed
 *
 * Specialized AI business roles that integrate with all XR engines.
 * Each Worker is an XR Agent with Memory, Research, Skills, Voice, and Computer Control.
 *
 * XR 5.3: Workers are now governed with narrow authority:
 * - role/identity, org/workspace scope, allowed workflows, context scope,
 *   capabilities/tools, model/provider scope, budget, risk/placement,
 *   approval/review requirements, data access, success criteria, escalation,
 *   revocation/disable behavior.
 *
 * Integrates with:
 * - Workflow/Execution/Trust/Intelligence/Context/Capability contracts
 * - BusinessEventBus, AuditTrail, RBACManager
 * - WorkerGovernanceService (authority, budget, escalation)
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { BusinessEventBus } from '../../core/bus.ts';
import type { AuditTrail } from '../../core/audit.ts';
import type { RBACManager } from '../../core/rbac.ts';
import type { AIWorker, WorkerRole, WorkerMessage, WorkerContext, WorkerCapability, Permission } from '../../core/types.ts';
import type { WorkerGovernanceService } from '../../core/worker-contract.ts';
import type { WorkerAuthorityProfile, WorkerInspection } from '../../core/operating-types.ts';

export interface AIWorkersModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
  audit: AuditTrail;
  rbac: RBACManager;
  governance?: WorkerGovernanceService;
}

export interface WorkerDefinition {
  role: WorkerRole;
  name: string;
  description: string;
  systemPrompt: string;
  capabilities: WorkerCapability[];
  permissions: Permission[];
  memoryEnabled: boolean;
  researchEnabled: boolean;
  voiceEnabled: boolean;
  computerControlEnabled: boolean;
  schedule?: string;
  avatar?: string;
}

// Re-export definitions (kept broad for backward compat, but governance narrows effective authority)
export const WORKER_DEFINITIONS: WorkerDefinition[] = [
  {
    role: 'ceo_advisor',
    name: 'CEO Advisor',
    description: 'Strategic advisor providing executive-level insights, business health monitoring, and decision support.',
    systemPrompt: `You are the CEO Advisor. Role: monitor business health, strategic insights, risks/opportunities, executive summaries, market trends, decision support. Access to all business data via governed capabilities. Provide actionable insights, cross-reference, flag anomalies.`,
    capabilities: [
      { module: 'analytics', actions: ['read_kpis', 'read_reports', 'create_dashboard'] },
      { module: 'sales', actions: ['read_deals', 'read_forecast'] },
      { module: 'finance', actions: ['read_pnl', 'read_invoices'] },
      { module: 'support', actions: ['read_tickets', 'read_stats'] },
      { module: 'hr', actions: ['read_directory', 'read_stats'] },
      { module: 'research', actions: ['market_research', 'competitor_analysis'] },
    ],
    permissions: [
      { resource: '*', actions: ['read'] },
      { resource: 'reports', actions: ['create', 'read', 'export'] },
      { resource: 'dashboards', actions: ['create', 'read', 'update'] },
    ],
    memoryEnabled: true,
    researchEnabled: true,
    voiceEnabled: true,
    computerControlEnabled: true,
    schedule: '0 9 * * 1-5',
    avatar: '👔',
  },
  {
    role: 'sales_director',
    name: 'Sales Director',
    description: 'Manages sales pipeline, tracks deals, generates forecasts, and coaches the sales process.',
    systemPrompt: `You are the Sales Director. Manage pipeline, track progress, forecast, coach strategies, analyze win/loss, suggest follow-ups, monitor performance. Focus on velocity, conversion, revenue. Specific recommendations.`,
    capabilities: [
      { module: 'crm', actions: ['read_contacts', 'create_contacts', 'update_contacts'] },
      { module: 'sales', actions: ['read_deals', 'create_deals', 'update_deals', 'move_deals', 'read_forecast'] },
      { module: 'documents', actions: ['create_proposals', 'read_templates'] },
      { module: 'automation', actions: ['create_followup'] },
    ],
    permissions: [
      { resource: 'contacts', actions: ['create', 'read', 'update'] },
      { resource: 'deals', actions: ['create', 'read', 'update'] },
      { resource: 'documents', actions: ['create', 'read'] },
    ],
    memoryEnabled: true,
    researchEnabled: true,
    voiceEnabled: true,
    computerControlEnabled: false,
    avatar: '💼',
  },
  {
    role: 'marketing_director',
    name: 'Marketing Director',
    description: 'Creates marketing strategies, manages campaigns, and analyzes marketing performance.',
    systemPrompt: `You are the Marketing Director. Develop strategies, manage calendar, analyze metrics, monitor brand, create campaigns, track ROI, identify segments. Focus on leads, awareness, ROI. Data-driven.`,
    capabilities: [
      { module: 'marketing', actions: ['create_campaign', 'read_campaigns', 'create_content'] },
      { module: 'crm', actions: ['read_contacts', 'segment_contacts'] },
      { module: 'research', actions: ['market_research', 'trend_analysis'] },
      { module: 'documents', actions: ['create_content', 'read_templates'] },
    ],
    permissions: [
      { resource: 'contacts', actions: ['read'] },
      { resource: 'campaigns', actions: ['create', 'read', 'update'] },
      { resource: 'documents', actions: ['create', 'read'] },
    ],
    memoryEnabled: true,
    researchEnabled: true,
    voiceEnabled: false,
    computerControlEnabled: false,
    avatar: '📣',
  },
  {
    role: 'financial_analyst',
    name: 'Financial Analyst',
    description: 'Monitors financial health, generates reports, and provides financial insights.',
    systemPrompt: `You are the Financial Analyst. Monitor health, generate P&L, track invoices, analyze spending, forecast, monitor cash flow, flag overdue. Present with context and trends.`,
    capabilities: [
      { module: 'finance', actions: ['read_invoices', 'create_invoices', 'read_expenses', 'read_pnl'] },
      { module: 'sales', actions: ['read_deals', 'read_forecast'] },
      { module: 'analytics', actions: ['read_kpis', 'create_reports'] },
    ],
    permissions: [
      { resource: 'invoices', actions: ['create', 'read', 'update'] },
      { resource: 'expenses', actions: ['create', 'read', 'update'] },
      { resource: 'reports', actions: ['create', 'read', 'export'] },
    ],
    memoryEnabled: true,
    researchEnabled: false,
    voiceEnabled: false,
    computerControlEnabled: false,
    schedule: '0 8 * * 1',
    avatar: '📊',
  },
  {
    role: 'hr_manager',
    name: 'HR Manager',
    description: 'Manages people operations, time-off requests, and employee engagement.',
    systemPrompt: `You are the HR Manager. Manage directory, time-off, onboarding/offboarding, engagement, headcount, compliance, reviews. Confidential, professional.`,
    capabilities: [
      { module: 'hr', actions: ['read_employees', 'manage_timeoff', 'read_directory'] },
      { module: 'projects', actions: ['read_projects', 'read_tasks'] },
    ],
    permissions: [
      { resource: 'employees', actions: ['create', 'read', 'update'] },
      { resource: 'time_off', actions: ['create', 'read', 'update'] },
    ],
    memoryEnabled: true,
    researchEnabled: false,
    voiceEnabled: false,
    computerControlEnabled: false,
    avatar: '👥',
  },
  {
    role: 'project_manager',
    name: 'Project Manager',
    description: 'Manages projects, tracks tasks, and ensures timely delivery.',
    systemPrompt: `You are the Project Manager. Create/manage projects/tasks, track milestones, identify blockers, facilitate assignment, generate status, manage sprints, ensure communication. Focus on delivery, allocation, risk.`,
    capabilities: [
      { module: 'projects', actions: ['create_projects', 'read_projects', 'create_tasks', 'update_tasks', 'read_milestones'] },
      { module: 'hr', actions: ['read_directory'] },
      { module: 'analytics', actions: ['read_project_stats'] },
    ],
    permissions: [
      { resource: 'projects', actions: ['create', 'read', 'update'] },
      { resource: 'tasks', actions: ['create', 'read', 'update'] },
      { resource: 'milestones', actions: ['create', 'read', 'update'] },
    ],
    memoryEnabled: true,
    researchEnabled: false,
    voiceEnabled: true,
    computerControlEnabled: false,
    avatar: '📋',
  },
  {
    role: 'support_manager',
    name: 'Support Manager',
    description: 'Manages customer support, ticket resolution, and knowledge base.',
    systemPrompt: `You are the Support Manager. Manage tickets, SLA, suggest solutions from KB, monitor satisfaction, identify recurring issues, manage workload, create KB articles. Focus on response time, resolution, satisfaction.`,
    capabilities: [
      { module: 'support', actions: ['create_tickets', 'read_tickets', 'update_tickets', 'read_stats'] },
      { module: 'knowledge', actions: ['search_articles', 'create_articles'] },
      { module: 'crm', actions: ['read_contacts'] },
    ],
    permissions: [
      { resource: 'tickets', actions: ['create', 'read', 'update'] },
      { resource: 'knowledge', actions: ['create', 'read', 'update'] },
      { resource: 'contacts', actions: ['read'] },
    ],
    memoryEnabled: true,
    researchEnabled: false,
    voiceEnabled: true,
    computerControlEnabled: false,
    avatar: '🎧',
  },
  {
    role: 'operations_manager',
    name: 'Operations Manager',
    description: 'Optimizes business operations, workflows, and cross-department coordination.',
    systemPrompt: `You are the Operations Manager. Monitor workflows, track metrics, identify bottlenecks, manage automations, coordinate initiatives, ensure compliance, generate reports. Focus on efficiency, scalability, improvement.`,
    capabilities: [
      { module: 'automation', actions: ['read_automations', 'create_automations', 'manage_runs'] },
      { module: 'analytics', actions: ['read_kpis', 'read_reports'] },
      { module: 'projects', actions: ['read_projects', 'read_tasks'] },
    ],
    permissions: [
      { resource: 'automations', actions: ['create', 'read', 'update'] },
      { resource: 'reports', actions: ['create', 'read'] },
      { resource: 'dashboards', actions: ['read'] },
    ],
    memoryEnabled: true,
    researchEnabled: false,
    voiceEnabled: false,
    computerControlEnabled: false,
    avatar: '⚙️',
  },
  {
    role: 'legal_assistant',
    name: 'Legal Assistant',
    description: 'Assists with contracts, compliance, and legal document review.',
    systemPrompt: `You are the Legal Assistant. Review/draft contracts, track expiration, compliance, regulatory, templates, flag risks. Include disclaimers, not a lawyer.`,
    capabilities: [
      { module: 'documents', actions: ['create_documents', 'read_documents', 'read_templates'] },
      { module: 'crm', actions: ['read_contacts'] },
      { module: 'sales', actions: ['read_deals'] },
    ],
    permissions: [
      { resource: 'documents', actions: ['create', 'read', 'update'] },
      { resource: 'contacts', actions: ['read'] },
    ],
    memoryEnabled: true,
    researchEnabled: true,
    voiceEnabled: false,
    computerControlEnabled: false,
    avatar: '⚖️',
  },
  {
    role: 'research_analyst',
    name: 'Research Analyst',
    description: 'Conducts market research, competitive analysis, and trend monitoring.',
    systemPrompt: `You are the Research Analyst. Conduct market research, competitive analysis, trends, partnerships, reports with citations, market size, regulatory. Cite sources, evidence-based, structured.`,
    capabilities: [
      { module: 'research', actions: ['market_research', 'competitor_analysis', 'trend_monitoring'] },
      { module: 'documents', actions: ['create_reports'] },
      { module: 'contacts', actions: ['read_contacts'] },
    ],
    permissions: [
      { resource: 'research', actions: ['create', 'read'] },
      { resource: 'documents', actions: ['create', 'read'] },
    ],
    memoryEnabled: true,
    researchEnabled: true,
    voiceEnabled: false,
    computerControlEnabled: false,
    schedule: '0 6 * * 1',
    avatar: '🔍',
  },
  {
    role: 'growth_strategist',
    name: 'Growth Strategist',
    description: 'Identifies growth opportunities, optimizes conversion funnels, and drives revenue growth.',
    systemPrompt: `You are the Growth Strategist. Identify growth opportunities, optimize funnels, analyze CAC/LTV, suggest pricing, monitor metrics, cohorts, expansion, experiments. Sustainable, data-driven growth.`,
    capabilities: [
      { module: 'analytics', actions: ['read_kpis', 'read_reports', 'cohort_analysis'] },
      { module: 'sales', actions: ['read_deals', 'read_forecast'] },
      { module: 'marketing', actions: ['read_campaigns'] },
      { module: 'crm', actions: ['read_contacts', 'segment_contacts'] },
      { module: 'research', actions: ['market_research'] },
    ],
    permissions: [
      { resource: 'analytics', actions: ['read'] },
      { resource: 'contacts', actions: ['read'] },
      { resource: 'deals', actions: ['read'] },
    ],
    memoryEnabled: true,
    researchEnabled: true,
    voiceEnabled: false,
    computerControlEnabled: false,
    avatar: '🚀',
  },
];

export class AIWorkersModule {
  private governance?: WorkerGovernanceService;

  constructor(private config: AIWorkersModuleConfig) {
    this.governance = config.governance;
  }

  setGovernance(service: WorkerGovernanceService): void {
    this.governance = service;
  }

  /**
   * Deploy a worker from a definition — creates both biz_workers and governance profile.
   * Ensures narrow authority via WorkerGovernanceService.
   */
  deployWorker(
    workspaceId: string,
    definition: WorkerDefinition,
    opts?: { orgId?: string; deployerMemberId?: string; budgetOverride?: Partial<WorkerAuthorityProfile['budget']> }
  ): AIWorker {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.config.db.prepare(`
      INSERT INTO biz_workers (id, workspace_id, role, name, description, system_prompt, enabled, avatar, capabilities, permissions, memory_enabled, research_enabled, voice_enabled, computer_control_enabled, schedule, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      workspaceId,
      definition.role,
      definition.name,
      definition.description,
      definition.systemPrompt,
      definition.avatar ?? null,
      JSON.stringify(definition.capabilities),
      JSON.stringify(definition.permissions),
      definition.memoryEnabled ? 1 : 0,
      definition.researchEnabled ? 1 : 0,
      definition.voiceEnabled ? 1 : 0,
      definition.computerControlEnabled ? 1 : 0,
      definition.schedule ?? null,
      now,
      now
    );

    // Create governance profile if service available
    if (this.governance) {
      try {
        this.governance.createProfile({
          workerId: id,
          role: definition.role,
          orgId: opts?.orgId ?? 'default-org',
          workspaceIds: [workspaceId],
          deployerMemberId: opts?.deployerMemberId ?? 'system',
          overrides: opts?.budgetOverride ? { budget: opts.budgetOverride as any } : undefined,
        });
      } catch (e) {
        console.warn(`[AIWorkers] Failed to create governance profile for ${id}:`, (e as Error).message);
      }
    }

    return this.getWorker(id)!;
  }

  deployAllDefaults(workspaceId: string, opts?: { orgId?: string; deployerMemberId?: string }): AIWorker[] {
    return WORKER_DEFINITIONS.map(def => this.deployWorker(workspaceId, def, opts));
  }

  getWorker(id: string): AIWorker | null {
    const row = this.config.db.prepare('SELECT * FROM biz_workers WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToWorker(row);
  }

  listWorkers(workspaceId: string): AIWorker[] {
    const rows = this.config.db.prepare('SELECT * FROM biz_workers WHERE workspace_id = ? ORDER BY name').all(workspaceId) as any[];
    return rows.map(r => this.rowToWorker(r));
  }

  /**
   * Governed toggle — disables via governance service to revoke authority and credentials.
   */
  toggleWorker(id: string, enabled: boolean, opts?: { actorId?: string; reason?: string }): void {
    this.config.db.prepare('UPDATE biz_workers SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id);

    if (this.governance) {
      try {
        this.governance.setEnabled(id, enabled, { actorId: opts?.actorId ?? 'system', reason: opts?.reason });
      } catch {}
    }
  }

  /**
   * Inspection — effective authority, budget, risk, outcomes, approvals.
   * Implements worker inspection per spec.
   */
  inspectWorker(workerId: string): WorkerInspection | null {
    if (!this.governance) return null;
    return this.governance.inspect(workerId);
  }

  listInspections(workspaceId: string): WorkerInspection[] {
    if (!this.governance) return [];
    const workers = this.listWorkers(workspaceId);
    return workers.map(w => this.governance!.inspect(w.id)).filter(Boolean) as WorkerInspection[];
  }

  /**
   * Chat with worker — now checks governance: enabled, budget, workflow allowance.
   */
  async chat(workerId: string, memberId: string, message: string): Promise<WorkerMessage> {
    const worker = this.getWorker(workerId);
    if (!worker) throw new Error('Worker not found');

    this.config.rbac.assertAccess(memberId, 'workers', 'read');

    // Governance checks
    if (this.governance) {
      const profile = this.governance.getProfile(workerId);
      if (profile && !profile.status.enabled) {
        throw new Error(`Worker disabled: ${profile.status.disabledReason}`);
      }
      if (profile && profile.budget.usedUsdToday >= profile.budget.maxUsdPerDay) {
        throw new Error(`Worker budget exceeded for today`);
      }
      // Budget tracking
      this.governance.recordUsage(workerId, { usd: 0.01, tokens: message.length });
    }

    const now = new Date().toISOString();
    const context = await this.buildContext(worker);

    const userMessage: WorkerMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: now,
    };

    await this.config.bus.emit('worker.chat', {
      workspaceId: worker.workspaceId,
      source: 'ai-workers',
      payload: {
        workerId,
        memberId,
        message,
        systemPrompt: worker.systemPrompt,
        context,
        capabilities: worker.capabilities,
      },
      actorId: memberId,
    });

    this.config.db.prepare('UPDATE biz_workers SET last_active_at = ? WHERE id = ?').run(now, workerId);

    this.config.audit.log({
      orgId: '',
      workspaceId: worker.workspaceId,
      actorId: memberId,
      actorType: 'member',
      action: 'chat',
      resource: 'workers',
      resourceId: workerId,
      metadata: { messageLength: message.length },
    });

    return userMessage;
  }

  private async buildContext(worker: AIWorker): Promise<WorkerContext> {
    const context: WorkerContext = {};

    // Apply context scope from governance if available
    let maxItems = 10;
    let sensitivityMax = 'internal';
    if (this.governance) {
      const profile = this.governance.getProfile(worker.id);
      if (profile) {
        maxItems = profile.contextScope.maxItems;
        sensitivityMax = profile.contextScope.sensitivityMax;
      }
    }

    for (const cap of worker.capabilities) {
      switch (cap.module) {
        case 'crm':
          if (cap.actions.includes('read_contacts')) {
            try {
              const rows = this.config.db.prepare(
                'SELECT * FROM biz_contacts WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?'
              ).all(worker.workspaceId, Math.min(maxItems, 10)) as any[];
              context.recentContacts = rows.map(r => ({
                id: r.id, workspaceId: r.workspace_id, type: r.type, status: r.status,
                name: r.name, email: r.email, company: r.company, tags: JSON.parse(r.tags),
                customFields: {}, createdAt: r.created_at, updatedAt: r.updated_at,
              }));
            } catch {}
          }
          break;
        case 'sales':
          if (cap.actions.includes('read_deals')) {
            try {
              const rows = this.config.db.prepare(
                "SELECT * FROM biz_deals WHERE workspace_id = ? AND stage_id NOT IN ('closed_won', 'closed_lost') ORDER BY value DESC LIMIT ?"
              ).all(worker.workspaceId, Math.min(maxItems, 10)) as any[];
              context.recentDeals = rows.map(r => ({
                id: r.id, workspaceId: r.workspace_id, pipelineId: r.pipeline_id,
                stageId: r.stage_id, title: r.title, value: r.value, currency: r.currency,
                probability: r.probability, tags: JSON.parse(r.tags), customFields: {},
                createdAt: r.created_at, updatedAt: r.updated_at,
              }));
            } catch {}
          }
          break;
        case 'support':
          if (cap.actions.includes('read_tickets')) {
            try {
              const rows = this.config.db.prepare(
                "SELECT * FROM biz_tickets WHERE workspace_id = ? AND status IN ('new', 'open') ORDER BY priority DESC LIMIT ?"
              ).all(worker.workspaceId, Math.min(maxItems, 10)) as any[];
              context.recentTickets = rows.map(r => ({
                id: r.id, workspaceId: r.workspace_id, number: r.number,
                subject: r.subject, description: r.description, status: r.status,
                priority: r.priority, tags: JSON.parse(r.tags), channel: r.channel,
                createdAt: r.created_at, updatedAt: r.updated_at,
              }));
            } catch {}
          }
          break;
      }
    }

    try {
      const deals = this.config.db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(value), 0) as v FROM biz_deals WHERE workspace_id = ? AND stage_id = 'closed_won'").get(worker.workspaceId) as any;
      const tickets = this.config.db.prepare("SELECT COUNT(*) as c FROM biz_tickets WHERE workspace_id = ? AND status IN ('new', 'open')").get(worker.workspaceId) as any;
      context.kpis = {
        totalRevenue: deals?.v ?? 0,
        openDeals: deals?.c ?? 0,
        openTickets: tickets?.c ?? 0,
      };
    } catch {}

    return context;
  }

  static getDefinition(role: WorkerRole): WorkerDefinition | undefined {
    return WORKER_DEFINITIONS.find(d => d.role === role);
  }

  private rowToWorker(row: any): AIWorker {
    return {
      id: row.id, workspaceId: row.workspace_id, role: row.role,
      name: row.name, description: row.description, systemPrompt: row.system_prompt,
      enabled: row.enabled === 1, avatar: row.avatar,
      capabilities: JSON.parse(row.capabilities), permissions: JSON.parse(row.permissions),
      model: row.model, memoryEnabled: row.memory_enabled === 1,
      researchEnabled: row.research_enabled === 1, voiceEnabled: row.voice_enabled === 1,
      computerControlEnabled: row.computer_control_enabled === 1,
      schedule: row.schedule, lastActiveAt: row.last_active_at,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  isHealthy(): boolean { return true; }
}
