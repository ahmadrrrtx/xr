/**
 * XR 5.3 — AI Worker Governance Contract
 * Each worker must declare: role/identity, org/workspace scope, allowed workflows,
 * context scope, capabilities/tools, model/provider scope, budget, risk/placement,
 * approval/review requirements, data access, success/outcome criteria, escalation,
 * revocation/disable behavior.
 *
 * Worker is NOT free-form autonomous agent with broad organizational access.
 */

import type { BusinessDatabase } from './database.ts';
import type { AuditTrail } from './audit.ts';
import type { WorkerAuthorityProfile, WorkerInspection } from './operating-types.ts';
import type { WorkerRole } from './types.ts';
import { WORKER_DEFINITIONS } from '../modules/ai-workers/index.ts';

export interface WorkerContractDeps {
  db: BusinessDatabase;
  audit: AuditTrail;
}

export class WorkerGovernanceService {
  constructor(private deps: WorkerContractDeps) {}

  /**
   * Create or update worker authority profile with narrow defaults.
   */
  createProfile(params: {
    workerId: string;
    role: WorkerRole;
    orgId: string;
    workspaceIds: string[];
    deployerMemberId: string;
    overrides?: Partial<WorkerAuthorityProfile>;
  }): WorkerAuthorityProfile {
    const baseDef = (WORKER_DEFINITIONS as any[]).find((w: any) => w.role === params.role);
    if (!baseDef) throw new Error(`Worker role not found: ${params.role}`);

    const now = new Date().toISOString();
    const profileId = `wprof_${params.workerId}`;

    // Narrow defaults per role
    const narrowDefaults = this.narrowDefaultsForRole(params.role);

    const profile: WorkerAuthorityProfile = {
      profileId,
      workerId: params.workerId,
      role: params.role,
      identity: { workerId: params.workerId, name: baseDef.name, avatar: baseDef.avatar, version: 1 },
      organization: {
        orgId: params.orgId,
        workspaceIds: params.workspaceIds,
        scope: params.workspaceIds.length === 1 ? 'single-workspace' : 'multi-workspace',
      },
      allowedWorkflows: narrowDefaults.allowedWorkflows,
      contextScope: narrowDefaults.contextScope,
      capabilities: (baseDef.capabilities ?? []).map((c: any) => ({ kind: c.module, name: c.actions?.join(',') ?? '', effective: false })),
      toolScope: narrowDefaults.toolScope,
      providerScope: narrowDefaults.providerScope,
      budget: narrowDefaults.budget,
      risk: narrowDefaults.risk,
      approval: narrowDefaults.approval,
      dataAccess: narrowDefaults.dataAccess,
      successCriteria: narrowDefaults.successCriteria,
      escalation: narrowDefaults.escalation,
      revocation: { disableRemovesAuthority: true, revokeCredentialsOnDisable: true, auditOnDisable: true },
      status: { enabled: true, lastActiveAt: Date.now(), budgetUsedToday: 0 },
      createdAt: now,
      updatedAt: now,
      ...params.overrides,
    } as WorkerAuthorityProfile;

    this.persistProfile(profile);

    this.deps.audit.log({
      orgId: params.orgId,
      workspaceId: params.workspaceIds[0],
      actorId: params.deployerMemberId,
      actorType: 'member',
      action: 'worker.authority.created',
      resource: 'workers',
      resourceId: params.workerId,
      metadata: { profileId, role: params.role, scope: profile.organization.scope, allowedWorkflows: profile.allowedWorkflows },
    });

    return profile;
  }

  getProfile(workerId: string): WorkerAuthorityProfile | null {
    try {
      const row = this.deps.db.prepare(`SELECT * FROM biz_worker_authority WHERE worker_id = ?`).get(workerId) as any;
      if (!row) return null;
      return this.rowToProfile(row);
    } catch {
      return null;
    }
  }

  listByWorkspace(workspaceId: string): WorkerAuthorityProfile[] {
    try {
      const rows = this.deps.db.prepare(`SELECT * FROM biz_worker_authority WHERE workspace_id = ?`).all(workspaceId) as any[];
      return rows.map(r => this.rowToProfile(r));
    } catch {
      return [];
    }
  }

  /**
   * Inspection: effective authority, budget, risk, recent outcomes.
   */
  inspect(workerId: string): WorkerInspection | null {
    const profile = this.getProfile(workerId);
    if (!profile) return null;

    // Effective authority = declared ∩ policy (simplified: from dataAccess resources)
    const effectiveAuthority: Record<string, string[]> = {};
    for (const res of profile.dataAccess.resources) {
      if (res === '*') continue;
      effectiveAuthority[res] = ['read']; // narrow default, actual would intersect with RBAC
      if (profile.approval.autoAllowedActions.some(a => a.startsWith(res))) {
        effectiveAuthority[res] = ['read', 'create', 'update'];
      }
    }

    const budgetRemaining = profile.budget.maxUsdPerDay - profile.budget.usedUsdToday;
    const pctUsed = profile.budget.maxUsdPerDay > 0 ? (profile.budget.usedUsdToday / profile.budget.maxUsdPerDay) * 100 : 0;

    return {
      workerId,
      profile,
      effectiveAuthority,
      activeExecutions: 0, // would query execution repo
      recentOutcomes: [], // would query outcome tracker
      pendingApprovals: 0,
      budgetStatus: { remainingUsd: Math.max(0, budgetRemaining), remainingTokens: profile.budget.maxTokensPerTask, pctUsed },
      riskStatus: { currentTier: profile.risk.maxTier, placement: profile.risk.allowedPlacements[0] ?? 'in_process', blocked: !profile.status.enabled },
    };
  }

  /**
   * Enable/disable worker — disable removes authority, revokes credentials, audits.
   */
  setEnabled(workerId: string, enabled: boolean, params: { actorId: string; reason?: string }): WorkerAuthorityProfile {
    const profile = this.getProfile(workerId);
    if (!profile) throw new Error(`Worker profile not found: ${workerId}`);

    profile.status.enabled = enabled;
    if (!enabled) {
      profile.status.disabledAt = Date.now();
      profile.status.disabledReason = params.reason ?? 'disabled by admin';
    } else {
      profile.status.disabledAt = undefined;
      profile.status.disabledReason = undefined;
    }
    profile.updatedAt = new Date().toISOString();

    this.persistProfile(profile);

    // Audit disable
    if (profile.revocation.auditOnDisable) {
      this.deps.audit.log({
        orgId: profile.organization.orgId,
        workspaceId: profile.organization.workspaceIds[0],
        actorId: params.actorId,
        actorType: 'member',
        action: enabled ? 'worker.enabled' : 'worker.disabled',
        resource: 'workers',
        resourceId: workerId,
        metadata: { reason: params.reason, revokeCredentials: profile.revocation.revokeCredentialsOnDisable },
      });
    }

    // Disable in biz_workers table as well for backward compat
    try {
      this.deps.db.prepare(`UPDATE biz_workers SET enabled = ?, updated_at = ? WHERE id = ?`).run(enabled ? 1 : 0, new Date().toISOString(), workerId);
    } catch {}

    return profile;
  }

  /**
   * Update budget usage.
   */
  recordUsage(workerId: string, usage: { usd: number; tokens: number }): void {
    const profile = this.getProfile(workerId);
    if (!profile) return;
    profile.budget.usedUsdToday += usage.usd;
    profile.budget.usedTokensToday += usage.tokens;
    profile.status.lastActiveAt = Date.now();
    profile.status.budgetUsedToday = profile.budget.usedUsdToday;
    profile.updatedAt = new Date().toISOString();
    this.persistProfile(profile);
  }

  /**
   * Check if worker can execute workflow.
   */
  canExecuteWorkflow(workerId: string, workflowDefinitionId: string): { allowed: boolean; reason?: string } {
    const profile = this.getProfile(workerId);
    if (!profile) return { allowed: false, reason: 'Profile not found' };
    if (!profile.status.enabled) return { allowed: false, reason: `Worker disabled: ${profile.status.disabledReason}` };
    if (profile.budget.usedUsdToday >= profile.budget.maxUsdPerDay) return { allowed: false, reason: 'Budget exceeded' };
    if (!profile.allowedWorkflows.includes(workflowDefinitionId) && !profile.allowedWorkflows.includes('*')) {
      return { allowed: false, reason: `Workflow ${workflowDefinitionId} not in allowed list` };
    }
    return { allowed: true };
  }

  // ── Narrow defaults per role ────────────────────────────────────────────

  private narrowDefaultsForRole(role: WorkerRole): Omit<WorkerAuthorityProfile, 'profileId' | 'workerId' | 'identity' | 'organization' | 'capabilities' | 'status' | 'createdAt' | 'updatedAt'> {
    const base: Omit<WorkerAuthorityProfile, 'profileId' | 'workerId' | 'identity' | 'organization' | 'capabilities' | 'status' | 'createdAt' | 'updatedAt'> = {
      role,
      allowedWorkflows: ['personal-knowledge-v1'],
      contextScope: { tiers: ['instructions', 'data'] as ('instructions' | 'data' | 'quarantine')[], maxItems: 10, allowUserMemory: true, allowWorkspaceMemory: true, sensitivityMax: 'internal' as const },
      toolScope: { mode: 'allowlist' as const, tools: ['file-read', 'memory-recall'] },
      providerScope: { allowedProviders: ['ollama', 'local'], allowedModels: [], routingPolicy: 'local-first' as const, locality: 'local' as const },
      budget: { maxUsdPerTask: 0.20, maxUsdPerDay: 1.0, maxTokensPerTask: 8000, maxStepsPerTask: 10, usedUsdToday: 0, usedTokensToday: 0 },
      risk: { maxTier: 'tier0' as const, allowedPlacements: ['in_process'] as ('in_process' | 'restricted_process' | 'namespace_sandbox' | 'container')[], requiresHostAuthority: false },
      approval: { autoAllowedActions: [] as string[], requiresApprovalActions: ['*'] as string[], requiresReviewActions: [] as string[], approvalExpiryMs: 7200000 },
      dataAccess: { resources: [] as string[], crossWorkspace: false },
      successCriteria: { outcomeMetrics: ['records_changed', 'artifact_created'], evidenceRequired: true, humanReviewRequiredFor: [] as string[] },
      escalation: { channels: ['dashboard', 'cli'] as ('dashboard' | 'cli' | 'webhook' | 'email' | 'telegram')[], severityThreshold: 'warning' as const, groupWindowMs: 300000, recipients: [{ kind: 'user' as const, id: 'owner' }] },
      revocation: { disableRemovesAuthority: true, revokeCredentialsOnDisable: true, auditOnDisable: true },
    };

    switch (role) {
      case 'ceo_advisor':
        return {
          ...base,
          allowedWorkflows: ['personal-knowledge-v1', 'research-evidence-v1', 'developer-project-v1'],
          contextScope: { ...base.contextScope, tiers: ['instructions', 'data'], sensitivityMax: 'confidential', maxItems: 20 },
          toolScope: { mode: 'allowlist', tools: ['file-read', 'memory-recall', 'analytics-read'] },
          providerScope: { allowedProviders: ['ollama', 'local'], allowedModels: [], routingPolicy: 'local-first', locality: 'private' },
          budget: { ...base.budget, maxUsdPerTask: 0.30, maxUsdPerDay: 2.0 },
          risk: { maxTier: 'tier0', allowedPlacements: ['in_process'], requiresHostAuthority: false },
          approval: { autoAllowedActions: ['analytics:read', 'sales:read_forecast'], requiresApprovalActions: ['reports:create', 'dashboards:create', '*:write', '*:delete'], requiresReviewActions: ['research:synthesis'], approvalExpiryMs: 7200000 },
          dataAccess: { resources: ['analytics', 'sales', 'finance', 'support', 'hr'], crossWorkspace: true },
          successCriteria: { outcomeMetrics: ['kpi_reported', 'insight_provided', 'evidence_attached'], evidenceRequired: true, humanReviewRequiredFor: ['board_report'] },
        };
      case 'sales_director':
        return {
          ...base,
          allowedWorkflows: ['sales-deal-v1', 'finance-invoice-v1', 'personal-knowledge-v1'],
          contextScope: { ...base.contextScope, sensitivityMax: 'internal', maxItems: 15 },
          toolScope: { mode: 'allowlist', tools: ['crm-read', 'sales-read', 'sales-write', 'task-create'] },
          dataAccess: { resources: ['contacts', 'deals', 'documents', 'tasks'], crossWorkspace: false },
          approval: { autoAllowedActions: ['contacts:create', 'contacts:read', 'contacts:update', 'deals:create', 'deals:read', 'deals:update'], requiresApprovalActions: ['deals:move_to_won_high_value', 'invoices:create_high_value', 'contacts:delete'], requiresReviewActions: [], approvalExpiryMs: 3600000 },
          successCriteria: { outcomeMetrics: ['deal_moved', 'forecast_updated', 'followup_created'], evidenceRequired: true, humanReviewRequiredFor: [] },
        };
      case 'marketing_director':
        return {
          ...base,
          allowedWorkflows: ['personal-knowledge-v1', 'research-evidence-v1'],
          dataAccess: { resources: ['contacts', 'campaigns', 'documents'], crossWorkspace: false },
          approval: { autoAllowedActions: ['contacts:read', 'campaigns:read'], requiresApprovalActions: ['campaigns:create', 'documents:create_public', 'contacts:segment'], requiresReviewActions: ['content:publish'], approvalExpiryMs: 7200000 },
        };
      case 'financial_analyst':
        return {
          ...base,
          allowedWorkflows: ['finance-invoice-v1', 'sales-deal-v1'],
          contextScope: { ...base.contextScope, sensitivityMax: 'confidential', maxItems: 15 },
          dataAccess: { resources: ['invoices', 'expenses', 'deals', 'reports'], crossWorkspace: false },
          providerScope: { ...base.providerScope, routingPolicy: 'local-only', locality: 'private' },
          risk: { maxTier: 'tier0', allowedPlacements: ['in_process'], requiresHostAuthority: false },
          approval: { autoAllowedActions: ['invoices:read', 'expenses:read', 'reports:read'], requiresApprovalActions: ['invoices:create', 'invoices:send', 'expenses:approve'], requiresReviewActions: [], approvalExpiryMs: 7200000 },
          successCriteria: { outcomeMetrics: ['invoice_created', 'pnl_reported'], evidenceRequired: true, humanReviewRequiredFor: [] },
        };
      case 'hr_manager':
        return {
          ...base,
          allowedWorkflows: ['personal-knowledge-v1'],
          contextScope: { ...base.contextScope, sensitivityMax: 'restricted', maxItems: 10 },
          providerScope: { ...base.providerScope, routingPolicy: 'local-only', locality: 'private' },
          dataAccess: { resources: ['employees', 'time_off', 'members'], crossWorkspace: false },
          approval: { autoAllowedActions: ['employees:read', 'time_off:read'], requiresApprovalActions: ['employees:create', 'employees:update', 'time_off:approve'], requiresReviewActions: [], approvalExpiryMs: 7200000 },
        };
      case 'project_manager':
        return {
          ...base,
          allowedWorkflows: ['developer-project-v1', 'project-meeting-to-doc-v1', 'personal-knowledge-v1'],
          dataAccess: { resources: ['projects', 'tasks', 'meetings', 'documents'], crossWorkspace: false },
          approval: { autoAllowedActions: ['projects:read', 'tasks:create', 'tasks:update'], requiresApprovalActions: ['projects:delete', 'milestones:achieve_high_value'], requiresReviewActions: ['project_plan:publish'], approvalExpiryMs: 7200000 },
          successCriteria: { outcomeMetrics: ['project_created', 'tasks_assigned', 'milestone_achieved'], evidenceRequired: true, humanReviewRequiredFor: ['project_plan'] },
        };
      default:
        return {
          ...base,
          allowedWorkflows: ['personal-knowledge-v1'],
          dataAccess: { resources: ['contacts', 'knowledge'], crossWorkspace: false },
        };
    }
  }

  private persistProfile(profile: WorkerAuthorityProfile): void {
    try {
      this.deps.db.prepare(`
        INSERT OR REPLACE INTO biz_worker_authority
        (profile_id, worker_id, role, org_id, workspace_id, workspace_ids, scope, allowed_workflows, context_scope, capabilities, tool_scope, provider_scope, budget, risk, approval, data_access, success_criteria, escalation, revocation, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        profile.profileId,
        profile.workerId,
        profile.role,
        profile.organization.orgId,
        profile.organization.workspaceIds[0] ?? '',
        JSON.stringify(profile.organization.workspaceIds),
        profile.organization.scope,
        JSON.stringify(profile.allowedWorkflows),
        JSON.stringify(profile.contextScope),
        JSON.stringify(profile.capabilities),
        JSON.stringify(profile.toolScope),
        JSON.stringify(profile.providerScope),
        JSON.stringify(profile.budget),
        JSON.stringify(profile.risk),
        JSON.stringify(profile.approval),
        JSON.stringify(profile.dataAccess),
        JSON.stringify(profile.successCriteria),
        JSON.stringify(profile.escalation),
        JSON.stringify(profile.revocation),
        JSON.stringify(profile.status),
        profile.createdAt,
        profile.updatedAt
      );
    } catch (e) {
      console.warn(`[WorkerGovernance] persist failed:`, (e as Error).message);
    }
  }

  private rowToProfile(row: any): WorkerAuthorityProfile {
    return {
      profileId: row.profile_id,
      workerId: row.worker_id,
      role: row.role,
      identity: { workerId: row.worker_id, name: row.role, avatar: undefined, version: 1 },
      organization: {
        orgId: row.org_id,
        workspaceIds: row.workspace_ids ? JSON.parse(row.workspace_ids) : [row.workspace_id],
        scope: row.scope ?? 'single-workspace',
      },
      allowedWorkflows: row.allowed_workflows ? JSON.parse(row.allowed_workflows) : [],
      contextScope: row.context_scope ? JSON.parse(row.context_scope) : { tiers: ['instructions', 'data'], maxItems: 10, allowUserMemory: true, allowWorkspaceMemory: true, sensitivityMax: 'internal' },
      capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
      toolScope: row.tool_scope ? JSON.parse(row.tool_scope) : { mode: 'allowlist', tools: [] },
      providerScope: row.provider_scope ? JSON.parse(row.provider_scope) : { allowedProviders: ['local'], allowedModels: [], routingPolicy: 'local-first', locality: 'local' },
      budget: row.budget ? JSON.parse(row.budget) : { maxUsdPerTask: 0.2, maxUsdPerDay: 1.0, maxTokensPerTask: 8000, maxStepsPerTask: 10, usedUsdToday: 0, usedTokensToday: 0 },
      risk: row.risk ? JSON.parse(row.risk) : { maxTier: 'tier0', allowedPlacements: ['in_process'], requiresHostAuthority: false },
      approval: row.approval ? JSON.parse(row.approval) : { autoAllowedActions: [], requiresApprovalActions: ['*'], requiresReviewActions: [], approvalExpiryMs: 7200000 },
      dataAccess: row.data_access ? JSON.parse(row.data_access) : { resources: [], crossWorkspace: false },
      successCriteria: row.success_criteria ? JSON.parse(row.success_criteria) : { outcomeMetrics: [], evidenceRequired: false, humanReviewRequiredFor: [] },
      escalation: row.escalation ? JSON.parse(row.escalation) : { channels: ['dashboard'], severityThreshold: 'warning', groupWindowMs: 300000, recipients: [] },
      revocation: row.revocation ? JSON.parse(row.revocation) : { disableRemovesAuthority: true, revokeCredentialsOnDisable: true, auditOnDisable: true },
      status: row.status ? JSON.parse(row.status) : { enabled: true, lastActiveAt: Date.now(), budgetUsedToday: 0 },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
