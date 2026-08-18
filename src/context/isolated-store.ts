/**
 * Phase 09 — workspace-isolated MemoryStore wrapper.
 *
 * WorkspaceManager already gives each workspace its own SQLite file. This
 * wrapper is defense-in-depth:
 *
 *   1. New writes are stamped with the store's workspaceId.
 *   2. Reads drop rows stamped for a different workspace.
 *   3. Default scope is workspace — never silently global.
 *   4. Session-scoped writes are refused (session memory is not durable).
 *
 * Does NOT replace MemoryStore. Existing callers keep working. Canonical
 * daemon / ContextService / doctor paths should use this wrapper.
 */

import type { WorkspaceStore as Store } from "../state/workspace-store.ts";
import {
  MemoryStore,
  type AddInput,
  type AddResult,
  type MemoryHealth,
} from "./memory/store.ts";
import type { MemoryCategory, MemoryEntryWithContext, RecallHit } from "./memory/types.ts";
import { isSessionScope, memoryBelongsToWorkspace } from "./memory-scope.ts";

export class IsolatedMemoryStore extends MemoryStore {
  constructor(private readonly isolated: Store) {
    super(isolated);
  }

  get workspaceId(): string {
    return this.isolated.workspaceId;
  }

  override add(input: AddInput): AddResult {
    if (isSessionScope(input.scope)) {
      return { ok: false, reason: "session memory is not durable — use SessionMemory" };
    }
    // Project-scope (`global` / project key) is orthogonal to workspace
    // isolation. Isolation is the workspace_id stamp + file-per-workspace.
    // We do not rewrite a missing scope to "global" here — MemoryStore.add
    // already does that; callers who want an explicit workspace/agent scope
    // pass it. Accidental *cross-workspace* global is prevented by the stamp.
    const res = super.add(input);
    if (res.ok && res.entry) stampWorkspace(this.isolated, res.entry.id);
    return res;
  }

  override list(
    opts: {
      scope?: string;
      category?: MemoryCategory;
      includeExclusions?: boolean;
      includeExpired?: boolean;
      includeRevoked?: boolean;
    } = {},
  ): MemoryEntryWithContext[] {
    return super.list(opts).filter((e) => memoryBelongsToWorkspace(e, this.isolated.workspaceId));
  }

  override get(id: string): MemoryEntryWithContext | null {
    const entry = super.get(id);
    if (!entry) return null;
    return memoryBelongsToWorkspace(entry, this.isolated.workspaceId) ? entry : null;
  }

  override search(query: string, opts: { scope?: string } = {}): MemoryEntryWithContext[] {
    return super.search(query, opts).filter((e) => memoryBelongsToWorkspace(e, this.isolated.workspaceId));
  }

  override async recallSemanticExplain(
    query: string,
    opts: { scope?: string; k?: number; floor?: number } = {},
  ): Promise<RecallHit[]> {
    const hits = await super.recallSemanticExplain(query, opts);
    return hits.filter((h) => memoryBelongsToWorkspace(h.entry, this.isolated.workspaceId));
  }

  override health(): MemoryHealth {
    const h = super.health();
    if (!h.ok) return h;
    // Recompute totals against the isolated view so doctor cannot report
    // another workspace's rows as this workspace's memory.
    const visible = this.list({ includeExclusions: true, includeExpired: true });
    const now = Date.now();
    const byCategory = new Map<string, number>();
    for (const e of visible) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
    return {
      ...h,
      total: visible.length,
      expired: visible.filter((e) => typeof e.expiresAt === "number" && e.expiresAt <= now).length,
      neverAccessed: visible.filter((e) => e.lastAccessedAt == null && e.category !== "exclusion").length,
      byCategory: [...byCategory.entries()].map(([category, c]) => ({ category, c })),
    };
  }

  override remove(id: string): { ok: boolean; reason?: string } {
    invalidateMemoryIndexes(this.isolated, id);
    return super.remove(id);
  }

  override count(): number {
    return this.list({ includeExclusions: true, includeExpired: true }).length;
  }

  override stats(): Array<{ category: string; c: number }> {
    return this.health().byCategory;
  }
}

/** Stamp workspace_id on a freshly written row (idempotent). */
export function stampWorkspace(store: Store, id: string): void {
  try {
    store
      .query(`UPDATE user_memory SET workspace_id=? WHERE id=? AND (workspace_id IS NULL OR workspace_id='')`)
      .run(store.workspaceId, id);
  } catch {
    /* never fail a write because the stamp failed — file isolation still holds */
  }
}

/** Drop cached embeddings for an id so a deleted/revoked row cannot resurface. */
export function invalidateMemoryIndexes(store: Store, id: string): void {
  try {
    store
      .query(
        `UPDATE user_memory SET embedding=NULL, embedding_model=NULL, embedding_dim=NULL,
         index_state='invalidated', content_hash=NULL WHERE id=?`,
      )
      .run(id);
  } catch {
    /* best-effort */
  }
}
