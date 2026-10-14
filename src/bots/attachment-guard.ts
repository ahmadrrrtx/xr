/**
 * XR Phase 31 · Bucket A (A4) — attachment / upload validation, shared by
 * the Telegram, Discord and WhatsApp adapters (wired in src/bots/media.ts
 * so every channel inherits it identically).
 *
 * Filename and declared-MIME checks alone are trivially spoofed, so this
 * guard layers, in order:
 *   1. hard extension blocklist — executables/installers/scripts never pass,
 *      whatever the sender claims the file is;
 *   2. magic-byte sniffing of the first 512 bytes — executables (`MZ`, ELF,
 *      Mach-O) and ZIP containers (the JAR/APK container shape) are rejected
 *      even behind a harmless name like `notes.txt`, and a sniffed binary
 *      type that contradicts the classified kind is refused;
 *   3. content scan for text candidates — a shell/PowerShell/batch script
 *      renamed to `.txt` is still a script;
 *   4. size caps on the bytes actually in hand — adapters stream downloads
 *      through `CappedByteSink`, so an oversized transfer aborts mid-stream
 *      instead of relying on the sender's declared size;
 *   5. safe random temp names — anything written to disk uses
 *      `randomTempFileName`; the sender's name survives only as sanitized
 *      display metadata (`sanitizeFileLabel`).
 */
import { randomBytes } from "node:crypto";
import { extname } from "node:path";

/** A4 size ceilings for extracted attachments (bytes). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_ATTACHMENT_BYTES = MAX_DOCUMENT_BYTES;

/** Executable / installer / script extensions that never pass (A4). */
export const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".exe", ".dll", ".so", ".dylib", ".com", ".scr", ".sys", ".drv", ".ocx",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".psm1", ".bat", ".cmd", ".vbs",
  ".vbe", ".js", ".jse", ".wsf", ".wsh", ".cpl", ".hta", ".ins", ".isp",
  ".jar", ".apk", ".aab", ".msi", ".msp", ".app", ".deb", ".rpm", ".dmg",
  ".pkg", ".run", ".bin", ".elf", ".class", ".pyc",
  ".reg", ".scf", ".lnk", ".inf", ".gadget",
]);

// Source-code extensions (.js/.ts/.py/.rb/.php/…) are deliberately NOT in
// the blocklist: sharing code with the bot is a documented feature, the
// bytes are only ever read as quarantined text, and the script-payload
// scan below refuses runnable payloads smuggled in as documents.

export function extensionBlocked(filename: string): boolean {
  return BLOCKED_EXTENSIONS.has(extname(filename || "").toLowerCase());
}

export type SniffedKind =
  | "exe" | "elf" | "mach-o" | "zip" | "pdf" | "png" | "jpeg" | "gif"
  | "webp" | "mp3" | "ogg" | "wav" | "mp4" | "text" | "unknown";

/** Sniff the first bytes of a buffer (callers pass up to the first 512). */
export function sniffKind(bytes: Uint8Array): SniffedKind {
  const b = bytes;
  const at = (i: number) => b[i] ?? -1;
  const ascii = (from: number, to: number) => {
    let s = "";
    for (let i = from; i < to && i < b.length; i++) s += String.fromCharCode(b[i]!);
    return s;
  };
  if (b.length >= 2 && at(0) === 0x4d && at(1) === 0x5a) return "exe"; // "MZ"
  if (b.length >= 4 && at(0) === 0x7f && ascii(1, 4) === "ELF") return "elf";
  if (
    b.length >= 4 &&
    ((at(0) === 0xfe && at(1) === 0xed && at(2) === 0xfa && (at(3) === 0xce || at(3) === 0xcf)) ||
      (at(0) === 0xcf && at(1) === 0xfa && at(2) === 0xed && at(3) === 0xfe) ||
      (at(0) === 0xce && at(1) === 0xfa && at(2) === 0xed && at(3) === 0xfe) ||
      (at(0) === 0xca && at(1) === 0xfe && at(2) === 0xba && at(3) === 0xbe))
  ) return "mach-o";
  if (b.length >= 4 && at(0) === 0x50 && at(1) === 0x4b && at(2) === 0x03 && at(3) === 0x04) return "zip"; // PK\x03\x04 (jar/apk/docx…)
  if (b.length >= 5 && ascii(0, 5) === "%PDF-") return "pdf";
  if (b.length >= 8 && at(0) === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (b.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "gif";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (b.length >= 4 && ascii(0, 4) === "OggS") return "ogg";
  if (b.length >= 3 && ascii(0, 3) === "ID3") return "mp3";
  if (b.length >= 8 && ascii(4, 8) === "ftyp") return "mp4";
  // Plain text last: tiny ASCII fixtures (and genuine .txt/.csv uploads)
  // carry no magic and must not be misread as anything else.
  let printable = b.length > 0;
  for (let i = 0; i < Math.min(b.length, 512); i++) {
    const c = b[i]!;
    if (c === 0 || c < 0x09 || (c > 0x0d && c < 0x20)) { printable = false; break; }
  }
  if (printable) return "text";
  if (b.length >= 2 && at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return "mp3"; // MPEG frame sync
  return "unknown";
}

/** Sniffed kinds that are executables/containers and never accepted. */
export const EXECUTABLE_SNIFFS: ReadonlySet<SniffedKind> = new Set(["exe", "elf", "mach-o", "zip"]);

const IMAGE_SNIFFS: ReadonlySet<SniffedKind> = new Set(["png", "jpeg", "gif", "webp"]);

/**
 * Executable-content detection for text candidates. Text extensions remain
 * welcome (code files included — they are data for the model, quarantined
 * like everything else); what is refused is a runnable script payload
 * (interpreter shebang, batch/PowerShell bodies) smuggled in as a document.
 */
export function looksLikeExecutableScript(text: string): boolean {
  const head = text.slice(0, 4096);
  if (head.startsWith("#!")) return true; // #!/bin/sh, #!/usr/bin/env python, …
  if (/^\s*@echo\s+off/i.test(head)) return true; // batch
  if (/^\s*(powershell|pwsh)\s+(-|\/)/im.test(head)) return true;
  if (/\bInvoke-Expression\b|\bIEX\s*\(|\bStart-Process\s+/.test(head)) return true; // PowerShell
  if (/^\s*(rm\s+-rf|curl\s+[^|\n]*\|\s*(sh|bash)|wget\s+[^|\n]*\|\s*(sh|bash)|chmod\s+\+x|sudo\s+)/m.test(head)) {
    return true; // classic shell one-liner payloads
  }
  return false;
}

export type GuardedKind = "text" | "pdf" | "image" | "unsupported";

export function capForKind(kind: GuardedKind): number {
  return kind === "image" ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
}

export type AttachmentVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Validate downloaded bytes against their classified kind. `kind` comes
 * from classifyAttachment (name + declared MIME); the bytes get the final
 * say. Never throws.
 */
export function validateAttachmentBytes(input: {
  name: string;
  kind: GuardedKind;
  bytes: Uint8Array;
}): AttachmentVerdict {
  const { name, kind, bytes } = input;
  if (extensionBlocked(name)) {
    return { ok: false, reason: `That file type is blocked (${extname(name).toLowerCase()} files are not accepted).` };
  }
  if (bytes.length > capForKind(kind)) {
    return {
      ok: false,
      reason: `That file is ${(bytes.length / 1048576).toFixed(1)} MB; the limit here is ${Math.round(capForKind(kind) / 1048576)} MB.`,
    };
  }
  const sniffed = sniffKind(bytes.subarray(0, 512));
  if (EXECUTABLE_SNIFFS.has(sniffed)) {
    return { ok: false, reason: "That file looks like an executable or archive, so I can't accept it." };
  }
  if (kind === "image") {
    // A known binary type that is not an image contradicts the claim.
    if (sniffed !== "unknown" && sniffed !== "text" && !IMAGE_SNIFFS.has(sniffed)) {
      return { ok: false, reason: "That file's contents don't match an image, so I can't accept it." };
    }
  } else if (kind === "pdf") {
    if (sniffed !== "pdf" && sniffed !== "unknown" && sniffed !== "text") {
      return { ok: false, reason: "That file's contents don't match a PDF, so I can't accept it." };
    }
  } else if (kind === "text") {
    if (sniffed !== "text" && sniffed !== "unknown") {
      return { ok: false, reason: "That file looks binary, so I can't use it as text." };
    }
  }
  return { ok: true };
}

/**
 * Streaming size cap: callers pipe downloads into this sink; `write` throws
 * `CapExceededError` the moment the running total passes `cap`, so an
 * oversized transfer is aborted while streaming, not after it lands.
 */
export class CapExceededError extends Error {
  constructor(cap: number) {
    super(`attachment exceeds the ${Math.round(cap / (1024 * 1024))} MB size limit`);
    this.name = "CapExceededError";
  }
}

export class CappedByteSink {
  #chunks: Uint8Array[] = [];
  #total = 0;
  constructor(readonly cap: number = MAX_ATTACHMENT_BYTES) {}
  get size(): number {
    return this.#total;
  }
  write(chunk: Uint8Array): void {
    this.#total += chunk.length;
    if (this.#total > this.cap) throw new CapExceededError(this.cap);
    this.#chunks.push(chunk);
  }
  /** Consume a web ReadableStream, aborting (cancelling) past the cap. */
  async consume(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) this.write(value);
      }
    } catch (e) {
      try { await reader.cancel(); } catch { /* already closed */ }
      throw e;
    } finally {
      reader.releaseLock();
    }
    return this.concat();
  }
  concat(): Uint8Array {
    const out = new Uint8Array(this.#total);
    let off = 0;
    for (const ch of this.#chunks) { out.set(ch, off); off += ch.length; }
    return out;
  }
}

/** Safe on-disk name: 16 random hex chars + a sanitized bare extension. */
export function randomTempFileName(originalName: string): string {
  const ext = extname(originalName || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
  return `${randomBytes(8).toString("hex")}${ext}`;
}

/** Sanitize a sender-supplied filename for METADATA display only. */
export function sanitizeFileLabel(name: string): string {
  return (name || "file").replace(/[^\w. -]+/g, "_").slice(0, 120) || "file";
}
