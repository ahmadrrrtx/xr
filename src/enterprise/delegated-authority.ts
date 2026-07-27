/**
 * XR 6.1 — Delegated Authority Administration
 *
 * Manages enterprise roles, delegated authority chains, approval authority,
 * credential scope, revocation, and audit visibility. Uses existing
 * identity/tenancy foundations from Phase 11 — does NOT create a second
 * identity system.
 */

import { randomUUID } from "node:crypto";
import type {
  EnterpriseRole,
  RoleDefinition,
  DelegatedAuthority,
  AuthorityReview,
  PolicySubject,
} from "./types.ts";
import { ENTERPRISE_BOUNDS } from "./types.ts";
import type { RiskTier } from "../trust/types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Role Definitions
// ═══════════════════════════════════════════════════════════════════════════

export const ENTERPRISE_ROLES: Record<EnterpriseRole, RoleDefinition> = {
  org_owner: {
    role: "org_owner",
    label: "Organization Owner",
    description: "Full administrative control over the organization and all workspaces",
    inherits: [],
    allowedSubjects: [
      "organization.admin", "capability.install", "capability.update", "capability.remove",
      "capability.invoke", "data.export", "data.delete", "audit.view", "audit.export",
      "audit.retention", "worker.create", "worker.drain", "worker.revoke",
      "deployment.place", "deployment.transfer", "credential.create", "credential.read",
      "credential.revoke", "backup.create", "backup.restore", "backup.delete",
      "incident.create", "incident.resolve", "slo.configure", "release.channel",
      "release.rollback", "governance.vote",
    ],
    maxRiskTier: "high",
    canDelegate: true,
    maxDelegationDepth: 3,
    requiresMfa: true,
  },
  org_admin: {
    role: "org_admin",
    label: "Organization Administrator",
    description: "Administrative control over organization settings and workspaces",
    inherits: ["workspace_admin", "capability_manager", "backup_operator", "slo_viewer"],
    allowedSubjects: [
      "organization.admin", "worker.create", "worker.drain", "worker.revoke",
      "data.export", "audit.view", "audit.export", "incident.create", "incident.resolve",
      "release.channel", "release.rollback", "governance.vote",
    ],
    maxRiskTier: "high",
    canDelegate: true,
    maxDelegationDepth: 2,
    requiresMfa: true,
  },
  security_admin: {
    role: "security_admin",
    label: "Security Administrator",
    description: "Manages security policies, incidents, credential lifecycle, and audit integrity",
    inherits: ["audit_viewer", "incident_responder"],
    allowedSubjects: [
      "incident.create", "incident.resolve", "credential.revoke",
      "audit.view", "audit.export", "audit.retention",
      "data.redact", "data.delete", "network.egress", "network.ingress",
      "capability.invoke",
    ],
    maxRiskTier: "high",
    canDelegate: false,
    maxDelegationDepth: 0,
    requiresMfa: true,
  },
  compliance_officer: {
    role: "compliance_officer",
    label: "Compliance Officer",
    description: "Reviews audit records, manages retention, legal holds, and certification evidence",
    inherits: ["audit_viewer"],
    allowedSubjects: [
      "audit.view", "audit.export", "audit.retention",
      "slo.configure",
    ],
    maxRiskTier: "medium",
    canDelegate: false,
    maxDelegationDepth: 0,
    requiresMfa: false,
  },
  workspace_admin: {
    role: "workspace_admin",
    label: "Workspace Administrator",
    description: "Manages a specific workspace, its capabilities, and member access",
    inherits: ["ai_worker"],
    allowedSubjects: [
      "capability.install", "capability.update", "capability.remove",
      "capability.invoke", "data.export", "credential.create",
      "backup.create", "backup.restore",
    ],
    maxRiskTier: "medium",
    canDelegate: true,
    maxDelegationDepth: 1,
    requiresMfa: false,
  },
  audit_viewer: {
    role: "audit_viewer",
    label: "Audit Viewer",
    description: "Read-only access to audit records",
    inherits: [],
    allowedSubjects: ["audit.view", "audit.export"],
    maxRiskTier: "low",
    canDelegate: false,
    maxDelegationDepth: 0,
    requiresMfa: false,
  },
  incident_responder: {
    role: "incident_responder",
    label: "Incident Responder",
    description: "Creates, manages, and resolves security incidents",
    inherits: [],
    allowedSubjects: ["incident.create", "incident.resolve", "credential.revoke", "network.egress"],
    maxRiskTier: "high",
    canDelegate: false,
    maxDelegationDepth: 0,
    requiresMfa: true,
  },
  backup_operator: {
    role: "backup_operator",
    label: "Backup Operator",
    description: "Manages backup creation, restoration, and verification",
    inherits: [],
    allowedSubjects: ["backup.create", "backup.restore", "backup.delete"],
    maxRiskTier: "medium",
    canDelegate: false,
    maxDelegationDepth: 0,
    requiresMfa: false,
  },
  capability_manager: {
    role: "capability_manager",
    label: "Capability Manager",
    description: "Manages capability lifecycle: installation, updates, and supply-chain",
    inherits: [],
    allowedSubjects: [
      "capability.install", "capability.update", "capability.remove",
      "capability.invoke",
    ],
    maxRiskTier: "medium",
    canDelegate: true,
    maxDelegationDepth: 1,
    requiresMfa: false,
  },
  slo_viewer: {
    role: "slo_viewer",
    label: "SLO Viewer",
    description: "Read access to SLO status and operational metrics",
    inherits: [],
    allowedSubjects: ["slo.configure"],
    maxRiskTier: "low",
    canDelegate: false,
    maxDelegationDepth: 0,
    requiresMfa: false,
  },
  release_manager: {
    role: "release_manager",
    label: "Release Manager",
    description: "Manages release channels, migrations, and rollbacks",
    inherits: [],
    allowedSubjects: ["release.channel", "release.rollback"],
    maxRiskTier: "medium",
    canDelegate: false,
    maxDelegationDepth: 0,
    requiresMfa: true,
  },
  ai_worker: {
    role: "ai_worker",
    label: "AI Worker",
    description: "Standard AI worker with task-scoped least privilege",
    inherits: [],
    allowedSubjects: [
      "capability.invoke", "memory.read", "memory.write",
      "model.selection", "deployment.place",
    ],
    maxRiskTier: "medium",
    canDelegate: false,
    maxDelegationDepth: 0,
    requiresMfa: false,
  },
  ai_worker_restricted: {
    role: "ai_worker_restricted",
    label: "AI Worker (Restricted)",
    description: "Restricted AI worker — no network, no write, no credential access",
    inherits: [],
    allowedSubjects: ["memory.read"],
    maxRiskTier: "low",
    canDelegate: false,
    maxDelegationDepth: 0,
    requiresMfa: false,
  },
  readonly_user: {
    role: "readonly_user",
    label: "Read-Only User",
    description: "Can view but not modify any organizational resources",
    inherits: [],
    allowedSubjects: ["audit.view", "slo.configure"],
    maxRiskTier: "low",
    canDelegate: false,
    maxDelegationDepth: 0,
    requiresMfa: false,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Delegated Authority Service
// ═══════════════════════════════════════════════════════════════════════════

export interface DelegatedAuthorityDeps {
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class DelegatedAuthorityService {
  private readonly authorities = new Map<string, DelegatedAuthority>();
  private readonly reviews = new Map<string, AuthorityReview>();
  private readonly deps: DelegatedAuthorityDeps;

  constructor(deps: DelegatedAuthorityDeps = {}) {
    this.deps = deps;
  }

  // ── Role Information ─────────────────────────────────────────────────

  /** Get the definition for an enterprise role. */
  getRoleDefinition(role: EnterpriseRole): RoleDefinition {
    return ENTERPRISE_ROLES[role];
  }

  /** List all defined enterprise roles. */
  listRoles(): RoleDefinition[] {
    return Object.values(ENTERPRISE_ROLES);
  }

  /** Get a user's effective subjects, including all inherited roles. */
  getEffectiveSubjects(role: EnterpriseRole): PolicySubject[] {
    const def = ENTERPRISE_ROLES[role];
    const subjects = new Set(def.allowedSubjects);
    for (const inherited of def.inherits) {
      for (const s of this.getEffectiveSubjects(inherited)) {
        subjects.add(s);
      }
    }
    return Array.from(subjects);
  }

  /** Check if a role can perform a specific subject action. */
  canPerform(role: EnterpriseRole, subject: PolicySubject): boolean {
    return this.getEffectiveSubjects(role).includes(subject);
  }

  // ── Delegation ───────────────────────────────────────────────────────

  /**
   * Delegate authority from one principal to another.
   * Enforces delegation depth limits and scope restrictions.
   */
  delegate(params: {
    granter: string;
    grantee: string;
    role: EnterpriseRole;
    scopedSubjects?: PolicySubject[];
    scopedWorkspaces?: string[];
    scopedCapabilities?: string[];
    maxRiskTier?: RiskTier;
    depth?: number;
    expiresInMs?: number;
    justification: string;
    approvedBy?: string;
  }): { ok: boolean; authority?: DelegatedAuthority; error?: string } {
    const roleDef = ENTERPRISE_ROLES[params.role];

    // Validate delegation is allowed.
    if (!roleDef.canDelegate) {
      return { ok: false, error: `Role ${params.role} cannot delegate authority` };
    }

    const depth = params.depth ?? 0;
    if (depth > roleDef.maxDelegationDepth) {
      return { ok: false, error: `Delegation depth ${depth} exceeds maximum ${roleDef.maxDelegationDepth}` };
    }

    if (depth >= ENTERPRISE_BOUNDS.MAX_DELEGATION_DEPTH) {
      return { ok: false, error: `Maximum delegation depth ${ENTERPRISE_BOUNDS.MAX_DELEGATION_DEPTH} reached` };
    }

    // Validate scoped subjects are within the role's allowed subjects.
    const scopedSubjects = params.scopedSubjects ?? roleDef.allowedSubjects;
    for (const s of scopedSubjects) {
      if (!roleDef.allowedSubjects.includes(s)) {
        return { ok: false, error: `Subject ${s} not allowed for role ${params.role}` };
      }
    }

    const authority: DelegatedAuthority = {
      id: `da_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      granter: params.granter,
      grantee: params.grantee,
      role: params.role,
      scopedSubjects,
      scopedWorkspaces: params.scopedWorkspaces ?? [],
      scopedCapabilities: params.scopedCapabilities ?? [],
      maxRiskTier: params.maxRiskTier ?? roleDef.maxRiskTier,
      depth,
      expiresAt: params.expiresInMs ? Date.now() + params.expiresInMs : undefined,
      grantedAt: Date.now(),
      justification: params.justification,
      approvedBy: params.approvedBy,
    };

    this.authorities.set(authority.id, authority);

    this.deps.audit?.("authority.delegated", {
      id: authority.id,
      granter: params.granter,
      grantee: params.grantee,
      role: params.role,
      depth,
      scopedSubjects: scopedSubjects.length,
    });

    return { ok: true, authority };
  }

  /** Revoke a delegated authority. */
  revoke(id: string, revokedBy: string, reason: string): boolean {
    const authority = this.authorities.get(id);
    if (!authority) return false;
    if (authority.revokedAt) return false; // Already revoked.

    const revoked: DelegatedAuthority = { ...authority, revokedAt: Date.now() };
    this.authorities.set(id, revoked);

    this.deps.audit?.("authority.revoked", {
      id,
      grantee: authority.grantee,
      role: authority.role,
      by: revokedBy,
      reason,
    });

    return true;
  }

  /** Get all authorities for a grantee (active only). */
  getAuthoritiesFor(grantee: string): DelegatedAuthority[] {
    const now = Date.now();
    return Array.from(this.authorities.values()).filter(a =>
      a.grantee === grantee &&
      !a.revokedAt &&
      (!a.expiresAt || a.expiresAt > now)
    );
  }

  /** Get all authorities granted by a granter. */
  getAuthoritiesBy(granter: string): DelegatedAuthority[] {
    return Array.from(this.authorities.values()).filter(a => a.granter === granter);
  }

  /** Check if a grantee has a specific authority (active, unexpired, not revoked). */
  hasAuthority(grantee: string, subject: PolicySubject, workspaceId?: string): boolean {
    const now = Date.now();
    for (const a of this.authorities.values()) {
      if (a.grantee !== grantee) continue;
      if (a.revokedAt) continue;
      if (a.expiresAt && a.expiresAt < now) continue;
      if (!a.scopedSubjects.includes(subject)) continue;
      if (workspaceId && a.scopedWorkspaces.length > 0 && !a.scopedWorkspaces.includes(workspaceId)) continue;
      return true;
    }
    return false;
  }

  /** List all delegated authorities (active or all). */
  listAuthorities(activeOnly = true): DelegatedAuthority[] {
    const all = Array.from(this.authorities.values());
    if (!activeOnly) return all;
    const now = Date.now();
    return all.filter(a => !a.revokedAt && (!a.expiresAt || a.expiresAt > now));
  }

  /** Clean up expired/revoked authorities older than the given cutoff. */
  cleanupExpired(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    let cleaned = 0;
    for (const [id, a] of this.authorities) {
      if ((a.revokedAt && a.revokedAt < cutoff) || (a.expiresAt && a.expiresAt < cutoff)) {
        this.authorities.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  // ── Authority Reviews ────────────────────────────────────────────────

  /**
   * Record an authority review. Used for periodic access certification.
   */
  recordReview(params: {
    authorityId: string;
    reviewer: string;
    decision: "approved" | "rejected" | "modified";
    reason: string;
    nextReviewInDays?: number;
  }): AuthorityReview {
    const review: AuthorityReview = {
      id: `ar_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      authorityId: params.authorityId,
      reviewer: params.reviewer,
      decision: params.decision,
      reason: params.reason,
      reviewedAt: Date.now(),
      nextReviewDue: Date.now() + (params.nextReviewInDays ?? 90) * 24 * 60 * 60 * 1000,
    };

    this.reviews.set(review.id, review);

    this.deps.audit?.("authority.reviewed", {
      id: review.id,
      authorityId: params.authorityId,
      decision: params.decision,
      reviewer: params.reviewer,
    });

    return review;
  }

  /** Get all reviews for an authority. */
  getReviewsFor(authorityId: string): AuthorityReview[] {
    return Array.from(this.reviews.values())
      .filter(r => r.authorityId === authorityId)
      .sort((a, b) => b.reviewedAt - a.reviewedAt);
  }

  /** Get authorities due for review. */
  getPendingReviews(): Array<{ authority: DelegatedAuthority; lastReview?: AuthorityReview }> {
    const now = Date.now();
    const pending: Array<{ authority: DelegatedAuthority; lastReview?: AuthorityReview }> = [];

    for (const a of this.authorities.values()) {
      if (a.revokedAt) continue;
      const reviews = this.getReviewsFor(a.id);
      const lastReview = reviews[0];
      if (!lastReview || lastReview.nextReviewDue < now) {
        pending.push({ authority: a, lastReview });
      }
    }

    return pending;
  }
}
