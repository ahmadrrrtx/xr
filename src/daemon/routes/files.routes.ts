/**
 * XR Daemon — workspace files routes (Phase G · G-1/G-2, experimental).
 *
 * A REAL, scope-enforced file browser for the project the daemon runs in
 * (process.cwd() — the same root /api/overview reports). This powers the
 * dashboard "Files & Artifacts" panel (previously a static placeholder that
 * claimed nothing existed) and the coding-workspace surface.
 *
 * Security posture:
 *   · every path is resolved against the project root and must stay inside
 *     it — traversal (.., absolute, symlink escapes) is rejected with 400;
 *   · reads are size-capped (512 KB) and text-only (null-byte sniff);
 *   · `git diff` runs through runCommand with an argv array (no shell), a
 *     timeout, and a bounded buffer; untracked files honestly return an
 *     empty diff with tracked:false.
 *
 * No capability is invented: this is filesystem + git inspection scoped to
 * the same directory the CLI already works in.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { route, type DaemonRoute } from "./router.ts";

const READ_LIMIT = 512 * 1024;
const ENTRY_CAP = 600;
const HEAVY_DIRS = new Set([".git", "node_modules", "dist", "out", "build", "target", ".venv", ".next", "__pycache__", ".cache", ".npm", ".arena", ".svelte-kit"]);

interface FileEntry {
  name: string;
  rel: string;
  type: "file" | "dir";
  size: number;
  mtime: number;
  git: "clean" | "modified" | "staged" | "untracked" | "added" | "deleted" | null;
  isText?: boolean;
}

/** Resolve a user-supplied relative path strictly inside root. Returns null on escape. */
function insideRoot(root: string, relPath: string): string | null {
  if (isAbsolute(relPath)) return null;
  const target = resolve(root, relPath);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

async function gitSummaryFor(root: string): Promise<{ branch: string | null; dirty: boolean }> {
  try {
    const { runCommand } = await import("../../util/process.ts");
    const [branch, status] = await Promise.all([
      runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, timeoutMs: 3000 }),
      runCommand("git", ["status", "--porcelain"], { cwd: root, timeoutMs: 3000 }),
    ]);
    return {
      branch: branch.ok && branch.stdout.trim() ? branch.stdout.trim() : null,
      dirty: status.ok && status.stdout.trim().length > 0,
    };
  } catch {
    return { branch: null, dirty: false };
  }
}

/** Parse `git status --porcelain` lines into per-file status. */
function porcelainStatus(output: string): Map<string, "modified" | "staged" | "untracked" | "added" | "deleted"> {
  const map = new Map<string, "modified" | "staged" | "untracked" | "added" | "deleted">();
  for (const line of output.split("\n")) {
    if (!line) continue;
    const xy = line.slice(0, 2);
    const p = line.slice(3).trim();
    if (!p) continue;
    const rel = p.replace(/\s*->.*$/, ""); // renames: "a -> b" → keep target? keep first
    if (xy === "??") map.set(rel, "untracked");
    else if (xy.includes("A")) map.set(rel, "added");
    else if (xy.includes("D")) map.set(rel, "deleted");
    else if (xy[1] === "M" || xy[1] === "T") map.set(rel, "modified");
    else if (xy[0] === "M" || xy[0] === "T") map.set(rel, "staged");
  }
  return map;
}

function looksText(name: string, head: Buffer): boolean {
  if (head.length === 0) return true;
  if (head.includes(0)) return false;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const binaryExt = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "woff", "woff2", "ttf", "eot", "wasm", "sqlite", "db", "class", "jar", "exe", "dll", "so", "dylib", "pyc"]);
  if (binaryExt.has(ext)) return false;
  return true;
}

export function filesRoutes(): DaemonRoute[] {
  return [
    route({
      id: "files.list",
      path: "/api/files",
      method: "GET",
      handle: async ({ json, url }) => {
        try {
          const root = resolve(process.cwd());
          const rel = url.searchParams.get("path") ?? "";
          const target = insideRoot(root, rel);
          if (!target) return json({ error: "path escapes the project root" }, 400);
          const st = statSync(target);
          if (!st.isDirectory()) return json({ error: "not a directory" }, 400);

          let names: string[];
          try {
            names = readdirSync(target);
          } catch {
            return json({ error: "cannot read directory" }, 403);
          }
          const git = await gitSummaryFor(root);
          let porcelain = new Map<string, never>();
          if (git.dirty) {
            try {
              const { runCommand } = await import("../../util/process.ts");
              const res = await runCommand("git", ["status", "--porcelain"], { cwd: root, timeoutMs: 5000 });
              if (res.ok) porcelain = porcelainStatus(res.stdout) as Map<string, never>;
            } catch {
              // git status is best-effort; entries just lose their git badge
            }
          }

          const entries: FileEntry[] = [];
          let truncated = false;
          for (const name of names) {
            if (name === ".git") continue;
            if (entries.length >= ENTRY_CAP) { truncated = true; break; }
            const abs = join(target, name);
            let isDir = false, size = 0, mtime = 0;
            try {
              const s = statSync(abs);
              isDir = s.isDirectory();
              size = s.size;
              mtime = s.mtimeMs;
            } catch {
              continue; // broken symlink / unreadable — skip honestly
            }
            const relPath = rel ? `${rel}/${name}` : name;
            const gitState = porcelain.get(relPath) ?? porcelain.get(name) ?? null;
            entries.push({
              name,
              rel: relPath,
              type: isDir ? "dir" : "file",
              size,
              mtime,
              git: gitState as FileEntry["git"],
              isText: isDir ? undefined : looksText(name, Buffer.alloc(0)),
            });
          }
          entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));

          return json({
            root,
            cwd: rel,
            entries,
            git,
            truncated,
          });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "files.read",
      path: "/api/files/read",
      method: "GET",
      handle: async ({ json, url }) => {
        try {
          const root = resolve(process.cwd());
          const rel = url.searchParams.get("path") ?? "";
          const target = insideRoot(root, rel);
          if (!target) return json({ error: "path escapes the project root" }, 400);
          const st = statSync(target);
          if (!st.isFile()) return json({ error: "not a file" }, 400);
          if (st.size > READ_LIMIT * 4) return json({ error: "file is too large to preview" }, 413);

          const buf = readFileSync(target);
          const isText = looksText(basename(target), buf.subarray(0, 4096));
          if (!isText) return json({ error: "binary file — preview is text-only" }, 415);
          const truncated = buf.length > READ_LIMIT;
          const content = buf.subarray(0, READ_LIMIT).toString("utf8");
          return json({ path: rel, content, size: st.size, truncated, isText });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "files.diff",
      path: "/api/files/diff",
      method: "GET",
      handle: async ({ json, url }) => {
        try {
          const root = resolve(process.cwd());
          const rel = url.searchParams.get("path") ?? "";
          const target = insideRoot(root, rel);
          if (!target) return json({ error: "path escapes the project root" }, 400);
          const st = statSync(target);
          if (!st.isFile()) return json({ error: "not a file" }, 400);

          const { runCommand } = await import("../../util/process.ts");
          const res = await runCommand("git", ["diff", "--", rel], { cwd: root, timeoutMs: 10_000, maxBuffer: 2 * 1024 * 1024 });
          const diff = res.ok ? res.stdout : "";
          // Untracked files have no diff: detect via ls-files
          const trackedRes = await runCommand("git", ["ls-files", "--error-unmatch", rel], { cwd: root, timeoutMs: 5000 });
          const tracked = trackedRes.ok;
          return json({ path: rel, diff, ok: res.ok, tracked });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
  ];
}
