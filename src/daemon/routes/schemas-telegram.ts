/**
 * Phase 24 · Telegram — zod schemas for the Telegram bot endpoints. Re-exported
 * from schemas.ts; the contract lives in contract-telegram.ts.
 *
 * These mirror the hand-checked bodies in telegram.routes.ts. Each schema is
 * loose on purpose: the route keeps its own semantic checks underneath, so a
 * contract check can only reject shapes the handler would also reject. No
 * response schema here carries the bot token; responses are the status view.
 */
import { z } from "zod/v4";

/** POST /api/telegram/connect — the BotFather token, validated with getMe. */
export const TelegramConnectRequest = z.looseObject({
  token: z.string().min(1).max(200).describe("Bot token from BotFather. Stored in the OS keychain, never echoed back."),
});

/** POST /api/telegram/disconnect — must be confirmed explicitly. */
export const TelegramDisconnectRequest = z.looseObject({
  confirm: z.boolean().describe("Must be true. Stops the bot, removes the token and all paired users."),
});

/** POST /api/telegram/pair — the 6-digit code shown to the user in Telegram. */
export const TelegramPairRequest = z.looseObject({
  code: z.union([z.string(), z.number()]).describe("Six-digit pairing code from the Telegram chat."),
});

/** POST /api/telegram/unpair — a paired Telegram user id. */
export const TelegramUnpairRequest = z.looseObject({
  userId: z.union([z.number(), z.string()]).describe("Telegram user id to remove from the paired list."),
});

/** POST /api/telegram/settings — every field is optional; only sent fields change. */
export const TelegramSettingsRequest = z.looseObject({
  rateLimitPerMin: z.number().optional().describe("Messages per minute per chat."),
  maxAttachmentBytes: z.number().optional().describe("Largest attachment XR will download."),
  webhookUrl: z.string().nullable().optional().describe("HTTPS webhook URL, or null to use polling."),
  autoStart: z.boolean().optional().describe("Start the bot when the daemon boots."),
});

/** GET /api/telegram/logs — query string. */
export const TelegramLogsQuery = z.looseObject({
  tail: z.string().optional().describe("How many trailing log lines to return."),
});
