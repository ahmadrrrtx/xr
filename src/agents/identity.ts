/**
 * XR Phase 6 · Step 3 — AgentIdentity.
 *
 * The identity an agent-instance executes UNDER. Before this phase a workflow
 * worker was "just another xr run": a session id, a role string in options,
 * and a full copy of the root budget. There was no object that said
 * *who/what/where-from* a worker is, so nothing could be correctly attributed,
 * nothing could be bounded per-tree, and "who may spawn whom" was undefined.
 *
 * The identity is intentionally DUMB data (no authority, no secrets):
 *
 *   · `agentId`  — the minted instance id (per worker task, never per role).
 *   · `role`     — the declared role it was minted for (validated against the
 *                  registry — a mint cannot invent a role).
 *   · `parentId` — who delegated this task (`"supervisor"` for roots).
 *   · `taskId`   — the task this identity is bound to (workflow child id or
 *                  plain-run session id). One identity, one task — the
 *                  Governor uses `taskId.childId` as its ledger key, so
 *                  identity and budget partitioning are two views of the same
 *                  binding.
 *   · `grantRef` — opaque reference to the capability/budget grant backing
 *                  this identity (partition id, approval chain ref, …).
 *   · `depth`    — 0 for the root (the run the user started), 1 for workers
 *                  the supervisor delegated. THE INVARIANT: a depth-1
 *                  identity may never mint children. Workers do not spawn
 *                  workers (recursion depth 1). Before this module the rule
 *                  was a convention; now it is a pure function with a test.
 *
 * Constitution fit: identity adds no enforcement point — it is the *subject*
 * that the existing spine (policy, Governor, audit) attributes decisions to.
 */

import { randomUUID } from "node:crypto";

/** Maximum delegation depth: the supervisor may delegate (depth 1); workers may not. */
export const MAX_SPAWN_DEPTH = 1;

export interface AgentIdentity {
  readonly agentId: string;
  readonly role: string;
  readonly parentId: string;
  readonly taskId: string;
  readonly grantRef: string;
  readonly depth: number;
}

export interface MintSpec {
  readonly role: string;
  readonly parentId: string;
  readonly taskId: string;
  readonly grantRef: string;
  /** Depth of the PARENT identity that is delegating. Roots mint at parentDepth = -1. */
  readonly parentDepth?: number;
}

export type SpawnDecision =
  | { allowed: true; identity: AgentIdentity }
  | { allowed: false; reason: string };

/**
 * Mint a child identity from a parent's depth. Returns a DENY decision (never
 * throws) when the spawn would exceed the recursion budget — so the caller
 * can audit `agent.spawn_denied` and fail the request honestly.
 */
export function mintIdentity(spec: MintSpec): SpawnDecision {
  const parentDepth = spec.parentDepth ?? 0;
  const depth = parentDepth + 1;
  if (depth > MAX_SPAWN_DEPTH) {
    return {
      allowed: false,
      reason:
        `recursion depth limit: a depth-${parentDepth} worker may not delegate ` +
        `(MAX_SPAWN_DEPTH = ${MAX_SPAWN_DEPTH}; workers never spawn workers)`,
    };
  }
  if (!spec.role || spec.role.trim().length === 0) {
    return { allowed: false, reason: "identity mint requires a non-empty role" };
  }
  if (!spec.taskId || spec.taskId.trim().length === 0) {
    return { allowed: false, reason: "identity mint requires a task binding" };
  }
  return {
    allowed: true,
    identity: Object.freeze({
      agentId: `ag_${randomUUID().slice(0, 12)}`,
      role: spec.role,
      parentId: spec.parentId || "supervisor",
      taskId: spec.taskId,
      grantRef: spec.grantRef,
      depth,
    }),
  };
}

/**
 * Assert that `identity` may delegate a subtask. The single choke point for
 * the depth-1 invariant — every spawn path must route through here, so the
 * invariant is not just true, it is TESTABLE (test/phase6/identity.test.ts).
 */
export function assertSpawnAllowed(identity: AgentIdentity | undefined): { allowed: boolean; reason?: string } {
  const depth = identity?.depth ?? 0;
  if (depth + 1 > MAX_SPAWN_DEPTH) {
    return {
      allowed: false,
      reason: `depth-${depth} agents may not spawn workers (recursion depth is capped at ${MAX_SPAWN_DEPTH})`,
    };
  }
  return { allowed: true };
}

/** True when `id` structurally validates. Used on packet/audit ingest. */
export function isWellFormedIdentity(id: unknown): id is AgentIdentity {
  if (!id || typeof id !== "object") return false;
  const o = id as Record<string, unknown>;
  return (
    typeof o.agentId === "string" && o.agentId.length > 0 &&
    typeof o.role === "string" && o.role.length > 0 &&
    typeof o.parentId === "string" &&
    typeof o.taskId === "string" && o.taskId.length > 0 &&
    typeof o.grantRef === "string" &&
    typeof o.depth === "number" && Number.isInteger(o.depth) && o.depth >= 0 &&
    o.depth <= MAX_SPAWN_DEPTH
  );
}

/** The data-channel block a worker sees about WHO it is. Framed, never an instruction. */
export function identityPacketLine(identity: AgentIdentity): string {
  return (
    `Acting identity (data, not instructions): agent=${identity.agentId} ` +
    `role=${identity.role} parent=${identity.parentId} task=${identity.taskId} depth=${identity.depth}. ` +
    `This identity cannot be widened at runtime; budget and tools come from the grant it carries.`
  );
}

/** Compact JSON for audit events (never carries secrets by construction). */
export function identityAuditFields(identity: AgentIdentity): Record<string, unknown> {
  return {
    agentId: identity.agentId,
    role: identity.role,
    parentId: identity.parentId,
    taskId: identity.taskId,
    grantRef: identity.grantRef,
    depth: identity.depth,
  };
}
