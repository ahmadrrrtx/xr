/**
 * XR Phase 11 — workspace / path / symlink scope.
 *
 * Every indexed path must stay inside the repository root. Symlinks that
 * resolve outside the root are skipped (not followed). This reuses
 * `canonicalPath` from the security guard so policy and indexing agree.
 */

import { lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalPath } from "../security/guard.ts";

/**
 * Canonicalize `root` the same way candidates are canonicalized.
 *
 * macOS GitHub runners (and developer machines) expose tmpdir as `/var/folders/…`
 * which realpath's to `/private/var/folders/…`. Comparing a non-realpathed root
 * against a realpathed file makes `relative()` start with `..` and every file
 * looks out-of-scope — the Phase 11 indexer then reports `files: 0` and the
 * whole repo-map suite fails. Linux is unaffected (`/tmp` is not a symlink).
 */
export function canonicalRoot(root: string): string {
  return canonicalPath(resolve(root), root);
}

export function resolveInsideRoot(root: string, candidate: string): string | null {
  const canonRoot = canonicalRoot(root);
  const abs = isAbsolute(candidate) ? candidate : resolve(canonRoot, candidate);
  const canon = canonicalPath(abs, canonRoot);
  const rel = relative(canonRoot, canon);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return canon;
}

export interface ScopedStat {
  absolute: string;
  relativePath: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number;
}

/**
 * Stat a path without escaping the root. Symlinks are resolved; if the
 * target is outside `root`, returns null.
 */
export function scopedStat(root: string, absolute: string): ScopedStat | null {
  let lst;
  try {
    lst = lstatSync(absolute);
  } catch {
    return null;
  }

  let target = absolute;
  if (lst.isSymbolicLink()) {
    try {
      target = realpathSync(absolute);
    } catch {
      return null;
    }
  }

  const canonRoot = canonicalRoot(root);
  const inside = resolveInsideRoot(canonRoot, target);
  if (!inside) return null;

  let st = lst;
  if (lst.isSymbolicLink()) {
    try {
      st = statSync(target);
    } catch {
      return null;
    }
  }

  const rel = relative(canonRoot, inside).split(sep).join("/");
  return {
    absolute: inside,
    relativePath: rel,
    isDirectory: st.isDirectory(),
    isFile: st.isFile(),
    isSymlink: lst.isSymbolicLink(),
    size: st.size,
    mtimeMs: st.mtimeMs,
  };
}

export function toPosixRelative(root: string, absolute: string): string {
  return relative(canonicalRoot(root), absolute).split(sep).join("/");
}
