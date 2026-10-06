/*
 * Builder state (Phase 17) — the ONE store for the Builder surface.
 *
 * Owns: the open project (engine-registered root), the tree + git badges,
 * tabs/buffers/dirty state, the selection the chat sees, the dev server /
 * console, the live event feed and pane visibility. The CodeMirror view
 * owns the live document (typing never round-trips through Zustand): the
 * editor registers a getter per path and the store reads it only when it
 * saves, auto-saves or builds chat context.
 *
 * Every write goes through `engine/builder.ts` consent streams — the
 * approval modal appears here, the engine writes only after the decision.
 */
import { create } from 'zustand';
import { toast } from 'sonner';

import {
  applyDiff,
  BuilderConflict,
  BuilderDenied,
  createEntry,
  deleteEntry,
  fetchDevServer,
  fetchGit,
  fetchTree,
  installDeps,
  openProject,
  readFile,
  renameEntry,
  startDevServer,
  stopDevServer,
  subscribeEvents,
  undoApply,
  writeFile,
  type BuilderEvent,
  type BuilderGit,
  type BuilderProject,
  type DetectedDevServer,
  type DevServerStatus,
  type Diagnostic,
} from '@/engine/builder';
import { EngineDown, EngineHttpError } from '@/engine/transport';
import {
  ancestorsOf,
  basenameOf,
  classifyConsoleLine,
  touchMru,
  type ConsoleLevel,
  type DiffBlock,
  type PreviewDevice,
  type TreeEntry,
} from '@/lib/builderCore';
import { readSettingJSON, writeSettingJSON } from '@/lib/persistent-store';
import type { Workspace } from '@/workspaces/types';

export interface BufferState {
  path: string;
  /** Content as last loaded from or written to disk. */
  content: string;
  mtimeMs: number;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  isText: boolean;
  truncated: boolean;
  /** Bumps when disk content replaces the editor document (apply, undo, reload). */
  revision: number;
}

export interface TabState {
  path: string;
  /** Single-click opens a preview tab (replaced by the next preview); double-click pins. */
  pinned: boolean;
}

export interface ConsoleLine {
  id: number;
  ts: number;
  level: ConsoleLevel;
  text: string;
  stream: 'stdout' | 'stderr' | 'system';
}

export interface LineFlash {
  path: string;
  line: number;
  until: number;
  /** Diff gutter flash marks a line range instead of one line. */
  to?: number;
  kind: 'jump' | 'applied';
}

export type SyncState = 'saved' | 'saving' | 'unsaved' | 'error';
export type BusyKind = 'starting' | 'installing' | 'stopping' | null;

interface PendingClose {
  path: string;
  resolve: (choice: 'save' | 'discard' | 'cancel') => void;
}

export interface BuilderState {
  workspaceId: string | null;
  workspace: Workspace | null;
  project: BuilderProject | null;
  projectError: string | null;
  projectLoading: boolean;

  tree: TreeEntry[];
  treeLoading: boolean;
  treeTruncated: boolean;
  git: BuilderGit | null;
  expanded: Set<string>;

  tabs: TabState[];
  active: string | null;
  mru: string[];
  buffers: Record<string, BufferState>;
  cursor: { line: number; col: number };
  selection: string;
  sync: SyncState;
  autoSave: boolean;
  autoSavePaused: boolean;
  diagnostics: Record<string, Diagnostic[]>;
  diagnosticsAvailable: boolean | null;
  flash: LineFlash | null;
  pendingClose: PendingClose | null;

  treeVisible: boolean;
  terminalVisible: boolean;
  wrap: boolean;
  minimap: boolean;

  detected: DetectedDevServer | null;
  devServer: DevServerStatus | null;
  busy: BusyKind;
  consoleLines: ConsoleLine[];
  consoleFilter: ConsoleLevel | 'all';
  previewDevice: PreviewDevice;
  previewUrlOverride: string | null;
  previewNonce: number;
  previewError: string | null;
  eventsConnected: boolean;
  terminalTail: string[];
  lastUndo: { path: string; backupId: string } | null;

  openWorkspace: (ws: Workspace) => Promise<void>;
  close: () => void;
  refreshTree: () => Promise<void>;
  refreshGit: () => Promise<void>;
  toggleExpanded: (rel: string) => void;
  revealPath: (rel: string) => void;

  openFile: (path: string, opts?: { pin?: boolean; line?: number; col?: number }) => Promise<void>;
  reloadFile: (path: string) => Promise<void>;
  setActive: (path: string) => void;
  pinTab: (path: string) => void;
  closeTab: (path: string, force?: boolean) => Promise<boolean>;
  closeOthers: (path: string) => Promise<void>;
  resolveClose: (choice: 'save' | 'discard' | 'cancel') => void;
  markDirty: (path: string, dirty: boolean) => void;
  setCursor: (line: number, col: number) => void;
  setSelection: (text: string) => void;
  saveFile: (path?: string) => Promise<boolean>;
  saveAll: () => Promise<void>;
  setAutoSave: (on: boolean) => void;
  setDiagnostics: (path: string, list: Diagnostic[], available: boolean | null) => void;
  flashLine: (path: string, line: number, kind: LineFlash['kind'], to?: number) => void;

  applyBlock: (block: DiffBlock, hunks: number[] | undefined) => Promise<{ ok: boolean; applied: number }>;
  undoLast: () => Promise<void>;
  createPath: (path: string, kind: 'file' | 'folder') => Promise<boolean>;
  renamePath: (from: string, to: string) => Promise<boolean>;
  deletePath: (path: string) => Promise<boolean>;

  toggleTree: () => void;
  toggleTerminal: (open?: boolean) => void;
  toggleWrap: () => void;
  toggleMinimap: () => void;

  refreshDevServer: () => Promise<void>;
  startDev: (cmd?: string) => Promise<void>;
  stopDev: () => Promise<void>;
  install: () => Promise<void>;
  clearConsole: () => void;
  setConsoleFilter: (f: ConsoleLevel | 'all') => void;
  setPreviewDevice: (d: PreviewDevice) => void;
  setPreviewUrlOverride: (url: string | null) => void;
  reloadPreview: () => void;
  setPreviewError: (e: string | null) => void;
  setTerminalTail: (lines: string[]) => void;
}

/* ── live document registry (editor ↔ store seam) ──────────────────────── */

const docGetters = new Map<string, () => string>();
/** The editor registers how to read its live document for `path`. */
export function registerDocGetter(path: string, getter: (() => string) | null): void {
  if (getter) docGetters.set(path, getter);
  else docGetters.delete(path);
}
/** Live editor text when open, else the last known disk content. */
export function liveContent(path: string): string | null {
  const g = docGetters.get(path);
  if (g) return g();
  return useBuilderStore.getState().buffers[path]?.content ?? null;
}

const autoSaveTimers = new Map<string, number>();
const saveControllers = new Map<string, AbortController>();
let unsubscribeEvents: (() => void) | null = null;
let consoleSeq = 0;
let treeRefreshTimer: number | null = null;
const AUTO_SAVE_MS = 1_000;
const CONSOLE_CAP = 1_000;

const KEYS = {
  tree: 'xr.builder.tree.visible',
  wrap: 'xr.builder.editor.wrap',
  minimap: 'xr.builder.editor.minimap',
  autoSave: 'xr.builder.editor.autosave',
  device: 'xr.builder.preview.device',
} as const;

/**
 * A denial the human made in the modal needs no second message. A policy
 * block never showed a modal, so it is the one denial the Builder must
 * explain — with the way to change it (Constitution VII.3).
 */
function explainDenied(e: unknown, what: string): boolean {
  if (!(e instanceof BuilderDenied)) return false;
  if (e.blocked) {
    toast(`${what} blocked by XR Shield`, {
      description: e.reason ?? 'A Shield policy declined this action.',
      action: {
        label: 'Open Shield',
        onClick: () => {
          void import('@/router').then(({ router }) => router.navigate('/shield?tab=security'));
        },
      },
      duration: 8000,
    });
  }
  return true;
}

function describe(e: unknown): string {
  if (e instanceof BuilderDenied) return e.blocked && e.reason ? e.reason : e.timedOut ? 'Approval timed out' : 'Not approved';
  if (e instanceof BuilderConflict) return e.message;
  if (e instanceof EngineDown) return e.kind === 'unauthorized' ? 'Engine rejected the session — reconnect from Settings' : 'Engine unreachable';
  if (e instanceof EngineHttpError) return e.message;
  if (e instanceof DOMException && e.name === 'AbortError') return 'Cancelled';
  return e instanceof Error ? e.message : String(e);
}

function consoleLine(stream: ConsoleLine['stream'], text: string, ts = Date.now()): ConsoleLine {
  consoleSeq += 1;
  return { id: consoleSeq, ts, level: classifyConsoleLine(text, stream), text, stream };
}

export const useBuilderStore = create<BuilderState>((set, get) => {
  const patchBuffer = (path: string, patch: Partial<BufferState>): void =>
    set((st) => {
      const cur = st.buffers[path];
      if (!cur) return st;
      return { buffers: { ...st.buffers, [path]: { ...cur, ...patch } } };
    });

  const recomputeSync = (): void => {
    const st = get();
    if (st.sync === 'saving') return;
    const dirty = Object.values(st.buffers).some((b) => b.dirty);
    set({ sync: dirty ? 'unsaved' : st.sync === 'error' ? 'error' : 'saved' });
  };

  const scheduleAutoSave = (path: string): void => {
    const prev = autoSaveTimers.get(path);
    if (prev) window.clearTimeout(prev);
    autoSaveTimers.set(
      path,
      window.setTimeout(() => {
        autoSaveTimers.delete(path);
        const st = get();
        if (!st.autoSave || st.autoSavePaused) return;
        if (!st.buffers[path]?.dirty) return;
        void st.saveFile(path);
      }, AUTO_SAVE_MS),
    );
  };

  const scheduleTreeRefresh = (): void => {
    if (treeRefreshTimer) return;
    treeRefreshTimer = window.setTimeout(() => {
      treeRefreshTimer = null;
      void get().refreshTree();
    }, 500);
  };

  const onEvent = (e: BuilderEvent): void => {
    switch (e.type) {
      case 'hello':
        if (e.status) set({ devServer: e.status });
        return;
      case 'dev-server:log': {
        set((st) => {
          const next = [...st.consoleLines, consoleLine(e.entry.stream, e.entry.line, e.entry.ts)];
          return { consoleLines: next.length > CONSOLE_CAP ? next.slice(-CONSOLE_CAP) : next };
        });
        return;
      }
      case 'dev-server:status':
        set({ devServer: e.status, previewError: e.status.state === 'running' ? null : get().previewError });
        return;
      case 'dev-server:ready':
        set({ previewError: null, previewNonce: get().previewNonce + 1 });
        return;
      case 'dev-server:exit':
        if (e.job === 'server') {
          const code = e.code;
          if (code !== null && code !== 0) toast('Dev server exited', { description: `Exit code ${code}. See the console for the last lines.` });
        }
        return;
      case 'fs:changed': {
        scheduleTreeRefresh();
        const st = get();
        for (const p of e.paths) {
          const buf = st.buffers[p];
          if (buf && !buf.dirty && !buf.loading) void st.reloadFile(p);
        }
        return;
      }
      default:
        return;
    }
  };

  return {
    workspaceId: null,
    workspace: null,
    project: null,
    projectError: null,
    projectLoading: false,
    tree: [],
    treeLoading: false,
    treeTruncated: false,
    git: null,
    expanded: new Set<string>(),
    tabs: [],
    active: null,
    mru: [],
    buffers: {},
    cursor: { line: 1, col: 1 },
    selection: '',
    sync: 'saved',
    autoSave: true,
    autoSavePaused: false,
    diagnostics: {},
    diagnosticsAvailable: null,
    flash: null,
    pendingClose: null,
    treeVisible: true,
    terminalVisible: false,
    wrap: false,
    minimap: false,
    detected: null,
    devServer: null,
    busy: null,
    consoleLines: [],
    consoleFilter: 'all',
    previewDevice: 'desktop',
    previewUrlOverride: null,
    previewNonce: 0,
    previewError: null,
    eventsConnected: false,
    terminalTail: [],
    lastUndo: null,

    openWorkspace: async (ws) => {
      const st = get();
      if (st.workspaceId === ws.id && st.project) return;
      st.close();
      set({ workspaceId: ws.id, workspace: ws, projectLoading: true, projectError: null });
      const [treeVisible, wrap, minimap, autoSave, device] = await Promise.all([
        readSettingJSON<boolean>(KEYS.tree),
        readSettingJSON<boolean>(KEYS.wrap),
        readSettingJSON<boolean>(KEYS.minimap),
        readSettingJSON<boolean>(KEYS.autoSave),
        readSettingJSON<PreviewDevice>(KEYS.device),
      ]);
      set({
        treeVisible: treeVisible ?? true,
        wrap: wrap ?? false,
        minimap: minimap ?? false,
        autoSave: autoSave ?? true,
        previewDevice: device ?? 'desktop',
      });
      try {
        const project = await openProject(ws.path, ws.name);
        if (get().workspaceId !== ws.id) return; // navigated away meanwhile
        set({ project, projectLoading: false, expanded: new Set(['src']) });
        unsubscribeEvents = subscribeEvents(project.id, onEvent, (connected) => set({ eventsConnected: connected }));
        await Promise.all([get().refreshTree(), get().refreshDevServer()]);
      } catch (e) {
        if (get().workspaceId !== ws.id) return;
        set({ projectLoading: false, projectError: describe(e) });
      }
    },

    close: () => {
      unsubscribeEvents?.();
      unsubscribeEvents = null;
      for (const t of autoSaveTimers.values()) window.clearTimeout(t);
      autoSaveTimers.clear();
      for (const c of saveControllers.values()) c.abort();
      saveControllers.clear();
      docGetters.clear();
      set({
        workspaceId: null,
        workspace: null,
        project: null,
        projectError: null,
        projectLoading: false,
        tree: [],
        git: null,
        tabs: [],
        active: null,
        mru: [],
        buffers: {},
        selection: '',
        sync: 'saved',
        autoSavePaused: false,
        diagnostics: {},
        flash: null,
        pendingClose: null,
        detected: null,
        devServer: null,
        busy: null,
        consoleLines: [],
        previewError: null,
        previewUrlOverride: null,
        terminalTail: [],
        lastUndo: null,
        terminalVisible: false,
      });
    },

    refreshTree: async () => {
      const project = get().project;
      if (!project) return;
      set({ treeLoading: get().tree.length === 0 });
      try {
        const t = await fetchTree(project.id);
        if (get().project?.id !== project.id) return;
        set({ tree: t.entries, treeTruncated: t.truncated, git: t.git, treeLoading: false });
      } catch (e) {
        set({ treeLoading: false });
        if (!(e instanceof EngineDown)) toast('Could not read the project tree', { description: describe(e) });
      }
    },

    refreshGit: async () => {
      const project = get().project;
      if (!project) return;
      try {
        set({ git: await fetchGit(project.id) });
      } catch {
        /* badges are best-effort */
      }
    },

    toggleExpanded: (rel) =>
      set((st) => {
        const next = new Set(st.expanded);
        if (next.has(rel)) next.delete(rel);
        else next.add(rel);
        return { expanded: next };
      }),

    revealPath: (rel) =>
      set((st) => {
        const next = new Set(st.expanded);
        for (const a of ancestorsOf(rel)) next.add(a);
        return { expanded: next, treeVisible: true };
      }),

    openFile: async (path, opts = {}) => {
      const project = get().project;
      if (!project) return;
      const st = get();
      const pin = opts.pin ?? false;
      let tabs = st.tabs;
      const existing = tabs.find((t) => t.path === path);
      if (!existing) {
        const preview = tabs.find((t) => !t.pinned);
        const tab: TabState = { path, pinned: pin };
        if (preview && !pin) {
          // Preview slot is reused; its buffer goes unless dirty.
          if (st.buffers[preview.path]?.dirty) tabs = [...tabs, tab];
          else {
            tabs = tabs.map((t) => (t.path === preview.path ? tab : t));
            set((s2) => {
              const { [preview.path]: _gone, ...rest } = s2.buffers;
              void _gone;
              return { buffers: rest, diagnostics: { ...s2.diagnostics, [preview.path]: [] } };
            });
          }
        } else tabs = [...tabs, tab];
      } else if (pin && !existing.pinned) {
        tabs = tabs.map((t) => (t.path === path ? { ...t, pinned: true } : t));
      }
      set((s2) => ({ tabs, active: path, mru: touchMru(s2.mru, path) }));
      if (!get().buffers[path]) {
        set((s2) => ({
          buffers: { ...s2.buffers, [path]: { path, content: '', mtimeMs: 0, dirty: false, loading: true, error: null, isText: true, truncated: false, revision: 0 } },
        }));
        try {
          const f = await readFile(project.id, path);
          patchBuffer(path, { content: f.content, mtimeMs: f.mtimeMs, loading: false, isText: f.isText, truncated: f.truncated, error: null });
        } catch (e) {
          patchBuffer(path, { loading: false, error: describe(e) });
        }
      }
      if (opts.line) get().flashLine(path, opts.line, 'jump');
    },

    reloadFile: async (path) => {
      const project = get().project;
      const buf = get().buffers[path];
      if (!project || !buf) return;
      try {
        const f = await readFile(project.id, path);
        const cur = get().buffers[path];
        if (!cur || cur.dirty) return;
        if (f.content !== cur.content || f.mtimeMs !== cur.mtimeMs) {
          patchBuffer(path, { content: f.content, mtimeMs: f.mtimeMs, revision: cur.revision + 1, isText: f.isText, truncated: f.truncated });
        }
      } catch {
        /* file may have been deleted; the tree refresh shows that */
      }
    },

    setActive: (path) => set((st) => (st.tabs.some((t) => t.path === path) ? { active: path, mru: touchMru(st.mru, path) } : st)),

    pinTab: (path) => set((st) => ({ tabs: st.tabs.map((t) => (t.path === path ? { ...t, pinned: true } : t)) })),

    closeTab: async (path, force = false) => {
      const st = get();
      const buf = st.buffers[path];
      if (buf?.dirty && !force) {
        const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => set({ pendingClose: { path, resolve } }));
        set({ pendingClose: null });
        if (choice === 'cancel') return false;
        if (choice === 'save') {
          const ok = await get().saveFile(path);
          if (!ok) return false;
        }
      }
      const timer = autoSaveTimers.get(path);
      if (timer) window.clearTimeout(timer);
      autoSaveTimers.delete(path);
      docGetters.delete(path);
      set((s2) => {
        const tabs = s2.tabs.filter((t) => t.path !== path);
        const { [path]: _gone, ...buffers } = s2.buffers;
        void _gone;
        const mru = s2.mru.filter((p) => p !== path);
        let active = s2.active;
        if (active === path) active = mru.find((p) => tabs.some((t) => t.path === p)) ?? tabs[tabs.length - 1]?.path ?? null;
        const { [path]: _d, ...diagnostics } = s2.diagnostics;
        void _d;
        return { tabs, buffers, mru, active, diagnostics };
      });
      recomputeSync();
      return true;
    },

    closeOthers: async (path) => {
      for (const t of get().tabs) if (t.path !== path) await get().closeTab(t.path);
    },

    resolveClose: (choice) => {
      get().pendingClose?.resolve(choice);
    },

    markDirty: (path, dirty) => {
      const buf = get().buffers[path];
      if (!buf) return;
      if (buf.dirty !== dirty) patchBuffer(path, { dirty });
      if (dirty) {
        if (get().sync !== 'saving') set({ sync: 'unsaved' });
        scheduleAutoSave(path);
      } else recomputeSync();
    },

    setCursor: (line, col) => {
      const cur = get().cursor;
      if (cur.line !== line || cur.col !== col) set({ cursor: { line, col } });
    },

    setSelection: (text) => {
      if (get().selection !== text) set({ selection: text });
    },

    saveFile: async (pathArg) => {
      const st = get();
      const path = pathArg ?? st.active;
      const project = st.project;
      if (!path || !project) return false;
      const buf = st.buffers[path];
      const content = liveContent(path);
      if (!buf || content === null) return false;
      if (!buf.dirty && content === buf.content) return true;
      saveControllers.get(path)?.abort();
      const controller = new AbortController();
      saveControllers.set(path, controller);
      set({ sync: 'saving' });
      try {
        const r = await writeFile(project.id, path, content, buf.mtimeMs || null, controller.signal);
        patchBuffer(path, { content, mtimeMs: r.mtimeMs, dirty: liveContent(path) !== content });
        set({ autoSavePaused: false, sync: 'saved' });
        recomputeSync();
        void get().refreshGit();
        return true;
      } catch (e) {
        if (controller.signal.aborted) return false;
        if (e instanceof BuilderConflict && e.body.stale) {
          set({ sync: 'error' });
          toast('File changed on disk', {
            description: `${basenameOf(path)} was modified outside the editor. Reload it or save again to overwrite.`,
            action: { label: 'Overwrite', onClick: () => void forceSave(path) },
          });
          return false;
        }
        set({ sync: e instanceof BuilderDenied ? 'unsaved' : 'error', autoSavePaused: true });
        if (e instanceof BuilderDenied && e.blocked) explainDenied(e, 'Save');
        else {
          toast(e instanceof BuilderDenied ? 'Save not approved' : 'Save failed', {
            description: e instanceof BuilderDenied ? 'Auto-save is paused for this file until you save again with ⌘S.' : describe(e),
          });
        }
        return false;
      } finally {
        if (saveControllers.get(path) === controller) saveControllers.delete(path);
      }
    },

    saveAll: async () => {
      for (const b of Object.values(get().buffers)) if (b.dirty) await get().saveFile(b.path);
    },

    setAutoSave: (on) => {
      set({ autoSave: on, autoSavePaused: false });
      writeSettingJSON(KEYS.autoSave, on);
    },

    setDiagnostics: (path, list, available) =>
      set((st) => ({ diagnostics: { ...st.diagnostics, [path]: list }, ...(available !== null ? { diagnosticsAvailable: available } : {}) })),

    flashLine: (path, line, kind, to) => {
      const until = Date.now() + (kind === 'jump' ? 800 : 600);
      set({ flash: { path, line, until, kind, ...(to ? { to } : {}) } });
      window.setTimeout(() => {
        const f = get().flash;
        if (f && f.until <= Date.now()) set({ flash: null });
      }, until - Date.now() + 20);
    },

    applyBlock: async (block, hunks) => {
      const project = get().project;
      if (!project || !block.path) {
        toast("Couldn't apply", { description: 'This diff has no file path. Ask XR to include --- a/ and +++ b/ headers.' });
        return { ok: false, applied: 0 };
      }
      const path = block.path;
      // Unsaved editor changes first: the engine patches what is on disk.
      const buf = get().buffers[path];
      if (buf?.dirty) {
        const saved = await get().saveFile(path);
        if (!saved) return { ok: false, applied: 0 };
      }
      const controller = new AbortController();
      try {
        const r = await applyDiff(project.id, path, block.patch, hunks, get().buffers[path]?.mtimeMs ?? null, controller.signal);
        const cur = get().buffers[path];
        if (cur) patchBuffer(path, { content: r.content, mtimeMs: r.mtimeMs, dirty: false, revision: cur.revision + 1 });
        set({ lastUndo: r.backupId ? { path, backupId: r.backupId } : null });
        void get().openFile(path, { pin: true });
        const firstHunk = block.hunks.find((h) => r.applied.includes(h.index));
        const startLine = firstHunk ? Number(/^@@ -(\d+)/.exec(firstHunk.header)?.[1] ?? 1) : 1;
        get().flashLine(path, startLine, 'applied', startLine + (firstHunk ? firstHunk.lines.length : 0));
        void get().refreshGit();
        const n = r.applied.length;
        toast(`Applied ${n} hunk${n === 1 ? '' : 's'} to ${basenameOf(path)}`, {
          description: r.fuzzy ? `${r.fuzzy} hunk${r.fuzzy === 1 ? '' : 's'} matched by content (line numbers had drifted).` : undefined,
          ...(r.backupId ? { action: { label: 'Undo', onClick: () => void get().undoLast() } } : {}),
        });
        return { ok: true, applied: n };
      } catch (e) {
        if (e instanceof BuilderConflict && e.body.conflict) {
          toast("Couldn't apply cleanly", { description: `${describe(e).replace(/^Couldn't apply cleanly — /, '')} Resolve manually in the editor.` });
        } else if (e instanceof BuilderConflict && e.body.stale) {
          toast('File changed on disk', { description: 'Reload the file, then apply again.' });
        } else if (!explainDenied(e, 'Apply')) {
          toast("Couldn't apply", { description: describe(e) });
        }
        return { ok: false, applied: 0 };
      }
    },

    undoLast: async () => {
      const st = get();
      const project = st.project;
      const last = st.lastUndo;
      if (!project || !last) return;
      try {
        const r = await undoApply(project.id, last.path, last.backupId, new AbortController().signal);
        const cur = get().buffers[last.path];
        if (cur) patchBuffer(last.path, { content: r.content, mtimeMs: r.mtimeMs, dirty: false, revision: cur.revision + 1 });
        set({ lastUndo: null });
        void get().refreshGit();
        toast(`Restored ${basenameOf(last.path)}`);
      } catch (e) {
        if (!explainDenied(e, 'Undo')) toast('Undo failed', { description: describe(e) });
      }
    },

    createPath: async (path, kind) => {
      const project = get().project;
      if (!project) return false;
      try {
        await createEntry(project.id, path, kind, new AbortController().signal);
        await get().refreshTree();
        get().revealPath(path);
        if (kind === 'file') void get().openFile(path, { pin: true });
        return true;
      } catch (e) {
        if (!explainDenied(e, kind === 'folder' ? 'New folder' : 'New file')) toast(`Couldn't create ${kind}`, { description: describe(e) });
        return false;
      }
    },

    renamePath: async (from, to) => {
      const project = get().project;
      if (!project) return false;
      try {
        await renameEntry(project.id, from, to, new AbortController().signal);
        set((st) => {
          const remap = (p: string) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
          const buffers: Record<string, BufferState> = {};
          for (const [k, v] of Object.entries(st.buffers)) buffers[remap(k)] = { ...v, path: remap(k) };
          return {
            tabs: st.tabs.map((t) => ({ ...t, path: remap(t.path) })),
            active: st.active ? remap(st.active) : null,
            mru: st.mru.map(remap),
            buffers,
          };
        });
        for (const [k, g] of [...docGetters.entries()]) {
          if (k === from || k.startsWith(`${from}/`)) {
            docGetters.delete(k);
            docGetters.set(k === from ? to : to + k.slice(from.length), g);
          }
        }
        await get().refreshTree();
        return true;
      } catch (e) {
        if (!explainDenied(e, 'Rename')) toast("Couldn't rename", { description: describe(e) });
        return false;
      }
    },

    deletePath: async (path) => {
      const project = get().project;
      if (!project) return false;
      try {
        await deleteEntry(project.id, path, new AbortController().signal);
        for (const t of get().tabs) if (t.path === path || t.path.startsWith(`${path}/`)) await get().closeTab(t.path, true);
        await get().refreshTree();
        toast(`Deleted ${basenameOf(path)}`);
        return true;
      } catch (e) {
        if (!explainDenied(e, 'Delete')) toast("Couldn't delete", { description: describe(e) });
        return false;
      }
    },

    toggleTree: () => {
      const v = !get().treeVisible;
      set({ treeVisible: v });
      writeSettingJSON(KEYS.tree, v);
    },
    toggleTerminal: (open) => set((st) => ({ terminalVisible: open ?? !st.terminalVisible })),
    toggleWrap: () => {
      const v = !get().wrap;
      set({ wrap: v });
      writeSettingJSON(KEYS.wrap, v);
    },
    toggleMinimap: () => {
      const v = !get().minimap;
      set({ minimap: v });
      writeSettingJSON(KEYS.minimap, v);
    },

    refreshDevServer: async () => {
      const project = get().project;
      if (!project) return;
      try {
        const info = await fetchDevServer(project.id);
        if (get().project?.id !== project.id) return;
        set({
          detected: info.detected,
          devServer: info.status,
          ...(get().consoleLines.length === 0 && info.log.length ? { consoleLines: info.log.map((l) => consoleLine(l.stream, l.line, l.ts)) } : {}),
        });
      } catch {
        /* preview shows the stopped state */
      }
    },

    startDev: async (cmd) => {
      const project = get().project;
      if (!project || get().busy) return;
      set({ busy: 'starting', previewError: null });
      try {
        const r = await startDevServer(project.id, cmd, new AbortController().signal);
        set({ devServer: r.status, detected: r.detected });
      } catch (e) {
        if (e instanceof BuilderConflict && e.body.needsInstall) {
          set({ detected: (e.body.detected as DetectedDevServer | undefined) ?? get().detected });
        } else if (!explainDenied(e, 'Dev server')) {
          toast("Couldn't start the dev server", { description: describe(e) });
        }
      } finally {
        set({ busy: null });
        void get().refreshDevServer();
      }
    },

    stopDev: async () => {
      const project = get().project;
      if (!project) return;
      set({ busy: 'stopping' });
      try {
        const r = await stopDevServer(project.id);
        set({ devServer: r.status, previewError: null });
      } catch (e) {
        toast("Couldn't stop the dev server", { description: describe(e) });
      } finally {
        set({ busy: null });
      }
    },

    install: async () => {
      const project = get().project;
      if (!project || get().busy) return;
      set({ busy: 'installing' });
      try {
        const r = await installDeps(project.id, new AbortController().signal);
        if (!r.ok) toast('Install did not finish cleanly', { description: `Exit code ${r.code ?? '?'} — see the console.` });
        await get().refreshDevServer();
        if (r.ok && !get().detected?.needsInstall) {
          set({ busy: null });
          await get().startDev();
        }
      } catch (e) {
        if (!explainDenied(e, 'Install')) toast("Couldn't install dependencies", { description: describe(e) });
      } finally {
        set({ busy: null });
      }
    },

    clearConsole: () => set({ consoleLines: [] }),
    setConsoleFilter: (f) => set({ consoleFilter: f }),
    setPreviewDevice: (d) => {
      set({ previewDevice: d });
      writeSettingJSON(KEYS.device, d);
    },
    setPreviewUrlOverride: (url) => set({ previewUrlOverride: url, previewError: null }),
    reloadPreview: () => set((st) => ({ previewNonce: st.previewNonce + 1, previewError: null })),
    setPreviewError: (e) => set({ previewError: e }),
    setTerminalTail: (lines) => set({ terminalTail: lines.slice(-40) }),
  };
});

/** Overwrite after a stale-file 409: re-save without the mtime guard. */
async function forceSave(path: string): Promise<void> {
  const st = useBuilderStore.getState();
  const project = st.project;
  const content = liveContent(path);
  if (!project || content === null) return;
  try {
    const r = await writeFile(project.id, path, content, null, new AbortController().signal);
    useBuilderStore.setState((s) => ({
      buffers: { ...s.buffers, [path]: { ...s.buffers[path], content, mtimeMs: r.mtimeMs, dirty: false } },
      sync: 'saved',
      autoSavePaused: false,
    }));
  } catch (e) {
    if (!explainDenied(e, 'Save')) toast('Save failed', { description: describe(e) });
  }
}

/** Selectors shared by panes. */
export const selectActiveBuffer = (st: BuilderState): BufferState | null => (st.active ? (st.buffers[st.active] ?? null) : null);
export const selectDirtyCount = (st: BuilderState): number => Object.values(st.buffers).filter((b) => b.dirty).length;
