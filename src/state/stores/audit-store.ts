/**
 * XR — Audit Store
 * Implements the tamper-evident, hash-chained audit log.
 */

import { BaseStore } from "../store.ts";
import { createHash } from "node:crypto";

const GENESIS = "xr-genesis";

export interface AuditEntry {
  id: number;
  session_id: string | null;
  event: string;
  detail: string;
  prev_hash: string;
  hash: string;
  created_at: number;
}

export class AuditStore extends BaseStore {
  constructor(path?: string) {
    super(path);
    this.migrate();
  }

  private migrate(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        event TEXT NOT NULL,
        detail TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  private lastHash(): string {
    const row = this.db
      .query<{ hash: string }, []>(
        `SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1`,
      )
      .get();
    return row?.hash ?? GENESIS;
  }

  private redact(detail: Record<string, unknown>): Record<string, unknown> {
    const json = JSON.stringify(detail).replace(
      /(sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/g,
      "«redacted»",
    );
    return JSON.parse(json);
  }

  audit(
    event: string,
    detail: Record<string, unknown>,
    sessionId: string | null = null,
  ): string {
    const prev = this.lastHash();
    const ts = Date.now();
    const safe = this.redact(detail);
    const payload = JSON.stringify({ event, detail: safe, prev, ts });
    const hash = createHash("sha256").update(payload).digest("hex");
    this.db
      .query(
        `INSERT INTO audit_log (session_id,event,detail,prev_hash,hash,created_at) VALUES (?,?,?,?,?,?)`,
      )
      .run(sessionId, event, JSON.stringify(safe), prev, hash, ts);
    return hash;
  }

  verifyChain(): { valid: boolean; brokenAt?: number } {
    const rows = this.db
      .query<AuditEntry, []>(`SELECT * FROM audit_log ORDER BY id ASC`)
      .all();
    let prev = GENESIS;
    for (const r of rows) {
      const payload = JSON.stringify({
        event: r.event,
        detail: JSON.parse(r.detail),
        prev,
        ts: r.created_at,
      });
      const expected = createHash("sha256").update(payload).digest("hex");
      if (expected !== r.hash || r.prev_hash !== prev) {
        return { valid: false, brokenAt: r.id };
      }
      prev = r.hash;
    }
    return { valid: true };
  }

  count(): number {
    return (
      this.db
        .query<{ c: number }, []>(`SELECT COUNT(*) c FROM audit_log`)
        .get()?.c ?? 0
    );
  }

  recent(limit = 50): AuditEntry[] {
    return this.db
      .query<AuditEntry, [number]>(
        `SELECT id,event,detail,hash,created_at FROM audit_log ORDER BY id DESC LIMIT ?`,
      )
      .all(limit);
  }
}
