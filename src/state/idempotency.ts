/**
 * XR Phase 1 — Claim-first idempotency / dedup slots (T5).
 *
 * Effective exactly-once for external effects, layered on durability:
 *
 *   claim → run effect → complete
 *
 * The slot is INSERTed BEFORE the side effect (claim-first). If the process
 * crashes mid-effect, the slot is left `pending` and a retry can decide:
 *   - effect is naturally idempotent / keyed-idempotent → safe to re-run;
 *   - effect is non-idempotent → DO NOT re-run; mark `requires_reconciliation`
 *     (at-most-once + compensation), surfaced to the operator.
 *
 * The table is created by migration 1 (see src/state/migrations.ts) and is
 * therefore reversibly migratable (T12).
 */

import type { WorkspaceStore } from "./workspace-store.ts";

export type IdempotencySlotState =
  | "pending"
  | "completed"
  | "failed"
  | "requires_reconciliation";

export interface IdempotencySlot {
  slotKey: string;
  kind: string;
  state: IdempotencySlotState;
  effectRef?: string;
  resultJson?: string;
  runId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClaimResult {
  /** true when THIS caller is authorized to run the effect now. */
  proceed: boolean;
  /** Replayable cached result when the slot was already completed. */
  cachedResult?: string;
  /** True when the slot was left pending by a crashed run. */
  crashedPending?: boolean;
  /** True when the effect must NOT be re-run (compensation required). */
  requiresReconciliation?: boolean;
}

const TABLE = "idempotency_slots";

export class IdempotencyStore {
  constructor(private readonly store: WorkspaceStore) {}

  /**
   * Claim-first: INSERT the slot BEFORE the effect. Returns `proceed` only to
   * the caller that won the insert (cross-process safe via the UNIQUE key +
   * single-writer gate).
   */
  claim(slotKey: string, kind: string, runId?: string): ClaimResult {
    let proceed = false;
    let cachedResult: string | undefined;
    let crashedPending = false;
    let requiresReconciliation = false;
    this.store.write(() => {
      const existing = this.getUnsafe(slotKey);
      if (!existing) {
        this.store
          .prepare(
            `INSERT INTO ${TABLE} (slot_key, kind, state, run_id, created_at, updated_at)
             VALUES (?, ?, 'pending', ?, ?, ?)`,
          )
          .run(slotKey, kind, runId ?? null, Date.now(), Date.now());
        proceed = true;
        return;
      }
      switch (existing.state) {
        case "completed":
          cachedResult = existing.resultJson ?? undefined;
          return;
        case "pending":
          // A previous run crashed between claim and completion.
          crashedPending = true;
          proceed = false;
          return;
        case "requires_reconciliation":
          requiresReconciliation = true;
          proceed = false;
          return;
        default:
          // failed → the caller may retry; keep the slot, update the run id.
          proceed = true;
          this.store
            .prepare(`UPDATE ${TABLE} SET run_id = ?, updated_at = ? WHERE slot_key = ?`)
            .run(runId ?? null, Date.now(), slotKey);
          return;
      }
    });
    return { proceed, cachedResult, crashedPending, requiresReconciliation };
  }

  /** Mark a slot completed with the cached result (dedup replay point). */
  complete(slotKey: string, resultJson?: string, effectRef?: string): void {
    this.store.write(() => {
      this.store
        .prepare(
          `UPDATE ${TABLE} SET state='completed', result_json=?, effect_ref=?, updated_at=? WHERE slot_key=?`,
        )
        .run(resultJson ?? null, effectRef ?? null, Date.now(), slotKey);
    });
  }

  /** Mark a slot failed (retryable later). */
  fail(slotKey: string, error?: string): void {
    this.store.write(() => {
      this.store
        .prepare(`UPDATE ${TABLE} SET state='failed', result_json=?, updated_at=? WHERE slot_key=?`)
        .run(error ? JSON.stringify({ error }) : null, Date.now(), slotKey);
    });
  }

  /**
   * A non-idempotent effect whose run was interrupted: never re-run it.
   * This is the at-most-once + compensation decision point (T5).
   */
  requireReconciliation(slotKey: string, reason: string): void {
    this.store.write(() => {
      this.store
        .prepare(
          `UPDATE ${TABLE} SET state='requires_reconciliation', result_json=?, updated_at=? WHERE slot_key=?`,
        )
        .run(JSON.stringify({ reason }), Date.now(), slotKey);
    });
  }

  get(slotKey: string): IdempotencySlot | null {
    return this.getUnsafe(slotKey);
  }

  /** Read WITHOUT opening a transaction (must be called inside write or on its own). */
  private getUnsafe(slotKey: string): IdempotencySlot | null {
    const row = this.store
      .prepare(
        `SELECT slot_key, kind, state, effect_ref, result_json, run_id, created_at, updated_at
         FROM ${TABLE} WHERE slot_key = ?`,
      )
      .get(slotKey) as {
        slot_key: string;
        kind: string;
        state: IdempotencySlotState;
        effect_ref: string | null;
        result_json: string | null;
        run_id: string | null;
        created_at: number;
        updated_at: number;
      } | null;
    if (!row) return null;
    return {
      slotKey: row.slot_key,
      kind: row.kind,
      state: row.state,
      effectRef: row.effect_ref ?? undefined,
      resultJson: row.result_json ?? undefined,
      runId: row.run_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Count of slots in a state (test/operator tooling). */
  count(state?: IdempotencySlotState): number {
    if (state) {
      return (
        (this.store
          .prepare(`SELECT COUNT(*) c FROM ${TABLE} WHERE state = ?`)
          .get(state) as { c: number } | null)?.c ?? 0
      );
    }
    return (this.store.prepare(`SELECT COUNT(*) c FROM ${TABLE}`).get() as { c: number } | null)?.c ?? 0;
  }

  /** All slots (bounded, newest first). */
  list(limit = 100): IdempotencySlot[] {
    return (this.store
      .prepare(
        `SELECT slot_key, kind, state, effect_ref, result_json, run_id, created_at, updated_at
         FROM ${TABLE} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit) as Array<{
        slot_key: string;
        kind: string;
        state: IdempotencySlotState;
        effect_ref: string | null;
        result_json: string | null;
        run_id: string | null;
        created_at: number;
        updated_at: number;
      }>)
      .map((r) => ({
        slotKey: r.slot_key,
        kind: r.kind,
        state: r.state,
        effectRef: r.effect_ref ?? undefined,
        resultJson: r.result_json ?? undefined,
        runId: r.run_id ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
  }
}
