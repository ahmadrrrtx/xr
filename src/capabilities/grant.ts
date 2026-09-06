/**
 * XR Phase 8 · Step 1 — CAPABILITY GRANTS (args-bound, single-use).
 *
 * ── The hole this closes ────────────────────────────────────────────────────
 *
 * Before this module, an authorization DECISION was a value returned by
 * `evaluatePolicy` and consumed by the caller in the same breath. Nothing
 * travelled with the call. The executor received `args` a second time and had
 * no way to know whether they were the same `args` the policy inspected —
 * classic TOCTOU. Both audits asked for "capability tokens"; this is the
 * minimal honest version of that.
 *
 * A GRANT is the artifact that makes the check and the execution the same
 * event:
 *
 *   policy says "allow"  ⇒  mint a grant that BINDS
 *        · the capability id           (you may not swap the tool)
 *        · sha256 of the canonical args (you may not swap the arguments)
 *        · the run/task/agent identity  (P6 — who is acting)
 *        · a short TTL (default 60 s)   (a decision is not a standing right)
 *        · single use                   (no replay onto a second call)
 *
 *   the execution boundary presents {grantId, args} and the runtime
 *   re-derives the hash. Mismatch ⇒ DENY + `grant.mismatch` in the audit
 *   chain. There is no path where "policy saw X, executor ran Y" is silent.
 *
 * ── Deliberate design limits (stated, not hidden) ───────────────────────────
 *
 *  · The registry is PROCESS-LOCAL and in-memory. A grant is a within-call
 *    artifact whose whole life is measured in milliseconds; persisting it
 *    would create a second durable authority for something the audit chain
 *    already records (`grant.minted` / `grant.consumed` are chain entries —
 *    the plan's "no new table" requirement). A cross-process grant would also
 *    be a replay surface, which is exactly what single-use exists to prevent.
 *  · The grant is NOT a bearer token in the security sense: holding a grant id
 *    conveys nothing without also presenting the exact args it was minted for.
 *    Its job is integrity (binding), not secrecy.
 *  · `argsHash` is computed over a RECURSIVELY key-sorted JSON canonical form,
 *    so `{a:1,b:2}` and `{b:2,a:1}` bind identically (M-09's key-order defect
 *    is not re-introduced here) while `{a:1}` vs `{a:2}` do not.
 */

import { createHash, randomUUID } from "node:crypto";
import type { CapabilityScope } from "./types.ts";

/** Default grant lifetime. A decision is a moment, not a standing right. */
export const DEFAULT_GRANT_TTL_MS = 60_000;

/** Upper bound on any caller-supplied TTL (defence against a silly config). */
export const MAX_GRANT_TTL_MS = 600_000;

export type GrantDenyReason =
  | "unknown_grant"
  | "already_consumed"
  | "expired"
  | "args_mismatch"
  | "capability_mismatch"
  | "scope_mismatch";

export interface CapabilityGrant {
  readonly grantId: string;
  readonly capabilityId: string;
  /** sha256 of the canonical argument form this grant is bound to. */
  readonly argsHash: string;
  readonly scope?: CapabilityScope;
  readonly runId?: string;
  readonly taskId?: string;
  /** P6 identity the action executes under. */
  readonly agentId?: string;
  readonly issuedBy: "policy-engine";
  readonly issuedAt: number;
  readonly ttlMs: number;
  /** Free-form policy constraints carried for the audit record. */
  readonly constraints: Readonly<Record<string, unknown>>;
  /** Approval record id when the decision required human consent. */
  readonly approvalRef?: string;
  readonly decision: "allow";
}

export interface GrantMintSpec {
  capabilityId: string;
  args: Record<string, unknown>;
  scope?: CapabilityScope;
  runId?: string;
  taskId?: string;
  agentId?: string;
  ttlMs?: number;
  constraints?: Record<string, unknown>;
  approvalRef?: string;
}

export type GrantVerification =
  | { ok: true; grant: CapabilityGrant }
  | { ok: false; reason: GrantDenyReason; detail: string };

/**
 * Canonical JSON: object keys sorted at EVERY depth, arrays order-preserved
 * (order is meaning in an argument list), `undefined` normalised to null so
 * `{a: undefined}` and `{}` cannot collide into different hashes by accident
 * of serialization.
 *
 * Cycles are impossible in tool args that arrived as JSON, but a caller could
 * hand us a live object; we fail closed by throwing rather than hashing a
 * truncated view of the arguments.
 */
export function canonicalize(value: unknown, seen = new Set<unknown>()): unknown {
  if (value === null || typeof value !== "object") {
    return value === undefined ? null : value;
  }
  if (seen.has(value)) throw new Error("cannot canonicalize a cyclic argument object");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => canonicalize(v, seen));
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key], seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** sha256 over the canonical argument form. The binding primitive. */
export function argsHash(args: Record<string, unknown> | undefined): string {
  const canonical = JSON.stringify(canonicalize(args ?? {}));
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/**
 * The process-local grant registry.
 *
 * Exposed as a class (not a module singleton only) so tests and future
 * multi-tenant embeddings can hold an isolated registry; `grants` below is the
 * default instance the runtime wires.
 */
export class GrantRegistry {
  private active = new Map<string, CapabilityGrant>();
  /** grantId → consumption timestamp. Bounded: pruned with the active map. */
  private consumed = new Map<string, number>();

  /**
   * Mint a grant. Called by the policy engine ONLY on an allow decision —
   * there is deliberately no "deny grant": a denial produces no artifact,
   * because an artifact is authority.
   */
  mint(spec: GrantMintSpec): CapabilityGrant {
    this.prune();
    const ttlMs = Math.min(Math.max(1, spec.ttlMs ?? DEFAULT_GRANT_TTL_MS), MAX_GRANT_TTL_MS);
    const grant: CapabilityGrant = Object.freeze({
      grantId: `gr_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      capabilityId: spec.capabilityId,
      argsHash: argsHash(spec.args),
      scope: spec.scope,
      runId: spec.runId,
      taskId: spec.taskId,
      agentId: spec.agentId,
      issuedBy: "policy-engine" as const,
      issuedAt: Date.now(),
      ttlMs,
      constraints: Object.freeze({ ...(spec.constraints ?? {}) }),
      approvalRef: spec.approvalRef,
      decision: "allow" as const,
    });
    this.active.set(grant.grantId, grant);
    return grant;
  }

  /** Non-consuming inspection (status surfaces, tests). */
  peek(grantId: string): CapabilityGrant | undefined {
    return this.active.get(grantId);
  }

  /**
   * Verify AND consume. Single-use is enforced here rather than by the caller,
   * because "remember to burn the grant" is exactly the kind of discipline a
   * security boundary must not depend on.
   *
   * Every failure mode is distinct so the audit record can say WHICH invariant
   * the call violated — "denied" without a reason is not evidence.
   */
  verifyAndConsume(
    grantId: string | undefined,
    presented: { capabilityId: string; args: Record<string, unknown>; scope?: CapabilityScope },
    now = Date.now(),
  ): GrantVerification {
    if (!grantId) {
      return { ok: false, reason: "unknown_grant", detail: "no grant presented at the execution boundary" };
    }
    const grant = this.active.get(grantId);
    if (!grant) {
      const consumedAt = this.consumed.get(grantId);
      if (consumedAt !== undefined) {
        return {
          ok: false,
          reason: "already_consumed",
          detail: `grant ${grantId} was already used at ${new Date(consumedAt).toISOString()} (single-use; replay refused)`,
        };
      }
      return { ok: false, reason: "unknown_grant", detail: `grant ${grantId} is not an active grant` };
    }

    if (now - grant.issuedAt > grant.ttlMs) {
      this.active.delete(grantId);
      this.consumed.set(grantId, now);
      return {
        ok: false,
        reason: "expired",
        detail: `grant ${grantId} expired ${now - grant.issuedAt - grant.ttlMs}ms ago (ttl ${grant.ttlMs}ms)`,
      };
    }

    if (grant.capabilityId !== presented.capabilityId) {
      return {
        ok: false,
        reason: "capability_mismatch",
        detail: `grant ${grantId} was minted for "${grant.capabilityId}" but presented for "${presented.capabilityId}"`,
      };
    }

    if (grant.scope !== undefined && presented.scope !== undefined && grant.scope !== presented.scope) {
      return {
        ok: false,
        reason: "scope_mismatch",
        detail: `grant ${grantId} is scoped "${grant.scope}" but was presented at scope "${presented.scope}"`,
      };
    }

    const presentedHash = argsHash(presented.args);
    if (presentedHash !== grant.argsHash) {
      // NOT consumed: a mismatch is an attack signal, and burning the grant
      // here would let a mutated call deny the legitimate one that follows.
      return {
        ok: false,
        reason: "args_mismatch",
        detail: `arguments do not match the grant binding (granted ${grant.argsHash.slice(0, 23)}…, presented ${presentedHash.slice(0, 23)}…)`,
      };
    }

    this.active.delete(grantId);
    this.consumed.set(grantId, now);
    return { ok: true, grant };
  }

  /** Drop a grant without using it (denied approval, aborted call). */
  revoke(grantId: string): boolean {
    return this.active.delete(grantId);
  }

  /** Active (unused, unexpired) grant count — status/observability only. */
  activeCount(now = Date.now()): number {
    this.prune(now);
    return this.active.size;
  }

  /** Test seam. */
  clear(): void {
    this.active.clear();
    this.consumed.clear();
  }

  /**
   * Drop expired grants and age out the consumed-id ledger.
   *
   * The consumed ledger exists so a REPLAY can be reported as a replay rather
   * than as an "unknown grant". It is bounded two ways: by time (entries older
   * than the replay window are forgotten) and by count (a hard cap, so a
   * long-lived daemon executing millions of tool calls cannot grow it without
   * limit). Both bounds only ever downgrade a replay report to "unknown
   * grant" — never upgrade a denial into an allow.
   */
  private prune(now = Date.now()): void {
    for (const [id, g] of this.active) {
      if (now - g.issuedAt > g.ttlMs) {
        this.active.delete(id);
        this.consumed.set(id, now);
      }
    }
    const REPLAY_MEMORY_MS = MAX_GRANT_TTL_MS * 2;
    for (const [id, at] of this.consumed) {
      if (now - at > REPLAY_MEMORY_MS) this.consumed.delete(id);
    }
    const CAP = 10_000;
    if (this.consumed.size > CAP) {
      const excess = this.consumed.size - CAP;
      let dropped = 0;
      for (const id of this.consumed.keys()) {
        this.consumed.delete(id);
        if (++dropped >= excess) break;
      }
    }
  }
}

/** The runtime's grant registry. */
export const grants = new GrantRegistry();

/**
 * Audit-safe projection of a grant. Arguments are NEVER included (they are
 * bound by hash precisely so the chain does not have to carry them), and the
 * hash is truncated the way every other digest in the audit vocabulary is.
 */
export function grantAuditFields(grant: CapabilityGrant): Record<string, unknown> {
  return {
    grantId: grant.grantId,
    capabilityId: grant.capabilityId,
    argsHash: grant.argsHash.slice(0, 23),
    scope: grant.scope,
    runId: grant.runId,
    taskId: grant.taskId,
    agentId: grant.agentId,
    issuedBy: grant.issuedBy,
    issuedAt: grant.issuedAt,
    ttlMs: grant.ttlMs,
    approvalRef: grant.approvalRef,
    decision: grant.decision,
  };
}
