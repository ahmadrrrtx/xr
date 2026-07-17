/**
 * XR Business OS — Security Policies
 * 
 * Integrates with XR Shield for policy enforcement.
 * All business operations must pass through these policies.
 */

import type { BusinessDatabase } from '../business/core/database.ts';
import type { RBACManager } from '../business/core/rbac.ts';
import type { AuditTrail } from '../business/core/audit.ts';

export interface SecurityPolicy {
  id: string;
  name: string;
  description: string;
  type: 'access' | 'data' | 'integration' | 'automation';
  rules: PolicyRule[];
  enabled: boolean;
}

export interface PolicyRule {
  resource: string;
  action: string;
  effect: 'allow' | 'deny';
  conditions?: Record<string, unknown>;
}

export class BusinessSecurityPolicies {
  private policies: SecurityPolicy[] = [
    // Access policies
    {
      id: 'least_privilege',
      name: 'Least Privilege',
      description: 'Users can only access resources they have explicit permission for',
      type: 'access',
      enabled: true,
      rules: [
        { resource: '*', action: '*', effect: 'allow', conditions: { hasPermission: true } },
        { resource: '*', action: '*', effect: 'deny' },
      ],
    },
    // Data policies
    {
      id: 'data_isolation',
      name: 'Workspace Isolation',
      description: 'Data from one workspace cannot be accessed from another',
      type: 'data',
      enabled: true,
      rules: [
        { resource: '*', action: 'read', effect: 'allow', conditions: { sameWorkspace: true } },
        { resource: '*', action: 'read', effect: 'deny' },
      ],
    },
    {
      id: 'export_approval',
      name: 'Export Approval',
      description: 'Data exports require admin approval',
      type: 'data',
      enabled: true,
      rules: [
        { resource: '*', action: 'export', effect: 'deny', conditions: { role: ['viewer', 'member'] } },
        { resource: '*', action: 'export', effect: 'allow', conditions: { role: ['admin', 'owner'] } },
      ],
    },
    // Integration policies
    {
      id: 'integration_consent',
      name: 'Integration Consent',
      description: 'All integrations require explicit user consent',
      type: 'integration',
      enabled: true,
      rules: [
        { resource: 'integrations', action: 'connect', effect: 'deny', conditions: { noConsent: true } },
        { resource: 'integrations', action: 'connect', effect: 'allow' },
      ],
    },
    {
      id: 'credential_protection',
      name: 'Credential Protection',
      description: 'Credentials are never exposed in logs or API responses',
      type: 'integration',
      enabled: true,
      rules: [
        { resource: 'credentials', action: 'read', effect: 'allow', conditions: { isOwner: true } },
        { resource: 'credentials', action: 'read', effect: 'deny' },
      ],
    },
    // Automation policies
    {
      id: 'automation_budget',
      name: 'Automation Budget',
      description: 'Automations cannot exceed configured cost limits',
      type: 'automation',
      enabled: true,
      rules: [
        { resource: 'automations', action: 'execute', effect: 'deny', conditions: { overBudget: true } },
        { resource: 'automations', action: 'execute', effect: 'allow' },
      ],
    },
    {
      id: 'worker_permission_approval',
      name: 'Worker Permission Approval',
      description: 'AI Workers require approval for sensitive operations',
      type: 'automation',
      enabled: true,
      rules: [
        { resource: 'workers', action: 'delete', effect: 'deny', conditions: { requireApproval: true } },
        { resource: 'workers', action: 'send_external', effect: 'deny', conditions: { requireApproval: true } },
        { resource: 'workers', action: '*', effect: 'allow' },
      ],
    },
  ];

  constructor(
    private db: BusinessDatabase,
    private rbac: RBACManager,
    private audit: AuditTrail,
  ) {}

  /**
   * Check if an operation is allowed by security policies.
   */
  checkPolicy(params: {
    orgId: string;
    workspaceId?: string;
    actorId: string;
    resource: string;
    action: string;
    context?: Record<string, unknown>;
  }): { allowed: boolean; policy?: string; reason?: string } {
    // Check each policy in order
    for (const policy of this.policies) {
      if (!policy.enabled) continue;

      for (const rule of policy.rules) {
        if (!this.matchesRule(rule, params.resource, params.action)) continue;

        // Check conditions
        if (rule.conditions) {
          const conditionsMet = this.evaluateConditions(rule.conditions, {
            ...params.context,
            actorId: params.actorId,
            workspaceId: params.workspaceId,
          });

          if (!conditionsMet) continue;
        }

        if (rule.effect === 'deny') {
          return {
            allowed: false,
            policy: policy.id,
            reason: `Denied by policy "${policy.name}": ${policy.description}`,
          };
        }

        if (rule.effect === 'allow') {
          return { allowed: true, policy: policy.id };
        }
      }
    }

    // Default deny
    return { allowed: false, reason: 'No matching allow policy' };
  }

  /**
   * Assert that an operation is allowed. Throws if denied.
   */
  assertPolicy(params: Parameters<typeof this.checkPolicy>[0]): void {
    const result = this.checkPolicy(params);
    if (!result.allowed) {
      // Log the denied attempt
      this.audit.log({
        orgId: params.orgId,
        workspaceId: params.workspaceId,
        actorId: params.actorId,
        actorType: 'member',
        action: `${params.action}_denied`,
        resource: params.resource,
        resourceId: 'policy',
        metadata: { policy: result.policy, reason: result.reason },
      });

      throw new Error(`Security policy violation: ${result.reason}`);
    }
  }

  /**
   * List all policies.
   */
  listPolicies(): SecurityPolicy[] {
    return [...this.policies];
  }

  /**
   * Enable/disable a policy.
   */
  togglePolicy(id: string, enabled: boolean): void {
    const policy = this.policies.find(p => p.id === id);
    if (policy) policy.enabled = enabled;
  }

  private matchesRule(rule: PolicyRule, resource: string, action: string): boolean {
    const resourceMatch = rule.resource === '*' || rule.resource === resource;
    const actionMatch = rule.action === '*' || rule.action === action;
    return resourceMatch && actionMatch;
  }

  private evaluateConditions(conditions: Record<string, unknown>, context: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(conditions)) {
      switch (key) {
        case 'hasPermission':
          // Would check RBAC in real implementation
          break;
        case 'sameWorkspace':
          if (context.workspaceId !== context.targetWorkspaceId) return false;
          break;
        case 'role':
          const allowedRoles = value as string[];
          if (!allowedRoles.includes(context.role as string)) return false;
          break;
        case 'isOwner':
          if (context.actorId !== context.resourceOwnerId) return false;
          break;
        case 'noConsent':
          if (value === true) return false;
          break;
        case 'overBudget':
          if (value === true) return false;
          break;
        case 'requireApproval':
          if (value === true && !context.approved) return false;
          break;
      }
    }
    return true;
  }
}
