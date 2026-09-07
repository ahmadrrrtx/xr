/**
 * XR Phase 8 — Capability grants (args-hash bound, single-use, TTL).
 *
 * A grant is the ONLY token that authorizes a side-effecting tool / MCP /
 * plugin invocation. Policy mints; the execution choke point verifies
 * argsHash + ttl + scope and consumes the grant (replay = deny).
 *
 * The in-memory registry is process-local with TTL. Durability of the
 * *decision* is the hash-chained audit (`grant.minted` / `grant.mismatch` /
 * `grant.expired` / `grant.replay`). The SQLite `grants_active` table
 * (migration 10) is an optional index, not the enforcement authority.
 */

import { createHash, randomUUID } from "node:crypto";
import type { CapabilityGrant } from "../core/types.ts";
export type { CapabilityGrant };

export const DEFAULT_GRANT_TTL_MS = 60_000;

export type GrantFailCode = "missing" | "mismatch" | "expired" | "replay" | "scope";

export interface GrantCheckOk {
  ok: true;
  grant: CapabilityGrant;
}

export interface GrantCheckFail {
  ok: false;
  code: GrantFailCode;
  reason: string;
}

export type GrantCheck = GrantCheckOk | GrantCheckFail;

interface GrantRecord {
  grant: CapabilityGrant;
  used: boolean;
  consumedAt?: number;
}

const ACTIVE = new Map<string, GrantRecord>();

/** Stable JSON: sorted object keys, recursive. Arrays keep order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function canonicalArgsHash(args: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(args)).digest("hex");
}

export interface MintGrantInput {
  capabilityId: string;
  args: Record<string, unknown>;
  runId?: string;
  taskId?: string;
  agentId?: string;
  scope?: string;
  ttlMs?: number;
  approvalRef?: string;
  constraints?: Record<string, unknown>;
  now?: number;
}

function freezeArgs(args: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(args);
  } catch {
    return JSON.parse(canonicalJson(args)) as Record<string, unknown>;
  }
}

/** Mint a single-use grant bound to a frozen args snapshot. */
export function mintGrant(input: MintGrantInput): CapabilityGrant {
  const frozen = freezeArgs(input.args ?? {});
  const now = input.now ?? Date.now();
  const grant: CapabilityGrant = {
    grantId: `g_${randomUUID()}`,
    capabilityId: input.capabilityId,
    argsHash: canonicalArgsHash(frozen),
    scope: input.scope,
    runId: input.runId,
    taskId: input.taskId,
    agentId: input.agentId,
    issuedBy: "policy-engine",
    issuedAt: now,
    ttlMs: input.ttlMs ?? DEFAULT_GRANT_TTL_MS,
    constraints: input.constraints,
    approvalRef: input.approvalRef,
    decision: "allow",
  };
  ACTIVE.set(grant.grantId, { grant, used: false });
  return grant;
}

function fail(code: GrantFailCode, reason: string): GrantCheckFail {
  return { ok: false, code, reason };
}

/**
 * Bind a grant to *these* args without consuming. Forged grantIds (not in
 * the registry) fail closed. `allowConsumed` lets a wrapper re-check after
 * the loop choke point already consumed.
 */
export function bindGrant(
  grant: CapabilityGrant | undefined,
  args: Record<string, unknown>,
  opts: {
    capabilityId?: string;
    runId?: string;
    allowConsumed?: boolean;
    now?: number;
  } = {},
): GrantCheck {
  if (!grant) return fail("missing", "no capability grant on the execution context");
  const rec = ACTIVE.get(grant.grantId);
  if (!rec) return fail("missing", `grant ${grant.grantId} is not in the registry (forged or expired from memory)`);
  const g = rec.grant;
  const now = opts.now ?? Date.now();
  if (now > g.issuedAt + g.ttlMs) return fail("expired", `grant ${g.grantId} expired (ttl ${g.ttlMs}ms)`);
  if (rec.used && !opts.allowConsumed) return fail("replay", `grant ${g.grantId} has already been consumed`);
  if (canonicalArgsHash(args ?? {}) !== g.argsHash) {
    return fail("mismatch", `grant ${g.grantId} argsHash does not match the invocation arguments`);
  }
  if (opts.capabilityId && g.capabilityId !== opts.capabilityId) {
    return fail("scope", `grant ${g.grantId} is for ${g.capabilityId}, not ${opts.capabilityId}`);
  }
  if (opts.runId && g.runId && g.runId !== opts.runId) {
    return fail("scope", `grant ${g.grantId} is bound to run ${g.runId}, not ${opts.runId}`);
  }
  if (g.decision !== "allow") return fail("scope", `grant ${g.grantId} is not an allow grant`);
  return { ok: true, grant: g };
}

/** Verify + consume (single-use). The execution choke point. */
export function verifyAndConsumeGrant(
  grant: CapabilityGrant | undefined,
  args: Record<string, unknown>,
  opts: { capabilityId?: string; runId?: string; now?: number } = {},
): GrantCheck {
  const bound = bindGrant(grant, args, { ...opts, allowConsumed: false });
  if (!bound.ok) return bound;
  const rec = ACTIVE.get(bound.grant.grantId);
  if (!rec || rec.used) return fail("replay", `grant ${bound.grant.grantId} has already been consumed`);
  rec.used = true;
  rec.consumedAt = opts.now ?? Date.now();
  return { ok: true, grant: bound.grant };
}

export function consumeGrant(grantId: string): boolean {
  const rec = ACTIVE.get(grantId);
  if (!rec || rec.used) return false;
  rec.used = true;
  rec.consumedAt = Date.now();
  return true;
}

/** Drop expired / consumed grants (best-effort hygiene). */
export function sweepGrantRegistry(now: number = Date.now()): number {
  let n = 0;
  for (const [id, rec] of ACTIVE) {
    if (rec.used || now > rec.grant.issuedAt + rec.grant.ttlMs) {
      ACTIVE.delete(id);
      n++;
    }
  }
  return n;
}

/** Test seam. */
export function _resetGrantRegistry(): void {
  ACTIVE.clear();
}

/** Test seam. */
export function _grantRegistrySize(): number {
  return ACTIVE.size;
}
