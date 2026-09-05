/**
 * XR Phase 7 (F-21) — memory consolidation (`xr memory consolidate`).
 *
 * How this differs from the older `summarize.ts` (kept, unchanged):
 *   · summarize DELETES the folded originals (its tests pin that contract).
 *   · consolidate SUPERSEDES them: one `kind: summary` row per (scope,
 *     category, visibility) group is written with `source: "schedule"` and a
 *     provenance ref naming the job; every original gets `superseded_by` →
 *     the summary. Originals are never destroyed — they leave retrieval (the
 *     ACL gate hides superseded rows) but stay inspectable via
 *     `xr memory list --json` / export / `superseded()`.
 *   · IDEMPOTENT: superseded rows are not candidates, and a group whose
 *     summary already exists (content dedupe) is skipped, so running the job
 *     twice yields the same state (pinned by test).
 *   · BUDGETED: the job meters itself through its own `CostGovernor` envelope
 *     (Phase 2/6 machinery). The default summariser is DETERMINISTIC (no
 *     model call, $0, bounded tokens counted as chars/4); when a model-backed
 *     summariser is supplied, every call is admitted by `checkBeforeStep()`
 *     and stops honestly at the ceiling — the remaining groups are reported
 *     as `skipped`, never silently dropped.
 *   · AUDITED: `memory.consolidate.plan` / `.applied` / `.budget_stop`, and
 *     the per-row `memory.add` + supersede trail.
 *
 * "Startup-suggested": `suggestConsolidation()` is a read-only probe the status
 * surfaces call to print a hint; nothing runs without the user's command.
 */

import { CostGovernor, type Budget } from "../../cost/governor.ts";
import type { WorkspaceStore as Store } from "../../state/workspace-store.ts";
import type { MemoryStore } from "./store.ts";
import type { MemoryCategory, MemoryEntryWithContext } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConsolidateOptions {
  /** Only fold rows older than this many days (default 30). */
  olderThanDays?: number;
  /** Only fold rows with importance <= this (default 3). */
  maxImportance?: number;
  /** Restrict to one scope. */
  scope?: string;
  /** Minimum group size worth folding (default 3, floor 2). */
  minGroup?: number;
  now?: number;
  /** Envelope for the job; default is a token-only ceiling (deterministic summariser spends $0). */
  budget?: Budget;
  /** Optional model-backed summariser. Returns the summary text and the tokens it used. */
  summarize?: (group: ConsolidationGroup) => Promise<{ text: string; inTokens: number; outTokens: number }>;
}

export interface ConsolidationGroup {
  scope: string;
  category: MemoryCategory;
  visibility: string[];
  /** Deterministic summary text (with citations by id). */
  summary: string;
  originals: MemoryEntryWithContext[];
}

export interface ConsolidationPlan {
  groups: ConsolidationGroup[];
  totalOriginals: number;
  /** Groups whose summary row already exists — proof of idempotence, nothing to do. */
  alreadyConsolidated: number;
}

export interface ConsolidationResult {
  created: number;
  superseded: number;
  /** Groups left untouched (budget stop, storage failure) — originals intact. */
  skipped: number;
  budgetStopped: boolean;
  usage: { inTokens: number; outTokens: number; usd: number };
  summaryIds: string[];
}

/** Read-only plan: nothing is written. */
export function planConsolidation(mem: MemoryStore, opts: ConsolidateOptions = {}): ConsolidationPlan {
  const now = opts.now ?? Date.now();
  const cutoff = now - (opts.olderThanDays ?? 30) * DAY_MS;
  const maxImportance = opts.maxImportance ?? 3;
  const minGroup = Math.max(2, opts.minGroup ?? 3);

  // Exclusions are never eligible (list() hides them); superseded rows and
  // summaries themselves are not candidates (idempotence).
  const eligible = mem
    .list({ scope: opts.scope })
    .filter((e) => !e.supersededBy && e.kind !== "summary" && !e.tags.includes("summary"))
    .filter((e) => e.updatedAt <= cutoff && e.importance <= maxImportance);

  const buckets = new Map<string, MemoryEntryWithContext[]>();
  for (const e of eligible) {
    const vis = e.agentVisibility ?? ["*"];
    const key = `${e.scope}\u0000${e.category}\u0000${[...vis].sort().join(",")}`;
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }

  const existing = new Set(
    mem.list({ scope: opts.scope, includeExpired: true }).filter((e) => e.kind === "summary" || e.tags.includes("summary")).map((e) => e.content),
  );
  const groups: ConsolidationGroup[] = [];
  let alreadyConsolidated = 0;
  for (const [key, originals] of buckets) {
    if (originals.length < minGroup) continue;
    const [scope, category, visRaw] = key.split("\u0000");
    const visibility = visRaw ? visRaw.split(",") : ["*"];
    const sorted = [...originals].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const summary = deterministicSummary(category as MemoryCategory, sorted);
    if (existing.has(summary)) {
      alreadyConsolidated++;
      continue;
    }
    groups.push({ scope, category: category as MemoryCategory, visibility, summary, originals: sorted });
  }
  return { groups, totalOriginals: groups.reduce((n, g) => n + g.originals.length, 0), alreadyConsolidated };
}

/** Citations by id keep the summary traceable to the rows it supersedes. */
export function deterministicSummary(category: MemoryCategory, entries: readonly MemoryEntryWithContext[]): string {
  const label = category === "preference" ? "Preferences" : category === "project" ? "Project notes" : category === "workflow" ? "Procedures" : "Facts";
  const bullets = entries
    .slice(0, 20)
    .map((e) => `• ${e.content.replace(/\s+/g, " ").trim()} [${e.id}]`)
    .filter((b) => b.length > 4);
  return `${label} (consolidated from ${entries.length} earlier notes): ${bullets.join(" ")}`.slice(0, 1900);
}

/**
 * Apply a plan. Each group: admit against the envelope → write the summary
 * (source "schedule", provenance job ref) → supersede the originals. A failed
 * summary write leaves its originals untouched.
 */
export async function applyConsolidation(
  store: Store,
  mem: MemoryStore,
  plan: ConsolidationPlan,
  opts: ConsolidateOptions = {},
): Promise<ConsolidationResult> {
  const jobId = `consolidate:${new Date(opts.now ?? Date.now()).toISOString()}`;
  // Own envelope: local deterministic pricing is $0; a token ceiling still bounds the job.
  const governor = new CostGovernor(opts.budget ?? { maxTokens: 200_000 }, { inPerMTok: 0, outPerMTok: 0 });
  const result: ConsolidationResult = {
    created: 0, superseded: 0, skipped: 0, budgetStopped: false,
    usage: { inTokens: 0, outTokens: 0, usd: 0 }, summaryIds: [],
  };
  store.audit("memory.consolidate.plan", {
    jobId, groups: plan.groups.length, originals: plan.totalOriginals, alreadyConsolidated: plan.alreadyConsolidated,
    budget: opts.budget ?? { maxTokens: 200_000 }, summarizer: opts.summarize ? "model" : "deterministic",
  });

  for (const g of plan.groups) {
    const decision = governor.checkBeforeStep();
    if (!decision.allow) {
      result.budgetStopped = true;
      result.skipped += 1;
      store.audit("memory.consolidate.budget_stop", { jobId, reason: decision.reason, snapshot: governor.snapshot() });
      continue; // remaining groups are reported, never dropped silently
    }
    let text = g.summary;
    if (opts.summarize) {
      try {
        const out = await opts.summarize(g);
        text = out.text.trim() || g.summary;
        governor.record(out.inTokens, out.outTokens);
      } catch {
        text = g.summary; // model failure → deterministic fallback, still budgeted
        governor.record(Math.ceil(g.summary.length / 4), 0);
      }
    } else {
      governor.record(Math.ceil(g.summary.length / 4), Math.ceil(text.length / 4));
    }

    const added = mem.add({
      content: text,
      category: g.category,
      scope: g.scope,
      source: "schedule",
      provenance: { source: "schedule", ref: jobId },
      kind: "summary",
      tags: ["summary", "consolidated"],
      importance: 3,
      agentVisibility: g.visibility,
      // A consolidation is a maintenance act the user commanded — approved on the same terms as `summarize`.
      consentState: "approved",
      actor: "user",
    });
    if (!added.ok || !added.entry) {
      result.skipped += 1;
      continue;
    }
    if (added.duplicate) {
      // Same summary already stored (idempotent re-run) — only link originals that are still unlinked.
      const stillOpen = g.originals.filter((o) => !mem.get(o.id)?.supersededBy);
      for (const o of stillOpen) if (store.supersedeMemory(o.id, added.entry.id)) result.superseded += 1;
      continue;
    }
    result.created += 1;
    result.summaryIds.push(added.entry.id);
    for (const o of g.originals) if (store.supersedeMemory(o.id, added.entry.id)) result.superseded += 1;
    store.audit("memory.consolidate.applied", { jobId, summaryId: added.entry.id, superseded: g.originals.map((o) => o.id), scope: g.scope, category: g.category });
  }
  result.usage = governor.snapshot();
  governor.close();
  return result;
}

/** Read-only startup hint: how much would consolidate right now (never runs the job). */
export function suggestConsolidation(mem: MemoryStore, opts: ConsolidateOptions = {}): { groups: number; originals: number } | null {
  try {
    const plan = planConsolidation(mem, opts);
    return plan.groups.length ? { groups: plan.groups.length, originals: plan.totalOriginals } : null;
  } catch {
    return null;
  }
}
