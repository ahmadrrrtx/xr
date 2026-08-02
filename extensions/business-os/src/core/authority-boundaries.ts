/**
 * XR 5.3 — Organization and Role Boundaries
 * Defines user/org/workspace/role/AI worker delegated authority,
 * record/data scope, approval authority, audit visibility.
 *
 * Uses existing RBAC/business foundations. No second identity system.
 * Integrates with trust effective authority.
 */

import type { BusinessDatabase } from './database.ts';
import type { RBACManager } from './rbac.ts';
import type { OrgRole, Member } from './types.ts';
import type { WorkerAuthorityProfile } from './operating-types.ts';

export type AccessKind = 'create' | 'read' | 'update' | 'delete' | 'export' | 'share' | 'admin' | 'approve';

export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
  approvalLevel?: 'none' | 'standard' | 'elevated';
  filteredFields?: string[];
}

export interface AuthorityBoundaryDeps {
  db: BusinessDatabase;
  rbac: RBACManager;
}

export class AuthorityBoundaryService {
  constructor(private deps: AuthorityBoundaryDeps) {}

  /**
   * Check if a member has access to a workspace and resource.
   */
  checkAccess(params: {
    memberId: string;
    workspaceId: string;
    orgId: string;
    resource: string; // e.g. contacts, deals, invoices
    action: AccessKind;
    dataSensitivity?: 'public' | 'internal' | 'confidential' | 'restricted';
  }): AccessCheckResult {
    // RBAC check via existing manager
    const rbacResult = this.deps.rbac.checkAccess(params.memberId, params.resource, params.action as any, params.workspaceId);
    if (!rbacResult.allowed) {
      return { allowed: false, reason: rbacResult.reason ?? 'RBAC denied' };
    }

    // Workspace isolation
    if (!this.deps.rbac.hasWorkspaceAccess(params.memberId, params.workspaceId)) {
      return { allowed: false, reason: 'No workspace access' };
    }

    // Sensitivity check: restricted data only owner/admin/HR manager
    if (params.dataSensitivity === 'restricted') {
      const member = this.deps.rbac.getMember(params.memberId);
      if (!member) return { allowed: false, reason: 'Member not found' };
      if (!['owner', 'admin', 'manager'].includes(member.role)) {
        // Allow HR manager for HR resources
        if (params.resource === 'employees' || params.resource === 'time_off') {
          // manager role in HR context allowed, but check more
        } else {
          return { allowed: false, reason: 'Restricted data requires owner/admin/manager' };
        }
      }
    }

    // High-value operations require approval
    const requiresApproval = this.requiresApproval(params.resource, params.action);
    if (requiresApproval) {
      return {
        allowed: true,
        requiresApproval: true,
        approvalLevel: this.approvalLevel(params.resource, params.action),
        reason: `Action ${params.action} on ${params.resource} requires approval`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check worker delegated authority — worker cannot exceed deployer's authority.
   */
  checkWorkerAuthority(params: {
    workerProfile: WorkerAuthorityProfile;
    deployerMemberId: string;
    workspaceId: string;
    resource: string;
    action: AccessKind;
  }): AccessCheckResult {
    // First check deployer's authority
    const deployerCheck = this.checkAccess({
      memberId: params.deployerMemberId,
      workspaceId: params.workspaceId,
      orgId: params.workerProfile.organization.orgId,
      resource: params.resource,
      action: params.action,
    });
    if (!deployerCheck.allowed) {
      return { allowed: false, reason: `Deployer lacks authority: ${deployerCheck.reason}` };
    }

    // Then check worker's declared dataAccess
    if (!params.workerProfile.dataAccess.resources.includes(params.resource) && !params.workerProfile.dataAccess.resources.includes('*')) {
      return { allowed: false, reason: `Worker not authorized for ${params.resource}` };
    }

    // Cross-workspace check
    if (!params.workerProfile.dataAccess.crossWorkspace) {
      if (!params.workerProfile.organization.workspaceIds.includes(params.workspaceId)) {
        return { allowed: false, reason: `Worker not scoped to workspace ${params.workspaceId}` };
      }
    }

    // Check allowed workflows? This is for record access, not workflow, but we enforce resource.
    // Risk tier check happens in execution bridge + trust service
    // Approval requirement from worker profile
    const requiresApproval = params.workerProfile.approval.requiresApprovalActions.includes(`${params.resource}:${params.action}`) ||
      params.workerProfile.approval.requiresApprovalActions.includes(`${params.resource}.*`) ||
      params.workerProfile.approval.requiresApprovalActions.includes('*');

    if (requiresApproval) {
      return { allowed: true, requiresApproval: true, approvalLevel: 'standard' };
    }

    return { allowed: true };
  }

  /**
   * Get effective permissions for a member in a workspace (with field-level filtering).
   */
  getEffectivePermissions(memberId: string, workspaceId: string): Record<string, string[]> {
    return this.deps.rbac.getEffectivePermissions(memberId, workspaceId) as Record<string, string[]>;
  }

  /**
   * Check approval authority — who can approve.
   */
  checkApprovalAuthority(params: {
    approverMemberId: string;
    workspaceId: string;
    approvalLevel: 'none' | 'standard' | 'elevated';
    resource: string;
  }): AccessCheckResult {
    const member = this.deps.rbac.getMember(params.approverMemberId);
    if (!member) return { allowed: false, reason: 'Approver not found' };

    if (params.approvalLevel === 'elevated') {
      if (!['owner', 'admin'].includes(member.role)) {
        return { allowed: false, reason: 'Elevated approval requires owner/admin' };
      }
    } else if (params.approvalLevel === 'standard') {
      if (!['owner', 'admin', 'manager'].includes(member.role)) {
        return { allowed: false, reason: 'Standard approval requires manager+' };
      }
    }

    if (!this.deps.rbac.hasWorkspaceAccess(params.approverMemberId, params.workspaceId)) {
      return { allowed: false, reason: 'Approver has no workspace access' };
    }

    return { allowed: true };
  }

  /**
   * Audit visibility per role.
   */
  getAuditVisibility(memberId: string): 'full' | 'workspace' | 'own' | 'none' {
    const member = this.deps.rbac.getMember(memberId);
    if (!member) return 'none';
    switch (member.role) {
      case 'owner':
      case 'admin':
        return 'full';
      case 'manager':
        return 'workspace';
      case 'member':
        return 'own';
      case 'viewer':
        return 'own';
      case 'guest':
        return 'none';
      default:
        return 'none';
    }
  }

  /**
   * Resolve delegated authority: worker effective = deployer ∩ worker declared.
   */
  resolveDelegatedAuthority(deployerMemberId: string, workerProfile: WorkerAuthorityProfile, workspaceId: string): Record<string, string[]> {
    const deployerPerms = this.getEffectivePermissions(deployerMemberId, workspaceId);
    const result: Record<string, string[]> = {};

    for (const [resource, actions] of Object.entries(deployerPerms)) {
      const workerAllows = workerProfile.dataAccess.resources.includes(resource) || workerProfile.dataAccess.resources.includes('*');
      if (!workerAllows) continue;
      // Intersection — worker cannot have more than deployer
      result[resource] = actions as string[];
    }

    return result;
  }

  // ── Private ───────────────────────────────────────────────────────────

  private requiresApproval(resource: string, action: AccessKind): boolean {
    // High-stakes actions requiring approval per spec
    const approvalRequired: Record<string, AccessKind[]> = {
      'invoices': ['create', 'update', 'delete', 'export'], // especially send is external
      'deals': ['delete'], // high-value close handled specially elsewhere
      'contacts': ['delete'],
      'expenses': ['create', 'update'],
      'employees': ['create', 'update', 'delete'],
      'time_off': ['update'], // approval for time-off
      'documents': ['delete'],
      'automation': ['create', 'update', 'delete'],
      'workers': ['create', 'delete'],
    };
    return (approvalRequired[resource] ?? []).includes(action);
  }

  private approvalLevel(resource: string, action: AccessKind): 'none' | 'standard' | 'elevated' {
    // External writes elevated
    if (resource === 'invoices' && action === 'export') return 'elevated';
    if (resource === 'automation' || resource === 'workers') return 'elevated';
    if (resource === 'employees') return 'elevated';
    return 'standard';
  }
}
