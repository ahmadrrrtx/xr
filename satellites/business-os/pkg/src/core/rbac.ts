/**
 * XR Business OS — Role-Based Access Control
 * 
 * Integrates with XR Shield for enforcement.
 * All business operations check permissions before execution.
 */

import { BusinessDatabase } from './database.ts';
import type { Member, OrgRole, Permission, PermissionAction } from './types.ts';

// Default permissions per role
const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 100,
  admin: 80,
  manager: 60,
  member: 40,
  viewer: 20,
  guest: 10,
};

// Default resource permissions per role
const DEFAULT_ROLE_PERMISSIONS: Record<OrgRole, Record<string, PermissionAction[]>> = {
  owner: {
    '*': ['create', 'read', 'update', 'delete', 'export', 'share', 'admin'],
  },
  admin: {
    '*': ['create', 'read', 'update', 'delete', 'export', 'share'],
    members: ['create', 'read', 'update', 'delete'],
    settings: ['read', 'update'],
  },
  manager: {
    contacts: ['create', 'read', 'update', 'delete', 'export'],
    deals: ['create', 'read', 'update', 'delete', 'export'],
    tickets: ['create', 'read', 'update', 'delete'],
    projects: ['create', 'read', 'update', 'delete'],
    tasks: ['create', 'read', 'update', 'delete'],
    invoices: ['create', 'read', 'update'],
    reports: ['create', 'read', 'export'],
    dashboards: ['create', 'read', 'update', 'delete'],
    documents: ['create', 'read', 'update', 'delete', 'share'],
    meetings: ['create', 'read', 'update', 'delete'],
    knowledge: ['create', 'read', 'update', 'delete'],
    workers: ['read', 'update'],
    automations: ['create', 'read', 'update'],
  },
  member: {
    contacts: ['create', 'read', 'update'],
    deals: ['create', 'read', 'update'],
    tickets: ['create', 'read', 'update'],
    projects: ['read', 'update'],
    tasks: ['create', 'read', 'update'],
    documents: ['create', 'read', 'update'],
    meetings: ['create', 'read', 'update'],
    knowledge: ['read'],
    workers: ['read'],
    dashboards: ['read'],
  },
  viewer: {
    contacts: ['read'],
    deals: ['read'],
    tickets: ['read'],
    projects: ['read'],
    tasks: ['read'],
    documents: ['read'],
    meetings: ['read'],
    knowledge: ['read'],
    dashboards: ['read'],
  },
  guest: {
    knowledge: ['read'],
  },
};

export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
  conditions?: Record<string, unknown>;
}

export class RBACManager {
  constructor(private db: BusinessDatabase) {}

  /**
   * Check if a member has permission for an action on a resource.
   */
  checkAccess(
    memberId: string,
    resource: string,
    action: PermissionAction,
    workspaceId?: string
  ): AccessCheckResult {
    const member = this.getMember(memberId);
    if (!member) return { allowed: false, reason: 'Member not found' };
    if (member.status !== 'active') return { allowed: false, reason: 'Member is not active' };

    // Check custom permissions first (most specific)
    const customResult = this.checkCustomPermissions(member, resource, action, workspaceId);
    if (customResult) return customResult;

    // Check role-based defaults
    return this.checkRolePermissions(member, resource, action, workspaceId);
  }

  /**
   * Assert access — throws if denied.
   */
  assertAccess(memberId: string, resource: string, action: PermissionAction, workspaceId?: string): void {
    const result = this.checkAccess(memberId, resource, action, workspaceId);
    if (!result.allowed) {
      throw new Error(`Access denied: ${action} on ${resource}. ${result.reason ?? ''}`);
    }
  }

  /**
   * Get member by ID.
   */
  getMember(memberId: string): Member | null {
    const row = this.db.prepare(
      'SELECT * FROM biz_members WHERE id = ?'
    ).get(memberId) as any;

    if (!row) return null;
    return this.rowToMember(row);
  }

  /**
   * Get member by user ID and org.
   */
  getMemberByUser(userId: string, orgId: string): Member | null {
    const row = this.db.prepare(
      'SELECT * FROM biz_members WHERE user_id = ? AND org_id = ?'
    ).get(userId, orgId) as any;

    if (!row) return null;
    return this.rowToMember(row);
  }

  /**
   * Add a member to an organization.
   */
  addMember(orgId: string, params: {
    userId: string;
    email: string;
    name: string;
    role: OrgRole;
    workspaces?: { workspaceId: string; role: OrgRole; modules?: string[] }[];
  }): Member {
    const id = BusinessDatabase.generateId();
    const now = BusinessDatabase.now();

    this.db.prepare(`
      INSERT INTO biz_members (id, org_id, user_id, email, name, role, workspaces, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(id, orgId, params.userId, params.email, params.name, params.role,
      JSON.stringify(params.workspaces ?? []), now);

    return this.getMember(id)!;
  }

  /**
   * Update member role.
   */
  updateMemberRole(memberId: string, role: OrgRole): void {
    this.db.prepare(
      'UPDATE biz_members SET role = ? WHERE id = ?'
    ).run(role, memberId);
  }

  /**
   * Update member workspace access.
   */
  updateWorkspaceAccess(memberId: string, workspaces: Member['workspaces']): void {
    this.db.prepare(
      'UPDATE biz_members SET workspaces = ? WHERE id = ?'
    ).run(JSON.stringify(workspaces), memberId);
  }

  /**
   * Set custom permissions for a member.
   */
  setPermissions(memberId: string, permissions: Permission[]): void {
    this.db.prepare(
      'UPDATE biz_members SET permissions = ? WHERE id = ?'
    ).run(JSON.stringify(permissions), memberId);
  }

  /**
   * Disable a member.
   */
  disableMember(memberId: string): void {
    this.db.prepare(
      "UPDATE biz_members SET status = 'disabled' WHERE id = ?"
    ).run(memberId);
  }

  /**
   * List members of an organization.
   */
  listMembers(orgId: string): Member[] {
    const rows = this.db.prepare(
      'SELECT * FROM biz_members WHERE org_id = ? ORDER BY name'
    ).all(orgId) as any[];

    return rows.map(r => this.rowToMember(r));
  }

  /**
   * List members of a workspace.
   */
  listWorkspaceMembers(workspaceId: string): Member[] {
    const rows = this.db.prepare(
      "SELECT * FROM biz_members WHERE status = 'active'"
    ).all() as any[];

    return rows
      .map(r => this.rowToMember(r))
      .filter(m => m.workspaces.some(w => w.workspaceId === workspaceId));
  }

  /**
   * Check if member has access to a workspace.
   */
  hasWorkspaceAccess(memberId: string, workspaceId: string): boolean {
    const member = this.getMember(memberId);
    if (!member) return false;

    // Owners and admins have access to all workspaces
    if (member.role === 'owner' || member.role === 'admin') return true;

    return member.workspaces.some(w => w.workspaceId === workspaceId);
  }

  /**
   * Get effective permissions for a member in a workspace.
   */
  getEffectivePermissions(memberId: string, workspaceId: string): Record<string, PermissionAction[]> {
    const member = this.getMember(memberId);
    if (!member) return {};

    const base = DEFAULT_ROLE_PERMISSIONS[member.role] ?? {};
    const result: Record<string, PermissionAction[]> = {};

    // Apply base role permissions
    for (const [resource, actions] of Object.entries(base)) {
      result[resource] = [...actions];
    }

    // Apply custom permissions (override)
    for (const perm of member.permissions) {
      result[perm.resource] = [...perm.actions];
    }

    return result;
  }

  private checkCustomPermissions(
    member: Member,
    resource: string,
    action: PermissionAction,
    workspaceId?: string
  ): AccessCheckResult | null {
    for (const perm of member.permissions) {
      if (perm.resource === resource || perm.resource === '*') {
        if (perm.actions.includes(action) || perm.actions.includes('admin')) {
          // Check conditions if any
          if (perm.conditions && perm.conditions.length > 0) {
            return { allowed: true, conditions: this.buildConditions(perm.conditions) };
          }
          return { allowed: true };
        }
        // Explicit deny if permission exists but action not included
        return { allowed: false, reason: `Custom permission does not allow ${action} on ${resource}` };
      }
    }
    return null; // no custom permission found, fall through to role defaults
  }

  private checkRolePermissions(
    member: Member,
    resource: string,
    action: PermissionAction,
    workspaceId?: string
  ): AccessCheckResult {
    // Check workspace access if workspaceId provided
    if (workspaceId && !this.hasWorkspaceAccess(member.id, workspaceId)) {
      return { allowed: false, reason: 'No access to this workspace' };
    }

    const rolePerms = DEFAULT_ROLE_PERMISSIONS[member.role];
    if (!rolePerms) return { allowed: false, reason: 'Unknown role' };

    // Check wildcard first
    if (rolePerms['*']?.includes(action)) {
      return { allowed: true };
    }

    // Check specific resource
    const resourcePerms = rolePerms[resource];
    if (resourcePerms?.includes(action)) {
      return { allowed: true };
    }

    return { allowed: false, reason: `Role ${member.role} does not allow ${action} on ${resource}` };
  }

  private buildConditions(conditions: Permission['conditions']): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const cond of conditions ?? []) {
      result[cond.field] = { operator: cond.operator, value: cond.value };
    }
    return result;
  }

  private rowToMember(row: any): Member {
    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      email: row.email,
      name: row.name,
      avatar: row.avatar,
      role: row.role,
      workspaces: JSON.parse(row.workspaces),
      permissions: JSON.parse(row.permissions),
      status: row.status,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
    };
  }
}
