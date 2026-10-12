/**
 * XR — WhatsApp message builders (pure, testable).
 *
 * WhatsApp's dialect is its own: `*bold*`, `_italic_`, `~strike~`, single
 * backticks for code. There are no embeds, no components, no message edits and
 * no ephemeral replies — so an approval is a numbered menu, and the outcome is
 * a follow-up message. Nothing here is Discord or MarkdownV2 syntax.
 *
 * Splitting is done by the shared chunker with WhatsApp's own 1500-character
 * limit and an explicit continuation marker.
 */
import { chunkText } from "../bots/chunk.ts";
import { WA_MAX_CHARS } from "./types.ts";

export { WA_MAX_CHARS };
export const CONTINUATION_MARKER = "…(continued)";
export const BOT_FOOTER = "XR · running on your machine";

/**
 * The unofficial-client disclosure. One wording, used by the desktop dialog,
 * the README and the link confirmation — so nobody can claim they were not
 * told.
 */
export const UNOFFICIAL_CLIENT_NOTICE =
  "WhatsApp does not offer an official API for personal accounts. XR links as a companion device " +
  "using an unofficial open-source client (Baileys), exactly like a second phone you signed in from. " +
  "That is against WhatsApp's terms for automated use, and accounts have been banned for it. " +
  "Use a number you can afford to lose, keep the rate low, and only allow the contacts you mean to.";

/** `*bold*` in WhatsApp. */
export function bold(text: string): string {
  return `*${text}*`;
}

/** Inline code. Backslash-escapes are not a thing here — this is the escape. */
export function codeSpan(text: string): string {
  return `\`${String(text).replace(/`/g, "'")}\``;
}

export function truncate(text: string, max: number): string {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Split an answer into WhatsApp-sized messages. */
export function splitForWhatsApp(text: string): string[] {
  return chunkText(String(text ?? ""), { maxLength: WA_MAX_CHARS, continuation: `\n${CONTINUATION_MARKER}` });
}

/**
 * An approval request. WhatsApp has no buttons with callbacks, so the message
 * ends with the numbered menu the user answers by text — and the same numbers
 * are what the tests exercise.
 */
export function approvalMessage(opts: {
  id: string;
  tool: string;
  reason: string;
  preview?: string;
  riskTier?: string;
}): string {
  const body = opts.preview ? `\n${codeSpan(truncate(opts.preview, 600))}` : "";
  return [
    `🛡 ${bold("Approval needed")} · ${codeSpan(opts.id)}`,
    `${bold("Tool:")} ${codeSpan(opts.tool)}`,
    opts.riskTier ? `${bold("Risk:")} ${truncate(opts.riskTier, 60)}` : "",
    `${bold("Reason:")} ${truncate(opts.reason, 600)}`,
  ]
    .filter(Boolean)
    .join("\n") +
    body +
    "\n\n[1] Approve  [2] Deny  [3] View details" +
    "\n_Reply with a number, or use /xr approve … — you can also answer from the XR app._";
}

/** The full record behind `[3] View details`. */
export function approvalDetailsText(opts: {
  id: string;
  tool: string;
  reason: string;
  preview?: string;
  riskTier?: string;
}): string {
  return [
    `🛡 ${bold("Approval details")} · ${codeSpan(opts.id)}`,
    `${bold("Tool:")} ${codeSpan(opts.tool)}`,
    opts.riskTier ? `${bold("Risk:")} ${truncate(opts.riskTier, 60)}` : "",
    `${bold("Reason:")} ${truncate(opts.reason, 1200)}`,
    opts.preview ? `${bold("Preview:")}\n${codeSpan(truncate(opts.preview, 1000))}` : "_No preview recorded._",
    "",
    "[1] Approve  [2] Deny",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The outcome, sent as a follow-up (WhatsApp messages cannot be edited). The
 * surface that decided is named when it was not this chat.
 */
export function approvalResolvedText(opts: { tool: string; outcome: "approved" | "rejected" | "expired"; surface?: string }): string {
  const from = opts.surface && opts.surface !== "whatsapp" ? ` from ${opts.surface}` : "";
  if (opts.outcome === "expired") return `⌛ Expired · ${opts.tool}`;
  if (opts.outcome === "approved") return `✅ Approved${from} · ${opts.tool}`;
  return `❌ Denied${from} · ${opts.tool}`;
}

/** Transcripts are labelled, so a task built from a voice note says so. */
export function voiceNoteText(transcript: string): string {
  return `[🎤 Voice note] ${transcript}`;
}

export function imageNote(name: string, size: string): string {
  return `📷 ${name} (${size})`;
}

export function documentNote(name: string, size: string): string {
  return `📄 ${name} (${size})`;
}

export function attachmentNote(name: string, size: string): string {
  return `📎 ${name} (${size})`;
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
  linkedAs: string | null;
  contacts: number;
  connection: string;
}): string {
  return [
    `${bold("XR status")} · ${truncate(opts.project, 60)}`,
    `State: ${opts.paused ? "paused" : opts.busy ? "working" : "idle"}`,
    opts.model ? `Model: ${codeSpan(opts.model)}` : "",
    `Spend: $${opts.costUsd.toFixed(4)} · ${opts.tokens} tokens (total)`,
    `Security: ${Math.round(opts.blockRate * 100)}% block-rate`,
    `Audit chain: ${opts.auditOk ? "intact" : "BROKEN"}`,
    `Access: ${opts.contacts} allowed ${opts.contacts === 1 ? "contact" : "contacts"} · 1:1 only`,
    `Linked: ${opts.linkedAs ?? "not linked"} · ${opts.connection}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function budgetText(opts: {
  todayUsd: number;
  monthUsd: number;
  perTask: number;
  defaultPerTask: number;
  chatCap?: number;
  spentHere: number;
}): string {
  return [
    bold("Spend"),
    `Today: $${opts.todayUsd.toFixed(4)}`,
    `This month: $${opts.monthUsd.toFixed(4)}`,
    `This chat: $${opts.spentHere.toFixed(4)}${opts.chatCap != null ? ` of $${opts.chatCap.toFixed(2)} cap` : " (no cap set)"}`,
    `Per-task ceiling here: $${opts.perTask.toFixed(2)}${opts.perTask !== opts.defaultPerTask ? ` (default $${opts.defaultPerTask.toFixed(2)})` : ""}`,
  ].join("\n");
}

/** Help text for WhatsApp. Plain words, no syntax that WhatsApp renders oddly. */
export function helpText(): string {
  return [
    `${bold("XR — remote control for your computer.")}`,
    "XR must be running on your computer for this chat to answer.",
    "",
    `${bold("Chat")} — just send a message to this number:`,
    codeSpan("refactor the auth module, keep it under $0.50"),
    "",
    `${bold("Commands")}`,
    "`/xr budget` — today's spend and this chat's ceiling",
    "`/xr model` — show or switch the model for this chat",
    "`/xr stop` — cancel the running task",
    "`/xr approve` `/xr deny` — answer a pending approval (or reply 1 / 2)",
    "`/xr status` — spend, security and link state",
    "`/xr help` — this message",
    "",
    `${bold("Voice notes, photos, files")} — send them straight in; voice notes are transcribed if a speech model is set up.`,
    "",
    `Risky actions ask for approval with a numbered menu. The same approval can be answered from the XR app, Telegram or Discord — whichever you reach first.`,
    "",
    `Send \`stop\` (on its own) to make XR stop answering this number.`,
  ].join("\n");
}

/** Confirmation shown after a bare `stop`: the sender asked to be forgotten. */
export function blockedText(): string {
  return [
    `${bold("Done — XR will not answer this number again.")}`,
    "Re-add it in the XR app (Integrations → WhatsApp → Contacts) if you change your mind.",
  ].join("\n");
}

/** Shown in the chat right after the QR scan succeeds. */
export function linkedText(selfLabel: string | null): string {
  return [
    `✅ ${bold("WhatsApp linked.")}${selfLabel ? ` This number is ${codeSpan(selfLabel)}.` : ""}`,
    "",
    "Nobody may talk to XR yet: add the contacts you want in the XR app, or switch on",
    "“respond to contacts I message first”. Until then this chat stays silent to everyone.",
    "",
    `_${BOT_FOOTER}_`,
  ].join("\n");
}

/** The one-line risk note that accompanies every link confirmation. */
export function riskLine(): string {
  return "⚠️ Unofficial client — see the WhatsApp section in the XR README before you use this number for anything that matters.";
}
