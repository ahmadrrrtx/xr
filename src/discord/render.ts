/**
 * XR — Discord message builders (pure, testable).
 *
 * Risky actions arrive as an embed with a cyan accent bar and real message
 * components: ✅ Approve (green), ❌ Deny (red), 👀 Details (grey) and — when a
 * dashboard URL is configured — a LINK button to the local Control Center.
 *
 * Formatting rules (Discord dialect, never MarkdownV2):
 *   · `**bold**` `_italic_` `__underline__` `~~strike~~` `||spoiler||`
 *   · inline `` `code` `` and fenced ```lang blocks
 *   · messages split at 2000 characters with an explicit continuation marker
 *
 * Nothing here escapes into MarkdownV2 or WhatsApp syntax: each surface speaks
 * its own dialect and the shared runtime only moves text between them.
 */
import { chunkText } from "../bots/chunk.ts";
import { BUTTON_STYLE, COMPONENT_TYPE } from "./types.ts";

export const DISCORD_MAX_CHARS = 2000;
export const CONTINUATION_MARKER = "…(continued)";
/** XR cyan, as a Discord decimal colour. */
export const APPROVAL_COLOR = 0x00e5ff;
export const BOT_FOOTER = "XR · running on your machine";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordButton {
  type: typeof COMPONENT_TYPE.BUTTON;
  style: number;
  label: string;
  custom_id?: string;
  url?: string;
  emoji?: { name: string };
  disabled?: boolean;
}

export interface DiscordActionRow {
  type: typeof COMPONENT_TYPE.ACTION_ROW;
  components: DiscordButton[];
}

/** The surface-native message shape: what `BotSurface<DiscordOutgoing>` sends. */
export interface DiscordOutgoing {
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordActionRow[];
  /** Interaction-only: reply so only the invoker sees it. */
  ephemeral?: boolean;
  /** Reply to this message id (used when answering a specific question). */
  replyToMessageId?: string | null;
}

/** Escape the characters Discord would render as formatting. */
export function escapeMarkdown(text: string): string {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|>])/g, "\\$1");
}

export function codeSpan(text: string): string {
  return `\`${String(text ?? "").replace(/`/g, "ʼ")}\``;
}

export function codeBlock(lang: string, body: string): string {
  return `\`\`\`${lang}\n${String(body ?? "").replace(/```/g, "ʼʼʼ")}\n\`\`\``;
}

export function truncate(text: string, max: number): string {
  const s = String(text ?? "");
  return s.length > max ? s.slice(0, max) + "\n…(truncated)" : s;
}

/** Split a model answer into Discord-sized messages. */
export function splitForDiscord(text: string): string[] {
  return chunkText(String(text ?? ""), { maxLength: DISCORD_MAX_CHARS, continuation: `\n${CONTINUATION_MARKER}` });
}

// ── approvals ──────────────────────────────────────────────────────────────

export function approvalButtons(id: string, dashboardUrl?: string): DiscordActionRow[] {
  const rows: DiscordActionRow[] = [
    {
      type: COMPONENT_TYPE.ACTION_ROW,
      components: [
        { type: COMPONENT_TYPE.BUTTON, style: BUTTON_STYLE.SUCCESS, label: "Approve", emoji: { name: "✅" }, custom_id: `xr:approve:${id}` },
        { type: COMPONENT_TYPE.BUTTON, style: BUTTON_STYLE.DANGER, label: "Deny", emoji: { name: "❌" }, custom_id: `xr:deny:${id}` },
      ],
    },
    {
      type: COMPONENT_TYPE.ACTION_ROW,
      components: [
        { type: COMPONENT_TYPE.BUTTON, style: BUTTON_STYLE.SECONDARY, label: "Details", emoji: { name: "👀" }, custom_id: `xr:details:${id}` },
        ...(dashboardUrl
          ? [{ type: COMPONENT_TYPE.BUTTON, style: BUTTON_STYLE.LINK, label: "Open XR", emoji: { name: "🖥️" }, url: dashboardUrl } as DiscordButton]
          : []),
      ],
    },
  ];
  return rows;
}

/** An approval request rendered for Discord: embed + components. */
export function approvalMessage(opts: {
  id: string;
  tool: string;
  reason: string;
  preview?: string;
  riskTier?: string;
  dashboardUrl?: string;
}): DiscordOutgoing {
  const fields: DiscordEmbedField[] = [{ name: "Tool", value: codeSpan(truncate(opts.tool, 200)), inline: true }];
  if (opts.riskTier) fields.push({ name: "Risk", value: escapeMarkdown(truncate(opts.riskTier, 200)), inline: true });
  fields.push({ name: "Approval id", value: codeSpan(opts.id), inline: true });
  if (opts.preview) fields.push({ name: "Preview", value: codeBlock("", truncate(opts.preview, 900)) });
  return {
    embeds: [
      {
        title: "🛡 Approval needed",
        description: escapeMarkdown(truncate(opts.reason, 1800)),
        color: APPROVAL_COLOR,
        fields,
        footer: { text: BOT_FOOTER },
        timestamp: new Date().toISOString(),
      },
    ],
    components: approvalButtons(opts.id, opts.dashboardUrl),
  };
}

/** Full details for the 👀 button: everything the record holds, still with buttons. */
export function approvalDetailsMessage(opts: {
  id: string;
  tool: string;
  reason: string;
  preview?: string;
  dashboardUrl?: string;
  riskTier?: string;
}): DiscordOutgoing {
  const lines = [
    `**🛡 Approval details** · ${codeSpan(opts.id)}`,
    `**Tool:** ${codeSpan(opts.tool)}`,
    opts.riskTier ? `**Risk:** ${escapeMarkdown(opts.riskTier)}` : "",
    `**Reason:** ${escapeMarkdown(truncate(opts.reason, 1500))}`,
  ].filter(Boolean);
  const body = opts.preview ? `\n${codeBlock("", truncate(opts.preview, 1500))}` : "\n_(no preview recorded)_";
  return {
    content: lines.join("\n") + body,
    components: approvalButtons(opts.id, opts.dashboardUrl),
  };
}

/** Text shown on the approval message once it is decided — from any surface. */
export function approvalResolvedText(opts: {
  tool: string;
  outcome: "approved" | "rejected" | "expired";
  surface?: string;
}): string {
  const from = opts.surface && opts.surface !== "discord" ? ` from ${opts.surface}` : "";
  if (opts.outcome === "expired") return `⌛ Expired · ${opts.tool}`;
  if (opts.outcome === "approved") return `✅ Approved${from} · ${opts.tool}`;
  return `❌ Denied${from} · ${opts.tool}`;
}

/** Parse a button custom id: `xr:approve:<approvalId>` and friends. */
export function parseComponentId(customId: string): { decision: "approve" | "deny" | "details"; id: string } | null {
  const m = /^xr:(approve|deny|details):([A-Za-z0-9_-]{1,64})$/.exec(String(customId ?? ""));
  if (!m) return null;
  return { decision: m[1] as "approve" | "deny" | "details", id: m[2] };
}

// ── plain messages ─────────────────────────────────────────────────────────

export function voiceNoteText(transcript: string): string {
  return `🎤 **Voice note:**\n${transcript}`;
}

export function imageNote(name: string, size: string): string {
  return `📷 Image: ${name} (${size})`;
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
  pairedUsers: number;
  channels: number;
  gateway: string;
}): string {
  return [
    `**XR status** · ${escapeMarkdown(opts.project)}`,
    `State: ${opts.paused ? "paused" : opts.busy ? "working" : "idle"}`,
    opts.model ? `Model: ${codeSpan(opts.model)}` : "",
    `Spend: $${opts.costUsd.toFixed(4)} · ${opts.tokens} tokens (total)`,
    `Security: ${Math.round(opts.blockRate * 100)}% block-rate`,
    `Audit chain: ${opts.auditOk ? "intact" : "BROKEN"}`,
    `Access: ${opts.pairedUsers} paired ${opts.pairedUsers === 1 ? "user" : "users"} · ${opts.channels} allowed ${opts.channels === 1 ? "channel" : "channels"}`,
    `Gateway: ${opts.gateway}`,
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
    "**Spend**",
    `Today: $${opts.todayUsd.toFixed(4)}`,
    `This month: $${opts.monthUsd.toFixed(4)}`,
    `This chat: $${opts.spentHere.toFixed(4)}${opts.chatCap != null ? ` of $${opts.chatCap.toFixed(2)} cap` : " (no cap set)"}`,
    `Per-task ceiling here: $${opts.perTask.toFixed(2)}${opts.perTask !== opts.defaultPerTask ? ` (default $${opts.defaultPerTask.toFixed(2)})` : ""}`,
  ].join("\n");
}

/** Help text for Discord. Plain text, no MarkdownV2, honest about being local. */
export function helpText(opts: { mentioned?: boolean; ephemeralHint?: boolean } = {}): string {
  const lines = [
    "**XR — remote control for your computer.**",
    "XR must be running on your computer for the bot to respond.",
    "",
    "**Chat** — send a message in this DM, or mention me in an allowed channel.",
    "`refactor the auth module, keep it under $0.50`",
    "",
    "**Slash commands**",
    "`/xr ask` — ask XR to do something",
    "`/xr budget` — today's spend and this chat's ceiling",
    "`/xr model` — show or switch the model for this chat",
    "`/xr stop` — cancel the running task",
    "`/xr approve` `/xr deny` — answer a pending approval",
    "`/xr status` — bot, spend and security state",
    "`/xr help` — this message",
    "",
    "**Setup**",
    "`/xr pair <code>` — link your Discord account (code from the XR app, in a DM)",
    "`/xr pairchannel <code>` — let XR answer in this channel (channel code from the XR app)",
    "",
    "Risky actions ask for approval with ✅ Approve / ❌ Deny buttons, and the same",
    "approval can be answered from the XR app or Telegram — whichever you reach first.",
  ];
  if (opts.mentioned) lines.push("", "_Tip: in a server, mention me or use a slash command — I stay quiet in channels I was not added to._");
  return lines.join("\n");
}
