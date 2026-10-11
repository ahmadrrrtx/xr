/**
 * Phase 26 · Discord — operation contract entries. Spread into the main
 * registry in contract.ts. Responses are the { ok, … } envelope or the status
 * view from discord.routes.ts; the bot token is never part of a response.
 */

import type { ApiOperationMeta } from "./contract.ts";
import {
  DiscordChannelRemoveRequest,
  DiscordConnectRequest,
  DiscordDisconnectRequest,
  DiscordLogsQuery,
  DiscordPairOpenRequest,
  DiscordSettingsRequest,
  DiscordUnpairRequest,
} from "./schemas-discord.ts";

const discord = { tag: "discord", stability: "experimental" as const };

export const DISCORD_CONTRACT: Record<string, ApiOperationMeta> = {
  "discord.status": {
    ...discord,
    summary: "Discord bot state: connection, gateway status, paired users, allowed channels and the invite URL. Never includes the token.",
    template: "/api/discord/status",
  },
  "discord.connect": {
    ...discord,
    summary: "Validate a bot token with /users/@me, store it in the OS keychain, then start the bot.",
    template: "/api/discord/connect",
    request: DiscordConnectRequest,
  },
  "discord.disconnect": {
    ...discord,
    summary: "Stop the bot, remove the token, and forget every pairing and allowed channel. Requires confirm: true.",
    template: "/api/discord/disconnect",
    request: DiscordDisconnectRequest,
  },
  "discord.start": {
    ...discord,
    summary: "Start the gateway connection for the saved bot token.",
    template: "/api/discord/start",
  },
  "discord.stop": {
    ...discord,
    summary: "Stop the bot cleanly. The token is kept so the bot can be started again.",
    template: "/api/discord/stop",
  },
  "discord.pair.open": {
    ...discord,
    summary: "Issue a one-time 6-digit pairing code (10 minutes). The user redeems it in Discord with /xr pair or /xr pairchannel.",
    template: "/api/discord/pair/open",
    request: DiscordPairOpenRequest,
  },
  "discord.unpair": {
    ...discord,
    summary: "Remove one paired Discord user.",
    template: "/api/discord/unpair",
    request: DiscordUnpairRequest,
  },
  "discord.channels.remove": {
    ...discord,
    summary: "Remove one channel from the allowed list.",
    template: "/api/discord/channels/remove",
    request: DiscordChannelRemoveRequest,
  },
  "discord.settings": {
    ...discord,
    summary: "Set whether the bot starts with the daemon.",
    template: "/api/discord/settings",
    request: DiscordSettingsRequest,
  },
  "discord.logs": {
    ...discord,
    summary: "Redacted tail of the Discord bot log.",
    template: "/api/discord/logs",
    request: DiscordLogsQuery,
  },
};
