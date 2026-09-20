/**
 * XR — desktop UI-state repository (Phase 2 · G-08).
 *
 * Small, per-workspace JSON values the renderer owns: `workspace.layout`,
 * `workspace.tabs`, `chat.draft`, `nav.lastArea`, … The engine keeps them
 * durable (SQLite, through the write gate) and enforces only what an engine
 * can honestly enforce about opaque UI state:
 *   · key shape (`^[a-z][a-z0-9._-]{0,63}$`) so keys stay greppable;
 *   · value budget (≤ 256 KB serialized) and count budget (≤ 256 keys per
 *     workspace) so a renderer bug cannot grow the store without bound;
 *   · monotonic `updatedAt` per key so a crash-recovery sheet can say WHEN a
 *     draft was last saved, truthfully.
 * It never interprets the values. There is deliberately no "sync" story:
 * one workspace store, one set of UI state.
 */

import type { WorkspaceStore } from "./workspace-store.ts";

export const UI_STATE_KEY_RE = /^[a-z][a-z0-9._-]{0,63}$/;
export const UI_STATE_MAX_VALUE_BYTES = 256 * 1024;
export const UI_STATE_MAX_KEYS = 256;

export interface UiStateEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

export class UiStateError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 429,
  ) {
    super(message);
  }
}

export class UiStateRepo {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly workspaceId: string,
  ) {}

  /** All entries, or only `keys` when given. */
  get(keys?: readonly string[]): UiStateEntry[] {
    const rows = (
      keys && keys.length
        ? this.store
            .prepare(`SELECT key, value, updated_at FROM ui_state WHERE workspace_id = ? AND key IN (${keys.map(() => "?").join(",")}) ORDER BY key`)
            .all(this.workspaceId, ...keys)
        : this.store.prepare(`SELECT key, value, updated_at FROM ui_state WHERE workspace_id = ? ORDER BY key`).all(this.workspaceId)
    ) as Array<{ key: string; value: string; updated_at: number }>;
    return rows.map((r) => ({ key: r.key, value: safeParse(r.value), updatedAt: r.updated_at }));
  }

  /**
   * Upsert every key in `patch`; a `null` value deletes the key. Validates the
   * whole patch BEFORE writing anything, so a rejected patch is all-or-nothing.
   */
  patch(patch: Record<string, unknown>, now = Date.now()): { written: string[]; deleted: string[]; updatedAt: number } {
    const entries = Object.entries(patch);
    if (entries.length === 0) throw new UiStateError("empty patch", 400);
    const serialized: Array<[string, string | null]> = [];
    for (const [key, value] of entries) {
      if (!UI_STATE_KEY_RE.test(key)) throw new UiStateError(`invalid key '${key}' (expected ${UI_STATE_KEY_RE.source})`, 400);
      if (value === null) {
        serialized.push([key, null]);
        continue;
      }
      let text: string;
      try {
        text = JSON.stringify(value);
      } catch {
        throw new UiStateError(`value for '${key}' is not JSON-serializable`, 400);
      }
      if (text === undefined) throw new UiStateError(`value for '${key}' is not JSON-serializable`, 400);
      if (Buffer.byteLength(text, "utf8") > UI_STATE_MAX_VALUE_BYTES) {
        throw new UiStateError(`value for '${key}' exceeds ${UI_STATE_MAX_VALUE_BYTES} bytes`, 413);
      }
      serialized.push([key, text]);
    }
    const existing = new Set(
      (this.store.prepare(`SELECT key FROM ui_state WHERE workspace_id = ?`).all(this.workspaceId) as Array<{ key: string }>).map((r) => r.key),
    );
    const projected = new Set(existing);
    for (const [key, text] of serialized) {
      if (text === null) projected.delete(key);
      else projected.add(key);
    }
    if (projected.size > UI_STATE_MAX_KEYS) throw new UiStateError(`more than ${UI_STATE_MAX_KEYS} keys per workspace`, 429);

    const written: string[] = [];
    const deleted: string[] = [];
    this.store.write(() => {
      for (const [key, text] of serialized) {
        if (text === null) {
          this.store.prepare(`DELETE FROM ui_state WHERE workspace_id = ? AND key = ?`).run(this.workspaceId, key);
          deleted.push(key);
        } else {
          this.store
            .prepare(
              `INSERT INTO ui_state (workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            )
            .run(this.workspaceId, key, text, now);
          written.push(key);
        }
      }
    });
    return { written, deleted, updatedAt: now };
  }

  /** Everything for this workspace — used by workspace deletion. */
  clear(): number {
    let n = 0;
    this.store.write(() => {
      const res = this.store.prepare(`DELETE FROM ui_state WHERE workspace_id = ?`).run(this.workspaceId) as { changes?: number };
      n = res.changes ?? 0;
    });
    return n;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
