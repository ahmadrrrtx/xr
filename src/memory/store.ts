/**
 * XR v0.9 — durable memory: the store facade.
 *
 * A clean abstraction that sits ON TOP of the SQLite Store. It owns the WRITE
 * RULES, the RECALL layer, scope handling and import/export. Nothing in here
 * knows about providers, budgets, voice or control — by design.
 *
 * Design principles:
 *   • Explicit by default — entries are only created when the user asks.
 *   • Deterministic & testable — recall uses the existing lexical vector + a
 *     conservative relevance floor (no model call required).
 *   • Privacy first — `exclusion` rules block matching content from being
 *     stored, and exclusions are never surfaced as recall.
 *   • Fail soft — bad input is validated and rejected with a clear reason,
 *     never a crash.
 */
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { MemoryRow, Store } from "../state/db.ts";
import { lexicalVector, cosine } from "./embed.ts";
import {
  GLOBAL_SCOPE,
  clampImportance,
  isCategory,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryExport,
  type MemorySource,
} from "./types.ts";

const MAX_CONTENT = 2000;
/** Recall is conservative: a hit must clear this similarity floor. */
const RECALL_FLOOR = 0.12;

export interface AddResult {
  ok: boolean;
  entry?: MemoryEntry;
  /** True when an identical entry already existed (no duplicate created). */
  duplicate?: boolean;
  reason?: string;
}

export interface AddInput {
  content: string;
  category?: MemoryCategory;
  scope?: string;
  source?: MemorySource;
  tags?: string[];
  importance?: number;
}

function rowToEntry(r: MemoryRow): MemoryEntry {
  return {
    id: r.id,
    category: r.category as MemoryCategory,
    content: r.content,
    scope: r.scope,
    source: r.source as MemorySource,
    tags: r.tags ? r.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    importance: r.importance,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Derive a stable project scope key from a working directory. */
export function projectScopeFromCwd(cwd: string): string {
  const b = basename(cwd).trim();
  return b ? b.toLowerCase().replace(/[^a-z0-9._-]/g, "-") : GLOBAL_SCOPE;
}

export class MemoryStore {
  constructor(private store: Store) {}

  // ── write ─────────────────────────────────────────────────────────────

  /**
   * Add a memory entry, applying all write rules:
   *   1. validate + normalize input (fail soft)
   *   2. honour do-not-remember (exclusion) rules
   *   3. dedupe by (scope, category, content)
   */
  add(input: AddInput): AddResult {
    const content = (input.content ?? "").trim();
    if (!content) return { ok: false, reason: "empty content" };
    if (content.length > MAX_CONTENT) {
      return { ok: false, reason: `content too long (>${MAX_CONTENT} chars)` };
    }

    const category: MemoryCategory =
      input.category && isCategory(input.category) ? input.category : "fact";
    const scope = (input.scope ?? GLOBAL_SCOPE).trim() || GLOBAL_SCOPE;
    const source: MemorySource = input.source ?? "user";
    const importance = clampImportance(input.importance ?? 3);
    const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);

    // Rule: a do-not-remember rule blocks matching content (unless we are
    // recording the exclusion rule itself).
    if (category !== "exclusion") {
      const blocked = this.matchesExclusion(content);
      if (blocked) {
        return {
          ok: false,
          reason: `blocked by do-not-remember rule: "${blocked}"`,
        };
      }
    }

    // Rule: dedupe identical (scope, category, content).
    const existing = this.store.findMemoryByContent(scope, category, content);
    if (existing) {
      return { ok: true, duplicate: true, entry: rowToEntry(existing) };
    }

    const id = `mem_${randomUUID().slice(0, 8)}`;
    this.store.insertMemory({
      id,
      category,
      content,
      scope,
      source,
      tags: tags.join(","),
      importance,
    });
    this.store.audit("memory.add", {
      id,
      category,
      scope,
      source,
      // content length only — never the raw content, keeps logs private.
      contentLen: content.length,
    });
    const row = this.store.getMemory(id)!;
    return { ok: true, entry: rowToEntry(row) };
  }

  update(
    id: string,
    patch: Partial<Pick<MemoryEntry, "content" | "category" | "scope" | "importance">> & {
      tags?: string[];
    },
  ): { ok: boolean; reason?: string; entry?: MemoryEntry } {
    const resolved = this.resolveId(id);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const realId = resolved.id!;

    const dbPatch: Record<string, unknown> = {};
    if (patch.content !== undefined) {
      const c = patch.content.trim();
      if (!c) return { ok: false, reason: "empty content" };
      if (c.length > MAX_CONTENT)
        return { ok: false, reason: `content too long (>${MAX_CONTENT})` };
      dbPatch.content = c;
    }
    if (patch.category !== undefined) {
      if (!isCategory(patch.category))
        return { ok: false, reason: `unknown category: ${patch.category}` };
      dbPatch.category = patch.category;
    }
    if (patch.scope !== undefined) dbPatch.scope = patch.scope.trim() || GLOBAL_SCOPE;
    if (patch.importance !== undefined)
      dbPatch.importance = clampImportance(patch.importance);
    if (patch.tags !== undefined)
      dbPatch.tags = patch.tags.map((t) => t.trim()).filter(Boolean).join(",");

    const okUpdate = this.store.updateMemory(realId, dbPatch);
    if (!okUpdate) return { ok: false, reason: "not found" };
    this.store.audit("memory.edit", { id: realId, fields: Object.keys(dbPatch) });
    return { ok: true, entry: rowToEntry(this.store.getMemory(realId)!) };
  }

  remove(id: string): { ok: boolean; reason?: string } {
    const resolved = this.resolveId(id);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const ok = this.store.deleteMemory(resolved.id!);
    if (ok) this.store.audit("memory.remove", { id: resolved.id });
    return ok ? { ok: true } : { ok: false, reason: "not found" };
  }

  clear(scope?: string): number {
    const n = this.store.clearMemory(scope);
    this.store.audit("memory.clear", { scope: scope ?? "all", removed: n });
    return n;
  }

  // ── read ──────────────────────────────────────────────────────────────

  list(opts: { scope?: string; category?: MemoryCategory; includeExclusions?: boolean } = {}): MemoryEntry[] {
    return this.store.listMemory(opts).map(rowToEntry);
  }

  get(id: string): MemoryEntry | null {
    const resolved = this.resolveId(id);
    if (!resolved.ok) return null;
    const row = this.store.getMemory(resolved.id!);
    return row ? rowToEntry(row) : null;
  }

  /** Plain substring/keyword search (deterministic). */
  search(query: string, opts: { scope?: string } = {}): MemoryEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const all = this.list({ scope: opts.scope });
    const terms = q.split(/\s+/).filter(Boolean);
    return all.filter((e) => {
      const hay = (e.content + " " + e.tags.join(" ") + " " + e.category).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  /**
   * RECALL LAYER — relevant, conservative retrieval for prompt injection.
   *
   * Returns at most `k` entries whose lexical similarity to the query clears
   * the relevance floor. Exclusions are never returned. Importance is folded
   * in as a gentle tiebreaker so critical preferences win close calls.
   */
  recall(
    query: string,
    opts: { scope?: string; k?: number; floor?: number } = {},
  ): MemoryEntry[] {
    const k = opts.k ?? 5;
    const floor = opts.floor ?? RECALL_FLOOR;
    const q = (query ?? "").trim();
    if (!q) return [];

    const candidates = this.list({ scope: opts.scope }); // exclusions already filtered
    if (candidates.length === 0) return [];

    const qv = lexicalVector(q);
    const scored = candidates.map((e) => {
      const sim = cosine(qv, lexicalVector(`${e.content} ${e.tags.join(" ")}`));
      // importance nudge: +0..0.05 so it only breaks near-ties.
      const score = sim + (e.importance - 3) * 0.0125;
      return { e, sim, score };
    });

    return scored
      .filter((s) => s.sim >= floor)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((s) => s.e);
  }

  // ── exclusions (do-not-remember) ──────────────────────────────────────

  /** Returns the matching exclusion phrase, or null if content is allowed. */
  matchesExclusion(content: string): string | null {
    const lc = content.toLowerCase();
    const rules = this.store
      .listMemory({ category: "exclusion", includeExclusions: true })
      .map(rowToEntry);
    for (const r of rules) {
      const phrase = r.content.toLowerCase().trim();
      if (phrase && lc.includes(phrase)) return r.content;
    }
    return null;
  }

  // ── import / export ───────────────────────────────────────────────────

  export(): MemoryExport {
    const entries = this.store
      .listMemory({ includeExclusions: true })
      .map(rowToEntry);
    return {
      format: "xr-memory",
      version: 1,
      exportedAt: Date.now(),
      entries,
    };
  }

  /**
   * Import a previously-exported bundle. Existing identical entries are skipped
   * (dedupe). Returns counts. Malformed entries are skipped, never fatal.
   */
  import(bundle: unknown): { added: number; skipped: number; errors: number } {
    let added = 0,
      skipped = 0,
      errors = 0;
    const b = bundle as Partial<MemoryExport>;
    if (!b || b.format !== "xr-memory" || !Array.isArray(b.entries)) {
      return { added: 0, skipped: 0, errors: 1 };
    }
    for (const raw of b.entries) {
      try {
        const res = this.add({
          content: raw.content,
          category: isCategory(raw.category as string)
            ? (raw.category as MemoryCategory)
            : "fact",
          scope: raw.scope,
          source: "import",
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          importance: raw.importance,
        });
        if (!res.ok) errors++;
        else if (res.duplicate) skipped++;
        else added++;
      } catch {
        errors++;
      }
    }
    this.store.audit("memory.import", { added, skipped, errors });
    return { added, skipped, errors };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  count(): number {
    return this.store.userMemoryCount();
  }

  stats(): Array<{ category: string; c: number }> {
    return this.store.userMemoryStats();
  }

  /** Resolve a full id or unambiguous prefix to a single id. */
  private resolveId(id: string): { ok: boolean; id?: string; reason?: string } {
    const trimmed = id.trim();
    if (!trimmed) return { ok: false, reason: "no id given" };
    if (this.store.getMemory(trimmed)) return { ok: true, id: trimmed };
    const matches = this.store.findMemoryByPrefix(trimmed);
    if (matches.length === 1) return { ok: true, id: matches[0].id };
    if (matches.length === 0) return { ok: false, reason: `no entry: ${trimmed}` };
    return {
      ok: false,
      reason: `ambiguous id "${trimmed}" (${matches.length} matches) — use the full id`,
    };
  }
}
