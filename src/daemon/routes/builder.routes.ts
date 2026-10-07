/**
 * Phase 17 · Builder — project files over HTTP, scope-enforced.
 *
 * Reads are plain JSON. Every write (save, create, rename, delete) is an
 * approval-gated SSE mutation (see builder-shared.ts): the engine never
 * touches a user's file without a human decision recorded in the durable
 * approval store, and every transition lands in the hash-chained audit log.
 *
 *   POST /api/builder/projects                 register/open a folder → {id,…}
 *   GET  /api/builder/projects                 projects this daemon has open
 *   GET  /api/builder/projects/{id}/tree       entries + git badges + branch
 *   GET  /api/builder/projects/{id}/file?path= text read (512 KB cap)
 *   POST /api/builder/projects/{id}/file/write    SSE · write_file
 *   POST /api/builder/projects/{id}/file/create   SSE · create_file | mkdir
 *   POST /api/builder/projects/{id}/file/rename   SSE · rename_file
 *   POST /api/builder/projects/{id}/file/delete   SSE · delete_file
 *   GET  /api/builder/projects/{id}/git        {branch, dirty, files}
 *   POST /api/builder/projects/{id}/diagnostics  TypeScript syntax diagnostics
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { route, type DaemonRoute } from "./router.ts";
import { insideRoot } from "./files.routes.ts";
import { BUILDER_HEAVY_DIRS, getBuilderProjects, type BuilderProject } from "../builder-projects.ts";
import { gatedMutation, projectFrom, projectPattern } from "./builder-shared.ts";
import { runCommand } from "../../util/process.ts";

const READ_LIMIT = 512 * 1024;
const WRITE_LIMIT = 1024 * 1024;
const TREE_CAP = 4_000;

export type GitBadge = "modified" | "staged" | "untracked" | "added" | "deleted" | "renamed";

export interface BuilderTreeEntry {
  rel: string;
  name: string;
  type: "file" | "dir";
  size: number;
  mtimeMs: number;
  /** Heavy directories (node_modules, .git, …) are listed but never expanded. */
  heavy?: true;
}

/** Parse `git status --porcelain=v1 -z`-free output (newline form) into per-path badges, folders included. */
export function gitBadges(porcelain: string): Record<string, GitBadge> {
  const out: Record<string, GitBadge> = {};
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    let p = line.slice(3).trim();
    if (p.includes(" -> ")) p = p.split(" -> ").pop() ?? p;
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    if (p.endsWith("/")) p = p.slice(0, -1);
    let badge: GitBadge;
    if (x === "?" && y === "?") badge = "untracked";
    else if (x === "R" || y === "R") badge = "renamed";
    else if (x === "A") badge = "added";
    else if (x === "D" || y === "D") badge = "deleted";
    else if (y === "M" || y === "T") badge = "modified";
    else if (x === "M" || x === "T") badge = "staged";
    else continue;
    out[p] = badge;
    // Bubble to parent folders so collapsed folders show a dot.
    const parts = p.split("/");
    for (let i = parts.length - 1; i > 0; i -= 1) {
      const dir = parts.slice(0, i).join("/");
      if (!out[dir] || out[dir] === "untracked") out[dir] = badge === "untracked" ? "untracked" : "modified";
    }
  }
  return out;
}

async function gitInfo(root: string): Promise<{ branch: string | null; dirty: boolean; isRepo: boolean; files: Record<string, GitBadge> }> {
  try {
    const [branch, status] = await Promise.all([
      runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, timeoutMs: 3_000 }),
      runCommand("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, timeoutMs: 5_000 }),
    ]);
    if (!status.ok) return { branch: null, dirty: false, isRepo: false, files: {} };
    const files = gitBadges(status.stdout);
    return { branch: branch.ok && branch.stdout.trim() ? branch.stdout.trim() : null, dirty: status.stdout.trim().length > 0, isRepo: true, files };
  } catch {
    return { branch: null, dirty: false, isRepo: false, files: {} };
  }
}

/** Breadth-first walk so a truncated tree still has every top-level entry. */
export function walkTree(root: string, cap = TREE_CAP): { entries: BuilderTreeEntry[]; truncated: boolean } {
  const entries: BuilderTreeEntry[] = [];
  const queue: string[] = [""];
  let truncated = false;
  while (queue.length > 0) {
    const rel = queue.shift() ?? "";
    let dirents;
    try {
      dirents = readdirSync(rel ? join(root, rel) : root, { withFileTypes: true });
    } catch {
      continue;
    }
    dirents.sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1;
      const bd = b.isDirectory() ? 0 : 1;
      return ad - bd || a.name.localeCompare(b.name);
    });
    for (const d of dirents) {
      if (entries.length >= cap) {
        truncated = true;
        return { entries, truncated };
      }
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      const abs = join(root, childRel);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (d.isDirectory() || st.isDirectory()) {
        const heavy = BUILDER_HEAVY_DIRS.has(d.name);
        entries.push({ rel: childRel, name: d.name, type: "dir", size: 0, mtimeMs: st.mtimeMs, ...(heavy ? { heavy: true as const } : {}) });
        if (!heavy && !d.isSymbolicLink()) queue.push(childRel);
      } else if (st.isFile()) {
        entries.push({ rel: childRel, name: d.name, type: "file", size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  }
  return { entries, truncated };
}

const BINARY_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "woff", "woff2", "ttf", "eot", "wasm", "sqlite", "db", "class", "jar", "exe", "dll", "so", "dylib", "pyc", "mp3", "mp4", "mov", "avif", "bmp"]);

function looksBinary(abs: string): boolean {
  const ext = abs.split(".").pop()?.toLowerCase() ?? "";
  if (BINARY_EXT.has(ext)) return true;
  try {
    const fd = openSync(abs, "r");
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, 4096, 0);
    closeSync(fd);
    return buf.subarray(0, n).includes(0);
  } catch {
    return false;
  }
}

function cleanRel(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const rel = input.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!rel || rel.length > 2_000) return null;
  return rel;
}

function targetOf(project: BuilderProject, rel: string): string | null {
  return insideRoot(project.root, rel.split("/").join(sep));
}

/* ── TypeScript diagnostics via the PROJECT's own compiler ────────────── */

interface TsLike {
  transpileModule(input: string, opts: { reportDiagnostics: boolean; fileName: string; compilerOptions: Record<string, unknown> }): {
    diagnostics?: Array<{ start?: number; length?: number; messageText: unknown; code: number; category: number }>;
  };
  flattenDiagnosticMessageText(msg: unknown, nl: string): string;
}

async function loadProjectTypescript(root: string): Promise<TsLike | null> {
  const candidates = [join(root, "node_modules", "typescript", "lib", "typescript.js")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const mod = (await import(file)) as { default?: TsLike } & Partial<TsLike>;
      const ts = (mod.default ?? mod) as TsLike;
      if (typeof ts.transpileModule === "function") return ts;
    } catch {
      /* unloadable — report honestly below */
    }
  }
  return null;
}

export function builderRoutes(): DaemonRoute[] {
  return [
    route({
      id: "builder.projects.open",
      path: "/api/builder/projects",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { path?: string; name?: string };
        try {
          const project = getBuilderProjects().open(body.path ?? "", body.name);
          state.store.audit("builder.project.opened", { project: project.id, root: project.root });
          const git = await gitInfo(project.root);
          return json({ id: project.id, name: project.name, root: project.root, git: { branch: git.branch, dirty: git.dirty, isRepo: git.isRepo } });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "builder.projects.list",
      path: "/api/builder/projects",
      method: "GET",
      handle: async ({ json }) => json({ projects: getBuilderProjects().list() }),
    }),
    route({
      id: "builder.tree",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("tree"),
      method: "GET",
      handle: async ({ json, path }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const { entries, truncated } = walkTree(project.root);
        const git = await gitInfo(project.root);
        return json({ root: project.root, name: project.name, entries, truncated, git });
      },
    }),
    route({
      id: "builder.file.read",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("file"),
      method: "GET",
      handle: async ({ json, path, url }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const rel = cleanRel(url.searchParams.get("path"));
        if (!rel) return json({ error: "expected ?path=" }, 400);
        const target = targetOf(project, rel);
        if (!target) return json({ error: "path escapes the project root" }, 400);
        try {
          const st = statSync(target);
          if (st.isDirectory()) return json({ error: "path is a directory" }, 400);
          if (looksBinary(target)) return json({ path: rel, content: "", size: st.size, mtimeMs: st.mtimeMs, isText: false, truncated: false });
          if (st.size > READ_LIMIT) {
            const fd = openSync(target, "r");
            const buf = Buffer.alloc(READ_LIMIT);
            const n = readSync(fd, buf, 0, READ_LIMIT, 0);
            closeSync(fd);
            return json({ path: rel, content: buf.subarray(0, n).toString("utf8"), size: st.size, mtimeMs: st.mtimeMs, isText: true, truncated: true });
          }
          return json({ path: rel, content: readFileSync(target, "utf8"), size: st.size, mtimeMs: st.mtimeMs, isText: true, truncated: false });
        } catch {
          return json({ error: "file not found" }, 404);
        }
      },
    }),
    route({
      id: "builder.file.write",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("file/write"),
      method: "POST",
      handle: async ({ req, json, path, state, config }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const body = (await req.json().catch(() => ({}))) as { path?: string; content?: string; baseMtimeMs?: number };
        const rel = cleanRel(body.path);
        if (!rel) return json({ error: "expected { path, content }" }, 400);
        if (typeof body.content !== "string") return json({ error: "content must be a string" }, 400);
        const target = targetOf(project, rel);
        if (!target) return json({ error: "path escapes the project root" }, 400);
        const bytes = Buffer.byteLength(body.content, "utf8");
        if (bytes > WRITE_LIMIT) return json({ error: "content exceeds the 1 MB write limit" }, 413);
        let existed = false;
        try {
          const st = statSync(target);
          if (st.isDirectory()) return json({ error: "path is a directory" }, 400);
          existed = true;
          if (typeof body.baseMtimeMs === "number" && Math.abs(st.mtimeMs - body.baseMtimeMs) > 2) {
            return json({ error: "file changed on disk since it was loaded", stale: true, mtimeMs: st.mtimeMs }, 409);
          }
        } catch {
          /* new file */
        }
        const content = body.content;
        return gatedMutation({
          ctx: { state, config },
          project,
          tool: "write_file",
          args: { path: rel, bytes },
          previewArgs: { content },
          reason: `${existed ? "Save" : "Create"} ${rel} (${bytes} bytes) — Builder`,
          riskTier: "medium",
          audit: "builder.file.write",
          perform: () => {
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, content, "utf8");
            const st = statSync(target);
            return { path: rel, bytes, mtimeMs: st.mtimeMs };
          },
        });
      },
    }),
    route({
      id: "builder.file.create",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("file/create"),
      method: "POST",
      handle: async ({ req, json, path, state, config }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const body = (await req.json().catch(() => ({}))) as { path?: string; kind?: string };
        const rel = cleanRel(body.path);
        if (!rel) return json({ error: "expected { path, kind }" }, 400);
        const kind = body.kind === "folder" ? "folder" : "file";
        const target = targetOf(project, rel);
        if (!target) return json({ error: "path escapes the project root" }, 400);
        if (existsSync(target)) return json({ error: `${rel} already exists` }, 409);
        return gatedMutation({
          ctx: { state, config },
          project,
          tool: kind === "folder" ? "mkdir" : "create_file",
          args: { path: rel, kind },
          previewArgs: kind === "file" ? { content: "" } : {},
          reason: `Create ${kind} ${rel} — Builder`,
          riskTier: "low",
          audit: "builder.file.create",
          perform: () => {
            if (kind === "folder") mkdirSync(target, { recursive: true });
            else {
              mkdirSync(dirname(target), { recursive: true });
              writeFileSync(target, "", { flag: "wx" });
            }
            return { path: rel, kind };
          },
        });
      },
    }),
    route({
      id: "builder.file.rename",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("file/rename"),
      method: "POST",
      handle: async ({ req, json, path, state, config }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
        const from = cleanRel(body.from);
        const to = cleanRel(body.to);
        if (!from || !to) return json({ error: "expected { from, to }" }, 400);
        const src = targetOf(project, from);
        const dst = targetOf(project, to);
        if (!src || !dst) return json({ error: "path escapes the project root" }, 400);
        if (!existsSync(src)) return json({ error: `${from} does not exist` }, 404);
        if (existsSync(dst)) return json({ error: `${to} already exists` }, 409);
        return gatedMutation({
          ctx: { state, config },
          project,
          tool: "rename_file",
          args: { path: from, to },
          reason: `Rename ${from} → ${to} — Builder`,
          riskTier: "medium",
          audit: "builder.file.rename",
          perform: () => {
            mkdirSync(dirname(dst), { recursive: true });
            renameSync(src, dst);
            return { from, to };
          },
        });
      },
    }),
    route({
      id: "builder.file.delete",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("file/delete"),
      method: "POST",
      handle: async ({ req, json, path, state, config }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const body = (await req.json().catch(() => ({}))) as { path?: string };
        const rel = cleanRel(body.path);
        if (!rel) return json({ error: "expected { path }" }, 400);
        const target = targetOf(project, rel);
        if (!target || target === project.root) return json({ error: "path escapes the project root" }, 400);
        let isDir = false;
        try {
          isDir = statSync(target).isDirectory();
        } catch {
          return json({ error: `${rel} does not exist` }, 404);
        }
        let count = 1;
        if (isDir) count = walkTree(target, 10_000).entries.filter((e) => e.type === "file").length;
        return gatedMutation({
          ctx: { state, config },
          project,
          tool: "delete_file",
          args: { path: rel, recursive: isDir, files: count },
          reason: isDir ? `Delete folder ${rel} and ${count} file${count === 1 ? "" : "s"} inside it — Builder` : `Delete ${rel} — Builder`,
          riskTier: isDir ? "high" : "medium",
          audit: "builder.file.delete",
          perform: () => {
            rmSync(target, { recursive: isDir, force: false });
            return { path: rel, recursive: isDir };
          },
        });
      },
    }),
    route({
      id: "builder.git",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("git"),
      method: "GET",
      handle: async ({ json, path }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        return json(await gitInfo(project.root));
      },
    }),
    route({
      id: "builder.diagnostics",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("diagnostics"),
      method: "POST",
      handle: async ({ req, json, path }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const body = (await req.json().catch(() => ({}))) as { path?: string; content?: string };
        const rel = cleanRel(body.path);
        if (!rel || typeof body.content !== "string") return json({ error: "expected { path, content }" }, 400);
        if (!/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(rel)) return json({ available: false, reason: "not a TypeScript/JavaScript file", diagnostics: [] });
        if (body.content.length > READ_LIMIT) return json({ available: false, reason: "file too large", diagnostics: [] });
        const ts = await loadProjectTypescript(project.root);
        if (!ts) return json({ available: false, reason: "typescript is not installed in this project (node_modules/typescript)", diagnostics: [] });
        try {
          const jsx = /\.(tsx|jsx)$/.test(rel) ? 4 /* ReactJSX */ : undefined;
          const out = ts.transpileModule(body.content, {
            reportDiagnostics: true,
            fileName: basename(rel),
            compilerOptions: { target: 99, module: 99, jsx, allowJs: true, isolatedModules: true },
          });
          const diagnostics = (out.diagnostics ?? []).slice(0, 200).map((d) => ({
            from: d.start ?? 0,
            to: (d.start ?? 0) + Math.max(1, d.length ?? 1),
            severity: d.category === 1 ? ("error" as const) : d.category === 0 ? ("warning" as const) : ("info" as const),
            message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
            code: d.code,
          }));
          return json({ available: true, diagnostics });
        } catch (e) {
          return json({ available: false, reason: (e as Error).message, diagnostics: [] });
        }
      },
    }),
  ];
}

/** Root-relative display path (used by tests and the rename preview). */
export function relOf(project: BuilderProject, abs: string): string {
  return relative(project.root, abs).split(sep).join("/");
}
