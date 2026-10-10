/**
 * XR — Telegram attachment policy (pure, testable; no network here).
 *
 * Order of checks, enforced in bot.ts:
 *   1. size cap from Telegram's own metadata, BEFORE any download
 *   2. classify by name + mime: text | pdf | image | unsupported
 *   3. decode: text is capped and binary-sniffed, PDF goes through the
 *      Phase 18 extractor, images are only noted (no vision analysis)
 *   4. everything that reaches the model is quarantined via wrapUntrusted
 */
import { wrapUntrusted } from "../context/injection.ts";
import { extractPdfText } from "../research/pdf-text.ts";

export const DOCUMENT_CAP_BYTES = 5 * 1024 * 1024;
export const PHOTO_CAP_BYTES = 2 * 1024 * 1024;
export const TEXT_CAP_CHARS = 30 * 1024;

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "xml", "html", "css",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cc", "cpp",
  "hpp", "cs", "php", "sh", "bash", "zsh", "sql", "log", "gradle", "dockerfile", "makefile", "vue", "svelte",
]);

export type AttachmentKind = "text" | "pdf" | "image" | "unsupported";

export function classifyAttachment(name: string, mime?: string): AttachmentKind {
  const lower = (name || "").toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop()! : lower;
  const m = (mime ?? "").toLowerCase();
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("image/") && !m.includes("svg")) return "image";
  if (m.startsWith("text/") || m === "application/json" || TEXT_EXT.has(ext)) return "text";
  return "unsupported";
}

/** Check Telegram's reported size against the cap. Runs before download. */
export function checkSize(
  kind: "document" | "photo" | "voice",
  sizeBytes: number | undefined,
  maxAttachmentBytes: number,
): { ok: true } | { ok: false; reason: string } {
  const cap = kind === "photo" ? Math.min(PHOTO_CAP_BYTES, maxAttachmentBytes) : maxAttachmentBytes;
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
 */
export async function extractAttachment(input: {
  name: string;
  mime?: string;
  bytes: Uint8Array;
}): Promise<ExtractedAttachment> {
  const kind = classifyAttachment(input.name, input.mime);
  const label = `attachment ${input.name}`;
  if (kind === "image") {
    return {
      ok: true,
      block: wrapUntrusted(
        `Image attached (${input.mime ?? "image"}, ${input.bytes.byteLength} bytes). Image contents are not analyzed in this channel.`,
        { kind: "telegram_attachment", label },
      ),
    };
  }
  if (kind === "pdf") {
    try {
      const res = await extractPdfText(input.bytes);
      if (!res.text.trim()) return { ok: false, note: "I could not read text from that PDF (it may be scanned images)." };
      return { ok: true, block: wrapUntrusted(res.text, { kind: "telegram_attachment", label }, TEXT_CAP_CHARS) };
    } catch {
      return { ok: false, note: "I could not read that PDF." };
    }
  }
  if (kind === "text") {
    const dec = decodeText(input.bytes);
    if (!dec.ok) return { ok: false, note: "That file looks binary, so I can't use it as text." };
    const suffix = dec.truncated ? "\n[truncated to 30 KB]" : "";
    return { ok: true, block: wrapUntrusted(dec.text + suffix, { kind: "telegram_attachment", label }, TEXT_CAP_CHARS + 64) };
  }
  return { ok: false, note: "I can't use that file type. Send text, code, PDF, or an image." };
}
