/**
 * XR — Telegram command parsing (pure, testable).
 * Parses incoming messages into structured commands. Supports slash commands
 * (/budget, /pause, /status, /cron, /help) and free-text tasks with inline
 * budget constraints ("...keep it under $0.50").
 */

export type TgCommand =
  | { type: "status" }
  | { type: "help" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cost" }
  | { type: "budget"; usd: number }
  | { type: "task"; text: string; budgetUsd?: number }
  | { type: "empty" };

/** Extract an inline budget like "under $0.50" / "$2 budget" / "max $1.5". */
export function extractBudget(text: string): number | undefined {
  const m = text.match(/\$\s?(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
}

export function parseCommand(raw: string): TgCommand {
  const text = (raw ?? "").trim();
  if (!text) return { type: "empty" };

  if (text.startsWith("/")) {
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (cmd.toLowerCase()) {
      case "status":
        return { type: "status" };
      case "help":
      case "start":
        return { type: "help" };
      case "pause":
        return { type: "pause" };
      case "resume":
        return { type: "resume" };
      case "cost":
        return { type: "cost" };
      case "budget": {
        const usd = extractBudget(arg) ?? Number(arg);
        return { type: "budget", usd: Number.isFinite(usd) ? usd : 0 };
      }
      case "task":
        return { type: "task", text: arg, budgetUsd: extractBudget(arg) };
      default:
        return { type: "help" };
    }
  }

  // Free text → a task, with optional inline budget.
  return { type: "task", text, budgetUsd: extractBudget(text) };
}

/** Build the help message body. */
export function helpText(): string {
  return [
    "🛡️ *XR — remote control*",
    "",
    "Send a task in plain text, e.g.:",
    "`refactor the auth module, keep it under $0.50`",
    "",
    "*Commands*",
    "/status — current task, cost, security",
    "/cost — token & spend summary",
    "/budget $1.00 — set per-task ceiling",
    "/pause — freeze the agent",
    "/resume — continue",
    "/help — this message",
    "",
    "_Risky actions ask for your ✅/❌ approval right here._",
  ].join("\n");
}
