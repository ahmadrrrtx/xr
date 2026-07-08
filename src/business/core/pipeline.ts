/**
 * XR Business OS — Sales Pipeline Engine
 * 
 * Manages pipelines, stages, and deals.
 * Integrates with XR Automation for workflow triggers.
 */

import { BusinessDatabase } from './database.js';
import type { Pipeline, PipelineStage, Deal, DealStage, PaginatedResult, PaginationParams } from './types.js';

const DEFAULT_STAGES: PipelineStage[] = [
  { id: 'lead', name: 'Lead', order: 0, probability: 10, color: '#94a3b8' },
  { id: 'qualified', name: 'Qualified', order: 1, probability: 25, color: '#60a5fa' },
  { id: 'proposal', name: 'Proposal', order: 2, probability: 50, color: '#fbbf24' },
  { id: 'negotiation', name: 'Negotiation', order: 3, probability: 75, color: '#f97316' },
  { id: 'closed_won', name: 'Closed Won', order: 4, probability: 100, color: '#22c55e' },
  { id: 'closed_lost', name: 'Closed Lost', order: 5, probability: 0, color: '#ef4444' },
];

export class PipelineManager {
  constructor(private db: BusinessDatabase) {}

  /**
   * Create a pipeline.
   */
  create(workspaceId: string, params: {
    name: string;
    stages?: PipelineStage[];
    isDefault?: boolean;
  }): Pipeline {
    const id = BusinessDatabase.generateId();
    const now = BusinessDatabase.now();
    const stages = params.stages ?? DEFAULT_STAGES.map((s, i) => ({ ...s, id: BusinessDatabase.generateId() }));

    // If this is default, unset other defaults
    if (params.isDefault) {
      this.db.prepare(
        'UPDATE biz_pipelines SET is_default = 0 WHERE workspace_id = ?'
      ).run(workspaceId);
    }

    this.db.prepare(`
      INSERT INTO biz_pipelines (id, workspace_id, name, stages, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, params.name, JSON.stringify(stages),
      params.isDefault ? 1 : 0, now, now);

    return this.getById(id)!;
  }

  /**
   * Get pipeline by ID.
   */
  getById(id: string): Pipeline | null {
    const row = this.db.prepare('SELECT * FROM biz_pipelines WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToPipeline(row);
  }

  /**
   * List pipelines for a workspace.
   */
  list(workspaceId: string): Pipeline[] {
    const rows = this.db.prepare(
      'SELECT * FROM biz_pipelines WHERE workspace_id = ? ORDER BY is_default DESC, name'
    ).all(workspaceId) as any[];
    return rows.map(r => this.rowToPipeline(r));
  }

  /**
   * Get or create default pipeline.
   */
  getOrCreateDefault(workspaceId: string): Pipeline {
    const existing = this.db.prepare(
      "SELECT * FROM biz_pipelines WHERE workspace_id = ? AND is_default = 1"
    ).get(workspaceId) as any;

    if (existing) return this.rowToPipeline(existing);
    return this.create(workspaceId, { name: 'Sales Pipeline', isDefault: true });
  }

  /**
   * Update pipeline.
   */
  update(id: string, updates: Partial<Pick<Pipeline, 'name' | 'stages' | 'isDefault'>>): Pipeline | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.stages !== undefined) { fields.push('stages = ?'); values.push(JSON.stringify(updates.stages)); }
    if (updates.isDefault !== undefined) { fields.push('is_default = ?'); values.push(updates.isDefault ? 1 : 0); }

    if (fields.length === 0) return this.getById(id);

    fields.push('updated_at = ?');
    values.push(BusinessDatabase.now());
    values.push(id);

    this.db.prepare(`UPDATE biz_pipelines SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  /**
   * Delete pipeline (only if no deals reference it).
   */
  delete(id: string): boolean {
    const dealCount = (this.db.prepare(
      'SELECT COUNT(*) as c FROM biz_deals WHERE pipeline_id = ?'
    ).get(id) as any)?.c ?? 0;

    if (dealCount > 0) {
      throw new Error(`Cannot delete pipeline with ${dealCount} deals. Move or delete deals first.`);
    }

    const result = this.db.prepare('DELETE FROM biz_pipelines WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ─── DEALS ───

  /**
   * Create a deal.
   */
  createDeal(workspaceId: string, params: {
    pipelineId: string;
    stageId?: string;
    title: string;
    value?: number;
    currency?: string;
    contactId?: string;
    companyId?: string;
    ownerId?: string;
    probability?: number;
    expectedCloseDate?: string;
    tags?: string[];
    customFields?: Record<string, unknown>;
  }): Deal {
    const id = BusinessDatabase.generateId();
    const now = BusinessDatabase.now();
    const pipeline = this.getById(params.pipelineId);
    if (!pipeline) throw new Error('Pipeline not found');

    const stageId = params.stageId ?? pipeline.stages[0]?.id;
    const stage = pipeline.stages.find(s => s.id === stageId);
    const probability = params.probability ?? stage?.probability ?? 0;

    this.db.prepare(`
      INSERT INTO biz_deals (id, workspace_id, pipeline_id, stage_id, title, value, currency, contact_id, company_id, owner_id, probability, expected_close_date, tags, custom_fields, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, workspaceId, params.pipelineId, stageId, params.title,
      params.value ?? 0, params.currency ?? 'USD',
      params.contactId ?? null, params.companyId ?? null,
      params.ownerId ?? null, probability,
      params.expectedCloseDate ?? null,
      JSON.stringify(params.tags ?? []),
      JSON.stringify(params.customFields ?? {}), now, now
    );

    return this.getDealById(id)!;
  }

  /**
   * Get deal by ID.
   */
  getDealById(id: string): Deal | null {
    const row = this.db.prepare('SELECT * FROM biz_deals WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToDeal(row);
  }

  /**
   * Update deal.
   */
  updateDeal(id: string, updates: Partial<Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>>): Deal | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.stageId !== undefined) { fields.push('stage_id = ?'); values.push(updates.stageId); }
    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.value !== undefined) { fields.push('value = ?'); values.push(updates.value); }
    if (updates.contactId !== undefined) { fields.push('contact_id = ?'); values.push(updates.contactId); }
    if (updates.ownerId !== undefined) { fields.push('owner_id = ?'); values.push(updates.ownerId); }
    if (updates.probability !== undefined) { fields.push('probability = ?'); values.push(updates.probability); }
    if (updates.expectedCloseDate !== undefined) { fields.push('expected_close_date = ?'); values.push(updates.expectedCloseDate); }
    if (updates.actualCloseDate !== undefined) { fields.push('actual_close_date = ?'); values.push(updates.actualCloseDate); }
    if (updates.lostReason !== undefined) { fields.push('lost_reason = ?'); values.push(updates.lostReason); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
    if (updates.customFields !== undefined) { fields.push('custom_fields = ?'); values.push(JSON.stringify(updates.customFields)); }

    if (fields.length === 0) return this.getDealById(id);

    fields.push('updated_at = ?');
    values.push(BusinessDatabase.now());
    values.push(id);

    this.db.prepare(`UPDATE biz_deals SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getDealById(id);
  }

  /**
   * Move deal to a different stage.
   */
  moveDeal(dealId: string, stageId: string): Deal | null {
    const deal = this.getDealById(dealId);
    if (!deal) return null;

    const pipeline = this.getById(deal.pipelineId);
    const stage = pipeline?.stages.find(s => s.id === stageId);
    const probability = stage?.probability ?? deal.probability;

    const updates: Partial<Deal> = { stageId, probability };

    // Auto-set close date for closed stages
    if (stageId === 'closed_won' || stageId === 'closed_lost') {
      updates.actualCloseDate = BusinessDatabase.now();
    }

    return this.updateDeal(dealId, updates);
  }

  /**
   * List deals with pagination.
   */
  listDeals(workspaceId: string, params?: PaginationParams & {
    pipelineId?: string;
    stageId?: string;
    ownerId?: string;
    contactId?: string;
    minValue?: number;
    maxValue?: number;
  }): PaginatedResult<Deal> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 25;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE workspace_id = ?';
    const whereValues: unknown[] = [workspaceId];

    if (params?.pipelineId) { whereClause += ' AND pipeline_id = ?'; whereValues.push(params.pipelineId); }
    if (params?.stageId) { whereClause += ' AND stage_id = ?'; whereValues.push(params.stageId); }
    if (params?.ownerId) { whereClause += ' AND owner_id = ?'; whereValues.push(params.ownerId); }
    if (params?.contactId) { whereClause += ' AND contact_id = ?'; whereValues.push(params.contactId); }
    if (params?.minValue !== undefined) { whereClause += ' AND value >= ?'; whereValues.push(params.minValue); }
    if (params?.maxValue !== undefined) { whereClause += ' AND value <= ?'; whereValues.push(params.maxValue); }

    const countRow = this.db.prepare(
      `SELECT COUNT(*) as c FROM biz_deals ${whereClause}`
    ).get(...whereValues) as any;
    const total = countRow?.c ?? 0;

    const sortBy = params?.sortBy ?? 'created_at';
    const sortOrder = params?.sortOrder ?? 'desc';

    const data = this.db.prepare(
      `SELECT * FROM biz_deals ${whereClause} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`
    ).all(...whereValues, limit, offset) as any[];

    return {
      data: data.map(r => this.rowToDeal(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get pipeline statistics.
   */
  getStats(workspaceId: string, pipelineId?: string): {
    totalDeals: number;
    totalValue: number;
    wonDeals: number;
    wonValue: number;
    lostDeals: number;
    lostValue: number;
    byStage: Record<string, { count: number; value: number }>;
    averageDealValue: number;
    winRate: number;
    averageCycleDays: number;
  } {
    let whereClause = 'WHERE workspace_id = ?';
    const whereValues: unknown[] = [workspaceId];
    if (pipelineId) { whereClause += ' AND pipeline_id = ?'; whereValues.push(pipelineId); }

    const totalDeals = (this.db.prepare(`SELECT COUNT(*) as c FROM biz_deals ${whereClause}`).get(...whereValues) as any)?.c ?? 0;
    const totalValue = (this.db.prepare(`SELECT COALESCE(SUM(value), 0) as v FROM biz_deals ${whereClause}`).get(...whereValues) as any)?.v ?? 0;

    const wonDeals = (this.db.prepare(
      `SELECT COUNT(*) as c FROM biz_deals ${whereClause} AND stage_id = 'closed_won'`
    ).get(...whereValues) as any)?.c ?? 0;
    const wonValue = (this.db.prepare(
      `SELECT COALESCE(SUM(value), 0) as v FROM biz_deals ${whereClause} AND stage_id = 'closed_won'`
    ).get(...whereValues) as any)?.v ?? 0;

    const lostDeals = (this.db.prepare(
      `SELECT COUNT(*) as c FROM biz_deals ${whereClause} AND stage_id = 'closed_lost'
    `).get(...whereValues) as any)?.c ?? 0;
    const lostValue = (this.db.prepare(
      `SELECT COALESCE(SUM(value), 0) as v FROM biz_deals ${whereClause} AND stage_id = 'closed_lost'
    `).get(...whereValues) as any)?.v ?? 0;

    const byStage: Record<string, { count: number; value: number }> = {};
    const stageRows = this.db.prepare(
      `SELECT stage_id, COUNT(*) as count, COALESCE(SUM(value), 0) as value FROM biz_deals ${whereClause} GROUP BY stage_id`
    ).all(...whereValues) as any[];
    for (const r of stageRows) {
      byStage[r.stage_id] = { count: r.count, value: r.value };
    }

    const closedDeals = wonDeals + lostDeals;
    const winRate = closedDeals > 0 ? (wonDeals / closedDeals) * 100 : 0;
    const averageDealValue = totalDeals > 0 ? totalValue / totalDeals : 0;

    return { totalDeals, totalValue, wonDeals, wonValue, lostDeals, lostValue, byStage, averageDealValue, winRate, averageCycleDays: 0 };
  }

  private rowToPipeline(row: any): Pipeline {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      stages: JSON.parse(row.stages),
      isDefault: row.is_default === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToDeal(row: any): Deal {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      pipelineId: row.pipeline_id,
      stageId: row.stage_id,
      title: row.title,
      value: row.value,
      currency: row.currency,
      contactId: row.contact_id,
      companyId: row.company_id,
      ownerId: row.owner_id,
      probability: row.probability,
      expectedCloseDate: row.expected_close_date,
      actualCloseDate: row.actual_close_date,
      tags: JSON.parse(row.tags),
      customFields: JSON.parse(row.custom_fields),
      lostReason: row.lost_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
