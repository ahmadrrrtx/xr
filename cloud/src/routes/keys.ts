/**
 * XR Cloud — Business API keys.
 *
 * Keys exist so CI and internal tooling can read a team's audit log and usage
 * without a human session. They are therefore treated as the most dangerous
 * credential this service issues:
 *
 *   - **The plaintext is shown exactly once**, at creation. Only a SHA-256 hash is
 *     stored, so a database leak does not hand over working keys.
 *   - **Scopes are mandatory and narrow.** A key with `*` is possible but has to be
 *     asked for explicitly, and the console shows a warning when one exists.
 *   - **Rotation is create-then-revoke**, because revoke-then-create has a window
 *     where a pipeline is broken — and a broken pipeline is what makes people
 *     paste keys into chat.
 *   - **Expiry is offered, not forced.** Default is 90 days, and the response says
 *     the date rather than implying permanence.
 */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { AppDeps } from "../deps.ts";
import { apiKeys } from "../db/schema.ts";
import { randomToken, sha256Hex } from "../lib/crypto.ts";
import { notFound } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { addDays } from "../lib/time.ts";
import { requireBusiness, requireOrgMember, requireRole, requireUser } from "../middleware/auth.ts";
import { parseBody } from "../middleware/validate.ts";
import { createApiKeySchema } from "../schemas.ts";

export function apiKeyRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/teams/:id/api-keys", requireUser(deps), requireOrgMember(deps, "id"), requireBusiness(deps), requireRole(["owner", "admin"]), async (c) => {
    const member = c.get("currentMember");
    const rows = await deps.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.orgId, member.orgId))
      .orderBy(desc(apiKeys.createdAt))
      .limit(100);

    return c.json({
      keys: rows.map((k) => ({
        id: k.id,
        name: k.name,
        // The prefix is for identification in a list, not for authentication.
        prefix: `${k.keyPrefix}…`,
        scopes: k.scopes,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        expiresAt: k.expiresAt?.toISOString() ?? null,
        revoked: k.revokedAt !== null,
        // Surfaced so the console can nag honestly about a key that can do
        // everything.
        broad: k.scopes.includes("*"),
      })),
    });
  });

  app.post("/teams/:id/api-keys", requireUser(deps), requireOrgMember(deps, "id"), requireBusiness(deps), requireRole(["owner", "admin"]), async (c) => {
    const member = c.get("currentMember");
    const body = await parseBody(c, createApiKeySchema);

    const prefix = `xr_live_${randomToken(6)}`;
    const secret = randomToken(32);
    const token = `${prefix}_${secret}`;
    const expiresAt = body.expiresInDays ? addDays(deps.clock(), body.expiresInDays) : null;

    const created = await deps.db
      .insert(apiKeys)
      .values({
        id: newId("apiKey"),
        orgId: member.orgId,
        name: body.name,
        keyHash: sha256Hex(token),
        keyPrefix: prefix,
        scopes: body.scopes,
        createdBy: c.get("auth").userId,
        expiresAt,
      })
      .returning();
    const key = created[0];
    if (!key) throw notFound("API key");

    await deps.audit.append({
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: "apikey.create",
      targetType: "api_key",
      targetId: key.id,
      ip: c.get("meta").ip,
      userAgent: c.get("meta").userAgent,
      // Scopes are recorded; the key is not.
      detail: { name: body.name, scopes: body.scopes, expiresAt: expiresAt?.toISOString() ?? null },
    });

    return c.json(
      {
        key: {
          id: key.id,
          name: key.name,
          token,
          scopes: key.scopes,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
        warning:
          "Copy this token now — it is shown once and only its hash is stored. If you lose it, revoke this key and create another.",
      },
      201,
    );
  });

  app.delete("/teams/:id/api-keys/:keyId", requireUser(deps), requireOrgMember(deps, "id"), requireBusiness(deps), requireRole(["owner", "admin"]), async (c) => {
    const member = c.get("currentMember");
    const keyId = c.req.param("keyId");
    if (!keyId) throw notFound("API key");

    const updated = await deps.db
      .update(apiKeys)
      .set({ revokedAt: deps.clock() })
      .where(and(eq(apiKeys.orgId, member.orgId), eq(apiKeys.id, keyId)))
      .returning({ id: apiKeys.id });
    if (updated.length === 0) throw notFound("API key");

    await deps.audit.append({
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: "apikey.revoke",
      targetType: "api_key",
      targetId: keyId,
      ip: c.get("meta").ip,
    });

    return c.json({ ok: true, message: "Key revoked. Any pipeline using it will start failing with 401." });
  });

  return app;
}
