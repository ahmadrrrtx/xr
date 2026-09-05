/**
 * XR Business OS — Sales Module
 * 
 * Pipeline management, deal tracking, forecasting, and proposal generation.
 * Built on top of core/pipeline.ts.
 * 
 * Integrates with:
 * - CRM Module: Contacts and companies feed into deals
 * - AI Workers: Sales Director provides insights
 * - Automation: Follow-up workflows, proposal generation
 * - Documents: Proposal and contract templates
 * - Finance: Invoice generation from closed deals
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { PipelineManager } from '../../core/pipeline.ts';
import type { ContactManager } from '../../core/contacts.ts';
import type { BusinessEventBus } from '../../core/bus.ts';
import type { AuditTrail } from '../../core/audit.ts';
import type { Deal, Pipeline, PipelineStage, PaginatedResult, PaginationParams } from '../../core/types.ts';

export interface SalesModuleConfig {
  db: BusinessDatabase;
  pipelines: PipelineManager;
  contacts: ContactManager;
  bus: BusinessEventBus;
  audit: AuditTrail;
}

export class SalesModule {
  constructor(private config: SalesModuleConfig) {}

  // ─── PIPELINES ───

  /**
   * Get or create default sales pipeline.
   */
  getPipeline(workspaceId: string): Pipeline {
    return this.config.pipelines.getOrCreateDefault(workspaceId);
  }

  /**
   * List all pipelines.
   */
  listPipelines(workspaceId: string): Pipeline[] {
    return this.config.pipelines.list(workspaceId);
  }

  /**
   * Create a custom pipeline.
   */
  createPipeline(workspaceId: string, name: string, stages?: PipelineStage[]): Pipeline {
    return this.config.pipelines.create(workspaceId, { name, stages });
  }

  // ─── DEALS ───

  /**
   * Create a deal.
   */
  async createDeal(workspaceId: string, actorId: string, params: Parameters<PipelineManager['createDeal']>[1]): Promise<Deal> {
    const deal = this.config.pipelines.createDeal(workspaceId, params);

    await this.config.bus.emit('deal.created', {
      workspaceId,
      source: 'sales',
      payload: { dealId: deal.id, title: deal.title, value: deal.value, stageId: deal.stageId },
      actorId,
    });

    this.config.audit.log({
      orgId: '',
      workspaceId,
      actorId,
      actorType: 'member',
      action: 'create',
      resource: 'deals',
      resourceId: deal.id,
      changes: { deal: { before: null, after: deal } },
    });

    return deal;
  }

  /**
   * Update a deal.
   */
  async updateDeal(id: string, actorId: string, updates: Parameters<PipelineManager['updateDeal']>[1]): Promise<Deal | null> {
    const before = this.config.pipelines.getDealById(id);
    const deal = this.config.pipelines.updateDeal(id, updates);

    if (deal) {
      await this.config.bus.emit('deal.updated', {
        workspaceId: deal.workspaceId,
        source: 'sales',
        payload: { dealId: id, changes: updates },
        actorId,
      });
    }

    return deal;
  }

  /**
   * Move a deal to a new stage.
   */
  async moveDeal(dealId: string, stageId: string, actorId: string): Promise<Deal | null> {
    const before = this.config.pipelines.getDealById(dealId);
    const deal = this.config.pipelines.moveDeal(dealId, stageId);

    if (deal) {
      await this.config.bus.emit('deal.moved', {
        workspaceId: deal.workspaceId,
        source: 'sales',
        payload: { dealId, fromStage: before?.stageId, toStage: stageId, title: deal.title },
        actorId,
      });

      // Emit won/lost events
      if (stageId === 'closed_won') {
        await this.config.bus.emit('deal.won', {
          workspaceId: deal.workspaceId,
          source: 'sales',
          payload: { dealId, title: deal.title, value: deal.value },
          actorId,
        });
      } else if (stageId === 'closed_lost') {
        await this.config.bus.emit('deal.lost', {
          workspaceId: deal.workspaceId,
          source: 'sales',
          payload: { dealId, title: deal.title, value: deal.value, reason: deal.lostReason },
          actorId,
        });
      }
    }

    return deal;
  }

  /**
   * List deals with filters.
   */
  listDeals(workspaceId: string, params?: Parameters<PipelineManager['listDeals']>[1]): PaginatedResult<Deal> {
    return this.config.pipelines.listDeals(workspaceId, params);
  }

  /**
   * Get a deal by ID.
   */
  getDeal(id: string): Deal | null {
    return this.config.pipelines.getDealById(id);
  }

  // ─── FORECASTING ───

  /**
   * Get sales forecast based on weighted pipeline.
   */
  getForecast(workspaceId: string, pipelineId?: string): {
    weightedForecast: number;
    unweightedForecast: number;
    byStage: Record<string, { count: number; weighted: number; unweighted: number }>;
    monthlyTrend: { month: string; won: number; lost: number; pipeline: number }[];
  } {
    const stats = this.config.pipelines.getStats(workspaceId, pipelineId);
    const pipeline = pipelineId ? this.config.pipelines.getById(pipelineId) : this.getPipeline(workspaceId);

    const byStage: Record<string, { count: number; weighted: number; unweighted: number }> = {};
    let weightedForecast = 0;
    let unweightedForecast = 0;

    if (pipeline) {
      for (const stage of pipeline.stages) {
        const stageData = stats.byStage[stage.id];
        if (stageData) {
          const weighted = stageData.value * (stage.probability / 100);
          byStage[stage.name] = { count: stageData.count, weighted, unweighted: stageData.value };
          weightedForecast += weighted;
          unweightedForecast += stageData.value;
        }
      }
    }

    return {
      weightedForecast,
      unweightedForecast,
      byStage,
      monthlyTrend: [], // TODO: implement with date aggregation
    };
  }

  /**
   * Get sales statistics.
   */
  getStats(workspaceId: string, pipelineId?: string) {
    return this.config.pipelines.getStats(workspaceId, pipelineId);
  }

  isHealthy(): boolean {
    try {
      this.config.db.prepare('SELECT 1 FROM biz_deals LIMIT 1').get();
      return true;
    } catch {
      return false;
    }
  }
}
