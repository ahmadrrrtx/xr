/**
 * XR 4.6 — Phase 6 · T4: conflict resolution and selective forgetting.
 *
 * Detection already existed (poison.ts `detectConflicts`). What was missing is
 * *resolution*: a durable, user-owned, undoable decision record — and a way to
 * forget selectively without silent deletion.
 *
 * THE RULES
 * ─────────
 *   1. SUPPRESSION IS AUTOMATIC ONLY FOR SUPERSESSION. An explicit correction
 *      (`supersededBy`) resolves deterministically: the correction wins. This
 *      is recorded as a `decided_by: "policy"` resolution so it is inspectable
 *      and undoable — it is not "silent".
 *   2. CONTRADICTIONS REQUIRE A USER. XR never picks a winner between two
 *      user-asserted items. Both stay retrievable and honestly labelled until
 *      the user resolves (`keep_a | keep_b | stale | both`).
 *   3. NOTHING IS DELETED SILENTLY. A "loser" becomes stale/superseded — the
 *      precedence changes; the row stays inspectable. "Forgetting" is a hard
 *      expiry (not retrievable, still present until pruned) and goes through
 *      the ops ledger so it is undoable.
 *   4. RESOLUTION NEVER RAISES TRUST. Resolving a contradiction cannot turn
 *      model synthesis into user memory, or memory into instruction.
 *
 * Deterministic; no model is involved in any decision.
 */

import { detectConflicts, type ConflictFinding } from "./poison.ts";
import type { ContextRepository, ResolutionRow } from "./repository.ts";
import { trustRank, type ContextItem } from "./types.ts";

export type ResolutionKind = "keep_a" | "keep_b" | "stale" | "both";

export interface ResolutionOutcome {
  ok: boolean;
  resolutionId?: string;
  /** The item whose precedence fell (marked superseded/stale — never deleted). */
  loserId?: string;
  /** The item that keeps precedence. */
  winnerId?: string;
  resolution?: ResolutionKind;
  reason?: string;
}

export interface ForgetOutcome {
  ok: boolean;
  forgottenUntilPrune: boolean;
  opId?: string;
  reason?: string;
}

/** A live finding paired with whether a resolution already covers it. */
export interface OpenConflict {
  finding: ConflictFinding;
  resolution: ResolutionRow | null;
}

export class ConflictResolver {
  constructor(
    private readonly repo: ContextRepository,
    private readonly workspaceId: string,
  ) {}

  /**
   * Scan a candidate set for conflicts and report which are unresolved.
   * Only checks resolutions already on record — no mutation.
   */
  openConflicts(candidates: readonly ContextItem[]): OpenConflict[] {
    return detectConflicts(candidates).map((finding) => ({
      finding,
      resolution:
        this.repo.resolutionFor(finding.itemId, finding.otherId) ??
        (finding.kind === "superseded"
          // Supersession is AUTO-RESOLVED by policy (rule 1); synthesize the
          // policy marker so callers see it is decided, not open.
          ? ({
              id: "policy",
              workspace_id: this.workspaceId,
              item_a: finding.itemId,
              item_b: finding.otherId,
              kind: "superseded",
              resolution: `keep:${finding.prefer}`,
              decided_by: "policy",
              reason: "explicit correction supersedes the original",
              created_at: 0,
              undone_at: null,
            } satisfies ResolutionRow)
          : null),
    }));
  }

  /**
   * Apply a resolution between two items.
   *
   * decidedBy: "user" | "policy:superseded" | "policy:stale".
   * The losing item receives a `supersededBy` pointer (deterministic precedence)
   * — its content is preserved; only precedence changes.
   *
   * Returns the undo op id when `recordUndo` is provided (service wires this).
   */
  resolve(
    a: ContextItem,
    b: ContextItem,
    kind: ResolutionKind,
    opts: {
      decidedBy?: string;
      reason: string;
      now?: number;
      /** Undo hook: captures before-images. Provided by ContextService. */
      recordUndo?: (target: ContextItem, after: { supersededBy: string | null }) => string;
    },
  ): ResolutionOutcome {
    const now = opts.now ?? Date.now();
    const decidedBy = opts.decidedBy ?? "user";

    // Rule 4: resolution never changes trust — assert it holds for both items
    // (we only touch precedence fields).
    const before: Array<[string, number]> = [
      [a.id, trustRank(a.trustStatus)],
      [b.id, trustRank(b.trustStatus)],
    ];

    let loser: ContextItem | null = null;
    let winner: ContextItem | null = null;
    let resolutionLabel: string;

    switch (kind) {
      case "keep_a":
        winner = a;
        loser = b;
        resolutionLabel = `keep:${a.id}`;
        break;
      case "keep_b":
        winner = b;
        loser = a;
        resolutionLabel = `keep:${b.id}`;
        break;
      case "stale":
        // Both stand down: the stale item is the older one deterministically;
        // ties keep both retrievable (resolution "both").
        if (a.updatedAt === b.updatedAt) {
          resolutionLabel = "both";
          break;
        }
        loser = a.updatedAt < b.updatedAt ? a : b;
        winner = a.updatedAt < b.updatedAt ? b : a;
        resolutionLabel = `keep:${winner.id}`;
        break;
      case "both":
        resolutionLabel = "both";
        break;
    }

    if (loser && winner) {
      // Precedence change only. `supersededBy` is the existing, honest marker:
      // retrieval drops the loser deterministically, inspection keeps it.
      opts.recordUndo?.(loser, { supersededBy: winner.id });
      this.repo.supersede(loser.id, winner.id, { now });
    }

    // Verify rule 4: trust is untouched.
    const ra = this.repo.getItem(a.id);
    const rb = this.repo.getItem(b.id);
    for (const [id, rank] of before) {
      const after = id === a.id ? ra : rb;
      if (after && trustRank(after.trustStatus) !== rank) {
        return { ok: false, reason: `refusing: resolution would change trust of ${id} — violation` };
      }
    }

    const resolutionId = this.repo.saveResolution({
      workspaceId: this.workspaceId,
      itemA: a.id,
      itemB: b.id,
      kind: "contradiction",
      resolution: resolutionLabel,
      decidedBy,
      reason: boundReason(opts.reason),
      now,
    });

    return {
      ok: true,
      resolutionId,
      ...(loser ? { loserId: loser.id } : {}),
      ...(winner ? { winnerId: winner.id } : {}),
      resolution: kind,
    };
  }

  /**
   * Selective forgetting: hard-expire one item (not retrievable from now,
   * still physically present until `pruneExpired`). The ops ledger makes this
   * reversible (rule 3).
   */
  forget(
    item: ContextItem,
    opts: { actor?: string; reason: string; now?: number; recordUndo: (item: ContextItem, afterExpiry: number) => string },
  ): ForgetOutcome {
    const now = opts.now ?? Date.now();
    const after = this.repo.rawRow("context_items", item.id);
    if (!after) return { ok: false, forgottenUntilPrune: false, reason: `item ${item.id} not found` };
    if (typeof item.freshness.expiresAt === "number" && item.freshness.expiresAt <= now) {
      return { ok: false, forgottenUntilPrune: false, reason: "already expired" };
    }
    const opId = opts.recordUndo(item, now);
    this.repo.expireItem(item.id, now, now);
    return { ok: true, forgottenUntilPrune: true, ...(opId ? { opId } : {}) };
  }
}

function boundReason(s: string): string {
  return s.length > 240 ? s.slice(0, 239) + "…" : s;
}
