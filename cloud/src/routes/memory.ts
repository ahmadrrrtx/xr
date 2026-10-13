/**
 * XR Cloud — team memory routes.
 *
 * The wire never carries ciphertext and never carries a key. A client posts
 * plaintext over TLS; the server encrypts, stores, and decrypts on read. That is
 * a deliberate v1 position (server-side encryption with exportable snapshots —
 * the brief's §A), and the trust page describes it in exactly those words rather
 * than implying end-to-end.
 *
 * Every read of shared memory is an audited event (brief §J: "audit logging of
 * data access"). Those rows are written **detached** — fire-and-forget — because
 * making a memory read wait on a chain append would slow a hot path for no gain,
 * and a lost read-access row is worth a log line rather than a failed request.
 * Admin *changes* are a different matter and are always written in-band.
 */

import { Hono } from "hono";

import type { AppDeps } from "../deps.ts";
import { forbidden } from "../lib/errors.ts";
import { requireBusiness, requireOrgMember, requireRole, requireUser } from "../middleware/auth.ts";
import { parseBody, parseQuery } from "../middleware/validate.ts";
import {
  createWorkspaceSchema,
  memoryQuerySchema,
  memoryReviewSchema,
  memoryUpsertSchema,
  updateWorkspaceSchema,
} from "../schemas.ts";
import { auditDetached } from "../services/audit.ts";
import { policyView } from "../services/policy.ts";
import { createMemoryService } from "../services/memory.ts";
import { eq } from "drizzle-orm";
import { orgs, policies, workspaces } from "../db/schema.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";
import { newId, slugify } from "../lib/ids.ts";

export function memoryRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  const memory = createMemoryService(deps.db, deps.orgKeys, async (orgId) => {
    const rows = await deps.db.select({ wrapped: orgs.orgKeyWrapped }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
    return rows[0] ?? null;
  });

  async function currentPolicy(orgId: string) {
    const rows = await deps.db.select().from(policies).where(eq(policies.orgId, orgId)).limit(1);
    return policyView(rows[0]);
  }

  /* --------------------------------------------------------------- facts */

  app.get("/teams/:id/memory", requireUser(deps), requireOrgMember(deps, "id"), requireBusiness(deps), async (c) => {
    const member = c.get("currentMember");
    const query = parseQuery(c, memoryQuerySchema);
    const facts = await memory.list(member.orgId, query.workspace, {
      includePrivate: query.includePrivate,
      userId: c.get("auth").userId,
    });
    auditDetached(deps, {
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: "memory.read",
      targetType: "workspace",
      targetId: query.workspace,
      workspaceId: query.workspace,
      ip: c.get("meta").ip,
      detail: { count: facts.length, includePrivate: query.includePrivate },
    });

    return c.json({
      workspaceId: query.workspace,
      facts,
      // The daemon uses this to decide whether to keep polling. An honest "nothing
      // changed" is worth more than a smaller payload.
      serverTime: deps.clock().toISOString(),
    });
  });

  app.post("/teams/:id/memory", requireUser(deps), requireOrgMember(deps, "id"), requireBusiness(deps), async (c) => {
    const member = c.get("currentMember");
    const body = await parseBody(c, memoryUpsertSchema);
    const policy = await currentPolicy(member.orgId);

    const result = await memory.upsert({
      orgId: member.orgId,
      workspaceId: body.workspaceId,
      userId: c.get("auth").userId,
      factId: body.id,
      version: body.version,
      body: body.body,
      category: body.category,
      visibility: body.visibility,
      tags: body.tags,
      clientSensitivityTags: body.sensitivityTags,
      policy,
      direct: body.direct,
      provenance: body.provenance,
    });

    if ("pending" in result) {
      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "memory.suggested",
        targetType: "memory_review",
        targetId: result.pending.id,
        workspaceId: body.workspaceId,
        ip: c.get("meta").ip,
        detail: { provenance: result.pending.provenance, sensitivityTags: result.pending.sensitivityTags },
      });
      return c.json(
        {
          outcome: "pending-review",
          review: {
            id: result.pending.id,
            workspaceId: result.pending.workspaceId,
            state: result.pending.state,
            provenance: result.pending.provenance,
            sensitivityTags: result.pending.sensitivityTags,
          },
          note:
            "This was proposed by an agent rather than a person, so it is in the review queue. " +
            "A teammate approves it before it reaches everyone's recall.",
        },
        202,
      );
    }

    await deps.audit.append({
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: `memory.${result.outcome === "created" ? "create" : "update"}`,
      targetType: "memory",
      targetId: result.fact.id,
      workspaceId: body.workspaceId,
      ip: c.get("meta").ip,
      // Structure only. The body and its tags are never in the audit row beyond
      // the fact that sensitivity was detected.
      detail: { outcome: result.outcome, sensitivityTags: result.fact.sensitivityTags, version: result.fact.version },
    });

    const status = result.outcome === "rejected-stale" ? 409 : result.outcome === "created" ? 201 : 200;
    return c.json(result, status);
  });

  app.delete("/teams/:id/memory/:factId", requireUser(deps), requireOrgMember(deps, "id"), requireBusiness(deps), async (c) => {
    const member = c.get("currentMember");
    const factId = c.req.param("factId");
    const workspaceId = c.req.query("workspace");
    if (!factId || !workspaceId) throw badRequest("Missing fact id or workspace.");

    const existing = await memory.get(member.orgId, workspaceId, factId);
    if (!existing) throw notFound("Memory fact");

    // A member may delete their own fact; deleting someone else's requires admin.
    const isAuthor = existing.createdBy === c.get("auth").userId;
    if (!isAuthor && member.role === "member") {
      throw forbidden("Only an admin can remove a teammate's fact. Ask an admin, or add a newer fact that supersedes it.");
    }

    await memory.remove(member.orgId, workspaceId, factId, c.get("auth").userId);
    await deps.audit.append({
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: "memory.delete",
      targetType: "memory",
      targetId: factId,
      workspaceId,
      ip: c.get("meta").ip,
      detail: { wasAuthor: isAuthor },
    });
    return c.json({ ok: true });
  });

  /* ------------------------------------------------------- review queue */

  app.get(
    "/teams/:id/memory/reviews",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const state = (c.req.query("state") ?? "pending") as "pending" | "approved" | "rejected";
      const reviews = await memory.listReviews(member.orgId, state);
      // Decrypt for display. Only admins reach this route, and the alternative —
      // asking them to approve a fact they cannot read — is not a review.
      const rows = await Promise.all(
        reviews.map(async (review) => {
          const fact = await memory.get(member.orgId, review.workspaceId, review.id).catch(() => null);
          return {
            id: review.id,
            workspaceId: review.workspaceId,
            state: review.state,
            provenance: review.provenance,
            sensitivityTags: review.sensitivityTags,
            proposedBy: review.proposedBy,
            createdAt: review.createdAt.toISOString(),
            decisionNote: review.decisionNote,
            decidedAt: review.decidedAt?.toISOString() ?? null,
            bodyPreview: fact?.body ?? "(content unavailable)",
          };
        }),
      );
      return c.json({ reviews: rows, state });
    },
  );

  app.post(
    "/teams/:id/memory/reviews/:reviewId",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const reviewId = c.req.param("reviewId");
      if (!reviewId) throw badRequest("Missing review id.");
      const body = await parseBody(c, memoryReviewSchema);

      const outcome = await memory.decideReview(
        member.orgId,
        reviewId,
        body.decision,
        c.get("auth").userId,
        body.note,
      );

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: `memory.review_${body.decision}`,
        targetType: "memory_review",
        targetId: reviewId,
        workspaceId: outcome.review.workspaceId,
        ip: c.get("meta").ip,
        detail: { decision: body.decision, hasNote: Boolean(body.note) },
      });

      return c.json({
        ok: true,
        review: { id: outcome.review.id, state: outcome.review.state },
        published: outcome.fact ? { id: outcome.fact.id, version: outcome.fact.version } : null,
      });
    },
  );

  /* --------------------------------------------------------- workspaces */

  app.post("/teams/:id/workspaces", requireUser(deps), requireOrgMember(deps, "id"), requireRole(["owner", "admin"]), async (c) => {
    const member = c.get("currentMember");
    const body = await parseBody(c, createWorkspaceSchema);
    const now = deps.clock();

    const existing = await deps.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.orgId, member.orgId))
      .limit(500);
    if (existing.length >= 200) {
      throw conflict("This team has reached its workspace limit.", "Archive a workspace you no longer use.");
    }

    const created = await deps.db
      .insert(workspaces)
      .values({
        id: newId("workspace"),
        orgId: member.orgId,
        name: body.name,
        slug: body.slug ?? slugify(body.name, "workspace"),
        memoryVisibility: body.memoryVisibility,
        ownerId: body.ownerId ?? c.get("auth").userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const workspace = created[0];
    if (!workspace) throw conflict("Could not create the workspace.");

    await deps.audit.append({
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: "workspace.create",
      targetType: "workspace",
      targetId: workspace.id,
      workspaceId: workspace.id,
      ip: c.get("meta").ip,
      detail: { name: body.name, memoryVisibility: body.memoryVisibility },
    });

    return c.json({ workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug } }, 201);
  });

  app.patch("/teams/:id/workspaces/:workspaceId", requireUser(deps), requireOrgMember(deps, "id"), requireRole(["owner", "admin"]), async (c) => {
    const member = c.get("currentMember");
    const workspaceId = c.req.param("workspaceId");
    if (!workspaceId) throw badRequest("Missing workspace id.");
    const body = await parseBody(c, updateWorkspaceSchema);

    const rows = await deps.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    const existing = rows[0];
    if (!existing || existing.orgId !== member.orgId) throw notFound("Workspace");

    await deps.db
      .update(workspaces)
      .set({
        name: body.name ?? existing.name,
        memoryVisibility: body.memoryVisibility ?? existing.memoryVisibility,
        ownerId: body.ownerId !== undefined ? body.ownerId : existing.ownerId,
        updatedAt: deps.clock(),
      })
      .where(eq(workspaces.id, workspaceId));

    await deps.audit.append({
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: "workspace.update",
      targetType: "workspace",
      targetId: workspaceId,
      workspaceId,
      ip: c.get("meta").ip,
      detail: { fields: Object.keys(body) },
    });
    return c.json({ ok: true });
  });

  app.delete("/teams/:id/workspaces/:workspaceId", requireUser(deps), requireOrgMember(deps, "id"), requireRole(["owner"]), async (c) => {
    const member = c.get("currentMember");
    const workspaceId = c.req.param("workspaceId");
    if (!workspaceId) throw badRequest("Missing workspace id.");
    const rows = await deps.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const existing = rows[0];
    if (!existing || existing.orgId !== member.orgId) throw notFound("Workspace");

    // Archive, never hard-delete: a member's machine may still hold these facts
    // under `scope: "team"` and an unresolvable workspace id is worse than an
    // archived one.
    await deps.db
      .update(workspaces)
      .set({ archivedAt: deps.clock(), updatedAt: deps.clock() })
      .where(eq(workspaces.id, workspaceId));

    await deps.audit.append({
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: "workspace.archive",
      targetType: "workspace",
      targetId: workspaceId,
      workspaceId,
      ip: c.get("meta").ip,
    });
    return c.json({
      ok: true,
      message:
        "Workspace archived. Facts stay readable so members' local caches resolve — nothing is deleted yet. " +
        "The organization's retention window applies.",
    });
  });

  /** Export for the cancellation path the brief promises (brief §L). */
  app.get("/teams/:id/memory/export", requireUser(deps), requireOrgMember(deps, "id"), requireRole(["owner", "admin"]), async (c) => {
    const member = c.get("currentMember");
    const facts = await memory.exportAll(member.orgId);
    await deps.audit.append({
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: "memory.export",
      targetType: "org",
      targetId: member.orgId,
      ip: c.get("meta").ip,
      detail: { factCount: facts.length },
    });
    return c.json(
      {
        exportedAt: deps.clock().toISOString(),
        orgId: member.orgId,
        factCount: facts.length,
        // Plaintext, because this is the organization's own data and the entire
        // point is that it remains usable after cancellation. It is delivered
        // over TLS to an authenticated admin and nowhere else.
        facts,
        note:
          "This export is plaintext. Keep it somewhere your team controls — XR cannot re-encrypt it for you after the fact, " +
          "because doing so would mean XR held a key this export does not include.",
      },
      200,
      { "content-disposition": `attachment; filename="xr-team-memory-${member.orgId}.json"` },
    );
  });

  return app;
}
