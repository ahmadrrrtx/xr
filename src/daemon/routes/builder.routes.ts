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

import { existsSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { isSecretPath } from "../../security/guard.ts";
import { FilesystemAuthority, FilesystemError, withFilesystem } from "../../security/filesystem.ts";
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

export async function gitInfo(root: string): Promise<{ branch: string | null; dirty: boolean; isRepo: boolean; files: Record<string, GitBadge> }> {
  try {
    const [branch, status] = await Promise.all([
      runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, timeoutMs: 3_000 }),
      runCommand("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, timeoutMs: 5_000 }),
    ]);
    if (!status.ok) return { branch: null, dirty: false, isRepo: false, files: {} };
    // Decision (A1): sensitive names (for example `.env`, keys) are not shown, even as names.
    const files = Object.fromEntries(Object.entries(gitBadges(status.stdout)).filter(([rel]) => !isSecretPath(join(root, rel))));
    return { branch: branch.ok && branch.stdout.trim() ? branch.stdout.trim() : null, dirty: status.stdout.trim().length > 0, isRepo: true, files };
  } catch {
    return { branch: null, dirty: false, isRepo: false, files: {} };
  }
}

/** Breadth-first walk so a truncated tree still has every top-level entry. A1: listing goes through the authority. */
export function walkTree(root: string, cap = TREE_CAP): { entries: BuilderTreeEntry[]; truncated: boolean } {
  const entries: BuilderTreeEntry[] = [];
  const queue: string[] = [""];
  let truncated = false;
  try {
    withFilesystem(root, "daemon", (fs) => {
      while (queue.length > 0) {
        const rel = queue.shift() ?? "";
        let listed;
        try {
          listed = fs.list(rel || ".", TREE_CAP);
        } catch {
          continue;
        }
        listed.sort((a, b) => (a.directory ? 0 : 1) - (b.directory ? 0 : 1) || a.name.localeCompare(b.name));
        for (const d of listed) {
          if (entries.length >= cap) {
            truncated = true;
            return;
          }
          const heavy = BUILDER_HEAVY_DIRS.has(d.name);
          if (d.directory) {
            entries.push({ rel: d.path, name: d.name, type: "dir", size: 0, mtimeMs: d.mtimeMs, ...(heavy ? { heavy: true as const } : {}) });
            if (!heavy) queue.push(d.path);
          } else {
            entries.push({ rel: d.path, name: d.name, type: "file", size: d.size, mtimeMs: d.mtimeMs });
          }
        }
      }
    });
  } catch {
    /* root unavailable: an empty tree is reported, never a fallback read */
  }
  return { entries, truncated };
}

const BINARY_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "woff", "woff2", "ttf", "eot", "wasm", "sqlite", "db", "class", "jar", "exe", "dll", "so", "dylib", "pyc", "mp3", "mp4", "mov", "avif", "bmp"]);

/** Binary decision from an already-authorized prefix (no second I/O). */
function looksBinary(rel: string, head: Buffer): boolean {
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXT.has(ext) || head.includes(0);
}

/** Authority failures map to fixed, content-free responses (no path echo, no secret text). */
function fsFailure(json: (body: unknown, status?: number) => Response, e: unknown, rel: string, notFound = `${rel} does not exist`): Response {
  if (e instanceof FilesystemError) {
    if (e.code === "missing") return json({ error: notFound }, 404);
    if (e.code === "stale") return json({ error: `${rel} changed or already exists` }, 409);
    if (e.code === "limit") return json({ error: "content exceeds the limit" }, 413);
    if (e.code === "escape") return json({ error: "path escapes the project root" }, 400);
    return json({ error: "path not permitted by the filesystem authority" }, 403);
  }
  return json({ error: "file operation failed" }, 500);
}

function cleanRel(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const rel = input.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!rel || rel.length > 2_000) return null;
  return rel;
}

/* ── Syntax diagnostics via XR's OWN transpiler ───────────────────────────
 * Decision (A1): the builder never imports the project's node_modules/typescript.
 * That would execute project-controlled code inside the daemon. Diagnostics are
 * syntax-level (the same class transpileModule reports with isolatedModules), from
 * Bun's trusted built-in parser. Semantic/type diagnostics are not offered.
 */
export function syntaxDiagnostics(content: string, rel: string): { available: true; diagnostics: Array<{ from: number; to: number; severity: "error"; message: string; code: number }> } | { available: false; reason: string } {
  const loader = /\.(tsx|jsx)$/.test(rel) ? "tsx" : /\.(ts|mts|cts)$/.test(rel) ? "ts" : "jsx";
  try {
    new Bun.Transpiler({ loader: loader as "ts" | "tsx" | "jsx" }).transformSync(content);
    return { available: true, diagnostics: [] };
  } catch (e) {
    const err = e as { message?: string; position?: { offset?: number; length?: number } };
    const from = Math.max(0, err.position?.offset ?? 0);
    return { available: true, diagnostics: [{ from, to: from + Math.max(1, err.position?.length ?? 1), severity: "error", message: err.message ?? "syntax error", code: 0 }] };
  }
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
        try {
          return withFilesystem(project.root, "daemon", (fs) => {
            const meta = fs.metadata(rel);
            if (meta.directory) return json({ error: "path is a directory" }, 400);
            const head = fs.readPrefix(rel, READ_LIMIT);
            if (looksBinary(rel, head.bytes.subarray(0, 4096))) {
              return json({ path: rel, content: "", size: head.size, mtimeMs: head.mtimeMs, isText: false, truncated: false });
            }
            return json({ path: rel, content: head.bytes.toString("utf8"), size: head.size, mtimeMs: head.mtimeMs, isText: true, truncated: head.truncated });
          });
        } catch (e) {
          return fsFailure(json, e, rel, "file not found");
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
        const bytes = Buffer.byteLength(body.content, "utf8");
        if (bytes > WRITE_LIMIT) return json({ error: "content exceeds the 1 MB write limit" }, 413);
        // A1: authorize and capture identity BEFORE the approval is requested; commit re-validates it.
        const fsa = new FilesystemAuthority(project.root, "daemon");
        let op: ReturnType<FilesystemAuthority["prepare"]>;
        let existed = false;
        try {
          try {
            const meta = fsa.metadata(rel);
            if (meta.directory) { fsa.close(); return json({ error: "path is a directory" }, 400); }
            existed = true;
            if (typeof body.baseMtimeMs === "number" && Math.abs(meta.mtimeMs - body.baseMtimeMs) > 2) {
              fsa.close();
              return json({ error: "file changed on disk since it was loaded", stale: true, mtimeMs: meta.mtimeMs }, 409);
            }
          } catch (e) {
            if (!(e instanceof FilesystemError && e.code === "missing")) throw e;
          }
          op = fsa.prepare(rel, "write");
        } catch (e) {
          fsa.close();
          return fsFailure(json, e, rel);
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
          release: () => { op.close(); fsa.close(); },
          perform: () => {
            op.commit(content);
            const st = fsa.metadata(rel);
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
        const fsa = new FilesystemAuthority(project.root, "daemon");
        let op: ReturnType<FilesystemAuthority["prepareCreate"]>;
        try {
          op = fsa.prepareCreate(rel, kind);
        } catch (e) {
          fsa.close();
          return fsFailure(json, e, rel);
        }
        return gatedMutation({
          ctx: { state, config },
          project,
          tool: kind === "folder" ? "mkdir" : "create_file",
          args: { path: rel, kind },
          previewArgs: kind === "file" ? { content: "" } : {},
          reason: `Create ${kind} ${rel} — Builder`,
          riskTier: "low",
          audit: "builder.file.create",
          release: () => { op.close(); fsa.close(); },
          perform: () => {
            op.commit();
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
        const fsa = new FilesystemAuthority(project.root, "daemon");
        let op: ReturnType<FilesystemAuthority["prepareRename"]>;
        try {
          op = fsa.prepareRename(from, to);
        } catch (e) {
          fsa.close();
          if (e instanceof FilesystemError && e.code === "stale") return json({ error: `${to} already exists` }, 409);
          return fsFailure(json, e, from);
        }
        return gatedMutation({
          ctx: { state, config },
          project,
          tool: "rename_file",
          args: { path: from, to },
          reason: `Rename ${from} → ${to} — Builder`,
          riskTier: "medium",
          audit: "builder.file.rename",
          release: () => { op.close(); fsa.close(); },
          perform: () => {
            op.commit();
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
        // The project root itself is never a deletable target.
        if (rel === "." || rel === "") return json({ error: "path escapes the project root" }, 400);
        const fsa = new FilesystemAuthority(project.root, "daemon");
        let op: ReturnType<FilesystemAuthority["prepareRemove"]>;
        let isDir = false;
        try {
          isDir = fsa.metadata(rel).directory;
          op = fsa.prepareRemove(rel, isDir);
        } catch (e) {
          fsa.close();
          return fsFailure(json, e, rel, `${rel} does not exist`);
        }
        const count = op.files;
        return gatedMutation({
          ctx: { state, config },
          project,
          tool: "delete_file",
          args: { path: rel, recursive: isDir, files: count },
          reason: isDir ? `Delete folder ${rel} and ${count} file${count === 1 ? "" : "s"} inside it — Builder` : `Delete ${rel} — Builder`,
          riskTier: isDir ? "high" : "medium",
          audit: "builder.file.delete",
          release: () => { op.close(); fsa.close(); },
          perform: () => {
            op.commit();
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
        const result = syntaxDiagnostics(body.content, rel);
        return json(result.available ? result : { ...result, diagnostics: [] });
      },
    }),
  ];
}

/** Root-relative display path (used by tests and the rename preview). */
export function relOf(project: BuilderProject, abs: string): string {
  return relative(project.root, abs).split(sep).join("/");
}
