/**
 * XR — Telegram message + inline-keyboard builders (pure, testable).
 * The phone-approval mechanism: risky actions arrive as a message with
 * ✅ Approve / ❌ Reject / 👀 Diff buttons, answered from your lock screen.
 */

export interface InlineButton {
  text: string;
  callback_data: string;
}
export type InlineKeyboard = InlineButton[][];

export interface OutgoingMessage {
  text: string;
  parse_mode?: "Markdown";
  reply_markup?: { inline_keyboard: InlineKeyboard };
}

/** An approval request rendered for Telegram. */
export function approvalMessage(opts: {
  id: string;
  tool: string;
  reason: string;
  preview?: string;
}): OutgoingMessage {
  const lines = [`🔒 *Approval needed*`, `tool: \`${opts.tool}\``, `${opts.reason}`];
  if (opts.preview) {
    const clipped = opts.preview.split("\n").slice(0, 20).join("\n");
    lines.push("```\n" + clipped.slice(0, 600) + "\n```");
  }
  return {
    text: lines.join("\n"),
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `ok:${opts.id}` },
          { text: "❌ Reject", callback_data: `no:${opts.id}` },
        ],
      ],
    },
  };
}

export function statusMessage(s: {
  project: string;
  costUsd: number;
  tokens: number;
  blockRate: number;
  auditOk: boolean;
  paused: boolean;
}): OutgoingMessage {
  const text = [
    `🛡️ *XR status*`,
    `project: \`${s.project}\``,
    `state: ${s.paused ? "⏸ paused" : "▶️ ready"}`,
    `cost: $${s.costUsd.toFixed(4)} · ${fmtK(s.tokens)} tok`,
    `security: ${Math.round(s.blockRate * 100)}% block-rate`,
    `audit chain: ${s.auditOk ? "✓ intact" : "✗ BROKEN"}`,
  ].join("\n");
  return { text, parse_mode: "Markdown" };
}

export function plain(text: string): OutgoingMessage {
  return { text, parse_mode: "Markdown" };
}

/** Parse an inline-button callback (e.g. "ok:abc12") → {decision,id}. */
export function parseCallback(data: string): { decision: "approve" | "reject"; id: string } | null {
  const m = data.match(/^(ok|no):(.+)$/);
  if (!m) return null;
  return { decision: m[1] === "ok" ? "approve" : "reject", id: m[2] };
}

function fmtK(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n));
}
