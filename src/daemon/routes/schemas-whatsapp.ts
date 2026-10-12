/**
 * Phase 26 · WhatsApp — zod schemas for the WhatsApp endpoints. Re-exported
 * from schemas.ts; the contract lives in contract-whatsapp.ts.
 *
 * The route keeps its own semantic checks underneath, so a contract check can
 * only reject shapes the handler would also reject. No schema and no response
 * carries a credential; the contact list carries numbers because the dialog
 * manages it (the same reasoning as Discord's pairing codes).
 */
import { z } from "zod/v4";

/** POST /api/whatsapp/disconnect — unlinking a device is destructive. */
export const WhatsAppDisconnectRequest = z.looseObject({
  confirm: z.literal(true).describe("Must be true. Unlinks the device and wipes the sealed credentials."),
});

/** POST /api/whatsapp/unpair — same action, same confirmation. */
export const WhatsAppUnpairRequest = WhatsAppDisconnectRequest;

/** POST /api/whatsapp/contacts/add — digits with country code, no `+`. */
export const WhatsAppContactAddRequest = z.looseObject({
  phone: z.string().min(6).max(20).describe("Contact number: digits with country code, e.g. 923001234567."),
});

/** POST /api/whatsapp/contacts/remove — the same number, to revoke it. */
export const WhatsAppContactRemoveRequest = WhatsAppContactAddRequest;

/** POST /api/whatsapp/settings — only sent fields change. */
export const WhatsAppSettingsRequest = z.looseObject({
  rateLimitPerMin: z.number().optional().describe("Messages per minute for this bot. WhatsApp's own ceiling is 60."),
  maxAttachmentBytes: z.number().optional().describe("Largest document XR will download (photos stay capped at 2 MB)."),
  autoStart: z.boolean().optional().describe("Connect on daemon boot when a device is linked."),
  respondToOutbox: z.boolean().optional().describe("Also answer contacts you message first from your own phone."),
});

/** GET /api/whatsapp/logs — query string. */
export const WhatsAppLogsQuery = z.looseObject({
  tail: z.string().optional().describe("How many trailing log lines to return."),
});

/** GET /api/whatsapp/qr — nothing to send; the stream is the answer. */
export const WhatsAppQrQuery = z.looseObject({
  resume: z.string().optional().describe("Ignored. Present so a client can reconnect with its last cursor."),
});
