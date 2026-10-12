/**
 * XR — Telegram attachment policy.
 *
 * The policy itself moved to the shared chat runtime (src/bots/media.ts) in
 * Phase 26 · PR 2, because Discord and WhatsApp face the same caps and the same
 * untrusted-bytes rules. This module keeps the Phase 24 surface API:
 *
 *   · the quarantine tag stays `telegram_attachment`
 *   · the audio ceiling stays Infinity, so a raised `telegram.maxAttachmentBytes`
 *     lifts the voice cap exactly as it did before (the shared default for new
 *     surfaces is 10 MB, but Telegram's behavior is not changed here).
 */
import { extractAttachment as extractShared, checkSize as checkSizeShared } from "../bots/media.ts";

export {
  DOCUMENT_CAP_BYTES,
  PHOTO_CAP_BYTES,
  TEXT_CAP_CHARS,
  classifyAttachment,
  decodeText,
} from "../bots/media.ts";
export type { AttachmentKind } from "../bots/media.ts";

import type { AttachmentSizeKind, ExtractedAttachment } from "../bots/media.ts";

/** Check Telegram's reported size against the cap. Runs before download. */
export function checkSize(
  kind: Exclude<AttachmentSizeKind, "audio" | "image">,
  sizeBytes: number | undefined,
  maxAttachmentBytes: number,
): { ok: true } | { ok: false; reason: string } {
  return checkSizeShared(kind, sizeBytes, maxAttachmentBytes, Infinity);
}

/** Turn downloaded bytes into a model-ready Telegram block, or a reason. */
export function extractAttachment(input: {
  name: string;
  mime?: string;
  bytes: Uint8Array;
}): Promise<ExtractedAttachment> {
  return extractShared({ ...input, quarantineKind: "telegram_attachment" });
}
