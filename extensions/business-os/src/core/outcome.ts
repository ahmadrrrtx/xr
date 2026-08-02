/**
 * XR 5.3 — Outcome Tracking — Measurable Business Outcomes
 * Every journey produces a verified outcome with cost/time, artifacts,
 * records changed, evidence, audit, failure/recovery.
 */

import type { BusinessDatabase } from './database.ts';
import type { VerifiedOutcome, OutcomeCategory, OutcomeStatus, OutcomeMetric } from './operating-types.ts';

export interface OutcomeDeps {
  db: BusinessDatabase;
}

export class OutcomeTracker {
  constructor(private deps: OutcomeDeps) {}

  /**
   * Create a pending outcome when workflow run starts.
   */
  createPending(params: {
    journeyId: string;
    journeyCategory: OutcomeCategory;
    workflowRunId: string;
    workspaceId: string;
    orgId: string;
    title: string;
    summary: string;
    costBudget?: { maxUsd: number; maxTokens: number; maxDurationMs: number };
  }): VerifiedOutcome {
    const outcomeId = `out_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const outcome: VerifiedOutcome = {
      outcomeId,
      journeyId: params.journeyId,
      journeyCategory: params.journeyCategory,
      workflowRunId: params.workflowRunId,
      workspaceId: params.workspaceId,
      orgId: params.orgId,
      status: 'pending',
      title: params.title,
      summary: params.summary,
      recordsChanged: [],
      artifacts: [],
      evidenceRefs: [],
      metrics: [],
      cost: { estimatedUsd: params.costBudget?.maxUsd ?? 0, actualUsd: 0, tokensIn: 0, tokensOut: 0, durationMs: 0 },
      reversibility: { reversible: true },
      createdAt: now,
      updatedAt: now,
    };

    this.persistOutcome(outcome);
    return outcome;
  }

  /**
   * Record a business record change as part of outcome.
   */
  recordChange(outcomeId: string, change: { module: string; entity: string; id: string; operation: string }): void {
    const outcome = this.getOutcome(outcomeId);
    if (!outcome) return;
    outcome.recordsChanged.push(change);
    outcome.updatedAt = new Date().toISOString();
    this.persistOutcome(outcome);
  }

  /**
   * Attach artifact to outcome.
   */
  attachArtifact(outcomeId: string, artifactId: string): void {
    const outcome = this.getOutcome(outcomeId);
    if (!outcome) return;
    if (!outcome.artifacts.includes(artifactId)) outcome.artifacts.push(artifactId);
    outcome.updatedAt = new Date().toISOString();
    this.persistOutcome(outcome);
  }

  /**
   * Attach evidence.
   */
  attachEvidence(outcomeId: string, evidenceId: string): void {
    const outcome = this.getOutcome(outcomeId);
    if (!outcome) return;
    if (!outcome.evidenceRefs.includes(evidenceId)) outcome.evidenceRefs.push(evidenceId);
    outcome.updatedAt = new Date().toISOString();
    this.persistOutcome(outcome);
  }

  /**
   * Update cost/time metrics.
   */
  updateCost(outcomeId: string, cost: { actualUsd?: number; tokensIn?: number; tokensOut?: number; durationMs?: number }): void {
    const outcome = this.getOutcome(outcomeId);
    if (!outcome) return;
    if (cost.actualUsd !== undefined) outcome.cost.actualUsd = cost.actualUsd;
    if (cost.tokensIn !== undefined) outcome.cost.tokensIn = cost.tokensIn;
    if (cost.tokensOut !== undefined) outcome.cost.tokensOut = cost.tokensOut;
    if (cost.durationMs !== undefined) outcome.cost.durationMs = cost.durationMs;
    outcome.updatedAt = new Date().toISOString();
    this.persistOutcome(outcome);
  }

  /**
   * Add metric.
   */
  addMetric(outcomeId: string, metric: OutcomeMetric): void {
    const outcome = this.getOutcome(outcomeId);
    if (!outcome) return;
    outcome.metrics.push(metric);
    outcome.updatedAt = new Date().toISOString();
    this.persistOutcome(outcome);
  }

  /**
   * Verify outcome — marks as verified.
   */
  verify(outcomeId: string, params: { verifiedBy: string; metrics?: OutcomeMetric[] }): VerifiedOutcome {
    const outcome = this.getOutcome(outcomeId);
    if (!outcome) throw new Error(`Outcome not found: ${outcomeId}`);
    outcome.status = 'verified';
    outcome.verifiedAt = new Date().toISOString();
    outcome.verifiedBy = params.verifiedBy;
    if (params.metrics) outcome.metrics.push(...params.metrics);
    outcome.updatedAt = new Date().toISOString();
    this.persistOutcome(outcome);
    return outcome;
  }

  /**
   * Mark outcome failed.
   */
  fail(outcomeId: string, reason: string): VerifiedOutcome {
    const outcome = this.getOutcome(outcomeId);
    if (!outcome) throw new Error(`Outcome not found: ${outcomeId}`);
    outcome.status = 'failed';
    outcome.failureReason = reason;
    outcome.updatedAt = new Date().toISOString();
    this.persistOutcome(outcome);
    return outcome;
  }

  /**
   * Mark outcome reverted.
   */
  revert(outcomeId: string, restorePath: Record<string, unknown>): VerifiedOutcome {
    const outcome = this.getOutcome(outcomeId);
    if (!outcome) throw new Error(`Outcome not found: ${outcomeId}`);
    outcome.status = 'reverted';
    outcome.reversibility.restorePath = restorePath;
    outcome.updatedAt = new Date().toISOString();
    this.persistOutcome(outcome);
    return outcome;
  }

  getOutcome(outcomeId: string): VerifiedOutcome | null {
    try {
      const row = this.deps.db.prepare(`SELECT * FROM biz_outcomes WHERE outcome_id = ?`).get(outcomeId) as any;
      if (!row) return null;
      return this.rowToOutcome(row);
    } catch {
      return null;
    }
  }

  listByWorkspace(workspaceId: string, opts?: { limit?: number; category?: OutcomeCategory; status?: OutcomeStatus }): VerifiedOutcome[] {
    try {
      let sql = `SELECT * FROM biz_outcomes WHERE workspace_id = ?`;
      const vals: unknown[] = [workspaceId];
      if (opts?.category) { sql += ` AND journey_category = ?`; vals.push(opts.category); }
      if (opts?.status) { sql += ` AND status = ?`; vals.push(opts.status); }
      sql += ` ORDER BY created_at DESC LIMIT ?`;
      vals.push(opts?.limit ?? 50);
      const rows = this.deps.db.prepare(sql).all(...vals) as any[];
      return rows.map(r => this.rowToOutcome(r));
    } catch {
      return [];
    }
  }

  listByJourney(journeyId: string, limit = 20): VerifiedOutcome[] {
    try {
      const rows = this.deps.db.prepare(`SELECT * FROM biz_outcomes WHERE journey_id = ? ORDER BY created_at DESC LIMIT ?`).all(journeyId, limit) as any[];
      return rows.map(r => this.rowToOutcome(r));
    } catch {
      return [];
    }
  }

  getStats(workspaceId: string): { total: number; verified: number; failed: number; pending: number; totalCost: number; avgDurationMs: number } {
    try {
      const rows = this.deps.db.prepare(`SELECT status, cost_actual_usd, duration_ms FROM biz_outcomes WHERE workspace_id = ?`).all(workspaceId) as any[];
      let total = rows.length;
      let verified = 0, failed = 0, pending = 0;
      let totalCost = 0, totalDuration = 0;
      for (const r of rows) {
        if (r.status === 'verified') verified++;
        if (r.status === 'failed') failed++;
        if (r.status === 'pending') pending++;
        totalCost += r.cost_actual_usd ?? 0;
        totalDuration += r.duration_ms ?? 0;
      }
      return { total, verified, failed, pending, totalCost, avgDurationMs: total ? Math.round(totalDuration / total) : 0 };
    } catch {
      return { total: 0, verified: 0, failed: 0, pending: 0, totalCost: 0, avgDurationMs: 0 };
    }
  }

  private persistOutcome(outcome: VerifiedOutcome): void {
    try {
      this.deps.db.prepare(`
        INSERT OR REPLACE INTO biz_outcomes
        (outcome_id, journey_id, journey_category, workflow_run_id, workspace_id, org_id, status, title, summary, records_changed, artifacts, evidence_refs, metrics, cost_estimated_usd, cost_actual_usd, tokens_in, tokens_out, duration_ms, verified_at, verified_by, failure_reason, reversible, restore_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        outcome.outcomeId,
        outcome.journeyId,
        outcome.journeyCategory,
        outcome.workflowRunId,
        outcome.workspaceId,
        outcome.orgId,
        outcome.status,
        outcome.title,
        outcome.summary,
        JSON.stringify(outcome.recordsChanged),
        JSON.stringify(outcome.artifacts),
        JSON.stringify(outcome.evidenceRefs),
        JSON.stringify(outcome.metrics),
        outcome.cost.estimatedUsd,
        outcome.cost.actualUsd,
        outcome.cost.tokensIn,
        outcome.cost.tokensOut,
        outcome.cost.durationMs,
        outcome.verifiedAt ?? null,
        outcome.verifiedBy ?? null,
        outcome.failureReason ?? null,
        outcome.reversibility.reversible ? 1 : 0,
        outcome.reversibility.restorePath ? JSON.stringify(outcome.reversibility.restorePath) : null,
        outcome.createdAt,
        outcome.updatedAt
      );
    } catch (e) {
      console.warn(`[OutcomeTracker] persist failed (table may not exist):`, (e as Error).message);
    }
  }

  private rowToOutcome(row: any): VerifiedOutcome {
    return {
      outcomeId: row.outcome_id,
      journeyId: row.journey_id,
      journeyCategory: row.journey_category,
      workflowRunId: row.workflow_run_id,
      workspaceId: row.workspace_id,
      orgId: row.org_id,
      status: row.status,
      title: row.title,
      summary: row.summary,
      recordsChanged: row.records_changed ? JSON.parse(row.records_changed) : [],
      artifacts: row.artifacts ? JSON.parse(row.artifacts) : [],
      evidenceRefs: row.evidence_refs ? JSON.parse(row.evidence_refs) : [],
      metrics: row.metrics ? JSON.parse(row.metrics) : [],
      cost: {
        estimatedUsd: row.cost_estimated_usd ?? 0,
        actualUsd: row.cost_actual_usd ?? 0,
        tokensIn: row.tokens_in ?? 0,
        tokensOut: row.tokens_out ?? 0,
        durationMs: row.duration_ms ?? 0,
      },
      verifiedAt: row.verified_at,
      verifiedBy: row.verified_by,
      failureReason: row.failure_reason,
      reversibility: { reversible: !!row.reversible, restorePath: row.restore_path ? JSON.parse(row.restore_path) : undefined },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
