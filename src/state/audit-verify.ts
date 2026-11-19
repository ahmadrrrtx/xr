/**
 * B8/B14 — audit-chain verification that does not re-hash the whole history on
 * every Store construction, without weakening tamper detection.
 *
 *   • Explicit verification (`verifyChain`, `chainStatus`, `xr audit verify`) is
 *     always a full pass from GENESIS.
 *   • The first open of a database in a process is a full pass. Its verified
 *     head becomes this process's trusted checkpoint, kept in memory where an
 *     edit of the database file cannot reach it.
 *   • A later open verifies only rows after that checkpoint (a rewritten or
 *     missing checkpoint row fails over to a full pass) and schedules one
 *     background full pass, which catches an edit to older rows and sets
 *     chainBrokenAt exactly like any other verification.
 * The chain's own signed checkpoints are not the trust anchor here: the public
 * key embedded in the chain is what a forger would rewrite, and the signing key
 * is not loaded at construction.
 */
import { createHash } from "node:crypto";

interface Queryable { query(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown } }
interface AuditRow { id: number; event: string; detail: string; prev_hash: string; hash: string; created_at: number }
export type ChainResult = { valid: true; head: { id: number; hash: string } | null; rows: number } | { valid: false; brokenAt: number; rows: number };

export function auditRowHash(r: { event: string; detail: string; created_at: number }, prev: string): string {
  return createHash("sha256").update(JSON.stringify({ event: r.event, detail: JSON.parse(r.detail), prev, ts: r.created_at })).digest("hex");
}

/** Verify every row after `afterId`, starting from the given previous hash. Unparseable detail counts as broken. */
export function verifyAuditRows(store: Queryable, afterId: number, prev: string): ChainResult {
  const rows = store.query(`SELECT id, event, detail, prev_hash, hash, created_at FROM audit_log WHERE id > ?1 ORDER BY id ASC`).all(afterId) as AuditRow[];
  let head: { id: number; hash: string } | null = null;
  for (const r of rows) {
    let hash: string;
    try { hash = auditRowHash(r, prev); } catch { hash = ""; }
    if (r.prev_hash !== prev || hash !== r.hash) return { valid: false, brokenAt: r.id, rows: rows.length };
    prev = r.hash;
    head = { id: r.id, hash: r.hash };
  }
  return { valid: true, head, rows: rows.length };
}

const checkpoints = new Map<string, { id: number; hash: string }>();
const pending = new Set<string>();
/** Last construction-time check, for tests and diagnostics. */
export const openStats = { rows: 0, incremental: false };

/** Keep the process checkpoint in step with a verification result. */
export function recordCheckpoint(key: string, r: ChainResult): void {
  if (!r.valid) checkpoints.delete(key);
  else if (r.head) checkpoints.set(key, r.head);
}

/** Construction-time check. Returns the broken row id, or null when the chain verifies. */
export function verifyAtOpen(store: Queryable, key: string, genesis: string, fullVerify: () => void): number | null {
  const cp = checkpoints.get(key);
  const intact = cp !== undefined && (store.query(`SELECT hash FROM audit_log WHERE id = ?1`).get(cp.id) as { hash?: string } | null)?.hash === cp.hash;
  const r = intact ? verifyAuditRows(store, cp.id, cp.hash) : verifyAuditRows(store, 0, genesis);
  Object.assign(openStats, { rows: r.rows, incremental: intact });
  recordCheckpoint(key, r);
  if (r.valid && intact && !pending.has(key)) {
    pending.add(key);
    const t = setTimeout(() => { pending.delete(key); fullVerify(); }, 0);
    (t as { unref?: () => void }).unref?.();
  }
  return r.valid ? null : r.brokenAt;
}
