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
