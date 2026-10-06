/*
 * CodeEditor (Phase 17) — one CodeMirror 6 view, many files.
 *
 * The view owns the live document; per-file EditorStates are cached so
 * switching tabs keeps undo history, folds, selection and scroll. Typing
 * never touches React state — the store only learns "dirty" once per edit
 * burst and reads the document when it saves.
 */
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef, useState } from 'react';

import { detectIndent, languageFor } from '@/lib/builderCore';
import { registerDocGetter, useBuilderStore, type BufferState } from '@/stores/builderStore';

import { Minimap } from './Minimap';
import { baseExtensions, compartments, engineTsLinter, indentExtension, isLanguageLoaded, languageExtension, lezerLinter, loadLanguage, setFlash, wrapExtension } from '../lib/cmSetup';
import { editorStateCache as stateCache } from '../lib/editorStateCache';

const TS_LINT = new Set(['typescript', 'tsx', 'javascript', 'jsx']);

function fileExtensions(projectId: string, path: string, content: string, wrap: boolean): Extension[] {
  const lang = languageFor(path).id;
  const indent = detectIndent(content);
  const lint: Extension[] = [lezerLinter];
  if (TS_LINT.has(lang)) {
    lint.push(
      engineTsLinter({
        projectId,
        path,
        onResult: (available, _count, reason) => {
          const st = useBuilderStore.getState();
          if (st.diagnosticsAvailable !== available) st.setDiagnostics(path, [], available);
          void reason;
        },
      }),
    );
  }
  return [
    compartments.language.of(languageExtension(lang)),
    compartments.indent.of(indentExtension(indent.width, indent.unit)),
    compartments.wrap.of(wrapExtension(wrap)),
    compartments.lint.of(lint),
    compartments.readOnly.of(EditorState.readOnly.of(false)),
  ];
}

export function CodeEditor({ projectId, buffer, wrap, minimap }: { projectId: string; buffer: BufferState; wrap: boolean; minimap: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pathRef = useRef<string>(buffer.path);
  const dirtyRef = useRef(false);
  const revisionRef = useRef(buffer.revision);
  const selectionTimer = useRef<number | null>(null);
  const [view, setView] = useState<EditorView | null>(null);

  // Mount the single view once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: '', extensions: [baseExtensions()] }),
      dispatchTransactions: (trs, v) => {
        v.update(trs);
        const st = useBuilderStore.getState();
        const path = pathRef.current;
        if (trs.some((t) => t.docChanged)) {
          if (!dirtyRef.current) {
            dirtyRef.current = true;
            st.markDirty(path, true);
          } else {
            st.markDirty(path, true); // re-arms the 1 s auto-save timer
          }
        }
        if (trs.some((t) => t.selection || t.docChanged)) {
          const sel = v.state.selection.main;
          const line = v.state.doc.lineAt(sel.head);
          st.setCursor(line.number, sel.head - line.from + 1);
          if (selectionTimer.current) window.clearTimeout(selectionTimer.current);
          selectionTimer.current = window.setTimeout(() => {
            const s = v.state.selection.main;
            const text = s.empty ? '' : v.state.sliceDoc(s.from, Math.min(s.to, s.from + 4_000));
            useBuilderStore.getState().setSelection(text);
          }, 150);
        }
      },
    });
    viewRef.current = view;
    setView(view);
    return () => {
      stateCache.set(pathRef.current, view.state);
      registerDocGetter(pathRef.current, null);
      view.destroy();
      viewRef.current = null;
      setView(null);
    };
  }, []);

  // Swap documents when the active file changes (or when it finishes loading).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || buffer.loading || !buffer.isText) return;
    const prev = pathRef.current;
    if (prev !== buffer.path && view.state.doc.length > 0) {
      stateCache.set(prev, view.state);
      registerDocGetter(prev, null);
    }
    pathRef.current = buffer.path;
    dirtyRef.current = buffer.dirty;
    revisionRef.current = buffer.revision;
    const cached = stateCache.get(buffer.path);
    const state =
      cached && buffer.dirty
        ? cached // unsaved edits live in the cached state
        : cached && cached.doc.toString() === buffer.content
          ? cached
          : EditorState.create({ doc: buffer.content, extensions: [baseExtensions(), ...fileExtensions(projectId, buffer.path, buffer.content, wrap)] });
    view.setState(state);
    registerDocGetter(buffer.path, () => view.state.doc.toString());
    // Grammar chunks load on first use; swap it in once it arrives (no flash of
    // wrong colours — plain text until then).
    const lang = languageFor(buffer.path).id;
    if (!isLanguageLoaded(lang)) {
      void loadLanguage(lang).then((ext) => {
        if (viewRef.current === view && pathRef.current === buffer.path) view.dispatch({ effects: compartments.language.reconfigure(ext) });
      });
    }
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    useBuilderStore.getState().setCursor(line.number, sel.head - line.from + 1);
    view.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision/wrap handled separately
  }, [buffer.path, buffer.loading, buffer.isText, projectId]);

  // Disk content replaced the document (apply / undo / external change).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || buffer.loading || pathRef.current !== buffer.path) return;
    if (buffer.revision === revisionRef.current) return;
    revisionRef.current = buffer.revision;
    const cur = view.state.doc.toString();
    if (cur !== buffer.content) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: buffer.content } });
    }
    dirtyRef.current = false;
    useBuilderStore.getState().markDirty(buffer.path, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision-driven
  }, [buffer.revision]);

  // Saved elsewhere (⌘S from the top bar) → the next edit re-dirties.
  useEffect(() => {
    if (!buffer.dirty) dirtyRef.current = false;
  }, [buffer.dirty]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: compartments.wrap.reconfigure(wrapExtension(wrap)) });
  }, [wrap]);

  // Line flashes (chat `file:line` jumps, applied hunks).
  const flash = useBuilderStore((s) => s.flash);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !flash || flash.path !== buffer.path || buffer.loading) return;
    const doc = view.state.doc;
    const lineNo = Math.min(Math.max(1, flash.line), doc.lines);
    const from = doc.line(lineNo).from;
    const to = doc.line(Math.min(flash.to ?? lineNo, doc.lines)).to;
    view.dispatch({
      effects: [setFlash.of({ from, to, kind: flash.kind }), EditorView.scrollIntoView(from, { y: 'center' })],
      ...(flash.kind === 'jump' ? { selection: { anchor: from } } : {}),
    });
    const timer = window.setTimeout(() => view.dispatch({ effects: setFlash.of(null) }), flash.until - Date.now());
    return () => window.clearTimeout(timer);
  }, [flash, buffer.path, buffer.loading]);

  return (
    <div className="xb-editor-host" data-testid="builder-editor">
      <div ref={hostRef} className="xb-cm" />
      {minimap ? <Minimap view={view} /> : null}
    </div>
  );
}
