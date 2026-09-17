import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { api, type FileEntry } from "../api/client";

function langFor(name: string) {
  if (/\.tsx?$/.test(name)) return javascript({ typescript: true, jsx: true });
  if (/\.jsx?$/.test(name)) return javascript({ jsx: true });
  if (/\.py$/.test(name)) return python();
  if (/\.json$/.test(name)) return json();
  if (/\.md$/.test(name)) return markdown();
  if (/\.html?$/.test(name)) return html();
  if (/\.css$/.test(name)) return css();
  return [];
}

export function Workspace({ onAskXr }: { onAskXr: (prompt: string) => void }) {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [branch, setBranch] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    api.files("").then((r) => { setTree(r.entries ?? []); setBranch(r.branch ?? null); }).catch(() => setTree([]));
  }, []);

  const openFile = useCallback(async (rel: string) => {
    setOpen(rel); setDiff(null);
    const r = await api.fileRead(rel).catch(() => ({ binary: true as const }));
    const text = r.binary ? "// binary file — preview not available" : String(r.content ?? r.text ?? "");
    const name = rel.split("/").pop() ?? rel;
    const st = EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        langFor(name),
        EditorView.theme({ "&": { height: "100%", fontSize: "13px" }, ".cm-scroller": { fontFamily: "var(--xr-font-mono)" } }),
        EditorView.updateListener.of((u) => { if (u.docChanged) setDirty(true); }),
        keymap.of([
          {
            key: "Mod-Enter",
            run: (v: EditorView) => {
              const sel = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);
              onAskXr(sel ? `About this selection in ${rel}:\n"""\n${sel.slice(0, 4000)}\n"""\n` : `Explain ${rel} and propose improvements.`);
              return true;
            },
          },
        ]),
      ],
    });
    if (view.current) view.current.setState(st);
    else view.current = new EditorView({ state: st, parent: host.current! });
    api.fileDiff(rel).then((d) => setDiff(JSON.stringify(d, null, 2))).catch(() => setDiff(null));
  }, [onAskXr]);

  return (
    <div className="ws">
      <div className="ws-explorer" aria-label="Project explorer">
        <div className="rail-h mono">
          {branch ? `⎇ ${branch}` : "files"} {dirty && <span className="dot amber" title="unsaved buffer" />}
        </div>
        {tree.map((e) => (
          <button
            key={e.rel}
            className={`fitem ${e.type === "dir" ? "dir" : ""} ${open === e.rel ? "active" : ""}`}
            onClick={() => e.type === "file" && openFile(e.rel)}
            title={e.rel}
          >
            {e.type === "dir" ? "▸ " : ""}{e.name}
            {e.git && e.git !== "clean" && <span className="dot amber" style={{ marginLeft: 6 }} />}
          </button>
        ))}
        {tree.length === 0 && <div className="faint" style={{ fontSize: 12, padding: 8 }}>open a workspace (engine root)</div>}
      </div>

      <div className="ws-editor">
        <div className="ws-tabs mono">
          {open ? <span className="tab active">{open.split("/").pop()}{dirty && " ●"}</span> : <span className="faint">no file open</span>}
          <span style={{ marginLeft: "auto" }} className="faint">⌘ ask XR about selection</span>
        </div>
        <div className="ws-cm" ref={host} />
        <div className="ws-diff">
          <div className="rail-h">Workspace diff (engine-computed)</div>
          <pre className="raw" style={{ maxHeight: 140 }}>{diff ?? "select a file to see its diff"}</pre>
        </div>
      </div>
    </div>
  );
}
