/**
 * Phase 09 — explicit memory scopes.
 *
 * Allowed scopes:
 *   session    — this conversation / execution only (never durable)
 *   workspace  — this workspace's project store (default for IsolatedMemoryStore)
 *   agent      — bound to a named agent role inside the workspace
 *   global     — readable from any project IN THE SAME WORKSPACE
 *
 * Rules:
 *   • Workspace memory MUST NOT become global accidentally.
 *   • Global requires the literal scope token "global" (or GLOBAL_SCOPE).
 *   • Global is NEVER cross-workspace. Separate stores remain the fence.
 *   • Session scope is never persisted to durable user_memory.
 */

import { GLOBAL_SCOPE } from "./memory/types.ts";

export const MEMORY_SCOPE_KINDS = ["session", "workspace", "agent", "global"] as const;
export type MemoryScopeKind = (typeof MEMORY_SCOPE_KINDS)[number];

export interface ParsedMemoryScope {
  kind: MemoryScopeKind;
  /** Workspace / agent / session identifier when the kind carries one. */
  id?: string;
  /** The storage key written to `user_memory.scope` (never invented). */
  storageKey: string;
}

const SESSION_PREFIX = "session:";
const AGENT_PREFIX = "agent:";
const WORKSPACE_PREFIX = "workspace:";

export function isMemoryScopeKind(v: string): v is MemoryScopeKind {
  return (MEMORY_SCOPE_KINDS as readonly string[]).includes(v);
}

/**
 * Parse a stored scope string. Unknown shapes are treated as workspace-scoped
 * project keys — never silently upgraded to global.
 */
export function parseMemoryScope(scope: string | undefined | null): ParsedMemoryScope {
  const raw = (scope ?? "").trim();
  if (!raw) {
    return { kind: "workspace", storageKey: "workspace" };
  }
  if (raw === GLOBAL_SCOPE || raw === "global") {
    return { kind: "global", storageKey: GLOBAL_SCOPE };
  }
  if (raw.startsWith(SESSION_PREFIX)) {
    const id = raw.slice(SESSION_PREFIX.length) || undefined;
    return { kind: "session", ...(id ? { id } : {}), storageKey: raw };
  }
  if (raw.startsWith(AGENT_PREFIX)) {
    const id = raw.slice(AGENT_PREFIX.length) || undefined;
    return { kind: "agent", ...(id ? { id } : {}), storageKey: raw };
  }
  if (raw.startsWith(WORKSPACE_PREFIX)) {
    const id = raw.slice(WORKSPACE_PREFIX.length) || undefined;
    return { kind: "workspace", ...(id ? { id } : {}), storageKey: raw };
  }
  // A bare project key (legacy) stays a workspace-scoped project key.
  return { kind: "workspace", id: raw, storageKey: raw };
}

export interface NormalizeScopeContext {
  /** Default kind when the caller omitted a scope. Never "global". */
  defaultKind?: Exclude<MemoryScopeKind, "global">;
  workspaceId?: string;
  sessionId?: string;
  agentId?: string;
}

/**
 * Normalize a caller-supplied scope.
 *
 * Omitted / empty → workspace (or the requested defaultKind).
 * The only way to get `global` is to pass the literal token.
 */
export function normalizeMemoryScope(
  scope: string | undefined | null,
  ctx: NormalizeScopeContext = {},
): ParsedMemoryScope {
  const raw = (scope ?? "").trim();
  if (!raw) {
    const kind = ctx.defaultKind ?? "workspace";
    if (kind === "session") {
      const key = `${SESSION_PREFIX}${ctx.sessionId ?? "current"}`;
      return { kind: "session", id: ctx.sessionId, storageKey: key };
    }
    if (kind === "agent") {
      const key = `${AGENT_PREFIX}${ctx.agentId ?? "default"}`;
      return { kind: "agent", id: ctx.agentId, storageKey: key };
    }
    const key = ctx.workspaceId ? `${WORKSPACE_PREFIX}${ctx.workspaceId}` : "workspace";
    return { kind: "workspace", id: ctx.workspaceId, storageKey: key };
  }
  return parseMemoryScope(raw);
}

/** True only when the caller explicitly requested global scope. */
export function isExplicitGlobalScope(scope: string | undefined | null): boolean {
  const raw = (scope ?? "").trim();
  return raw === GLOBAL_SCOPE || raw === "global";
}

/** Session-scoped rows must never be written to durable user_memory. */
export function isSessionScope(scope: string | undefined | null): boolean {
  return parseMemoryScope(scope).kind === "session";
}

/**
 * Does this stored row belong to `workspaceId`?
 *
 * Unstamped (legacy) rows are treated as belonging to the store they live in —
 * file isolation is the primary fence. Stamped rows must match exactly.
 */
export function memoryBelongsToWorkspace(
  entry: { workspaceId?: string | null },
  workspaceId: string,
): boolean {
  const stamped = entry.workspaceId;
  if (stamped == null || stamped === "") return true;
  return stamped === workspaceId;
}
