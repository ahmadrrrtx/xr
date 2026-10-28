/** Phase 2.4 · P1-1 — mobile contract entries (spread into contract.ts).
 * Every op mounts on BOTH mounts; only the TOFU fingerprint is `public: true`. */
import type { ApiOperationMeta } from "./contract.ts"; import { MobileApprovalDecideRequest, MobileEmptyRequest, MobilePairRequest, MobilePushSubscribeRequest } from "./schemas-mobile.ts";

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

  // V1-P5-001 — companion read/act API (the shipped PWA's contract, served by
  // the real daemon against the same stores the desktop surface uses).
  // meta.version.get lives HERE, not in contract.ts, per that module's waiver
  // plan ("held at two lines per phase"): the probe exists for the companion.
  "meta.version.get": {
    summary:
      "Companion identity probe: daemon version, host URL, LAN flag. Auth-gated (a 401 here is how the mobile app detects a revoked session).",
    tag: "system",
    stability: "stable",
  },
  "mobile.companion.models.get": m("Model list for the companion picker (from the effective config; installed local models plus the effective selection)."),
  "mobile.companion.budget.get": m("Budget summary in cents for the companion (today/month spend, monthly + per-task caps; no fabricated daily cap)."),
  "mobile.companion.approvals.get": m("Pending approvals for the companion (same durable store as the desktop; decided records age out)."),
  "mobile.companion.approvalDecide.post": m("Decide a pending approval from the phone (shared decide path — first decision wins from any surface).", { request: MobileApprovalDecideRequest }),
};
