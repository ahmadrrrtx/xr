/**
 * XR 4.5 — Context assembler: builds bounded, tiered, explainable packages.
 *
 * The assembler is the only component that produces a `ContextPackage`. It:
 *   1. asks policy for a grant (never trusts the caller's claim of scope);
 *   2. runs the scope-first retrieval pipeline;
 *   3. groups results into tiers and enforces per-tier + package bounds;
 *   4. compresses compressible tiers when over budget (evidence-preserving);
 *   5. computes a content hash so drift is detectable across a resume;
 *   6. records degradation honestly instead of silently returning less.
 */

import { randomUUID } from "node:crypto";
import {
  CONTEXT_BOUNDS,
  CONTEXT_SCHEMA_VERSION,
  TIER_POLICIES,
  contentHash,
  type ContextGrant,
  type ContextItem,
  type ContextPackage,
  type ContextTier,
  type ContextTierContent,
  type PackageRevalidation,
  type RejectedItem,
  type RejectionReason,
  type RetrievedItem,
} from "./types.ts";
import { authorize } from "./policy.ts";
import { compressItems } from "./compression.ts";
import { ContextRetrieval, type ExternalCandidate } from "./retrieval.ts";
import type { ContextRepository } from "./repository.ts";

export interface AssembleRequest {
  grant: ContextGrant;
  queryIntent: string;
  query: string;
  tiers?: readonly ContextTier[];
  lexicalOnly?: boolean;
  /** Phase 6 · T1 — "deep" also ranks externalized originals. */
  depth?: "progressive" | "deep";
  /** Link the package to a durable run for checkpointing. */
  runId?: string;
  now?: number;
}

export class ContextAssembler {
  constructor(
    private readonly repo: ContextRepository,
    private readonly retrieval: ContextRetrieval,
  ) {}

  /**
   * Build a context package. Never throws — a failure produces a degraded
   * package with an explicit reason, because a silent empty context is worse
   * than a stated partial one.
   */
  async assemble(req: AssembleRequest, extra: readonly ExternalCandidate[] = []): Promise<ContextPackage> {
    const now = req.now ?? Date.now();
    const packageId = `pkg_${randomUUID().slice(0, 12)}`;
    const degradedReasons: string[] = [];
    let rejected: RejectedItem[] = [];
    let items: RetrievedItem[] = [];

    try {
      const result = await this.retrieval.retrieve(
        {
          queryIntent: req.queryIntent,
          query: req.query,
          grant: req.grant,
          tiers: req.tiers,
          lexicalOnly: req.lexicalOnly,
          depth: req.depth,
          now,
        },
        extra,
      );
      items = result.items;
      rejected = result.rejected;
      degradedReasons.push(...result.degradedReasons);
    } catch (e) {
      degradedReasons.push(`retrieval failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ── Group into tiers, preserving retrieval order within each ──────────
    const byTier = new Map<ContextTier, RetrievedItem[]>();
    for (const ri of items) {
      const arr = byTier.get(ri.tier) ?? [];
      arr.push(ri);
      byTier.set(ri.tier, arr);
    }

    // Deterministic tier order for the package.
    const tierOrder: ContextTier[] = [
      "instructions",
      "long_term_memory",
      "project_knowledge",
      "evidence",
      "artifacts",
      "task_summary",
      "recent",
      "immediate",
    ];

    const tiers: ContextTierContent[] = [];
    let totalChars = 0;
    let totalItems = 0;

    for (const tier of tierOrder) {
      const tierItems = byTier.get(tier);
      if (!tierItems || tierItems.length === 0) continue;

      const policy = TIER_POLICIES[tier];
      let chars = tierItems.reduce((n, r) => n + r.item.content.length, 0);
      let compressed = false;
      let finalItems = tierItems;

      // Over-budget tier → compress if allowed, otherwise trim from the tail.
      if (chars > policy.maxChars) {
        if (policy.compressible) {
          const result = compressItems({
            items: tierItems.map((r) => r.item),
            taskIdentity: req.queryIntent,
            maxChars: policy.maxChars,
          });
          if (result.ok && result.summary) {
            const synthetic = makeSummaryItem(result.summary, tier, tierItems, now);
            finalItems = [
              {
                item: synthetic,
                tier,
                explanation: {
                  ...tierItems[0]!.explanation,
                  policyReason: `compressed ${tierItems.length} items (preserved: ${result.preserved.join(", ")})`,
                  score: tierItems[0]!.explanation.score,
                },
              },
            ];
            chars = synthetic.content.length;
            compressed = true;
          } else {
            // Compression could not preserve evidence → keep originals, trim tail.
            degradedReasons.push(
              `tier "${tier}" over budget and compression refused (${result.reason ?? "unknown"}) — oldest items dropped`,
            );
            ({ items: finalItems, chars } = trimToBudget(tierItems, policy.maxChars));
          }
        } else {
          ({ items: finalItems, chars } = trimToBudget(tierItems, policy.maxChars));
          degradedReasons.push(`tier "${tier}" trimmed to fit its ${policy.maxChars}-char budget`);
        }
      }

      // Package-level budget.
      if (totalChars + chars > req.grant.maxChars) {
        const remaining = req.grant.maxChars - totalChars;
        if (remaining <= 0) {
          degradedReasons.push(`tier "${tier}" omitted — package character budget exhausted`);
          for (const r of finalItems) {
            if (rejected.length < CONTEXT_BOUNDS.maxRejectedRecorded) {
              rejected.push({ itemId: r.item.id, reason: "budget_exhausted", detail: "package char budget" });
            }
          }
          continue;
        }
        ({ items: finalItems, chars } = trimToBudget(finalItems, remaining));
        degradedReasons.push(`tier "${tier}" trimmed by package character budget`);
      }

      if (totalItems + finalItems.length > req.grant.maxItems) {
        const room = Math.max(0, req.grant.maxItems - totalItems);
        finalItems = finalItems.slice(0, room);
        chars = finalItems.reduce((n, r) => n + r.item.content.length, 0);
        if (room === 0) {
          degradedReasons.push(`tier "${tier}" omitted — package item budget exhausted`);
          continue;
        }
        degradedReasons.push(`tier "${tier}" trimmed by package item budget`);
      }

      if (finalItems.length === 0) continue;

      tiers.push({ tier, items: finalItems, compressed, chars });
      totalChars += chars;
      totalItems += finalItems.length;
    }

    const hash = contentHash(
      tiers.flatMap((t) => t.items.map((r) => `${r.item.id}@${r.item.version}`)).concat([req.grant.auditRef]),
    );

    const pkg: ContextPackage = {
      packageId,
      version: 1,
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      createdAt: now,
      grant: req.grant,
      queryIntent: req.queryIntent,
      tiers,
      rejected: rejected.slice(0, CONTEXT_BOUNDS.maxRejectedRecorded),
      totalChars,
      totalItems,
      degraded: degradedReasons.length > 0,
      degradedReasons,
      contentHash: hash,
    };

    // Persist for checkpoint/resume (ids + metadata only — bodies stay in place).
    try {
      this.repo.savePackage(pkg, { runId: req.runId });
    } catch {
      /* persistence is best-effort */
    }

    return pkg;
  }

  /**
   * Revalidate a package after a resume (§8.4 / §11.5).
   *
   * Re-checks EVERY item against current consent, revocation, scope, and
   * freshness. A resumed task must never silently use revoked context.
   */
  revalidate(pkg: ContextPackage, opts: { now?: number } = {}): ContextPackage {
    const now = opts.now ?? Date.now();
    const droppedItemIds: string[] = [];
    const reasons: RejectionReason[] = [];

    // One bulk query for the revocation ledger.
    const allIds = pkg.tiers.flatMap((t) => t.items.map((r) => r.item.id));
    let revokedSet = new Set<string>();
    try {
      revokedSet = this.repo.revokedAmong(allIds);
    } catch {
      /* ledger unavailable — per-item checks below still apply */
    }

    const tiers: ContextTierContent[] = [];
    let totalChars = 0;
    let totalItems = 0;

    for (const tierContent of pkg.tiers) {
      const kept: RetrievedItem[] = [];
      for (const ri of tierContent.items) {
        // 1. Revocation ledger.
        if (revokedSet.has(ri.item.id)) {
          droppedItemIds.push(ri.item.id);
          reasons.push("revoked");
          continue;
        }
        // 2. Re-read the item — content, consent, or scope may have changed.
        let current: ContextItem | null = null;
        try {
          current = this.repo.getItem(ri.item.id);
        } catch {
          current = null;
        }
        // Items sourced externally (e.g. adapted user_memory) won't be in the
        // repo; fall back to the snapshot but still re-run authorization.
        const check = current ?? ri.item;

        const decision = authorize(check, pkg.grant, { tier: ri.tier, now });
        if (!decision.allowed) {
          droppedItemIds.push(ri.item.id);
          reasons.push(decision.reason);
          continue;
        }

        // 3. Version drift — the body changed since the package was built.
        if (current && current.version !== ri.item.version) {
          kept.push({
            item: current,
            tier: ri.tier,
            explanation: {
              ...ri.explanation,
              policyReason: `${ri.explanation.policyReason} · revalidated: content changed (v${ri.item.version}→v${current.version})`,
            },
          });
          continue;
        }

        kept.push(current ? { ...ri, item: current } : ri);
      }

      if (kept.length === 0) continue;
      const chars = kept.reduce((n, r) => n + r.item.content.length, 0);
      tiers.push({ ...tierContent, items: kept, chars });
      totalChars += chars;
      totalItems += kept.length;
    }

    const revalidation: PackageRevalidation = {
      at: now,
      droppedItemIds,
      reasons,
      stillValid: droppedItemIds.length === 0,
      note:
        droppedItemIds.length === 0
          ? "all items revalidated successfully"
          : `${droppedItemIds.length} item(s) removed on resume: ${[...new Set(reasons)].join(", ")}`,
    };

    const next: ContextPackage = {
      ...pkg,
      version: pkg.version + 1,
      tiers,
      totalChars,
      totalItems,
      contentHash: contentHash(
        tiers.flatMap((t) => t.items.map((r) => `${r.item.id}@${r.item.version}`)).concat([pkg.grant.auditRef]),
      ),
      revalidation,
      degraded: pkg.degraded || droppedItemIds.length > 0,
      degradedReasons: droppedItemIds.length
        ? [...pkg.degradedReasons, revalidation.note]
        : pkg.degradedReasons,
    };

    try {
      this.repo.savePackage(next);
    } catch {
      /* best-effort */
    }

    return next;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function trimToBudget(
  items: readonly RetrievedItem[],
  maxChars: number,
): { items: RetrievedItem[]; chars: number } {
  const out: RetrievedItem[] = [];
  let chars = 0;
  for (const r of items) {
    const c = r.item.content.length;
    if (chars + c > maxChars) continue;
    out.push(r);
    chars += c;
  }
  return { items: out, chars };
}

/** Wrap a compression result as a synthetic task-context item. */
function makeSummaryItem(
  summary: string,
  tier: ContextTier,
  sources: readonly RetrievedItem[],
  now: number,
): ContextItem {
  const first = sources[0]!.item;
  return {
    id: `sum_${contentHash([summary])}`,
    version: 1,
    type: "task_context",
    content: summary,
    title: `Compressed ${tier} (${sources.length} items)`,
    scope: first.scope,
    // A summary is model-free but still derived — never claims more trust than
    // the weakest source it folded.
    trustStatus: sources.reduce<ContextItem["trustStatus"]>(
      (lowest, r) => (rankOf(r.item.trustStatus) < rankOf(lowest) ? r.item.trustStatus : lowest),
      "approved_memory",
    ),
    consentState: "approved",
    provenanceKind: "system",
    provenanceRef: sources.map((r) => r.item.id).join(","),
    actorKind: "system",
    actorName: "xr-compression",
    freshness: {
      label: "fresh",
      createdAt: now,
      updatedAt: now,
      sourceObservedAt: null,
      staleAfter: null,
      expiresAt: null,
      supersededBy: null,
      reason: "generated now from current items",
    },
    uncertainty: {
      confidence: "medium",
      contradictedBy: [],
      userConfirmed: false,
      openQuestions: [],
    },
    sensitivity: sources.reduce<ContextItem["sensitivity"]>(
      (worst, r) => (sensRank(r.item.sensitivity) > sensRank(worst) ? r.item.sensitivity : worst),
      "public",
    ),
    retention: "task",
    links: { derivedFrom: sources.map((r) => r.item.id).join(",") },
    indexState: "none",
    embeddingSpace: null,
    tags: ["compressed"],
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
  };
}

function rankOf(t: ContextItem["trustStatus"]): number {
  return { trusted_instruction: 5, approved_memory: 4, source_evidence: 3, generated_synthesis: 2, untrusted_external: 1, unknown: 0 }[t];
}

function sensRank(s: ContextItem["sensitivity"]): number {
  return { public: 0, internal: 1, unknown: 2, private: 3, secret: 4 }[s];
}
