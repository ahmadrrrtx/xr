import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { python } from "@codemirror/lang-python";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput, foldGutter, indentUnit, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/* Lightweight CodeMirror 6 wrapper in XR V2.1 Operator theme.
   Phase 2: real editor (Monaco-alternative; CM6 ships already with XR deps).
   Phase 2 DoD: tabs, syntax highlighting, save, line numbers, minimap toggle later. */

const THEME_DARK = EditorView.theme({
  "&": {
    color: "var(--xr-text)",
    backgroundColor: "var(--xr-surface)",
    fontFamily: "var(--xr-font-mono)",
    fontSize: "13px",
    height: "100%",
  },
  ".cm-content": { caretColor: "var(--xr-primary)", padding: "10px 0" },
  ".cm-cursor": { borderLeftColor: "var(--xr-primary) !important" },
  ".cm-gutters": {
    backgroundColor: "var(--xr-surface)",
    color: "var(--xr-muted)",
    border: "none",
    borderRight: "1px solid var(--xr-border)",
    fontFamily: "var(--xr-font-mono)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 14px", minWidth: "36px" },
  ".cm-activeLine": { backgroundColor: "rgba(0,212,255,0.04)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(0,212,255,0.08)", color: "var(--xr-text)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "rgba(0,212,255,0.25) !important" },
  ".cm-matchingBracket": { backgroundColor: "rgba(96,72,248,0.3)", outline: "1px solid rgba(96,72,248,0.5)" },
}, { dark: true });

const THEME_LIGHT = EditorView.theme({
  "&": {
    color: "var(--xr-text)",
    backgroundColor: "var(--xr-surface)",
    fontFamily: "var(--xr-font-mono)",
    fontSize: "13px",
    height: "100%",
  },
  ".cm-content": { caretColor: "var(--xr-primary)", padding: "10px 0" },
  ".cm-cursor": { borderLeftColor: "var(--xr-primary) !important" },
  ".cm-gutters": {
    backgroundColor: "var(--xr-surface)",
    color: "var(--xr-muted)",
    border: "none",
    borderRight: "1px solid var(--xr-border)",
  },
  ".cm-activeLine": { backgroundColor: "rgba(0,148,198,0.06)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(0,148,198,0.1)", color: "var(--xr-text)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "rgba(0,148,198,0.2) !important" },
}, { dark: false });

const XR_HIGHLIGHT = HighlightStyle.define([
  { tag: t.keyword, color: "#C792EF" },        // violet
  { tag: [t.string, t.special(t.string)], color: "#00FF88" }, // green
  { tag: [t.number, t.bool, t.null], color: "#FFB547" },      // amber
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: "#67B8FF" },
  { tag: [t.className, t.definition(t.typeName), t.typeName], color: "#4DA3FF" },
  { tag: t.comment, color: "#6B7A99", fontStyle: "italic" },
  { tag: t.operator, color: "#F2F5FF" },
  { tag: t.punctuation, color: "#9AA4BF" },
  { tag: t.variableName, color: "#E6EAF5" },
  { tag: t.propertyName, color: "#00D4FF" },
  { tag: [t.meta, t.annotation], color: "#B794FF" },
  { tag: t.heading, color: "#00D4FF", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
]);

function langFor(ext?: string) {
  switch (ext) {
    case "ts": case "tsx": case "js": case "jsx": return javascript({ typescript: ext?.startsWith("ts"), jsx: ext?.endsWith("x") });
    case "md": return markdown();
    case "json": return json();
    case "html": return html();
    case "css": return css();
    case "py": return python();
    default: return [];
  }
}

export function CodeEditor({ value, ext, onChange, readOnly = false }: {
  value: string;
  ext?: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        indentUnit.of("  "),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(XR_HIGHLIGHT),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        langFor(ext),
        isLight ? THEME_LIGHT : THEME_DARK,
        EditorView.lineWrapping,
        EditorView.editable.of(!readOnly),
        ...(onChange ? [EditorView.updateListener.of(u => { if (u.docChanged) onChange(u.state.doc.toString()); })] : []),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext]);

  // Sync external value changes (e.g. file switch)
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) {
      v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} style={{ height: "100%", width: "100%", overflow: "hidden" }} className="xr-cm-host"/>;
}
