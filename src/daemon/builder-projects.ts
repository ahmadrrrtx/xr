/**
 * Phase 17 · Builder — project registry.
 *
 * The dashboard's file/terminal routes are rooted at the daemon's own cwd.
 * The Builder edits the USER'S projects, so a project must be registered
 * first: the desktop posts an absolute folder, the engine validates it
 * (exists, is a directory, is not `/`, `$HOME` or XR's own state dir),
 * resolves symlinks ONCE and hands back a stable id derived from the real
 * path. Every later Builder call is `insideRoot(project.root, rel)` — the
 * same scope rule the dashboard routes use — so `..`, absolute paths and
 * symlinked escapes all stop at the boundary.
 *
 * The registry also owns the recursive filesystem watcher per project
 * (started on the first SSE subscriber, closed with the last) and the
 * backup folder the diff applier writes before it overwrites anything.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export interface BuilderProject {
  id: string;
  name: string;
  /** Real, absolute path (symlinks resolved). */
  root: string;
  openedAt: number;
}

export const BUILDER_MAX_PROJECTS = 64;
export const BUILDER_BACKUP_KEEP = 25;
export const BUILDER_WATCH_DEBOUNCE_MS = 500;

/** Directories the tree, the watcher and the search never descend into. */
export const BUILDER_HEAVY_DIRS = new Set([
  ".git", "node_modules", "dist", "out", "build", "target", ".venv", "venv", ".next", "__pycache__",
  ".cache", ".npm", ".arena", ".svelte-kit", ".turbo", ".parcel-cache", ".nuxt", ".output", "coverage", ".xr-backup",
]);

export function projectIdFor(realRoot: string): string {
  return createHash("sha1").update(realRoot).digest("hex").slice(0, 16);
}

export function xrHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.XR_HOME && env.XR_HOME.trim() ? env.XR_HOME : join(homedir(), ".xr"));
}

export type RootValidation = { ok: true; root: string; name: string } | { ok: false; error: string };

/**
 * Validate a candidate project root. Pure apart from the filesystem probes;
 * `env` is a seam so tests can point XR_HOME anywhere.
 */
export function validateProjectRoot(input: string, env: NodeJS.ProcessEnv = process.env): RootValidation {
  const candidate = typeof input === "string" ? input.trim() : "";
  if (!candidate) return { ok: false, error: "path is required" };
  if (!isAbsolute(candidate)) return { ok: false, error: "path must be absolute" };
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return { ok: false, error: "folder does not exist" };
  }
  let st;
  try {
    st = statSync(real);
  } catch {
    return { ok: false, error: "folder does not exist" };
  }
  if (!st.isDirectory()) return { ok: false, error: "path is not a folder" };
  const parsedRoot = resolve(real, "/");
  if (real === parsedRoot || /^[A-Za-z]:\\?$/.test(real)) return { ok: false, error: "the filesystem root cannot be a project" };
  let home = "";
  try {
    home = realpathSync(homedir());
  } catch {
    home = homedir();
  }
  if (real === home) return { ok: false, error: "the home folder itself cannot be a project — pick a folder inside it" };
  let xrHome = xrHomeDir(env);
  try {
    xrHome = realpathSync(xrHome);
  } catch {
    /* not created yet — compare the resolved string */
  }
  if (real === xrHome || real.startsWith(xrHome + sep)) return { ok: false, error: "XR's own state folder cannot be opened as a project" };
  return { ok: true, root: real, name: basename(real) || real };
}

export interface FsChangeListener {
  (paths: string[]): void;
}

interface WatchState {
  watcher: FSWatcher | null;
  listeners: Set<FsChangeListener>;
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

function shouldIgnore(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  return parts.some((p) => BUILDER_HEAVY_DIRS.has(p));
}

export class BuilderProjectRegistry {
  private readonly projects = new Map<string, BuilderProject>();
  private readonly watches = new Map<string, WatchState>();

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  open(path: string, name?: string): BuilderProject {
    const v = validateProjectRoot(path, this.env);
    if (!v.ok) throw new Error(v.error);
    const id = projectIdFor(v.root);
    const existing = this.projects.get(id);
    if (existing) {
      existing.openedAt = Date.now();
      if (name?.trim()) existing.name = name.trim().slice(0, 120);
      return existing;
    }
    if (this.projects.size >= BUILDER_MAX_PROJECTS) {
      // Evict the least recently opened project that nobody is watching.
      const victim = [...this.projects.values()]
        .filter((p) => !(this.watches.get(p.id)?.listeners.size ?? 0))
        .sort((a, b) => a.openedAt - b.openedAt)[0];
      if (!victim) throw new Error(`project cap reached (${BUILDER_MAX_PROJECTS}); close one first`);
      this.projects.delete(victim.id);
      this.stopWatch(victim.id);
    }
    const project: BuilderProject = { id, name: (name?.trim() || v.name).slice(0, 120), root: v.root, openedAt: Date.now() };
    this.projects.set(id, project);
    return project;
  }

  get(id: string): BuilderProject | undefined {
    return this.projects.get(id);
  }

  list(): BuilderProject[] {
    return [...this.projects.values()].sort((a, b) => b.openedAt - a.openedAt);
  }

  /** Subscribe to debounced, root-relative change batches. Returns unsubscribe. */
  subscribe(id: string, listener: FsChangeListener): () => void {
    const project = this.projects.get(id);
    if (!project) throw new Error("unknown project");
    let ws = this.watches.get(id);
    if (!ws) {
      ws = { watcher: null, listeners: new Set(), pending: new Set(), timer: null };
      this.watches.set(id, ws);
      ws.watcher = this.startWatcher(project, ws);
    }
    ws.listeners.add(listener);
    return () => {
      const cur = this.watches.get(id);
      if (!cur) return;
      cur.listeners.delete(listener);
      if (cur.listeners.size === 0) this.stopWatch(id);
    };
  }

  /** Native change feed; `recursive` is unsupported on some Linux kernels → null (callers poll instead). */
  private startWatcher(project: BuilderProject, ws: WatchState): FSWatcher | null {
    try {
      const w = watch(project.root, { recursive: true, persistent: false }, (_event, filename) => {
        const rel = typeof filename === "string" ? filename : filename ? String(filename) : "";
        if (!rel || shouldIgnore(rel)) return;
        if (ws.pending.size < 200) ws.pending.add(rel.split(sep).join("/"));
        if (ws.timer) return;
        ws.timer = setTimeout(() => {
          ws.timer = null;
          const batch = [...ws.pending];
          ws.pending.clear();
          for (const l of ws.listeners) {
            try {
              l(batch);
            } catch {
              /* listener errors never break the watcher */
            }
          }
        }, BUILDER_WATCH_DEBOUNCE_MS);
      });
      w.on("error", () => {
        /* a vanished root or EMFILE: stop quietly; the client's own refreshes still work */
      });
      return w;
    } catch {
      return null;
    }
  }

  private stopWatch(id: string): void {
    const ws = this.watches.get(id);
    if (!ws) return;
    if (ws.timer) clearTimeout(ws.timer);
    try {
      ws.watcher?.close();
    } catch {
      /* already closed */
    }
    this.watches.delete(id);
  }

  watching(id: string): boolean {
    return (this.watches.get(id)?.watcher ?? null) !== null;
  }

  closeAll(): void {
    for (const id of [...this.watches.keys()]) this.stopWatch(id);
  }
}

/* ── backups ──────────────────────────────────────────────────────────── */

export function backupsDirFor(projectId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(xrHomeDir(env), "builder-backups", projectId);
}

/** Name a backup for `rel` inside the project's backup folder; prunes old ones. */
export function nextBackupPath(projectId: string, rel: string, env: NodeJS.ProcessEnv = process.env): { backupId: string; path: string } {
  const dir = backupsDirFor(projectId, env);
  mkdirSync(dir, { recursive: true });
  const safe = rel.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
  const file = `${Date.now().toString(36)}-${safe}.bak`;
  try {
    const old = readdirSync(dir)
      .filter((f) => f.endsWith(".bak"))
      .sort();
    while (old.length >= BUILDER_BACKUP_KEEP) {
      const victim = old.shift();
      if (victim) rmSync(join(dir, victim), { force: true });
    }
  } catch {
    /* best effort */
  }
  return { backupId: `${projectId}/${file}`, path: join(dir, file) };
}

/** Resolve a backup id back to its file, strictly inside the backups folder of that project. */
export function resolveBackup(projectId: string, backupId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const m = /^([0-9a-f]{16})\/([A-Za-z0-9._-]+\.bak)$/.exec(backupId);
  if (!m || m[1] !== projectId) return null;
  const dir = backupsDirFor(projectId, env);
  const target = resolve(dir, m[2] ?? "");
  if (dirname(target) !== dir || !existsSync(target)) return null;
  return target;
}

/* ── singleton ────────────────────────────────────────────────────────── */

let registry: BuilderProjectRegistry | null = null;
export function getBuilderProjects(): BuilderProjectRegistry {
  registry ??= new BuilderProjectRegistry();
  return registry;
}
export function resetBuilderProjectsForTests(): void {
  registry?.closeAll();
  registry = null;
}
