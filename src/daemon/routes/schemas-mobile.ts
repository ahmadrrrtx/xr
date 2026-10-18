/** Phase 2.4 · P1-1 — mobile request schemas. Phase 2.2 policy: a key the
 * handler never reads is rejected (v1) / reported (legacy), never dropped. */
import { z } from "zod/v4";

/** The wire shape a browser's pushManager.subscribe returns verbatim. */
const PushSubscription = z.object({
  endpoint: z.string().describe("https:// push-service endpoint (validated against known providers at the handler)."),
  keys: z.object({
    p256dh: z.string().describe("P-256 ECDH public key (RFC 8291)."),
    auth: z.string().describe("P-256 auth secret."),
  }),
});

export const MobilePairRequest = z.object({
  code: z.string().describe("The 6-digit pairing code shown on the desktop (single-use, 10-minute TTL)."),
  deviceName: z.string().max(48).optional().describe("Human device label (defaults to 'Phone', truncated at 48 chars)."),
  pushKey: z.string().optional().describe("Base64 AES-GCM key for the second push-encryption layer."),
  pushSubscription: PushSubscription.optional().describe("Web Push subscription from the device browser/OS."),
});

export const MobilePushSubscribeRequest = z.object({
  subscription: PushSubscription,
  pushKey: z.string().optional().describe("Base64 AES-GCM device key for payload encryption."),
});

/** Mutating mobile operations with an intentionally EMPTY body (Phase 2.2: a stray key is surfaced, never swallowed). */
export const MobileEmptyRequest = z.object({}).describe("No request fields.");
