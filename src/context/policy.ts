/**
 * XR 4.5 — Context Policy: the deterministic authorization gate.
 *
 * This module answers exactly one question, with no model involvement:
 *
 *   "May THIS requester see THIS item, in THIS tier, right now?"
 *
 * Rules (§9.1):
 *   • Authorization is applied BEFORE semantic ranking. An unauthorized item is
 *     never scored, never considered, never injected — regardless of relevance.
 *   • Every denial has a typed reason and leaks no content.
 *   • Failure is CLOSED. An unrecognised state denies.
 *
 * This module never imports a store, a provider, or UI code so it stays
 * trivially testable and cannot be bypassed by a side effect.
 */

import {
  CONTEXT_BOUNDS,
  TIER_POLICIES,
  consentAllowsRetrieval,
  consentIsTerminal,
  defaultRedaction,
  defaultTierForType,
  freshnessBlocksRetrieval,
  trustRank,
  type ActorKind,
  type ContextGrant,
  type ContextItem,
  type ContextScope,
  type ContextTier,
  type ContextType,
  type RejectionReason,
  type RedactionPolicy,
} from "./types.ts";

// ── Grant construction ─────────────────────────────────────────────────────

export interface GrantRequest {
  requester: { kind: ActorKind; id: string; role?: string };
  scope: ContextScope;
  /** Tiers the caller would like. Policy may only NARROW this, never widen. */
  requestedTiers?: readonly ContextTier[];
  /** Caller-declared intent to write memory. Policy decides. */
  wantsMemoryWrite?: boolean;
  maxItems?: number;
  maxChars?: number;
  redact?: Partial<RedactionPolicy>;
  /** Audit correlation id. */
  auditRef?: string;
  now?: number;
}

/**
 * Baseline tiers per actor kind. This is the CEILING — a caller can ask for
 * fewer tiers but never more (§9.9: no agent receives broad memory merely
 * because it is part of a workflow).
 */
const ACTOR_TIER_CEILING: Record<ActorKind, readonly ContextTier[]> = {
  // The human operator's own session: everything they own.
  user: [
    "immediate",
    "recent",
    "task_summary",
    "project_knowledge",
    "long_term_memory",
    "evidence",
    "artifacts",
    "instructions",
  ],
  // The primary agent acting for the user.
  agent: [
    "immediate",
    "recent",
    "task_summary",
    "project_knowledge",
    "long_term_memory",
    "evidence",
    "artifacts",
    "instructions",
  ],
  // XR itself (maintenance, doctor, compaction).
  system: [
    "immediate",
    "recent",
    "task_summary",
    "project_knowledge",
    "long_term_memory",
    "evidence",
    "artifacts",
    "instructions",
  ],
  // Third-party code: project knowledge + evidence only. Never memory,
  // never instructions, never artifacts.
  plugin: ["project_knowledge", "evidence"],
  mcp: ["project_knowledge", "evidence"],
  // A model is never a requester of privileged context.
  model: ["immediate"],
  unknown: [],
};

/**
 * Per-agent-role tier ceilings, mirroring the declared `MemoryScope` kinds in
 * `src/agents/types.ts`. Phase 6 makes these ENFORCED rather than declarative.
 */
const AGENT_ROLE_TIERS: Record<string, readonly ContextTier[]> = {
  // MemoryScope kind "none" — no context beyond the immediate step.
  none: ["immediate"],
  // kind "workflow" — task context, no user memory.
  workflow: ["immediate", "recent", "task_summary", "instructions"],
  // kind "project" — project knowledge and artifacts, no user memory.
  project: ["immediate", "recent", "task_summary", "project_knowledge", "artifacts", "instructions"],
  // kind "research" — evidence-centric, no user memory.
  research: ["immediate", "recent", "task_summary", "evidence", "artifacts", "instructions"],
  // kind "user" — full access including long-term memory.
  user: [
    "immediate",
    "recent",
    "task_summary",
    "project_knowledge",
    "long_term_memory",
    "evidence",
    "artifacts",
    "instructions",
  ],
};

/** Actor kinds permitted to create durable memory directly. */
const MEMORY_WRITE_ALLOWED: ReadonlySet<ActorKind> = new Set<ActorKind>(["user", "system"]);

/**
 * Build a context grant. The returned grant is the ONLY thing retrieval trusts.
 *
 * `memoryScopeKind` maps a declared agent MemoryScope onto enforced tiers.
 */
export function buildGrant(
  req: GrantRequest,
  opts: { memoryScopeKind?: string; includeUserMemory?: boolean } = {},
): ContextGrant {
  const now = req.now ?? Date.now();

  // 1. Start from the actor ceiling.
  let allowed: ContextTier[] = [...(ACTOR_TIER_CEILING[req.requester.kind] ?? [])];

  // 2. Narrow by the agent's declared memory scope, when one applies.
  if (req.requester.kind === "agent" && opts.memoryScopeKind) {
    const roleTiers = AGENT_ROLE_TIERS[opts.memoryScopeKind];
    if (roleTiers) {
      allowed = allowed.filter((t) => roleTiers.includes(t));
    } else {
      // Unknown scope kind → fail closed to the most restrictive profile.
      allowed = allowed.filter((t) => AGENT_ROLE_TIERS.none.includes(t));
    }
    // `includeUserMemory:false` is a hard subtraction even if the kind allows it.
    if (opts.includeUserMemory === false) {
      allowed = allowed.filter((t) => t !== "long_term_memory");
    }
  }

  // 3. Narrow by what the caller actually requested (never widen).
  if (req.requestedTiers) {
    const wanted = new Set(req.requestedTiers);
    allowed = allowed.filter((t) => wanted.has(t));
  }

  // 4. Memory write authority is independent of read tiers.
  const allowMemoryWrite = Boolean(req.wantsMemoryWrite) && MEMORY_WRITE_ALLOWED.has(req.requester.kind);

  const redact: RedactionPolicy = { ...defaultRedaction(), ...(req.redact ?? {}) };
  // Third-party code never sees private data, only public/internal.
  if (req.requester.kind === "plugin" || req.requester.kind === "mcp") {
    redact.dropSensitivity = ["secret", "private"];
  }

  return {
    requester: { ...req.requester },
    scope: { ...req.scope },
    allowedTiers: allowed,
    allowMemoryWrite,
    maxItems: Math.min(req.maxItems ?? CONTEXT_BOUNDS.maxPackageItems, CONTEXT_BOUNDS.maxPackageItems),
    maxChars: Math.min(req.maxChars ?? CONTEXT_BOUNDS.maxPackageChars, CONTEXT_BOUNDS.maxPackageChars),
    redact,
    expiresAt: now + CONTEXT_BOUNDS.grantTtlMs,
    auditRef: req.auditRef ?? `grant_${now.toString(36)}`,
  };
}

/** A grant that permits nothing. Used when memory is disabled or trust denies. */
export function denyAllGrant(req: GrantRequest): ContextGrant {
  const now = req.now ?? Date.now();
  return {
    requester: { ...req.requester },
    scope: { ...req.scope },
    allowedTiers: [],
    allowMemoryWrite: false,
    maxItems: 0,
    maxChars: 0,
    redact: defaultRedaction(),
    expiresAt: now,
    auditRef: req.auditRef ?? `grant_denied_${now.toString(36)}`,
  };
}

// ── Authorization decision ─────────────────────────────────────────────────

export type AuthDecision =
  | { allowed: true; tier: ContextTier; reason: string }
  | { allowed: false; reason: RejectionReason; detail: string };

/**
 * THE gate. Deterministic, ordered, fail-closed.
 *
 * Order matters: the cheapest and most absolute fences run first so an
 * unauthorized item is rejected before any expensive work happens.
 */
export function authorize(
  item: ContextItem,
  grant: ContextGrant,
  opts: { tier?: ContextTier; now?: number } = {},
): AuthDecision {
  const now = opts.now ?? Date.now();

  // 0. Grant validity.
  if (grant.expiresAt <= now) {
    return { allowed: false, reason: "tier_not_granted", detail: "context grant expired" };
  }
  if (grant.allowedTiers.length === 0) {
    return { allowed: false, reason: "tier_not_granted", detail: "grant permits no tiers" };
  }

  // 1. Workspace fence — absolute, first, no exceptions.
  if (item.scope.workspaceId !== grant.scope.workspaceId) {
    return {
      allowed: false,
      reason: "workspace_mismatch",
      detail: "item belongs to a different workspace",
    };
  }

  // 2. Lifecycle fences.
  if (item.deletedAt) {
    return { allowed: false, reason: "deleted", detail: "item is deleted" };
  }
  if (item.revokedAt || consentIsTerminal(item.consentState)) {
    return { allowed: false, reason: "revoked", detail: "consent was revoked" };
  }
  if (item.consentState === "quarantined") {
    return { allowed: false, reason: "quarantined", detail: "item is quarantined pending review" };
  }
  if (!consentAllowsRetrieval(item.consentState)) {
    return {
      allowed: false,
      reason: "consent_not_granted",
      detail: `consent state "${item.consentState}" does not permit retrieval`,
    };
  }

  // 3. Freshness fence — hard expiry only; "stale" is reported, not blocked.
  if (freshnessBlocksRetrieval(item.freshness.label)) {
    return { allowed: false, reason: "expired", detail: "item is past hard expiry" };
  }

  // 4. Project scope. "global" is readable from any project in the workspace;
  //    a project-scoped item is readable only from that project.
  const itemProject = item.scope.projectScope;
  const grantProject = grant.scope.projectScope;
  if (itemProject !== "global" && itemProject !== grantProject) {
    return {
      allowed: false,
      reason: "project_scope_mismatch",
      detail: "item belongs to a different project scope",
    };
  }

  // 5. User fence — when the item names an owner, the grant must match.
  if (item.scope.userId && grant.scope.userId && item.scope.userId !== grant.scope.userId) {
    return { allowed: false, reason: "user_mismatch", detail: "item belongs to a different user" };
  }

  // 6. Task fence — a task-bound item is only visible inside that task.
  if (item.scope.taskId && item.scope.taskId !== grant.scope.taskId) {
    return {
      allowed: false,
      reason: "task_scope_mismatch",
      detail: "item is bound to a different task",
    };
  }

  // 7. Agent fence — an agent-bound item is only visible to that agent.
  if (item.scope.agentId && item.scope.agentId !== grant.scope.agentId) {
    return {
      allowed: false,
      reason: "agent_not_permitted",
      detail: "item is bound to a different agent",
    };
  }

  // 8. Tier resolution + grant check.
  const tier = opts.tier ?? defaultTierForType(item.type);
  if (!grant.allowedTiers.includes(tier)) {
    return {
      allowed: false,
      reason: "tier_not_granted",
      detail: `tier "${tier}" is not in this grant`,
    };
  }

  // 9. Tier type compatibility.
  const policy = TIER_POLICIES[tier];
  if (!policy) {
    return { allowed: false, reason: "tier_not_granted", detail: "unknown tier" };
  }
  if (!policy.allowedTypes.includes(item.type)) {
    return {
      allowed: false,
      reason: "type_not_allowed_in_tier",
      detail: `type "${item.type}" may not occupy tier "${tier}"`,
    };
  }

  // 10. Tier trust ceiling — an item may not present with more trust than its
  //     tier permits. This is what stops untrusted text reaching `instructions`.
  if (trustRank(item.trustStatus) > trustRank(policy.maxTrust)) {
    return {
      allowed: false,
      reason: "trust_not_permitted_in_tier",
      detail: `trust "${item.trustStatus}" exceeds tier ceiling "${policy.maxTrust}"`,
    };
  }

  // 11. Tier freshness exclusions.
  if (policy.excludeFreshness.includes(item.freshness.label)) {
    return {
      allowed: false,
      reason: "expired",
      detail: `freshness "${item.freshness.label}" excluded by tier policy`,
    };
  }

  // 12. Sensitivity redaction — drop entirely when the grant forbids the level.
  if (grant.redact.dropSensitivity.includes(item.sensitivity)) {
    return {
      allowed: false,
      reason: "consent_not_granted",
      detail: `sensitivity "${item.sensitivity}" is not shareable with this requester`,
    };
  }

  return {
    allowed: true,
    tier,
    reason: `scope ${itemProject}/${item.scope.workspaceId} · tier ${tier} · consent ${item.consentState}`,
  };
}

/**
 * Can this requester write durable memory of this type?
 * Deterministic; a plugin can propose but never approve.
 */
export function authorizeWrite(
  grant: ContextGrant,
  type: ContextType,
): { allowed: boolean; requiresConsent: boolean; reason: string } {
  // Instructions are never created by a context write path.
  if (type === "instruction") {
    return {
      allowed: false,
      requiresConsent: false,
      reason: "instructions cannot be created through the context write path",
    };
  }

  if (type === "memory") {
    if (grant.allowMemoryWrite) {
      return { allowed: true, requiresConsent: true, reason: "memory write requires explicit consent" };
    }
    // Everything else may only PROPOSE — it lands as `proposed`, not `approved`.
    return {
      allowed: true,
      requiresConsent: true,
      reason: "requester may only propose memory; user consent is required to approve",
    };
  }

  // Non-memory context (knowledge/evidence/artifact/task/untrusted) may be
  // recorded without user consent — it is not presented as user memory (§9.2).
  return { allowed: true, requiresConsent: false, reason: "non-memory context does not require user consent" };
}

// ── Scope helpers ──────────────────────────────────────────────────────────

/** Do two scopes describe the same workspace? */
export function sameWorkspace(a: ContextScope, b: ContextScope): boolean {
  return a.workspaceId === b.workspaceId;
}

/** Build a scope, filling defaults explicitly (never implicitly global). */
export function makeScope(input: {
  workspaceId: string;
  projectScope: string;
  userId?: string;
  taskId?: string;
  agentId?: string;
}): ContextScope {
  return {
    workspaceId: input.workspaceId,
    projectScope: input.projectScope,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
  };
}

/** The tier ceiling for an actor kind — exported for docs/tests/inspection. */
export function tierCeilingFor(kind: ActorKind): readonly ContextTier[] {
  return ACTOR_TIER_CEILING[kind] ?? [];
}

/** The enforced tiers for a declared agent memory-scope kind. */
export function tiersForMemoryScopeKind(kind: string): readonly ContextTier[] {
  return AGENT_ROLE_TIERS[kind] ?? AGENT_ROLE_TIERS.none;
}
