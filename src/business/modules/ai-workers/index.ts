/**
 * XR Business OS — AI Workers Module
 * 
 * Specialized AI business roles that integrate with all XR engines.
 * Each Worker is an XR Agent with Memory, Research, Skills, Voice, and Computer Control.
 * 
 * Integrates with:
 * - Multi-Agent Runtime: Workers are XR Agents
 * - Provider Engine: LLM calls for reasoning
 * - Memory Engine: Persistent context and learning
 * - Research Engine: Market research, competitor analysis
 * - Voice Stack: Voice-enabled workers
 * - Computer Control: Screen interaction for report generation
 * - Plugin Platform: External service access
 * - MCP Platform: CRM/ERP integration
 * - Skill Runtime: Execute business skills
 * - XR Shield: All actions audited and policy-checked
 */

import type { BusinessDatabase } from '../../core/database.js';
import type { BusinessEventBus } from '../../core/bus.js';
import type { AuditTrail } from '../../core/audit.js';
import type { RBACManager } from '../../core/rbac.js';
import type { AIWorker, WorkerRole, WorkerConversation, WorkerMessage, WorkerContext, WorkerCapability, Permission } from '../../core/types.js';

export interface AIWorkersModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
  audit: AuditTrail;
  rbac: RBACManager;
}

// ─── WORKER DEFINITIONS ───

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

export const WORKER_DEFINITIONS: WorkerDefinition[] = [
  {
    role: 'ceo_advisor',
    name: 'CEO Advisor',
    description: 'Strategic advisor providing executive-level insights, business health monitoring, and decision support.',
    systemPrompt: `You are the CEO Advisor for this organization. Your role is to:
- Monitor overall business health across all departments
- Provide strategic insights and recommendations
- Identify risks and opportunities
- Prepare executive summaries and board reports
- Analyze market trends and competitive landscape
- Support high-level decision making with data-driven analysis

You have access to all business data: CRM, Sales, Support, Projects, Finance, HR, and Analytics.
Always provide actionable insights, not just data summaries.
When asked about business performance, cross-reference multiple data sources.
Flag anomalies and trends that need executive attention.`,
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
    schedule: '0 9 * * 1-5', // 9 AM weekdays
    avatar: '👔',
  },
  {
    role: 'sales_director',
    name: 'Sales Director',
    description: 'Manages sales pipeline, tracks deals, generates forecasts, and coaches the sales process.',
    systemPrompt: `You are the Sales Director. Your role is to:
- Manage and optimize the sales pipeline
- Track deal progress and identify bottlenecks
- Generate accurate sales forecasts
- Coach on sales strategies and objection handling
- Analyze win/loss patterns
- Suggest follow-up actions for deals
- Monitor sales team performance

Focus on pipeline velocity, conversion rates, and revenue forecasting.
When reviewing deals, consider: deal age, stage duration, contact engagement, and value.
Always provide specific, actionable recommendations.`,
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
    systemPrompt: `You are the Marketing Director. Your role is to:
- Develop marketing strategies and campaigns
- Manage content calendar and publishing schedule
- Analyze marketing metrics (leads, conversion, engagement)
- Monitor brand presence and market positioning
- Create email campaigns and landing page copy
- Track campaign ROI
- Identify target audience segments

Focus on lead generation, brand awareness, and marketing ROI.
Use data to justify marketing spend and strategy decisions.
Suggest A/B tests and optimization opportunities.`,
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
    systemPrompt: `You are the Financial Analyst. Your role is to:
- Monitor financial health (revenue, expenses, profit margins)
- Generate P&L statements and financial reports
- Track invoices, payments, and accounts receivable
- Analyze spending patterns and cost optimization opportunities
- Create financial forecasts and budgets
- Monitor cash flow
- Flag overdue payments and financial risks

Always present financial data with context and trends.
Compare current performance to previous periods.
Highlight anomalies and suggest corrective actions.
All monetary figures should include currency and be clearly formatted.`,
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
    schedule: '0 8 * * 1', // Monday 8 AM
    avatar: '📊',
  },
  {
    role: 'hr_manager',
    name: 'HR Manager',
    description: 'Manages people operations, time-off requests, and employee engagement.',
    systemPrompt: `You are the HR Manager. Your role is to:
- Manage the people directory and employee records
- Handle time-off requests and leave management
- Support onboarding and offboarding processes
- Monitor team engagement and satisfaction
- Track department headcount and hiring needs
- Ensure compliance with HR policies
- Facilitate performance reviews

Always maintain confidentiality and professionalism.
When handling sensitive HR matters, follow established policies.
Suggest improvements to team culture and engagement.`,
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
    systemPrompt: `You are the Project Manager. Your role is to:
- Create and manage projects and tasks
- Track progress against milestones and deadlines
- Identify blockers and resource constraints
- Facilitate task assignment and prioritization
- Generate project status reports
- Manage sprint planning and retrospectives
- Ensure clear communication across teams

Focus on delivery timelines, resource allocation, and risk management.
When tasks are overdue, suggest root causes and solutions.
Always provide clear status summaries with action items.`,
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
    systemPrompt: `You are the Support Manager. Your role is to:
- Manage support tickets and customer issues
- Track SLA compliance and response times
- Suggest solutions based on knowledge base articles
- Monitor customer satisfaction scores
- Identify recurring issues and suggest permanent solutions
- Manage support team workload distribution
- Create and update knowledge base articles

Focus on first response time, resolution time, and customer satisfaction.
When handling escalations, prioritize based on customer value and issue severity.
Suggest knowledge base articles for common issues.
Track patterns in support tickets to identify product improvements.`,
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
    systemPrompt: `You are the Operations Manager. Your role is to:
- Monitor and optimize business workflows
- Track operational metrics across all departments
- Identify process bottlenecks and inefficiencies
- Manage automation workflows
- Coordinate cross-department initiatives
- Ensure operational compliance and standards
- Generate operational reports

Focus on efficiency, scalability, and process improvement.
Use data to identify where automation can save time.
Track inter-department dependencies and communication gaps.`,
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
    systemPrompt: `You are the Legal Assistant. Your role is to:
- Review and draft contracts and legal documents
- Track contract expiration dates and renewal terms
- Monitor compliance requirements
- Assist with regulatory questions
- Manage document templates for legal agreements
- Flag potential legal risks in business operations

Always include appropriate disclaimers. You are an AI assistant, not a lawyer.
For complex legal matters, recommend consulting with qualified legal counsel.
Focus on risk identification and mitigation.`,
    capabilities: [
      { module: 'documents', actions: ['create_documents', 'read_documents', 'read_templates'] },
      { module: 'contacts', actions: ['read_contacts'] },
      { module: 'deals', actions: ['read_deals'] },
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
    systemPrompt: `You are the Research Analyst. Your role is to:
- Conduct market research and competitive analysis
- Monitor industry trends and emerging technologies
- Analyze competitor strategies and positioning
- Research potential partnerships and market opportunities
- Generate research reports with citations
- Track market size and growth projections
- Monitor regulatory changes affecting the business

Always cite your sources and provide evidence-based analysis.
Distinguish between facts, analysis, and speculation.
Present findings in structured, actionable formats.`,
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
    schedule: '0 6 * * 1', // Monday 6 AM
    avatar: '🔍',
  },
  {
    role: 'growth_strategist',
    name: 'Growth Strategist',
    description: 'Identifies growth opportunities, optimizes conversion funnels, and drives revenue growth.',
    systemPrompt: `You are the Growth Strategist. Your role is to:
- Identify growth opportunities across the business
- Optimize conversion funnels (lead → customer)
- Analyze customer acquisition costs and lifetime value
- Suggest pricing strategies and product positioning
- Monitor growth metrics and cohort analysis
- Identify expansion opportunities (new markets, upselling)
- Run growth experiments and measure results

Focus on sustainable, data-driven growth.
Analyze the full customer journey from first touch to retention.
Suggest experiments with clear hypotheses and success metrics.
Track CAC, LTV, churn rate, and expansion revenue.`,
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

// ─── AI WORKERS MODULE ───

export class AIWorkersModule {
  constructor(private config: AIWorkersModuleConfig) {}

  /**
   * Deploy a worker from a definition.
   */
  deployWorker(workspaceId: string, definition: WorkerDefinition): AIWorker {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.config.db.prepare(`
      INSERT INTO biz_workers (id, workspace_id, role, name, description, system_prompt, enabled, avatar, capabilities, permissions, memory_enabled, research_enabled, voice_enabled, computer_control_enabled, schedule, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, definition.role, definition.name, definition.description,
      definition.systemPrompt, definition.avatar ?? null,
      JSON.stringify(definition.capabilities), JSON.stringify(definition.permissions),
      definition.memoryEnabled ? 1 : 0, definition.researchEnabled ? 1 : 0,
      definition.voiceEnabled ? 1 : 0, definition.computerControlEnabled ? 1 : 0,
      definition.schedule ?? null, now, now);

    return this.getWorker(id)!;
  }

  /**
   * Deploy all default workers.
   */
  deployAllDefaults(workspaceId: string): AIWorker[] {
    return WORKER_DEFINITIONS.map(def => this.deployWorker(workspaceId, def));
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

  toggleWorker(id: string, enabled: boolean): void {
    this.config.db.prepare('UPDATE biz_workers SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id);
  }

  /**
   * Send a message to a worker and get a response.
   */
  async chat(workerId: string, memberId: string, message: string): Promise<WorkerMessage> {
    const worker = this.getWorker(workerId);
    if (!worker) throw new Error('Worker not found');

    // Verify member has access
    this.config.rbac.assertAccess(memberId, 'workers', 'read');

    const now = new Date().toISOString();

    // Build context from business data
    const context = await this.buildContext(worker);

    // Create user message
    const userMessage: WorkerMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: now,
    };

    // Emit to event bus for the agent runtime to handle
    await this.config.bus.emit('worker.chat', {
      workspaceId: worker.workspaceId,
      source: 'ai-workers',
      payload: {
        workerId, memberId, message,
        systemPrompt: worker.systemPrompt,
        context,
        capabilities: worker.capabilities,
      },
      actorId: memberId,
    });

    // Update last active
    this.config.db.prepare('UPDATE biz_workers SET last_active_at = ? WHERE id = ?').run(now, workerId);

    // Log audit
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

  /**
   * Build context for a worker based on its role and capabilities.
   */
  private async buildContext(worker: AIWorker): Promise<WorkerContext> {
    const context: WorkerContext = {};

    // Populate context based on capabilities
    for (const cap of worker.capabilities) {
      switch (cap.module) {
        case 'crm':
          if (cap.actions.includes('read_contacts')) {
            const rows = this.config.db.prepare(
              'SELECT * FROM biz_contacts WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 10'
            ).all(worker.workspaceId) as any[];
            context.recentContacts = rows.map(r => ({
              id: r.id, workspaceId: r.workspace_id, type: r.type, status: r.status,
              name: r.name, email: r.email, company: r.company, tags: JSON.parse(r.tags),
              customFields: {}, createdAt: r.created_at, updatedAt: r.updated_at,
            }));
          }
          break;
        case 'sales':
          if (cap.actions.includes('read_deals')) {
            const rows = this.config.db.prepare(
              "SELECT * FROM biz_deals WHERE workspace_id = ? AND stage_id NOT IN ('closed_won', 'closed_lost') ORDER BY value DESC LIMIT 10"
            ).all(worker.workspaceId) as any[];
            context.recentDeals = rows.map(r => ({
              id: r.id, workspaceId: r.workspace_id, pipelineId: r.pipeline_id,
              stageId: r.stage_id, title: r.title, value: r.value, currency: r.currency,
              probability: r.probability, tags: JSON.parse(r.tags), customFields: {},
              createdAt: r.created_at, updatedAt: r.updated_at,
            }));
          }
          break;
        case 'support':
          if (cap.actions.includes('read_tickets')) {
            const rows = this.config.db.prepare(
              "SELECT * FROM biz_tickets WHERE workspace_id = ? AND status IN ('new', 'open') ORDER BY priority DESC LIMIT 10"
            ).all(worker.workspaceId) as any[];
            context.recentTickets = rows.map(r => ({
              id: r.id, workspaceId: r.workspace_id, number: r.number,
              subject: r.subject, description: r.description, status: r.status,
              priority: r.priority, tags: JSON.parse(r.tags), channel: r.channel,
              createdAt: r.created_at, updatedAt: r.updated_at,
            }));
          }
          break;
      }
    }

    // Add KPIs
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

  /**
   * Get a worker definition by role.
   */
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
