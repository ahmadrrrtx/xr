#!/usr/bin/env bun
/**
 * XR Phase 3 — write SHA256SUMS without the `sha256sum` binary.
 *
 * macOS and Windows GitHub runners do not ship GNU coreutils `sha256sum`.
 * Nightly beta-install and the release assemble step both need a portable
 * writer that emits the same `<64-hex>  <filename>` format `scripts/sums.ts`
 * already parses.
 *
 * Usage:
 *   bun run scripts/write-sums.ts <dir>
 *   bun run scripts/write-sums.ts <dir> --print
 *   bun run scripts/write-sums.ts <dir> --print-with-manifest
 *
 * `--print-with-manifest` also hashes SHA256SUMS itself (SLSA subjects).
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serialize, sha256File } from "./sums.ts";

const SKIP = new Set(["SHA256SUMS", "SHA256SUMS.bundle"]);

export function writeSums(dir: string): Map<string, string> {
  const abs = resolve(dir);
  const sums = new Map<string, string>();
  for (const name of readdirSync(abs)) {
    if (SKIP.has(name) || name.endsWith(".bundle")) continue;
    const p = join(abs, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    sums.set(name, sha256File(p));
  }
  writeFileSync(join(abs, "SHA256SUMS"), serialize(sums));
  return sums;
}

/** SHA256SUMS body plus a trailing line hashing the manifest itself. */
export function subjectsIncludingManifest(dir: string): string {
  const sums = writeSums(dir);
  const manifest = join(resolve(dir), "SHA256SUMS");
  const body = serialize(sums).replace(/\n$/, "");
  return `${body}\n${sha256File(manifest)}  SHA256SUMS\n`;
}

if (import.meta.main) {
  const flags = new Set(process.argv.filter((a) => a.startsWith("--")));
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? ".";
  if (flags.has("--print-with-manifest")) {
    process.stdout.write(subjectsIncludingManifest(dir));
  } else {
    const sums = writeSums(dir);
    if (flags.has("--print")) process.stdout.write(serialize(sums));
    else console.log(`wrote ${join(resolve(dir), "SHA256SUMS")} (${sums.size} files)`);
  }
}
