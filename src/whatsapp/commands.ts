/**
 * XR — WhatsApp command vocabulary (pure, testable).
 *
 * WhatsApp has no slash-command registry, so everything arrives as text. Two
 * entry points share one vocabulary:
 *
 *   · prefixed commands — `/xr budget`, `/xr model gpt-5-mini`, `!stop`
 *   · a numbered menu for approvals — `1`, `2`, `3`, or the words `approve`,
 *     `deny`, `details` (the same three answers as the button surfaces)
 *
 * Anything else is a task: a message to XR with no prefix is exactly like
 * typing in the Telegram bot's DM.
 *
 * One deliberate asymmetry: bare `stop` (no prefix) means "stop answering this
 * number" — that is the WhatsApp wording for revoking the contact — while
 * `/xr stop` cancels the running task, like every other surface. Both are
 * spelled out in `render.ts`'s help text.
 */
import { extractBudget, parsePrefixedCommand } from "../bots/parse.ts";

export type WhatsAppCommand =
  | { type: "help" }
  | { type: "status" }
  | { type: "stop" }
  | { type: "revoke" }
  | { type: "budget"; usd?: number }
  | { type: "model"; model: string }
  | { type: "approve"; id: string }
  | { type: "deny"; id: string }
  | { type: "ask"; text: string; budgetUsd?: number }
  | { type: "task"; text: string; budgetUsd?: number }
  | { type: "empty" };

const SUBCOMMANDS = new Set(["ask", "budget", "model", "stop", "approve", "deny", "help", "status"]);
const PREFIXES = ["/xr", "!"] as const;
/** Whole-message words that mean "stop answering this number". */
const REVOKE_WORDS = new Set(["stop", "unsubscribe", "stop all"]);

export function parseWhatsAppText(raw: string): WhatsAppCommand {
  const text = (raw ?? "").trim();
  if (!text) return { type: "empty" };

  // Bare `stop` is the sender asking to be forgotten, not a task.
  if (REVOKE_WORDS.has(text.toLowerCase())) return { type: "revoke" };

  const prefixed = parsePrefixedCommand(text, PREFIXES);
  if (prefixed) return prefixed.command ? commandFromWords(prefixed.command, prefixed.arg) : { type: "empty" };

  // Telegram-style `/stop` and `/budget` still work — only for known words, so
  // a sentence that happens to start with a slash stays a task.
  if (text.startsWith("/")) {
    const [head, ...tail] = text.slice(1).split(/\s+/);
    const word = head.split("@")[0].toLowerCase();
    if (SUBCOMMANDS.has(word)) return commandFromWords(word, tail.join(" ").trim());
  }

  return { type: "task", text, budgetUsd: extractBudget(text) };
}

function commandFromWords(command: string, arg: string): WhatsAppCommand {
  switch (command) {
    case "help":
      return { type: "help" };
    case "status":
      return { type: "status" };
    case "stop":
      return { type: "stop" };
    case "budget": {
      const usd = extractBudget(arg) ?? (Number.isFinite(Number(arg)) && arg ? Number(arg) : undefined);
      return { type: "budget", usd };
    }
    case "model":
      return { type: "model", model: arg.split(/\s+/)[0] ?? "" };
    case "approve":
      return { type: "approve", id: arg.split(/\s+/)[0] ?? "" };
    case "deny":
      return { type: "deny", id: arg.split(/\s+/)[0] ?? "" };
    case "ask": {
      const text = arg.trim();
      return { type: "ask", text, budgetUsd: extractBudget(text) };
    }
    default:
      // An unknown word after the prefix is still a task ("/xr fix the tests").
      return { type: "task", text: [command, arg].filter(Boolean).join(" ").trim(), budgetUsd: extractBudget(arg) };
  }
}

export type WhatsAppDecision = "approve" | "deny" | "details";

/**
 * The numbered menu answer. Only consulted while an approval in this chat is
 * still pending — a bare "1" is otherwise just a message like any other.
 */
export function parseDecision(raw: string): WhatsAppDecision | null {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "1" || text === "approve" || text === "approved" || text === "yes" || text === "✅") return "approve";
  if (text === "2" || text === "deny" || text === "denied" || text === "no" || text === "❌") return "deny";
  if (text === "3" || text === "details" || text === "view details" || text === "view" || text === "👀") return "details";
  return null;
}
