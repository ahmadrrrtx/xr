/**
 * XR — Telegram command parsing (pure, testable).
 * Slash commands map to structured commands. Anything else is a task, with an
 * optional inline budget ("...keep it under $0.50").
 */

export type TgCommand =
  | { type: "start" }
  | { type: "status" }
  | { type: "help" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "pause-all" }
  | { type: "resume-all" }
  | { type: "cost" }
  | { type: "budget"; usd: number }
  | { type: "model"; model: string }
  | { type: "stop" }
  | { type: "approve"; id: string }
  | { type: "deny"; id: string }
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
    // Telegram appends @botname in groups; private chats never do, but strip it anyway.
    const [head, ...rest] = text.slice(1).split(/\s+/);
    const cmd = head.split("@")[0].toLowerCase();
    const arg = rest.join(" ").trim();
    switch (cmd) {
      case "start":
        return { type: "start" };
      case "status":
        return { type: "status" };
      case "help":
        return { type: "help" };
      case "pause":
        return { type: "pause" };
      case "resume":
        return { type: "resume" };
      case "pause-all":
        return { type: "pause-all" };
      case "resume-all":
        return { type: "resume-all" };
      case "cost":
        return { type: "cost" };
      case "budget": {
        const usd = extractBudget(arg) ?? Number(arg);
        return { type: "budget", usd: Number.isFinite(usd) ? usd : 0 };
      }
      case "model":
        return { type: "model", model: arg.split(/\s+/)[0] ?? "" };
      case "stop":
      case "cancel":
        return { type: "stop" };
      case "approve":
        return { type: "approve", id: arg.split(/\s+/)[0] ?? "" };
      case "deny":
        return { type: "deny", id: arg.split(/\s+/)[0] ?? "" };
      case "task":
        return { type: "task", text: arg, budgetUsd: extractBudget(arg) };
      default:
        return { type: "help" };
    }
  }

  // Free text is a task, with optional inline budget.
  return { type: "task", text, budgetUsd: extractBudget(text) };
}

/** Help text (plain, no parse mode). */
export function helpText(): string {
  return [
    "XR — remote control for your computer.",
    "XR must be running on your computer for the bot to respond.",
    "",
    "Send a task in plain text, for example:",
    "refactor the auth module, keep it under $0.50",
    "",
    "Commands",
    "/status — current state, model, spend, security",
    "/cost — spend summary",
    "/budget $1.00 — per-task ceiling for this chat",
    "/model <id> — model for this chat",
    "/stop — cancel the running task",
    "/pause and /resume — freeze or continue this chat",
    "/pause-all and /resume-all — scheduled triggers",
    "/approve <id> and /deny <id> — answer an approval by id",
    "/help — this message",
    "",
    "Risky actions ask for approval here with Approve, Reject, or Details buttons.",
  ].join("\n");
}
