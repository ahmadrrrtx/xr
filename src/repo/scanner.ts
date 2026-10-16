/** Repository discovery is metadata-only through the shared descriptor authority. */
import { join } from "node:path";
import { withFilesystem } from "../security/filesystem.ts";
import { loadRepoConfig } from "./config.ts";
import { loadIgnore } from "./ignore.ts";
import { isIndexableSource } from "./languages.ts";
import type { ScopedStat } from "./scope.ts";
export interface ScannedFile { absolute: string; relativePath: string; size: number; mtimeMs: number; }
export function scanRepository(root: string, opts: { maxFiles?: number } = {}): ScannedFile[] {
  const cfg = loadRepoConfig(), maxFiles = Math.min(opts.maxFiles ?? cfg.maxFiles, 10_000), ignore = loadIgnore(root);
  return withFilesystem(root, "index", fs => {
    const out: ScannedFile[] = [], queue = ["."];
    let directories = 0;
    while (queue.length && out.length < maxFiles && directories++ < 10_000) {
      const dir = queue.shift()!;
      if (dir.split("/").length >= 32) continue;
      for (const entry of fs.list(dir, 10_000)) {
        if (entry.directory) { if (!ignore.skipDir(entry.name, entry.path)) queue.push(entry.path); continue; }
        const absolute = join(fs.root, entry.path);
        if (!isIndexableSource(entry.path) || ignore.skipFile(entry.path, absolute) || entry.size > cfg.maxFileBytes) continue;
        out.push({ absolute, relativePath: entry.path, size: entry.size, mtimeMs: entry.mtimeMs });
        if (out.length >= maxFiles) break;
      }
    }
    return out;
  });
}
export function describeScan(files: readonly ScannedFile[]): { files: number; bytes: number } {
  return { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) };
}
export type { ScopedStat };
