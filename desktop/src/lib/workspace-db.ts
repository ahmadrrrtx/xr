/*
 * Workspaces persistence — typed contract with two implementations.
 *
 * Inside Tauri: the `workspaces_*` / helper Rust commands (xr.db, rusqlite
 * WAL — src-tauri/src/commands/workspaces.rs). In a plain browser (bun dev /
 * Playwright): a localStorage mirror with the same contract, so the whole
 * screen is testable without the native shell. Filesystem-backed behaviors
 * (scaffold, clone, reveal, trash) are simulated honestly in the mirror:
 *   - create  → a row under ~/xr/workspaces/<slug> (no real files)
 *   - clone   → staged progress events, then a row (no real git)
 *   - reveal  → reports it did NOT actually reveal (UI shows an honest toast)
 *   - spawn   → reports success counts; the UI explains windows need the app
 */
import { isTauri } from '@/lib/tauri';

import type {
  CloneProgress,
  SpawnResult,
  Workspace,
  WorkspacePatch,
} from '@/workspaces/types';

export interface WorkspaceDb {
  listWorkspaces(): Promise<Workspace[]>;
  getWorkspace(id: string): Promise<Workspace | null>;
  /** Scaffold a template into ~/xr/workspaces/<slug> (or an explicit folder). */
  createWorkspace(
    name: string,
    templateId: string,
    folder: string | null
  ): Promise<Workspace>;
  /** git clone with live progress; resolves to the stored workspace. */
  cloneWorkspace(
    url: string,
    name: string | null,
    onProgress: (p: CloneProgress) => void
  ): Promise<Workspace>;
  updateWorkspace(id: string, patch: WorkspacePatch): Promise<Workspace>;
  /** Returns true when the folder also went to the platform trash. */
  deleteWorkspace(id: string, deleteFiles: boolean): Promise<boolean>;
  /** Undo a row-only delete (files were left in place). */
  restoreWorkspace(ws: Workspace): Promise<void>;
  /** Metadata-only duplicate — same folder, new row. */
  duplicateWorkspace(id: string): Promise<Workspace>;
  /** True when the folder was actually opened in the OS file manager. */
  revealInFinder(path: string): Promise<boolean>;
  /** Native folder picker; null when the user cancels (or no native shell). */
  pickFolder(): Promise<string | null>;
  spawnWindows(ids: string[]): Promise<SpawnResult>;
  gitAvailable(): Promise<boolean>;
  detectStack(path: string): Promise<string[]>;
}

/* ── Tauri impl ─────────────────────────────────────────────────────────── */

type TauriInvoke = <T>(
  cmd: string,
  args?: Record<string, unknown>
) => Promise<T>;

async function getInvoke(): Promise<TauriInvoke> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke as unknown as TauriInvoke;
}

const tauriDb: WorkspaceDb = {
  async listWorkspaces() {
    const inv = await getInvoke();
    return inv<Workspace[]>('list_workspaces');
  },
  async getWorkspace(id) {
    const inv = await getInvoke();
    const ws = await inv<Workspace | null>('get_workspace', { id });
    return ws ?? null;
  },
  async createWorkspace(name, templateId, folder) {
    const inv = await getInvoke();
    return inv<Workspace>('create_workspace', {
      name,
      templateId,
      folder: folder ?? null,
    });
  },
  async cloneWorkspace(url, name, onProgress) {
    const { listen } = await import('@tauri-apps/api/event');
    const inv = await getInvoke();
    const unlisten = await listen<CloneProgress>(
      'workspace:clone-progress',
      (e) => {
        onProgress(e.payload);
      }
    );
    try {
      return await inv<Workspace>('clone_git_workspace', {
        url,
        name: name ?? null,
      });
    } finally {
      unlisten();
    }
  },
  async updateWorkspace(id, patch) {
    const inv = await getInvoke();
    return inv<Workspace>('update_workspace', { id, patch });
  },
  async deleteWorkspace(id, deleteFiles) {
    const inv = await getInvoke();
    return inv<boolean>('delete_workspace', { id, deleteFiles });
  },
  async restoreWorkspace(ws) {
    const inv = await getInvoke();
    await inv<void>('restore_workspace', { ws });
  },
  async duplicateWorkspace(id) {
    const inv = await getInvoke();
    return inv<Workspace>('duplicate_workspace', { id });
  },
  async revealInFinder(path) {
    const inv = await getInvoke();
    await inv<void>('reveal_in_finder', { path });
    return true;
  },
  async pickFolder() {
    const inv = await getInvoke();
    return (await inv<string | null>('pick_folder')) ?? null;
  },
  async spawnWindows(ids) {
    const inv = await getInvoke();
    return inv<SpawnResult>('spawn_workspace_windows', { ids });
  },
  async gitAvailable() {
    const inv = await getInvoke();
    return inv<boolean>('git_available');
  },
  async detectStack(path) {
    const inv = await getInvoke();
    return inv<string[]>('detect_stack', { path });
  },
};

/* ── Browser impl (localStorage dev seam) ───────────────────────────────── */

const LS_WORKSPACES = 'xr.workspaces.dev.v1';

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full/unavailable — session-only */
  }
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'workspace' : base;
}

function uniqueSlug(all: Workspace[], name: string): string {
  let slug = slugify(name);
  let n = 2;
  while (all.some((w) => w.slug === slug)) {
    slug = `${slugify(name)}-${n}`;
    n += 1;
  }
  return slug;
}

function sortWorkspaces(list: Workspace[]): Workspace[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ao = a.lastOpenedAt ?? 0;
    const bo = b.lastOpenedAt ?? 0;
    if (ao !== bo) return bo - ao;
    return a.name.localeCompare(b.name);
  });
}

const STACK_BY_TEMPLATE: Record<string, string[]> = {
  web: ['web', 'vite', 'ts'],
  python: ['python'],
  research: ['research'],
  custom: [],
  scratch: [],
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const browserDb: WorkspaceDb = {
  async listWorkspaces() {
    return sortWorkspaces(readLS<Workspace[]>(LS_WORKSPACES, []));
  },
  async getWorkspace(id) {
    return (
      readLS<Workspace[]>(LS_WORKSPACES, []).find((w) => w.id === id) ?? null
    );
  },
  async createWorkspace(name, templateId, folder) {
    const all = readLS<Workspace[]>(LS_WORKSPACES, []);
    const now = Date.now();
    const ws: Workspace = {
      id: crypto.randomUUID(),
      name: name.trim(),
      slug: uniqueSlug(all, name),
      path: folder?.trim() || `~/xr/workspaces/${slugify(name)}`,
      kind:
        (templateId === 'git' ? 'git' : (templateId as Workspace['kind'])) ||
        'custom',
      icon: null,
      stack: STACK_BY_TEMPLATE[templateId] ?? [],
      pinned: false,
      lastOpenedAt: null,
      createdAt: now,
      updatedAt: now,
      windowBounds: null,
      pathExists: true, // dev seam — the Rust side is what writes real files
    };
    writeLS(LS_WORKSPACES, [...all, ws]);
    return ws;
  },
  async cloneWorkspace(url, name, onProgress) {
    const stages: Array<[number, string]> = [
      [5, 'cloning'],
      [35, 'receiving'],
      [70, 'receiving'],
      [85, 'resolving'],
      [100, 'done'],
    ];
    for (const [percent, stage] of stages) {
      await sleep(220);
      onProgress({ percent, stage });
    }
    const repo =
      url
        .trim()
        .split('/')
        .pop()
        ?.replace(/\.git$/, '') ?? 'repo';
    const all = readLS<Workspace[]>(LS_WORKSPACES, []);
    const now = Date.now();
    const ws: Workspace = {
      id: crypto.randomUUID(),
      name: name?.trim() || repo,
      slug: uniqueSlug(all, name?.trim() || repo),
      path: `~/xr/workspaces/${slugify(name?.trim() || repo)}`,
      kind: 'git',
      icon: null,
      stack: ['git'],
      pinned: false,
      lastOpenedAt: null,
      createdAt: now,
      updatedAt: now,
      windowBounds: null,
      pathExists: true,
    };
    writeLS(LS_WORKSPACES, [...all, ws]);
    return ws;
  },
  async updateWorkspace(id, patch) {
    const all = readLS<Workspace[]>(LS_WORKSPACES, []);
    const ws = all.find((w) => w.id === id);
    if (!ws) throw new Error(`workspace ${id} not found`);
    Object.assign(ws, {
      ...patch,
      windowBounds:
        patch.windowBounds === undefined ? ws.windowBounds : patch.windowBounds,
      updatedAt: Date.now(),
    });
    writeLS(LS_WORKSPACES, all);
    return ws;
  },
  async deleteWorkspace(id) {
    const all = readLS<Workspace[]>(LS_WORKSPACES, []);
    const ws = all.find((w) => w.id === id);
    writeLS(
      LS_WORKSPACES,
      all.filter((w) => w.id !== id)
    );
    // Dev seam: nothing real was trashed — report it so the UI stays honest.
    return ws?.pathExists === false;
  },
  async restoreWorkspace(ws) {
    const all = readLS<Workspace[]>(LS_WORKSPACES, []);
    if (!all.some((w) => w.id === ws.id)) {
      writeLS(LS_WORKSPACES, [...all, ws]);
    }
  },
  async duplicateWorkspace(id) {
    const all = readLS<Workspace[]>(LS_WORKSPACES, []);
    const src = all.find((w) => w.id === id);
    if (!src) throw new Error(`workspace ${id} not found`);
    const now = Date.now();
    const ws: Workspace = {
      ...src,
      id: crypto.randomUUID(),
      name: `${src.name} (copy)`,
      slug: uniqueSlug(all, `${src.name} (copy)`),
      pinned: false,
      lastOpenedAt: null,
      windowBounds: null,
      createdAt: now,
      updatedAt: now,
    };
    writeLS(LS_WORKSPACES, [...all, ws]);
    return ws;
  },
  async revealInFinder() {
    // No native shell — the UI must show the honest toast, not pretend.
    return false;
  },
  async pickFolder() {
    return null;
  },
  async spawnWindows(ids) {
    // Dev seam: counts are truthful about the request, not about windows.
    return { opened: ids.length, failed: 0 };
  },
  async gitAvailable() {
    return true;
  },
  async detectStack() {
    return [];
  },
};

/** The active backend — Tauri when hosted, localStorage mirror in browser. */
export const workspaceDb: WorkspaceDb = isTauri() ? tauriDb : browserDb;
