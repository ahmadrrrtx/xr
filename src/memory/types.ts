/**
 * XR v0.9 — durable memory: shared vocabulary.
 *
 * This file is intentionally dependency-free so every layer (CLI, agent,
 * voice, research, dashboard later) speaks the same memory language without
 * importing the store, a provider, or any UI code.
 */

/** The fixed set of memory categories (namespaces). */
export const MEMORY_CATEGORIES = [
  "preference", // durable user preferences (coding style, provider, tools)
  "project", // long-running project context
  "workflow", // repeated procedures / how-the-user-likes-things-done
  "fact", // stable long-term facts about the user / their world
  "exclusion", // do-not-remember rules (never surfaced as recall)
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/** Where a memory was created from (provenance). */
export const MEMORY_SOURCES = [
  "user", // typed/explicit via `xr memory add`
  "chat", // confirmed in an agent chat ("remember …")
  "voice", // confirmed via voice
  "research", // saved from a research output
  "import", // bulk imported
] as const;

export type MemorySource = (typeof MEMORY_SOURCES)[number];

/** A fully-formed memory entry (mirrors the user_memory table). */
export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  content: string;
  /** "global" or a project key (e.g. a directory basename). */
  scope: string;
  source: MemorySource;
  /** Free-form tags for filtering. */
  tags: string[];
  /** 1 (minor) … 5 (critical). Higher importance recalls first. */
  importance: number;
  createdAt: number;
  updatedAt: number;
  /**
   * Stage 6 — when this entry was last surfaced by recall (null = never).
   * Powers recency-based hygiene ("show stale memory", "prune untouched").
   */
  lastAccessedAt?: number | null;
  /** Stage 6 — how many times recall has surfaced this entry. */
  accessCount?: number;
  /**
   * Stage 6 — retention/expiry. Epoch-ms after which the entry is eligible for
   * pruning and excluded from recall. null/undefined = never expires.
   */
  expiresAt?: number | null;
}

/**
 * Stage 6 — an explainable recall hit. Lets XR (and the user) see WHY a memory
 * was surfaced: the raw similarity, the importance-adjusted score, and a
 * human-readable reason. Retrieval is never a black box.
 */
export interface RecallHit {
  entry: MemoryEntry;
  /** Raw similarity to the query (0..1, lexical or embedding cosine). */
  sim: number;
  /** Importance-adjusted score used for ranking. */
  score: number;
  /** Human-readable reason this entry was surfaced. */
  reason: string;
}

/** The portable export format (stable across versions). */
export interface MemoryExport {
  format: "xr-memory";
  version: 1;
  exportedAt: number;
  entries: MemoryEntry[];
}

export const GLOBAL_SCOPE = "global";

export function isCategory(v: string): v is MemoryCategory {
  return (MEMORY_CATEGORIES as readonly string[]).includes(v);
}

export function isSource(v: string): v is MemorySource {
  return (MEMORY_SOURCES as readonly string[]).includes(v);
}

/** Clamp an importance value into the 1..5 range. */
export function clampImportance(n: unknown): number {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return 3;
  return Math.min(5, Math.max(1, x));
}

/**
 * Stage 6 — convert a time-to-live in ms to an absolute `expiresAt` epoch-ms.
 * Returns null when there is no TTL (entry never expires). `now` is overridable
 * for deterministic tests.
 */
export function ttlToExpiresAt(ttlMs?: number | null, now: number = Date.now()): number | null {
  if (ttlMs === null || ttlMs === undefined) return null;
  const ms = Number(ttlMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return now + ms;
}

/**
 * Stage 6 — is an entry expired at `now`? Entries with no `expiresAt` never
 * expire. `now` is overridable for deterministic tests.
 */
export function isExpired(entry: { expiresAt?: number | null }, now: number = Date.now()): boolean {
  const e = entry.expiresAt;
  return typeof e === "number" && Number.isFinite(e) && e <= now;
}

/** Default relevance floor for recall (conservative: weak hits are dropped). */
export const RECALL_FLOOR = 0.12;
