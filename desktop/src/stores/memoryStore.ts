/*
 * Memory Explorer (Phase 21) — Zustand.
 *
 *   entries   the engine's list (exclusions + expired opt-in), refreshed after every write
 *   search    engine recall ids for the current query (semantic → lexical, engine-decided)
 *   graph     the engine's heuristic graph, loaded when the Graph tab opens
 *   dialogs   at most one of import / clear / settings open at a time
 *
 * Writes always call the engine first; the list only changes from the engine's
 * answer. Undo after a delete re-creates the entry through the same write path
 * (new id, same content, scope, tags, importance and expiry).
 */
import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { EngineDown } from '@/engine/transport';
import {
  describeMemoryError,
  clearAllMemory,
  createMemory,
  deleteMemory,
  exportMemory,
  fetchMemoryGraph,
  importMemory,
  listMemory,
  searchMemory,
  updateMemory,
  type CreateInput,
  type WriteResponse,
  saveShowExpired,
} from '@/memory/api';
import { previewImport, restoreBody, type CategoryFilter, type MemoryGraphData, type MemoryView, type ScopeFilter } from '@/memory/core';

export type Tab = 'list' | 'graph';
export type Dialog = null | 'import' | 'clear' | 'settings';

interface MemoryState {
  entries: MemoryView[];
  stats: Array<{ category: string; c: number }>;
  loading: boolean;
  error: string | null;
  engineDown: boolean;

  query: string;
  matchIds: Set<string> | null;
  searching: boolean;

  category: CategoryFilter;
  scope: ScopeFilter;
  showExpired: boolean;
  tab: Tab;
  selectedId: string | null;

  graph: MemoryGraphData | null;
  graphLoading: boolean;
  graphError: string | null;

  dialog: Dialog;

  load: () => Promise<void>;
  setQuery: (q: string) => Promise<void>;
  setCategory: (c: CategoryFilter) => void;
  setScope: (s: ScopeFilter) => void;
  setShowExpired: (v: boolean) => Promise<void>;
  setTab: (t: Tab) => void;
  select: (id: string | null) => void;
  setDialog: (d: Dialog) => void;

  add: (input: CreateInput) => Promise<WriteResponse>;
  update: (id: string, patch: Partial<CreateInput>) => Promise<WriteResponse>;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<number>;
  exportAll: () => Promise<string | null>;
  importText: (text: string, mode: 'merge' | 'replace') => Promise<{ added: number; skippedSensitive: number } | null>;
  loadGraph: () => Promise<void>;
}

function errorState(e: unknown): { error: string; engineDown: boolean } {
  if (e instanceof EngineDown) return { error: 'The engine is not reachable. Memory will load when it is back.', engineDown: true };
  return { error: describeMemoryError(e), engineDown: false };
}

/** Latest-wins guard so a slow search never overwrites a newer query's result. */
let searchSeq = 0;
let loadSeq = 0;

export const useMemoryStore = create<MemoryState>()(
  persist(
    (set, get) => ({
      entries: [],
      stats: [],
      loading: false,
      error: null,
      engineDown: false,

      query: '',
      matchIds: null,
      searching: false,

      category: 'all',
      scope: 'all',
      showExpired: false,
      tab: 'list',
      selectedId: null,

      graph: null,
      graphLoading: false,
      graphError: null,

      dialog: null,

      load: async () => {
        const seq = ++loadSeq;
        set({ loading: true });
        try {
          const res = await listMemory({ exclusions: true, expired: get().showExpired });
          if (seq !== loadSeq) return;
          set((s) => ({
            entries: res.entries,
            stats: res.stats,
            loading: false,
            error: null,
            engineDown: false,
            selectedId: s.selectedId && res.entries.some((e) => e.id === s.selectedId) ? s.selectedId : null,
          }));
        } catch (e) {
          if (seq !== loadSeq) return;
          set({ loading: false, ...errorState(e) });
        }
      },

      setQuery: async (q) => {
        const seq = ++searchSeq;
        set({ query: q });
        const trimmed = q.trim();
        if (!trimmed) {
          set({ matchIds: null, searching: false });
          return;
        }
        set({ searching: true });
        try {
          const ids = await searchMemory(trimmed);
          if (seq !== searchSeq) return;
          set({ matchIds: ids, searching: false });
        } catch (e) {
          if (seq !== searchSeq) return;
          set({ matchIds: null, searching: false, ...errorState(e) });
        }
      },

      setCategory: (c) => set({ category: c }),
      setScope: (s) => set({ scope: s }),

      setShowExpired: async (v) => {
        set({ showExpired: v });
        // The engine owns this setting; the local value is only a cache until the save lands.
        try {
          await saveShowExpired(v);
        } catch (e) {
          set(errorState(e));
        }
        await get().load();
      },

      setTab: (t) => {
        set({ tab: t });
        if (t === 'graph' && !get().graph) void get().loadGraph();
      },

      select: (id) => set({ selectedId: id }),
      setDialog: (d) => set({ dialog: d }),

      add: async (input) => {
        let res: WriteResponse;
        try {
          res = await createMemory(input);
        } catch (e) {
          toast.error('Not saved', { description: describeMemoryError(e) });
          return { ok: false, reason: describeMemoryError(e) };
        }
        if (!res.ok) {
          // Sensitive content is the caller's decision (the composer asks); anything else is a refusal.
          if (res.reason !== 'sensitive') toast.error('Not saved', { description: res.reason ?? 'The engine refused this memory.' });
          return res;
        }
        const entry = res.entry ?? null;
        await get().load();
        if (entry) set({ selectedId: entry.id });
        if (!res.duplicate) {
          toast('Remembered', {
            description: 'Saved on this device.',
            duration: 5000,
            action: entry
              ? {
                  label: 'Undo',
                  onClick: () => {
                    void deleteMemory(entry.id).then(() => get().load());
                  },
                }
              : undefined,
          });
        } else {
          toast('Already remembered', { description: 'An identical memory exists.' });
        }
        return res;
      },

      update: async (id, patch) => {
        const res = await updateMemory(id, patch);
        if (res.ok && res.entry) {
          const updated = res.entry;
          set((s) => ({ entries: s.entries.map((e) => (e.id === id ? updated : e)) }));
          void get().load();
        }
        return res;
      },

      remove: async (id) => {
        const snapshot = get().entries.find((e) => e.id === id);
        if (!snapshot) return;
        const nextSelected = neighbourAfter(get().entries, id);
        try {
          await deleteMemory(id);
        } catch (e) {
          toast.error('Not deleted', { description: describeMemoryError(e) });
          return;
        }
        set((s) => ({
          entries: s.entries.filter((e) => e.id !== id),
          selectedId: s.selectedId === id ? nextSelected : s.selectedId,
          graph: null,
        }));
        toast('Deleted', {
          description: 'You have 10 seconds to undo.',
          duration: 10_000,
          action: {
            label: 'Undo',
            onClick: () => {
              void createMemory(restoreBody(snapshot)).then((r) => {
                if (!r.ok) toast.error('Could not restore', { description: r.reason ?? '' });
                void get().load();
              });
            },
          },
        });
      },

      clearAll: async () => {
        const res = await clearAllMemory();
        set({ selectedId: null, graph: null });
        await get().load();
        return res.removed;
      },

      exportAll: async () => {
        const bundle = await exportMemory();
        const name = `xr-memory-${new Date().toISOString().slice(0, 10)}.json`;
        const text = JSON.stringify(bundle, null, 2);
        try {
          const { isTauri } = await import('@/lib/tauri');
          if (isTauri()) {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const path = await save({ defaultPath: name, filters: [{ name: 'XR memory', extensions: ['json'] }] });
            if (!path) return null;
            const { writeTextFile } = await import('@tauri-apps/plugin-fs');
            await writeTextFile(path, text);
            return path;
          }
        } catch {
          /* fall back to a browser download */
        }
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        return name;
      },

      importText: async (text, mode) => {
        const pre = previewImport(text);
        if (!pre.ok) {
          toast.error('Import stopped', { description: pre.reason });
          return null;
        }
        const res = await importMemory(JSON.parse(text), mode);
        await get().load();
        return { added: res.added, skippedSensitive: res.skippedSensitive };
      },

      loadGraph: async () => {
        set({ graphLoading: true, graphError: null });
        try {
          const graph = await fetchMemoryGraph();
          set({ graph, graphLoading: false });
        } catch (e) {
          set({ graphLoading: false, ...errorState(e) });
        }
      },
    }),
    {
      name: 'xr.memory.prefs',
      partialize: (s) => ({ showExpired: s.showExpired, tab: s.tab }),
    },
  ),
);

/** Pick the row to select after `id` leaves the visible list (next, else previous). */
export function neighbourAfter(entries: readonly MemoryView[], id: string): string | null {
  const i = entries.findIndex((e) => e.id === id);
  if (i < 0) return null;
  return entries[i + 1]?.id ?? entries[i - 1]?.id ?? null;
}
