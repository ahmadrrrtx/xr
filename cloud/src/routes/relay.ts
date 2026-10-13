/**
 * XR Cloud — relay routes (registration + the WebSocket upgrade).
 *
 * The upgrade handler is registered on the Bun server rather than as a Hono route
 * because a Hono handler cannot take ownership of the socket. Everything that
 * decides *whether* someone may connect lives here and is shared by both entry
 * points, so there is one authorization path, not two.
 */

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

import type { AppDeps } from "../deps.ts";
import { members, policies, relayRegistrations } from "../db/schema.ts";
import { randomToken, sha256Hex, safeEqual } from "../lib/crypto.ts";
import { forbidden, notFound } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { requireBusiness, requireOrgMember, requireUser } from "../middleware/auth.ts";
import { parseBody } from "../middleware/validate.ts";
import { relayRegisterSchema } from "../schemas.ts";
import { loadSubscription } from "../services/subscriptions.ts";
import { deriveRoomId } from "../relay/hub.ts";

export interface RelayAuthorization {
  ok: true;
  orgId: string;
  userId: string;
  deviceId: string;
  room: string;
}

export interface RelayDenial {
  ok: false;
  status: number;
  code: string;
  message: string;
  repair?: string;
}

export function relayRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  /**
   * Register a device for relay. Returns a **device-scoped token**, which is the
   * only credential the WebSocket accepts. It is deliberately not the user's
   * session token: a relay token must be revocable from the device list without
   * signing the person out of everything.
   */
  app.post("/relay/register", requireUser(deps), requireOrgMember(deps, "id"), requireBusiness(deps), async (c) => {
    const member = c.get("currentMember");
    const body = await parseBody(c, relayRegisterSchema);

    const policyRows = await deps.db.select().from(policies).where(eq(policies.orgId, member.orgId)).limit(1);
    if (policyRows[0] && !policyRows[0].relayEnabled) {
      throw forbidden(
        "Cloud relay is turned off for your team.",
        "An admin can enable it in Policies → Cloud access. Local (LAN) mobile pairing still works and is unaffected.",
      );
    }

    const token = `xr_relay_${randomToken(32)}`;
    const now = deps.clock();

    const existing = await deps.db
      .select()
      .from(relayRegistrations)
      .where(and(eq(relayRegistrations.orgId, member.orgId), eq(relayRegistrations.deviceId, body.deviceId)))
      .limit(1);

    if (existing[0]) {
      await deps.db
        .update(relayRegistrations)
        .set({ tokenHash: sha256Hex(token), deviceLabel: body.deviceLabel ?? null, revokedAt: null })
        .where(eq(relayRegistrations.id, existing[0].id));
    } else {
      await deps.db.insert(relayRegistrations).values({
        id: newId("relay"),
        orgId: member.orgId,
        userId: c.get("auth").userId,
        deviceId: body.deviceId,
        deviceLabel: body.deviceLabel ?? null,
        tokenHash: sha256Hex(token),
        createdAt: now,
      });
    }

    await deps.audit.append({
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      actorEmail: c.get("currentUser").email,
      action: "relay.device_registered",
      targetType: "relay_device",
      targetId: body.deviceId,
      ip: c.get("meta").ip,
      // The token is not in here, and never will be.
      detail: { label: body.deviceLabel ?? null },
    });

    return c.json(
      {
        token,
        room: deriveRoomId(member.orgId, body.roomSecret),
        websocketUrl: `${deps.env.API_URL.replace(/^http/, "ws")}/relay/ws`,
        // Both sides compute this independently, which is why the server can
        // route without ever being told the plaintext of the pairing secret.
        secretNeverStored:
          "The pairing secret is not sent to XR. Both devices derive the room and the frame key from it locally; the relay only routes ciphertext.",
        limits: { maxFrameBytes: 256 * 1024, persistence: "none", history: "none" },
      },
      201,
    );
  });

  app.get("/relay/devices", requireUser(deps), requireOrgMember(deps, "id"), async (c) => {
    const member = c.get("currentMember");
    const rows = await deps.db
      .select()
      .from(relayRegistrations)
      .where(eq(relayRegistrations.orgId, member.orgId))
      .limit(100);
    return c.json({
      devices: rows.map((r) => ({
        id: r.id,
        deviceId: r.deviceId,
        label: r.deviceLabel,
        lastConnectedAt: r.lastConnectedAt?.toISOString() ?? null,
        revoked: r.revokedAt !== null,
        isMine: r.userId === c.get("auth").userId,
      })),
      stats: deps.relay.stats(),
    });
  });

  app.delete("/relay/devices/:id", requireUser(deps), requireOrgMember(deps, "id"), async (c) => {
    const member = c.get("currentMember");
    const id = c.req.param("id");
    if (!id) throw notFound("Device");
    const rows = await deps.db
      .select()
      .from(relayRegistrations)
      .where(and(eq(relayRegistrations.orgId, member.orgId), eq(relayRegistrations.id, id)))
      .limit(1);
    const device = rows[0];
    if (!device) throw notFound("Device");
    if (device.userId !== c.get("auth").userId && member.role === "member") {
      throw forbidden("Only an admin can revoke another person's relay device.");
    }

    await deps.db.update(relayRegistrations).set({ revokedAt: deps.clock() }).where(eq(relayRegistrations.id, id));
    await deps.audit.append({
      orgId: member.orgId,
      actorKind: "user",
      actorId: c.get("auth").userId,
      action: "relay.device_revoked",
      targetType: "relay_device",
      targetId: id,
      ip: c.get("meta").ip,
    });
    return c.json({ ok: true });
  });

  return app;
}

/**
 * Authorize a WebSocket upgrade.
 *
 * Called by the Bun server's `fetch` handler before it calls `server.upgrade`.
 * Every gate that applies to the HTTP API applies here — subscription, policy,
 * device token — because the relay is the surface with the most reason to be
 * careful about who is on the other end.
 */
export async function authorizeRelayConnection(
  deps: AppDeps,
  token: string | null,
  deviceId: string | null,
  roomSecret: string | null,
): Promise<RelayAuthorization | RelayDenial> {
  if (!token) {
    return { ok: false, status: 401, code: "unauthorized", message: "Missing relay token." };
  }
  const hash = sha256Hex(token);
  const rows = await deps.db
    .select()
    .from(relayRegistrations)
    .where(and(eq(relayRegistrations.tokenHash, hash), isNull(relayRegistrations.revokedAt)))
    .limit(1);
  const device = rows[0];
  if (!device || !safeEqual(device.tokenHash, hash)) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "That relay token is not valid or has been revoked.",
      repair: "Re-register this device from Settings → Billing & Account → Cloud access.",
    };
  }
  if (deviceId && device.deviceId !== deviceId) {
    return { ok: false, status: 403, code: "forbidden", message: "Device id does not match the registered device." };
  }

  const subscription = await loadSubscription(deps, device.orgId);
  if (!subscription.businessActive) {
    return {
      ok: false,
      status: 403,
      code: "forbidden",
      message: "Cloud relay requires an active Business subscription.",
      repair:
        "Team features are off, so the relay is unavailable. Your local (LAN) mobile pairing still works — nothing local changed.",
    };
  }

  const membership = await deps.db
    .select({ status: members.status })
    .from(members)
    .where(and(eq(members.orgId, device.orgId), eq(members.userId, device.userId)))
    .limit(1);
  if (membership[0]?.status !== "active") {
    return { ok: false, status: 403, code: "forbidden", message: "Membership is not active for this organization." };
  }

  const policyRows = await deps.db.select().from(policies).where(eq(policies.orgId, device.orgId)).limit(1);
  if (policyRows[0] && !policyRows[0].relayEnabled) {
    return {
      ok: false,
      status: 403,
      code: "forbidden",
      message: "Cloud relay is turned off for this team.",
      repair: "An admin can enable it in Policies → Cloud access.",
    };
  }

  const limited = await deps.limiter.consume("relayConnect", `device:${device.deviceId}`);
  if (!limited.allowed) {
    return {
      ok: false,
      status: 429,
      code: "rate_limited",
      message: "Too many relay connections from this device.",
      repair: `Wait ${limited.retryAfterSeconds ?? 30} seconds.`,
    };
  }

  const room = roomSecret ? deriveRoomId(device.orgId, roomSecret) : `org:${device.orgId}`;

  await deps.db
    .update(relayRegistrations)
    .set({ lastConnectedAt: deps.clock() })
    .where(eq(relayRegistrations.id, device.id))
    .catch(() => undefined);

  return { ok: true, orgId: device.orgId, userId: device.userId, deviceId: device.deviceId, room };
}
