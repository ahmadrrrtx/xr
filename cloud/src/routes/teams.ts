/**
 * XR Cloud — teams, members and invitations.
 *
 * ## Role rules, stated once here rather than re-derived per handler
 *
 *   owner  — everything, including deleting the org and transferring ownership.
 *   admin  — members, invites, SSO, policies, workspaces, audit, API keys.
 *   member — read what their role allows; no administration.
 *
 * Two invariants are enforced rather than merely checked:
 *
 *   1. **An org always has at least one owner.** Removing or demoting the last
 *      owner is refused. Without this, a team can reach a state where nobody can
 *      manage billing, which is unrecoverable without support.
 *   2. **Nobody edits themselves into a promotion.** An admin cannot change their
 *      own role; only an owner can, and an owner cannot demote themselves while
 *      they are the last one.
 */

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { AppDeps } from "../deps.ts";
import { invites, members, orgs, users, workspaces } from "../db/schema.ts";
import { randomToken, sha256Hex } from "../lib/crypto.ts";
import { badRequest, conflict, forbidden, notFound, validationFailed } from "../lib/errors.ts";
import { newId, normalizeEmail, uniqueSlug } from "../lib/ids.ts";
import { addDays, humanInterval } from "../lib/time.ts";
import {
  requireBusiness,
  requireOrgMember,
  requireRole,
  requireUser,
} from "../middleware/auth.ts";
import { parseBody, parseQuery } from "../middleware/validate.ts";
import { createTeamSchema, inviteQuerySchema, inviteSchema, updateMemberSchema, updateTeamSchema } from "../schemas.ts";
import { loadSubscription } from "../services/subscriptions.ts";

const INVITE_TTL_DAYS = 14;
/** Trial seat ceiling from the brief. Paid orgs are bounded only by their seat count. */
const TRIAL_MAX_SEATS = 5;

export function teamRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  const admin = (param = "id") => [requireUser(deps), requireOrgMember(deps, param), requireRole(["owner", "admin"])] as const;

  /* ---------------------------------------------------------------- create */

  /**
   * The caller's teams.
   *
   * This is the endpoint every client boots from: the desktop needs to know which
   * org (if any) to show in Billing & Account, and the console needs it to pick a
   * default. It returns the caller's ROLE alongside each org so a client can hide
   * admin controls without a second round trip — but the role is decoration here,
   * never authorisation. Every mutating route re-reads membership from the
   * database, because a cached role is a stale role.
   */
  app.get("/teams", requireUser(deps), async (c) => {
    const auth = c.get("auth");
    const rows = await deps.db
      .select({
        orgId: orgs.id,
        name: orgs.name,
        slug: orgs.slug,
        role: members.role,
        memberStatus: members.status,
        joinedAt: members.joinedAt,
        deletionScheduledAt: orgs.deletionScheduledAt,
      })
      .from(members)
      .innerJoin(orgs, eq(orgs.id, members.orgId))
      .where(and(eq(members.userId, auth.userId), isNull(orgs.purgedAt)))
      .orderBy(desc(members.joinedAt));

    const teams = await Promise.all(
      rows.map(async (row) => {
        const subscription = await loadSubscription(deps, row.orgId);
        return {
          id: row.orgId,
          name: row.name,
          slug: row.slug,
          role: row.role,
          memberStatus: row.memberStatus,
          joinedAt: row.joinedAt,
          // Enough to render the right state without leaking Stripe identifiers.
          plan: subscription.plan,
          planStatus: subscription.status,
          trialEndsAt: subscription.trial?.endsAt ?? null,
          seats: subscription.seats,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          deletionScheduledAt: row.deletionScheduledAt,
        };
      }),
    );

    return c.json({
      teams,
      // An account with no team is the normal free-tier state, not an error. Saying
      // so explicitly keeps clients from inventing a "create your first team"
      // nag for someone who only ever wanted the local product.
      hasTeams: teams.length > 0,
      note:
        "XR is free and fully functional without a team. These are only the organizations this account has been added to.",
    });
  });

  app.post("/teams", requireUser(deps), async (c) => {
    const auth = c.get("auth");
    const body = await parseBody(c, createTeamSchema);

    const now = deps.clock();
    const orgId = newId("org");
    const orgKey = deps.orgKeys.generate();
    const wrapped = deps.orgKeys.wrap(orgKey);

    const created = await deps.db.transaction(async (tx) => {
      const rows = await tx
        .insert(orgs)
        .values({
          id: orgId,
          name: body.name,
          // Same collision handling as signup: a requested slug is honoured when
          // free and suffixed when not, rather than failing the request.
          slug: await uniqueSlug(body.slug ?? body.name, async (candidate) => {
            const clash = await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, candidate)).limit(1);
            return clash.length > 0;
          }),
          orgKeyWrapped: wrapped.ciphertext,
          kekId: wrapped.kekId,
          createdBy: auth.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx.insert(members).values({
        id: newId("member"),
        orgId,
        userId: auth.userId,
        role: "owner",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return rows[0] ?? null;
    });
    if (!created) throw conflict("Could not create the team.");

    await deps.audit.append({
      orgId,
      actorKind: "user",
      actorId: auth.userId,
      actorEmail: c.get("currentUser").email,
      action: "team.create",
      targetType: "org",
      targetId: orgId,
      ip: c.get("meta").ip,
      userAgent: c.get("meta").userAgent,
      detail: { name: body.name },
    });

    return c.json({ team: { id: created.id, name: created.name, slug: created.slug }, role: "owner" }, 201);
  });

  /* ------------------------------------------------------------------ read */

  app.get("/teams/:id", requireUser(deps), requireOrgMember(deps, "id"), async (c) => {
    const member = c.get("currentMember");
    const rows = await deps.db.select().from(orgs).where(eq(orgs.id, member.orgId)).limit(1);
    const org = rows[0];
    if (!org) throw notFound("Team");

    const subscription = await loadSubscription(deps, org.id);
    const counts = await deps.db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${members.status} = 'active')::int`,
        pending: sql<number>`count(*) filter (where ${members.status} = 'invited')::int`,
      })
      .from(members)
      .where(eq(members.orgId, org.id));

    return c.json({
      team: { id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt.toISOString() },
      viewerRole: member.role,
      seats: { used: counts[0]?.active ?? 0, invited: counts[0]?.pending ?? 0, purchased: subscription.seats },
      subscription: {
        status: subscription.status,
        plan: subscription.plan,
        businessActive: subscription.businessActive,
        nextBillingDate: subscription.nextBillingDate?.toISOString() ?? null,
      },
    });
  });

  app.patch("/teams/:id", ...admin(), async (c) => {
    const member = c.get("currentMember");
    const body = await parseBody(c, updateTeamSchema);
    if (!body.name) throw badRequest("Nothing to update.", "Send a new team name.");

    await deps.db.update(orgs).set({ name: body.name, updatedAt: deps.clock() }).where(eq(orgs.id, member.orgId));
    await deps.audit.append({
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      action: "team.update",
      targetType: "org",
      targetId: member.orgId,
      ip: c.get("meta").ip,
      detail: { changed: ["name"] },
    });
    return c.json({ ok: true });
  });

  /* --------------------------------------------------------------- members */

  app.get("/teams/:id/members", requireUser(deps), requireOrgMember(deps, "id"), async (c) => {
    const member = c.get("currentMember");
    const rows = await deps.db
      .select({
        id: members.id,
        userId: members.userId,
        email: users.email,
        name: users.name,
        role: members.role,
        status: members.status,
        dailyCapMicroUsd: members.dailyCapMicroUsd,
        monthlyCapMicroUsd: members.monthlyCapMicroUsd,
        byokOnly: members.byokOnly,
        joinedAt: members.joinedAt,
        lastActiveAt: members.lastActiveAt,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.orgId, member.orgId))
      .orderBy(desc(members.joinedAt))
      .limit(500);

    return c.json({
      members: rows.map((r) => ({
        ...r,
        joinedAt: r.joinedAt.toISOString(),
        lastActiveAt: r.lastActiveAt?.toISOString() ?? null,
        lastActiveText: r.lastActiveAt ? humanInterval(r.lastActiveAt, deps.clock()) : "never",
        isSelf: r.userId === c.get("auth").userId,
      })),
      viewerRole: member.role,
    });
  });

  app.patch("/teams/:id/members/:memberId", ...admin(), async (c) => {
    const actor = c.get("currentMember");
    const memberId = c.req.param("memberId");
    if (!memberId) throw badRequest("Missing member id.");
    const body = await parseBody(c, updateMemberSchema);

    const targetRows = await deps.db
      .select()
      .from(members)
      .where(and(eq(members.orgId, actor.orgId), eq(members.id, memberId)))
      .limit(1);
    const target = targetRows[0];
    if (!target) throw notFound("Member");

    const isSelf = target.userId === c.get("auth").userId;
    const changingRole = body.role !== undefined && body.role !== target.role;
    const ownerCount = await countOwners(deps, actor.orgId);

    if (changingRole && actor.role !== "owner") {
      throw forbidden("Only an owner can change someone's role.");
    }
    if (changingRole && isSelf) {
      throw forbidden(
        "You cannot change your own role. Ask another owner to do it — this exists so a mistake cannot lock a team out of its own billing.",
      );
    }
    if (changingRole && target.role === "owner" && body.role !== "owner" && ownerCount <= 1) {
      throw conflict(
        "This is the team's only owner.",
        "Promote someone else to owner first, then change this role. A team with no owner cannot manage its subscription.",
      );
    }

    const changes: string[] = [];
    const patch: Record<string, unknown> = { updatedAt: deps.clock() };
    if (body.role !== undefined && body.role !== target.role) {
      patch.role = body.role;
      changes.push("role");
    }
    if (body.status !== undefined && body.status !== target.status) {
      patch.status = body.status;
      changes.push("status");
    }
    if (body.dailyCapMicroUsd !== undefined) {
      patch.dailyCapMicroUsd = body.dailyCapMicroUsd;
      changes.push("dailyCapMicroUsd");
    }
    if (body.monthlyCapMicroUsd !== undefined) {
      patch.monthlyCapMicroUsd = body.monthlyCapMicroUsd;
      changes.push("monthlyCapMicroUsd");
    }
    if (body.byokOnly !== undefined) {
      patch.byokOnly = body.byokOnly;
      changes.push("byokOnly");
    }
    if (changes.length === 0) return c.json({ ok: true, changed: [] });

    await deps.db.update(members).set(patch).where(eq(members.id, memberId));
    await deps.audit.append({
      orgId: actor.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: changes.includes("role") ? "member.role_change" : "member.update",
      targetType: "member",
      targetId: memberId,
      ip: c.get("meta").ip,
      userAgent: c.get("meta").userAgent,
      // Old/new values are recorded for the editable fields. A role change is
      // exactly the kind of thing an auditor asks "who did this and when" about.
      detail: {
        changed: changes,
        from: changes.includes("role") ? target.role : undefined,
        to: body.role,
        status: body.status,
      },
    });

    return c.json({ ok: true, changed: changes });
  });

  app.delete("/teams/:id/members/:memberId", ...admin(), async (c) => {
    const actor = c.get("currentMember");
    const memberId = c.req.param("memberId");
    if (!memberId) throw badRequest("Missing member id.");

    const targetRows = await deps.db
      .select()
      .from(members)
      .where(and(eq(members.orgId, actor.orgId), eq(members.id, memberId)))
      .limit(1);
    const target = targetRows[0];
    if (!target) throw notFound("Member");
    if (target.userId === c.get("auth").userId) {
      throw forbidden("You cannot remove yourself. Ask another admin, or leave from your own account settings.");
    }
    if (target.role === "owner" && (await countOwners(deps, actor.orgId)) <= 1) {
      throw conflict(
        "This is the team's only owner.",
        "Promote someone else first. Removing the last owner would leave the team unmanageable.",
      );
    }

    // Soft removal, not a delete: the audit trail must keep naming who did what,
    // and a returning member keeps their authored facts. Retention then applies
    // per the org's own policy rather than instantly.
    await deps.db
      .update(members)
      .set({ status: "disabled", updatedAt: deps.clock() })
      .where(eq(members.id, memberId));

    // Live sessions for that member inside this org are revoked. They can still
    // use XR locally — this revokes the *team* session, nothing else.
    const { sessions } = await import("../db/schema.ts");
    await deps.db
      .update(sessions)
      .set({ revokedAt: deps.clock() })
      .where(and(eq(sessions.userId, target.userId), eq(sessions.orgId, actor.orgId)));

    await deps.audit.append({
      orgId: actor.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: "member.remove",
      targetType: "member",
      targetId: memberId,
      ip: c.get("meta").ip,
      userAgent: c.get("meta").userAgent,
      detail: { priorRole: target.role, retentionDays: (await retentionDays(deps, actor.orgId)) },
    });

    return c.json({
      ok: true,
      message:
        "Member removed. Their local XR keeps running with everything they had — only team access stopped. " +
        "Their team-authored data is retained for the organization's configured retention window.",
    });
  });

  /* --------------------------------------------------------------- invites */

  app.get("/teams/:id/invites", ...admin(), async (c) => {
    const member = c.get("currentMember");
    const query = parseQuery(c, inviteQuerySchema);
    const rows = await deps.db
      .select()
      .from(invites)
      .where(eq(invites.orgId, member.orgId))
      .orderBy(desc(invites.createdAt))
      .limit(300);

    const now = deps.clock();
    const filtered = rows.filter((row) => {
      if (query.state === "all") return true;
      if (query.state === "accepted") return row.acceptedAt !== null;
      if (query.state === "expired") return row.acceptedAt === null && row.expiresAt.getTime() <= now.getTime();
      return row.acceptedAt === null && !row.revokedAt && row.expiresAt.getTime() > now.getTime();
    });

    return c.json({
      invites: filtered.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        expiresText: humanInterval(row.expiresAt, now),
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        state: row.acceptedAt
          ? "accepted"
          : row.revokedAt
            ? "revoked"
            : row.expiresAt.getTime() <= now.getTime()
              ? "expired"
              : "pending",
      })),
    });
  });

  app.post("/teams/:id/invites", ...admin(), requireBusiness(deps), async (c) => {
    const actor = c.get("currentMember");
    const body = await parseBody(c, inviteSchema);
    const email = normalizeEmail(body.email);

    const limited = await deps.limiter.consume("invite", `org:${actor.orgId}`);
    if (!limited.allowed) {
      throw validationFailed({
        "(invites)": `Too many invitations sent. Try again in ${limited.retryAfterSeconds ?? 60} seconds.`,
      });
    }

    const subscription = await loadSubscription(deps, actor.orgId);
    if (subscription.status === "trialing") {
      const active = await deps.db
        .select({ n: sql<number>`count(*)::int` })
        .from(members)
        .where(and(eq(members.orgId, actor.orgId), eq(members.status, "active")));
      const pending = await deps.db
        .select({ n: sql<number>`count(*)::int` })
        .from(invites)
        .where(and(eq(invites.orgId, actor.orgId), isNull(invites.acceptedAt), gt(invites.expiresAt, deps.clock())));
      const counted = (active[0]?.n ?? 0) + (pending[0]?.n ?? 0);
      if (counted >= TRIAL_MAX_SEATS) {
        throw conflict(
          `Trials are capped at ${TRIAL_MAX_SEATS} seats.`,
          "Add a payment method from the Billing page to invite more teammates. You can also remove a pending invitation first.",
        );
      }
    }

    const existingUser = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUser[0]) {
      const already = await deps.db
        .select({ id: members.id, status: members.status })
        .from(members)
        .where(and(eq(members.orgId, actor.orgId), eq(members.userId, existingUser[0].id)))
        .limit(1);
      if (already[0]?.status === "active") {
        throw conflict("That person is already on the team.", "Change their role from the members list instead.");
      }
    }

    const pending = await deps.db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.orgId, actor.orgId),
          eq(invites.email, email),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      )
      .limit(1);
    if (pending[0] && pending[0].expiresAt.getTime() > deps.clock().getTime()) {
      if (!body.resend) {
        throw conflict(
          "An invitation is already pending for that address.",
          "Tick resend to issue a fresh link, or revoke the existing one first.",
        );
      }
      await deps.db.update(invites).set({ revokedAt: deps.clock() }).where(eq(invites.id, pending[0].id));
    }

    const token = randomToken(32);
    const orgRows = await deps.db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, actor.orgId)).limit(1);

    const created = await deps.db
      .insert(invites)
      .values({
        id: newId("invite"),
        orgId: actor.orgId,
        email,
        role: body.role,
        tokenHash: sha256Hex(token),
        invitedBy: c.get("auth").userId,
        expiresAt: addDays(deps.clock(), INVITE_TTL_DAYS),
      })
      .returning();
    const invite = created[0];
    if (!invite) throw conflict("Could not create the invitation.");

    const link = `${deps.env.APP_URL}/auth/invite?token=${encodeURIComponent(token)}`;
    const sent = await deps.mailer.sendInvite({
      to: email,
      orgName: orgRows[0]?.name ?? "your team",
      inviterEmail: c.get("currentUser").email,
      role: body.role,
      link,
      expiresInDays: INVITE_TTL_DAYS,
    });

    await deps.audit.append({
      orgId: actor.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: "member.invite",
      targetType: "invite",
      targetId: invite.id,
      ip: c.get("meta").ip,
      userAgent: c.get("meta").userAgent,
      detail: { role: body.role, delivered: sent.ok, domain: email.split("@")[1] },
    });

    return c.json(
      {
        invite: {
          id: invite.id,
          email,
          role: body.role,
          expiresAt: invite.expiresAt.toISOString(),
        },
        delivered: sent.ok,
        // The token itself is NEVER returned. Returning it would let any admin
        // mint a working credential for someone else's mailbox. The link is
        // printed only when delivery failed, so an admin can hand it over
        // out-of-band — and only outside production.
        ...(!sent.ok && deps.env.NODE_ENV !== "production" ? { fallbackLink: link } : {}),
        ...(!sent.ok
          ? {
              deliveryWarning:
                "The invitation was created but the email could not be sent. Check GET /readyz → checks.mail, then resend.",
            }
          : {}),
      },
      201,
    );
  });

  app.delete("/teams/:id/invites/:inviteId", ...admin(), async (c) => {
    const actor = c.get("currentMember");
    const inviteId = c.req.param("inviteId");
    if (!inviteId) throw badRequest("Missing invitation id.");
    const updated = await deps.db
      .update(invites)
      .set({ revokedAt: deps.clock() })
      .where(and(eq(invites.orgId, actor.orgId), eq(invites.id, inviteId), isNull(invites.acceptedAt)))
      .returning({ id: invites.id });
    if (updated.length === 0) throw notFound("Pending invitation");
    await deps.audit.append({
      orgId: actor.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      action: "member.invite_revoked",
      targetType: "invite",
      targetId: inviteId,
      ip: c.get("meta").ip,
    });
    return c.json({ ok: true });
  });

  /* ------------------------------------------------------------ workspaces */

  app.get("/teams/:id/workspaces", requireUser(deps), requireOrgMember(deps, "id"), async (c) => {
    const member = c.get("currentMember");
    const rows = await deps.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.orgId, member.orgId), isNull(workspaces.archivedAt)))
      .orderBy(workspaces.name)
      .limit(200);
    return c.json({
      workspaces: rows.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        memoryVisibility: w.memoryVisibility,
        ownerId: w.ownerId,
        createdAt: w.createdAt.toISOString(),
      })),
    });
  });

  return app;
}

async function countOwners(deps: AppDeps, orgId: string): Promise<number> {
  const rows = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(members)
    .where(and(eq(members.orgId, orgId), eq(members.role, "owner"), eq(members.status, "active")));
  return rows[0]?.n ?? 0;
}

async function retentionDays(deps: AppDeps, orgId: string): Promise<number> {
  const { policies } = await import("../db/schema.ts");
  const rows = await deps.db.select({ days: policies.dataRetentionDays }).from(policies).where(eq(policies.orgId, orgId)).limit(1);
  return rows[0]?.days ?? 30;
}
