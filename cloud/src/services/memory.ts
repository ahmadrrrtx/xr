/**
 * XR Cloud — team shared memory.
 *
 * ## What this stores
 *
 * Facts an organization has explicitly chosen to share across its members, scoped
 * to a team workspace. Not conversation history, not prompts, not files. One row
 * per fact, ciphertext only.
 *
 * ## Conflict resolution
 *
 * Last-writer-wins keyed on `(id, version)`. A client uploads `{id, version,
 * body}`; the server accepts when `incoming.version > stored.version`, rejects
 * when it is lower (and returns the current row so the client can converge rather
 * than guess), and treats equal versions as a no-op — because equal versions with
 * different digests means an id was reused, which is a bug worth surfacing rather
 * than silently overwriting.
 *
 * LWW is a real choice with real downsides: a concurrent edit on another device
 * loses, silently, from the writer's point of view. It is chosen because the
 * alternative for v1 — a merge UI for prose — is worse, and because the daemon
 * writes facts one at a time from a single user's confirmed intent. The docs say
 * so plainly instead of calling it "conflict-free".
 *
 * ## Sensitivity
 *
 * The scanner runs **here**, on the server, on the decrypted body, every time.
 * Whatever tags the client sent are stored alongside but never consulted for the
 * block decision. See `services/sensitivity.ts` for why.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { CloudDb } from "../db/client.ts";
import { memories, memoryReviews, type MemoryRow, type MemoryReviewRow } from "../db/schema.ts";
import type { OrgKeyStore } from "../deps.ts";
import { bodyDigest, decryptWithKey, encryptWithKey, workspaceKey } from "../lib/crypto.ts";
import { conflict, forbidden, gone, notFound } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { scanSensitive, sensitiveTags, sensitivityReason } from "./sensitivity.ts";
import type { PolicyView } from "./policy.ts";

export interface MemoryFact {
  id: string;
  workspaceId: string;
  body: string;
  category: string;
  version: number;
  visibility: "private" | "team" | "review";
  sensitivityTags: string[];
  tags: string[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertResult {
  outcome: "created" | "updated" | "noop" | "rejected-stale";
  fact: MemoryFact;
  /** Present when the server overrode the client's tags. Says so, out loud. */
  note?: string;
}

export interface MemoryService {
  list(orgId: string, workspaceId: string, opts?: { includePrivate?: boolean; userId?: string }): Promise<MemoryFact[]>;
  get(orgId: string, workspaceId: string, factId: string): Promise<MemoryFact | null>;
  upsert(input: {
    orgId: string;
    workspaceId: string;
    userId: string;
    factId?: string;
    version?: number;
    body: string;
    category?: string;
    visibility?: "private" | "team" | "review";
    tags?: string[];
    clientSensitivityTags?: string[];
    policy: PolicyView;
    /** true when the writer is a user; false for an agent-proposed candidate. */
    direct: boolean;
    provenance?: string;
  }): Promise<UpsertResult | { pending: MemoryReviewRow }>;
  remove(orgId: string, workspaceId: string, factId: string, userId: string): Promise<void>;
  listReviews(orgId: string, state: "pending" | "approved" | "rejected"): Promise<MemoryReviewRow[]>;
  decideReview(
    orgId: string,
    reviewId: string,
    decision: "approve" | "reject",
    userId: string,
    note?: string,
  ): Promise<{ review: MemoryReviewRow; fact?: MemoryFact }>;
  exportAll(orgId: string): Promise<MemoryFact[]>;
  stats(orgId: string): Promise<{ workspaces: number; facts: number; pendingReviews: number }>;
}

function toFact(orgKey: Buffer, row: MemoryRow): MemoryFact {
  const key = workspaceKey(orgKey, row.workspaceId);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    body: decryptWithKey(key, row.bodyCiphertext),
    category: row.category,
    version: row.version,
    visibility: row.visibility,
    sensitivityTags: row.sensitivityTags,
    tags: row.tags,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createMemoryService(
  db: CloudDb,
  orgKeys: OrgKeyStore,
  resolveOrgKey: (orgId: string) => Promise<{ wrapped: string } | null>,
): MemoryService {
  /**
   * Wrap the two-step "read wrapped key → derive workspace key" so every entry
   * point does it identically. A missing org row is `notFound`, never a silent
   * fall back to a default key.
   */
  async function keyFor(orgId: string, workspaceId: string): Promise<Buffer> {
    const org = await resolveOrgKey(orgId);
    if (!org) throw notFound("Organization");
    const orgKey = orgKeys.get(orgId, org.wrapped);
    return workspaceKey(orgKey, workspaceId);
  }

  return {
    async list(orgId, workspaceId, opts) {
      const conditions = [
        eq(memories.orgId, orgId),
        eq(memories.workspaceId, workspaceId),
        isNull(memories.deletedAt),
      ];
      // Private facts are the author's alone. Enforced in the query, not in a
      // filter after the fetch.
      if (!opts?.includePrivate || !opts?.userId) {
        conditions.push(eq(memories.visibility, "team"));
      } else {
        conditions.push(
          sql`(${memories.visibility} <> 'private' OR ${memories.createdBy} = ${opts.userId})`,
        );
      }
      const rows = await db
        .select()
        .from(memories)
        .where(and(...conditions))
        .orderBy(desc(memories.updatedAt))
        .limit(2000);
      const key = await keyFor(orgId, workspaceId);
      return rows.map((row) => toFact(key, row));
    },

    async get(orgId, workspaceId, factId) {
      const rows = await db
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.orgId, orgId),
            eq(memories.workspaceId, workspaceId),
            eq(memories.id, factId),
            isNull(memories.deletedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const key = await keyFor(orgId, workspaceId);
      return toFact(key, row);
    },

    async upsert(input) {
      const { orgId, workspaceId, body, policy } = input;
      if (body.trim().length === 0) throw conflict("A memory fact cannot be empty.");

      // Server-side truth about sensitivity. The client's tags are advisory.
      const matches = scanSensitive(body);
      const serverTags = sensitiveTags(body);
      const clientTags = [...(input.clientSensitivityTags ?? [])].sort();
      const tagsDisagreed =
        serverTags.length !== clientTags.length || serverTags.some((t, i) => t !== clientTags[i]);

      if (matches.length > 0 && policy.blockSensitiveMemory) {
        // Refuse with a repair that explains what was found — never the value.
        throw forbidden(sensitivityReason(matches));
      }

      const key = await keyFor(orgId, workspaceId);
      const ciphertext = encryptWithKey(key, body);
      const digest = bodyDigest(body);

      /*
       * Agent-proposed candidates do NOT go straight into shared memory. They
       * land in the review queue, where a human sees the plaintext (in the admin
       * console, decrypted for them at read time) before it becomes something
       * every teammate's recall will surface. Constitution Art. IV.5 — consent is
       * never fabricated, and "the agent decided to remember this" is not consent.
       */
      if (!input.direct) {
        const inserted = await db
          .insert(memoryReviews)
          .values({
            id: newId("memoryReview"),
            orgId,
            workspaceId,
            bodyCiphertext: ciphertext,
            bodyDigest: digest,
            provenance: input.provenance ?? "agent:unknown",
            sensitivityTags: serverTags,
            state: "pending",
            proposedBy: input.userId,
          })
          .returning();
        const review = inserted[0];
        if (!review) throw conflict("Could not queue the suggested fact.");
        return { pending: review };
      }

      const existing = input.factId
        ? await db
            .select()
            .from(memories)
            .where(and(eq(memories.orgId, orgId), eq(memories.id, input.factId)))
            .limit(1)
        : [];

      const current = existing[0];

      if (!current) {
        const inserted = await db
          .insert(memories)
          .values({
            id: input.factId ?? newId("memory"),
            orgId,
            workspaceId,
            bodyCiphertext: ciphertext,
            bodyDigest: digest,
            category: input.category ?? "fact",
            scope: "team",
            version: input.version ?? 1,
            visibility: input.visibility ?? "team",
            sensitivityTags: serverTags,
            tags: input.tags ?? [],
            createdBy: input.userId,
            updatedBy: input.userId,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw conflict("Could not store the fact.");
        return {
          outcome: "created",
          fact: toFact(key, row),
          ...(tagsDisagreed
            ? {
                note:
                  "Sensitivity tags were recomputed on the server. The stored tags are the server's, because the server is what answers for the data at rest.",
              }
            : {}),
        };
      }

      if (current.deletedAt) throw gone("That fact was deleted. Re-create it rather than reviving it.");

      const incomingVersion = input.version ?? current.version + 1;
      if (incomingVersion < current.version) {
        // Stale write. Return the server's row so the client converges instead of
        // retrying blindly.
        return {
          outcome: "rejected-stale",
          fact: toFact(key, current),
          note: `Stored version is ${current.version}; your write was version ${incomingVersion}. The newer version was kept.`,
        };
      }
      if (incomingVersion === current.version && current.bodyDigest !== digest) {
        throw conflict(
          "Two different facts were written with the same version number.",
          "Fetch the current fact, bump its version, and retry. This is a client bug — report it.",
        );
      }
      if (incomingVersion === current.version) {
        return { outcome: "noop", fact: toFact(key, current) };
      }

      const updated = await db
        .update(memories)
        .set({
          bodyCiphertext: ciphertext,
          bodyDigest: digest,
          version: incomingVersion,
          category: input.category ?? current.category,
          visibility: input.visibility ?? current.visibility,
          sensitivityTags: serverTags,
          tags: input.tags ?? current.tags,
          workspaceId,
          updatedBy: input.userId,
          updatedAt: new Date(),
        })
        .where(and(eq(memories.orgId, orgId), eq(memories.id, current.id)))
        .returning();
      const row = updated[0];
      if (!row) throw conflict("The fact changed while it was being updated. Fetch and retry.");
      return {
        outcome: "updated",
        fact: toFact(key, row),
        ...(tagsDisagreed
          ? { note: "Sensitivity tags were recomputed on the server." }
          : {}),
      };
    },

    async remove(orgId, workspaceId, factId, userId) {
      // Soft delete: a compliance export taken tomorrow must still be able to say
      // what existed. Hard deletion happens with the org purge.
      const updated = await db
        .update(memories)
        .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
        .where(
          and(eq(memories.orgId, orgId), eq(memories.workspaceId, workspaceId), eq(memories.id, factId)),
        )
        .returning({ id: memories.id });
      if (updated.length === 0) throw notFound("Memory fact");
    },

    async listReviews(orgId, state) {
      return await db
        .select()
        .from(memoryReviews)
        .where(and(eq(memoryReviews.orgId, orgId), eq(memoryReviews.state, state)))
        .orderBy(desc(memoryReviews.createdAt))
        .limit(200);
    },

    async decideReview(orgId, reviewId, decision, userId, note) {
      const rows = await db
        .select()
        .from(memoryReviews)
        .where(and(eq(memoryReviews.orgId, orgId), eq(memoryReviews.id, reviewId)))
        .limit(1);
      const review = rows[0];
      if (!review) throw notFound("Suggested fact");
      if (review.state !== "pending") throw conflict(`That suggestion was already ${review.state}.`);

      const decided = await db
        .update(memoryReviews)
        .set({
          state: decision === "approve" ? "approved" : "rejected",
          decidedBy: userId,
          decidedAt: new Date(),
          decisionNote: note ?? null,
        })
        .where(eq(memoryReviews.id, reviewId))
        .returning();
      const updatedReview = decided[0];
      if (!updatedReview) throw conflict("Could not record the decision.");

      if (decision === "reject") return { review: updatedReview };

      const key = await keyFor(orgId, review.workspaceId);
      const inserted = await db
        .insert(memories)
        .values({
          id: newId("memory"),
          orgId,
          workspaceId: review.workspaceId,
          bodyCiphertext: review.bodyCiphertext,
          bodyDigest: review.bodyDigest,
          category: "fact",
          scope: "team",
          version: 1,
          visibility: "team",
          sensitivityTags: review.sensitivityTags,
          tags: [],
          createdBy: review.proposedBy,
          updatedBy: userId,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw conflict("Could not publish the approved fact.");
      return { review: updatedReview, fact: toFact(key, row) };
    },

    /**
     * Everything an org holds, decrypted, for the cancellation export the brief
     * promises. Ordered so the output is diffable between two exports.
     */
    async exportAll(orgId) {
      const rows = await db
        .select()
        .from(memories)
        .where(and(eq(memories.orgId, orgId), isNull(memories.deletedAt)))
        .orderBy(memories.workspaceId, memories.id);
      const facts: MemoryFact[] = [];
      const keyCache = new Map<string, Buffer>();
      const org = await resolveOrgKey(orgId);
      if (!org) throw notFound("Organization");
      const orgKey = orgKeys.get(orgId, org.wrapped);
      for (const row of rows) {
        let key = keyCache.get(row.workspaceId);
        if (!key) {
          key = workspaceKey(orgKey, row.workspaceId);
          keyCache.set(row.workspaceId, key);
        }
        facts.push(toFact(key, row));
      }
      return facts;
    },

    async stats(orgId) {
      const [ws, fact, pending] = await Promise.all([
        db
          .select({ n: sql<number>`count(distinct ${memories.workspaceId})::int` })
          .from(memories)
          .where(and(eq(memories.orgId, orgId), isNull(memories.deletedAt))),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(memories)
          .where(and(eq(memories.orgId, orgId), isNull(memories.deletedAt))),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(memoryReviews)
          .where(and(eq(memoryReviews.orgId, orgId), eq(memoryReviews.state, "pending"))),
      ]);
      return {
        workspaces: ws[0]?.n ?? 0,
        facts: fact[0]?.n ?? 0,
        pendingReviews: pending[0]?.n ?? 0,
      };
    },
  };
}
