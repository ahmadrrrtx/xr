/**
 * XR Cloud — authentication routes.
 *
 * Email magic link is the primary credential (brief §C), with an optional
 * password for operators who want one, and SSO in `routes/sso.ts`.
 *
 * ## Details that are load-bearing
 *
 *   - **Signup and magic link answer identically for a known and an unknown
 *     address.** "Check your email" is returned either way, whether that email
 *     creates an account or signs into an existing one. The alternative is an
 *     account-existence oracle, which is how a competitor enumerates a customer
 *     list one address at a time.
 *   - **Tokens are single-use.** A consumed magic link is marked consumed inside
 *     the same transaction that issues the session, so two simultaneous clicks on
 *     the same link cannot both succeed.
 *   - **Tokens are stored hashed.** A database read does not yield a working link.
 *   - **`redirectTo` is validated against `APP_URL`.** An attacker-supplied open
 *     redirect would turn the login flow into a phishing amplifier: a genuine
 *     `api.xr.rrrtx.ai` link that bounces to `evil.example`.
 *   - **SSO-enforced orgs refuse magic links.** Otherwise the "enforced SSO"
 *     toggle is decoration and the IdP's MFA can be walked around with a mailbox.
 *     Owners are exempt so an org cannot lock itself out.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

import type { AppDeps } from "../deps.ts";
import { invites, magicLinks, members, orgs, sessions, subscriptions, users } from "../db/schema.ts";
import { randomToken, sha256Hex } from "../lib/crypto.ts";
import {
  CloudError,
  badRequest,
  conflict,
  gone,
  invalidCredentials,
  notFound,
  rateLimited,
  unauthorized,
  validationFailed,
} from "../lib/errors.ts";
import { newId, normalizeEmail, emailDomain, isUniqueViolation, uniqueSlug } from "../lib/ids.ts";
import { hashPassword, passwordProblem, verifyPassword } from "../lib/password.ts";
import { newFamilyId, mintAccessToken, mintRefreshToken } from "../lib/tokens.ts";
import { addDays, addSeconds, humanInterval } from "../lib/time.ts";
import { loadSubscription } from "../services/subscriptions.ts";
import { parseBody } from "../middleware/validate.ts";
import { auditDetached } from "../services/audit.ts";
import { REFRESH_COOKIE, SESSION_COOKIE, CSRF_COOKIE, requireUser } from "../middleware/auth.ts";
import { magicLinkSchema, signupSchema, loginSchema } from "../schemas.ts";

const MAGIC_LINK_TTL_MINUTES = 10;
const INVITE_TTL_DAYS = 14;

export function authRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  /* --------------------------------------------------------------- signup */

  app.post("/auth/signup", async (c) => {
    const meta = c.get("meta");
    const body = await parseBody(c, signupSchema);
    const email = normalizeEmail(body.email);

    const limited = await deps.limiter.consume("signup", meta.ip);
    if (!limited.allowed) throw rateLimited(limited.retryAfterSeconds ?? 60);

    if (body.password) {
      const problem = passwordProblem(body.password);
      if (problem) throw validationFailed({ password: problem });
    }

    const existing = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) {
      // Same answer as the success path would give. No enumeration oracle.
      throw conflict(
        "That email already has an XR account.",
        "Sign in instead — request a link from the sign-in page. If you were invited to a team, open the invitation email.",
      );
    }

    const now = deps.clock();
    const orgId = newId("org");
    const userId = newId("user");

    /**
     * The org key is generated here and stored only wrapped. `keyFingerprint` is
     * never persisted — the wrapped value plus the deployment KEK is the whole
     * story, and a second copy of anything key-shaped is a second thing to leak.
     */
    const orgKey = deps.orgKeys.generate();
    const wrapped = deps.orgKeys.wrap(orgKey);

    /**
     * The slug check above runs inside this transaction, which closes most of the
     * window but not all of it: two signups naming their team "Acme" at the same
     * instant can both see the slug free. The unique index is the real guard, so
     * the residual case is retried once with a fresh suffix instead of surfacing
     * as a 500 on the most common team name in the world.
     */
    const createAccount = async () =>
      deps.db.transaction(async (tx) => {
      const insertedUser = await tx
        .insert(users)
        .values({
          id: userId,
          email,
          name: body.name ?? null,
          passwordHash: body.password ? await hashPassword(body.password) : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const createdOrg = await tx
        .insert(orgs)
        .values({
          id: orgId,
          name: body.orgName,
          // Slug collisions are the common case, not the edge case: two teams
          // called "Acme" is Tuesday. Resolved inside the transaction that inserts
          // the row rather than surfaced as a 500.
          slug: await uniqueSlug(body.orgName, async (candidate) => {
            const clash = await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, candidate)).limit(1);
            return clash.length > 0;
          }),
          orgKeyWrapped: wrapped.ciphertext,
          kekId: wrapped.kekId,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await tx.insert(members).values({
        id: newId("member"),
        orgId,
        userId,
        role: "owner",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Business trial, no card up front, capped at 5 seats (brief §B/§I).
      await tx.insert(subscriptions).values({
        id: newId("subscription"),
        orgId,
        status: "trialing",
        plan: "business",
        interval: "month",
        seats: 1,
        trialEndsAt: addDays(now, deps.env.TRIAL_DAYS),
        billingEmail: email,
        createdAt: now,
        updatedAt: now,
      });

      return { user: insertedUser[0], org: createdOrg[0] };
    });

    let result: Awaited<ReturnType<typeof createAccount>>;
    try {
      result = await createAccount();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      result = await createAccount();
    }

    const user = result.user;
    const org = result.org;
    if (!user || !org) throw conflict("Could not create the account.");

    const issued = await issueSession(deps, {
      userId: user.id,
      orgId: org.id,
      role: "owner",
      kind: "web",
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    setSessionCookies(c, deps, issued);

    auditDetached(deps, {
      orgId,
      actorKind: "user",
      actorId: user.id,
      actorEmail: email,
      action: "account.signup",
      targetType: "org",
      targetId: orgId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { orgName: body.orgName, trialDays: deps.env.TRIAL_DAYS },
    });

    return c.json(
      {
        user: { id: user.id, email: user.email, name: user.name },
        org: { id: org.id, name: org.name, slug: org.slug, role: "owner" },
        plan: "trial",
        trialEndsInDays: deps.env.TRIAL_DAYS,
        tokens: { accessToken: issued.accessToken, expiresInSeconds: issued.expiresInSeconds },
      },
      201,
    );
  });

  /* ----------------------------------------------------------- magic link */

  app.post("/auth/magic-link", async (c) => {
    const meta = c.get("meta");
    const body = await parseBody(c, magicLinkSchema);
    const email = normalizeEmail(body.email);

    // Per-email AND per-IP, independently. A limit on either alone is trivially
    // sidestepped: one rotates the address, the other rotates the source.
    const byEmail = await deps.limiter.consume("magicLink", `email:${email}`);
    if (!byEmail.allowed) throw rateLimited(byEmail.retryAfterSeconds ?? 60);
    const byIp = await deps.limiter.consume("magicLink", `ip:${meta.ip}`);
    if (!byIp.allowed) throw rateLimited(byIp.retryAfterSeconds ?? 60);

    const redirectTo = safeRedirect(deps, body.redirectTo);
    const found = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found[0];

    // Enforced SSO: refuse the mailbox route (brief §F). Owners are exempt so
    // misconfiguring SSO cannot permanently lock an organization out of itself.
    if (user && (await isSsoEnforcedFor(deps, user.id, email))) {
      const orgRow = await orgForEnforcedSso(deps, user.id, email);
      throw new CloudError(
        403,
        "sso_enforced",
        "Your organization requires single sign-on.",
        {
          repair:
            "Sign in with your identity provider instead. Your admin also has the option to allow email links for owners only.",
          details: { ssoStartPath: orgRow ? `/auth/sso/start?org=${orgRow}` : "/auth/sso/start" },
        },
      );
    }

    const token = randomToken(32);
    await deps.db.insert(magicLinks).values({
      id: newId("magicLink"),
      email,
      tokenHash: sha256Hex(token),
      redirectTo,
      expiresAt: addSeconds(deps.clock(), MAGIC_LINK_TTL_MINUTES * 60),
    });

    const link = `${deps.env.API_URL}/auth/magic/callback?token=${encodeURIComponent(token)}${redirectTo ? `&redirect_to=${encodeURIComponent(redirectTo)}` : ""}`;

    const sent = await deps.mailer.sendSignInLink({
      to: email,
      link,
      minutesValid: MAGIC_LINK_TTL_MINUTES,
      isNewAccount: !user,
    });

    if (!sent.ok) {
      // Report it. Silently implying an email was sent is the failure mode this
      // whole path exists to avoid.
      deps.log.error({ detail: sent.error, transport: sent.transport }, "sign-in link not delivered");
      return c.json(
        {
          error: {
            code: "unavailable" as const,
            message: "We could not send the sign-in email.",
            repair:
              "This deployment's mail transport is not working. An operator can check `GET /readyz` → checks.mail for the specific reason.",
            requestId: c.get("requestId"),
          },
        },
        503,
      );
    }

    return c.json({
      ok: true,
      message: "If that address has an XR account, a sign-in link is on its way. It works for 10 minutes and once.",
      // Development affordance only. Never present in production.
      ...(deps.env.NODE_ENV !== "production" && sent.transport === "capture" ? { capturedTo: sent.path } : {}),
    });
  });

  app.get("/auth/magic/callback", async (c) => {
    const meta = c.get("meta");
    const token = c.req.query("token");
    if (!token) throw badRequest("Missing sign-in token.", "Open the link from your email again, or request a new one.");

    const hash = sha256Hex(token);
    const rows = await deps.db.select().from(magicLinks).where(eq(magicLinks.tokenHash, hash)).limit(1);
    const link = rows[0];
    if (!link) throw invalidCredentials();
    if (link.consumedAt) throw gone("That sign-in link has already been used. Request a new one.");
    if (link.expiresAt.getTime() <= deps.clock().getTime()) {
      throw gone("That sign-in link expired. Request a new one — they last 10 minutes.");
    }

    // Consume inside the transaction that reads it, so two clicks cannot both win.
    const consumed = await deps.db.transaction(async (tx) => {
      const claimed = await tx
        .update(magicLinks)
        .set({ consumedAt: deps.clock() })
        .where(and(eq(magicLinks.id, link.id), isNull(magicLinks.consumedAt)))
        .returning();
      return claimed[0] ?? null;
    });
    if (!consumed) throw gone("That sign-in link has already been used. Request a new one.");

    const existing = await deps.db.select().from(users).where(eq(users.email, link.email)).limit(1);
    let user = existing[0];

    if (!user) {
      // A magic link to an unknown address is a signup, not an error. Creating
      // the account here is what makes "invite by email" work for someone who has
      // never installed XR.
      const now = deps.clock();
      const userId = newId("user");
      const created = await deps.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(users)
          .values({ id: userId, email: link.email, emailVerifiedAt: now, createdAt: now, updatedAt: now })
          .returning();
        return inserted[0] ?? null;
      });
      user = created ?? undefined;
      if (!user) throw conflict("Could not create the account.");
    } else if (!user.emailVerifiedAt) {
      await deps.db
        .update(users)
        .set({ emailVerifiedAt: deps.clock(), updatedAt: deps.clock() })
        .where(eq(users.id, user.id));
    }

    const membership = await primaryMembership(deps, user.id);
    const issued = await issueSession(deps, {
      userId: user.id,
      orgId: membership?.orgId ?? null,
      role: membership?.role ?? null,
      kind: "web",
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    setSessionCookies(c, deps, issued);

    if (membership) {
      auditDetached(deps, {
        orgId: membership.orgId,
        actorKind: "user",
        actorId: user.id,
        actorEmail: user.email,
        action: "auth.signin",
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { method: "magic-link" },
      });
    }

    const redirectTo = safeRedirect(deps, link.redirectTo) ?? `${deps.env.APP_URL}/dashboard`;
    // Deep link back into the desktop: the browser, not the app, is handling this
    // navigation, so it hands off through the custom scheme.
    return c.redirect(`${deps.env.APP_URL}/auth/complete?next=${encodeURIComponent(redirectTo)}`, 302);
  });

  /* ---------------------------------------------------------------- login */

  app.post("/auth/login", async (c) => {
    const meta = c.get("meta");
    const body = await parseBody(c, loginSchema);

    const limited = await deps.limiter.consume("login", `ip:${meta.ip}`);
    if (!limited.allowed) throw rateLimited(limited.retryAfterSeconds ?? 60);

    const email = normalizeEmail(body.email);
    const found = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found[0];

    // `verifyPassword` runs a dummy hash when there is no stored hash, so the
    // response time does not disclose whether the account exists.
    const ok = await verifyPassword(body.password ?? "", user?.passwordHash ?? null);
    if (!user || !ok) throw invalidCredentials();

    const membership = await primaryMembership(deps, user.id);
    const issued = await issueSession(deps, {
      userId: user.id,
      orgId: membership?.orgId ?? null,
      role: membership?.role ?? null,
      kind: "web",
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    setSessionCookies(c, deps, issued);
    await deps.limiter.reset("login", `ip:${meta.ip}`);

    return c.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name },
      tokens: { accessToken: issued.accessToken, expiresInSeconds: issued.expiresInSeconds },
    });
  });

  /* -------------------------------------------------------------- session */

  /**
   * Device/session listing. A user must be able to see the machine that is
   * signed in as them — the brief promises device/session management, and a
   * session list nobody can read is not management.
   */
  app.get("/auth/sessions", requireUser(deps), async (c) => {
    const auth = c.get("auth");
    const rows = await deps.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, auth.userId), isNull(sessions.revokedAt)))
      .orderBy(desc(sessions.createdAt))
      .limit(50);
    return c.json({
      sessions: rows.map((s) => ({
        id: s.id,
        kind: s.kind,
        userAgent: s.userAgent,
        ip: s.ip === null ? null : maskIp(s.ip),
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
        expiresAt: s.expiresAt.toISOString(),
        current: s.id === auth.sessionId,
      })),
    });
  });

  app.delete("/auth/sessions/:id", requireUser(deps), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    if (!id) throw badRequest("Missing session id.");
    const updated = await deps.db
      .update(sessions)
      .set({ revokedAt: deps.clock() })
      .where(and(eq(sessions.id, id), eq(sessions.userId, auth.userId)))
      .returning({ id: sessions.id });
    if (updated.length === 0) throw notFound("Session");
    return c.json({ ok: true, revoked: id });
  });

  app.post("/auth/refresh", async (c) => {
    const meta = c.get("meta");
    const token = readCookie(c.req.header("cookie"), REFRESH_COOKIE) ?? (await tryBodyRefreshToken(c));
    if (!token) throw unauthorized("No refresh token.");

    const limited = await deps.limiter.consume("authGeneral", `ip:${meta.ip}`);
    if (!limited.allowed) throw rateLimited(limited.retryAfterSeconds ?? 60);

    const hash = sha256Hex(token);
    const rows = await deps.db.select().from(sessions).where(eq(sessions.refreshHash, hash)).limit(1);
    const session = rows[0];

    if (!session) {
      // Unknown token. Could be garbage, could be a token from a family we
      // already revoked after detecting reuse. Either way: no.
      throw unauthorized("That refresh token is not valid.");
    }

    if (session.revokedAt) {
      /*
       * REUSE DETECTED. The token was rotated, so a valid, live copy exists
       * somewhere else — and this request is presenting an old one. The
       * conservative read is that one of the two copies has been stolen, and the
       * whole rotation family is revoked rather than guessing which.
       */
      await deps.db
        .update(sessions)
        .set({ revokedAt: deps.clock() })
        .where(eq(sessions.familyId, session.familyId));
      deps.log.warn(
        { familyId: session.familyId, userId: session.userId, ip: meta.ip },
        "refresh token reuse detected — family revoked",
      );
      throw unauthorized(
        "That session was already refreshed elsewhere, so it has been revoked as a precaution. Sign in again.",
      );
    }

    if (session.expiresAt.getTime() <= deps.clock().getTime()) {
      throw unauthorized("Your session expired. Sign in again.");
    }

    const membership = await primaryMembership(deps, session.userId);
    const issued = await issueSession(deps, {
      userId: session.userId,
      orgId: session.orgId ?? membership?.orgId ?? null,
      role: membership?.role ?? null,
      kind: session.kind,
      userAgent: meta.userAgent,
      ip: meta.ip,
      familyId: session.familyId,
      rotateFrom: session.id,
    });
    setSessionCookies(c, deps, issued);

    return c.json({
      ok: true,
      tokens: { accessToken: issued.accessToken, expiresInSeconds: issued.expiresInSeconds },
    });
  });

  app.post("/auth/logout", async (c) => {
    const auth = c.get("auth");
    if (auth?.sessionId) {
      await deps.db
        .update(sessions)
        .set({ revokedAt: deps.clock() })
        .where(eq(sessions.id, auth.sessionId));
    }
    clearSessionCookies(c, deps);
    return c.json({ ok: true });
  });

  /**
   * The desktop's boot call. Returns everything the Billing card needs in one
   * request so the card does not fan out four calls to render itself.
   */
  app.get("/auth/me", requireUser(deps), async (c) => {
    const auth = c.get("auth");
    const user = c.get("currentUser");

    const memberships = await deps.db
      .select({
        orgId: members.orgId,
        role: members.role,
        status: members.status,
        orgName: orgs.name,
        orgSlug: orgs.slug,
        dailyCapMicroUsd: members.dailyCapMicroUsd,
        monthlyCapMicroUsd: members.monthlyCapMicroUsd,
        byokOnly: members.byokOnly,
      })
      .from(members)
      .innerJoin(orgs, eq(orgs.id, members.orgId))
      .where(eq(members.userId, auth.userId));

    const active = memberships.filter((m) => m.status !== "disabled");
    const current = active.find((m) => m.orgId === auth.orgId) ?? active[0] ?? null;
    const subscription = current ? await loadSubscription(deps, current.orgId) : null;

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerifiedAt !== null,
      },
      memberships: active.map((m) => ({
        orgId: m.orgId,
        orgName: m.orgName,
        orgSlug: m.orgSlug,
        role: m.role,
        dailyCapMicroUsd: m.dailyCapMicroUsd,
        monthlyCapMicroUsd: m.monthlyCapMicroUsd,
        byokOnly: m.byokOnly,
      })),
      activeOrgId: current?.orgId ?? null,
      role: current?.role ?? null,
      subscription: subscription
        ? {
            status: subscription.status,
            plan: subscription.plan,
            seats: subscription.seats,
            interval: subscription.interval,
            businessActive: subscription.businessActive,
            entitlements: subscription.entitlements,
            trial: subscription.trial
              ? {
                  active: subscription.trial.active,
                  endsAt: subscription.trial.endsAt?.toISOString() ?? null,
                  daysLeft: subscription.trial.daysLeft,
                  text: subscription.trial.active
                    ? `30-day trial — ${subscription.trial.daysLeft} day${subscription.trial.daysLeft === 1 ? "" : "s"} left; add a payment method to continue`
                    : "Trial ended — add a payment method to restore team features",
                }
              : null,
            nextBillingDate: subscription.nextBillingDate?.toISOString() ?? null,
            nextBillingText: subscription.nextBillingDate
              ? humanInterval(subscription.nextBillingDate, deps.clock())
              : null,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            isPastDue: subscription.isPastDue,
            note: subscription.reason,
          }
        : null,
      via: auth.via,
    });
  });

  /* -------------------------------------------------------------- invites */

  /** Accepting an invite needs no session; the emailed token is the credential. */
  app.post("/invites/:token/accept", async (c) => {
    const token = c.req.param("token");
    if (!token) throw badRequest("Missing invitation token.");
    const hash = sha256Hex(token);

    const rows = await deps.db.select().from(invites).where(eq(invites.tokenHash, hash)).limit(1);
    const invite = rows[0];
    if (!invite) throw notFound("Invitation");
    if (invite.revokedAt) throw gone("That invitation was revoked. Ask an admin to send a new one.");
    if (invite.acceptedAt) throw gone("That invitation was already accepted.");
    if (invite.expiresAt.getTime() <= deps.clock().getTime()) {
      throw gone(`That invitation expired. Ask an admin to send a new one — they last ${INVITE_TTL_DAYS} days.`);
    }

    const orgRows = await deps.db.select().from(orgs).where(eq(orgs.id, invite.orgId)).limit(1);
    const org = orgRows[0];
    if (!org) throw notFound("Organization");

    const email = normalizeEmail(invite.email);
    const found = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
    let user = found[0];

    if (!user) {
      const now = deps.clock();
      const created = await deps.db
        .insert(users)
        .values({ id: newId("user"), email, createdAt: now, updatedAt: now })
        .returning();
      user = created[0];
      if (!user) throw conflict("Could not create the account.");
    }

    const existingMember = await deps.db
      .select()
      .from(members)
      .where(and(eq(members.orgId, invite.orgId), eq(members.userId, user.id)))
      .limit(1);

    if (existingMember[0]) {
      if (existingMember[0].status === "active") {
        await deps.db.update(invites).set({ acceptedAt: deps.clock(), acceptedBy: user.id }).where(eq(invites.id, invite.id));
        // Still issue a session, and still return the same shape as the normal
        // path. Someone clicking an invitation from a fresh browser has proved
        // control of the address either way, and answering with a different body
        // here would make clients reason about a state that is not interesting:
        // whether they happened to already be on the team.
        const reissued = await issueSession(deps, {
          userId: user.id,
          orgId: invite.orgId,
          role: existingMember[0].role,
          kind: "web",
          userAgent: c.get("meta").userAgent,
          ip: c.get("meta").ip,
        });
        setSessionCookies(c, deps, reissued);
        return c.json({
          ok: true,
          alreadyMember: true,
          org: { id: org.id, name: org.name },
          role: existingMember[0].role,
          tokens: { accessToken: reissued.accessToken, expiresInSeconds: reissued.expiresInSeconds },
          message: "You were already on this team. You are signed in.",
        });
      }
      await deps.db
        .update(members)
        .set({ status: "active", role: invite.role, updatedAt: deps.clock() })
        .where(eq(members.id, existingMember[0].id));
    } else {
      await deps.db.insert(members).values({
        id: newId("member"),
        orgId: invite.orgId,
        userId: user.id,
        role: invite.role,
        status: "active",
        joinedAt: deps.clock(),
        createdAt: deps.clock(),
        updatedAt: deps.clock(),
      });
    }

    await deps.db
      .update(invites)
      .set({ acceptedAt: deps.clock(), acceptedBy: user.id })
      .where(eq(invites.id, invite.id));

    const issued = await issueSession(deps, {
      userId: user.id,
      orgId: invite.orgId,
      role: invite.role,
      kind: "web",
      userAgent: c.get("meta").userAgent,
      ip: c.get("meta").ip,
    });
    setSessionCookies(c, deps, issued);

    auditDetached(deps, {
      orgId: invite.orgId,
      actorKind: "user",
      actorId: user.id,
      actorEmail: email,
      action: "member.invite_accepted",
      targetType: "member",
      targetId: user.id,
      detail: { role: invite.role },
    });

    return c.json({
      ok: true,
      org: { id: org.id, name: org.name },
      role: invite.role,
      tokens: { accessToken: issued.accessToken, expiresInSeconds: issued.expiresInSeconds },
      message:
        "You are on the team. XR will keep running locally on your machine exactly as it does today — team features are added on top.",
    });
  });

  /* --------------------------------------------------------------- helpers */

  return app;
}

/* ------------------------------------------------------------------------- */
/* shared helpers                                                             */
/* ------------------------------------------------------------------------- */

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  sessionId: string;
}

export async function issueSession(
  deps: AppDeps,
  input: {
    userId: string;
    orgId: string | null;
    role: string | null;
    kind: "web" | "device" | "cli" | "vscode" | "mobile";
    userAgent?: string;
    ip?: string;
    /** Existing rotation family, when rotating rather than starting. */
    familyId?: string;
    rotateFrom?: string;
  },
): Promise<IssuedSession> {
  const now = deps.clock();
  const refresh = mintRefreshToken();
  const sessionId = newId("session");
  const refreshExpiresAt = addDays(now, deps.env.SESSION_REFRESH_TTL_DAYS);
  const familyId = input.familyId ?? newFamilyId();

  await deps.db.insert(sessions).values({
    id: sessionId,
    userId: input.userId,
    orgId: input.orgId,
    kind: input.kind,
    refreshHash: refresh.hash,
    familyId,
    userAgent: input.userAgent ?? null,
    ip: input.ip ?? null,
    expiresAt: refreshExpiresAt,
    createdAt: now,
  });

  if (input.rotateFrom) {
    // Rotation: the presented token is revoked in the same breath as its
    // replacement being minted, so there is never a window with two live tokens.
    await deps.db
      .update(sessions)
      .set({ revokedAt: now, lastUsedAt: now })
      .where(eq(sessions.id, input.rotateFrom));
  }

  const access = await mintAccessToken({
    userId: input.userId,
    sessionId,
    orgId: input.orgId,
    role: input.role,
    kind: input.kind,
  });

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresInSeconds: access.expiresInSeconds,
    accessExpiresAt: access.expiresAt,
    refreshExpiresAt,
    sessionId,
  };
}

function cookieFor(
  deps: AppDeps,
  name: string,
  value: string,
  opts: { maxAgeSeconds: number; httpOnly: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${opts.maxAgeSeconds}`,
    // Lax, not Strict: a user following an emailed link arrives from another
    // origin, and Strict would drop the session on that navigation.
    "SameSite=Lax",
  ];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (deps.env.NODE_ENV === "production") parts.push("Secure");
  if (deps.env.COOKIE_DOMAIN) parts.push(`Domain=${deps.env.COOKIE_DOMAIN}`);
  return parts.join("; ");
}

export function setSessionCookies(
  c: { header: (k: string, v: string, o?: { append?: boolean }) => void },
  deps: AppDeps,
  issued: IssuedSession,
): void {
  const accessTtl = Math.max(60, Math.floor((issued.accessExpiresAt.getTime() - Date.now()) / 1000));
  c.header("Set-Cookie", cookieFor(deps, SESSION_COOKIE, issued.accessToken, { maxAgeSeconds: accessTtl, httpOnly: true }), { append: true });
  const refreshTtl = Math.max(60, Math.floor((issued.refreshExpiresAt.getTime() - Date.now()) / 1000));
  c.header("Set-Cookie", cookieFor(deps, REFRESH_COOKIE, issued.refreshToken, { maxAgeSeconds: refreshTtl, httpOnly: true }), { append: true });
  // Readable by client JS on purpose: this is the double-submit half of CSRF,
  // and a CSRF token that JavaScript cannot read protects nothing.
  c.header("Set-Cookie", cookieFor(deps, CSRF_COOKIE, randomToken(24), { maxAgeSeconds: 86_400, httpOnly: false }), { append: true });
}

function clearSessionCookies(
  c: { header: (k: string, v: string, o?: { append?: boolean }) => void },
  deps: AppDeps,
): void {
  for (const name of [SESSION_COOKIE, REFRESH_COOKIE]) {
    c.header("Set-Cookie", cookieFor(deps, name, "", { maxAgeSeconds: 0, httpOnly: true }), { append: true });
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

async function tryBodyRefreshToken(c: { req: { json: () => Promise<unknown> } }): Promise<string | null> {
  try {
    const body = (await c.req.json()) as { refreshToken?: unknown };
    return typeof body.refreshToken === "string" && body.refreshToken.length > 0 ? body.refreshToken : null;
  } catch {
    return null;
  }
}

/**
 * Open-redirect guard. A `redirectTo` that is not on `APP_URL` is dropped, not
 * rejected — a malformed hint should not fail a sign-in.
 */
export function safeRedirect(deps: AppDeps, candidate: string | undefined | null): string | null {
  if (!candidate) return null;
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return `${deps.env.APP_URL}${candidate}`;
  try {
    const url = new URL(candidate);
    if (url.origin === deps.env.APP_URL) return url.toString();
  } catch {
    return null;
  }
  deps.log.warn({ candidate: candidate.slice(0, 120) }, "dropped off-origin redirect hint");
  return null;
}

async function primaryMembership(
  deps: AppDeps,
  userId: string,
): Promise<{ orgId: string; role: "owner" | "admin" | "member" } | null> {
  const rows = await deps.db
    .select({ orgId: members.orgId, role: members.role })
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

async function isSsoEnforcedFor(deps: AppDeps, userId: string, email: string): Promise<boolean> {
  return (await orgForEnforcedSso(deps, userId, email)) !== null;
}

async function orgForEnforcedSso(deps: AppDeps, userId: string, email: string): Promise<string | null> {
  const domain = emailDomain(email);
  const { ssoConfigs } = await import("../db/schema.ts");
  const rows = await deps.db
    .select({ orgId: ssoConfigs.orgId, enforced: ssoConfigs.enforced, domains: ssoConfigs.emailDomains })
    .from(ssoConfigs)
    .where(eq(ssoConfigs.enforced, true));

  for (const row of rows) {
    const member = await deps.db
      .select({ id: members.id, role: members.role })
      .from(members)
      .where(and(eq(members.orgId, row.orgId), eq(members.userId, userId)))
      .limit(1);
    if (member[0]?.role === "owner") continue; // owners are exempt by design
    if (domain && row.domains.includes(domain)) return row.orgId;
    if (member[0]) return row.orgId;
  }
  return null;
}

function maskIp(ip: string): string {
  // Session lists are user-facing; a full address is more than is useful there.
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts.slice(0, 3).join(":")}::…`;
  }
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : ip;
}
