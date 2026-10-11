/**
 * XR — Discord command grammar (Phase 26).
 *
 * Two entry points, one result type:
 *  - slash command `/xr <subcommand>` (interactions), parsed from interaction data
 *  - text messages: `/xr <sub>`, `xr <sub>`, or plain chat (DMs and addressed guild messages)
 *
 * In a server, text reaches XR only when it starts with "/xr" or "xr " or mentions the bot.
 * Ordinary channel conversation is never treated as a command.
 */
import { OptionType } from "./types.ts";

export type XrCommand =
  | { kind: "ask"; text: string }
  | { kind: "chat"; text: string }
  | { kind: "stop" }
  | { kind: "budget" }
  | { kind: "help" }
  | { kind: "model"; name?: string }
  | { kind: "approve"; id?: string }
  | { kind: "deny"; id?: string }
  | { kind: "pair"; code: string }
  | { kind: "pairchannel"; code: string }
  | { kind: "invalid"; usage: string }
  | { kind: "none" };

const SUBCOMMANDS = new Set(["ask", "stop", "budget", "model", "approve", "deny", "help", "pair", "pairchannel"]);
const USAGE: Record<string, string> = {
  ask: "/xr ask <message>",
  pair: "/xr pair <6-digit code>",
  pairchannel: "/xr pairchannel <6-digit code>",
};

/** Remove `<@id>` / `<@!id>` mentions of the bot. Returns the cleaned text and whether one was present. */
export function stripBotMention(text: string, botId: string): { text: string; mentioned: boolean } {
  const mentioned = new RegExp(`<@!?${botId}>`).test(text);
  return { text: text.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim(), mentioned };
}

/**
 * Parse a text message.
 * @param opts.dm        true in DMs: plain text is chat.
 * @param opts.mentioned true when the bot was mentioned in a guild message.
 */
export function parseTextCommand(raw: string, opts: { dm: boolean; mentioned?: boolean }): XrCommand {
  const text = raw.trim();
  if (!text) return { kind: "none" };

  // Prefix form: "/xr ..." (always a command) or "xr ..." (only when the next word is a subcommand).
  const slash = /^\/xr(?=\s|$)\s*/i.exec(text);
  const plain = slash ? null : /^xr\s+(\S+)/i.exec(text);
  if (slash || (plain && SUBCOMMANDS.has(plain[1]!.toLowerCase()))) {
    const body = slash ? text.slice(slash[0].length) : text.slice(3).trimStart();
    return fromSubcommand(body);
  }

  // "xr <anything>" addresses XR (the brief's prefix rule). A DM is always addressed.
  if (plain) return { kind: "chat", text: text.slice(3).trimStart() };
  if (opts.dm || opts.mentioned) return { kind: "chat", text };
  return { kind: "none" };
}

function fromSubcommand(body: string): XrCommand {
  const [wordRaw = "", ...restWords] = body.split(/\s+/);
  const word = wordRaw.toLowerCase();
  const rest = restWords.join(" ").trim();
  if (!word) return { kind: "help" };
  switch (word) {
    case "ask":
      return rest ? { kind: "ask", text: rest } : { kind: "invalid", usage: USAGE.ask! };
    case "stop":
      return { kind: "stop" };
    case "budget":
      return { kind: "budget" };
    case "help":
      return { kind: "help" };
    case "model":
      return rest ? { kind: "model", name: rest } : { kind: "model" };
    case "approve":
      return rest ? { kind: "approve", id: rest } : { kind: "approve" };
    case "deny":
      return rest ? { kind: "deny", id: rest } : { kind: "deny" };
    case "pair":
      return rest ? { kind: "pair", code: rest } : { kind: "invalid", usage: USAGE.pair! };
    case "pairchannel":
      return rest ? { kind: "pairchannel", code: rest } : { kind: "invalid", usage: USAGE.pairchannel! };
    default:
      // "/xr what is the weather" is a question, not a typo.
      return { kind: "ask", text: body.trim() };
  }
}

export interface SlashOption {
  name: string;
  type: number;
  value?: unknown;
  options?: SlashOption[];
}

/** Map `/xr <sub> [options]` interaction data to a command. */
export function parseSlashCommand(options: SlashOption[] | undefined): XrCommand {
  const sub = options?.[0];
  if (!sub) return { kind: "help" };
  const val = (name: string): string | undefined => {
    const found = sub.options?.find((o) => o.name === name);
    return typeof found?.value === "string" && found.value.trim() ? found.value.trim() : undefined;
  };
  switch (sub.name) {
    case "ask": {
      const message = val("message");
      return message ? { kind: "ask", text: message } : { kind: "invalid", usage: USAGE.ask! };
    }
    case "pair": {
      const code = val("code");
      return code ? { kind: "pair", code } : { kind: "invalid", usage: USAGE.pair! };
    }
    case "pairchannel": {
      const code = val("code");
      return code ? { kind: "pairchannel", code } : { kind: "invalid", usage: USAGE.pairchannel! };
    }
    case "approve":
      return { kind: "approve", id: val("id") };
    case "deny":
      return { kind: "deny", id: val("id") };
    case "model":
      return { kind: "model", name: val("name") };
    case "stop":
      return { kind: "stop" };
    case "budget":
      return { kind: "budget" };
    default:
      return { kind: "help" };
  }
}

/** Global application command registered with PUT /applications/{id}/commands. */
export const XR_COMMAND_DEFINITION = {
  name: "xr",
  description: "XR, running on your computer",
  type: 1,
  options: [
    {
      type: OptionType.SUB_COMMAND,
      name: "ask",
      description: "Ask XR something",
      options: [{ type: OptionType.STRING, name: "message", description: "What to ask", required: true }],
    },
    { type: OptionType.SUB_COMMAND, name: "stop", description: "Stop the running task in this chat" },
    { type: OptionType.SUB_COMMAND, name: "budget", description: "Show today's and this month's spend" },
    {
      type: OptionType.SUB_COMMAND,
      name: "model",
      description: "Show or set the model for this chat",
      options: [{ type: OptionType.STRING, name: "name", description: "Model name. Leave blank to see the current one." }],
    },
    {
      type: OptionType.SUB_COMMAND,
      name: "approve",
      description: "Approve a pending action",
      options: [{ type: OptionType.STRING, name: "id", description: "Approval id. Leave blank for the latest." }],
    },
    {
      type: OptionType.SUB_COMMAND,
      name: "deny",
      description: "Deny a pending action",
      options: [{ type: OptionType.STRING, name: "id", description: "Approval id. Leave blank for the latest." }],
    },
    { type: OptionType.SUB_COMMAND, name: "help", description: "What XR can do here" },
    {
      type: OptionType.SUB_COMMAND,
      name: "pair",
      description: "Pair this DM with XR",
      options: [{ type: OptionType.STRING, name: "code", description: "6-digit code from XR", required: true }],
    },
    {
      type: OptionType.SUB_COMMAND,
      name: "pairchannel",
      description: "Let XR answer in this channel",
      options: [{ type: OptionType.STRING, name: "code", description: "6-digit code from XR", required: true }],
    },
  ],
} as const;

export const HELP_TEXT = [
  "XR must be running on your computer for the bot to respond.",
  "",
  "`/xr ask <message>` ask a question or give a task",
  "`/xr stop` stop the running task in this chat",
  "`/xr budget` today's and this month's spend",
  "`/xr model [name]` show or set the model for this chat",
  "`/xr approve [id]` · `/xr deny [id]` answer a pending action",
  "In a DM, just type your message. In a server, mention XR or start with `xr `.",
].join("\n");
