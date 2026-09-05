/**
 * XR Phase 7 (F-21) — per-agent memory ACL, enforced at RETRIEVAL.
 *
 * Before this module, memory scopes were advisory: `MemoryStore.recall*` had
 * no notion of WHO was asking, so a worker role could recall anything a
 * `list({scope})` returned. Phase 6 gave every run an `AgentIdentity`; this
 * module is the pure function that turns that identity into a filter.
 *
 * Filter order (plan §4.6, applied for every recall candidate):
 *   1. scope visibility      — already applied by `listMemory({scope})`
 *   2. agent-visibility ACL  — `agent_visibility` role list (this module)
 *   3. trust filter          — quarantined rows never surface as retrieval;
 *                              the quarantine channel is `pending()` / export
 *   4. TTL / lineage         — expired and superseded rows are not current
 *
 * ACL semantics (deterministic, no model, no similarity involved):
 *   · `["*"]`                     visible to every principal (default → the
 *                                 pre-Phase-7 behaviour is preserved exactly)
 *   · `["builder","reviewer"]`    SEQUESTERED: only the listed roles
 *   · principal `"user"`          the human owner sees everything (this is
 *                                 THEIR memory; hiding rows from the owner
 *                                 would be theatre, not security)
 *   · supervisor / synthesizer / memory_manager
 *                                 see every NON-sequestered row; a sequestered
 *                                 row still needs their role listed
 *   · any other role              sees `["*"]` rows and rows listing its role
 *
 * INVARIANT (pinned by test/context/phase7-memory-policy.test.ts): the ACL
 * decides only VISIBILITY. Nothing here — and nothing that imports this —
 * maps a memory field onto a permission, tier, tool grant or trust level.
 * Authority is decided by `policy.ts` / `injection.ts` from provenance and
 * trust status, never from what a memory row says about itself.
 */

import type { RejectionReason } from "../types.ts";
import type { MemoryPrincipal } from "./types.ts";

export type { MemoryPrincipal } from "./types.ts";

/** Roles that coordinate other roles and may read every non-sequestered row. */
export const COORDINATOR_ROLES: ReadonlySet<string> = new Set(["supervisor", "synthesizer", "memory_manager"]);

/** The wildcard: visible to every principal. Also the schema default. */
export const VISIBILITY_ALL = "*";

/** Parse the stored JSON role list. Malformed/empty → `["*"]` (never fail closed on the owner's data). */
export function parseVisibility(raw: unknown): string[] {
  if (Array.isArray(raw)) return normalizeVisibility(raw);
  if (typeof raw !== "string" || !raw.trim()) return [VISIBILITY_ALL];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeVisibility(parsed) : [VISIBILITY_ALL];
  } catch {
    return [VISIBILITY_ALL];
  }
}

/** Trim, drop empties/duplicates; an empty list means "everyone", never "no one". */
export function normalizeVisibility(roles: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const r of roles) {
    if (typeof r !== "string") continue;
    const t = r.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.length ? out : [VISIBILITY_ALL];
}

/** A row is sequestered when its visibility list does not contain the wildcard. */
export function isSequestered(visibility: readonly string[]): boolean {
  return !visibility.includes(VISIBILITY_ALL);
}

export function principalRole(p: MemoryPrincipal): string {
  return p === "user" ? "user" : p.role;
}

/** Stable label for audit rows (never the identity's grant reference). */
export function principalLabel(p: MemoryPrincipal): string {
  return p === "user" ? "user" : `agent:${p.role}/${p.agentId}`;
}

export interface AclDecision {
  visible: boolean;
  reason?: RejectionReason;
  detail: string;
}

/**
 * The ACL check. Pure and total: never throws, never reads anything but the
 * visibility list and the principal.
 */
export function aclDecision(visibility: readonly string[], principal: MemoryPrincipal): AclDecision {
  if (principal === "user") return { visible: true, detail: "owner" };
  const roles = visibility.length ? visibility : [VISIBILITY_ALL];
  if (!isSequestered(roles)) return { visible: true, detail: "visible to all roles" };
  if (roles.includes(principal.role)) return { visible: true, detail: `sequestered; role "${principal.role}" is listed` };
  return {
    visible: false,
    reason: "agent_not_permitted",
    detail: COORDINATOR_ROLES.has(principal.role)
      ? `sequestered to [${roles.join(", ")}]; coordinator "${principal.role}" is not listed`
      : `sequestered to [${roles.join(", ")}]; role "${principal.role}" is not listed`,
  };
}

/** Consent states that may only surface through the quarantine channel (`pending()`), never as recall. */
const QUARANTINE_CONSENT: ReadonlySet<string> = new Set(["quarantined", "proposed", "not_eligible", "revoked", "deleted"]);

export interface RetrievalCandidate {
  agentVisibility?: readonly string[] | null;
  consentState?: string | null;
  trustStatus?: string | null;
  supersededBy?: string | null;
  revokedAt?: number | null;
  expiresAt?: number | null;
}

/**
 * The full retrieval gate for ONE candidate: ACL → trust/quarantine → lineage → TTL.
 * `listMemory` already hides revoked/quarantined rows for the default read
 * path; this re-checks so that no caller (raw rows, inspection lists passed
 * through by mistake) can bypass the gate.
 */
export function retrievalDecision(
  c: RetrievalCandidate,
  principal: MemoryPrincipal,
  now: number = Date.now(),
): AclDecision {
  const acl = aclDecision(c.agentVisibility && c.agentVisibility.length ? c.agentVisibility : [VISIBILITY_ALL], principal);
  if (!acl.visible) return acl;
  if (c.revokedAt) return { visible: false, reason: "revoked", detail: "consent revoked" };
  if (c.consentState && QUARANTINE_CONSENT.has(c.consentState)) {
    return {
      visible: false,
      reason: c.consentState === "quarantined" ? "quarantined" : "consent_not_granted",
      detail: `consent state "${c.consentState}" is not retrievable (quarantine channel only)`,
    };
  }
  if (c.supersededBy) return { visible: false, reason: "lifecycle_externalized", detail: `superseded by ${c.supersededBy}` };
  if (typeof c.expiresAt === "number" && Number.isFinite(c.expiresAt) && c.expiresAt <= now) {
    return { visible: false, reason: "expired", detail: "ttl elapsed" };
  }
  return acl;
}

/**
 * The channel a retrievable hit may occupy. Mirrors `channelFor` in
 * `injection.ts`: untrusted/unknown trust is QUARANTINE — it may be shown
 * (delimited, user-role, never as a directive) but the legacy system-message
 * block drops it, and nothing can promote it. Recall never yields
 * "instruction": retrieved memory is data by construction.
 */
export function recallChannel(trustStatus: string | null | undefined): "data" | "quarantine" {
  return trustStatus === "untrusted_external" || trustStatus === "unknown" || !trustStatus ? "quarantine" : "data";
}

/** Validate a caller-supplied visibility list for a write. Returns the normalized list or a reason. */
export function validateVisibility(
  roles: readonly string[] | undefined,
  knownRoles?: ReadonlySet<string>,
): { ok: true; visibility: string[] } | { ok: false; reason: string } {
  if (roles === undefined) return { ok: true, visibility: [VISIBILITY_ALL] };
  const norm = normalizeVisibility(roles);
  if (norm.length > 16) return { ok: false, reason: "at most 16 roles per visibility list" };
  for (const r of norm) {
    if (r === VISIBILITY_ALL) continue;
    if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(r)) return { ok: false, reason: `invalid role token "${r}"` };
    if (knownRoles && !knownRoles.has(r)) return { ok: false, reason: `unknown role "${r}"` };
  }
  return { ok: true, visibility: norm };
}
