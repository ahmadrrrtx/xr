/**
 * XR Phase 11 — repository file discovery.
 *
 * Walks the workspace root, applying ignore rules, secret-path exclusion,
 * symlink scope, size caps, and the language registry. Does not read file
 * contents (the indexer does that only for changed files).
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadRepoConfig } from "./config.ts";
import { loadIgnore, type IgnoreMatcher } from "./ignore.ts";
import { isIndexableSource } from "./languages.ts";
import { scopedStat, type ScopedStat } from "./scope.ts";

export interface ScannedFile {
  absolute: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
}

export function scanRepository(root: string, opts: { maxFiles?: number } = {}): ScannedFile[] {
  const cfg = loadRepoConfig();
  const maxFiles = opts.maxFiles ?? cfg.maxFiles;
  const ignore = loadIgnore(root);
  const out: ScannedFile[] = [];
  walk(root, root, ignore, out, maxFiles);
  return out;
}

function walk(root: string, dir: string, ignore: IgnoreMatcher, out: ScannedFile[], maxFiles: number): void {
  if (out.length >= maxFiles) return;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (out.length >= maxFiles) return;
    const absolute = join(dir, name);
    const st = scopedStat(root, absolute);
    if (!st) continue;
    if (st.isDirectory) {
      if (ignore.skipDir(name, st.relativePath)) continue;
      walk(root, st.absolute, ignore, out, maxFiles);
      continue;
    }
    if (!st.isFile) continue;
    if (!isIndexableSource(st.relativePath)) continue;
    if (ignore.skipFile(st.relativePath, st.absolute)) continue;
    if (st.size > loadRepoConfig().maxFileBytes) continue;
    out.push({
      absolute: st.absolute,
      relativePath: st.relativePath,
      size: st.size,
      mtimeMs: st.mtimeMs,
    });
  }
}

export function describeScan(files: readonly ScannedFile[]): { files: number; bytes: number } {
  return { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) };
}

export type { ScopedStat };
