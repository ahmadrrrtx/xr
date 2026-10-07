/*
 * CodeMirror 6 setup for the Builder (Phase 17).
 *
 * One place for: language packs, the token-driven theme (every colour is a
 * CSS variable, so switching XR themes restyles the editor instantly), the
 * zero-dependency Lezer syntax linter, the engine TypeScript linter, indent
 * guides, rainbow brackets, line flashes and the keymap. The editor itself
 * (CodeEditor.tsx) only composes these.
 */
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language';
import { linter, lintGutter, lintKeymap, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

import { fetchDiagnostics } from '@/engine/builder';
import type { LanguageId } from '@/lib/builderCore';

/* ── languages (lazy: each grammar is its own chunk, loaded on first use) ── */

const loaders: Partial<Record<LanguageId, () => Promise<Extension>>> = {
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  tsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true, jsx: true })),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  rust: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
};
const loaded = new Map<LanguageId, Extension>();

/** Resolves to the language support; `[]` for plain text. Cached per language. */
export async function loadLanguage(id: LanguageId): Promise<Extension> {
  const hit = loaded.get(id);
  if (hit) return hit;
  const loader = loaders[id];
  if (!loader) return [];
  const ext = await loader();
  loaded.set(id, ext);
  return ext;
}

/** Synchronous best effort — the grammar if it is already loaded, else `[]`. */
export function languageExtension(id: LanguageId): Extension {
  return loaded.get(id) ?? [];
}

export function isLanguageLoaded(id: LanguageId): boolean {
  return loaded.has(id) || !loaders[id];
}

/* ── theme (tokens only; see styles/themes.css --syn-*) ────────────────── */

export const xrEditorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--editor-bg)', color: 'var(--syn-fg, var(--text-primary))', fontSize: '13px', height: '100%' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: '1.55', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--syn-selection)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--syn-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--syn-fg, var(--text-primary))' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--syn-gutter, var(--text-tertiary))', border: 'none', paddingLeft: '4px' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '38px', padding: '0 10px 0 4px' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 2px', color: 'var(--text-tertiary)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', margin: '0 4px', padding: '0 6px', borderRadius: '4px' },
  '.cm-matchingBracket': { backgroundColor: 'var(--syn-bracket-match)', outline: '1px solid var(--accent-dim)' },
  '.cm-nonmatchingBracket': { color: 'var(--danger)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--syn-selection-match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--syn-search-match)', outline: '1px solid var(--warning)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--syn-search-match-selected)' },
  '.cm-panels': { backgroundColor: 'var(--bg-raised)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border-default)' },
  '.cm-panel.cm-search': { padding: '6px 8px', fontSize: '12px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontSize: '12px', borderRadius: '6px' },
  '.cm-panel.cm-search input': { background: 'var(--bg-ink)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', padding: '2px 6px' },
  '.cm-panel.cm-search button': { background: 'var(--bg-ink)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', padding: '2px 8px', textTransform: 'none' },
  '.cm-panel.cm-search label': { color: 'var(--text-secondary)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', borderRadius: '8px', fontSize: '12px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-dim)', color: 'var(--text-primary)' },
  '.cm-tooltip-lint': { padding: '4px 0' },
  '.cm-diagnostic': { padding: '3px 8px', borderLeft: '3px solid transparent' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warning)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warning)', textUnderlineOffset: '3px' },
  '.cm-lint-marker-error': { content: '""' },
  '.cm-gutter-lint .cm-gutterElement': { padding: '0 2px' },
  '.cm-line': { paddingLeft: '6px' },
  '.xr-indent-guides': {
    backgroundImage: 'repeating-linear-gradient(to right, var(--syn-guide) 0 1px, transparent 1px calc(var(--xr-indent, 2) * 1ch))',
    backgroundSize: 'calc(var(--xr-guides, 0) * var(--xr-indent, 2) * 1ch) 100%',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: '6px 0',
  },
  '.xr-bracket-0': { color: 'var(--syn-bracket-1)' },
  '.xr-bracket-1': { color: 'var(--syn-bracket-2)' },
  '.xr-bracket-2': { color: 'var(--syn-bracket-3)' },
  '.xr-flash-jump': { backgroundColor: 'var(--syn-flash)', transition: 'background-color 800ms ease-out' },
  '.xr-flash-applied': { backgroundColor: 'color-mix(in srgb, var(--success) 18%, transparent)' },
  '.xr-flash-gutter': { borderLeft: '2px solid var(--success)' },
});

export const xrHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.inserted], color: 'var(--syn-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName)), t.macroName], color: 'var(--syn-function)' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: 'var(--syn-property)' },
  { tag: [t.variableName, t.definition(t.variableName), t.local(t.variableName)], color: 'var(--syn-variable)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-tag)' },
  { tag: [t.operator, t.punctuation, t.separator, t.derefOperator], color: 'var(--syn-operator)' },
  { tag: [t.meta, t.processingInstruction, t.annotation], color: 'var(--syn-comment)' },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: [t.link, t.url], color: 'var(--syn-string)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.invalid, color: 'var(--danger)' },
  { tag: t.deleted, color: 'var(--danger)' },
  { tag: [t.escape, t.special(t.variableName)], color: 'var(--syn-number)' },
]);

/* ── Lezer syntax errors (every language, instant, no network) ────────── */

export const lezerLinter = linter(
  (view) => {
    const out: CmDiagnostic[] = [];
    const tree = syntaxTree(view.state);
    if (tree.length === 0) return out;
    tree.iterate({
      enter: (node) => {
        if (!node.type.isError) return;
        const from = node.from;
        const to = Math.max(node.to, Math.min(view.state.doc.length, node.from + 1));
        out.push({ from, to, severity: 'error', message: 'Syntax error' });
        return false;
      },
    });
    return out.slice(0, 100);
  },
  { delay: 400 },
);

/* ── engine TypeScript diagnostics (project's own compiler) ────────────── */

export interface EngineLinterOptions {
  projectId: string;
  path: string;
  onResult?: (available: boolean, count: number, reason?: string) => void;
}

export function engineTsLinter(opts: EngineLinterOptions): Extension {
  let last: AbortController | null = null;
  return linter(
    async (view) => {
      last?.abort();
      const controller = new AbortController();
      last = controller;
      try {
        const r = await fetchDiagnostics(opts.projectId, opts.path, view.state.doc.toString(), controller.signal);
        if (controller.signal.aborted) return [];
        opts.onResult?.(r.available, r.diagnostics.length, r.reason);
        const len = view.state.doc.length;
        return r.diagnostics.map((d) => ({
          from: Math.min(d.from, len),
          to: Math.min(Math.max(d.to, d.from + 1), len),
          severity: d.severity,
          message: d.message,
          source: d.code ? `ts(${d.code})` : 'ts',
        }));
      } catch {
        return [];
      }
    },
    { delay: 800, needsRefresh: () => false },
  );
}

/* ── indent guides + rainbow brackets (viewport-bounded decorations) ───── */

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

function buildDecorations(view: EditorView, indent: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const tree = syntaxTree(view.state);
  const marks: Array<{ from: number; to: number; cls: string }> = [];
  const lines: Array<{ from: number; guides: number }> = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    let depth = 0;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const ws = /^[ \t]*/.exec(line.text)?.[0] ?? '';
      const cols = ws.replace(/\t/g, ' '.repeat(indent)).length;
      const guides = line.text.trim().length === 0 ? 0 : Math.floor(cols / Math.max(1, indent));
      lines.push({ from: line.from, guides });
      const text = line.text;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i] ?? '';
        if (!OPEN.has(ch) && !CLOSE.has(ch)) continue;
        const at = line.from + i;
        const name = tree.length ? tree.resolveInner(at, 1).name : '';
        if (/String|Comment|Template|Regexp|Text/.test(name)) continue;
        if (OPEN.has(ch)) {
          marks.push({ from: at, to: at + 1, cls: `xr-bracket-${depth % 3}` });
          depth += 1;
        } else {
          depth = Math.max(0, depth - 1);
          marks.push({ from: at, to: at + 1, cls: `xr-bracket-${depth % 3}` });
        }
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  const all = [
    ...lines.filter((l) => l.guides > 0).map((l) => ({ from: l.from, to: l.from, deco: Decoration.line({ class: 'xr-indent-guides', attributes: { style: `--xr-guides:${l.guides};--xr-indent:${indent}` } }) })),
    ...marks.map((m) => ({ from: m.from, to: m.to, deco: Decoration.mark({ class: m.cls }) })),
  ].sort((a, b) => a.from - b.from || (a.to === a.from ? -1 : 1));
  for (const d of all) builder.add(d.from, d.to, d.deco);
  return builder.finish();
}

export function guidesAndBrackets(indent: number): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, indent);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view, indent);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/* ── line flash (jump / applied) ───────────────────────────────────────── */

export const setFlash = StateEffect.define<{ from: number; to: number; kind: 'jump' | 'applied' } | null>();

export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setFlash)) continue;
      if (!e.value) {
        next = Decoration.none;
        continue;
      }
      const builder = new RangeSetBuilder<Decoration>();
      const doc = tr.state.doc;
      const first = doc.lineAt(Math.min(e.value.from, doc.length));
      const last = doc.lineAt(Math.min(e.value.to, doc.length));
      for (let n = first.number; n <= last.number; n += 1) {
        const line = doc.line(n);
        builder.add(line.from, line.from, Decoration.line({ class: e.value.kind === 'jump' ? 'xr-flash-jump' : 'xr-flash-applied xr-flash-gutter' }));
      }
      next = builder.finish();
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ── compartments the editor reconfigures live ─────────────────────────── */

export const compartments = {
  language: new Compartment(),
  wrap: new Compartment(),
  indent: new Compartment(),
  lint: new Compartment(),
  readOnly: new Compartment(),
};

/** Everything that does not change per file. */
export function baseExtensions(): Extension {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter({ openText: '▾', closedText: '▸' }),
    codeFolding(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ activateOnTyping: true, icons: false }),
    rectangularSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    lintGutter(),
    flashField,
    xrEditorTheme,
    syntaxHighlighting(xrHighlightStyle),
    // ⌘S / ⌘P / ⌘W / ⌘1-3 are screen-level hotkeys (BuilderScreen) so they
    // behave the same whether or not the editor has focus.
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
  ];
}

export function indentExtension(width: number, unit: 'spaces' | 'tabs'): Extension {
  return [indentUnit.of(unit === 'tabs' ? '\t' : ' '.repeat(width)), EditorState.tabSize.of(width), guidesAndBrackets(width)];
}

export function wrapExtension(on: boolean): Extension {
  return on ? EditorView.lineWrapping : [];
}
