/**
 * Phase 26 · Discord — zod schemas for the Discord bot endpoints. Re-exported
 * from schemas.ts; the contract lives in contract-discord.ts.
 *
 * Loose on purpose, like the Telegram schemas: the route keeps its own checks,
 * so a contract check can only reject shapes the handler would also reject.
 * No response schema carries the bot token.
 */
import { z } from "zod/v4";

/** POST /api/discord/connect — the bot token from the Developer Portal, validated with /users/@me. */
export const DiscordConnectRequest = z.looseObject({
  token: z.string().min(1).max(200).describe("Bot token from the Discord Developer Portal. Stored in the OS keychain, never echoed back."),
});

/** POST /api/discord/disconnect — must be confirmed explicitly. */
export const DiscordDisconnectRequest = z.looseObject({
  confirm: z.boolean().describe("Must be true. Stops the bot, removes the token and all pairings and allowed channels."),
});

/** POST /api/discord/pair/open — which code to issue. */
export const DiscordPairOpenRequest = z.looseObject({
  kind: z.enum(["dm", "channel"]).optional().describe("dm: /xr pair in a DM. channel: /xr pairchannel in a server channel."),
});

/** POST /api/discord/unpair — a paired Discord user id (snowflake). */
export const DiscordUnpairRequest = z.looseObject({
  userId: z.string().describe("Discord user id to remove from the paired list."),
});

/** POST /api/discord/channels/remove — an allowed channel id (snowflake). */
export const DiscordChannelRemoveRequest = z.looseObject({
  channelId: z.string().describe("Channel id to remove from the allowed list."),
});

/** POST /api/discord/settings — only autoStart for now. */
export const DiscordSettingsRequest = z.looseObject({
  autoStart: z.boolean().describe("Start the bot when the daemon boots."),
});

/** GET /api/discord/logs — query string. */
export const DiscordLogsQuery = z.looseObject({
  tail: z.string().optional().describe("How many trailing log lines to return."),
});
