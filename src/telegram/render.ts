/**
 * XR — Telegram message + inline-keyboard builders (pure, testable).
 *
 * Risky actions arrive as a MarkdownV2 message with ✅ Approve / ❌ Reject /
 * 👀 Details buttons. Every model- or tool-controlled string is escaped via
 * `escapeV2`. System and status text is plain (no parse mode), so counters
 * like "90% block-rate" appear exactly as written.
 */
import { escapeV2, escapeCodeV2 } from "./markdown.ts";

export interface InlineButton {
  text: string;
  callback_data: string;
}
export type InlineKeyboard = InlineButton[][];

export interface OutgoingMessage {
  text: string;
  parse_mode?: "MarkdownV2";
  reply_markup?: { inline_keyboard: InlineKeyboard };
}

/** Plain system text: no parse mode, no escaping needed. */
export function plain(text: string, keyboard?: InlineKeyboard): OutgoingMessage {
  return keyboard ? { text, reply_markup: { inline_keyboard: keyboard } } : { text };
}

/** Keyboard for a live approval: Approve / Reject on row 1, Details on row 2. */
export function approvalKeyboard(id: string): InlineKeyboard {
  return [
    [
      { text: "✅ Approve", callback_data: `ok:${id}` },
      { text: "❌ Reject", callback_data: `no:${id}` },
    ],
    [{ text: "👀 Details", callback_data: `det:${id}` }],
  ];
}

/** An approval request rendered for Telegram. */
export function approvalMessage(opts: {
  id: string;
  tool: string;
  reason: string;
  preview?: string;
  riskTier?: string;
}): OutgoingMessage {
  const head = [
    `*Approval needed* \\(\`${escapeCodeV2(opts.id)}\`\\)`,
    `Tool: \`${escapeCodeV2(opts.tool)}\``,
    `Reason: ${escapeV2(opts.reason)}`,
  ];
  if (opts.riskTier) head.push(`Risk: ${escapeV2(opts.riskTier)}`);
  const body = opts.preview ? "\n```\n" + escapeCodeV2(truncate(opts.preview, 600)) + "\n```" : "";
  return {
    text: head.join("\n") + body,
    parse_mode: "MarkdownV2",
    reply_markup: { inline_keyboard: approvalKeyboard(opts.id) },
  };
}

/** Full details for an approval (the 👀 button), with the buttons repeated. */
export function approvalDetailsMessage(opts: {
  id: string;
  tool: string;
  reason: string;
  preview?: string;
}): OutgoingMessage {
  const body = opts.preview ? escapeCodeV2(truncate(opts.preview, 3500)) : "(no preview recorded)";
  return {
    text: `*Details* \\(\`${escapeCodeV2(opts.id)}\`\\)\nTool: \`${escapeCodeV2(opts.tool)}\`\nReason: ${escapeV2(opts.reason)}\n\`\`\`\n${body}\n\`\`\``,
    parse_mode: "MarkdownV2",
    reply_markup: { inline_keyboard: approvalKeyboard(opts.id) },
  };
}

/** Text shown on the approval message once it is decided elsewhere. */
export function approvalResolvedText(opts: {
  tool: string;
  outcome: "approved" | "rejected" | "expired";
  surface?: string;
}): string {
  const from = opts.surface && opts.surface !== "telegram" ? ` from ${opts.surface}` : "";
  if (opts.outcome === "expired") return `⌛ Expired · ${opts.tool}`;
  if (opts.outcome === "approved") return `✅ Approved${from} · ${opts.tool}`;
  return `❌ Rejected${from} · ${opts.tool}`;
}

export function statusMessage(opts: {
  project: string;
  costUsd: number;
  tokens: number;
  blockRate: number;
  auditOk: boolean;
  paused: boolean;
  model?: string;
  busy?: boolean;
}): OutgoingMessage {
  return plain(
    [
      `XR status · ${opts.project}`,
      `State: ${opts.paused ? "paused" : opts.busy ? "working" : "idle"}`,
      opts.model ? `Model: ${opts.model}` : "",
      `Spend: $${opts.costUsd.toFixed(4)} · ${opts.tokens} tokens (total)`,
      `Security: ${Math.round(opts.blockRate * 100)}% block-rate`,
      `Audit chain: ${opts.auditOk ? "intact" : "BROKEN"}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export function parseCallback(
  data: string,
): { decision: "approve" | "reject" | "details"; id: string } | null {
  const m = /^(ok|no|det):([A-Za-z0-9_-]{1,64})$/.exec(data ?? "");
  if (!m) return null;
  const decision = m[1] === "ok" ? "approve" : m[1] === "no" ? "reject" : "details";
  return { decision, id: m[2] };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "\n…(truncated)" : s;
}
