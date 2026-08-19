/**
 * XR Phase 11 — content addressing for parse-cache keys.
 *
 * Same idea as memory T9 (`contentHash` of the embedded text): a file whose
 * bytes have not changed is not re-parsed. SHA-256 of file bytes, hex.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256Bytes(buf: Uint8Array | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function hashFile(absolutePath: string): string | null {
  try {
    return sha256Bytes(readFileSync(absolutePath));
  } catch {
    return null;
  }
}

export function symbolId(file: string, name: string, kind: string, startLine: number): string {
  return sha256Bytes(`${file}|${kind}|${name}|${startLine}`).slice(0, 16);
}
