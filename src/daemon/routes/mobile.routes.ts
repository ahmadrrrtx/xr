/**
 * Phase 2.4 · P1-1 — mobile companion route group: every /api/mobile op flows
 * through the ONE router (canonical mount → validation → registry/OpenAPI/
 * generated client) with mobile-pairing.ts as the single transport handler.
 * Off-LAN the group answers 404 ("LAN mode is off") — nothing is exposed.
 */
import { handleMobileRoutes } from "../mobile-pairing.ts";
import { route, type DaemonRoute, type DaemonRouteContext } from "./router.ts";

/** Adapts one daemon route onto the mobile transport handler (per-request
 * session + deps resolved by the dispatcher; 404 when the LAN runtime is off).
 * The canonical path is re-stamped on the URL so the transport module (which
 * only knows /api/...) sees mount-normalised paths. */
function mobile(ctx: DaemonRouteContext) {
  return async () => {
    if (!ctx.mobile) return ctx.json({ error: "LAN mode is off" }, 404);
    const canonUrl = new URL(ctx.url);
    canonUrl.pathname = ctx.path; // canonical mount-normalised path
    return await handleMobileRoutes(ctx.req, canonUrl, ctx.mobile.session, ctx.mobile.deps);
  };
}

export function mobileRoutes(): DaemonRoute[] {
  const P = "/api/mobile";
  return [
    route({ id: "mobile.certFingerprint.get", path: `${P}/cert-fingerprint`, method: "GET", handle: async (c) => mobile(c)() }),
    route({ id: "mobile.pair.post", path: `${P}/pair`, method: "POST", handle: async (c) => mobile(c)() }),
    route({ id: "mobile.session.delete", path: `${P}/session`, method: "DELETE", handle: async (c) => mobile(c)() }),
    route({ id: "mobile.devices.list.get", path: `${P}/devices`, method: "GET", handle: async (c) => mobile(c)() }),
    route({ id: "mobile.devices.revoke.post", pattern: /^\/api\/mobile\/devices\/[\w-]+\/revoke$/, method: "POST", prefix: `${P}/devices`, handle: async (c) => mobile(c)() }),
    route({ id: "mobile.devices.pushTest.post", pattern: /^\/api\/mobile\/devices\/[\w-]+\/push-test$/, method: "POST", prefix: `${P}/devices`, handle: async (c) => mobile(c)() }),
    route({ id: "mobile.pairQr.post", path: `${P}/pair-qr`, method: "POST", handle: async (c) => mobile(c)() }),
    route({ id: "mobile.push.vapidPubkey.get", path: `${P}/push/vapid-pubkey`, method: "GET", handle: async (c) => mobile(c)() }),
    route({ id: "mobile.push.subscribe.post", path: `${P}/push/subscribe`, method: "POST", handle: async (c) => mobile(c)() }),
    route({ id: "mobile.push.subscribe.delete", path: `${P}/push/subscribe`, method: "DELETE", handle: async (c) => mobile(c)() }),
    route({ id: "mobile.push.test.post", path: `${P}/push/test`, method: "POST", handle: async (c) => mobile(c)() }),
  ];
}
