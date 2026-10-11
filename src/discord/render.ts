/**
 * XR — Discord rendering (Phase 26).
 *
 * Discord-native markdown only (no MarkdownV2). Long answers are split at
 * 2000 characters with a continuation marker; a code fence that spans a split
 * is closed and reopened so every chunk renders on its own. Approval cards are
 * an embed with an action row of buttons, and each custom id carries only the
 * approval-store id, which is not secret.
 */
import { ButtonStyle, ComponentType, DISCORD_MAX_CHARS, EMBED_DESCRIPTION_MAX, EMBED_FIELD_MAX, type DiscordOutgoing } from "./types.ts";

export const CONTINUED_MARK = "\n…(continued)";
/** Approval embed accent (cyan, the XR sentinel colour). */
export const APPROVAL_COLOR = 0x00e5ff;

/** Split text into Discord-sized chunks. Every chunk is at most `max` characters. */
export function splitForDiscord(raw: string, max = DISCORD_MAX_CHARS): string[] {
  if (raw.length <= max) return [raw];
  const budget = max - CONTINUED_MARK.length - 4; // room for a closing fence
  const out: string[] = [];
  let rest = raw;
  while (rest.length > max) {
    const cut = cutPoint(rest, budget);
    let piece = rest.slice(0, cut);
    rest = rest.slice(cut).replace(/^\n+/, "");
    const fenceOpen = (piece.match(/```/g) ?? []).length % 2 === 1;
    if (fenceOpen) {
      piece += "\n```";
      rest = "```\n" + rest;
    }
    out.push(piece + CONTINUED_MARK);
  }
  out.push(rest);
  return out;
}

/** Prefer a paragraph, then a line, then a word boundary; never cut past `limit`. */
function cutPoint(s: string, limit: number): number {
  const floor = Math.floor(limit / 2);
  const para = s.lastIndexOf("\n\n", limit);
  if (para >= floor) return para;
  const line = s.lastIndexOf("\n", limit);
  if (line >= floor) return line;
  const space = s.lastIndexOf(" ", limit);
  if (space >= floor) return space;
  return limit;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** Keep preview text from closing or opening a code fence inside an embed. */
function fenceSafe(s: string): string {
  return s.replace(/```/g, "'''");
}

function button(style: number, label: string, customId: string) {
  return { type: ComponentType.BUTTON, style, label, custom_id: customId };
}

export interface ApprovalCardInput {
  id: string;
  tool: string;
  reason: string;
  preview?: string;
  riskTier: string;
}

/** The approval card: an embed plus Approve, Deny and View details buttons. */
export function approvalCard(p: ApprovalCardInput): DiscordOutgoing {
  const preview = p.preview ? `\n\`\`\`\n${fenceSafe(truncate(p.preview, 1200))}\n\`\`\`` : "";
  const description = truncate(`${p.reason}${preview}`, EMBED_DESCRIPTION_MAX);
  return {
    embeds: [
      {
        title: "🛡️ Approval needed",
        description,
        color: APPROVAL_COLOR,
        fields: [
          { name: "Tool", value: truncate(p.tool || "(tool)", EMBED_FIELD_MAX), inline: true },
          { name: "Risk", value: truncate(p.riskTier || "standard", EMBED_FIELD_MAX), inline: true },
        ],
        footer: { text: "XR · running on your machine" },
      },
    ],
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [
          button(ButtonStyle.SUCCESS, "Approve", `xr:approve:${p.id}`),
          button(ButtonStyle.DANGER, "Deny", `xr:deny:${p.id}`),
          button(ButtonStyle.SECONDARY, "View details", `xr:view:${p.id}`),
        ],
      },
    ],
  };
}

/** Full detail for the View details button. Sent ephemerally on interactions. */
export function approvalDetails(p: { id: string; tool: string; reason: string; preview?: string }): string {
  const lines = [`**Approval details** · \`${p.tool}\``, p.reason];
  if (p.preview) lines.push("```", fenceSafe(truncate(p.preview, 1500)), "```");
  lines.push(`Approve with the buttons on the approval message, or \`/xr approve ${p.id}\`.`);
  return truncate(lines.join("\n"), DISCORD_MAX_CHARS);
}

export function approvalResolvedText(opts: { tool: string; outcome: "approved" | "rejected" | "expired"; surface?: string }): string {
  const from = opts.surface ? ` from ${opts.surface}` : "";
  switch (opts.outcome) {
    case "approved":
      return `✅ Approved${from} · ${opts.tool}`;
    case "rejected":
      return `❌ Denied${from} · ${opts.tool}`;
    case "expired":
      return `⌛ Expired · ${opts.tool}`;
  }
}

/** Reply text with an optional reference to the message being answered. */
export function plainText(content: string, replyTo?: string): DiscordOutgoing {
  return replyTo ? { content, replyTo } : { content };
}
