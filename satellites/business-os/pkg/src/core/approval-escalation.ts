/**
 * XR 5.3 — Human Attention — Approval / Review / Escalation
 * Defines meaningful escalation: approval, auto-execute, review, informational,
 * grouped/deferred notifications, uncertainty display.
 *
 * Avoids approval fatigue and silent consequential automation.
 * Uses canonical workflow human nodes.
 */

import type { BusinessDatabase } from './database.ts';
import type { ApprovalRequest, ApprovalKind, ApprovalSeverity, ApprovalStatus, NotificationChannel, NotificationRecipient } from './operating-types.ts';

export interface ApprovalDeps {
  db: BusinessDatabase;
}

export interface CreateApprovalParams {
  kind: ApprovalKind;
  orgId: string;
  workspaceId: string;
  workflowRunId?: string;
  nodeId?: string;
  requestedBy: { kind: string; id: string };
  title: string;
  description: string;
  severity: ApprovalSeverity;
  channels?: NotificationChannel[];
  recipients: NotificationRecipient[];
  evidence?: Array<{ kind: string; id: string }>;
  artifacts?: string[];
  recordMutationId?: string;
  contextSummary?: string;
  contextPackageIds?: string[];
  uncertainty?: { confidence: number; reasons: string[] };
  expiresInMs?: number;
}

export class ApprovalEscalationService {
  constructor(private deps: ApprovalDeps) {}

  /**
   * Create an approval or review request.
   */
  createRequest(params: CreateApprovalParams): ApprovalRequest {
    const approvalId = `apr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + (params.expiresInMs ?? 2 * 60 * 60 * 1000)).toISOString(); // default 2h

    const request: ApprovalRequest = {
      approvalId,
      kind: params.kind,
      orgId: params.orgId,
      workspaceId: params.workspaceId,
      workflowRunId: params.workflowRunId,
      nodeId: params.nodeId,
      requestedBy: params.requestedBy,
      title: params.title,
      description: params.description,
      severity: params.severity,
      channels: params.channels ?? ['dashboard', 'cli'],
      recipients: params.recipients,
      evidence: (params.evidence as any) ?? [],
      artifacts: params.artifacts ?? [],
      recordMutationId: params.recordMutationId,
      contextShown: {
        packageIds: params.contextPackageIds ?? [],
        summary: params.contextSummary ?? '',
        uncertainty: params.uncertainty,
      },
      status: 'pending',
      createdAt: now,
      expiresAt,
    };

    this.persist(request);

    // Grouping/deferral logic: if same title + workspace within group window, we could batch
    // For MVP, we persist and let dashboard group by workspace + severity + kind.

    return request;
  }

  /**
   * Decide on an approval request.
   */
  decide(approvalId: string, params: { decidedBy: string; outcome: ApprovalStatus; comment?: string }): ApprovalRequest {
    const request = this.getRequest(approvalId);
    if (!request) throw new Error(`Approval not found: ${approvalId}`);
    if (request.status !== 'pending') throw new Error(`Approval ${approvalId} already decided: ${request.status}`);

    if (new Date(request.expiresAt).getTime() < Date.now()) {
      // Expired
      request.status = 'expired';
      request.decidedAt = new Date().toISOString();
      this.persist(request);
      throw new Error(`Approval ${approvalId} has expired`);
    }

    request.status = params.outcome;
    request.decision = {
      decidedBy: params.decidedBy,
      outcome: params.outcome,
      comment: params.comment,
      decidedAt: new Date().toISOString(),
    };
    request.decidedAt = request.decision.decidedAt;
    this.persist(request);

    return request;
  }

  /**
   * List pending approvals for a workspace, grouped.
   */
  listPending(workspaceId: string, opts?: { limit?: number; severity?: ApprovalSeverity; kind?: ApprovalKind }): ApprovalRequest[] {
    try {
      let sql = `SELECT * FROM biz_approvals WHERE workspace_id = ? AND status = 'pending'`;
      const vals: unknown[] = [workspaceId];
      if (opts?.severity) { sql += ` AND severity = ?`; vals.push(opts.severity); }
      if (opts?.kind) { sql += ` AND kind = ?`; vals.push(opts.kind); }
      sql += ` ORDER BY created_at ASC LIMIT ?`;
      vals.push(opts?.limit ?? 50);
      const rows = this.deps.db.prepare(sql).all(...vals) as any[];
      return rows.map(r => this.rowToApproval(r));
    } catch {
      return [];
    }
  }

  listByWorkflowRun(workflowRunId: string): ApprovalRequest[] {
    try {
      const rows = this.deps.db.prepare(`SELECT * FROM biz_approvals WHERE workflow_run_id = ? ORDER BY created_at ASC`).all(workflowRunId) as any[];
      return rows.map(r => this.rowToApproval(r));
    } catch {
      return [];
    }
  }

  getRequest(approvalId: string): ApprovalRequest | null {
    try {
      const row = this.deps.db.prepare(`SELECT * FROM biz_approvals WHERE approval_id = ?`).get(approvalId) as any;
      if (!row) return null;
      return this.rowToApproval(row);
    } catch {
      return null;
    }
  }

  /**
   * Expire old pending approvals.
   */
  expireStale(): number {
    try {
      const now = new Date().toISOString();
      const rows = this.deps.db.prepare(`SELECT * FROM biz_approvals WHERE status = 'pending' AND expires_at < ?`).all(now) as any[];
      for (const row of rows) {
        this.deps.db.prepare(`UPDATE biz_approvals SET status = 'expired', decided_at = ? WHERE approval_id = ?`).run(now, row.approval_id);
      }
      return rows.length;
    } catch {
      return 0;
    }
  }

  /**
   * Work queue view: outcome-centered.
   */
  getWorkQueue(workspaceId: string): {
    pendingApprovals: number;
    pendingReviews: number;
    criticalCount: number;
    grouped: Record<string, ApprovalRequest[]>;
  } {
    const pending = this.listPending(workspaceId, { limit: 100 });
    const pendingApprovals = pending.filter(p => p.kind === 'approval').length;
    const pendingReviews = pending.filter(p => p.kind === 'review').length;
    const criticalCount = pending.filter(p => p.severity === 'critical').length;

    // Group by severity + kind
    const grouped: Record<string, ApprovalRequest[]> = {};
    for (const req of pending) {
      const key = `${req.severity}:${req.kind}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(req);
    }

    return { pendingApprovals, pendingReviews, criticalCount, grouped };
  }

  /**
   * What requires approval? (Spec 6.6)
   */
  static classifyAttention(params: {
    module: string;
    entity: string;
    operation: string;
    value?: number;
    isExternalWrite?: boolean;
    isSensitive?: boolean;
    confidence?: number;
  }): { requires: 'approval' | 'review' | 'auto' | 'info'; severity: ApprovalSeverity; reason: string } {
    // External writes always require approval
    if (params.isExternalWrite) {
      return { requires: 'approval', severity: 'critical', reason: 'External write requires elevated approval' };
    }

    // High-value financial
    if (params.module === 'finance' && (params.value ?? 0) > 5000) {
      return { requires: 'approval', severity: 'warning', reason: `High-value finance operation $${params.value} requires approval` };
    }
    if (params.module === 'sales' && params.entity === 'deal' && params.operation === 'update' && (params.value ?? 0) > 10000) {
      return { requires: 'approval', severity: 'warning', reason: `High-value deal move $${params.value} requires manager approval` };
    }

    // Sensitive data
    if (params.isSensitive) {
      return { requires: 'approval', severity: 'critical', reason: 'Sensitive data operation requires approval' };
    }

    // Low confidence agentic outputs
    if (params.confidence !== undefined && params.confidence < 0.7) {
      return { requires: 'review', severity: 'warning', reason: `Low confidence ${params.confidence} requires review` };
    }

    // Deletes require review
    if (params.operation === 'delete') {
      return { requires: 'review', severity: 'warning', reason: 'Delete operations require review' };
    }

    // Auto for low-risk
    if (['create', 'update'].includes(params.operation) && !params.isSensitive && !params.isExternalWrite) {
      return { requires: 'auto', severity: 'info', reason: 'Low-risk auto-executable' };
    }

    return { requires: 'info', severity: 'info', reason: 'Informational' };
  }

  private persist(request: ApprovalRequest): void {
    try {
      this.deps.db.prepare(`
        INSERT OR REPLACE INTO biz_approvals
        (approval_id, kind, org_id, workspace_id, workflow_run_id, node_id, requested_by_kind, requested_by_id, title, description, severity, channels, recipients, evidence, artifacts, record_mutation_id, context_summary, context_package_ids, uncertainty, status, decision, expires_at, created_at, decided_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        request.approvalId,
        request.kind,
        request.orgId,
        request.workspaceId,
        request.workflowRunId ?? null,
        request.nodeId ?? null,
        request.requestedBy.kind,
        request.requestedBy.id,
        request.title,
        request.description,
        request.severity,
        JSON.stringify(request.channels),
        JSON.stringify(request.recipients),
        JSON.stringify(request.evidence),
        JSON.stringify(request.artifacts),
        request.recordMutationId ?? null,
        request.contextShown.summary,
        JSON.stringify(request.contextShown.packageIds),
        request.contextShown.uncertainty ? JSON.stringify(request.contextShown.uncertainty) : null,
        request.status,
        request.decision ? JSON.stringify(request.decision) : null,
        request.expiresAt,
        request.createdAt,
        request.decidedAt ?? null
      );
    } catch (e) {
      console.warn(`[ApprovalService] persist failed:`, (e as Error).message);
    }
  }

  private rowToApproval(row: any): ApprovalRequest {
    return {
      approvalId: row.approval_id,
      kind: row.kind,
      orgId: row.org_id,
      workspaceId: row.workspace_id,
      workflowRunId: row.workflow_run_id,
      nodeId: row.node_id,
      requestedBy: { kind: row.requested_by_kind, id: row.requested_by_id },
      title: row.title,
      description: row.description,
      severity: row.severity,
      channels: row.channels ? JSON.parse(row.channels) : ['dashboard'],
      recipients: row.recipients ? JSON.parse(row.recipients) : [],
      evidence: row.evidence ? JSON.parse(row.evidence) : [],
      artifacts: row.artifacts ? JSON.parse(row.artifacts) : [],
      recordMutationId: row.record_mutation_id,
      contextShown: {
        summary: row.context_summary ?? '',
        packageIds: row.context_package_ids ? JSON.parse(row.context_package_ids) : [],
        uncertainty: row.uncertainty ? JSON.parse(row.uncertainty) : undefined,
      },
      status: row.status,
      decision: row.decision ? JSON.parse(row.decision) : undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      decidedAt: row.decided_at,
    };
  }
}
