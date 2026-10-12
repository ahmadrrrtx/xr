/**
 * Phase 26 · Discord — operation contract entries. Spread into the main
 * registry in contract.ts. Responses are the { ok, … } envelope or the status
 * view from discord.routes.ts; the bot token is never part of a response.
 */
import type { ApiOperationMeta } from "./contract.ts";
import {
  DiscordChannelAddRequest,
  DiscordChannelRemoveRequest,
  DiscordChannelsQuery,
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
    summary: "Discord bot state: gateway, paired users, allowed channels and settings. Never includes the token.",
    template: "/api/discord/status",
  },
  "discord.connect": {
    ...discord,
    summary: "Save a bot token after checking it against Discord, register slash commands, then open the gateway.",
    template: "/api/discord/connect",
    request: DiscordConnectRequest,
  },
  "discord.disconnect": {
    ...discord,
    summary: "Stop the bot, remove the token, paired users and the channel allow-list. Requires confirm: true.",
    template: "/api/discord/disconnect",
    request: DiscordDisconnectRequest,
  },
  "discord.start": {
    ...discord,
    summary: "Open the gateway for the connected bot (resumes the session when one is saved).",
    template: "/api/discord/start",
  },
  "discord.stop": {
    ...discord,
    summary: "Close the gateway cleanly. The token is kept so the bot can be started again.",
    template: "/api/discord/stop",
  },
  "discord.pair.open": {
    ...discord,
    summary: "Open the 10-minute pairing window and mint one 6-digit code for the dialog to display.",
    template: "/api/discord/pair/open",
    request: DiscordPairOpenRequest,
  },
  "discord.pair.close": {
    ...discord,
    summary: "Close the pairing window and invalidate any code that was minted in it.",
    template: "/api/discord/pair/close",
  },
  "discord.unpair": {
    ...discord,
    summary: "Remove one paired Discord user. Their DMs stop being answered immediately.",
    template: "/api/discord/unpair",
    request: DiscordUnpairRequest,
  },
  "discord.guilds": {
    ...discord,
    summary: "Servers the bot is a member of, for the channel picker. Read-only.",
    template: "/api/discord/guilds",
  },
  "discord.channels": {
    ...discord,
    summary: "Text channels in one server, for the channel picker. Read-only.",
    template: "/api/discord/channels",
    request: DiscordChannelsQuery,
  },
  "discord.channels.add": {
    ...discord,
    summary: "Allow XR to answer in one server channel (mention or slash command only).",
    template: "/api/discord/channels/add",
    request: DiscordChannelAddRequest,
  },
  "discord.channels.remove": {
    ...discord,
    summary: "Revoke XR's access to one server channel.",
    template: "/api/discord/channels/remove",
    request: DiscordChannelRemoveRequest,
  },
  "discord.settings": {
    ...discord,
    summary: "Update rate limit, attachment cap, webhook URL, dev server and auto-start. Only sent fields change.",
    template: "/api/discord/settings",
    request: DiscordSettingsRequest,
  },
  "discord.logs": {
    ...discord,
    summary: "Redacted tail of the Discord bot log.",
    template: "/api/discord/logs",
    request: DiscordLogsQuery,
  },
  "discord.webhook": {
    ...discord,
    summary: "Receive an interaction in webhook mode. Authenticated by Discord's Ed25519 signature, not the XR token.",
    template: "/api/discord/webhook",
  },
};
