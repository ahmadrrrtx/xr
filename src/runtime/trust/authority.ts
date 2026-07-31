/**
 * XR 4.2 — Task-Scoped Authority Grants
 *
 * An AuthorityGrant is the bounded, time-limited, revocable description of
 * what an execution is allowed to do. It is passed EXPLICITLY into an
 * environment — high-risk execution never inherits ambient host authority.
 *
 * Grants are bound to a specific execution/correlation id and expire. Stale
 * grants (after cancellation, workspace switch, or timeout) are invalid.
 */
import { randomUUID } from "node:crypto";
import {
  TRUST_BOUNDS,
  TRUST_POLICY_VERSION,
  type AuthorityGrant,
  type RiskClassification,
} from "./types.ts";

export interface GrantParams {
  actor: string;
  executionId: string;
  correlationId: string;
  workspaceId: string;
  capability: string;
  approvalRef?: string;
  ttlMs?: number;
}

export function createGrant(req: GrantParams, classification: RiskClassification): AuthorityGrant {
  const now = Date.now();
  const ttl = Math.min(Math.max(req.ttlMs ?? TRUST_BOUNDS.GRANT_TTL_MS, 1000), TRUST_BOUNDS.GRANT_TTL_MS);
  return {
    grantId: `grant_${randomUUID().slice(0, 12)}`,
    actor: req.actor,
    executionId: req.executionId,
    correlationId: req.correlationId,
    workspaceId: req.workspaceId,
    capability: req.capability,
    tier: classification.tier,
    fs: classification.fs,
    net: classification.net,
    proc: classification.proc,
    resources: classification.resources,
    credentials: {
      mode: classification.requiredCredentialMode,
      refs: [],
      envNames: [],
    },
    issuedAt: now,
    expiresAt: now + ttl,
    approvalRef: req.approvalRef,
    policyVersion: TRUST_POLICY_VERSION,
    revoked: false,
  };
}

export interface GrantValidity {
  valid: boolean;
  reason?: string;
}

/** Validate a grant at time `now` against a specific execution + workspace. */
export function validateGrant(
  grant: AuthorityGrant,
  ctx: { executionId: string; workspaceId: string; now?: number },
): GrantValidity {
  const now = ctx.now ?? Date.now();
  if (grant.revoked) return { valid: false, reason: `grant revoked: ${grant.revokedReason ?? "no reason"}` };
  if (now >= grant.expiresAt) return { valid: false, reason: "grant expired" };
  if (grant.executionId !== ctx.executionId) return { valid: false, reason: "grant bound to a different execution" };
  if (grant.workspaceId !== ctx.workspaceId) return { valid: false, reason: "grant bound to a different workspace" };
  return { valid: true };
}

/**
 * In-memory registry of live grants. Supports revocation (cleanup) and
 * stale-authority prevention. Deliberately NOT persisted: grants are
 * ephemeral and must not survive a restart (durable authority is Phase 4+).
 */
export class AuthorityRegistry {
  private readonly grants = new Map<string, AuthorityGrant>();

  register(grant: AuthorityGrant): void {
    this.grants.set(grant.grantId, grant);
  }

  get(grantId: string): AuthorityGrant | undefined {
    return this.grants.get(grantId);
  }

  revoke(grantId: string, reason: string): boolean {
    const g = this.grants.get(grantId);
    if (!g) return false;
    g.revoked = true;
    g.revokedAt = Date.now();
    g.revokedReason = reason;
    return true;
  }

  /** Revoke every grant for a workspace (e.g. on workspace switch). */
  revokeWorkspace(workspaceId: string, reason: string): number {
    let n = 0;
    for (const g of this.grants.values()) {
      if (g.workspaceId === workspaceId && !g.revoked) {
        g.revoked = true;
        g.revokedAt = Date.now();
        g.revokedReason = reason;
        n++;
      }
    }
    return n;
  }

  /** Drop expired/revoked grants (bounded memory). */
  prune(now = Date.now()): number {
    let n = 0;
    for (const [id, g] of this.grants) {
      if (g.revoked || now >= g.expiresAt) {
        this.grants.delete(id);
        n++;
      }
    }
    return n;
  }

  activeCount(): number {
    return this.grants.size;
  }
}
