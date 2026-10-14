/**
 * XR — WhatsApp media and voice notes (Phase 26).
 *
 * Same policy as Telegram and Discord, enforced in the same order:
 *   1. size cap from WhatsApp's own metadata, BEFORE any download
 *   2. classify by name + mime: text | pdf | image | unsupported
 *   3. decode; PDFs through the Phase 18 extractor, images noted but not analyzed
 *   4. everything that reaches the model is quarantined as `whatsapp_attachment`
 *
 * WhatsApp delivers media through its own encrypted CDN inside the protocol
 * (a `.enc` blob decrypted with a key in the message), so there is no URL to
 * allow-list — the download closure itself belongs to the message. Nothing here
 * can be pointed at an arbitrary host, which is the same guarantee the Discord
 * host allow-list gives, achieved differently.
 *
 * Long documents are not re-uploaded anywhere; they are read in memory and gone.
 */
import { checkSize, classifyAttachment, extractAttachment, formatBytes } from "../bots/media.ts";
import { transcribeVoiceNote } from "../bots/voice-note.ts";
import type { SpeechToText } from "../voice/stt.ts";
import type { WhatsAppMedia } from "./types.ts";

export interface WhatsAppAttachmentDeps {
  /** Current attachment cap in bytes (config, live). */
  cap: () => number;
  log: (line: string) => void;
  audit: (event: string, detail: Record<string, unknown>) => void;
  /** Speech-to-text; absent means voice notes get the "no model" reply. */
  stt?: Pick<SpeechToText, "describeAsync" | "transcribe">;
}

/**
 * Transcribe one voice note (or audio upload). Returns the transcript, or null
 * when the sender was already told why it could not be used.
 */
export async function handleVoiceNote(
  deps: WhatsAppAttachmentDeps,
  input: {
    userId: string;
    media: WhatsAppMedia;
    send: (content: string) => Promise<unknown>;
    noModelReply: string;
  },
): Promise<string | null> {
  const size = checkSize("voice", input.media.sizeBytes, deps.cap());
  if (!size.ok) {
    await input.send(size.reason);
    return null;
  }
  if (!deps.stt) {
    await input.send(input.noModelReply);
    return null;
  }
  let bytes: Uint8Array;
  try {
    bytes = await input.media.download();
  } catch (err) {
    deps.log(`voice download failed: ${(err as Error).message}`);
    await input.send("I couldn't download that voice note.");
    return null;
  }
  const heard = await transcribeVoiceNote(bytes, { stt: deps.stt, tempPrefix: "xr-whatsapp-voice-" });
  if (!heard.ok) {
    await input.send(heard.reply);
    return null;
  }
  deps.audit("whatsapp.voice", { userId: input.userId, chars: heard.text.length });
  return heard.text;
}

/**
 * Turn the non-audio media on one message into model-ready blocks. Unusable
 * files produce a note instead, so the sender is never left guessing.
 */
export async function collectMediaBlocks(
  deps: WhatsAppAttachmentDeps,
  userId: string,
  media: readonly WhatsAppMedia[],
): Promise<{ blocks: string[]; notes: string[] }> {
  const blocks: string[] = [];
  const notes: string[] = [];
  for (const item of media.slice(0, 4)) {
    if (item.kind === "audio") continue; // handled by the voice path
    const name = item.fileName ?? (item.kind === "image" ? "photo.jpg" : "document");
    const kind = classifyAttachment(name, item.mime);
    if (kind === "unsupported") {
      notes.push(`I can't use ${name}. Send text, code, PDF, or an image.`);
      continue;
    }
    const size = checkSize(kind === "image" ? "photo" : "document", item.sizeBytes, deps.cap());
    if (!size.ok) {
      notes.push(size.reason);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await item.download();
    } catch (err) {
      deps.log(`attachment download failed: ${(err as Error).message}`);
      notes.push(`I couldn't download ${name}.`);
      continue;
    }
    // A4: the protocol download is opaque (no stream to cap), so the bytes
    // in hand are re-checked against the live cap — metadata can lie.
    if (bytes.length > deps.cap()) {
      notes.push(`That file is ${(bytes.length / 1048576).toFixed(1)} MB; the limit here is ${(deps.cap() / 1048576).toFixed(1)} MB.`);
      continue;
    }
    const res = await extractAttachment({ name, mime: item.mime, bytes, quarantineKind: "whatsapp_attachment" });
    if (res.ok && res.block) blocks.push(res.block);
    else if (res.note) notes.push(res.note);
    deps.audit("whatsapp.attachment", { userId, bytes: bytes.byteLength, ok: res.ok, kind });
  }
  return { blocks, notes };
}

/** Names WhatsApp media in one line, for the notes list. */
export function mediaSummary(media: readonly WhatsAppMedia[]): string[] {
  return media.map((m) => (m.kind === "image" ? `📷 ${m.fileName ?? "photo"} (${formatBytes(m.sizeBytes)})` : `📎 ${m.fileName ?? "file"} (${formatBytes(m.sizeBytes)})`));
}
