/**
 * XR v0.9 (Tier 3) — memory summarization.
 *
 * Folds OLD, LOW-IMPORTANCE entries into compact summary entries so long-lived
 * memory stays useful, not noisy. Two-phase by design — propose, then apply —
 * so the user ALWAYS approves before anything is changed:
 *
 *   1. `planSummarization(mem, opts)` → a read-only PROPOSAL (what would fold
 *      into what). Touches nothing.
 *   2. `applySummarization(mem, plan)` → executes an APPROVED proposal: adds the
 *      compact summary entries, then deletes the folded originals.
 *
 * Deterministic (no model call) — consistent with XR's deterministic compaction
 * philosophy and fully testable. Privacy-safe: `exclusion` rules are NEVER
 * folded or summarized.
 */
import type { MemoryStore } from "./store.ts";
import type { MemoryCategory, MemoryEntry } from "./types.ts";

export interface SummarizeOptions {
  /** Only fold entries older than this many days. */
  olderThanDays?: number;
  /** Only fold entries with importance <= this (1..5). */
  maxImportance?: number;
  /** Restrict to a single scope (else all scopes are eligible). */
  scope?: string;
  /** Don't fold a group unless it has at least this many entries. */
  minGroup?: number;
  /** "now" override for deterministic tests. */
  now?: number;
}

/** One proposed fold: a new summary entry replacing N existing entries. */
export interface SummaryGroup {
  category: MemoryCategory;
  scope: string;
  /** The compact summary text that will be stored. */
  summary: string;
  /** Entries that will be DELETED if this group is applied. */
  folds: MemoryEntry[];
}

export interface SummarizationPlan {
  groups: SummaryGroup[];
  /** Total entries that would be removed. */
  totalFolded: number;
  /** Number of new summary entries that would be created. */
  totalSummaries: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build a read-only summarization proposal. Never mutates the store.
 *
 * Eligible entries: older than `olderThanDays` AND importance <= `maxImportance`
 * AND not an exclusion. They are grouped by (scope, category); a group only
 * folds if it has >= `minGroup` eligible entries (folding a single entry adds
 * no value).
 */
export function planSummarization(
  mem: MemoryStore,
  opts: SummarizeOptions = {},
): SummarizationPlan {
  const olderThanDays = opts.olderThanDays ?? 30;
  const maxImportance = opts.maxImportance ?? 2;
  const minGroup = Math.max(2, opts.minGroup ?? 3);
  const now = opts.now ?? Date.now();
  const cutoff = now - olderThanDays * DAY_MS;

  // exclusions are filtered out by list() — they are never eligible.
  const all = mem.list({ scope: opts.scope });
  const eligible = all.filter(
    (e) => e.updatedAt <= cutoff && e.importance <= maxImportance,
  );

  // group by scope|category
  const buckets = new Map<string, MemoryEntry[]>();
  for (const e of eligible) {
    const key = `${e.scope}\u0000${e.category}`;
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }

  const groups: SummaryGroup[] = [];
  for (const [key, entries] of buckets) {
    if (entries.length < minGroup) continue; // not worth folding
    const [scope, category] = key.split("\u0000");
    groups.push({
      category: category as MemoryCategory,
      scope,
      summary: buildSummaryText(category as MemoryCategory, entries),
      folds: entries,
    });
  }

  return {
    groups,
    totalFolded: groups.reduce((n, g) => n + g.folds.length, 0),
    totalSummaries: groups.length,
  };
}

/**
 * Apply an approved plan. Adds each group's summary entry, then deletes the
 * folded originals. Returns counts. Best-effort + fail-soft: if adding a
 * summary fails, that group's originals are LEFT INTACT (never lose data).
 */
export function applySummarization(
  mem: MemoryStore,
  plan: SummarizationPlan,
): { created: number; removed: number; skipped: number } {
  let created = 0;
  let removed = 0;
  let skipped = 0;

  for (const g of plan.groups) {
    const res = mem.add({
      content: g.summary,
      category: g.category,
      scope: g.scope,
      source: "user",
      // importance 3 so a digest sits above the noise it replaced.
      importance: 3,
      tags: ["summary"],
    });
    if (!res.ok) {
      // Could not store the summary → DO NOT delete the originals.
      skipped += g.folds.length;
      continue;
    }
    created++;
    const summaryId = res.entry?.id;
    for (const e of g.folds) {
      // Never delete the summary we just created if it collided/deduped.
      if (summaryId && e.id === summaryId) continue;
      if (mem.remove(e.id).ok) removed++;
    }
  }

  return { created, removed, skipped };
}

/**
 * Deterministic compact summary text for a group. Keeps each fact on its own
 * line, capped, so the digest never balloons. (A future version could call an
 * LLM to paraphrase — this stays deterministic + testable for v1.)
 */
function buildSummaryText(category: MemoryCategory, entries: MemoryEntry[]): string {
  const label =
    category === "preference"
      ? "Preferences"
      : category === "project"
        ? "Project notes"
        : category === "workflow"
          ? "Workflows"
          : "Facts";
  const bullets = entries
    .map((e) => e.content.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((c) => `• ${c}`);
  return `${label} (summary of ${entries.length} earlier notes): ${bullets.join(" ")}`.slice(
    0,
    1900,
  );
}
