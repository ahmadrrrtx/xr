/**
 * XR Phase 9 — SHA256SUMS shared helpers (one parser for the release gates,
 * channel stamping, installers and tests — a second parser would be a defect).
 *
 * Format (sha256sum): `<64-hex>  <filename>` per line; binary markers
 * (`*file`) and `./` prefixes tolerated on load, emitted normalized.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function parse(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && /^[0-9a-f]{64}$/i.test(parts[0]!)) {
      const name = parts[1]!.replace(/^\*/, "").replace(/^\.\//, "");
      m.set(name, parts[0]!.toLowerCase());
    }
  }
  return m;
}

export function serialize(sums: Map<string, string>): string {
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, sha]) => `${sha}  ${name}`)
    .join("\n") + "\n";
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Verify a file against a sums map. Fails closed: unknown name → false. */
export function verifyFile(sums: Map<string, string>, file: string, name?: string): boolean {
  const key = name ?? file.split(/[\\/]/).pop()!;
  const expected = sums.get(key) ?? sums.get(`./${key}`);
  if (!expected) return false;
  return sha256File(file) === expected;
}
