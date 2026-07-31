/**
 * Read-only chain verification for the reproduction harness: opens the DB in
 * read-only mode and recomputes the audit hash chain.
 */
import { Database } from "bun:sqlite";

const GENESIS = "xr-genesis";

export function verify(dbPath: string): { valid: boolean; brokenAt?: number; count: number } {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .query<
        { id: number; event: string; detail: string; prev_hash: string; hash: string; created_at: number },
        []
      >(`SELECT id, event, detail, prev_hash, hash, created_at FROM audit_log ORDER BY id ASC`)
      .all();
    let prev = GENESIS;
    for (const r of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(r.detail);
      } catch {
        return { valid: false, brokenAt: r.id, count: rows.length };
      }
      const payload = JSON.stringify({ event: r.event, detail: parsed, prev, ts: r.created_at });
      const { createHash } = require("node:crypto") as typeof import("node:crypto");
      const expected = createHash("sha256").update(payload).digest("hex");
      if (expected !== r.hash || r.prev_hash !== prev) {
        return { valid: false, brokenAt: r.id, count: rows.length };
      }
      prev = r.hash;
    }
    return { valid: true, count: rows.length };
  } finally {
    db.close();
  }
}
