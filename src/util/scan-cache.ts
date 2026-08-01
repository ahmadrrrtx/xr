/**
 * XR Phase 3 · T4 — Content-addressed incremental scan cache.
 *
 * Makes warm scans near-O(changed): the first scan of a directory tree does
 * the full work and stores the parsed payload keyed by a Merkle-style
 * fingerprint; later scans only stat the tree (name + size + mtime per
 * entry, hashed together) and compare against the stored fingerprint.
 * Unchanged trees return the cached payload without re-reading any file
 * content — warm startup no longer pays the per-file parse cost.
 *
 * Correctness contract:
 *   - The fingerprint covers every directory entry (relative path, size,
 *     mtimeMs) PLUS any state files the scan result depends on (callers must
 *     list them in `files`, e.g. $XR_HOME/skills/registry.json). If any
 *     entry or state file changes, the cache misses and the full scan runs.
 *   - The cache is a performance mirror, never an authority: the slow path
 *     re-reads the real files, so the cache cannot change scan semantics.
 *   - Known limitation (documented in docs/perf/PERF-BUDGETS.md): an entry
 *     modified to the same size AND same mtime would not invalidate (the
 *     standard mtime-based fingerprint tradeoff, same as git/cargo indexes).
 *
 * The boot-path API is synchronous (callers such as the skill registry are
 * synchronous); the HIT path performs no file-content reads. Cache writes
 * are best-effort — a read-only home must never break startup.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { XR_HOME } from "../config/config.ts";

export interface FingerprintEntry {
  rel: string;
  size: number;
  mtimeMs: number;
}

/** Directory tree fingerprint (relative path + size + mtime per entry). */
export function fingerprintDir(root: string, entries?: FingerprintEntry[]): FingerprintEntry[] {
  const out = entries ?? [];
  if (!existsSync(root)) return out;
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, dirent.name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // vanished between readdir and stat — skip (will re-scan next time)
    }
    out.push({ rel: relative(root, full), size: st.size, mtimeMs: st.mtimeMs });
    if (dirent.isDirectory()) fingerprintDir(full, out);
  }
  return out;
}

/** Fingerprint of individual state files (absolute paths). */
export function fingerprintFiles(paths: readonly string[]): FingerprintEntry[] {
  const out: FingerprintEntry[] = [];
  for (const p of paths) {
    try {
      const st = statSync(p);
      out.push({ rel: resolve(p), size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      out.push({ rel: resolve(p), size: -1, mtimeMs: -1 }); // missing = a state
    }
  }
  return out;
}

/** Merkle-style hash over the combined fingerprints. */
export function hashFingerprint(parts: readonly FingerprintEntry[][]): string {
  const h = createHash("sha256");
  for (const part of parts) {
    for (const e of [...part].sort((a, b) => a.rel.localeCompare(b.rel))) {
      h.update(`${e.rel}|${e.size}|${e.mtimeMs}\n`);
    }
  }
  return h.digest("hex");
}

export interface CachedScanResult<T> {
  value: T;
  /** true when the cached payload was served without a full scan. */
  hit: boolean;
  /** Cache file path (for diagnostics). */
  cachePath: string;
}

interface CacheFile<T> {
  fingerprint: string;
  payload: T;
}

/**
 * Run a scan with content-addressed caching.
 *
 * @param cacheId  stable id; the cache file lives at
 *                 $XR_HOME/cache/scans/<cacheId>.json
 * @param roots    directories whose fingerprints form the key
 * @param files    state files that must be part of the key (e.g. the
 *                 marketplace registry, config)
 * @param load     the full (slow) scan, run only on a miss
 * @param xrHome   override for tests
 */
export function cachedScan<T>(opts: {
  cacheId: string;
  roots: readonly string[];
  files?: readonly string[];
  load(): T;
  xrHome?: string;
}): CachedScanResult<T> {
  const home = opts.xrHome ?? XR_HOME;
  const cacheDir = join(home, "cache", "scans");
  const cachePath = join(cacheDir, `${opts.cacheId}.json`);

  const fingerprint = hashFingerprint([
    ...opts.roots.map((r) => fingerprintDir(r)),
    fingerprintFiles(opts.files ?? []),
  ]);

  try {
    if (existsSync(cachePath)) {
      const raw = readFileSync(cachePath);
      // Gzip-compressed payloads keep warm scans fast (a 500 KB manifest
      // cache parses in ~2 ms instead of ~10 ms). NOTE: Uint8Array has no
      // UTF-8 `.toString` — decode via TextDecoder, not `.toString("utf8")`.
      const decoder = new TextDecoder();
      const text = raw[0] === 0x1f && raw[1] === 0x8b ? decoder.decode(Bun.gunzipSync(raw)) : raw.toString("utf8");
      const cached = JSON.parse(text) as CacheFile<T>;
      if (cached && cached.fingerprint === fingerprint && cached.payload != null) {
        return { value: cached.payload, hit: true, cachePath };
      }
    }
  } catch {
    // Corrupt/partial cache → full scan (never fail startup on a cache).
  }

  const value = opts.load();
  try {
    mkdirSync(cacheDir, { recursive: true });
    const payload: CacheFile<T> = { fingerprint, payload: value };
    const text = JSON.stringify(payload);
    writeFileSync(cachePath, text.length > 8_192 ? Bun.gzipSync(text) : text);
  } catch {
    // Best-effort: read-only home must not break scans.
  }
  return { value, hit: false, cachePath };
}

/** Number of entries a directory tree would stat (diagnostics). */
export function countTree(root: string): number {
  return fingerprintDir(root).length;
}
