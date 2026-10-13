/**
 * XR Cloud — audit log.
 *
 * ## Shape
 *
 * Append-only, hash-chained, one chain per organization. Each row stores
 * `prev_hash` (the previous entry's `entry_hash` for that org) and `entry_hash`
 * (a SHA-256 over that row's meaningful fields plus `prev_hash`). This mirrors
 * the local `src/security/audit-signer.ts` so the same mental model — and the
 * same verification procedure — reads both logs.
 *
 * The chain gives **tamper evidence**: editing, reordering or deleting any row
 * breaks the link its successor points at, and `verifyChain` names the first
 * broken sequence number. It does not give tamper *resistance* against someone
 * who can write both the rows and the chain — that needs the asymmetric anchor,
 * which the local install already has and which the brief scopes to post-v1 for
 * the cloud. The trust page says exactly this and does not overclaim.
 *
 * ## Serialization
 *
 * Two concurrent writes must not read the same `max(seq)` or the same
 * `prev_hash`. The lock is taken on the **org row** (`SELECT ... FOR UPDATE`)
 * inside the transaction that appends, which serializes writers per org and —
 * unlike an in-process mutex — also holds across replicas and across processes.
 *
 * ## Content
 *
 * `detail` is structured and small: ids, counts, old/new values for editable
 * fields. Memory bodies, prompts, secrets and tokens are never written here
 * (Constitution Art. XXI — structure only, never payloads). `sanitiseDetail`
 * enforces that at the boundary rather than trusting callers.
 */

import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import type { CloudDb } from "../db/client.ts";
import { auditLogs, orgs, type AuditLogRow } from "../db/schema.ts";
import { auditEntryHash } from "../lib/crypto.ts";
import { labelFor, type BackgroundQueue } from "../lib/background.ts";
import type { Logger } from "../lib/logger.ts";
import { newId } from "../lib/ids.ts";

export type AuditActorKind = "user" | "system" | "api_key" | "stripe";

export interface AuditInput {
  orgId: string;
  actorKind: AuditActorKind;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  workspaceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown>;
}

/** The genesis `prev_hash`. 64 zeros — a recognisable, verifiable chain start. */
export const GENESIS_HASH = "0".repeat(64);

/** Keys that must never appear in an audit `detail`, at any depth. */
const FORBIDDEN_DETAIL_KEYS = [
  "body",
  "content",
  "text",
  "prompt",
  "completion",
  "message",
  "password",
  "token",
  "secret",
  "key",
  "authorization",
  "cookie",
  "cert",
  "ciphertext",
  "bodyciphertext",
  "body_ciphertext",
];

/**
 * Drop everything that could carry a payload or a credential. Runs on every
 * write, so a caller cannot accidentally persist a memory body into the log even
 * if the route is later edited carelessly.
 */
export function sanitiseDetail(detail: Record<string, unknown> | undefined, depth = 0): Record<string, unknown> {
  if (!detail || depth > 3) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (FORBIDDEN_DETAIL_KEYS.includes(key.toLowerCase())) {
      out[key] = "[not-logged]";
      continue;
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      // Long strings are summaries, not payloads. Truncate rather than trust.
      out[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 20).map((v) => (typeof v === "object" ? "[object]" : v));
    } else if (typeof value === "object") {
      out[key] = sanitiseDetail(value as Record<string, unknown>, depth + 1);
    }
  }
  return out;
}

export interface AuditService {
  append(input: AuditInput): Promise<AuditLogRow>;
  /** Appends without taking a transaction — used inside an existing one. */
  appendInTx(
    tx: Pick<CloudDb, "insert" | "select">,
    input: AuditInput,
    nextSeq: number,
    prevHash: string,
  ): Promise<AuditLogRow>;
  head(orgId: string): Promise<{ seq: number; hash: string }>;
  verifyChain(orgId: string, limit?: number): Promise<ChainVerification>;
  list(
    orgId: string,
    filters: AuditFilters,
  ): Promise<{ rows: AuditLogRow[]; nextCursor: string | null }>;
}

export interface AuditFilters {
  actorId?: string;
  actorEmail?: string;
  action?: string;
  targetId?: string;
  workspaceId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  /** First sequence number whose link failed, if any. */
  brokenAt?: number;
  reason?: string;
}

function encodeCursor(row: AuditLogRow): string {
  return Buffer.from(`${row.seq}:${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { seq: number; id: string } | null {
  try {
    const [seqText, id] = Buffer.from(cursor, "base64url").toString("utf8").split(":");
    const seq = Number(seqText);
    if (!Number.isInteger(seq) || !id) return null;
    return { seq, id };
  } catch {
    return null;
  }
}

export function createAuditService(db: CloudDb, _log: Logger): AuditService {
  async function append(input: AuditInput): Promise<AuditLogRow> {
    const detail = sanitiseDetail(input.detail);

    // The org row is the serialization point for this org's chain.
    return await db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: orgs.id })
        .from(orgs)
        .where(eq(orgs.id, input.orgId))
        .for("update")
        .limit(1);
      if (locked.length === 0) {
        // An audit write for a vanished org is a bug, not a user error. Throw so
        // the caller's transaction rolls back rather than silently dropping the
        // evidence.
        throw new Error(`audit append for unknown org ${input.orgId}`);
      }

      const head = await tx
        .select({ seq: auditLogs.seq, entryHash: auditLogs.entryHash })
        .from(auditLogs)
        .where(eq(auditLogs.orgId, input.orgId))
        .orderBy(desc(auditLogs.seq))
        .limit(1);

      const prevSeq = head[0]?.seq ?? 0;
      const prevHash = head[0]?.entryHash ?? GENESIS_HASH;

      return await appendInTx(tx, input, prevSeq + 1, prevHash, detail);
    });
  }

  async function appendInTx(
    tx: Pick<CloudDb, "insert" | "select">,
    input: AuditInput,
    nextSeq: number,
    prevHash: string,
    prepared?: Record<string, unknown>,
  ): Promise<AuditLogRow> {
    const detail = prepared ?? sanitiseDetail(input.detail);
    const createdAt = new Date();
    const id = newId("audit");
    const entryHash = auditEntryHash({
      orgId: input.orgId,
      seq: nextSeq,
      actorKind: input.actorKind,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      workspaceId: input.workspaceId ?? null,
      detail,
      createdAt: createdAt.toISOString(),
      prevHash,
    });

    const inserted = await tx
      .insert(auditLogs)
      .values({
        id,
        orgId: input.orgId,
        seq: nextSeq,
        actorKind: input.actorKind,
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        workspaceId: input.workspaceId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        detail,
        prevHash,
        entryHash,
        createdAt,
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error("audit insert returned no row");
    return row;
  }

  return {
    append,

    appendInTx: async (tx, input, nextSeq, prevHash) => appendInTx(tx, input, nextSeq, prevHash),

    async head(orgId) {
      const rows = await db
        .select({ seq: auditLogs.seq, entryHash: auditLogs.entryHash })
        .from(auditLogs)
        .where(eq(auditLogs.orgId, orgId))
        .orderBy(desc(auditLogs.seq))
        .limit(1);
      return rows[0] ? { seq: rows[0].seq, hash: rows[0].entryHash } : { seq: 0, hash: GENESIS_HASH };
    },

    /**
     * Replays the chain in sequence order and recomputes every hash. Bounded by
     * `limit` so a huge org cannot turn a verification into an outage; the
     * caller reports `checked` so a partial verification is never presented as a
     * complete one (Art. IV.2).
     */
    async verifyChain(orgId, limit = 10_000) {
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.orgId, orgId))
        .orderBy(asc(auditLogs.seq))
        .limit(limit);

      let prevHash = GENESIS_HASH;
      let expectedSeq = 1;
      for (const row of rows) {
        if (row.seq !== expectedSeq) {
          return {
            ok: false,
            checked: expectedSeq - 1,
            brokenAt: row.seq,
            reason: `sequence gap: expected ${expectedSeq}, found ${row.seq}`,
          };
        }
        if (row.prevHash !== prevHash) {
          return {
            ok: false,
            checked: expectedSeq - 1,
            brokenAt: row.seq,
            reason: "prev_hash does not match the previous entry",
          };
        }
        const recomputed = auditEntryHash({
          orgId: row.orgId,
          seq: row.seq,
          actorKind: row.actorKind,
          actorId: row.actorId,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          workspaceId: row.workspaceId,
          detail: row.detail,
          createdAt: row.createdAt.toISOString(),
          prevHash: row.prevHash,
        });
        if (recomputed !== row.entryHash) {
          return {
            ok: false,
            checked: expectedSeq - 1,
            brokenAt: row.seq,
            reason: "entry_hash does not match the row contents",
          };
        }
        prevHash = row.entryHash;
        expectedSeq += 1;
      }
      return { ok: true, checked: rows.length };
    },

    async list(orgId, filters) {
      const conditions = [eq(auditLogs.orgId, orgId)];
      if (filters.actorId) conditions.push(eq(auditLogs.actorId, filters.actorId));
      if (filters.actorEmail) conditions.push(eq(auditLogs.actorEmail, filters.actorEmail));
      if (filters.action) conditions.push(sql`${auditLogs.action} like ${`${filters.action}%`}`);
      if (filters.targetId) conditions.push(eq(auditLogs.targetId, filters.targetId));
      if (filters.workspaceId) conditions.push(eq(auditLogs.workspaceId, filters.workspaceId));
      if (filters.from) conditions.push(gte(auditLogs.createdAt, filters.from));
      if (filters.to) conditions.push(lte(auditLogs.createdAt, filters.to));

      const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
      if (cursor) conditions.push(sql`${auditLogs.seq} < ${cursor.seq}`);

      const rows = await db
        .select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.seq))
        .limit(filters.limit + 1);

      const hasMore = rows.length > filters.limit;
      const page = hasMore ? rows.slice(0, filters.limit) : rows;
      const last = page[page.length - 1];
      return { rows: page, nextCursor: hasMore && last ? encodeCursor(last) : null };
    },
  };
}

/**
 * Fire-and-forget convenience for data-access rows.
 *
 * Deliberately NOT used for admin actions: those must be written in the same
 * transaction as the change they describe, so a crash between the two cannot
 * leave an unlogged policy change. Read access has no such coupling, and making
 * every memory read wait on a chain append would be a real cost for no gain.
 */
export function auditDetached(
  deps: { audit: AuditService; log: Logger; background: BackgroundQueue },
  input: AuditInput,
): void {
  deps.background.enqueue(labelFor(input.action), async () => {
    await deps.audit.append(input);
  });
}
