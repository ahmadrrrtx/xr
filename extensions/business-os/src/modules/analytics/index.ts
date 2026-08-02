/**
 * XR Business OS — Analytics Module
 * 
 * Dashboards, reports, KPIs, and business intelligence.
 * 
 * Integrates with:
 * - All modules: Aggregates data from CRM, Sales, Support, Finance, etc.
 * - AI Workers: Generate insights and recommendations
 * - Automation: Scheduled report generation
 * - Research Engine: Market benchmarking
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { BusinessEventBus } from '../../core/bus.ts';
import type { Dashboard, DashboardWidget, Report, ReportConfig } from '../../core/types.ts';

export interface AnalyticsModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
}

export class AnalyticsModule {
  constructor(private config: AnalyticsModuleConfig) {}

  // ─── DASHBOARDS ───

  createDashboard(workspaceId: string, params: {
    name: string; widgets?: DashboardWidget[]; visibility?: Dashboard['visibility']; ownerId: string;
  }): Dashboard {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const dashboard: Dashboard = {
      id, workspaceId, name: params.name,
      widgets: params.widgets ?? [],
      layout: { columns: 12, rowHeight: 80, gap: 16 },
      visibility: params.visibility ?? 'private',
      ownerId: params.ownerId, createdAt: now, updatedAt: now,
    };

    this.config.db.prepare(`
      INSERT INTO biz_dashboards (id, workspace_id, name, widgets, layout, visibility, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, params.name, JSON.stringify(dashboard.widgets),
      JSON.stringify(dashboard.layout), dashboard.visibility, params.ownerId, now, now);

    return dashboard;
  }

  getDashboard(id: string): Dashboard | null {
    const row = this.config.db.prepare('SELECT * FROM biz_dashboards WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToDashboard(row);
  }

  listDashboards(workspaceId: string): Dashboard[] {
    const rows = this.config.db.prepare('SELECT * FROM biz_dashboards WHERE workspace_id = ? ORDER BY name').all(workspaceId) as any[];
    return rows.map(r => this.rowToDashboard(r));
  }

  // ─── REPORTS ───

  createReport(workspaceId: string, params: {
    name: string; type: Report['type']; config: ReportConfig; schedule?: string; format?: Report['format'];
  }): Report {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const report: Report = {
      id, workspaceId, name: params.name, type: params.type, config: params.config,
      schedule: params.schedule, format: params.format ?? 'pdf', createdAt: now,
    };

    this.config.db.prepare(`
      INSERT INTO biz_reports (id, workspace_id, name, type, config, schedule, format, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, params.name, params.type, JSON.stringify(params.config),
      params.schedule ?? null, params.format ?? 'pdf', now);

    return report;
  }

  listReports(workspaceId: string): Report[] {
    const rows = this.config.db.prepare('SELECT * FROM biz_reports WHERE workspace_id = ? ORDER BY name').all(workspaceId) as any[];
    return rows.map(r => ({
      id: r.id, workspaceId: r.workspace_id, name: r.name, type: r.type,
      config: JSON.parse(r.config), schedule: r.schedule,
      lastGeneratedAt: r.last_generated_at, format: r.format, createdAt: r.created_at,
    }));
  }

  // ─── KPIs ───

  /**
   * Get business KPIs across all modules.
   */
  getKPIs(workspaceId: string): {
    sales: { revenue: number; pipeline: number; winRate: number; deals: number };
    support: { openTickets: number; avgResponseMinutes: number; satisfaction: number };
    projects: { active: number; tasksCompleted: number; overdue: number };
    contacts: { total: number; newThisWeek: number; conversionRate: number };
    finance: { outstanding: number; overdue: number; revenue: number };
  } {
    // Sales KPIs
    const totalDeals = (this.config.db.prepare("SELECT COUNT(*) as c FROM biz_deals WHERE workspace_id = ? AND stage_id NOT IN ('closed_won', 'closed_lost')").get(workspaceId) as any)?.c ?? 0;
    const pipelineValue = (this.config.db.prepare("SELECT COALESCE(SUM(value * probability / 100), 0) as v FROM biz_deals WHERE workspace_id = ? AND stage_id NOT IN ('closed_won', 'closed_lost')").get(workspaceId) as any)?.v ?? 0;
    const wonDeals = (this.config.db.prepare("SELECT COUNT(*) as c FROM biz_deals WHERE workspace_id = ? AND stage_id = 'closed_won'").get(workspaceId) as any)?.c ?? 0;
    const lostDeals = (this.config.db.prepare("SELECT COUNT(*) as c FROM biz_deals WHERE workspace_id = ? AND stage_id = 'closed_lost'").get(workspaceId) as any)?.c ?? 0;
    const revenue = (this.config.db.prepare("SELECT COALESCE(SUM(value), 0) as v FROM biz_deals WHERE workspace_id = ? AND stage_id = 'closed_won'").get(workspaceId) as any)?.v ?? 0;
    const winRate = (wonDeals + lostDeals) > 0 ? (wonDeals / (wonDeals + lostDeals)) * 100 : 0;

    // Support KPIs
    const openTickets = (this.config.db.prepare("SELECT COUNT(*) as c FROM biz_tickets WHERE workspace_id = ? AND status IN ('new', 'open')").get(workspaceId) as any)?.c ?? 0;

    // Project KPIs
    const activeProjects = (this.config.db.prepare("SELECT COUNT(*) as c FROM biz_projects WHERE workspace_id = ? AND status = 'active'").get(workspaceId) as any)?.c ?? 0;
    const tasksCompleted = (this.config.db.prepare("SELECT COUNT(*) as c FROM biz_tasks WHERE workspace_id = ? AND status = 'done'").get(workspaceId) as any)?.c ?? 0;
    const now = new Date().toISOString();
    const overdueTasks = (this.config.db.prepare("SELECT COUNT(*) as c FROM biz_tasks WHERE workspace_id = ? AND due_date < ? AND status NOT IN ('done', 'cancelled')").get(workspaceId, now) as any)?.c ?? 0;

    // Contact KPIs
    const totalContacts = (this.config.db.prepare('SELECT COUNT(*) as c FROM biz_contacts WHERE workspace_id = ?').get(workspaceId) as any)?.c ?? 0;
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const newContacts = (this.config.db.prepare('SELECT COUNT(*) as c FROM biz_contacts WHERE workspace_id = ? AND created_at > ?').get(workspaceId, weekAgo) as any)?.c ?? 0;

    // Finance KPIs
    const outstanding = (this.config.db.prepare("SELECT COALESCE(SUM(total), 0) as v FROM biz_invoices WHERE workspace_id = ? AND status IN ('sent', 'overdue')").get(workspaceId) as any)?.v ?? 0;
    const overdueInvoices = (this.config.db.prepare("SELECT COALESCE(SUM(total), 0) as v FROM biz_invoices WHERE workspace_id = ? AND status = 'overdue'").get(workspaceId) as any)?.v ?? 0;

    return {
      sales: { revenue, pipeline: pipelineValue, winRate, deals: totalDeals },
      support: { openTickets, avgResponseMinutes: 0, satisfaction: 0 },
      projects: { active: activeProjects, tasksCompleted, overdue: overdueTasks },
      contacts: { total: totalContacts, newThisWeek: newContacts, conversionRate: 0 },
      finance: { outstanding, overdue: overdueInvoices, revenue },
    };
  }

  private rowToDashboard(row: any): Dashboard {
    return {
      id: row.id, workspaceId: row.workspace_id, name: row.name,
      widgets: JSON.parse(row.widgets), layout: JSON.parse(row.layout),
      visibility: row.visibility, ownerId: row.owner_id,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  isHealthy(): boolean { return true; }
}
