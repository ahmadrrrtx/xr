/**
 * XR Cloud — authentication and authorization middleware.
 *
 * ## Three ways in, one principal
 *
 *   1. `Authorization: Bearer <access jwt>` — the desktop daemon, CLI, VS Code
 *      extension and the mobile PWA. Stateless.
 *   2. `xr_session` httpOnly cookie — the web admin console. Same JWT, delivered
 *      by cookie so the browser cannot be scripted into leaking it.
 *   3. `Authorization: Bearer xr_live_…` — a Business API key for CI. Scoped, and
 *      the scope list is on the principal so route guards can check it.
 *
 * All three resolve to the same `AuthContext`, so a route never has to care which
 * door was used.
 *
 * ## Authorization is re-derived per request, never trusted from the token
 *
 * The access token carries `org` and `role` as a *hint* for cheap routing. Every
 * guard that matters re-reads the membership row. A token minted before a
 * demotion must not keep admin rights for its remaining 15 minutes — and "the
 * admin removed their access" being true within 15 minutes is not good enough
 * when the resource is an audit log.
 *
 * ## Fail closed
 *
 * `requireOrg` refuses when the caller has no membership. `requireRole` refuses
 * on an unknown role rather than defaulting to member. A membership with
 * `status = 'disabled'` is treated as absent (Constitution Art. IV.4).
 */

import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";

import type { AppDeps, AuthContext } from "../deps.ts";
import { apiKeys, members, sessions, users, type MemberRow, type UserRow } from "../db/schema.ts";
import { sha256Hex, safeEqual } from "../lib/crypto.ts";
import { forbidden, unauthorized } from "../lib/errors.ts";
import { verifyAccessToken } from "../lib/tokens.ts";

export const SESSION_COOKIE = "xr_session";
export const REFRESH_COOKIE = "xr_refresh";
export const CSRF_COOKIE = "xr_csrf";
export const CSRF_HEADER = "x-csrf-token";

export type SessionKind = "web" | "device" | "cli" | "vscode" | "mobile";

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
    /** Fresh rows for the current principal. Only populated by `requireUser`. */
    currentUser: UserRow;
    currentMember: MemberRow;
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

/**
 * Resolve the principal, or set nothing. This middleware NEVER rejects: a public
 * route (signup, health, pricing metadata) must run without a session, and a
 * route that needs one asks for it explicitly with `requireUser`. Rejecting here
 * would make the distinction between "public" and "private" live in the
 * middleware order instead of in the route, which is how a route accidentally
 * becomes public during a refactor.
 */
export const resolveAuth = (deps: AppDeps): MiddlewareHandler => async (c, next) => {
  const token = bearerToken(c.req.header("authorization"));

  if (token?.startsWith("xr_live_") || token?.startsWith("xr_test_")) {
    const ctx = await resolveApiKey(deps, token);
    if (ctx) c.set("auth", ctx);
    await next();
    return;
  }

  const access = token ?? readCookie(c, SESSION_COOKIE);
  if (!access) {
    await next();
    return;
  }

  try {
    const claims = await verifyAccessToken(access);

    // A revoked session must not be usable even inside the token's 15 minutes.
    const sessionRows = await deps.db
      .select({ id: sessions.id, revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt, kind: sessions.kind })
      .from(sessions)
      .where(eq(sessions.id, claims.sid))
      .limit(1);
    const session = sessionRows[0];
    if (!session || session.revokedAt) {
      await next();
      return;
    }
    if (session.expiresAt.getTime() < deps.clock().getTime()) {
      await next();
      return;
    }

    c.set("auth", {
      sessionId: claims.sid,
      userId: claims.sub,
      kind: claims.kind as SessionKind,
      orgId: claims.org ?? null,
      role: (claims.role as AuthContext["role"]) ?? null,
      via: token ? "bearer" : "cookie",
      apiKeyScopes: [],
    });
  } catch {
    // An invalid token is the same as no token for resolution purposes. The
    // @require* guards produce the honest 401 with the right repair text.
  }

  await next();
};

async function resolveApiKey(deps: AppDeps, token: string): Promise<AuthContext | null> {
  const hash = sha256Hex(token);
  const rows = await deps.db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
  const key = rows[0];
  if (!key) return null;
  // Belt and braces: the lookup was by hash, so this can only fail on a collision.
  if (!safeEqual(key.keyHash, hash)) return null;
  if (key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;

  void deps.db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(() => undefined);

  return {
    sessionId: `apikey:${key.id}`,
    userId: key.createdBy ?? "",
    kind: "cli",
    orgId: key.orgId,
    role: "admin",
    via: "api_key",
    apiKeyScopes: key.scopes,
  };
}

function readCookie(c: { req: { header: (n: string) => string | undefined } }, name: string): string | null {
  const raw = c.req.header("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Reject when there is no principal. */
export const requireUser = (deps: AppDeps): MiddlewareHandler => async (c, next) => {
  const auth = c.get("auth");
  if (!auth) {
    // An API-key holder with no creator is a deleted user's key; treat as absent.
    throw unauthorized();
  }
  const rows = await deps.db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
  const user = rows[0];
  if (!user) throw unauthorized();
  if (user.disabledAt) {
    throw forbidden(
      "This account has been disabled by an organization owner. Local XR on your machine is unaffected.",
    );
  }
  c.set("currentUser", user);

  await deps.db
    .update(users)
    .set({ lastSeenAt: new Date() })
    .where(eq(users.id, user.id))
    .catch(() => undefined);

  await next();
};

/**
 * Reject when the caller is not an active member of `:id` (or `:orgId`).
 *
 * Reads the row fresh. Also exposes `currentMember` so a handler never queries it
 * twice, and so the per-user budget overrides it needs are already in hand.
 */
/**
 * Resolve membership for the org this request is about.
 *
 * Two call shapes, and the difference matters:
 *
 *   `requireOrgMember(deps, "id")` on `/teams/:id/…` — the org is named in the
 *   path, and membership of *that* org is required.
 *
 *   `requireOrgMember(deps, null)` on `/billing/…` and `/license/…` — the org is
 *   the caller's active one, taken from the session. There is no path parameter.
 *
 * An earlier revision defaulted the parameter name to `"id"`, so every route
 * without an `:id` segment looked up `c.req.param("id")`, got `undefined`, and
 * rejected the request as unauthenticated. Every billing and licence call failed
 * with a 401 that looked like a token problem. The parameter is now explicit
 * (including explicitly `null`), so the two shapes cannot be confused again —
 * a silent default was the whole bug.
 */
export const requireOrgMember = (deps: AppDeps, param: string | null): MiddlewareHandler => async (c, next) => {
  const auth = c.get("auth");
  if (!auth) throw unauthorized();

  const orgId = param === null ? auth.orgId : c.req.param(param);
  if (!orgId) {
    // A session with no active org is not an error the caller can fix by signing
    // in again — say what is actually missing.
    throw unauthorized(
      param === null
        ? "This request needs an organization. Sign in to a team, or pass the team id in the path."
        : `This route needs an organization id in \`${param}\`.`,
    );
  }

  const rows = await deps.db
    .select()
    .from(members)
    .where(and(eq(members.orgId, orgId), eq(members.userId, auth.userId)))
    .limit(1);
  const member = rows[0];
  if (!member) {
    // Deliberately a 404, not a 403: confirming the org exists to a non-member is
    // an information leak, and "you are not in this org" tells the caller nothing
    // they can act on.
    throw forbidden("You are not a member of this organization.");
  }
  if (member.status === "disabled") {
    throw forbidden("Your access to this organization has been disabled by an admin.");
  }

  c.set("currentMember", member);
  c.set("auth", { ...auth, orgId, role: member.role });
  await next();
};

/** Reject unless the member's role is in `roles`. Called after requireOrgMember. */
export const requireRole =
  (roles: readonly ("owner" | "admin" | "member")[]): MiddlewareHandler =>
  async (c, next) => {
    const member = c.get("currentMember");
    if (!member) throw unauthorized();
    if (!roles.includes(member.role)) {
      throw forbidden(
        `This action requires the ${roles.join(" or ")} role. Your role is ${member.role}. ` +
          "Ask an organization owner to change it if you need access.",
      );
    }
    await next();
  };

/**
 * Owners only. Used for the two actions that can destroy an organization's
 * ability to recover: deleting it, and changing who owns it.
 */
export const requireOwner = requireRole(["owner"]);

/** Requires the Business entitlement to be live for this org's subscription. */
export const requireBusiness =
  (deps: AppDeps): MiddlewareHandler =>
  async (c, next) => {
    const member = c.get("currentMember");
    if (!member) throw unauthorized();
    const { loadSubscription } = await import("../services/subscriptions.ts");
    const subscription = await loadSubscription(deps, member.orgId);
    if (!subscription.businessActive) {
      throw forbidden(
        subscription.reason ??
          "This organization's Business subscription is not active. Local XR and every Personal feature keep working — only team features are unavailable.",
      );
    }
    await next();
  };

/** Requires a specific API-key scope, when the caller authenticated with a key. */
export const requireScope =
  (scope: string): MiddlewareHandler =>
  async (c, next) => {
    const auth = c.get("auth");
    if (!auth) throw unauthorized();
    if (auth.via !== "api_key") {
      // Session-authenticated callers hold the full rights of their role; scopes
      // exist to constrain keys, not people.
      await next();
      return;
    }
    if (!auth.apiKeyScopes.includes(scope) && !auth.apiKeyScopes.includes("*")) {
      throw forbidden(
        `This API key is not scoped for "${scope}". Create a key with that scope, or use a session.`,
      );
    }
    await next();
  };
