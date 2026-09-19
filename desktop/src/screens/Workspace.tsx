import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { api, terminalRun, type Approval, type FileDiff, type FileEntry, type TerminalEvent } from "../api/client";
import { XrAvatar } from "../components/Brand";
import { HunkReview } from "../components/HunkReview";

// xterm rides in its own chunk: the Workspace pays for it only when a shell opens.
const PtyTerminal = lazy(() => import("../components/PtyTerminal").then((m) => ({ default: m.PtyTerminal })));

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
interface TermTab { id: number; name: string; kind: "runner" | "pty"; lines: TermLine[]; cmd: string; busy: boolean; approval: Approval | null; exited?: string; }
interface Tab { rel: string; name: string; dirty: boolean; }

/** Naive honest line diff counts (common prefix/suffix trim) — for the +/− chips only. The engine remains the source of truth for real diffs. */
function lineDelta(base: string, next: string): { added: number; removed: number } {
  const a = base.split("\n"); const b = next.split("\n");
  let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0; while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { added: b.length - p - s, removed: a.length - p - s };
}

/** Workspace (phase 6, mocks 01+04): nested explorer · editor tabs · terminal tabs · agent rail. */
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
  const [diff, setDiff] = useState<FileDiff | null>(null);
  /* Phase 2 · Git panel — engine-computed status/log; stage/commit are
     approval-gated engine verbs (they block until a human decides). */
  const [git, setGit] = useState<{ branch: string | null; entries: { code: string; path: string }[] } | null>(null);
  const [gitLog, setGitLog] = useState<{ hash: string; date?: string; subject?: string }[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [gitNote, setGitNote] = useState<string | null>(null);
  const [gitBusy, setGitBusy] = useState(false);
  const [agentNote, setAgentNote] = useState("idle — open a file or ask XR");

  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef<Map<string, EditorState>>(new Map());
  const bases = useRef<Map<string, { text: string; mtime?: number }>>(new Map());
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;

  // Terminal tabs (line-based command runner; honest, not a PTY)
  const [terms, setTerms] = useState<TermTab[]>([{ id: 1, name: "runner 1", kind: "runner", lines: [], cmd: "", busy: false, approval: null }]);
  const [termTab, setTermTab] = useState(1);
  const termSeq = useRef(2);
  const termOut = useRef<HTMLPreElement>(null);

  useEffect(() => {
    api.files("").then((r) => { setTree(r.entries ?? []); setBranch(r.branch ?? null); }).catch(() => setTree([]));
  }, []);
  useEffect(() => {
    const t = terms.find((x) => x.id === termTab);
    if (t && termOut.current) termOut.current.scrollTop = termOut.current.scrollHeight;
  }, [terms, termTab]);

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
      EditorView.theme({ "&": { height: "100%", fontSize: "13px" }, ".cm-scroller": { fontFamily: "var(--xr-font-mono)" } }),
      EditorView.updateListener.of((u) => { if (u.docChanged) syncDirty(); }),
      keymap.of([
        {
          key: "Mod-Enter",
          run: (v: EditorView) => {
            const sel = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);
            onAskXr(sel ? `About this selection in ${rel}:\n"""\n${sel.slice(0, 4000)}\n"""\n` : `Explain ${rel} and propose improvements.`);
            return true;
          },
        },
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
    const text = r.binary ? "// binary file — preview not available" : String(r.content ?? r.text ?? "");
    bases.current.set(rel, { text, mtime: (r as { mtimeMs?: number }).mtimeMs });
    const st = makeState(text, rel);
    states.current.set(rel, st);
    view.current.setState(st);
    setTabs((ts) => (ts.some((t) => t.rel === rel) ? ts : [...ts, { rel, name: rel.split("/").pop() ?? rel, dirty: false }]));
    setDelta({ added: 0, removed: 0 });
    api.fileDiff(rel).then(setDiff).catch(() => setDiff(null));
  }, [makeState, syncDirty]);

  /** After the engine changed the file (hunk revert): the buffer must show the disk, not a stale edit. */
  const reloadFromDisk = useCallback(async (rel: string, mtimeMs?: number) => {
    const r = await api.fileRead(rel).catch(() => null);
    if (!r || r.binary) return;
    const text = String(r.content ?? r.text ?? "");
    bases.current.set(rel, { text, mtime: mtimeMs ?? (r as { mtimeMs?: number }).mtimeMs });
    const st = makeState(text, rel);
    states.current.set(rel, st);
    if (activeRef.current === rel && view.current) view.current.setState(st);
    setTabs((ts) => ts.map((t) => (t.rel === rel ? { ...t, dirty: false } : t)));
    setDelta({ added: 0, removed: 0 });
    refreshTree();
  }, [makeState]);

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

  /** Save: POST blocks while the engine raises a durable approval; poll and render it. */
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
        const list = Array.isArray(res) ? res : res.pending ?? [];
        const hit = list.find((a) => (a as Approval & { tool?: string }).tool === "write_file");
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
        api.fileDiff(rel).then(setDiff).catch(() => setDiff(null));
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
    patchTerm(id, () => ({ busy: true, approval: null, cmd: "", lines: [...tab.lines, { kind: "sys", text: `$ ${cmd}` }] }));
    const push = (l: TermLine) => patchTerm(id, (t) => ({ lines: [...t.lines, l] }));
    try {
      await terminalRun({ cmd }, (e: TerminalEvent) => {
        if (e.type === "status") {
          const s = e as Extract<TerminalEvent, { type: "status" }>;
          if (s.status === "approval_required") {
            patchTerm(id, () => ({ approval: { id: String(s.approvalId ?? ""), reason: s.cmd ? `run: ${s.cmd}` : undefined, risk: s.riskTier } }));
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
  useEffect(() => {
    loadGit();
    const t = setInterval(loadGit, 8000);
    return () => clearInterval(t);
  }, [loadGit]);

  async function stageAll() {
    const paths = (git?.entries ?? []).map((e) => e.path);
    if (paths.length === 0) { setGitNote("nothing to stage — clean tree"); return; }
    setGitBusy(true); setGitNote("stage requested — approve it in Trust → Approvals (or the toast)…");
    try {
      const r = await api.gitStage(paths);
      setGitNote(r.applied ? (r.ok ? `staged ${paths.length} path(s)` : `git failed: ${r.error ?? "unknown"}`) : `not staged (${r.decision ?? "denied"})`);
      loadGit();
    } catch (e) {
      setGitNote(`engine rejected: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGitBusy(false);
    }
  }

  async function commit() {
    const msg = commitMsg.trim();
    if (!msg) return;
    setGitBusy(true); setGitNote("commit requested — approve it in Trust → Approvals…");
    try {
      const r = await api.gitCommit(msg);
      if (r.applied && r.ok) { setCommitMsg(""); setGitNote(`committed: ${msg.slice(0, 60)}`); }
      else if (r.applied) setGitNote(`git failed: ${r.error ?? "unknown"}`);
      else setGitNote(`not committed (${r.decision ?? "denied"})`);
      loadGit();
    } catch (e) {
      setGitNote(`engine rejected: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGitBusy(false);
    }
  }

  const at = terms.find((t) => t.id === termTab) ?? terms[0];

  const renderTree = (entries: FileEntry[], depth: number, keyPrefix: string) =>
    entries.map((e) => {
      const isDir = e.type === "dir";
      const isOpen = !!expanded[e.rel];
      return (
        <div key={keyPrefix + e.rel}>
          <button
            className={`fitem ${isDir ? "dir" : ""} ${active === e.rel ? "active" : ""}`}
            style={{ paddingLeft: 10 + depth * 14 }}
            onClick={() => (isDir ? toggleDir(e.rel) : void openFile(e.rel))}
            title={e.rel}
          >
            <span className="fico" aria-hidden="true">{isDir ? (isOpen ? "▾" : "▸") : "·"}</span>
            {e.name}
            {e.git && e.git !== "clean" && <i className="sdot idle" style={{ marginLeft: 6 }} title={`git: ${e.git}`} />}
          </button>
          {isDir && isOpen && kids[e.rel] && renderTree(kids[e.rel], depth + 1, keyPrefix + e.rel + "/")}
          {isDir && isOpen && !kids[e.rel] && <div className="faint" style={{ paddingLeft: 24 + depth * 14, fontSize: 11 }}>loading…</div>}
        </div>
      );
    });

  const dirtyTab = tabs.find((t) => t.rel === active)?.dirty ?? false;

  return (
    <div className="ws2">
      <div className="ws-explorer" aria-label="Project explorer">
        <div className="rail-h mono">
          {branch ? `⎇ ${branch}` : "files"}
        </div>
        <div className="tree-scroll">{renderTree(tree, 0, "")}</div>
        {tree.length === 0 && <div className="faint" style={{ fontSize: 12, padding: 8 }}>open a workspace (engine root)</div>}
      </div>

      <div className="ws-mid">
        <div className="ws-tabs mono">
          {tabs.length === 0 && <span className="faint">no file open</span>}
          {tabs.map((t) => (
            <span key={t.rel} className={t.rel === active ? "tab2 active" : "tab2"}>
              <button className="tab-open" onClick={() => void openFile(t.rel)} title={t.rel}>{t.name}{t.dirty && <i className="dirty" />}</button>
              <button className="tab-x" onClick={() => closeTab(t.rel)} aria-label={`Close ${t.name}`}>×</button>
            </span>
          ))}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <span className="faint">⌘↵ ask XR about selection</span>
          </span>
        </div>

        {save.phase === "awaiting" && (
          <div className="approval-mini">
            <span className="mono">engine approval required to write {active}</span>
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

        <div className="term2" aria-label="Terminal (command runner)">
          <div className="term2-tabs">
            {terms.map((t) => (
              <button key={t.id} className={t.id === termTab ? "ttab active" : "ttab"} onClick={() => setTermTab(t.id)}>
                {t.name}{t.busy && <i className="cdot c" />}
              </button>
            ))}
            <button
              className="ttab add"
              title="New shell — a real terminal (engine PTY); one approval per session"
              onClick={() => {
                const id = termSeq.current++;
                setTerms((ts) => [...ts, { id, name: `shell ${id}`, kind: "pty", lines: [], cmd: "", busy: false, approval: null }]);
                setTermTab(id);
              }}
            >+ shell</button>
            <button
              className="ttab add"
              title="New command runner — one approval per command, output streamed"
              onClick={() => {
                const id = termSeq.current++;
                setTerms((ts) => [...ts, { id, name: `runner ${id}`, kind: "runner", lines: [], cmd: "", busy: false, approval: null }]);
                setTermTab(id);
              }}
            >+ runner</button>
            {terms.length > 1 && at && (
              <button
                className="ttab add"
                title="Close this tab (a shell is killed by the engine on disconnect)"
                aria-label="Close terminal tab"
                onClick={() => {
                  setTerms((ts) => ts.filter((t) => t.id !== at.id));
                  setTermTab((cur) => (cur === at.id ? (terms.find((t) => t.id !== at.id)?.id ?? 1) : cur));
                }}
              >×</button>
            )}
            <span className="chip restricted" title={at?.kind === "pty" ? "Interactive shell: one approval opens it; keystrokes are not policy-inspected" : "Commands run approval-gated through the engine — not an interactive PTY"}>
              {at?.kind === "pty" ? "interactive shell · session-approved" : "command runner · per-command approval"}
            </span>
          </div>
          {at?.kind === "pty" && (
            <Suspense fallback={<div className="pty-status faint mono">loading terminal…</div>}>
              <PtyTerminal key={at.id} onExit={(x) => patchTerm(at.id, () => ({ exited: x.signal ? x.signal : `code ${x.code ?? "?"}` }))} />
            </Suspense>
          )}
          {at?.kind === "runner" && at?.approval && (
            <div className="approval-mini">
              <span className="mono">run: {String(at.approval.reason ?? "").replace(/^run:\s*/, "").slice(0, 120)}</span>
              <span className="row-gap">
                <button className="btn btn-ok" onClick={() => { void api.decide(at.approval!.id, true).catch(() => undefined); }}>Approve</button>
                <button className="btn btn-bad" onClick={() => { void api.decide(at.approval!.id, false).catch(() => undefined); }}>Deny</button>
                {at.approval.risk && <span className="chip">risk {String(at.approval.risk)}</span>}
              </span>
            </div>
          )}
          {at?.kind === "runner" && (<>
          <pre className="term-out raw" ref={termOut}>
            {at && at.lines.length === 0
              ? "type a command below — every run goes through the engine's policy check and your approval.\n"
              : at?.lines.map((l, i) => (
                  <span key={i} className={l.kind === "err" ? "term-err" : l.kind === "sys" ? "term-sys" : undefined}>{l.text}</span>
                ))}
          </pre>
          <form className="term-in" onSubmit={(e) => { e.preventDefault(); void runTerminal(at.id); }}>
            <span className="mono faint">$</span>
            <input
              className="mono"
              value={at?.cmd ?? ""}
              onChange={(e) => patchTerm(at.id, () => ({ cmd: e.target.value }))}
              placeholder={at?.busy ? "running…" : "git status"}
              disabled={at?.busy}
              autoFocus
            />
            <button className="btn btn-accent" type="submit" disabled={!at || at.busy || !at.cmd.trim()}>Run</button>
            <button className="btn" type="button" onClick={() => patchTerm(at.id, () => ({ lines: [] }))} disabled={at?.busy}>Clear</button>
          </form>
          </>)}
        </div>
      </div>

      <aside className="agent-rail" aria-label="Agent rail">
        <div className="ar-head">
          <XrAvatar size={30} />
          <div>
            <div className="ar-name">XR Agent</div>
            <div className="ar-status faint">{agentNote}</div>
          </div>
        </div>

        {dirtyTab && (
          <div className="ar-card edits" role="group" aria-label="Proposed edits">
            <div className="ar-h">Proposed edits{active ? ` · ${active.split("/").pop()}` : ""}</div>
            <div className="ar-chips">
              <span className="chip add">+{delta.added}</span>
              <span className="chip rem">−{delta.removed}</span>
            </div>
            <button className="btn primary wide" disabled={save.phase === "awaiting"} onClick={() => void doSave()} title="Save via engine (requires your approval; Mod-S)">
              {save.phase === "awaiting" ? "Awaiting approval…" : "Approve & Apply"}
            </button>
          </div>
        )}

        <div className="ar-card diffcard">
          <div className="ar-h">
            Working-tree diff (engine-computed)
            {diff?.hunks?.length ? <span className="chip" style={{ marginLeft: "auto" }}>{diff.hunks.length} hunk{diff.hunks.length === 1 ? "" : "s"}</span> : null}
          </div>
          <HunkReview
            path={active}
            diff={diff}
            baseMtimeMs={active ? bases.current.get(active)?.mtime : undefined}
            onChanged={(next) => {
              setDiff((d) => (d ? { ...d, hunks: next.hunks, diff: next.diff } : d));
              if (active) void reloadFromDisk(active, next.mtimeMs);
            }}
          />
        </div>

        <div className="ar-card gitcard" role="group" aria-label="Git">
          <div className="ar-h">
            Git · {git?.branch ?? "—"}
            <button className="chipbtn" style={{ marginLeft: "auto" }} onClick={loadGit} aria-label="Refresh git">refresh</button>
          </div>
          <div className="git-entries">
            {(git?.entries ?? []).length === 0 && <div className="faint ar-tip">clean working tree</div>}
            {(git?.entries ?? []).slice(0, 10).map((e) => (
              <button key={e.path} className="git-row" onClick={() => void openFile(e.path)} title={`${e.code} — open in editor`}>
                <span className={`git-code ${e.code.startsWith("??") ? "u" : e.code.includes("D") ? "d" : "m"}`}>{e.code}</span>
                <span className="mono git-path">{e.path}</span>
              </button>
            ))}
            {(git?.entries ?? []).length > 10 && <div className="faint ar-tip">+ {(git?.entries ?? []).length - 10} more</div>}
          </div>
          <div className="git-log">
            {gitLog.slice(0, 5).map((c) => (
              <div key={c.hash} className="git-log-row mono" title={c.subject}>
                <span className="faint">{c.hash}</span> {c.subject}
              </div>
            ))}
          </div>
          <form className="git-commit" onSubmit={(e) => { e.preventDefault(); void commit(); }}>
            <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="commit message…" aria-label="Commit message" />
            <span className="row-gap">
              <button type="button" className="chipbtn" disabled={gitBusy} onClick={() => void stageAll()}>Stage all</button>
              <button type="submit" className="chipbtn" disabled={gitBusy || !commitMsg.trim()}>Commit</button>
            </span>
          </form>
          {gitNote && <div className="faint ar-tip mono">{gitNote}</div>}
        </div>

        <div className="ar-card">
          <div className="ar-h">Tips</div>
          <div className="faint ar-tip">⌘/Ctrl+↵ — ask XR about the selection</div>
          <div className="faint ar-tip">⌘/Ctrl+S — save through the approval gate</div>
          <div className="faint ar-tip">terminal runs are approval-gated, streamed output</div>
        </div>
      </aside>
    </div>
  );
}
