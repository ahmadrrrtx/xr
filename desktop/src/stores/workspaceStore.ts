/*
 * Phase 10 — workspace screen state (brief §4, SCREEN 3).
 *
 * The store owns the screen's working set (loaded workspaces, filter, search,
 * multi-select, clone progress). viewMode / filter / templateStripCollapsed
 * persist through the Phase 8 settings store (`workspaces` group). All
 * persistence rides the workspaceDb contract (Tauri ↔ browser dev seam).
 */
import { create } from 'zustand';

import { toast } from 'sonner';

import { workspaceDb } from '@/lib/workspace-db';
import { isTauri } from '@/lib/tauri';
import { useSettingsStore } from '@/stores/settingsStore';
import type {
  CloneProgress,
  SpawnResult,
  Workspace,
  WorkspacePatch,
} from '@/workspaces/types';

export type WorkspaceFilter = 'all' | 'pinned' | 'recent' | 'git';
export type WorkspaceViewMode = 'grid' | 'list';

const RECENT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface WorkspaceState {
  workspaces: Workspace[];
  loading: boolean;
  loaded: boolean;
  error: string | null;

  filter: WorkspaceFilter;
  search: string;
  viewMode: WorkspaceViewMode;
  templateStripCollapsed: boolean;

  multiSelect: boolean;
  selectedIds: string[];
  focusedId: string | null;

  // New-workspace modal
  modalOpen: boolean;
  modalTemplate: string | null;
  creating: boolean;
  cloneBusy: boolean;
  cloneProgress: CloneProgress | null;
  cloneError: string | null;

  // Launch result (last spawn, for toasts/tests)
  lastLaunch: SpawnResult | null;

  refresh(): Promise<void>;
  setFilter(f: WorkspaceFilter): void;
  setSearch(q: string): void;
  setViewMode(m: WorkspaceViewMode): void;
  setStripCollapsed(v: boolean): void;

  openModal(templateId?: string | null): void;
  closeModal(): void;
  create(
    name: string,
    templateId: string,
    folder: string | null
  ): Promise<Workspace | null>;
  clone(url: string, name: string | null): Promise<Workspace | null>;

  togglePin(ws: Workspace): Promise<void>;
  rename(ws: Workspace, name: string): Promise<void>;
  setIcon(ws: Workspace, icon: string): Promise<void>;
  remove(id: string, deleteFiles: boolean): Promise<boolean>;
  duplicate(id: string): Promise<Workspace | null>;
  reveal(ws: Workspace): Promise<void>;
  locate(ws: Workspace): Promise<void>;
  touch(id: string): Promise<void>;
  launch(ids: string[]): Promise<SpawnResult | null>;

  enterMultiSelect(id?: string): void;
  exitMultiSelect(): void;
  toggleSelected(id: string): void;
  selectAll(ids: string[]): void;
  focusId(id: string | null): void;
}

function settingsView(): {
  mode: WorkspaceViewMode;
  filter: WorkspaceFilter;
  strip: boolean;
} {
  const w = useSettingsStore.getState().settings.workspaces;
  return {
    mode: w.viewMode,
    filter: w.filter,
    strip: w.templateStripCollapsed,
  };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  loading: false,
  loaded: false,
  error: null,

  filter: settingsView().filter,
  search: '',
  viewMode: settingsView().mode,
  templateStripCollapsed: settingsView().strip,

  multiSelect: false,
  selectedIds: [],
  focusedId: null,

  modalOpen: false,
  modalTemplate: null,
  creating: false,
  cloneBusy: false,
  cloneProgress: null,
  cloneError: null,

  lastLaunch: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const workspaces = await workspaceDb.listWorkspaces();
      set({ workspaces, loading: false, loaded: true });
    } catch (e) {
      set({
        loading: false,
        loaded: true,
        error: e instanceof Error ? e.message : 'Could not load workspaces',
      });
    }
  },

  setFilter: (f) => {
    set({ filter: f });
    useSettingsStore.getState().setPath('workspaces.filter', f);
  },

  setSearch: (q) => set({ search: q }),

  setViewMode: (m) => {
    set({ viewMode: m });
    useSettingsStore.getState().setPath('workspaces.viewMode', m);
  },

  setStripCollapsed: (v) => {
    set({ templateStripCollapsed: v });
    useSettingsStore.getState().setPath('workspaces.templateStripCollapsed', v);
  },

  openModal: (templateId) =>
    set({
      modalOpen: true,
      modalTemplate: templateId ?? null,
      cloneProgress: null,
      cloneError: null,
    }),
  closeModal: () => {
    if (get().cloneBusy) return; // never close mid-clone
    set({ modalOpen: false, cloneProgress: null });
  },

  create: async (name, templateId, folder) => {
    set({ creating: true, cloneError: null });
    try {
      const ws = await workspaceDb.createWorkspace(name, templateId, folder);
      set({ creating: false, modalOpen: false });
      await get().refresh();
      toast(`Workspace created — ${ws.name}`, {
        description: ws.path,
      });
      return ws;
    } catch (e) {
      set({ creating: false });
      set({
        cloneError:
          e instanceof Error ? e.message : 'Could not create workspace',
      });
      return null;
    }
  },

  clone: async (url, name) => {
    set({ cloneBusy: true, cloneProgress: { percent: 0, stage: 'cloning' } });
    try {
      const ws = await workspaceDb.cloneWorkspace(url, name, (p) =>
        set({ cloneProgress: p })
      );
      set({ cloneBusy: false, modalOpen: false, cloneProgress: null });
      await get().refresh();
      toast(`Cloned — ${ws.name}`, { description: ws.path });
      return ws;
    } catch (e) {
      set({
        cloneBusy: false,
        cloneProgress: { percent: 0, stage: 'error' },
        cloneError: e instanceof Error ? e.message : 'Clone failed',
      });
      return null;
    }
  },

  togglePin: async (ws) => {
    try {
      await workspaceDb.updateWorkspace(ws.id, { pinned: !ws.pinned });
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id === ws.id ? { ...w, pinned: !w.pinned } : w
        ),
      }));
      toast(ws.pinned ? 'Unpinned' : 'Pinned', { description: ws.name });
    } catch (e) {
      toast('Could not update workspace', {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  },

  rename: async (ws, name) => {
    try {
      await workspaceDb.updateWorkspace(ws.id, { name });
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id === ws.id ? { ...w, name } : w
        ),
      }));
      toast('Renamed', { description: name });
    } catch (e) {
      toast('Could not rename', {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  },

  setIcon: async (ws, icon) => {
    try {
      await workspaceDb.updateWorkspace(ws.id, { icon });
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id === ws.id ? { ...w, icon } : w
        ),
      }));
    } catch {
      /* non-critical */
    }
  },

  remove: async (id, deleteFiles) => {
    const ws = get().workspaces.find((w) => w.id === id);
    try {
      const trashed = await workspaceDb.deleteWorkspace(id, deleteFiles);
      set((s) => ({
        workspaces: s.workspaces.filter((w) => w.id !== id),
        selectedIds: s.selectedIds.filter((x) => x !== id),
      }));
      if (ws) {
        if (!deleteFiles) {
          toast('Workspace deleted — files left in place', {
            description: ws.path,
            action: {
              label: 'Undo',
              onClick: () => {
                void (async () => {
                  try {
                    await workspaceDb.restoreWorkspace(ws);
                    await get().refresh();
                    toast('Restored', { description: ws.name });
                  } catch {
                    toast('Could not restore workspace');
                  }
                })();
              },
            },
          });
        } else if (trashed && isTauri()) {
          toast('Workspace deleted — files moved to trash');
        } else {
          toast('Workspace deleted', {
            description:
              'The files could not be moved to trash — they are still on disk.',
          });
        }
      }
      return true;
    } catch (e) {
      toast('Could not delete workspace', {
        description: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  },

  duplicate: async (id) => {
    const ws = get().workspaces.find((w) => w.id === id);
    try {
      const copy = await workspaceDb.duplicateWorkspace(id);
      await get().refresh();
      toast('Duplicated', {
        description: `Points at the same folder as ${ws?.name ?? 'the original'} — files were not copied.`,
      });
      return copy;
    } catch (e) {
      toast('Could not duplicate', {
        description: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  },

  reveal: async (ws) => {
    try {
      const revealed = await workspaceDb.revealInFinder(ws.path);
      if (revealed) {
        toast('Revealed in file manager', { description: ws.path });
      } else {
        toast('Reveal needs the app shell', {
          description: 'In the browser preview this action is a no-op.',
        });
      }
    } catch (e) {
      toast('Could not reveal folder', {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  },

  locate: async (ws) => {
    // Path missing → native folder picker to point at the real folder.
    if (!isTauri()) {
      toast('Locate needs the app shell', {
        description: 'In the browser preview this action is a no-op.',
      });
      return;
    }
    const picked = await workspaceDb.pickFolder();
    if (picked) {
      try {
        await workspaceDb.updateWorkspace(ws.id, { path: picked });
        await get().refresh();
        toast('Path updated', { description: picked });
      } catch (e) {
        toast('Could not update path', {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    }
  },

  touch: async (id) => {
    try {
      await workspaceDb.updateWorkspace(id, { lastOpenedAt: Date.now() });
    } catch {
      /* non-critical */
    }
  },

  launch: async (ids) => {
    try {
      const result = await workspaceDb.spawnWindows(ids);
      set({ lastLaunch: result });
      if (!isTauri()) {
        toast('Dev mode — windows need the app shell', {
          description: `${ids.length} workspace window${ids.length === 1 ? '' : 's'} would open in the Tauri build.`,
        });
      } else if (result.failed > 0) {
        toast('Some windows failed to open', {
          description: `${result.opened} opened, ${result.failed} failed.`,
        });
      } else {
        toast(
          result.opened === 1
            ? 'Window opened'
            : `${result.opened} windows opened`
        );
      }
      return result;
    } catch (e) {
      toast('Could not open windows', {
        description: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  },

  enterMultiSelect: (id) =>
    set({ multiSelect: true, selectedIds: id ? [id] : [] }),
  exitMultiSelect: () => set({ multiSelect: false, selectedIds: [] }),
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  selectAll: (ids) => set({ selectedIds: ids }),
  focusId: (id) => set({ focusedId: id }),
}));

/* ── Derived helpers (pure — testable outside React) ────────────────────── */

export function filterWorkspaces(
  workspaces: readonly Workspace[],
  filter: WorkspaceFilter,
  search: string,
  now = Date.now()
): Workspace[] {
  const q = search.trim().toLowerCase();
  return workspaces.filter((w) => {
    if (filter === 'pinned' && !w.pinned) return false;
    if (
      filter === 'recent' &&
      (w.lastOpenedAt === null || now - w.lastOpenedAt > RECENT_MS)
    )
      return false;
    if (filter === 'git' && w.kind !== 'git') return false;
    if (q) {
      const hay = `${w.name} ${w.path} ${w.stack.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Pinned first, then most recently opened — matches the Rust query order. */
export function orderWorkspaces(workspaces: readonly Workspace[]): Workspace[] {
  return [...workspaces].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ao = a.lastOpenedAt ?? 0;
    const bo = b.lastOpenedAt ?? 0;
    if (ao !== bo) return bo - ao;
    return a.name.localeCompare(b.name);
  });
}

export function filterCounts(
  workspaces: readonly Workspace[],
  now = Date.now()
): Record<WorkspaceFilter, number> {
  return {
    all: workspaces.length,
    pinned: workspaces.filter((w) => w.pinned).length,
    recent: workspaces.filter(
      (w) => w.lastOpenedAt !== null && now - w.lastOpenedAt <= RECENT_MS
    ).length,
    git: workspaces.filter((w) => w.kind === 'git').length,
  };
}

/** Apply a patch in-memory first (optimistic) — returns the next list. */
export function withPatch(
  workspaces: readonly Workspace[],
  id: string,
  patch: WorkspacePatch
): Workspace[] {
  return workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w));
}
