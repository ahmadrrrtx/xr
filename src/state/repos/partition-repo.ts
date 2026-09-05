/**
 * XR Phase 6 · Step 2 — Budget Partitions (Governor v2).
 *
 * ── The defect this closes (F-12, P1 half) ──────────────────────────────────
 *
 * `MultiAgentService.taskRunOptions` handed EVERY worker a copy of the full
 * root budget (`budget: req.budget`). A 5-worker research workflow with a
 * $0.50 ceiling could therefore spend $2.50. No per-worker ceiling was a lie
 * — each worker honestly believed $0.50 was ITS ceiling. The aggregate spend
 * was simply never bounded by anything.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 *
 *   openTask(taskId, root)         root envelope = the ceiling for the WHOLE tree
 *   partition(taskId, children)    Σ child caps ≤ root cap — enforced INSIDE the
 *                                  partition write transaction, deterministically,
 *                                  from template role weights (config)
 *   admit(taskId, childId, est)    child cap AND root cap checked atomically
 *                                  against settled consumption + every child's
 *                                  in-flight estimates, in ONE write transaction
 *   commit / release               settle against actuals / cancel in-flight
 *
 * The invariant that makes "unlimited delegation" impossible: a worker's
 * ceiling is its PARTITION, never a copy of the root; the root envelope is
 * reached by summing partitions, and the sum is capped at partition time. A
 * model, a prompt injection, or a compromised worker cannot enlarge a cap —
 * caps live in this ledger, not in the request (single writer = race-safe,
 * same guarantee the P2 reservation primitive gave the global cap).
 *
 * Crash honesty: in-flight rows expire through the same TTL sweep pattern as
 * `reservations`; a kill -9 between admit and commit releases the estimate,
 * settled consumption remains, so resume cannot double-spend.
 *
 * "Unlimited" dimensions (0 or absent) mean NO ceiling in that dimension —
 * exactly the local/free-model semantics of `CostGovernor`. The ledger still
 * meters consumption on them, so accounting stays honest either way.
 */

import { randomUUID } from "node:crypto";
import type { WorkspaceStore } from "../workspace-store.ts";

/** Narrow statement view over the unified store (same connection, same WriteGate). */
interface Stmt {
  get<T = unknown>(...params: unknown[]): T | null;
  all<T = unknown>(...params: unknown[]): T[];
  run(...params: unknown[]): void;
}

const PARTITIONS = "budget_partitions";
const RESERVATIONS = "partition_reservations";

/** Micro-dollar arithmetic — never float-add money. */
const MICRO = 1_000_000;
const toMicro = (usd: number): number => Math.round(Math.max(0, usd) * MICRO);
const fromMicro = (usdMicro: number): number => usdMicro / MICRO;

export interface BudgetSpec {
  /** USD ceiling. 0/undefined = no dollar ceiling (local/free). */
  capUsd?: number;
  /** Token ceiling. 0/undefined = no token ceiling. */
  capTokens?: number;
}

export interface PartitionRow {
  partitionId: string;
  taskId: string;
  childId: string;
  agentId: string | null;
  capUsd: number;
  capTokens: number;
  consumedUsd: number;
  consumedTokens: number;
  status: "open" | "closed";
}

export interface ChildSpec {
  childId: string;
  agentId?: string;
  /** Relative weight within the template (from role weights config). */
  weight: number;
}

export type AdmitResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: string };

export const ROOT_CHILD_ID = "@root";

/** Row layout of `budget_partitions`. */
interface PartitionDbRow {
  partition_id: string;
  task_id: string;
  child_id: string;
  agent_id: string | null;
  cap_usd: number;
  cap_tokens: number;
  consumed_usd: number;
  consumed_tokens: number;
  status: string;
  created_at: number;
  updated_at: number;
}

/**
 * Default TTL for an unsettled partition reservation. An in-flight step that
 * never settles (crash between admit and commit) must not permanently occupy
 * headroom; it also must not be released while the step is (possibly) still
 * running, so the window is generous and the settle path is explicit.
 */
export const DEFAULT_PARTITION_RESERVATION_TTL_MS = 10 * 60_000;

function sanitizeKey(k: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(k)) {
    throw new Error(`partition key rejected (unsafe characters): ${JSON.stringify(k.slice(0, 40))}`);
  }
  return k;
}

export class PartitionRepo {
  constructor(
    public readonly store: WorkspaceStore,
    private readonly reservationTtlMs: number = DEFAULT_PARTITION_RESERVATION_TTL_MS,
  ) {}

  private q(sql: string): Stmt {
    return this.store.query(sql) as unknown as Stmt;
  }

  private enabled(): boolean {
    try {
      const row = this.q(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get<{ name: string }>(PARTITIONS);
      return row !== null && row !== undefined;
    } catch {
      return false;
    }
  }

  private rowToPartition(r: PartitionDbRow): PartitionRow {
    return {
      partitionId: r.partition_id,
      taskId: r.task_id,
      childId: r.child_id,
      agentId: r.agent_id,
      capUsd: r.cap_usd,
      capTokens: r.cap_tokens,
      consumedUsd: r.consumed_usd,
      consumedTokens: r.consumed_tokens,
      status: r.status === "closed" ? "closed" : "open",
    };
  }

  /** Open (idempotently) the root envelope for a task. Resume-safe. */
  openTask(taskId: string, rootSpec: BudgetSpec): { created: boolean; envelope: PartitionRow } {
    if (!this.enabled()) throw new Error("budget partitions unavailable (migration 8 not applied)");
    const tid = sanitizeKey(taskId);
    return this.store.write(() => {
      const existing = this
        .q(`SELECT * FROM ${PARTITIONS} WHERE task_id = ? AND child_id = ?`)
        .get<PartitionDbRow>(tid, ROOT_CHILD_ID);
      if (existing) {
        return { created: false, envelope: this.rowToPartition(existing as never) };
      }
      const now = Date.now();
      const row: PartitionDbRow = {
        partition_id: `bp_${randomUUID().slice(0, 12)}`,
        task_id: tid,
        child_id: ROOT_CHILD_ID,
        agent_id: null,
        cap_usd: Math.max(0, rootSpec.capUsd ?? 0),
        cap_tokens: Math.max(0, rootSpec.capTokens ?? 0),
        consumed_usd: 0,
        consumed_tokens: 0,
        status: "open",
        created_at: now,
        updated_at: now,
      };
      this.insertRow(row);
      return { created: true, envelope: this.rowToPartition(row) };
    });
  }

  private insertRow(row: PartitionDbRow): void {
    this.store
      .query(
        `INSERT INTO ${PARTITIONS}
         (partition_id, task_id, child_id, agent_id, cap_usd, cap_tokens, consumed_usd, consumed_tokens, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.partition_id,
        row.task_id,
        row.child_id,
        row.agent_id,
        row.cap_usd,
        row.cap_tokens,
        row.consumed_usd,
        row.consumed_tokens,
        row.status,
        row.created_at,
        row.updated_at,
      );
  }

  /**
   * Issue child envelopes for `children` against the root envelope, inside ONE
   * write transaction. Deterministic largest-remainder allocation from
   * weights, in micro-dollars / whole tokens, with per-child floors when the
   * root can still afford them. Already-partitioned children are returned
   * UNCHANGED (resume must never re-cut caps under a spending tree), so a
   * re-run of `partition()` is a no-op merge, not a reset.
   *
   * Returns the allocation plus the UNALLOCATED root headroom — the headroom
   * is what supervised plan edits may draw from (Step 5), which is why the
   * allocation deliberately leaves a remainder instead of spreading it.
   */
  partition(
    taskId: string,
    children: ChildSpec[],
    opts: { floorUsd?: number; floorTokens?: number } = {},
  ): { children: PartitionRow[]; headroom: { usd: number; tokens: number }; denied: Array<{ childId: string; reason: string }> } {
    if (!this.enabled()) throw new Error("budget partitions unavailable (migration 8 not applied)");
    const tid = sanitizeKey(taskId);
    const floorUsdMicro = toMicro(opts.floorUsd ?? 0.01);
    const floorTokens = Math.max(0, Math.floor(opts.floorTokens ?? 1000));

    return this.store.write(() => {
      const root = this
        .q(`SELECT * FROM ${PARTITIONS} WHERE task_id = ? AND child_id = ?`)
        .get<PartitionDbRow>(tid, ROOT_CHILD_ID);
      if (!root) throw new Error(`no root envelope for task ${taskId} — openTask() must run first`);
      const rootUsdMicro = toMicro(root.cap_usd);
      const rootTokenCap = root.cap_tokens;

      // Children allocated so far (existing rows count toward the total — the
      // sum invariant is over EVERY child envelope that exists, ever).
      const existing = this
        .q(`SELECT * FROM ${PARTITIONS} WHERE task_id = ? AND child_id != ?`)
        .all<PartitionDbRow>(tid, ROOT_CHILD_ID)
        .map((r) => this.rowToPartition(r));
      const existingByChild = new Map(existing.map((e) => [e.childId, e]));
      let allocatedUsdMicro = existing.reduce((s, e) => s + toMicro(e.capUsd), 0);
      let allocatedTokens = existing.reduce((s, e) => s + e.capTokens, 0);

      const denied: Array<{ childId: string; reason: string }> = [];
      const pending = children.filter((c) => {
        if (existingByChild.has(c.childId)) return false; // idempotent merge
        return true;
      });

      // Deterministic largest-remainder over weights, from CURRENT headroom.
      const headUsdMicro = rootUsdMicro > 0 ? rootUsdMicro - allocatedUsdMicro : 0; // 0 root cap = unlimited USD
      const headTokens = rootTokenCap > 0 ? rootTokenCap - allocatedTokens : 0;
      const totalWeight = Math.max(
        1e-9,
        pending.reduce((s, c) => s + Math.max(0.01, c.weight), 0),
      );
      const allocations = pending.map((c) => {
        const w = Math.max(0.01, c.weight) / totalWeight;
        return {
          child: c,
          // Unlimited dimensions stay unlimited for children: a local/free
          // root has no dollar ceiling to partition, and faking one would
          // break offline-first. Meters keep running regardless.
          usdMicro: rootUsdMicro > 0 ? Math.floor(headUsdMicro * w) : 0,
          tokens: rootTokenCap > 0 ? Math.floor(headTokens * w) : 0,
        };
      });
      // Enforce per-child floors against a RUNNING allocation budget, so the
      // bumping itself can never breach the root cap. A child the root cannot
      // afford at the floor is DENIED (audited) — it will fail honestly at
      // dispatch instead of silently sharing a too-thin slice.
      let runningUsdMicro = 0;
      let runningTokens = 0;
      for (const a of allocations) {
        if (rootUsdMicro > 0) {
          if (a.usdMicro < floorUsdMicro) {
            if (runningUsdMicro + floorUsdMicro <= headUsdMicro) a.usdMicro = floorUsdMicro;
            else {
              denied.push({
                childId: a.child.childId,
                reason:
                  `root envelope cannot afford the partition floor ($${fromMicro(floorUsdMicro).toFixed(4)}) for child ${a.child.childId} ` +
                  `(headroom left: $${fromMicro(Math.max(0, headUsdMicro - runningUsdMicro)).toFixed(4)})`,
              });
              a.usdMicro = -1; // mark skipped
              continue;
            }
          }
          runningUsdMicro += a.usdMicro;
        }
        if (rootTokenCap > 0 && a.usdMicro >= 0) {
          if (a.tokens < floorTokens) {
            if (runningTokens + floorTokens <= headTokens) a.tokens = floorTokens;
            else {
              // Tokens are not the binding ceiling (a tiny slice still runs on
              // cheap local models); clamp at what remains instead of denying.
              a.tokens = Math.max(0, headTokens - runningTokens);
            }
          }
          runningTokens += a.tokens;
        }
      }

      const now = Date.now();
      const created: PartitionRow[] = [];
      for (const a of allocations) {
        if (a.usdMicro < 0) continue;
        const childId = sanitizeKey(a.child.childId);
        const row = {
          partition_id: `bp_${randomUUID().slice(0, 12)}`,
          task_id: tid,
          child_id: childId,
          agent_id: a.child.agentId ?? null,
          cap_usd: rootUsdMicro > 0 ? fromMicro(a.usdMicro) : 0,
          cap_tokens: rootTokenCap > 0 ? a.tokens : 0,
          consumed_usd: 0,
          consumed_tokens: 0,
          status: "open",
          created_at: now,
          updated_at: now,
        };
        this.insertRow(row as never);
        created.push(this.rowToPartition(row as never));
      }

      const childrenAll = [...existing, ...created];
      return {
        children: childrenAll,
        headroom: this.headroom(tid),
        denied,
      };
    });
  }

  /** Active in-flight estimate totals for a task (or one child). */
  private activeTotals(taskId: string, childId?: string): { usdMicro: number; tokens: number } {
    const where = childId
      ? `task_id = ? AND child_id = ? AND status = 'active'`
      : `task_id = ? AND status = 'active'`;
    const q = childId
      ? this.q(`SELECT COALESCE(SUM(est_usd),0) u, COALESCE(SUM(est_tokens),0) t FROM ${RESERVATIONS} WHERE ${where}`).get<{ u: number; t: number }>(taskId, childId)
      : this.q(`SELECT COALESCE(SUM(est_usd),0) u, COALESCE(SUM(est_tokens),0) t FROM ${RESERVATIONS} WHERE ${where}`).get<{ u: number; t: number }>(taskId);
    return { usdMicro: toMicro(q?.u ?? 0), tokens: Math.round(q?.t ?? 0) };
  }

  private sweepStale(taskId: string, now: number): void {
    this
      .q(
        `UPDATE ${RESERVATIONS} SET status = 'expired', updated_at = ?
         WHERE task_id = ? AND status = 'active' AND created_at < ?`,
      )
      .run(now, taskId, now - this.reservationTtlMs);
  }

  /**
   * Check-and-reserve ONE step against child ceiling AND root envelope, in a
   * single write transaction. Admissions that would breach either ceiling are
   * refused with the reason; at most the already-admitted in-flight step may
   * overshoot (the P2 allowance — a step already paid for is not clawed back).
   */
  admit(taskId: string, childId: string, estUsd: number, estTokens: number): AdmitResult {
    if (!this.enabled()) return { ok: false, reason: "partition ledger unavailable" };
    const tid = sanitizeKey(taskId);
    const cid = sanitizeKey(childId);
    const estUsdMicro = toMicro(estUsd);
    return this.store.write(() => {
      const now = Date.now();
      this.sweepStale(tid, now);

      const child = this
        .q(`SELECT * FROM ${PARTITIONS} WHERE task_id = ? AND child_id = ?`)
        .get<PartitionDbRow>(tid, cid);
      if (!child) {
        // Fail closed: a worker WITHOUT a partition may not spend. "Not
        // partitioned" is a wiring bug or a delegation the supervisor never
        // funded — either way, denial is the only honest answer.
        return { ok: false, reason: `child ${childId} has no budget partition — delegation was never funded` };
      }
      if (child!.status === "closed") {
        return { ok: false, reason: `partition for ${childId} is closed` };
      }

      const childCapUsdMicro = toMicro(child!.cap_usd);
      const childCapTokens = child!.cap_tokens;
      const childActive = this.activeTotals(tid, cid);
      const childUsedUsdMicro = toMicro(child!.consumed_usd) + childActive.usdMicro;
      const childUsedTokens = Math.round(child!.consumed_tokens) + childActive.tokens;

      if (childCapUsdMicro > 0 && childUsedUsdMicro + estUsdMicro > childCapUsdMicro) {
        return {
          ok: false,
          reason:
            `partition ceiling reached for ${childId}: $${fromMicro(childUsedUsdMicro).toFixed(4)} spent/reserved of $${fromMicro(childCapUsdMicro).toFixed(4)}`,
        };
      }
      if (childCapTokens > 0 && childUsedTokens + estTokens > childCapTokens) {
        return {
          ok: false,
          reason: `partition token ceiling reached for ${childId}: ${childUsedTokens} of ${childCapTokens} used/reserved`,
        };
      }

      // Root envelope: every child's settled consumption + every in-flight.
      const root = this
        .q(`SELECT * FROM ${PARTITIONS} WHERE task_id = ? AND child_id = ?`)
        .get<PartitionDbRow>(tid, ROOT_CHILD_ID);
      if (root) {
        const rootCapUsdMicro = toMicro(root.cap_usd);
        const rootCapTokens = root.cap_tokens;
        const taskActive = this.activeTotals(tid);
        const children = this
          .q(`SELECT consumed_usd, consumed_tokens FROM ${PARTITIONS} WHERE task_id = ? AND child_id != ?`)
          .all<{ consumed_usd: number; consumed_tokens: number }>(tid, ROOT_CHILD_ID);
        const settledUsdMicro = children.reduce((s, c) => s + toMicro(c.consumed_usd), 0);
        const settledTokens = children.reduce((s, c) => s + Math.round(c.consumed_tokens), 0);
        if (rootCapUsdMicro > 0 && settledUsdMicro + taskActive.usdMicro + estUsdMicro > rootCapUsdMicro) {
          return {
            ok: false,
            reason:
              `root envelope reached for task ${taskId}: $${fromMicro(settledUsdMicro + taskActive.usdMicro).toFixed(4)} spent/reserved of $${fromMicro(rootCapUsdMicro).toFixed(4)} — no worker may exceed the tree ceiling, whatever its partition says`,
          };
        }
        if (rootCapTokens > 0 && settledTokens + taskActive.tokens + estTokens > rootCapTokens) {
          return {
            ok: false,
            reason: `root token envelope reached for task ${taskId}: ${settledTokens + taskActive.tokens} of ${rootCapTokens} used/reserved`,
          };
        }
      }

      const reservationId = `pr_${randomUUID().slice(0, 12)}`;
      this.store
        .query(
          `INSERT INTO ${RESERVATIONS} (id, task_id, child_id, est_usd, est_tokens, status, created_at, updated_at)
           VALUES (?,?,?,?,?, 'active', ?, ?)`,
        )
        .run(reservationId, tid, cid, estUsd, estTokens, now, now);
      return { ok: true, reservationId };
    });
  }

  /** Settle an admitted step against ACTUAL usage (moves est → consumed). */
  commit(taskId: string, childId: string, reservationId: string, actualUsd: number, actualTokens: number): void {
    if (!this.enabled()) return;
    const tid = sanitizeKey(taskId);
    const cid = sanitizeKey(childId);
    const usd = Math.max(0, actualUsd);
    const tokens = Math.max(0, Math.floor(actualTokens));
    this.store.write(() => {
      const r = this
        .q(`SELECT id, status FROM ${RESERVATIONS} WHERE id = ? AND task_id = ? AND child_id = ?`)
        .get<{ id: string; status: string }>(reservationId, tid, cid);
      if (!r || r.status !== "active") return; // already settled/expited — settle exactly once
      const now = Date.now();
      this
        .q(`UPDATE ${RESERVATIONS} SET status = 'settled', est_usd = ?, est_tokens = ?, updated_at = ? WHERE id = ?`)
        .run(usd, tokens, now, reservationId);
      // settled usage moves into the LEDGER (consumed), where the row's est
      // no longer double-counts (status != 'active' excludes it from totals).
      const bump = `UPDATE ${PARTITIONS}
           SET consumed_usd = consumed_usd + ?, consumed_tokens = consumed_tokens + ?, updated_at = ?
           WHERE task_id = ? AND child_id = ?`;
      this.q(bump).run(usd, tokens, now, tid, cid);
      this.q(bump).run(usd, tokens, now, tid, ROOT_CHILD_ID);
    });
  }

  /** Cancel an in-flight estimate (denied/aborted step). */
  release(taskId: string, childId: string, reservationId: string): void {
    if (!this.enabled()) return;
    this.store
      .query(`UPDATE ${RESERVATIONS} SET status = 'released', updated_at = ? WHERE id = ? AND task_id = ? AND child_id = ? AND status = 'active'`)
      .run(Date.now(), reservationId, sanitizeKey(taskId), sanitizeKey(childId));
  }

  /** Every partition row of a task (root first) — WorkflowRecord display/audit. */
  listPartitions(taskId: string): PartitionRow[] {
    if (!this.enabled()) return [];
    const rows = this
      .q(`SELECT * FROM ${PARTITIONS} WHERE task_id = ? ORDER BY (child_id = '@root') DESC, child_id ASC`)
      .all<PartitionDbRow>(sanitizeKey(taskId));
    return rows.map((r) => this.rowToPartition(r));
  }

  /** Unallocated root headroom (settled + reserved excluded). Fragment edits consume from this. */
  headroom(taskId: string): { usd: number; tokens: number } {
    if (!this.enabled()) return { usd: 0, tokens: 0 };
    const tid = sanitizeKey(taskId);
    const root = this
      .q(`SELECT cap_usd, cap_tokens FROM ${PARTITIONS} WHERE task_id = ? AND child_id = ?`)
      .get<{ cap_usd: number; cap_tokens: number }>(tid, ROOT_CHILD_ID);
    if (!root) return { usd: 0, tokens: 0 };
    const children = this
      .q(`SELECT cap_usd, cap_tokens FROM ${PARTITIONS} WHERE task_id = ? AND child_id != ?`)
      .all<{ cap_usd: number; cap_tokens: number }>(tid, ROOT_CHILD_ID);
    const allocUsdMicro = children.reduce((s, c) => s + toMicro(c.cap_usd), 0);
    const allocTokens = children.reduce((s, c) => s + c.cap_tokens, 0);
    const rootUsdMicro = toMicro(root.cap_usd);
    return {
      usd: rootUsdMicro > 0 ? Math.max(0, fromMicro(rootUsdMicro - allocUsdMicro)) : Number.POSITIVE_INFINITY,
      tokens: root.cap_tokens > 0 ? Math.max(0, root.cap_tokens - allocTokens) : Number.POSITIVE_INFINITY,
    };
  }

  /** Mark the whole tree closed (terminal workflow state) — admits then deny. */
  close(taskId: string): void {
    if (!this.enabled()) return;
    const tid = sanitizeKey(taskId);
    this
      .q(`UPDATE ${PARTITIONS} SET status = 'closed', updated_at = ? WHERE task_id = ? AND status = 'open'`)
      .run(Date.now(), tid);
  }
}
