/**
 * Phase 09 — context budget pipeline.
 *
 * ONE pipeline, derived from existing CONTEXT_BOUNDS + TIER_POLICIES.
 * Do not invent a second configuration surface.
 *
 *   SYSTEM
 *     → CORE CONTEXT
 *     → USER / WORKSPACE CONTEXT
 *     → ACTIVE TASK
 *     → RELEVANT MEMORY
 *     → TOOLS / SKILLS
 *     → RECENT CONVERSATION
 *
 * Each layer has a budget. Overflow is handled in order:
 *   summarize → compact → prioritize → drop low-value
 * The global package ceiling is NEVER silently exceeded.
 */

import { CONTEXT_BOUNDS, TIER_POLICIES, boundText } from "./types.ts";

/** Progressive-summary target referenced by the forensic plan (~1536). */
export const PROGRESSIVE_SUMMARY_CHARS = 1_536;

export const CONTEXT_LAYERS = [
  "system",
  "core",
  "user_workspace",
  "active_task",
  "relevant_memory",
  "tools_skills",
  "recent_conversation",
] as const;

export type ContextLayer = (typeof CONTEXT_LAYERS)[number];

export type DisclosureDepth = "metadata" | "summary" | "full";

export interface LayerBudget {
  layer: ContextLayer;
  maxChars: number;
  maxItems: number;
}

export interface BudgetPlan {
  /** Hard global ceiling (never exceeded). */
  globalMaxChars: number;
  globalMaxItems: number;
  layers: readonly LayerBudget[];
  progressiveSummaryChars: number;
}

export interface LayerUsage {
  layer: ContextLayer;
  chars: number;
  items: number;
  action: "keep" | "summarize" | "compact" | "prioritize" | "drop";
  dropped: number;
}

/**
 * Build the canonical budget plan from existing XR bounds.
 *
 * Shares of the package ceiling (sum = 100% of maxPackageChars):
 *   system 12% · core 15% · user/workspace 15% · task 18%
 *   memory 15% · tools/skills 10% · recent 15%
 */
export function buildBudgetPlan(opts: {
  maxChars?: number;
  maxItems?: number;
  progressiveSummaryChars?: number;
} = {}): BudgetPlan {
  const globalMaxChars = Math.min(
    opts.maxChars ?? CONTEXT_BOUNDS.maxPackageChars,
    CONTEXT_BOUNDS.maxPackageChars,
  );
  const globalMaxItems = Math.min(
    opts.maxItems ?? CONTEXT_BOUNDS.maxPackageItems,
    CONTEXT_BOUNDS.maxPackageItems,
  );

  const share = (pct: number, floor: number): number =>
    Math.max(floor, Math.floor((globalMaxChars * pct) / 100));

  return {
    globalMaxChars,
    globalMaxItems,
    progressiveSummaryChars: opts.progressiveSummaryChars ?? PROGRESSIVE_SUMMARY_CHARS,
    layers: [
      { layer: "system", maxChars: share(12, 800), maxItems: 8 },
      { layer: "core", maxChars: share(15, 1_000), maxItems: 8 },
      { layer: "user_workspace", maxChars: share(15, 1_000), maxItems: 8 },
      { layer: "active_task", maxChars: share(18, 1_200), maxItems: TIER_POLICIES.immediate.maxItems },
      { layer: "relevant_memory", maxChars: share(15, 800), maxItems: TIER_POLICIES.long_term_memory.maxItems },
      { layer: "tools_skills", maxChars: share(10, 600), maxItems: 8 },
      { layer: "recent_conversation", maxChars: share(15, 1_000), maxItems: TIER_POLICIES.recent.maxItems },
    ],
  };
}

export interface BudgetItem {
  id: string;
  layer: ContextLayer;
  chars: number;
  /** Higher survives when we prioritize. */
  priority: number;
  content: string;
}

export interface EnforceResult {
  kept: BudgetItem[];
  usage: LayerUsage[];
  totalChars: number;
  totalItems: number;
  exceeded: boolean;
}

/**
 * Enforce per-layer then global budgets. Never mutates the input array.
 * Overflow handling is honest: dropped items are counted, not hidden.
 */
export function enforceBudget(
  items: readonly BudgetItem[],
  plan: BudgetPlan = buildBudgetPlan(),
): EnforceResult {
  const usage: LayerUsage[] = [];
  const kept: BudgetItem[] = [];

  for (const layer of CONTEXT_LAYERS) {
    const budget = plan.layers.find((l) => l.layer === layer)!;
    const slice = items
      .filter((i) => i.layer === layer)
      .slice()
      .sort((a, b) => b.priority - a.priority);
    const layerKept: BudgetItem[] = [];
    let chars = 0;
    let dropped = 0;
    let action: LayerUsage["action"] = "keep";

    for (const item of slice) {
      if (layerKept.length >= budget.maxItems) {
        dropped++;
        action = action === "keep" ? "prioritize" : action;
        continue;
      }
      if (chars + item.chars > budget.maxChars) {
        if (item.chars > budget.maxChars && layerKept.length === 0) {
          // Summarize the first oversized item so the layer is not empty.
          const summarized = {
            ...item,
            content: boundText(item.content, Math.min(plan.progressiveSummaryChars, budget.maxChars)),
            chars: Math.min(item.chars, plan.progressiveSummaryChars, budget.maxChars),
          };
          layerKept.push(summarized);
          chars += summarized.chars;
          action = "summarize";
        } else {
          dropped++;
          action = action === "keep" ? "drop" : action;
        }
        continue;
      }
      layerKept.push(item);
      chars += item.chars;
    }

    usage.push({ layer, chars, items: layerKept.length, action, dropped });
    kept.push(...layerKept);
  }

  // Global ceiling — drop lowest-priority tail, never the system layer.
  let totalChars = kept.reduce((n, i) => n + i.chars, 0);
  let exceeded = false;
  if (totalChars > plan.globalMaxChars || kept.length > plan.globalMaxItems) {
    exceeded = true;
    const droppable = kept
      .map((item, idx) => ({ item, idx }))
      .filter((x) => x.item.layer !== "system")
      .sort((a, b) => a.item.priority - b.item.priority || b.idx - a.idx);
    while (
      (totalChars > plan.globalMaxChars || kept.length > plan.globalMaxItems) &&
      droppable.length
    ) {
      const victim = droppable.shift()!;
      const pos = kept.indexOf(victim.item);
      if (pos >= 0) {
        kept.splice(pos, 1);
        totalChars -= victim.item.chars;
        const u = usage.find((x) => x.layer === victim.item.layer);
        if (u) {
          u.dropped += 1;
          u.items = Math.max(0, u.items - 1);
          u.chars = Math.max(0, u.chars - victim.item.chars);
          u.action = "drop";
        }
      }
    }
  }

  return {
    kept,
    usage,
    totalChars: kept.reduce((n, i) => n + i.chars, 0),
    totalItems: kept.length,
    exceeded,
  };
}

/**
 * Progressive disclosure of a single memory body.
 *
 *   metadata — title / type only (no body)
 *   summary  — first `progressiveSummaryChars` (default 1536)
 *   full     — full content, still bounded by CONTEXT_BOUNDS.maxItemChars
 */
export function discloseContent(
  content: string,
  depth: DisclosureDepth,
  opts: { summaryChars?: number; title?: string } = {},
): string {
  if (depth === "metadata") {
    return opts.title?.trim() || boundText(content.replace(/\s+/g, " ").trim(), 72);
  }
  if (depth === "summary") {
    return boundText(content, opts.summaryChars ?? PROGRESSIVE_SUMMARY_CHARS);
  }
  return boundText(content, CONTEXT_BOUNDS.maxItemChars);
}

/** When should the assembler expand a hit to full content? */
export function shouldExpandFull(opts: {
  requested?: DisclosureDepth;
  similarity?: number;
  explicitLookup?: boolean;
}): DisclosureDepth {
  if (opts.requested) return opts.requested;
  if (opts.explicitLookup) return "full";
  if ((opts.similarity ?? 0) >= 0.85) return "full";
  return "summary";
}
