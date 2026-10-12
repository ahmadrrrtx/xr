/**
 * Phase 26 · Discord — zod schemas for the Discord bot endpoints. Re-exported
 * from schemas.ts; the contract lives in contract-discord.ts.
 *
 * These mirror the hand-checked bodies in discord.routes.ts. Every schema is
 * loose on purpose: the route keeps its own semantic checks underneath, so a
 * contract check can only reject shapes the handler would also reject. No
 * schema here carries the bot token, and no response carries it either.
 */
import { z } from "zod/v4";

/** POST /api/discord/connect — the bot token from the Developer Portal. */
export const DiscordConnectRequest = z.looseObject({
  token: z.string().min(1).max(200).describe("Bot token from the Discord Developer Portal. Stored in the OS keychain, never echoed back."),
});

/** POST /api/discord/disconnect — must be confirmed explicitly. */
export const DiscordDisconnectRequest = z.looseObject({
  confirm: z.boolean().describe("Must be true. Stops the bot, removes the token, pairings and the channel allow-list."),
});

/** POST /api/discord/pair/open — which kind of code to mint. */
export const DiscordPairOpenRequest = z.looseObject({
  kind: z.enum(["user", "channel"]).optional().describe("'user' mints a /xr pair code; 'channel' mints a /xr pairchannel code."),
});

/** POST /api/discord/unpair — a paired Discord user id (snowflake). */
export const DiscordUnpairRequest = z.looseObject({
  userId: z.union([z.number(), z.string()]).describe("Discord user id to remove from the paired list."),
});

/** POST /api/discord/channels/add — allow XR in one server channel. */
export const DiscordChannelAddRequest = z.looseObject({
  guildId: z.string().describe("Discord server id (snowflake)."),
  channelId: z.string().describe("Discord text channel id (snowflake)."),
});

/** POST /api/discord/channels/remove — the same pair, to revoke it. */
export const DiscordChannelRemoveRequest = DiscordChannelAddRequest;

/** GET /api/discord/channels — which server to list channels for. */
export const DiscordChannelsQuery = z.looseObject({
  guildId: z.string().describe("Discord server id (snowflake)."),
});

/** POST /api/discord/settings — every field is optional; only sent fields change. */
export const DiscordSettingsRequest = z.looseObject({
  rateLimitPerMin: z.number().optional().describe("Messages per minute per chat."),
  maxAttachmentBytes: z.number().optional().describe("Largest attachment XR will download."),
  autoStart: z.boolean().optional().describe("Start the bot when the daemon boots."),
  webhookUrl: z.string().nullable().optional().describe("Public HTTPS base URL for interactions-webhook mode, or null for the gateway."),
  devGuildId: z.string().nullable().optional().describe("Register slash commands in one server for instant propagation."),
});

/** GET /api/discord/logs — query string. */
export const DiscordLogsQuery = z.looseObject({
  tail: z.string().optional().describe("How many trailing log lines to return."),
});
