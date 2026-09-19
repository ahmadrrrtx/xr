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
import { XrAvatar } from "../components/Brand";

/** Workspace — Editor+Terminal+Agent hardened elite (Phase 1)
 * Keeps single execution spine: all saves/terminal/git via engine approval-gated verbs.
 * Hardened: tokens var(--xr-*), skeleton, empty honest, error errline retry/dismiss,
 * motion 120/200/320 ease-drawer, focus cyan, a11y, Esc close, 0600 token pairing context.
 */

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

type SaveState = { phase: "idle" } | { phase: "awaiting"; approvalId: string | null } | { phase: "error"; msg: string };
type TermLine = { kind: "out" | "err" | "sys"; text: string };
interface TermTab { id: number; name: string; lines: TermLine[]; cmd: string; busy: boolean; approval: Approval | null; }
interface Tab { rel: string; name: string; dirty: boolean; }

function lineDelta(base: string, next: string): { added: number; removed: number } {
  const a = base.split("\n"); const b = next.split("\n");
  let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0; while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { added: b.length - p - s, removed: a.length - p - s };
}

export function Workspace({ onAskXr }: { onAskXr: (prompt: string) => void }) {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [branch, setBranch] = useState<string | null>(null);
  const [kids, setKids] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [delta, setDelta] = useState<{ added: number; removed: number }>({ added: 0, removed: 0 });
  const [save, setSave] = useState<SaveState>({ phase: "idle" });
  const [pendingApproval, setPendingApproval] = useState<Approval | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [git, setGit] = useState<{ branch: string | null; entries: { code: string; path: string }[] } | null>(null);
  const [gitLog, setGitLog] = useState<{ hash: string; date?: string; subject?: string }[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [gitNote, setGitNote] = useState<string | null>(null);
  const [gitBusy, setGitBusy] = useState(false);
  const [agentNote, setAgentNote] = useState("idle — open a file or ask XR");
  const [loadingTree, setLoadingTree] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);

  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef<Map<string, EditorState>>(new Map());
  const bases = useRef<Map<string, { text: string; mtime?: number }>>(new Map());
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;

  const [terms, setTerms] = useState<TermTab[]>([{ id: 1, name: "terminal 1", lines: [], cmd: "", busy: false, approval: null }]);
  const [termTab, setTermTab] = useState(1);
  const termSeq = useRef(2);
  const termOut = useRef<HTMLPreElement>(null);
  const [termHistory, setTermHistory] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("xr-term-history") || "[]"); } catch { return []; } });
  const historyIdx = useRef(-1);

  useEffect(() => {
    api.files("").then((r) => { setTree(r.entries ?? []); setBranch(r.branch ?? null); }).catch(() => setTree([])).finally(() => setLoadingTree(false));
  }, []);
  useEffect(() => {
    const t = terms.find((x) => x.id === termTab);
    if (t && termOut.current) termOut.current.scrollTop = termOut.current.scrollHeight;
  }, [terms, termTab]);
  useEffect(() => { try { localStorage.setItem("xr-term-history", JSON.stringify(termHistory.slice(-100))); } catch {} }, [termHistory]);

  const refreshTree = useCallback(() => {
    api.files("").then((r) => { setTree(r.entries ?? []); setBranch(r.branch ?? null); }).catch(() => undefined);
  }, []);

  const toggleDir = useCallback((rel: string) => {
    setExpanded((e) => ({ ...e, [rel]: !e[rel] }));
    if (!kids[rel]) {
      api.files(rel).then((r) => setKids((k) => ({ ...k, [rel]: r.entries ?? [] }))).catch(() => setKids((k) => ({ ...k, [rel]: [] })));
    }
  }, [kids]);

  const syncDirty = useCallback(() => {
    const rel = activeRef.current;
    if (!rel || !view.current) return;
    const base = bases.current.get(rel)?.text ?? "";
    const cur = view.current.state.doc.toString();
    const d = cur !== base;
    setTabs((ts) => ts.map((t) => (t.rel === rel ? { ...t, dirty: d } : t)));
    setDelta(lineDelta(base, cur));
  }, []);

  const makeState = useCallback((text: string, rel: string) => EditorState.create({
    doc: text,
    extensions: [
      basicSetup,
      langFor(rel.split("/").pop() ?? rel),
      EditorView.theme({ "&": { height: "100%", fontSize: "13px" }, ".cm-scroller": { fontFamily: "var(--xr-font-mono)" }, ".cm-focused": { outline: "2px solid var(--xr-focus)" } }),
      EditorView.updateListener.of((u) => { if (u.docChanged) syncDirty(); }),
      keymap.of([
        { key: "Mod-Enter", run: (v: EditorView) => { const sel = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to); onAskXr(sel ? `About this selection in ${rel}:\n"""\n${sel.slice(0, 4000)}\n"""\n` : `Explain ${rel} and propose improvements.`); return true; } },
        { key: "Mod-s", run: () => { void saveRef.current?.(); return true; } },
      ]),
    ],
  }), [onAskXr, syncDirty]);

  const openFile = useCallback(async (rel: string) => {
    const cur = activeRef.current;
    if (view.current && cur) states.current.set(cur, view.current.state);
    setActive(rel); setSave({ phase: "idle" }); setPendingApproval(null); setAgentNote(`opened ${rel.split("/").pop()}`);
    if (!host.current) return;
    if (!view.current) view.current = new EditorView({ parent: host.current });
    const cached = states.current.get(rel);
    if (cached) { view.current.setState(cached); syncDirty(); return; }
    const r = await api.fileRead(rel).catch(() => ({ binary: true as const }));
    const text = (r as any).binary ? "// binary file — preview not available" : String((r as any).content ?? (r as any).text ?? "");
    bases.current.set(rel, { text, mtime: (r as { mtimeMs?: number }).mtimeMs });
    const st = makeState(text, rel);
    states.current.set(rel, st);
    view.current.setState(st);
    setTabs((ts) => (ts.some((t) => t.rel === rel) ? ts : [...ts, { rel, name: rel.split("/").pop() ?? rel, dirty: false }]));
    setDelta({ added: 0, removed: 0 });
    api.fileDiff(rel).then((d) => setDiff(JSON.stringify(d, null, 2))).catch(() => setDiff(null));
  }, [makeState, syncDirty]);

  const closeTab = useCallback((rel: string) => {
    states.current.delete(rel); bases.current.delete(rel);
    setTabs((ts) => {
      const next = ts.filter((t) => t.rel !== rel);
      if (activeRef.current === rel) {
        const target = next.length ? next[next.length - 1].rel : null;
        setActive(target);
        if (target && view.current) view.current.setState(states.current.get(target)!);
        else if (view.current) view.current.setState(EditorState.create({ doc: "" }));
      }
      return next;
    });
  }, []);

  const doSave = useCallback(async () => {
    const rel = activeRef.current;
    if (!rel || !view.current || save.phase === "awaiting") return;
    const content = view.current.state.doc.toString();
    const base = bases.current.get(rel);
    if (content === base?.text) return;
    setSave({ phase: "awaiting", approvalId: null });
    setPendingApproval(null);
    setAgentNote("awaiting your approval to write…");
    let poll: ReturnType<typeof setInterval> | null = null;
    poll = setInterval(() => {
      api.approvals().then((res) => {
        const list = Array.isArray(res) ? res : (res as any).pending ?? [];
        const hit = list.find((a: any) => a.tool === "write_file");
        if (hit) setPendingApproval(hit);
      }).catch(() => undefined);
    }, 700);
    try {
      const r = await api.filesWrite(rel, content, base?.mtime);
      if (r.applied) {
        bases.current.set(rel, { text: content, mtime: r.mtimeMs });
        setSave({ phase: "idle" });
        setAgentNote(`applied ${rel.split("/").pop()}`);
        setDelta({ added: 0, removed: 0 });
        setTabs((ts) => ts.map((t) => (t.rel === rel ? { ...t, dirty: false } : t)));
        refreshTree();
        api.fileDiff(rel).then((d) => setDiff(JSON.stringify(d, null, 2))).catch(() => setDiff(null));
      } else {
        setSave({ phase: "error", msg: r.decision === "timed_out" ? "approval timed out (fail-closed)" : "save denied" });
        setAgentNote("save denied by decision");
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setSave({ phase: "error", msg: msg.includes("409") ? "file changed on disk since load — reopen it" : msg });
      setAgentNote("save error — see banner");
    } finally {
      if (poll) clearInterval(poll);
      setPendingApproval(null);
    }
  }, [save.phase, refreshTree]);
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => { saveRef.current = doSave; }, [doSave]);

  const patchTerm = useCallback((id: number, fn: (t: TermTab) => Partial<TermTab>) => {
    setTerms((ts) => ts.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)));
  }, []);

  const runTerminal = useCallback(async (id: number) => {
    const tab = terms.find((t) => t.id === id);
    const cmd = tab?.cmd.trim();
    if (!tab || !cmd || tab.busy) return;
    setTermHistory((h) => [...h.filter((x) => x !== cmd), cmd].slice(-100));
    historyIdx.current = -1;
    patchTerm(id, () => ({ busy: true, approval: null, cmd: "", lines: [...tab.lines, { kind: "sys", text: `$ ${cmd}` }] }));
    const push = (l: TermLine) => patchTerm(id, (t) => ({ lines: [...t.lines, l] }));
    try {
      await terminalRun({ cmd }, (e: TerminalEvent) => {
        if (e.type === "status") {
          const s = e as Extract<TerminalEvent, { type: "status" }>;
          if (s.status === "approval_required") {
            patchTerm(id, () => ({ approval: { id: String(s.approvalId ?? ""), reason: s.cmd ? `run: ${s.cmd}` : undefined, risk: s.riskTier } as Approval }));
            push({ kind: "sys", text: `⏸ approval required (risk: ${s.riskTier ?? "?"}) — decide below` });
          } else if (s.status === "denied" || s.status === "timed_out") {
            push({ kind: "sys", text: s.status === "denied" ? "✗ denied — nothing was executed" : "⏱ approval timed out (fail-closed)" });
          } else if (s.status === "error") {
            push({ kind: "err", text: `error: ${s.error ?? "unknown"}` });
          }
        } else if (e.type === "output") {
          const o = e as Extract<TerminalEvent, { type: "output" }>;
          push({ kind: o.stream === "stderr" ? "err" : "out", text: o.text });
        } else if (e.type === "exit") {
          const x = e as Extract<TerminalEvent, { type: "exit" }>;
          push({ kind: "sys", text: `— exit ${x.code ?? "?"}${x.timedOut ? " (timed out)" : ""}${x.truncated ? " (output truncated at 256 KB)" : ""} in ${x.ms ?? "?"} ms` });
        }
      });
    } catch (e2) {
      push({ kind: "err", text: String((e2 as Error)?.message ?? e2) });
    } finally {
      patchTerm(id, () => ({ busy: false, approval: null }));
      refreshTree();
    }
  }, [terms, patchTerm, refreshTree]);

  const loadGit = useCallback(() => {
    api.gitStatus().then((s) => setGit({ branch: s.branch ?? null, entries: s.entries ?? [] })).catch(() => setGit(null));
    api.gitLog(8).then((l) => setGitLog(l.commits ?? [])).catch(() => undefined);
  }, []);
  useEffect(() => { loadGit(); const t = setInterval(loadGit, 8000); return () => clearInterval(t); }, [loadGit]);

  async function stageAll() {
    const paths = (git?.entries ?? []).map((e) => e.path);
    if (paths.length === 0) { setGitNote("nothing to stage — clean tree"); return; }
    setGitBusy(true); setGitNote("stage requested — approve it in Trust → Approvals…");
    try {
      const r = await api.gitStage(paths);
      setGitNote(r.applied ? (r.ok ? `staged ${paths.length} path(s)` : `git failed: ${r.error ?? "unknown"}`) : `not staged (${r.decision ?? "denied"})`);
      loadGit();
    } catch (e) { setGitNote(`engine rejected: ${e instanceof Error ? e.message : String(e)}`); } finally { setGitBusy(false); }
  }
  async function commit() {
    const msg = commitMsg.trim(); if (!msg) return;
    setGitBusy(true); setGitNote("commit requested — approve it in Trust → Approvals…");
    try {
      const r = await api.gitCommit(msg);
      if (r.applied && r.ok) { setCommitMsg(""); setGitNote(`committed: ${msg.slice(0, 60)}`); }
      else if (r.applied) setGitNote(`git failed: ${r.error ?? "unknown"}`);
      else setGitNote(`not committed (${r.decision ?? "denied"})`);
      loadGit();
    } catch (e) { setGitNote(`engine rejected: ${e instanceof Error ? e.message : String(e)}`); } finally { setGitBusy(false); }
  }

  const at = terms.find((t) => t.id === termTab) ?? terms[0];
  const dirtyTab = tabs.find((t) => t.rel === active)?.dirty ?? false;

  const renderTree = (entries: FileEntry[], depth: number, keyPrefix: string) =>
    entries.map((e) => {
      const isDir = e.type === "dir";
      const isOpen = !!expanded[e.rel];
      return (
        <div key={keyPrefix + e.rel}>
          <button
            onClick={() => (isDir ? toggleDir(e.rel) : void openFile(e.rel))}
            title={e.rel}
            style={{
              display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
              padding: `4px 8px`, paddingLeft: 10 + depth * 14, background: active === e.rel ? "var(--xr-surface-2)" : "transparent",
              border: "none", borderLeft: active === e.rel ? "2px solid var(--xr-accent)" : "2px solid transparent",
              color: "var(--xr-text-1)", fontFamily: "var(--xr-font-mono)", fontSize: 12, cursor: "pointer"
            }}
          >
            <span aria-hidden style={{ color: "var(--xr-text-3)" }}>{isDir ? (isOpen ? "▾" : "▸") : "·"}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
            {e.git && e.git !== "clean" && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--xr-warning)", marginLeft: 6 }} title={`git: ${e.git}`} />}
          </button>
          {isDir && isOpen && kids[e.rel] && renderTree(kids[e.rel], depth + 1, keyPrefix + e.rel + "/")}
          {isDir && isOpen && !kids[e.rel] && <div style={{ paddingLeft: 24 + depth * 14, fontSize: 11, color: "var(--xr-text-3)" }}>loading…</div>}
        </div>
      );
    });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 280px", gap: "var(--xr-space-2)", height: "100%", minHeight: 0, padding: "var(--xr-space-2)" }}>
      {/* explorer — Phase 2 CRUD */}
      <div style={{ display: "flex", flexDirection: "column", background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", overflow: "hidden", minHeight: 0 }}>
        <div style={{ padding: "8px 10px", fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-2)", borderBottom: "1px solid var(--xr-border)", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", gap: 6, alignItems: "center" }}>
          <span>{branch ? `⎇ ${branch}` : "files"}</span>
          <span style={{ flex: 1 }} />
          <button title="New file (approval-gated)" onClick={() => setShowNewFile((v) => !v)} style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 10, cursor: "pointer" }}>+ File</button>
          <button title="Refresh tree" onClick={refreshTree} style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 10, cursor: "pointer" }}>↻</button>
        </div>
        {showNewFile && (
          <div style={{ padding: 8, display: "flex", gap: 6, borderBottom: "1px solid var(--xr-border)", background: "var(--xr-surface-2)" }}>
            <input value={newFileName} onChange={(e) => setNewFileName(e.target.value)} placeholder="path/to/new.ts (engine validates traversal)" aria-label="New file path" style={{ flex: 1, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }} />
            <button
              onClick={async () => {
                const rel = newFileName.trim(); if (!rel) return;
                try {
                  const r = await api.filesWrite(rel, "", undefined);
                  if (r.applied) { setNewFileName(""); setShowNewFile(false); refreshTree(); void openFile(rel); }
                  else setErr(`not created (${r.decision ?? "denied"})`);
                } catch (e) { setErr(String(e)); }
              }}
              style={{ padding: "4px 8px", borderRadius: 4, background: "var(--xr-accent)", color: "white", border: "none", fontSize: 11, cursor: "pointer" }}
            >Create</button>
          </div>
        )}
        <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
          {loadingTree ? <div style={{ padding: 12, display: "grid", gap: 8 }}>{Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ height: 18, background: "var(--xr-surface-2)", borderRadius: 4 }} />)}</div> : renderTree(tree, 0, "")}
          {!loadingTree && tree.length === 0 && <div style={{ fontSize: 12, padding: 8, color: "var(--xr-text-3)" }}>open a workspace (engine root) — honest empty, no fake files</div>}
        </div>
      </div>

      {/* mid: tabs + editor + terminal */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--xr-space-2)", minHeight: 0 }}>
        <div style={{ display: "flex", gap: 0, overflowX: "auto", background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: "0 4px" }}>
          {tabs.length === 0 && <span style={{ padding: "8px 10px", fontSize: 12, color: "var(--xr-text-3)" }}>no file open — pick from explorer</span>}
          {tabs.map((t) => (
            <span key={t.rel} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderBottom: t.rel === active ? "2px solid var(--xr-accent)" : "2px solid transparent", whiteSpace: "nowrap" }}>
              <button onClick={() => void openFile(t.rel)} title={t.rel} style={{ background: "transparent", border: "none", color: t.rel === active ? "var(--xr-text-1)" : "var(--xr-text-2)", fontSize: 12, cursor: "pointer" }}>{t.name}{t.dirty && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--xr-warning)", display: "inline-block", marginLeft: 6 }} />}</button>
              <button onClick={() => closeTab(t.rel)} aria-label={`Close ${t.name}`} style={{ background: "transparent", border: "none", color: "var(--xr-text-3)", cursor: "pointer" }}>×</button>
            </span>
          ))}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "var(--xr-text-3)", paddingRight: 8 }}>⌘↵ ask XR about selection</span>
        </div>

        {save.phase === "awaiting" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderRadius: "var(--xr-radius-md)", background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }}>
            <span>engine approval required to write {active}</span>
            {pendingApproval ? (
              <span style={{ display: "inline-flex", gap: 6 }}>
                <button style={{ padding: "4px 10px", borderRadius: 6, background: "var(--xr-success)", color: "white", border: "none", cursor: "pointer" }} onClick={() => { void api.decide(pendingApproval.id, true).catch(() => undefined); }}>Approve</button>
                <button style={{ padding: "4px 10px", borderRadius: 6, background: "var(--xr-surface-3)", border: "1px solid var(--xr-border)", cursor: "pointer" }} onClick={() => { void api.decide(pendingApproval.id, false).catch(() => undefined); }}>Deny</button>
                <span style={{ color: "var(--xr-text-3)" }}>{String(pendingApproval.reason ?? "").slice(0, 80)}</span>
              </span>
            ) : <span style={{ color: "var(--xr-text-3)" }}>waiting for consent plane…</span>}
          </div>
        )}
        {save.phase === "error" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderRadius: "var(--xr-radius-md)", background: "color-mix(in srgb, var(--xr-danger) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--xr-danger) 30%, transparent)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }}>
            <span style={{ flex: 1 }}>{save.msg}</span><button style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer" }} onClick={() => setSave({ phase: "idle" })}>dismiss</button>
          </div>
        )}
        {err && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderRadius: "var(--xr-radius-md)", background: "color-mix(in srgb, var(--xr-danger) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--xr-danger) 30%, transparent)", fontSize: 12 }}>
            <span style={{ flex: 1 }}>{err}</span><button style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer" }} onClick={() => setErr(null)}>Dismiss</button>
          </div>
        )}

        <div ref={host} style={{ flex: 1, minHeight: 200, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", overflow: "hidden" }} />

        {/* terminal */}
        <div style={{ height: 220, display: "flex", flexDirection: "column", background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", overflow: "hidden" }} aria-label="Terminal (command runner)">
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--xr-border)", overflowX: "auto" }}>
            {terms.map((t) => (
              <button key={t.id} onClick={() => setTermTab(t.id)} style={{ padding: "6px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", border: "none", borderBottom: t.id === termTab ? "2px solid var(--xr-accent)" : "2px solid transparent", background: "transparent", color: t.id === termTab ? "var(--xr-text-1)" : "var(--xr-text-3)", cursor: "pointer" }}>{t.name}{t.busy && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--xr-accent)", display: "inline-block", marginLeft: 6 }} />}</button>
            ))}
            <button title="New terminal tab" onClick={() => { const id = termSeq.current++; setTerms((ts) => [...ts, { id, name: `terminal ${id}`, lines: [], cmd: "", busy: false, approval: null }]); setTermTab(id); }} style={{ padding: "6px 10px", border: "none", background: "transparent", cursor: "pointer" }}>+</button>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", padding: "0 8px", fontSize: 10, color: "var(--xr-text-3)", border: "1px solid var(--xr-border)", borderRadius: 999, margin: "4px 8px" }}>restricted process</span>
          </div>
          {at?.approval && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", background: "var(--xr-surface-2)", borderBottom: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }}>
              <span>run: {String(at.approval.reason ?? "").replace(/^run:\s*/, "").slice(0, 120)}</span>
              <span style={{ display: "inline-flex", gap: 6, marginLeft: "auto" }}>
                <button style={{ padding: "4px 10px", borderRadius: 6, background: "var(--xr-success)", color: "white", border: "none", cursor: "pointer" }} onClick={() => { void api.decide(at.approval!.id, true).catch(() => undefined); }}>Approve</button>
                <button style={{ padding: "4px 10px", borderRadius: 6, background: "var(--xr-surface-3)", border: "1px solid var(--xr-border)", cursor: "pointer" }} onClick={() => { void api.decide(at.approval!.id, false).catch(() => undefined); }}>Deny</button>
                {at.approval.risk && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-3)", border: "1px solid var(--xr-border)" }}>risk {String(at.approval.risk)}</span>}
              </span>
            </div>
          )}
          <pre ref={termOut} style={{ flex: 1, overflow: "auto", margin: 0, padding: 10, fontFamily: "var(--xr-font-mono)", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--xr-surface-1)" }}>
            {at && at.lines.length === 0 ? "type a command below — every run goes through the engine's policy check and your approval.\n" : at?.lines.map((l, i) => <span key={i} style={{ color: l.kind === "err" ? "var(--xr-danger)" : l.kind === "sys" ? "var(--xr-text-3)" : "var(--xr-text-1)" }}>{l.text}{"\n"}</span>)}
          </pre>
          <form onSubmit={(e) => { e.preventDefault(); void runTerminal(at.id); }} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", borderTop: "1px solid var(--xr-border)" }}>
            <span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 12, color: "var(--xr-text-3)" }}>$</span>
            <input
              value={at?.cmd ?? ""}
              onChange={(e) => patchTerm(at.id, () => ({ cmd: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const nextIdx = historyIdx.current === -1 ? termHistory.length - 1 : Math.max(0, historyIdx.current - 1);
                  if (termHistory[nextIdx]) { patchTerm(at.id, () => ({ cmd: termHistory[nextIdx] })); historyIdx.current = nextIdx; }
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (historyIdx.current === -1) return;
                  const nextIdx = historyIdx.current + 1;
                  if (nextIdx >= termHistory.length) { patchTerm(at.id, () => ({ cmd: "" })); historyIdx.current = -1; }
                  else { patchTerm(at.id, () => ({ cmd: termHistory[nextIdx] })); historyIdx.current = nextIdx; }
                }
              }}
              placeholder={at?.busy ? "running…" : "git status · ↑↓ history · 100 saved"}
              disabled={at?.busy}
              autoFocus
              style={{ flex: 1, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", borderRadius: 6, padding: "6px 8px", fontFamily: "var(--xr-font-mono)", fontSize: 12, color: "var(--xr-text-1)" }}
            />
            <button type="submit" disabled={!at || at.busy || !at.cmd.trim()} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "var(--xr-accent)", color: "white", cursor: "pointer", opacity: !at || at.busy || !at.cmd.trim() ? 0.5 : 1 }}>Run</button>
            <button type="button" onClick={() => patchTerm(at.id, () => ({ lines: [] }))} disabled={at?.busy} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer" }}>Clear</button>
          </form>
        </div>
      </div>

      {/* agent rail */}
      <aside aria-label="Agent rail" style={{ display: "flex", flexDirection: "column", gap: "var(--xr-space-2)", overflow: "auto", minHeight: 0 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)" }}>
          <XrAvatar size={30} />
          <div><div style={{ fontWeight: 600, fontSize: 13 }}>XR Agent</div><div style={{ fontSize: 11, color: "var(--xr-text-2)" }}>{agentNote}</div></div>
        </div>

        {dirtyTab && (
          <div style={{ padding: 12, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 8 }} role="group" aria-label="Proposed edits">
            <div style={{ fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Proposed edits{active ? ` · ${active.split("/").pop()}` : ""}</div>
            <div style={{ display: "flex", gap: 6 }}><span style={{ padding: "2px 8px", borderRadius: 999, background: "color-mix(in srgb, var(--xr-success) 15%, transparent)", border: "1px solid var(--xr-success)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>+{delta.added}</span><span style={{ padding: "2px 8px", borderRadius: 999, background: "color-mix(in srgb, var(--xr-danger) 15%, transparent)", border: "1px solid var(--xr-danger)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>−{delta.removed}</span></div>
            <button disabled={save.phase === "awaiting"} onClick={() => void doSave()} title="Save via engine (requires your approval; Mod-S)" style={{ padding: "8px 12px", borderRadius: "var(--xr-radius-md)", background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer", fontWeight: 600 }}>{save.phase === "awaiting" ? "Awaiting approval…" : "Approve & Apply"}</button>
          </div>
        )}

        <div style={{ padding: 12, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Workspace diff (engine-computed)</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--xr-font-mono)", fontSize: 11, background: "var(--xr-surface-2)", padding: 8, borderRadius: 6, maxHeight: 160, overflow: "auto" }}>{diff ?? "select a file to see its diff"}</pre>
        </div>

        <div style={{ padding: 12, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 8 }} role="group" aria-label="Git">
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>Git · {git?.branch ?? "—"}<button style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 10, cursor: "pointer" }} onClick={loadGit} aria-label="Refresh git">refresh</button></div>
          <div style={{ display: "grid", gap: 4 }}>
            {(git?.entries ?? []).length === 0 && <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>clean working tree — honest, not invented</div>}
            {(git?.entries ?? []).slice(0, 10).map((e) => (
              <button key={e.path} onClick={() => void openFile(e.path)} title={`${e.code} — open in editor`} style={{ display: "flex", gap: 6, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>
                <span style={{ color: e.code.startsWith("??") ? "var(--xr-text-3)" : e.code.includes("D") ? "var(--xr-danger)" : "var(--xr-warning)" }}>{e.code}</span><span style={{ color: "var(--xr-text-1)", overflow: "hidden", textOverflow: "ellipsis" }}>{e.path}</span>
              </button>
            ))}
            {(git?.entries ?? []).length > 10 && <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>+ {(git?.entries ?? []).length - 10} more</div>}
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            {gitLog.slice(0, 5).map((c) => (<div key={c.hash} style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.subject}><span style={{ color: "var(--xr-text-3)" }}>{c.hash}</span> {c.subject}</div>))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void commit(); }} style={{ display: "grid", gap: 6 }}>
            <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="commit message…" aria-label="Commit message" style={{ background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", borderRadius: 6, padding: "6px 8px", fontSize: 12 }} />
            <span style={{ display: "flex", gap: 6 }}><button type="button" disabled={gitBusy} onClick={() => void stageAll()} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>Stage all</button><button type="submit" disabled={gitBusy || !commitMsg.trim()} style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: "var(--xr-accent)", color: "white", fontSize: 11, cursor: "pointer", opacity: gitBusy || !commitMsg.trim() ? 0.5 : 1 }}>Commit</button></span>
          </form>
          {gitNote && <div style={{ fontSize: 11, color: "var(--xr-text-2)", fontFamily: "var(--xr-font-mono)" }}>{gitNote}</div>}
        </div>

        <div style={{ padding: 12, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>Tips</div>
          <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>⌘/Ctrl+↵ — ask XR about selection</div>
          <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>⌘/Ctrl+S — save through approval gate</div>
          <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>terminal runs approval-gated, streamed</div>
        </div>
      </aside>
    </div>
  );
}
