/**
 * XR — Discord attachments and voice notes (Phase 26).
 *
 * Extracted from `discord/bot.ts` so the bot module stays readable and under
 * the module-size gate. Everything here is one-directional: bytes in, model
 * blocks or a user-facing reason out.
 *
 * Two rules the brief states and this file enforces:
 *   · the size cap is checked from Discord's metadata BEFORE any download
 *   · a download only ever comes from Discord's own CDN hosts — an attachment
 *     URL pointing anywhere else is refused (a webhook from another server
 *     must not become an SSRF primitive)
 *
 * Quarantine tags name this surface (`discord_attachment`, `discord_reply_context`),
 * so untrusted bytes are labelled with the channel they arrived on.
 */
import { checkSize, classifyAttachment, extractAttachment } from "../bots/media.ts";
import { transcribeVoiceNote } from "../bots/voice-note.ts";
import type { SpeechToText } from "../voice/stt.ts";
import type { DiscordAttachment } from "./types.ts";

/** Hosts XR will download an attachment from. Nothing else, ever. */
const ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
const VOICE_EXT = /\.(ogg|oga|opus|mp3|m4a|wav|webm)$/i;

export interface AttachmentDeps {
  fetchFn: typeof fetch;
  /** Current attachment cap in bytes (config, live). */
  cap: () => number;
  log: (line: string) => void;
  audit: (event: string, detail: Record<string, unknown>) => void;
  /** Speech-to-text; absent means voice notes get the "no model" reply. */
  stt?: Pick<SpeechToText, "describeAsync" | "transcribe">;
}

/** Is this attachment a voice note (or plain audio)? */
export function isVoiceNote(a: { content_type?: string; filename?: string }): boolean {
  const mime = String(a.content_type ?? "").toLowerCase();
  if (mime.startsWith("audio/")) return true;
  return VOICE_EXT.test(String(a.filename ?? ""));
}

/** Download an attachment, but only from Discord's own CDN hosts. */
export async function downloadAttachment(deps: AttachmentDeps, url: string): Promise<Uint8Array | null> {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  if (!ATTACHMENT_HOSTS.has(host)) {
    deps.log(`refused attachment from ${host}`);
    return null;
  }
  const res = await deps.fetchFn(url).catch(() => null);
  if (!res?.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Transcribe one voice note. Returns the transcript, or null when the user was
 * already told why it could not be used.
 */
export async function handleVoiceNote(
  deps: AttachmentDeps,
  input: {
    userId: string;
    attachment: DiscordAttachment;
    send: (content: string) => Promise<unknown>;
    noModelReply: string;
  },
): Promise<string | null> {
  const att = input.attachment;
  const size = checkSize("voice", att.size, deps.cap());
  if (!size.ok) {
    await input.send(size.reason);
    return null;
  }
  if (!deps.stt) {
    await input.send(input.noModelReply);
    return null;
  }
  const bytes = await downloadAttachment(deps, att.url);
  if (!bytes) {
    await input.send("I couldn't download that voice note.");
    return null;
  }
  const heard = await transcribeVoiceNote(bytes, { stt: deps.stt, tempPrefix: "xr-discord-voice-" });
  if (!heard.ok) {
    await input.send(heard.reply);
    return null;
  }
  deps.audit("discord.voice", { userId: input.userId, chars: heard.text.length });
  return heard.text;
}

/**
 * Turn the non-audio attachments on one message into model-ready blocks.
 * Unusable files produce a note instead, so the user is never left guessing.
 */
export async function collectAttachmentBlocks(
  deps: AttachmentDeps,
  userId: string,
  attachments: DiscordAttachment[],
): Promise<{ blocks: string[]; notes: string[] }> {
  const blocks: string[] = [];
  const notes: string[] = [];
  for (const att of attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
    const name = String(att.filename ?? "file");
    const mime = att.content_type;
    const kind = classifyAttachment(name, mime);
    if (kind === "unsupported") {
      notes.push(`I can't use ${name}. Send text, code, PDF, or an image.`);
      continue;
    }
    const size = checkSize(kind === "image" ? "photo" : "document", att.size, deps.cap());
    if (!size.ok) {
      notes.push(size.reason);
      continue;
    }
    const bytes = await downloadAttachment(deps, att.url);
    if (!bytes) {
      notes.push(`I couldn't download ${name}.`);
      continue;
    }
    const res = await extractAttachment({ name, mime, bytes, quarantineKind: "discord_attachment" });
    if (res.ok && res.block) blocks.push(res.block);
    else if (res.note) notes.push(res.note);
    deps.audit("discord.attachment", { userId, bytes: bytes.byteLength, ok: res.ok, kind });
  }
  return { blocks, notes };
}
