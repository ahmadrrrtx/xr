/**
 * XR Phase 11 — ignore + secret exclusion.
 *
 * Combines:
 *   - XR default skip directories (aligned with memory/rag.ts + scan-cache)
 *   - `.gitignore` (best-effort, no second ignore engine)
 *   - `.xrignore` if present
 *   - `isSecretPath` from the security guard
 *
 * Secrets are never indexed "because they exist".
 */

import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { isSecretPath } from "../security/guard.ts";

export const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".vercel",
  "out",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".cache",
  ".xr",
  ".idea",
  ".vscode",
  "vendor",
  ".parcel-cache",
  ".svelte-kit",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
]);

export const DEFAULT_SKIP_FILES = new Set([
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "poetry.lock",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf",
  ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm",
  ".exe", ".dll", ".so", ".dylib", ".o", ".a",
  ".wasm", ".bin", ".class", ".jar",
]);

export interface IgnoreMatcher {
  skipDir(name: string, relativeDir: string): boolean;
  skipFile(relativePath: string, absolutePath: string): boolean;
}

interface GitIgnoreRule {
  negated: boolean;
  directoryOnly: boolean;
  /** glob converted to a RegExp matching a posix relative path. */
  re: RegExp;
  raw: string;
}

export function loadIgnore(root: string): IgnoreMatcher {
  const rules: GitIgnoreRule[] = [];
  for (const name of [".gitignore", ".xrignore"]) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    try {
      parseGitignore(readFileSync(p, "utf8"), rules);
    } catch {
      /* corrupt ignore file → skip, defaults still apply */
    }
  }

  return {
    skipDir(name, relativeDir) {
      if (DEFAULT_SKIP_DIRS.has(name)) return true;
      if (name.startsWith(".") && name !== "." && name !== "..") {
        // Hidden dirs other than the repo root are skipped unless a later
        // un-ignore rule exists. `.github` / `.husky` stay skipped by default.
        if (name !== ".github" && name !== ".husky") return true;
      }
      const rel = relativeDir.replace(/\\/g, "/");
      return matchesRules(rules, rel.endsWith("/") ? rel : `${rel}/`, true);
    },
    skipFile(relativePath, absolutePath) {
      const rel = relativePath.replace(/\\/g, "/");
      const base = rel.slice(rel.lastIndexOf("/") + 1);
      if (DEFAULT_SKIP_FILES.has(base)) return true;
      const dot = base.lastIndexOf(".");
      if (dot >= 0 && BINARY_EXT.has(base.slice(dot).toLowerCase())) return true;
      if (isSecretPath(absolutePath) || isSecretPath(rel.split("/").join(sep))) return true;
      return matchesRules(rules, rel, false);
    },
  };
}

function parseGitignore(text: string, out: GitIgnoreRule[]): void {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    let pattern = line;
    let negated = false;
    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    }
    let directoryOnly = false;
    if (pattern.endsWith("/")) {
      directoryOnly = true;
      pattern = pattern.slice(0, -1);
    }
    const re = globToRegExp(pattern);
    if (re) out.push({ negated, directoryOnly, re, raw: line });
  }
}

function globToRegExp(pattern: string): RegExp | null {
  const anchored = pattern.startsWith("/");
  let body = pattern.replace(/^\//, "");
  let re = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === "*" && body[i + 1] === "*") {
      re += ".*";
      i += 1;
      if (body[i + 1] === "/") i += 1;
      continue;
    }
    if (c === "*") {
      re += "[^/]*";
      continue;
    }
    if (c === "?") {
      re += "[^/]";
      continue;
    }
    if ("\\^$+()[]{}|.".includes(c)) re += `\\${c}`;
    else re += c;
  }
  try {
    return new RegExp(anchored ? `^${re}(?:/.*)?$` : `(^|/)${re}(?:/.*)?$`);
  } catch {
    return null;
  }
}

function matchesRules(rules: readonly GitIgnoreRule[], rel: string, isDir: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDir) continue;
    if (rule.re.test(rel)) ignored = !rule.negated;
  }
  return ignored;
}
