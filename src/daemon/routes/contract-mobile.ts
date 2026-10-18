/** Phase 2.4 · P1-1 — mobile contract entries (spread into contract.ts).
 * Every op mounts on BOTH mounts; only the TOFU fingerprint is `public: true`. */
import type { ApiOperationMeta } from "./contract.ts"; import { MobileEmptyRequest, MobilePairRequest, MobilePushSubscribeRequest } from "./schemas-mobile.ts";

/** Defaults shared by every mobile op: experimental stability, its own tag. */
const m = (summary: string, extra?: Partial<ApiOperationMeta>): ApiOperationMeta => ({
  summary, tag: "mobile", stability: "experimental", ...extra,
});

export const MOBILE_CONTRACT: Record<string, ApiOperationMeta> = {
  "mobile.certFingerprint.get": m("SHA-256 fingerprint of the served LAN certificate (public TOFU anchor; no key material).", { public: true }),
  "mobile.pair.post": m("Redeem the 6-digit pairing code; issues the HttpOnly Secure paired-device cookie.", { request: MobilePairRequest }),
  "mobile.session.delete": m("Close the caller's session (rejects anonymous; clears the cookie; device self-revokes).", { request: MobileEmptyRequest }),
  "mobile.devices.list.get": m("List paired devices (desktop/privileged sessions only)."),
  "mobile.devices.revoke.post": m("Revoke a paired device by id (desktop/privileged sessions only).", { template: "/api/mobile/devices/{id}/revoke", pathParams: [{ name: "id", description: "Device id." }], request: MobileEmptyRequest }),
  "mobile.devices.pushTest.post": m("Send a test Web Push to a paired device (desktop/privileged sessions only; truthful ok:false when delivery fails).", { template: "/api/mobile/devices/{id}/push-test", pathParams: [{ name: "id", description: "Device id." }], request: MobileEmptyRequest }),
  "mobile.pairQr.post": m("Mint an on-demand 6-digit pairing code and pairing URL (desktop/privileged sessions only).", { request: MobileEmptyRequest }),
  "mobile.push.vapidPubkey.get": m("VAPID public key for Web Push subscription (LAN mode only)."),
  "mobile.push.subscribe.post": m("Attach or replace the paired device's Web Push subscription.", { request: MobilePushSubscribeRequest }),
  "mobile.push.subscribe.delete": m("Remove the paired device's Web Push subscription.", { request: MobileEmptyRequest }),
  "mobile.push.test.post": m("Send a test Web Push to the paired device (truthful ok:false when delivery fails).", { request: MobileEmptyRequest }),
};
