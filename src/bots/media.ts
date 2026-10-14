/**
 * XR — shared attachment policy for chat surfaces (Phase 26 shared layer).
 *
 * Telegram, Discord and WhatsApp all receive files from the same humans on the
 * same machine, so the *policy* is identical:
 *   1. size cap from platform metadata, BEFORE any download
 *   2. classify by name + mime: text | pdf | image | unsupported
 *   3. decode: text is capped and binary-sniffed, PDF goes through the Phase 18
 *      extractor, images are only noted (no vision analysis in P26)
 *   4. everything that reaches the model is quarantined via wrapUntrusted
 *
 * Only the quarantine tag differs per surface (`telegram_attachment`,
 * `discord_attachment`, `whatsapp_attachment`), because the injected-context
 * header names the channel the untrusted bytes came from.
 *
 * Extracted from `telegram/attachments.ts` in PR 2; that file is now a thin
 * wrapper so the Phase 24 tests keep exercising the same behavior.
 */
import { wrapUntrusted } from "../context/injection.ts";
import { extractPdfText } from "../research/pdf-text.ts";
import {
  extensionBlocked,
  looksLikeExecutableScript,
  sanitizeFileLabel,
  validateAttachmentBytes,
} from "./attachment-guard.ts";

export {
  BLOCKED_EXTENSIONS,
  CappedByteSink,
  CapExceededError,
  MAX_ATTACHMENT_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  extensionBlocked,
  randomTempFileName,
  sanitizeFileLabel,
  sniffKind,
} from "./attachment-guard.ts";

export const DOCUMENT_CAP_BYTES = 5 * 1024 * 1024;
export const PHOTO_CAP_BYTES = 2 * 1024 * 1024;
/** Voice notes and audio uploads. Above this, ask the sender for a text summary. */
export const AUDIO_CAP_BYTES = 10 * 1024 * 1024;
export const TEXT_CAP_CHARS = 30 * 1024;

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "xml", "html", "css",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cc", "cpp",
  "hpp", "cs", "php", "sh", "bash", "zsh", "sql", "log", "gradle", "dockerfile", "makefile", "vue", "svelte",
]);

export type AttachmentKind = "text" | "pdf" | "image" | "unsupported";

/** Source extensions whose contents are expected to be code (A4 scan exemption). */
const CODE_EXT = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "h", "cc", "cpp", "hpp", "cs", "php", "sql", "vue", "svelte", "gradle",
]);

/** What the platform metadata calls the file, which decides the cap. */
export type AttachmentSizeKind = "document" | "photo" | "voice" | "audio" | "image";

export function classifyAttachment(name: string, mime?: string): AttachmentKind {
  const lower = (name || "").toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop()! : lower;
  const m = (mime ?? "").toLowerCase();
  // A4: executable/installer/script extensions are refused up front, before
  // any download, whatever the declared MIME says.
  if (extensionBlocked(lower)) return "unsupported";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("image/") && !m.includes("svg")) return "image";
  if (m.startsWith("text/") || m === "application/json" || TEXT_EXT.has(ext)) return "text";
  return "unsupported";
}

/**
 * Check the platform's reported size against the cap — before the download.
 *
 * `audioCeiling` lets a surface keep its own audio policy: Telegram passes
 * Infinity (its voice cap is the general attachment limit, unchanged since
 * Phase 24), while Discord and WhatsApp use the shared 10 MB audio ceiling.
 */
export function checkSize(
  kind: AttachmentSizeKind,
  sizeBytes: number | undefined,
  maxAttachmentBytes: number,
  audioCeiling: number = AUDIO_CAP_BYTES,
): { ok: true } | { ok: false; reason: string } {
  const cap =
    kind === "photo" || kind === "image"
      ? Math.min(PHOTO_CAP_BYTES, maxAttachmentBytes)
      : kind === "voice" || kind === "audio"
        ? Math.min(audioCeiling, maxAttachmentBytes)
        : maxAttachmentBytes;
  if (sizeBytes != null && sizeBytes > cap) {
    return {
      ok: false,
      reason: `That ${kind} is ${(sizeBytes / 1048576).toFixed(1)} MB; the limit here is ${(cap / 1048576).toFixed(1)} MB.`,
    };
  }
  return { ok: true };
}

/** Decode text bytes. Rejects binaries (NUL bytes in the first 8 KB). */
export function decodeText(bytes: Uint8Array): { ok: true; text: string; truncated: boolean } | { ok: false } {
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return { ok: false };
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const truncated = text.length > TEXT_CAP_CHARS;
  return { ok: true, text: truncated ? text.slice(0, TEXT_CAP_CHARS) : text, truncated };
}

export interface ExtractedAttachment {
  ok: boolean;
  /** Model-ready, quarantined block (present when ok). */
  block?: string;
  /** Short user-facing note (present when not ok). */
  note?: string;
}

/**
 * Turn downloaded bytes into a model-ready block, or a user-facing reason.
 * Images are never analyzed: the model receives only the name, type and size.
 * The caller supplies the quarantine tag for its surface.
 */
export async function extractAttachment(input: {
  name: string;
  mime?: string;
  bytes: Uint8Array;
  /** wrapUntrusted kind tag, e.g. "discord_attachment". */
  quarantineKind: string;
}): Promise<ExtractedAttachment> {
  const kind = classifyAttachment(input.name, input.mime);
  const label = `attachment ${sanitizeFileLabel(input.name)}`;
  // A4: the downloaded bytes get the final say — magic-byte sniffing, the
  // executable blocklist and the actual byte count override filename/MIME.
  if (kind !== "unsupported") {
    const verdict = validateAttachmentBytes({ name: input.name, kind, bytes: input.bytes });
    if (!verdict.ok) return { ok: false, note: verdict.reason };
  }
  if (kind === "image") {
    return {
      ok: true,
      block: wrapUntrusted(
        `Image attached (${input.mime ?? "image"}, ${input.bytes.byteLength} bytes). Image contents are not analyzed in this channel.`,
        { kind: input.quarantineKind, label },
      ),
    };
  }
  if (kind === "pdf") {
    try {
      const res = await extractPdfText(input.bytes);
      if (!res.text.trim()) return { ok: false, note: "I could not read text from that PDF (it may be scanned images)." };
      return { ok: true, block: wrapUntrusted(res.text, { kind: input.quarantineKind, label }, TEXT_CAP_CHARS) };
    } catch {
      return { ok: false, note: "I could not read that PDF." };
    }
  }
  if (kind === "text") {
    const dec = decodeText(input.bytes);
    if (!dec.ok) return { ok: false, note: "That file looks binary, so I can't use it as text." };
    // A4: a runnable script smuggled in under a document name is refused;
    // genuine code files (known source extensions) stay welcome as data.
    const ext = (input.name || "").toLowerCase().split(".").pop() ?? "";
    if (!CODE_EXT.has(ext) && looksLikeExecutableScript(dec.text)) {
      return { ok: false, note: "That file looks like a script, so I can't accept it as a document." };
    }
    const suffix = dec.truncated ? "\n[truncated to 30 KB]" : "";
    return { ok: true, block: wrapUntrusted(dec.text + suffix, { kind: input.quarantineKind, label }, TEXT_CAP_CHARS + 64) };
  }
  return { ok: false, note: "I can't use that file type. Send text, code, PDF, or an image." };
}

/** Human-readable size for attachment notes ("1.2 MB", "840 KB"). */
export function formatBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
