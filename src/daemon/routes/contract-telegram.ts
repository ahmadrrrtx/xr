/**
 * Phase 24 · Telegram — operation contract entries. Spread into the main
 * registry in contract.ts. Responses are the { ok, … } envelope or the status
 * view from telegram.routes.ts; the bot token is never part of a response.
 */

import type { ApiOperationMeta } from "./contract.ts";
import {
  TelegramConnectRequest,
  TelegramDisconnectRequest,
  TelegramLogsQuery,
  TelegramPairRequest,
  TelegramSettingsRequest,
  TelegramUnpairRequest,
} from "./schemas-telegram.ts";

const telegram = { tag: "telegram", stability: "experimental" as const };

export const TELEGRAM_CONTRACT: Record<string, ApiOperationMeta> = {
  "telegram.status": {
    ...telegram,
    summary: "Telegram bot state: connection, running status, paired users and settings. Never includes the token.",
    template: "/api/telegram/status",
  },
  "telegram.connect": {
    ...telegram,
    summary: "Save a BotFather token after a getMe check, then start the bot.",
    template: "/api/telegram/connect",
    request: TelegramConnectRequest,
  },
  "telegram.disconnect": {
    ...telegram,
    summary: "Stop the bot, remove the token and every paired user. Requires confirm: true.",
    template: "/api/telegram/disconnect",
    request: TelegramDisconnectRequest,
  },
  "telegram.start": {
    ...telegram,
    summary: "Start polling (or the webhook, when one is set) for the connected bot.",
    template: "/api/telegram/start",
  },
  "telegram.stop": {
    ...telegram,
    summary: "Stop the bot cleanly. The token is kept so the bot can be started again.",
    template: "/api/telegram/stop",
  },
  "telegram.pair.open": {
    ...telegram,
    summary: "Open the 10-minute pairing window. A user who sends /start then receives a 6-digit code.",
    template: "/api/telegram/pair/open",
  },
  "telegram.pair": {
    ...telegram,
    summary: "Confirm a 6-digit code shown in Telegram. The single-use code adds the sender to the paired list.",
    template: "/api/telegram/pair",
    request: TelegramPairRequest,
  },
  "telegram.unpair": {
    ...telegram,
    summary: "Remove one paired Telegram user.",
    template: "/api/telegram/unpair",
    request: TelegramUnpairRequest,
  },
  "telegram.settings": {
    ...telegram,
    summary: "Update rate limit, attachment cap, webhook URL and auto-start. Only sent fields change.",
    template: "/api/telegram/settings",
    request: TelegramSettingsRequest,
  },
  "telegram.logs": {
    ...telegram,
    summary: "Redacted tail of the Telegram bot log.",
    template: "/api/telegram/logs",
    request: TelegramLogsQuery,
  },
  "telegram.webhook": {
    ...telegram,
    summary: "Receive a Telegram update in webhook mode. Authenticated by Telegram's secret_token header, not the XR token.",
    template: "/api/telegram/webhook",
  },
};
