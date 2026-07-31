/**
 * XR 6.0 — Identity Service for Remote Execution
 *
 * Manages scoped remote identity for workers, users, and services.
 * Uses existing auth/secret mechanisms where possible.
 * Does NOT create enterprise admin features.
 *
 * Identity is bound to authenticated sessions and scoped authority.
 * Tokens are time-limited and revocable.
 */

import { randomUUID, createHash } from "node:crypto";
import type {
  RemoteIdentity,
  OrganizationIdentity,
  TenantBoundary,
  DeploymentProfileKind,
} from "../types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Identity Service
// ═══════════════════════════════════════════════════════════════════════════

export interface IdentityServiceDeps {
  /** Default token TTL in ms. */
  defaultTokenTtlMs?: number;
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class IdentityService {
  private readonly identities = new Map<string, RemoteIdentity>();
  private readonly organizations = new Map<string, OrganizationIdentity>();
  private readonly tenants = new Map<string, TenantBoundary>();
  private readonly deps: IdentityServiceDeps;
  private readonly defaultTtl: number;

  constructor(deps: IdentityServiceDeps = {}) {
    this.deps = deps;
    this.defaultTtl = deps.defaultTokenTtlMs ?? 60 * 60 * 1000; // 1 hour default
  }

  // ── Identity Management ──────────────────────────────────────────────

  /**
   * Issue a new remote identity token.
   */
  issueIdentity(params: {
    kind: RemoteIdentity["kind"];
    organizationId?: string;
    workspaceIds: string[];
    scopes: string[];
    ttlMs?: number;
  }): RemoteIdentity {
    const now = Date.now();
    const ttl = params.ttlMs ?? this.defaultTtl;

    const identity: RemoteIdentity = {
      identityId: `id_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      kind: params.kind,
      organizationId: params.organizationId,
      workspaceIds: params.workspaceIds,
      scopes: params.scopes,
      issuedAt: now,
      expiresAt: now + ttl,
      revoked: false,
    };

    this.identities.set(identity.identityId, identity);

    this.deps.audit?.("identity.issued", {
      identityId: identity.identityId,
      kind: identity.kind,
      organizationId: identity.organizationId,
      scopes: identity.scopes.length,
      expiresAt: identity.expiresAt,
    });

    return identity;
  }

  /**
   * Verify an identity token is valid.
   */
  verifyIdentity(identityId: string): { valid: boolean; identity?: RemoteIdentity; reason?: string } {
    const identity = this.identities.get(identityId);
    if (!identity) {
      return { valid: false, reason: "Identity not found" };
    }
    if (identity.revoked) {
      return { valid: false, identity, reason: "Identity has been revoked" };
    }
    if (identity.expiresAt < Date.now()) {
      return { valid: false, identity, reason: "Identity has expired" };
    }
    return { valid: true, identity };
  }

  /**
   * Check if an identity has a specific scope.
   */
  hasScope(identityId: string, scope: string): boolean {
    const result = this.verifyIdentity(identityId);
    if (!result.valid || !result.identity) return false;
    return result.identity.scopes.includes(scope);
  }

  /**
   * Check if an identity has access to a specific workspace.
   */
  hasWorkspaceAccess(identityId: string, workspaceId: string): boolean {
    const result = this.verifyIdentity(identityId);
    if (!result.valid || !result.identity) return false;
    return result.identity.workspaceIds.includes(workspaceId);
  }

  /**
   * Revoke an identity token.
   */
  revokeIdentity(identityId: string, reason: string): boolean {
    const identity = this.identities.get(identityId);
    if (!identity) return false;

    const updated: RemoteIdentity = { ...identity, revoked: true };
    this.identities.set(identityId, updated);

    this.deps.audit?.("identity.revoked", {
      identityId,
      reason,
      kind: identity.kind,
    });

    return true;
  }

  /**
   * Revoke all identities for a workspace.
   */
  revokeAllForWorkspace(workspaceId: string, reason: string): number {
    let count = 0;
    for (const [id, identity] of this.identities) {
      if (identity.workspaceIds.includes(workspaceId) && !identity.revoked) {
        this.revokeIdentity(id, reason);
        count++;
      }
    }
    return count;
  }

  /**
   * Clean up expired identities.
   */
  cleanupExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, identity] of this.identities) {
      if (identity.expiresAt < now || identity.revoked) {
        this.identities.delete(id);
        count++;
      }
    }
    return count;
  }

  // ── Organization Management ──────────────────────────────────────────

  /**
   * Register an organization.
   */
  registerOrganization(params: {
    name: string;
    plan: OrganizationIdentity["plan"];
    maxWorkspaces?: number;
    maxWorkers?: number;
    dataResidencyRegion?: string;
  }): OrganizationIdentity {
    const org: OrganizationIdentity = {
      organizationId: `org_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      name: params.name,
      createdAt: Date.now(),
      plan: params.plan,
      maxWorkspaces: params.maxWorkspaces ?? 10,
      maxWorkers: params.maxWorkers ?? 50,
      dataResidencyRegion: params.dataResidencyRegion,
    };

    this.organizations.set(org.organizationId, org);
    this.deps.audit?.("organization.registered", {
      organizationId: org.organizationId,
      name: org.name,
      plan: org.plan,
    });

    return org;
  }

  getOrganization(orgId: string): OrganizationIdentity | undefined {
    return this.organizations.get(orgId);
  }

  // ── Tenant Boundaries ────────────────────────────────────────────────

  /**
   * Define a tenant boundary for workspace isolation.
   */
  defineTenantBoundary(boundary: TenantBoundary): void {
    const key = `${boundary.organizationId}:${boundary.workspaceId}`;
    this.tenants.set(key, boundary);

    this.deps.audit?.("tenant.boundary_defined", {
      organizationId: boundary.organizationId,
      workspaceId: boundary.workspaceId,
      isolationLevel: boundary.isolationLevel,
    });
  }

  /**
   * Get the tenant boundary for a workspace.
   */
  getTenantBoundary(organizationId: string, workspaceId: string): TenantBoundary | undefined {
    return this.tenants.get(`${organizationId}:${workspaceId}`);
  }

  /**
   * Check if two workspaces share a tenant boundary.
   */
  areWorkspacesIsolated(org1: string, ws1: string, org2: string, ws2: string): boolean {
    // Different organizations are always isolated
    if (org1 !== org2) return true;

    // Same organization — check boundary
    const b1 = this.getTenantBoundary(org1, ws1);
    const b2 = this.getTenantBoundary(org2, ws2);

    if (!b1 || !b2) return true; // No boundary = assume isolated for safety

    // Check if isolation level prevents cross-access
    if (b1.isolationLevel === "separate_instance" || b2.isolationLevel === "separate_instance") {
      return true;
    }
    if (b1.isolationLevel === "separate_db" || b2.isolationLevel === "separate_db") {
      return true;
    }

    return ws1 !== ws2; // Same org, same level — isolated by workspace ID
  }

  // ── Status ───────────────────────────────────────────────────────────

  getActiveIdentityCount(): number {
    const now = Date.now();
    let count = 0;
    for (const identity of this.identities.values()) {
      if (!identity.revoked && identity.expiresAt > now) {
        count++;
      }
    }
    return count;
  }

  getOrganizationCount(): number {
    return this.organizations.size;
  }
}
