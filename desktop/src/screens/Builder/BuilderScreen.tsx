/*
 * BuilderScreen (Phase 17) — the 3-pane AI IDE.
 *
 *   Chat (28%, 280–480) | Editor (+ 240px tree) | Preview (28%, 320–520)
 *                                                  └ Console (0–50%, starts 0)
 *
 * Owns layout sizes, the screen-level hotkeys and the two cmdk dialogs.
 * Everything stateful lives in builderStore; the engine owns the files.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Resizer } from '@/components/Resizer';
import { useHotkeys, type Hotkey } from '@/hooks/useHotkeys';
import { PANES, clampPane, defaultPaneWidth } from '@/lib/builderCore';
import { workspaceDb } from '@/lib/workspace-db';
import { useBuilderStore } from '@/stores/builderStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Workspace } from '@/workspaces/types';

import '@/styles/builder.css';

import { ChatPane } from './components/ChatPane';
import { EditorPane } from './components/EditorPane';
import { FileTree } from './components/FileTree';
import { PreviewPane } from './components/PreviewPane';
import { BuilderPalette, QuickOpen, type BuilderCommand } from './components/QuickOpen';
import { TopBar } from './components/TopBar';
import { diffCardFocus } from './lib/diffFocus';

// xterm is only paid for when a terminal opens.
const TerminalPane = lazy(() => import('./components/TerminalPane').then((m) => ({ default: m.TerminalPane })));

export default function BuilderScreen() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const loaded = useWorkspaceStore((s) => s.loaded);
  const refresh = useWorkspaceStore((s) => s.refresh);

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  const ws: Workspace | null = useMemo(() => workspaces.find((w) => w.id === workspaceId) ?? null, [workspaces, workspaceId]);

  const project = useBuilderStore((s) => s.project);
  const projectError = useBuilderStore((s) => s.projectError);
  const projectLoading = useBuilderStore((s) => s.projectLoading);
  const treeVisible = useBuilderStore((s) => s.treeVisible);
  const terminalVisible = useBuilderStore((s) => s.terminalVisible);
  const [terminalCwd, setTerminalCwd] = useState('');

  useEffect(() => {
    if (ws) void useBuilderStore.getState().openWorkspace(ws);
  }, [ws]);
  useEffect(() => () => useBuilderStore.getState().close(), []);
  useEffect(() => {
    if (ws) void useWorkspaceStore.getState().touch(ws.id);
  }, [ws]);

  // `?action=dev-server` (palette / HUD deep link) → start once the project is open.
  useEffect(() => {
    if (!project || search.get('action') !== 'dev-server') return;
    void useBuilderStore.getState().startDev();
    const next = new URLSearchParams(search);
    next.delete('action');
    setSearch(next, { replace: true });
  }, [project, search, setSearch]);

  // Pane sizes.
  const [chatW, setChatW] = useState(() => defaultPaneWidth(window.innerWidth, 'chat'));
  const [previewW, setPreviewW] = useState(() => defaultPaneWidth(window.innerWidth, 'preview'));
  const [consoleH, setConsoleH] = useState(0);
  const [terminalH, setTerminalH] = useState(220);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodyH, setBodyH] = useState(600);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [quickOpen, setQuickOpen] = useState(false);
  const [palette, setPalette] = useState(false);

  const st = useBuilderStore.getState;
  const focusPane = useCallback((which: 'chat' | 'editor' | 'preview') => {
    const sel = which === 'chat' ? '[data-testid="builder-composer"]' : which === 'editor' ? '.xb-cm .cm-content' : '[data-testid="builder-preview"] .xb-url';
    document.querySelector<HTMLElement>(sel)?.focus();
  }, []);
  const openTerminal = useCallback(
    (cwd?: string) => {
      setTerminalCwd(cwd ?? '');
      st().toggleTerminal(true);
    },
    [st],
  );
  const newFile = useCallback(() => {
    const name = window.prompt('New file name (relative to the project root)');
    if (name?.trim()) void st().createPath(name.trim().replace(/^\/+/, ''), 'file');
  }, [st]);

  const commands = useMemo<BuilderCommand[]>(
    () => [
      { id: 'save', group: 'File', title: 'Save', shortcut: '⌘S', run: () => void st().saveFile() },
      { id: 'save-all', group: 'File', title: 'Save all', run: () => void st().saveAll() },
      { id: 'quick-open', group: 'File', title: 'Quick open…', shortcut: '⌘P', run: () => setQuickOpen(true) },
      { id: 'new-file', group: 'File', title: 'New file…', run: newFile },
      { id: 'close-tab', group: 'File', title: 'Close tab', shortcut: '⌘W', run: () => st().active && void st().closeTab(st().active ?? '') },
      { id: 'reveal', group: 'File', title: 'Reveal project in Finder', run: () => project && void workspaceDb.revealInFinder(project.root) },
      { id: 'tree', group: 'View', title: `${treeVisible ? 'Hide' : 'Show'} file tree`, shortcut: '⌘\\', run: () => st().toggleTree() },
      { id: 'terminal', group: 'View', title: `${terminalVisible ? 'Hide' : 'Show'} terminal`, shortcut: '⌃`', run: () => (terminalVisible ? st().toggleTerminal(false) : openTerminal()) },
      { id: 'console', group: 'View', title: `${consoleH > 0 ? 'Hide' : 'Show'} console`, run: () => setConsoleH(consoleH > 0 ? 0 : Math.round(bodyH * 0.3)) },
      { id: 'wrap', group: 'View', title: `${st().wrap ? 'Disable' : 'Enable'} word wrap`, run: () => st().toggleWrap() },
      { id: 'minimap', group: 'View', title: `${st().minimap ? 'Hide' : 'Show'} minimap`, run: () => st().toggleMinimap() },
      { id: 'focus-chat', group: 'View', title: 'Focus chat', shortcut: '⌘1', run: () => focusPane('chat') },
      { id: 'focus-editor', group: 'View', title: 'Focus editor', shortcut: '⌘2', run: () => focusPane('editor') },
      { id: 'focus-preview', group: 'View', title: 'Focus preview', shortcut: '⌘3', run: () => focusPane('preview') },
      { id: 'dev-start', group: 'Preview', title: 'Start dev server', run: () => void st().startDev(), disabled: st().devServer?.state === 'running' },
      { id: 'dev-stop', group: 'Preview', title: 'Stop dev server', run: () => void st().stopDev(), disabled: st().devServer?.state !== 'running' },
      { id: 'dev-restart', group: 'Preview', title: 'Restart dev server', run: () => void st().stopDev().then(() => st().startDev()), disabled: st().devServer?.state !== 'running' },
      { id: 'reload', group: 'Preview', title: 'Reload preview', run: () => st().reloadPreview() },
      { id: 'accept-all', group: 'Chat', title: 'Accept all hunks in the latest diff', shortcut: '⌘⇧A', run: () => diffCardFocus.current?.acceptAll() },
      { id: 'reject-all', group: 'Chat', title: 'Skip all hunks in the latest diff', shortcut: '⌘⇧R', run: () => diffCardFocus.current?.rejectAll() },
      { id: 'undo-apply', group: 'Chat', title: 'Undo last applied diff', run: () => void st().undoLast(), disabled: !st().lastUndo },
      { id: 'back', group: 'Navigate', title: 'Back to workspace', run: () => ws && navigate(`/workspaces/${ws.id}`) },
    ],
    [st, newFile, project, treeVisible, terminalVisible, consoleH, bodyH, openTerminal, focusPane, ws, navigate],
  );

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      { combo: 'mod+s', handler: () => void st().saveFile() },
      { combo: 'mod+p', handler: () => setQuickOpen((v) => !v) },
      { combo: 'mod+shift+p', handler: () => setPalette((v) => !v) },
      { combo: 'mod+\\', handler: () => st().toggleTree() },
      { combo: 'mod+1', handler: () => focusPane('chat') },
      { combo: 'mod+2', handler: () => focusPane('editor') },
      { combo: 'mod+3', handler: () => focusPane('preview') },
      {
        combo: 'mod+w',
        handler: () => {
          const a = st().active;
          if (a) void st().closeTab(a);
        },
      },
      { combo: 'mod+shift+a', handler: () => diffCardFocus.current?.acceptAll() },
      { combo: 'mod+shift+r', handler: () => diffCardFocus.current?.rejectAll() },
      { combo: 'mod+enter', handler: () => window.dispatchEvent(new CustomEvent('xb:send')) },
    ],
    [st, focusPane],
  );
  useHotkeys(hotkeys);

  // Ctrl+` (terminal) and Ctrl+Tab (MRU) are not expressible in useHotkeys' grammar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === '`') {
        e.preventDefault();
        e.stopPropagation();
        if (st().terminalVisible) st().toggleTerminal(false);
        else openTerminal();
      } else if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        const s = st();
        if (s.tabs.length < 2) return;
        e.preventDefault();
        e.stopPropagation();
        const order = s.mru.filter((p) => s.tabs.some((t) => t.path === p));
        const next = e.shiftKey ? order[order.length - 1] : order[1];
        if (next) s.setActive(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st, openTerminal]);

  // Warn before the window closes with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.values(st().buffers).some((b) => b.dirty)) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [st]);

  if (!workspaceId) return <PickWorkspace workspaces={workspaces} loaded={loaded} />;
  if (loaded && !ws) {
    return (
      <div className="xb-root">
        <div className="xb-center-msg" data-testid="builder-not-found">
          <h2>Workspace not found</h2>
          <p className="text-text-tertiary text-[13px]">It may have been removed, or the link is from another machine.</p>
          <Link to="/workspaces" className="xb-ghost">
            ← Back to Workspaces
          </Link>
        </div>
      </div>
    );
  }

  const chatMin = PANES.chat.min;
  const chatMax = PANES.chat.max;
  const previewMin = PANES.preview.min;
  const previewMax = PANES.preview.max;

  return (
    <div className="xb-root" data-testid="builder-screen">
      <TopBar workspace={ws} />
      <div ref={bodyRef} className="xb-body">
        <aside className="xb-pane" style={{ width: clampPane(chatW, chatMin, chatMax), flex: 'none' }} aria-label="AI chat">
          {workspaceId ? <ChatPane workspaceId={workspaceId} /> : null}
        </aside>
        <Resizer orientation="vertical" storageKey="xr.builder.panes.chat" value={chatW} onChange={setChatW} min={chatMin} max={chatMax} defaultValue={defaultPaneWidth(window.innerWidth, 'chat')} label="Resize chat" />
        <main className="xb-pane xb-center" aria-label="Editor">
          {projectError ? (
            <div className="xb-center-msg" data-testid="builder-project-error">
              <h2>Couldn't open this project</h2>
              <p className="text-text-tertiary text-[13px]">{projectError}</p>
              <button type="button" className="xb-ghost" onClick={() => ws && void useBuilderStore.getState().openWorkspace(ws)}>
                Retry
              </button>
            </div>
          ) : !project || projectLoading ? (
            <div className="xb-skeleton" aria-busy="true" aria-label="Opening project">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="xb-skel" style={{ width: `${35 + ((i * 41) % 50)}%` }} />
              ))}
            </div>
          ) : (
            <>
              <div className="xb-center-top">
                {treeVisible ? <FileTree onOpenTerminal={(cwd) => openTerminal(cwd)} /> : null}
                <EditorPane onQuickOpen={() => setQuickOpen(true)} onNewFile={newFile} onOpenTerminal={() => openTerminal()} onStartDev={() => void st().startDev()} />
              </div>
              {terminalVisible ? (
                <>
                  <Resizer orientation="horizontal" storageKey="xr.builder.panes.terminal" value={terminalH} onChange={setTerminalH} min={120} max={Math.max(120, Math.round(bodyH * 0.6))} defaultValue={220} invert label="Resize terminal" />
                  <Suspense fallback={<div className="xb-term" style={{ height: terminalH }} aria-busy="true" />}>
                    <TerminalPane projectId={project.id} cwd={terminalCwd ? `${project.root}/${terminalCwd}` : project.root} height={terminalH} onClose={() => st().toggleTerminal(false)} />
                  </Suspense>
                </>
              ) : null}
            </>
          )}
        </main>
        <Resizer orientation="vertical" storageKey="xr.builder.panes.preview" value={previewW} onChange={setPreviewW} min={previewMin} max={previewMax} defaultValue={defaultPaneWidth(window.innerWidth, 'preview')} invert label="Resize preview" />
        <aside className="xb-pane" style={{ width: clampPane(previewW, previewMin, previewMax), flex: 'none' }} aria-label="Live preview">
          <PreviewPane consoleHeight={consoleH} onConsoleHeight={setConsoleH} paneHeight={bodyH} />
        </aside>
      </div>
      <QuickOpen open={quickOpen} onOpenChange={setQuickOpen} />
      <BuilderPalette open={palette} onOpenChange={setPalette} commands={commands} />
    </div>
  );
}

function PickWorkspace({ workspaces, loaded }: { workspaces: Workspace[]; loaded: boolean }) {
  const recent = useMemo(() => [...workspaces].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)).slice(0, 8), [workspaces]);
  return (
    <div className="xb-root">
      <div className="xb-center-msg" data-testid="builder-pick">
        <h2>Open a project in Builder</h2>
        <p className="text-text-tertiary text-[13px]">Pick a workspace — the editor, preview and chat open on its folder.</p>
        {loaded && recent.length === 0 ? (
          <Link to="/workspaces" className="xb-ghost">
            Create a workspace
          </Link>
        ) : (
          <div className="xb-recents">
            {recent.map((w) => (
              <Link key={w.id} to={`/builder/${w.id}`} className="xb-recent">
                <span aria-hidden="true">{w.icon ?? '▣'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{w.name}</span>
                  <span className="path block">{w.path}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
