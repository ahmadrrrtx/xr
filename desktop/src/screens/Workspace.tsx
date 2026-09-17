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
import { api, terminalRun, type Approval, type FileEntry, type TerminalEvent } from "../api/client";

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

type SaveState =
  | { phase: "idle" }
  | { phase: "awaiting"; approvalId: string | null }
  | { phase: "error"; msg: string };

type TermLine = { kind: "out" | "err" | "sys"; text: string };

export function Workspace({ onAskXr }: { onAskXr: (prompt: string) => void }) {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [branch, setBranch] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const baseMtime = useRef<number | undefined>(undefined);

  // Phase 2B — save flow (engine owns the gate; UI only renders + forwards decisions)
  const [save, setSave] = useState<SaveState>({ phase: "idle" });
  const [pendingApproval, setPendingApproval] = useState<Approval | null>(null);

  // Phase 2B — terminal drawer (line-based command runner; honest, not a PTY)
  const [termOpen, setTermOpen] = useState(false);
  const [termLines, setTermLines] = useState<TermLine[]>([]);
  const [termCmd, setTermCmd] = useState("");
  const [termBusy, setTermBusy] = useState(false);
  const [termApproval, setTermApproval] = useState<Approval | null>(null);
  const termOut = useRef<HTMLPreElement>(null);

  useEffect(() => {
    api.files("").then((r) => { setTree(r.entries ?? []); setBranch(r.branch ?? null); }).catch(() => setTree([]));
  }, []);

  useEffect(() => {
    if (termOut.current) termOut.current.scrollTop = termOut.current.scrollHeight;
  }, [termLines]);

  const refreshTree = useCallback(() => {
    api.files("").then((r) => { setTree(r.entries ?? []); setBranch(r.branch ?? null); }).catch(() => undefined);
  }, []);

  const setDoc = useCallback((text: string, rel: string) => {
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
          {
            key: "Mod-s",
            run: () => { void saveRef.current?.(); return true; },
          },
        ]),
      ],
    });
    if (view.current) view.current.setState(st);
    else view.current = new EditorView({ state: st, parent: host.current! });
    setDirty(false);
  }, [onAskXr]);

  const openFile = useCallback(async (rel: string) => {
    setOpen(rel); setDiff(null); setSave({ phase: "idle" }); setPendingApproval(null);
    const r = await api.fileRead(rel).catch(() => ({ binary: true as const }));
    baseMtime.current = (r as { mtimeMs?: number }).mtimeMs;
    const text = r.binary ? "// binary file — preview not available" : String(r.content ?? r.text ?? "");
    setDoc(text, rel);
    api.fileDiff(rel).then((d) => setDiff(JSON.stringify(d, null, 2))).catch(() => setDiff(null));
  }, [setDoc]);

  /** Save: POST blocks while the engine raises a durable approval; poll and render it. */
  const doSave = useCallback(async () => {
    if (!open || !view.current || !dirty || save.phase === "awaiting") return;
    const content = view.current.state.doc.toString();
    setSave({ phase: "awaiting", approvalId: null });
    setPendingApproval(null);
    let poll: ReturnType<typeof setInterval> | null = null;
    poll = setInterval(() => {
      api.approvals().then((res) => {
        const list = Array.isArray(res) ? res : res.pending ?? [];
        const hit = list.find((a) => (a as Approval & { tool?: string }).tool === "write_file");
        if (hit) setPendingApproval(hit);
      }).catch(() => undefined);
    }, 700);
    try {
      const r = await api.filesWrite(open, content, baseMtime.current);
      if (r.applied) {
        baseMtime.current = r.mtimeMs;
        setDoc(content, open);
        setSave({ phase: "idle" });
        refreshTree();
        api.fileDiff(open).then((d) => setDiff(JSON.stringify(d, null, 2))).catch(() => setDiff(null));
      } else {
        setSave({ phase: "error", msg: r.decision === "timed_out" ? "approval timed out (fail-closed)" : "save denied" });
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setSave({ phase: "error", msg: msg.includes("409") ? "file changed on disk since load — reopen it" : msg });
    } finally {
      if (poll) clearInterval(poll);
      setPendingApproval(null);
    }
  }, [open, dirty, save.phase, setDoc, refreshTree]);
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => { saveRef.current = doSave; }, [doSave]);

  const runTerminal = useCallback(async () => {
    const cmd = termCmd.trim();
    if (!cmd || termBusy) return;
    setTermBusy(true);
    setTermApproval(null);
    setTermLines((ls) => [...ls, { kind: "sys", text: `$ ${cmd}` }]);
    setTermCmd("");
    try {
      await terminalRun({ cmd }, (e: TerminalEvent) => {
        if (e.type === "status") {
          const s = e as Extract<TerminalEvent, { type: "status" }>;
          if (s.status === "approval_required") {
            setTermApproval({ id: String(s.approvalId ?? ""), reason: s.cmd ? `run: ${s.cmd}` : undefined, risk: s.riskTier });
            setTermLines((ls) => [...ls, { kind: "sys", text: `⏸ approval required (risk: ${s.riskTier ?? "?"}) — decide below` }]);
          } else if (s.status === "denied" || s.status === "timed_out") {
            setTermLines((ls) => [...ls, { kind: "sys", text: s.status === "denied" ? "✗ denied — nothing was executed" : "⏱ approval timed out (fail-closed)" }]);
          } else if (s.status === "error") {
            setTermLines((ls) => [...ls, { kind: "err", text: `error: ${s.error ?? "unknown"}` }]);
          }
        } else if (e.type === "output") {
          const o = e as Extract<TerminalEvent, { type: "output" }>;
          setTermLines((ls) => [...ls, { kind: o.stream === "stderr" ? "err" : "out", text: o.text }]);
        } else if (e.type === "exit") {
          const x = e as Extract<TerminalEvent, { type: "exit" }>;
          setTermLines((ls) => [...ls, {
            kind: "sys",
            text: `— exit ${x.code ?? "?"}${x.timedOut ? " (timed out)" : ""}${x.truncated ? " (output truncated at 256 KB)" : ""} in ${x.ms ?? "?"} ms`,
          }]);
        }
      });
    } catch (e2) {
      setTermLines((ls) => [...ls, { kind: "err", text: String((e2 as Error)?.message ?? e2) }]);
    } finally {
      setTermBusy(false);
      setTermApproval(null);
      refreshTree();
    }
  }, [termCmd, termBusy, refreshTree]);

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
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <span className="faint">⌘ ask XR about selection</span>
            <button className={`btn ${termOpen ? "btn-accent" : ""}`} onClick={() => setTermOpen((v) => !v)} title="Command-runner terminal (not a PTY)">
              {termOpen ? "▾ Terminal" : "▴ Terminal"}
            </button>
            <button
              className="btn btn-accent"
              disabled={!dirty || !open || save.phase === "awaiting"}
              onClick={() => void doSave()}
              title="Save via engine (requires your approval; Mod-S)"
            >
              {save.phase === "awaiting" ? "Awaiting approval…" : "Save"}
            </button>
          </span>
        </div>

        {save.phase === "awaiting" && (
          <div className="approval-mini">
            <span className="mono">engine approval required to write {open}</span>
            {pendingApproval ? (
              <span className="row-gap">
                <button className="btn btn-ok" onClick={() => { void api.decide(pendingApproval.id, true).catch(() => undefined); }}>Approve</button>
                <button className="btn btn-bad" onClick={() => { void api.decide(pendingApproval.id, false).catch(() => undefined); }}>Deny</button>
                <span className="faint mono">{String(pendingApproval.reason ?? "").slice(0, 80)}</span>
              </span>
            ) : (
              <span className="faint">waiting for the consent plane…</span>
            )}
          </div>
        )}
        {save.phase === "error" && (
          <div className="approval-mini errline">
            <span className="mono">{save.msg}</span>
            <button className="btn" onClick={() => setSave({ phase: "idle" })}>dismiss</button>
          </div>
        )}

        <div className="ws-cm" ref={host} />

        {termOpen && (
          <div className="term" aria-label="Terminal (command runner)">
            <div className="rail-h mono">
              terminal — command runner (approval-gated, streamed; NOT an interactive PTY)
              {termBusy && <span className="dot amber" style={{ marginLeft: 8 }} />}
            </div>
            {termApproval && (
              <div className="approval-mini">
                <span className="mono">run: {String(termApproval.reason ?? "").replace(/^run:\s*/, "").slice(0, 120)}</span>
                <span className="row-gap">
                  <button className="btn btn-ok" onClick={() => { void api.decide(termApproval.id, true).catch(() => undefined); }}>Approve</button>
                  <button className="btn btn-bad" onClick={() => { void api.decide(termApproval.id, false).catch(() => undefined); }}>Deny</button>
                  {termApproval.risk && <span className="chip">risk {String(termApproval.risk)}</span>}
                </span>
              </div>
            )}
            <pre className="term-out raw" ref={termOut}>
              {termLines.length === 0
                ? "type a command below — every run goes through the engine's policy check and your approval.\n"
                : termLines.map((l, i) => (
                    <span key={i} className={l.kind === "err" ? "term-err" : l.kind === "sys" ? "term-sys" : undefined}>{l.text}</span>
                  ))}
            </pre>
            <form
              className="term-in"
              onSubmit={(e) => { e.preventDefault(); void runTerminal(); }}
            >
              <span className="mono faint">$</span>
              <input
                className="mono"
                value={termCmd}
                onChange={(e) => setTermCmd(e.target.value)}
                placeholder={termBusy ? "running…" : "git status"}
                disabled={termBusy}
                autoFocus
              />
              <button className="btn btn-accent" type="submit" disabled={termBusy || !termCmd.trim()}>Run</button>
              <button className="btn" type="button" onClick={() => setTermLines([])} disabled={termBusy}>Clear</button>
            </form>
          </div>
        )}

        <div className="ws-diff">
          <div className="rail-h">Workspace diff (engine-computed)</div>
          <pre className="raw" style={{ maxHeight: 140 }}>{diff ?? "select a file to see its diff"}</pre>
        </div>
      </div>
    </div>
  );
}
