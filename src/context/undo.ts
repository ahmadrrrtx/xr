/**
 * XR 4.6 — Phase 6 · T6: the undo/evidence ledger.
 *
 * WHY THIS EXISTS
 * ───────────────
 * User control over memory (Art. VIII/XXI; Part 22) is incomplete while every
 * mutation is one-way. Correct/revoke/approve/delete/forget/resolve — and the
 * same operations on legacy `user_memory` rows — now record a before-image in
 * an append-only ops ledger, so ANY of them can be undone exactly.
 *
 * THE RULES
 * ─────────
 *   1. UNDO RESTORES DATA, NEVER AUTHORITY. It reinstates a prior row state;
 *      it cannot create instructions, raise trust, or fabricate consent that
 *      never existed (whatever the row held is what comes back).
 *   2. THE LEDGER IS EVIDENCE. Ops are append-only; an undo appends its own
 *      op (never rewrites history) — the same discipline as the audit chain.
 *   3. BEFORE-IMAGES ARE EXACT. Snapshots are raw rows produced by
 *      `repo.rawRow`, restored byte-for-byte with INSERT OR REPLACE. A row
 *      created by an op is removed by its undo (before == null).
 *   4. ONE LEDGER PER STORE — the ops table lives inside the single context
 *      database; legacy user_memory rows are snapshots of the same workspace
 *      store, not a second ledger.
 *
 * Deterministic; never on the retrieval hot path.
 */

import type { ContextRepository, OpsRow } from "./repository.ts";

export type LedgerOp =
  | "correct"
  | "revoke"
  | "approve"
  | "delete"
  | "forget"
  | "resolve"
  | "lifecycle_promote"
  | "lifecycle_demote"
  | "memory_correct"
  | "memory_revoke"
  | "memory_remove"
  | "memory_approve";

export type LedgerTarget = "context_items" | "user_memory" | "context_conflict_resolutions";

export interface UndoOutcome {
  ok: boolean;
  undoneOpId?: string;
  /** The ledger id of the undo op itself (append-only evidence). */
  undoOpId?: string;
  restoredTarget?: { table: LedgerTarget; id: string };
  reason?: string;
}

export class UndoLedger {
  constructor(
    private readonly repo: ContextRepository,
    private readonly workspaceId: string,
  ) {}

  /**
   * Capture the before-image for a mutation that has NOT happened yet.
   * Returns the op id; call `finalize` after the mutation to attach the
   * after-image.
   */
  begin(
    op: LedgerOp,
    table: LedgerTarget,
    targetId: string,
    opts: { actor: string; reason?: string; now?: number },
  ): string {
    const before = this.repo.rawRow(table, targetId);
    return this.repo.recordOp({
      workspaceId: this.workspaceId,
      op,
      targetTable: table,
      targetId,
      before,
      after: null,
      actor: opts.actor,
      reason: opts.reason,
      now: opts.now,
    });
  }

  /** Attach the after-image to an in-flight op. */
  finalize(opId: string, table: LedgerTarget, targetId: string): void {
    const op = this.repo.getOp(opId);
    if (!op) return;
    const after = this.repo.rawRow(table, targetId);
    this.repo.recordOpFinalize(opId, after);
  }

  /** History (recent first). */
  history(opts: { includeUndone?: boolean; limit?: number } = {}): OpsRow[] {
    return this.repo.listOps(this.workspaceId, opts);
  }

  /** Most recent undoable op, for `xr context undo` with no argument. */
  latestUndoable(): OpsRow | null {
    const ops = this.repo.listOps(this.workspaceId, { limit: 50 });
    return ops.find((o) => !o.undone_at && o.op !== "undo") ?? null;
  }

  /**
   * Undo an op exactly:
   *   before == null  → the target did not exist before the op → delete it
   *   before != null  → restore the raw before-image (INSERT OR REPLACE)
   */
  undo(opId: string, opts: { actor: string; now?: number } = { actor: "user" }): UndoOutcome {
    const op = this.repo.getOp(opId);
    if (!op) return { ok: false, reason: `op ${opId} not found` };
    if (op.undone_at) return { ok: false, reason: `op ${opId} already undone` };

    const table = op.target_table as LedgerTarget;
    const now = opts.now ?? Date.now();
    const before = op.before_json ? (JSON.parse(op.before_json) as Record<string, unknown> | null) : null;

    // Append the undo op FIRST (evidence of intent), then apply. If apply
    // throws, the undo op documents the failure — never a silent state.
    const undoOpId = this.repo.recordOp({
      workspaceId: this.workspaceId,
      op: `undo ${op.op}`,
      targetTable: op.target_table,
      targetId: op.target_id,
      before: this.repo.rawRow(table, op.target_id),
      after: before, // projected post-state
      actor: opts.actor,
      reason: `undo of ${opId}`,
      now,
    });

    try {
      if (before === null) {
        this.repo.purgeRow(table, op.target_id);
      } else {
        this.repo.restoreRow(table, op.target_id, before);
      }
    } catch (e) {
      return { ok: false, reason: `undo failed to apply: ${e instanceof Error ? e.message : String(e)}` };
    }

    this.repo.markOpUndone(opId, undoOpId, now);

    // A resolution row touched by "resolve" is reversed by restoring the
    // supersession before-image (handled above); resolutions themselves are
    // marked undone when their op points at them.
    if (table === "context_conflict_resolutions") {
      this.repo.markResolutionUndone(op.target_id, undoOpId, now);
    }

    return {
      ok: true,
      undoneOpId: opId,
      undoOpId,
      restoredTarget: { table, id: op.target_id },
    };
  }
}
