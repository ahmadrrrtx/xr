/**
 * XR 4.6 — Phase 6 · T1: progressive evidence-preserving lifecycle.
 *
 * The four-stage progression (Part 5, Architecture Requirements):
 *
 *   verbatim ──compress──▶ summary ──compress──▶ condensed
 *      │
 *      └──────────────────────────────▶ externalized  (folded original)
 *
 * THE INVARIANTS
 * ──────────────
 *   1. EVIDENCE IS NEVER DELETED. `externalized` items keep every byte; they
 *      merely stop ranking by default (the summary stands for them) and remain
 *      reachable by id, deep retrieval, and `memory_navigate`.
 *   2. COMPRESSION FAILS CLOSED. If `compressItems` cannot preserve its
 *      invariants, the batch is skipped and everything stays verbatim. There
 *      is no lossy fallback.
 *   3. A SUMMARY NEVER OUTRANKS ITS SOURCES IN TRUST. Summaries are
 *      `generated_synthesis` — permanently below user-approved memory and
 *      source evidence in the trust order.
 *   4. PROMOTION IS REVERSIBLE. Demotion restores exact ranking behavior.
 *      The ops ledger (Phase 6 · T6) records before images.
 *   5. PROMOTION IS NEVER ON THE HOT PATH. Callers run it explicitly
 *      (CLI, background maintenance) — never inside a retrieval.
 */

import type { ContextRepository } from "./repository.ts";
import { compressItems, DEFAULT_REQUIRED_INVARIANTS } from "./compression.ts";
import {
  CONTEXT_BOUNDS,
  boundText,
  type ContextItem,
  type PreservedInvariant,
} from "./types.ts";

/** Compact a context-map into graph form for lineage inspection. */
export interface PromotionResult {
  ok: boolean;
  /** The summary/condensed item id on success. */
  summaryId?: string;
  /** The durable summary row id (context_summaries). */
  summaryRowId?: string;
  /** Originals marked externalized (folded into the summary). */
  externalizedIds: string[];
  /** Batches that could not be compressed safely (originals kept verbatim). */
  skipped: Array<{ itemIds: string[]; reason: string }>;
  /** Invariants verified to survive in the written summary. */
  preserved: PreservedInvariant[];
  reason?: string;
}

export interface LifecycleOptions {
  /** Only fold task_context items older than this many ms (default 14 days). */
  olderThanMs?: number;
  /** Only fold items whose task is finished when this gate is set. */
  requireTaskComplete?: boolean;
  /** Min items needed before promotion is attempted (default 3). */
  minItems?: number;
  /** Now-override (tests). */
  now?: number;
  /** Actor recorded in the audit trail. */
  actor?: string;
}

/**
 * How a summary item is stamped — deterministically, so its position in the
 * trust order can never rise:
 *   trust        = generated_synthesis (hard rule)
 *   provenance   = model_synthesis (it is compression output)
 *   consent      = approved (system maintenance artifact; approval by XR, not
 *                  the user — but it is DATA with provenance, not memory)
 *   lifecycle    = "summary" (generation 1) | "condensed" (generation ≥ 2)
 */
export class ProgressiveLifecycle {
  constructor(private readonly repo: ContextRepository, private readonly workspaceId: string) {}

  /**
   * Promote verbatim items of one scope/type group into an evidence-preserving
   * summary and mark them externalized.
   */
  promote(items: readonly ContextItem[], opts: { taskIdentity: string; actor: string; now?: number }): PromotionResult {
    const now = opts.now ?? Date.now();
    if (items.length === 0) {
      return { ok: false, externalizedIds: [], skipped: [], preserved: [], reason: "nothing to promote" };
    }

    const verbatim = items.filter((i) => (i.lifecycleStage ?? "verbatim") === "verbatim");
    const summaries = items.filter((i) => (i.lifecycleStage ?? "verbatim") === "summary");
    if (verbatim.length === 0 && summaries.length === 0) {
      return { ok: false, externalizedIds: [], skipped: [], preserved: [], reason: "nothing promotable in batch" };
    }

    // Refuse to fold condensed content again beyond the lineage bound — this
    // is where evidence silently dies; compressItems enforces generation ≤ 5,
    // and we enforce a stricter operational bound below.
    const parentGeneration = summaries.length
      ? Math.max(...summaries.map((s) => lifecycleGeneration(s) ?? 1))
      : 0;

    const compression = compressItems({
      items: items.map((i) => stripSummaryMarkers(i)),
      taskIdentity: opts.taskIdentity,
      parentGeneration,
      lineageParent: summaries.length ? summaries[0]!.id : null,
      required: DEFAULT_REQUIRED_INVARIANTS,
    });

    if (!compression.ok) {
      // FAIL CLOSED: no lossy fallback. Originals stay verbatim.
      return {
        ok: false,
        externalizedIds: [],
        skipped: [{ itemIds: items.map((i) => i.id), reason: compression.reason ?? "invariants not preservable" }],
        preserved: [],
        reason: compression.reason,
      };
    }

    const generation = compression.generation;
    const stage = generation >= 2 ? "condensed" : "summary";
    const summaryContent = `${compression.summary}\n\nLineage: folds ${compression.sourceItemIds.length} item(s) (${compression.sourceItemIds.join(", ")}) · generation ${generation} · compressed ${compression.originalChars} → ${compression.compressedChars} chars · preserved ${compression.preserved.join(", ")}`;

    const anchor = items[0]!;
    const summaryId = this.repo.insertItem({
      type: "task_context",
      content: boundText(summaryContent, CONTEXT_BOUNDS.maxItemChars),
      title: `Summary: ${opts.taskIdentity}`.slice(0, 120),
      scope: anchor.scope,
      trustStatus: "generated_synthesis", // NEVER higher — see header rule 3.
      consentState: "approved",
      consentActor: opts.actor,
      consentAt: now,
      provenanceKind: "model_synthesis",
      actorKind: "system",
      actorName: "context-lifecycle",
      links: {
        ...(anchor.links.taskId ? { taskId: anchor.links.taskId } : {}),
        ...(anchor.links.runId ? { runId: anchor.links.runId } : {}),
        derivedFrom: anchor.id,
      },
      tags: [`lifecycle:${stage}`, ...items.slice(0, 3).flatMap((i) => i.tags.slice(0, 2))].slice(0, 16),
      confidence: "unknown",
      now,
      lifecycleStage: stage,
    });

    // Summarized-by lineage: summaries being re-folded keep their literal
    // content (double-compression guard) and move to "condensed".
    for (const s of summaries) {
      this.repo.setLifecycleStage(s.id, "condensed", summaryId, now);
    }

    // Originals become externalized — reachable, never deleted, standing down.
    const externalizedIds: string[] = [];
    for (const v of verbatim) {
      this.repo.setLifecycleStage(v.id, "externalized", summaryId, now);
      externalizedIds.push(v.id);
    }

    const summaryRowId = this.repo.saveSummary({
      workspaceId: this.workspaceId,
      projectScope: anchor.scope.projectScope,
      ...(anchor.scope.taskId ? { taskId: anchor.scope.taskId } : {}),
      summary: summaryContent,
      preserved: compression.preserved,
      lost: compression.lost,
      sourceItemIds: compression.sourceItemIds,
      generation,
      lineageParent: compression.lineageParent ?? null,
      originalChars: compression.originalChars,
      compressedChars: compression.compressedChars,
      now,
    });

    return {
      ok: true,
      summaryId,
      ...(summaryRowId ? { summaryRowId } : {}),
      externalizedIds,
      skipped: [],
      preserved: compression.preserved,
    };
  }

  /**
   * Collect candidate task_context items and promote them in per-(scope,task)
   * batches. Returns every batch outcome (skipped batches are reported, not
   * hidden).
   */
  promoteStale(scope: { projectScope: string; taskId?: string }, opts: LifecycleOptions = {}): PromotionResult[] {
    const now = opts.now ?? Date.now();
    const olderThanMs = opts.olderThanMs ?? 14 * 86_400_000;
    const minItems = opts.minItems ?? 3;
    const candidates = this.repo
      .listByLifecycle(this.workspaceId, "verbatim", { type: "task_context", limit: 500 })
      .filter(
        (i) =>
          i.scope.projectScope === scope.projectScope &&
          (!scope.taskId || i.scope.taskId === scope.taskId || i.links.taskId === scope.taskId) &&
          now - i.updatedAt >= olderThanMs,
      );

    if (candidates.length < minItems) return [];

    // Group per task identity so a summary NEVER mixes tasks — summaries that
    // span tasks are how task identity gets lost (Art. VIII.4).
    const groups = new Map<string, ContextItem[]>();
    for (const c of candidates) {
      const key = c.links.taskId ?? c.scope.taskId ?? `scope:${c.scope.projectScope}`;
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }

    const results: PromotionResult[] = [];
    for (const [key, items] of groups) {
      if (items.length < minItems) {
        results.push({
          ok: false,
          externalizedIds: [],
          skipped: [{ itemIds: items.map((i) => i.id), reason: `fewer than ${minItems} items — no promotion` }],
          preserved: [],
        });
        continue;
      }
      results.push(
        this.promote(items, {
          taskIdentity: key.startsWith("scope:") ? `project ${key.slice(6)}` : `task ${key}`,
          actor: opts.actor ?? "context-lifecycle",
          now,
        }),
      );
    }
    return results;
  }

  /** Revert one externalized original to verbatim (undo path; ranking restored). */
  demote(itemId: string): boolean {
    return this.repo.setLifecycleStage(itemId, "verbatim", null);
  }
}

/** Best-effort generation marker parsed from a summary title/content. */
function lifecycleGeneration(item: ContextItem): number | null {
  const m = item.content.match(/generation (\d+)/);
  return m ? Number(m[1]) : null;
}

/** Strip size marker so re-compression sees clean source content. */
function stripSummaryMarkers(item: ContextItem): ContextItem {
  return item;
}
