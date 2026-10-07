/*
 * EditorPane (Phase 17) — tab bar + CodeMirror + status bar, plus the
 * welcome / empty / loading / binary states and the dirty-close dialog.
 */
import { FileCode2, FolderOpen, Play, Plus, Terminal, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { basenameOf, detectIndent, fileIconFor, formatBytes, languageFor, tabTitles } from '@/lib/builderCore';
import { cn } from '@/lib/utils';
import { selectActiveBuffer, useBuilderStore } from '@/stores/builderStore';

import { CodeEditor } from './CodeEditor';
import { forgetEditorState } from '../lib/editorStateCache';

export function EditorPane({
  onQuickOpen,
  onNewFile,
  onOpenTerminal,
  onStartDev,
}: {
  onQuickOpen: () => void;
  onNewFile: () => void;
  onOpenTerminal: () => void;
  onStartDev: () => void;
}) {
  const tabs = useBuilderStore((s) => s.tabs);
  const active = useBuilderStore((s) => s.active);
  const buffers = useBuilderStore((s) => s.buffers);
  const buffer = useBuilderStore(selectActiveBuffer);
  const project = useBuilderStore((s) => s.project);
  const wrap = useBuilderStore((s) => s.wrap);
  const minimap = useBuilderStore((s) => s.minimap);
  const pendingClose = useBuilderStore((s) => s.pendingClose);
  const titles = useMemo(() => tabTitles(tabs.map((t) => t.path)), [tabs]);
  const [dropping, setDropping] = useState(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((path: string) => {
    void useBuilderStore
      .getState()
      .closeTab(path)
      .then((ok) => ok && forgetEditorState(path));
  }, []);

  // Keep the active tab in view.
  useEffect(() => {
    if (!active) return;
    tabsRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(active)}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [active]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const rel = e.dataTransfer.getData('text/xr-path') || e.dataTransfer.getData('text/plain');
    if (rel && useBuilderStore.getState().tree.some((t) => t.rel === rel && t.type === 'file')) void useBuilderStore.getState().openFile(rel, { pin: true });
  };

  return (
    <div className="xb-editor-pane">
      <div ref={tabsRef} className="xb-tabs" role="tablist" aria-label="Open files">
        {tabs.map((t) => {
          const title = titles.get(t.path);
          const dirty = buffers[t.path]?.dirty ?? false;
          const icon = fileIconFor(t.path);
          const isActive = t.path === active;
          return (
            <button
              key={t.path}
              type="button"
              role="tab"
              data-path={t.path}
              aria-selected={isActive}
              className={cn('xb-tab', isActive && 'is-active', !t.pinned && 'is-preview')}
              title={t.path}
              onClick={() => useBuilderStore.getState().setActive(t.path)}
              onDoubleClick={() => useBuilderStore.getState().pinTab(t.path)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  close(t.path);
                }
              }}
            >
              <span className="xb-glyph" style={{ color: icon.color }} aria-hidden="true">
                {icon.glyph}
              </span>
              <span className="xb-tab-title">{title?.title ?? basenameOf(t.path)}</span>
              {title?.hint ? <span className="xb-tab-hint">{title.hint}</span> : null}
              <span
                role="button"
                tabIndex={-1}
                aria-label={dirty ? `Close ${basenameOf(t.path)} (unsaved changes)` : `Close ${basenameOf(t.path)}`}
                className="xb-tab-x"
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.path);
                }}
              >
                {dirty ? <span className="dirty" aria-hidden="true" /> : null}
                <X size={12} className="x" />
              </span>
            </button>
          );
        })}
        <button type="button" className="xb-tab-plus" aria-label="Quick open (⌘P)" title="Quick open · ⌘P" onClick={onQuickOpen}>
          <Plus size={14} />
        </button>
      </div>

      {!project ? null : !buffer ? (
        <div
          className={cn('xb-welcome', dropping && 'is-drop')}
          onDragOver={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
          data-testid="builder-welcome"
        >
          <FileCode2 size={28} className="text-text-tertiary" aria-hidden="true" />
          <h2>{project.name}</h2>
          <div className="xb-welcome-grid">
            <button type="button" className="xb-welcome-btn" onClick={onQuickOpen}>
              <FolderOpen size={14} /> Open file <span className="k">⌘P</span>
            </button>
            <button type="button" className="xb-welcome-btn" onClick={onNewFile}>
              <Plus size={14} /> New file
            </button>
            <button type="button" className="xb-welcome-btn" onClick={onOpenTerminal}>
              <Terminal size={14} /> Open terminal <span className="k">⌃`</span>
            </button>
            <button type="button" className="xb-welcome-btn" onClick={onStartDev}>
              <Play size={14} /> Start dev server
            </button>
          </div>
          <p className="text-text-tertiary text-[12px]">Or drop a file from the tree here.</p>
        </div>
      ) : buffer.loading ? (
        <div className="xb-skeleton" aria-busy="true" aria-label="Loading file">
          {Array.from({ length: 14 }, (_, i) => (
            <div key={i} className="xb-skel" style={{ width: `${30 + ((i * 53) % 55)}%`, marginLeft: (i % 4) * 16 }} />
          ))}
        </div>
      ) : buffer.error ? (
        <div className="xb-welcome">
          <h2>Couldn't open {basenameOf(buffer.path)}</h2>
          <p>{buffer.error}</p>
          <button type="button" className="xb-ghost" onClick={() => void useBuilderStore.getState().reloadFile(buffer.path)}>
            Retry
          </button>
        </div>
      ) : !buffer.isText ? (
        <div className="xb-welcome">
          <h2>{basenameOf(buffer.path)}</h2>
          <p>Binary or very large file — not editable here.</p>
        </div>
      ) : (
        <CodeEditor projectId={project.id} buffer={buffer} wrap={wrap} minimap={minimap} />
      )}

      <StatusBar />

      <AlertDialog open={pendingClose !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes to {pendingClose ? basenameOf(pendingClose.path) : 'this file'}?</AlertDialogTitle>
            <AlertDialogDescription>Unsaved edits are lost if you close without saving.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus onClick={() => useBuilderStore.getState().resolveClose('cancel')}>
              Cancel
            </AlertDialogCancel>
            <button type="button" className="xb-ghost h-9" onClick={() => useBuilderStore.getState().resolveClose('discard')}>
              Don't save
            </button>
            <AlertDialogAction onClick={() => useBuilderStore.getState().resolveClose('save')}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusBar() {
  const buffer = useBuilderStore(selectActiveBuffer);
  const cursor = useBuilderStore((s) => s.cursor);
  const wrap = useBuilderStore((s) => s.wrap);
  const minimap = useBuilderStore((s) => s.minimap);
  const autoSave = useBuilderStore((s) => s.autoSave);
  const diagAvailable = useBuilderStore((s) => s.diagnosticsAvailable);
  const info = buffer ? languageFor(buffer.path) : null;
  const indent = useMemo(() => (buffer && buffer.isText ? detectIndent(buffer.content, info?.indent ?? 2) : null), [buffer, info?.indent]);
  const st = useBuilderStore.getState;
  return (
    <div className="xb-status" role="status" aria-label="Editor status">
      <span className="path">{buffer ? buffer.path : 'No file open'}</span>
      {buffer && buffer.truncated ? <span className="xb-status-item is-warn">truncated · {formatBytes(buffer.content.length)}</span> : null}
      {buffer ? (
        <span className="xb-status-item" aria-label={`Line ${cursor.line}, column ${cursor.col}`}>
          Ln {cursor.line}, Col {cursor.col}
        </span>
      ) : null}
      {indent ? (
        <span className="xb-status-item">
          {indent.unit === 'tabs' ? 'Tabs' : `Spaces: ${indent.width}`}
        </span>
      ) : null}
      {info ? <span className="xb-status-item">{info.label}</span> : null}
      {buffer ? <span className="xb-status-item">UTF-8</span> : null}
      {buffer ? <span className="xb-status-item">{buffer.content.includes('\r\n') ? 'CRLF' : 'LF'}</span> : null}
      {info && ['typescript', 'tsx', 'javascript', 'jsx'].includes(info.id) ? (
        <span className="xb-status-item" title={diagAvailable === false ? 'Install typescript in the project to see diagnostics' : 'TypeScript diagnostics from the project compiler'}>
          {diagAvailable === false ? 'TS: not installed' : diagAvailable ? 'TS ✓' : 'TS'}
        </span>
      ) : null}
      <button type="button" className="xb-status-item" aria-pressed={wrap} onClick={() => st().toggleWrap()} title="Toggle word wrap">
        Wrap
      </button>
      <button type="button" className="xb-status-item" aria-pressed={minimap} onClick={() => st().toggleMinimap()} title="Toggle minimap">
        Minimap
      </button>
      <button type="button" className="xb-status-item" aria-pressed={autoSave} onClick={() => st().setAutoSave(!autoSave)} title="Save automatically 1 s after you stop typing">
        Auto-save
      </button>
    </div>
  );
}
