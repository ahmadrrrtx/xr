/**
 * XR — Discord command vocabulary (pure, testable).
 *
 * Two entry points, one vocabulary:
 *   · real slash commands (`/xr ask …`) — parsed from INTERACTION_CREATE
 *   · text commands in a DM or an allowed channel — `/xr stop`, `xr stop`, `!stop`
 *
 * Anything that is not a command is a task. In a DM from a paired user that
 * needs no prefix at all, exactly like Telegram.
 */
import { extractBudget, parsePrefixedCommand } from "../bots/parse.ts";
import type { DiscordInteractionData, DiscordInteractionOption } from "./types.ts";

export type DiscordCommand =
  | { type: "help" }
  | { type: "status" }
  | { type: "pair"; code: string }
  | { type: "pairchannel"; code: string }
  | { type: "budget"; usd?: number }
  | { type: "model"; model: string }
  | { type: "stop" }
  | { type: "approve"; id: string }
  | { type: "deny"; id: string }
  | { type: "ask"; text: string; budgetUsd?: number }
  | { type: "task"; text: string; budgetUsd?: number }
  | { type: "empty" };

const SUBCOMMANDS = new Set([
  "ask", "budget", "model", "stop", "approve", "deny", "help", "status", "pair", "pairchannel",
]);

/** Prefixes accepted in text messages. Telegram-style is first-class. */
const PREFIXES = ["/xr ", "xr ", "!"] as const;

/**
 * Parse a text message into a command. Bare `/budget` and `/stop` work too —
 * users type Telegram habits everywhere — but only for known command words, so
 * a sentence starting with "/" is still treated as a task.
 */
export function parseDiscordText(raw: string): DiscordCommand {
  const text = (raw ?? "").trim();
  if (!text) return { type: "empty" };

  const prefixed = parsePrefixedCommand(text, PREFIXES);
  if (prefixed) return commandFromWords(prefixed.command, prefixed.arg);

  if (text.startsWith("/")) {
    const [head, ...tail] = text.slice(1).split(/\s+/);
    const word = head.split("@")[0].toLowerCase();
    if (SUBCOMMANDS.has(word)) return commandFromWords(word, tail.join(" ").trim());
  }

  return { type: "task", text, budgetUsd: extractBudget(text) };
}

function commandFromWords(command: string, arg: string): DiscordCommand {
  const first = arg.split(/\s+/)[0] ?? "";
  switch (command) {
    case "help":
      return { type: "help" };
    case "status":
      return { type: "status" };
    case "pair":
      return { type: "pair", code: first };
    case "pairchannel":
      return { type: "pairchannel", code: first };
    case "budget": {
      const usd = extractBudget(arg) ?? Number(first);
      return { type: "budget", usd: Number.isFinite(usd) && usd > 0 ? usd : undefined };
    }
    case "model":
      return { type: "model", model: first };
    case "stop":
    case "cancel":
      return { type: "stop" };
    case "approve":
      return { type: "approve", id: first };
    case "deny":
      return { type: "deny", id: first };
    case "ask":
      return { type: "ask", text: arg, budgetUsd: extractBudget(arg) };
    default:
      return { type: "task", text: arg, budgetUsd: extractBudget(arg) };
  }
}

// ── slash commands ─────────────────────────────────────────────────────────

const STRING = 3;
const SUB_COMMAND = 1;

/**
 * The `/xr` command tree, registered at READY.
 *
 * Discord limits: command/subcommand names ≤ 32 characters, descriptions ≤ 100.
 * `devGuildId` in settings registers this same tree into one guild instead,
 * which propagates instantly.
 */
export const SLASH_COMMANDS = [
  {
    name: "xr",
    description: "Talk to XR running on your computer",
    options: [
      {
        type: SUB_COMMAND,
        name: "ask",
        description: "Ask XR to do something on your machine",
        options: [{ type: STRING, name: "question", description: "What should XR do?", required: true }],
      },
      {
        type: SUB_COMMAND,
        name: "budget",
        description: "Spend so far and this chat's per-task ceiling",
        options: [{ type: STRING, name: "usd", description: "New per-task ceiling in USD (optional)", required: false }],
      },
      {
        type: SUB_COMMAND,
        name: "model",
        description: "Show or switch the model for this chat",
        options: [{ type: STRING, name: "name", description: "Model id (ask first to see options)", required: false }],
      },
      { type: SUB_COMMAND, name: "stop", description: "Cancel the running task in this chat" },
      {
        type: SUB_COMMAND,
        name: "approve",
        description: "Approve a pending action",
        options: [{ type: STRING, name: "id", description: "Approval id (defaults to the latest here)", required: false }],
      },
      {
        type: SUB_COMMAND,
        name: "deny",
        description: "Deny a pending action",
        options: [{ type: STRING, name: "id", description: "Approval id (defaults to the latest here)", required: false }],
      },
      { type: SUB_COMMAND, name: "status", description: "Bot, spend and security state" },
      { type: SUB_COMMAND, name: "help", description: "How XR works here (replies privately)" },
      {
        type: SUB_COMMAND,
        name: "pair",
        description: "Link your Discord account to XR with a code from the XR app",
        options: [{ type: STRING, name: "code", description: "6-digit code shown in XR", required: true }],
      },
      {
        type: SUB_COMMAND,
        name: "pairchannel",
        description: "Allow XR to answer in this channel (channel code from XR)",
        options: [{ type: STRING, name: "code", description: "6-digit channel code shown in XR", required: true }],
      },
    ],
  },
] as const;

/** Commands whose reply must be ephemeral (private data or noise control). */
export function isEphemeralCommand(cmd: DiscordCommand): boolean {
  return cmd.type === "budget" || cmd.type === "model" || cmd.type === "help" || cmd.type === "status" || cmd.type === "pair";
}

/** Flatten Discord's option tree into the same command shape text parsing yields. */
export function parseInteraction(data: DiscordInteractionData | undefined): DiscordCommand | null {
  if (!data || data.name !== "xr") return null;
  const sub = (data.options ?? [])[0];
  if (!sub) return { type: "help" };
  const option = (name: string): string => {
    const hit = (sub.options ?? []).find((o: DiscordInteractionOption) => o.name === name);
    return hit?.value == null ? "" : String(hit.value).trim();
  };
  switch (sub.name) {
    case "ask":
      return { type: "ask", text: option("question"), budgetUsd: extractBudget(option("question")) };
    case "budget": {
      const raw = option("usd");
      const usd = raw ? extractBudget(raw) ?? Number(raw) : undefined;
      return { type: "budget", usd: usd != null && Number.isFinite(usd) && usd > 0 ? usd : undefined };
    }
    case "model":
      return { type: "model", model: option("name") };
    case "stop":
      return { type: "stop" };
    case "approve":
      return { type: "approve", id: option("id") };
    case "deny":
      return { type: "deny", id: option("id") };
    case "status":
      return { type: "status" };
    case "help":
      return { type: "help" };
    case "pair":
      return { type: "pair", code: option("code") };
    case "pairchannel":
      return { type: "pairchannel", code: option("code") };
    default:
      return { type: "help" };
  }
}

/**
 * The invite URL for the bot, with the minimum permissions XR uses:
 * View Channel, Send Messages, Embed Links, Attach Files, Read Message History.
 *
 * The brief carried `274877925376`, which is these three bits PLUS
 * MODERATE_MEMBERS (1 << 38 — Discord's "timeout members"). XR has no business
 * holding a moderation permission, so the number below is deliberately smaller.
 */
export const INVITE_PERMISSIONS = 1024 + 2048 + 16384 + 32768 + 65536; // 117_760

export function inviteUrl(applicationId: string): string {
  return (
    `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}` +
    `&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`
  );
}
