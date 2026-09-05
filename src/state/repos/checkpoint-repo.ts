/**
 * XR Phase 6 · Steps 1 & 6 — the checkpoint journal.
 *
 * One row per durable task event / plain-run step, in `task_checkpoints`
 * (migration 8), written under the store's WriteGate (the single-writer
 * `BEGIN IMMEDIATE` transaction), hash-chained per task:
 *
 *     hash_n = sha256( canonicalJSON({ taskId, seq, kind, payload, prevHash: hash_{n-1} }) )
 *
 * The chain gives the durability claim its evidence: `verifyChain(taskId)`
 * proves the journal a resume consumed was not rewritten in between. Payloads
 * are BOUNDED (the same doctrine as `execution/checkpoint.ts`): an oversize
 * payload is replaced by a truncation envelope — never sliced mid-string,
 * never silently dropped.
 *
 * Consumers:
 *   · TaskRunLedger transitions (every workflow task + every plain run)
 *   · plain-run step checkpoints ({stepIdx, messages, governor, toolCallSeq})
 *   · `xr run --resume <taskId>` rebuilds from the latest `run.step` row
 *
 * Old sessions (pre-P6) simply have no rows — resume fails with an honest,
 * documented error rather than pretending.
 */

import { createHash } from "node:crypto";
import type { WorkspaceStore } from "../workspace-store.ts";

const TABLE = "task_checkpoints";

/** Max serialized payload retained per row. Larger payloads get the envelope. */
export const MAX_CHECKPOINT_PAYLOAD_CHARS = 48_000;

export type CheckpointKind =
  | "task.plan"
  | "task.start"
  | "task.step"
  | "run.step"
  | "run.terminal"
  | "task.verdict"
  | "task.resume"
  | string; // ledger transitions arrive as `task.<event>`

export interface CheckpointRow {
  taskId: string;
  seq: number;
  kind: CheckpointKind;
  payload: unknown;
  prevHash: string | null;
  hash: string;
  createdAt: number;
}

/** Canonical JSON: recursively sorted keys — the chain must not depend on key order. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(norm);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = norm((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(norm(value)) ?? "";
}

function chainHash(taskId: string, seq: number, kind: string, payloadJson: string, prevHash: string | null): string {
  return createHash("sha256")
    .update(canonicalJson({ taskId, seq, kind, payloadJson, prevHash: prevHash ?? "" }))
    .digest("hex");
}

/** Bound a payload without corrupting it: keep size, record what was dropped. */
export function boundPayload(payload: unknown): { json: string; truncated: boolean } {
  let json = "";
  try {
    json = JSON.stringify(payload);
  } catch {
    json = JSON.stringify({ unserializable: true });
  }
  if (typeof json !== "string") json = String(json);
  if (json.length <= MAX_CHECKPOINT_PAYLOAD_CHARS) return { json, truncated: false };
  const envelope = {
    truncated: true,
    originalChars: json.length,
    limitChars: MAX_CHECKPOINT_PAYLOAD_CHARS,
    // Keep the TAIL for run.step payloads — that is where the newest messages
    // are — and the HEAD for transition metadata. Both bounded, both hashed.
    head: json.slice(0, 8_000),
    payloadHash: createHash("sha256").update(json).digest("hex"),
  };
  return { json: JSON.stringify(envelope), truncated: true };
}

export interface ChainVerifyResult {
  ok: boolean;
  count: number;
  brokenAtSeq: number | null;
  reason?: string;
}

/** Narrow statement view over the unified store (same connection, same gate). */
interface Stmt {
  get<T = unknown>(...params: unknown[]): T | null;
  all<T = unknown>(...params: unknown[]): T[];
  run(...params: unknown[]): void;
}

/** Row shape returned by the checkpoint queries. */
interface Row {
  task_id: string;
  seq: number;
  kind: string;
  payload_json: string;
  prev_hash: string | null;
  hash: string;
  created_at: number;
}

export class CheckpointRepo {
  constructor(public readonly store: WorkspaceStore) {}

  private q(sql: string): Stmt {
    return this.store.query(sql) as unknown as Stmt;
  }

  /** True when migration 8 has run (pre-migration fixture stores stay inert). */
  private enabled(): boolean {
    try {
      const row = this.q(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get<{ name: string }>(TABLE);
      return row !== null && row !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Append one checkpoint row. `seq` is assigned by reading the task's current
   * head INSIDE the same write transaction, so two racing appends for the
   * same task serialize on the WriteGate and cannot interleave sequence
   * numbers. Returns the persisted row header (seq + hash) for chaining UIs.
   */
  append(taskId: string, kind: CheckpointKind, payload: unknown): { seq: number; hash: string; truncated: boolean } | null {
    if (!this.enabled()) return null; // pre-migration store (read-only fixture): no journal, no crash.
    const { json, truncated } = boundPayload(payload);
    return this.store.write(() => {
      const prev = this.q(`SELECT seq, hash FROM ${TABLE} WHERE task_id = ? ORDER BY seq DESC LIMIT 1`).get<{ seq: number; hash: string }>(taskId);
      const seq = prev ? prev.seq + 1 : 0;
      const hash = chainHash(taskId, seq, kind, json, prev ? prev.hash : null);
      const now = Date.now();
      this.q(
        `INSERT INTO ${TABLE} (task_id, seq, kind, payload_json, prev_hash, hash, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(taskId, seq, kind, json, prev ? prev.hash : null, hash, now);
      return { seq, hash, truncated };
    });
  }

  /** Latest row for a task (the resume point), or null. */
  latest(taskId: string): CheckpointRow | null {
    if (!this.enabled()) return null;
    const row = this.q(
      `SELECT task_id, seq, kind, payload_json, prev_hash, hash, created_at
       FROM ${TABLE} WHERE task_id = ? ORDER BY seq DESC LIMIT 1`,
    ).get<Row>(taskId);
    if (!row) return null;
    let payload: unknown = null;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      payload = { unparseable: true };
    }
    return {
      taskId: row.task_id,
      seq: row.seq,
      kind: row.kind,
      payload,
      prevHash: row.prev_hash,
      hash: row.hash,
      createdAt: row.created_at,
    };
  }

  /** All rows for a task, oldest first. Used by the audit export + resume. */
  list(taskId: string): CheckpointRow[] {
    if (!this.enabled()) return [];
    const rows = this.q(
      `SELECT task_id, seq, kind, payload_json, prev_hash, hash, created_at
       FROM ${TABLE} WHERE task_id = ? ORDER BY seq ASC`,
    ).all<Row>(taskId);
    return rows.map((row) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        payload = { unparseable: true };
      }
      return {
        taskId: row.task_id,
        seq: row.seq,
        kind: row.kind,
        payload,
        prevHash: row.prev_hash,
        hash: row.hash,
        createdAt: row.created_at,
      };
    });
  }

  /** Recompute the chain. A resume must not be built on a broken journal. */
  verifyChain(taskId: string): ChainVerifyResult {
    if (!this.enabled()) return { ok: true, count: 0, brokenAtSeq: null };
    const rows = this.q(
      `SELECT seq, kind, payload_json, prev_hash, hash FROM ${TABLE} WHERE task_id = ? ORDER BY seq ASC`,
    ).all<{ seq: number; kind: string; payload_json: string; prev_hash: string | null; hash: string }>(taskId);
    let prev: string | null = null;
    for (const r of rows) {
      const expected = chainHash(taskId, r.seq, r.kind, r.payload_json, prev);
      if (r.hash !== expected) {
        return { ok: false, count: rows.length, brokenAtSeq: r.seq, reason: "hash mismatch (payload rewritten or chain reordered)" };
      }
      if ((r.prev_hash ?? null) !== prev) {
        return { ok: false, count: rows.length, brokenAtSeq: r.seq, reason: "prev_link mismatch" };
      }
      prev = r.hash;
    }
    return { ok: true, count: rows.length, brokenAtSeq: null };
  }
}
