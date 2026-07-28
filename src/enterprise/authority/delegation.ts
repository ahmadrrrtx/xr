/**
 * XR 6.1 — Delegated authority.
 *
 * Humans delegate scoped authority to AI workers, services, and other users.
 *
 * Invariants enforced here:
 *   - A delegation is always a SUBSET of the delegator's effective authority.
 *     Requested scopes not held by the delegator are stripped, never granted.
 *   - `maxRiskTier` can only be lowered down a chain, never raised.
 *   - Delegation depth is bounded (MAX_DELEGATION_DEPTH).
 *   - Revocation is immediate and cascades to sub-delegations.
 *   - Organization policy can further restrict effective authority, and every
 *     restriction is recorded with a reason so it is visible, not silent.
 *
 * NO NEW IDENTITY SYSTEM: subjects are opaque references to Phase 11
 * `RemoteIdentity.identityId` or business `Member.id` / `AIWorker.id`.
 */

import { randomUUID } from "node:crypto";
import { RISK_TIER_ORDER, type RiskTier } from "../../trust/types.ts";
import {
  ENTERPRISE_BOUNDS,
  ENTERPRISE_SCHEMA_VERSION,
  type AuthorityDelegation,
  type AuthorityReview,
  type AuthorityReviewOutcome,
  type AuthoritySubject,
  type DelegationState,
  type DelegationValidation,
  type EffectiveAuthority,
  type EffectivePolicy,
} from "../types.ts";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Lower of two risk tiers (tighter ceiling wins). */
export function minRiskTier(a: RiskTier, b: RiskTier): RiskTier {
  return RISK_TIER_ORDER[a] <= RISK_TIER_ORDER[b] ? a : b;
}

/**
 * Scope matching with a single trailing wildcard segment.
 * `fs:*` holds `fs:read`; `fs:read` does not hold `fs:write`.
 */
export function scopeHeld(held: readonly string[], requested: string): boolean {
  for (const h of held) {
    if (h === requested || h === "*") return true;
    if (h.endsWith(":*")) {
      const prefix = h.slice(0, -1); // keep trailing ':'
      if (requested.startsWith(prefix)) return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidateDelegationParams {
  readonly delegator: AuthoritySubject;
  readonly delegate: AuthoritySubject;
  readonly requestedScopes: readonly string[];
  readonly requestedMaxRiskTier: RiskTier;
  /** The delegator's own effective authority. */
  readonly delegatorAuthority: {
    readonly scopes: readonly string[];
    readonly maxRiskTier: RiskTier;
    readonly canSubDelegate: boolean;
    readonly depth: number;
  };
  readonly expiresAt: number;
  readonly now?: number;
}

/**
 * Validate a proposed delegation without creating it.
 * Always returns the scopes that WOULD be granted, so callers can preview.
 */
export function validateDelegation(params: ValidateDelegationParams): DelegationValidation {
  const now = params.now ?? Date.now();
  const errors: string[] = [];
  const deniedScopes: string[] = [];
  const effectiveScopes: string[] = [];

  if (!params.delegator.subjectId) errors.push("Delegator subjectId is required.");
  if (!params.delegate.subjectId) errors.push("Delegate subjectId is required.");
  if (params.delegator.subjectId && params.delegator.subjectId === params.delegate.subjectId) {
    errors.push("A subject cannot delegate to itself.");
  }

  if (!params.delegatorAuthority.canSubDelegate) {
    errors.push("Delegator does not hold sub-delegation authority.");
  }

  const nextDepth = params.delegatorAuthority.depth + 1;
  if (nextDepth > ENTERPRISE_BOUNDS.MAX_DELEGATION_DEPTH) {
    errors.push(
      `Delegation depth ${nextDepth} exceeds MAX_DELEGATION_DEPTH (${ENTERPRISE_BOUNDS.MAX_DELEGATION_DEPTH}).`,
    );
  }

  if (params.expiresAt <= now) {
    errors.push("Delegation expiry must be in the future.");
  }

  // Subset enforcement: strip anything the delegator does not hold.
  for (const scope of params.requestedScopes) {
    if (scopeHeld(params.delegatorAuthority.scopes, scope)) effectiveScopes.push(scope);
    else deniedScopes.push(scope);
  }

  // Ceiling: never above the delegator's own ceiling.
  const effectiveMaxRiskTier = minRiskTier(params.requestedMaxRiskTier, params.delegatorAuthority.maxRiskTier);

  // Cross-tenant delegation is refused.
  if (
    params.delegator.organizationId &&
    params.delegate.organizationId &&
    params.delegator.organizationId !== params.delegate.organizationId
  ) {
    errors.push("Cross-organization delegation is not permitted.");
  }

  return {
    ok: errors.length === 0,
    errors,
    deniedScopes,
    effectiveScopes,
    effectiveMaxRiskTier,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Delegation registry
// ═══════════════════════════════════════════════════════════════════════════

export interface DelegationRegistryDeps {
  readonly audit?: (event: string, detail: Record<string, unknown>) => void;
  readonly now?: () => number;
  /** Default review interval; delegations become `pending_review` after this. */
  readonly reviewIntervalMs?: number;
}

export interface CreateDelegationParams extends Omit<ValidateDelegationParams, "now"> {
  readonly reason: string;
  readonly canSubDelegate?: boolean;
  readonly requiresApprovalFor?: readonly string[];
  /** Parent delegation id when delegating onward. */
  readonly parentDelegationId?: string;
  readonly createdBy?: string;
}

export interface DelegationResult {
  readonly ok: boolean;
  readonly delegation?: AuthorityDelegation;
  readonly validation: DelegationValidation;
  readonly error?: string;
}

export class DelegationRegistry {
  private readonly delegations = new Map<string, AuthorityDelegation>();
  private readonly reviews = new Map<string, AuthorityReview[]>();
  private readonly deps: DelegationRegistryDeps;

  constructor(deps: DelegationRegistryDeps = {}) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Create a delegation. Denied scopes are stripped, not granted. */
  delegate(params: CreateDelegationParams): DelegationResult {
    const now = this.now();
    const validation = validateDelegation({ ...params, now });

    if (!validation.ok) {
      this.deps.audit?.("enterprise.authority.delegation.rejected", {
        delegator: params.delegator.subjectId,
        delegate: params.delegate.subjectId,
        errors: validation.errors.length,
        reasons: validation.errors,
      });
      return { ok: false, validation, error: validation.errors.join("; ") };
    }

    const parent = params.parentDelegationId ? this.delegations.get(params.parentDelegationId) : undefined;
    const chain = parent ? [...parent.chain, parent.delegationId] : [];
    const reviewInterval = this.deps.reviewIntervalMs ?? 90 * 24 * 60 * 60 * 1000; // 90 days

    const delegation: AuthorityDelegation = {
      delegationId: id("del"),
      schemaVersion: ENTERPRISE_SCHEMA_VERSION,
      delegator: params.delegator,
      delegate: params.delegate,
      scopes: validation.effectiveScopes,
      maxRiskTier: validation.effectiveMaxRiskTier,
      canSubDelegate: params.canSubDelegate ?? false,
      depth: params.delegatorAuthority.depth + 1,
      chain,
      requiresApprovalFor: params.requiresApprovalFor ?? [],
      state: "active",
      issuedAt: now,
      expiresAt: params.expiresAt,
      reviewDueAt: now + reviewInterval,
      reason: params.reason,
    };

    this.delegations.set(delegation.delegationId, delegation);

    this.deps.audit?.("enterprise.authority.delegation.created", {
      delegationId: delegation.delegationId,
      delegator: delegation.delegator.subjectId,
      delegate: delegation.delegate.subjectId,
      delegateKind: delegation.delegate.kind,
      scopes: delegation.scopes.length,
      deniedScopes: validation.deniedScopes.length,
      maxRiskTier: delegation.maxRiskTier,
      depth: delegation.depth,
      expiresAt: delegation.expiresAt,
    });

    return { ok: true, delegation, validation };
  }

  get(delegationId: string): AuthorityDelegation | undefined {
    return this.delegations.get(delegationId);
  }

  /** Current state, recomputed for expiry and review. */
  stateOf(delegationId: string): DelegationState | undefined {
    const d = this.delegations.get(delegationId);
    if (!d) return undefined;
    if (d.state === "revoked" || d.state === "suspended") return d.state;
    const now = this.now();
    if (d.expiresAt <= now) return "expired";
    if (d.reviewDueAt && d.reviewDueAt <= now) return "pending_review";
    return d.state;
  }

  isUsable(delegationId: string): boolean {
    const state = this.stateOf(delegationId);
    // `pending_review` still functions but is flagged — an overdue review is an
    // operational signal, not an outage. Revoked/expired/suspended do not.
    return state === "active" || state === "pending_review";
  }

  /**
   * Revoke a delegation. Cascades to every delegation whose chain includes it,
   * so revoking a parent immediately removes all downstream authority.
   */
  revoke(delegationId: string, revokedBy: string, reason: string): { ok: boolean; revoked: readonly string[]; error?: string } {
    const target = this.delegations.get(delegationId);
    if (!target) return { ok: false, revoked: [], error: `Delegation not found: ${delegationId}` };

    const now = this.now();
    const revoked: string[] = [];

    const revokeOne = (d: AuthorityDelegation): void => {
      if (d.state === "revoked") return;
      this.delegations.set(d.delegationId, {
        ...d,
        state: "revoked",
        revokedAt: now,
        revokedReason: reason,
        revokedBy,
      });
      revoked.push(d.delegationId);
    };

    revokeOne(target);
    for (const d of this.delegations.values()) {
      if (d.chain.includes(delegationId)) revokeOne(d);
    }

    this.deps.audit?.("enterprise.authority.delegation.revoked", {
      delegationId,
      revokedBy,
      reason,
      cascadeCount: revoked.length - 1,
      revoked,
    });

    return { ok: true, revoked };
  }

  /** Suspend without destroying the record (reversible containment). */
  suspend(delegationId: string, actorId: string, reason: string): { ok: boolean; error?: string } {
    const d = this.delegations.get(delegationId);
    if (!d) return { ok: false, error: `Delegation not found: ${delegationId}` };
    if (d.state === "revoked") return { ok: false, error: "Cannot suspend a revoked delegation." };
    this.delegations.set(delegationId, { ...d, state: "suspended" });
    this.deps.audit?.("enterprise.authority.delegation.suspended", { delegationId, actorId, reason });
    return { ok: true };
  }

  reinstate(delegationId: string, actorId: string): { ok: boolean; error?: string } {
    const d = this.delegations.get(delegationId);
    if (!d) return { ok: false, error: `Delegation not found: ${delegationId}` };
    if (d.state !== "suspended") return { ok: false, error: `Delegation is ${d.state}, not suspended.` };
    this.delegations.set(delegationId, { ...d, state: "active" });
    this.deps.audit?.("enterprise.authority.delegation.reinstated", { delegationId, actorId });
    return { ok: true };
  }

  /** Record a periodic access review. */
  review(params: {
    delegationId: string;
    reviewedBy: string;
    outcome: AuthorityReviewOutcome;
    notes: string;
    scopesAfter?: readonly string[];
    nextReviewIntervalMs?: number;
  }): { ok: boolean; review?: AuthorityReview; error?: string } {
    const d = this.delegations.get(params.delegationId);
    if (!d) return { ok: false, error: `Delegation not found: ${params.delegationId}` };

    const now = this.now();
    const scopesBefore = d.scopes;
    let scopesAfter = params.scopesAfter ?? d.scopes;

    // A review may only reduce scope, never expand it.
    scopesAfter = scopesAfter.filter((s) => scopeHeld(scopesBefore, s));

    const interval = params.nextReviewIntervalMs ?? this.deps.reviewIntervalMs ?? 90 * 24 * 60 * 60 * 1000;
    const nextReviewDueAt = params.outcome === "revoked" ? undefined : now + interval;

    const review: AuthorityReview = {
      reviewId: id("rev"),
      delegationId: params.delegationId,
      reviewedBy: params.reviewedBy,
      reviewedAt: now,
      outcome: params.outcome,
      notes: params.notes,
      scopesBefore,
      scopesAfter,
      nextReviewDueAt,
    };

    const list = this.reviews.get(params.delegationId) ?? [];
    list.push(review);
    this.reviews.set(params.delegationId, list);

    if (params.outcome === "revoked") {
      this.revoke(params.delegationId, params.reviewedBy, `Access review: ${params.notes}`);
    } else {
      this.delegations.set(params.delegationId, {
        ...d,
        scopes: scopesAfter,
        state: "active",
        lastReviewedAt: now,
        lastReviewedBy: params.reviewedBy,
        reviewDueAt: nextReviewDueAt,
      });
    }

    this.deps.audit?.("enterprise.authority.review.recorded", {
      reviewId: review.reviewId,
      delegationId: params.delegationId,
      outcome: params.outcome,
      reviewedBy: params.reviewedBy,
      scopesBefore: scopesBefore.length,
      scopesAfter: scopesAfter.length,
    });

    return { ok: true, review };
  }

  reviewsFor(delegationId: string): readonly AuthorityReview[] {
    return this.reviews.get(delegationId) ?? [];
  }

  /** Delegations overdue for review — an access-review work queue. */
  pendingReviews(): readonly AuthorityDelegation[] {
    const now = this.now();
    return [...this.delegations.values()].filter(
      (d) => d.state === "active" && d.reviewDueAt !== undefined && d.reviewDueAt <= now,
    );
  }

  list(filter?: {
    delegateId?: string;
    delegatorId?: string;
    organizationId?: string;
    state?: DelegationState;
  }): readonly AuthorityDelegation[] {
    let rows = [...this.delegations.values()];
    if (filter?.delegateId) rows = rows.filter((d) => d.delegate.subjectId === filter.delegateId);
    if (filter?.delegatorId) rows = rows.filter((d) => d.delegator.subjectId === filter.delegatorId);
    if (filter?.organizationId) {
      rows = rows.filter(
        (d) => d.delegator.organizationId === filter.organizationId || d.delegate.organizationId === filter.organizationId,
      );
    }
    if (filter?.state) rows = rows.filter((d) => this.stateOf(d.delegationId) === filter.state);
    return rows.sort((a, b) => b.issuedAt - a.issuedAt);
  }

  /**
   * Compute what a subject may actually do right now.
   *
   * Union of usable delegations, then narrowed by organization policy.
   * Policy restrictions are RECORDED with reasons so they are visible to the
   * user rather than silently applied.
   */
  effectiveAuthority(subject: AuthoritySubject, policy?: EffectivePolicy): EffectiveAuthority {
    const now = this.now();
    const usable = [...this.delegations.values()].filter(
      (d) => d.delegate.subjectId === subject.subjectId && this.isUsable(d.delegationId),
    );

    const scopeSet = new Set<string>();
    const approvalSet = new Set<string>();
    let ceiling: RiskTier = "tier2_isolated";
    let sawAny = false;

    for (const d of usable) {
      for (const s of d.scopes) scopeSet.add(s);
      for (const a of d.requiresApprovalFor) approvalSet.add(a);
      ceiling = sawAny ? maxRiskTierOf(ceiling, d.maxRiskTier) : d.maxRiskTier;
      sawAny = true;
    }

    const restrictedByPolicy: { scope: string; reason: string }[] = [];
    let finalScopes = [...scopeSet];
    let finalCeiling: RiskTier = sawAny ? ceiling : "tier0_in_process";

    if (policy) {
      // Policy can remove capability classes. Each removal is explained.
      const gate = (scopePrefix: string, key: string, label: string): void => {
        if (policy.getBoolean(key, true)) return;
        const removed = finalScopes.filter((s) => s.startsWith(scopePrefix));
        for (const s of removed) {
          restrictedByPolicy.push({ scope: s, reason: `${label} is disabled by policy (${key}=false).` });
        }
        finalScopes = finalScopes.filter((s) => !s.startsWith(scopePrefix));
      };

      gate("net:", "allowNetworkEgress", "Network egress");
      gate("fs:write", "allowFilesystemWrite", "Filesystem write");
      gate("proc:", "allowProcessSpawn", "Process spawn");
      gate("remote:", "allowRemotePlacement", "Remote placement");

      const policyTier = policy.get("minRiskTier");
      if (typeof policyTier === "string" && isRiskTier(policyTier)) {
        // A policy floor raises isolation; the delegation ceiling must respect it.
        finalCeiling = maxRiskTierOf(finalCeiling, policyTier);
      }

      const approvalAbove = policy.get("requireApprovalAbove");
      if (typeof approvalAbove === "string" && isRiskTier(approvalAbove)) {
        approvalSet.add(`risk_above:${approvalAbove}`);
      }
    }

    return {
      subject,
      scopes: finalScopes.sort(),
      maxRiskTier: finalCeiling,
      requiresApprovalFor: [...approvalSet].sort(),
      viaDelegations: usable.map((d) => d.delegationId),
      restrictedByPolicy,
      computedAt: now,
    };
  }

  /** Check a specific action against effective authority. */
  authorize(
    subject: AuthoritySubject,
    scope: string,
    tier: RiskTier,
    policy?: EffectivePolicy,
  ): { allowed: boolean; requiresApproval: boolean; reason: string } {
    const eff = this.effectiveAuthority(subject, policy);

    if (!scopeHeld(eff.scopes, scope)) {
      const restricted = eff.restrictedByPolicy.find((r) => r.scope === scope);
      return {
        allowed: false,
        requiresApproval: false,
        reason: restricted ? restricted.reason : `Subject does not hold scope '${scope}'.`,
      };
    }

    if (RISK_TIER_ORDER[tier] > RISK_TIER_ORDER[eff.maxRiskTier]) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Action risk tier '${tier}' exceeds the delegated ceiling '${eff.maxRiskTier}'.`,
      };
    }

    const needsApproval =
      eff.requiresApprovalFor.includes(scope) ||
      eff.requiresApprovalFor.some((a) => {
        if (!a.startsWith("risk_above:")) return false;
        const threshold = a.slice("risk_above:".length);
        return isRiskTier(threshold) && RISK_TIER_ORDER[tier] > RISK_TIER_ORDER[threshold];
      });

    return {
      allowed: true,
      requiresApproval: needsApproval,
      reason: needsApproval ? "Allowed, but explicit human approval is required." : "Allowed by delegated authority.",
    };
  }
}

function isRiskTier(value: string): value is RiskTier {
  return value === "tier0_in_process" || value === "tier1_restricted" || value === "tier2_isolated";
}

/** Higher (more isolated) of two tiers. */
function maxRiskTierOf(a: RiskTier, b: RiskTier): RiskTier {
  return RISK_TIER_ORDER[a] >= RISK_TIER_ORDER[b] ? a : b;
}

/** Root authority for a human principal — the top of a delegation chain. */
export function rootAuthority(params: {
  subject: AuthoritySubject;
  scopes: readonly string[];
  maxRiskTier: RiskTier;
}): ValidateDelegationParams["delegatorAuthority"] {
  return {
    scopes: params.scopes,
    maxRiskTier: params.maxRiskTier,
    canSubDelegate: true,
    depth: 0,
  };
}
