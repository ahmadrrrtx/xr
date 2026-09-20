import { useCallback, useEffect, useRef, useState } from "react";
import { api, asList, chatStream, type Approval, type ProviderInfo, type StreamEvent } from "../api/client";
import { ApprovalCountdown } from "../components/ApprovalCountdown";
import { XrAvatar } from "../components/Brand";
import { ContextMenu, type CtxState } from "../components/ContextMenu";
import { poll } from "../poll";
import { pushToast } from "../components/ToastBus";

interface Msg { role: "user" | "xr"; text: string; }
interface ToolRow { id: string; tool: string; args?: unknown; ok?: boolean; result?: string; error?: string; done: boolean; startMs: number; endMs?: number; }
interface EvRow { t: number; type: string; detail: string; }

/* Phase 2 · F-7 — the inspector gains Approvals (decisions this run),
   Artifacts (paths produced by write/edit tools, observed from the stream)
   and Memory (engine memory peek, IA §1). */
type InspTab = "transcript" | "plan" | "files" | "tools" | "approvals" | "artifacts" | "memory" | "cost";

/** Phase 2 · draft autosave key — a crashed window must not eat a half-typed goal. */
const DRAFT_KEY = "xr.work.draft";

const FILE_TOOLS = /file|read|write|edit|patch|fs|glob|grep/i;

/** Work (phase 6, mock 03): chat column + Run Inspector. All data engine-streamed — nothing invented. */
export function Work({ seed, onConsumed }: { seed: string | null; onConsumed: () => void }) {
  const [input, setInput] = useState("");
  /* Phase 3 · contextual menu for message objects (copy / reuse — real actions). */
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [evs, setEvs] = useState<EvRow[]>([]);
  const [plan, setPlan] = useState<EvRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [mode, setMode] = useState<"agent" | "ask" | "plan">("agent");
  const [model, setModel] = useState("");
  const [attach, setAttach] = useState<string | null>(null);
  const [attachBody, setAttachBody] = useState<string | null>(null);
  const [cost, setCost] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<InspTab>("tools");
  /* Phase 2 · decisions taken this run (Approvals tab) + produced paths
     (Artifacts tab) — both observed, never invented. */
  const [decisions, setDecisions] = useState<{ id: string; approved: boolean; action?: string; at: number }[]>([]);
  const [artifacts, setArtifacts] = useState<{ tool: string; path: string }[]>([]);
  const [memory, setMemory] = useState<{ id: string; content?: string; category?: string }[] | null>(null);
  /* Phase 2 · viewport drop zone. */
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const lastTask = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* Phase 2 · F-9 — approvals now come from the shared poll hub (one
     observation for the whole shell), replacing this screen's private 2.5 s
     interval. Cost is read when the run ends and when the Cost tab opens —
     it moves at tool-call speed, not at 2.5 s polling speed. */
  useEffect(() => {
    const off = poll.subscribe(["approvals"], (o) => {
      if (o.ok) setApprovals(asList<Approval>(o.value, "pending", "approvals"));
    });
    api.providers().then((p) => {
      const list = asList<ProviderInfo>(p, "providers", "items");
      setProviders(list);
      const first = list.find((x) => x.available !== false);
      if (first) setModel(first.models?.[0] ?? first.id);
    }).catch(() => {});
    return off;
  }, []);
  useEffect(() => {
    if (tab === "cost") api.cost().then(setCost).catch(() => {});
    if (tab === "memory" && memory === null) {
      api.memory().then((m) => setMemory(asList(m, "entries").slice(0, 12))).catch(() => setMemory([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /* Draft autosave: restore once, persist on change, clear on send. */
  useEffect(() => {
    try {
      const d = window.localStorage.getItem(DRAFT_KEY);
      if (d) setInput(d);
    } catch { /* storage unavailable — drafts simply do not persist */ }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (input) window.localStorage.setItem(DRAFT_KEY, input);
        else window.localStorage.removeItem(DRAFT_KEY);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  /* Viewport-level drop zone (mission feedback system): accepted types attach
     like the picker; anything else is rejected with an honest toast. */
  const acceptDrop = useCallback((f: File | undefined) => {
    if (!f) return;
    const textual = /^text\//.test(f.type) || /\.(md|txt|ts|tsx|js|jsx|json|css|html|py|rs|go|sh|yml|yaml|toml)$/i.test(f.name);
    if (!textual) {
      pushToast("warn", "Cannot attach", `${f.name} — text-based files only (first 4 KB)`);
      return;
    }
    onPickFileRef.current(f);
  }, []);
  const onPickFileRef = useRef<(f: File | undefined) => void>(() => {});

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragOver(true); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragOver(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0; setDragOver(false);
      acceptDrop(e.dataTransfer?.files?.[0]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [acceptDrop]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, tools, status, approvals]);

  useEffect(() => {
    if (seed) { send(seed); onConsumed(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  /** Transcript entries for transport-level facts: an HTTP-level rejection
   *  (e.g. 503 provider offline) emits NO stream events, so the attempt and
   *  the failure are noted here — the inspector records what actually happened. */
  function note(type: string, detail: string) {
    setEvs((v) => [...v.slice(-499), { t: Date.now(), type, detail }]);
  }

  function record(e: StreamEvent) {
    const detail = JSON.stringify(e).slice(0, 180);
    setEvs((v) => [...v.slice(-499), { t: Date.now(), type: e.type ?? "event", detail }]);
    if (e.type === "status") {
      const st = e as unknown as { status?: string; message?: string };
      setPlan((v) => [...v, { t: Date.now(), type: String(st.status ?? "status"), detail: String(st.message ?? "") }]);
    }
  }

  function onPickFile(f: File | undefined) {
    if (!f) return;
    setAttach(f.name);
    const r = new FileReader();
    r.onload = () => setAttachBody(typeof r.result === "string" ? r.result.slice(0, 4000) : null);
    r.onerror = () => setAttachBody(null);
    r.readAsText(f.slice(0, 8192));
  }
  onPickFileRef.current = onPickFile;

  /** Observed artifact paths: only what the stream actually reported. */
  const pathOf = (a: unknown): string | null => {
    if (a && typeof a === "object") {
      const o = a as Record<string, unknown>;
      const p = o.path ?? o.file ?? o.file_path ?? o.rel;
      if (typeof p === "string") return p;
    }
    return null;
  };

  /** Forward a decision AND record it for the Approvals tab (this run only). */
  function decide(a: Approval, approved: boolean) {
    api.decide(a.id, approved)
      .then(() => {
        setApprovals((p) => p.filter((x) => x.id !== a.id));
        setDecisions((d) => [...d, { id: a.id, approved, action: String(a.action ?? ""), at: Date.now() }]);
      })
      .catch(() => {});
  }

  async function send(raw: string) {
    let task = raw.trim();
    if (!task || running) return;
    if (attachBody) task = `${task}\n\n[attached ${attach} — first 4KB]\n\`\`\`\n${attachBody}\n\`\`\``;
    else if (attach) task = `${task}\n\n[references file: ${attach}]`;
    setAttach(null); setAttachBody(null);
    lastTask.current = task;
    setInput(""); setErr(null); setRunning(true); setStatus("starting");
    setMsgs((m) => [...m, { role: "user", text: task }, { role: "xr", text: "" }]);
    setTools([]); setEvs([]); setPlan([]);
    note("chat", `POST /chat mode=${mode}${model ? ` model=${model}` : ""} · "${task.slice(0, 80)}"`);
    const ac = new AbortController();
    abort.current = ac;
    try {
      await chatStream({ message: task, mode, ...(model ? { model } : {}) }, (e: StreamEvent) => {
        record(e);
        switch (e.type) {
          case "token":
            setMsgs((m) => { const c = [...m]; const last = c[c.length - 1]; c[c.length - 1] = { ...last, text: last.text + (e.text ?? "") }; return c; });
            break;
          case "tool_call": {
            const tc = e as unknown as { id: string; tool: string; args?: unknown };
            setTools((t) => [...t, { id: tc.id, tool: tc.tool, args: tc.args, done: false, startMs: Date.now() }]);
            setStatus(`using ${tc.tool}`);
            if (/write|edit|patch/i.test(tc.tool)) {
              const p = pathOf(tc.args);
              if (p) setArtifacts((prev) => (prev.some((x) => x.path === p) ? prev : [...prev, { tool: tc.tool, path: p }]));
            }
            break;
          }
          case "tool_result": {
            const tr = e as unknown as { id: string; ok?: boolean; result?: string; error?: string };
            setTools((t) => t.map((r) => (r.id === tr.id ? { ...r, ok: tr.ok, result: tr.result, error: tr.error, done: true, endMs: Date.now() } : r)));
            break;
          }
          case "status": {
            const st = e as unknown as { status?: string; message?: string };
            setStatus(st.message ?? st.status ?? null);
            break;
          }
          case "error":
            setErr(String(e.error ?? e.message ?? "run failed"));
            break;
          case "done":
            setStatus(null);
            break;
        }
      }, ac.signal);
    } catch (ex) {
      if (!ac.signal.aborted) {
        const m = ex instanceof Error ? ex.message : String(ex);
        setErr(m);
        note("error", `stream failed before any event: ${m.slice(0, 160)}`);
      }
    } finally {
      setRunning(false);
      setStatus(null);
      api.cost().then(setCost).catch(() => {});
    }
  }

  const args1 = (a: unknown) =>
    typeof a === "object" && a ? Object.values(a as Record<string, unknown>).slice(0, 2).map(String).join(" ").slice(0, 64) : "";
  const dur = (r: ToolRow) => (r.endMs ? `${((r.endMs - r.startMs) / 1000).toFixed(1)}s` : "…");

  return (
    <div className="work2">
      <div className="chat-col">
        <div className="transcript2" aria-live="polite">
          {msgs.length === 0 && (
            <div className="empty">
              <XrAvatar size={44} />
              <p>Ask XR to do something. Watch every tool call, approve every risky step.</p>
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="row-user">
                <div
                  className="bubble user mono"
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    const t = m.text;
                    setCtx({
                      x: ev.clientX,
                      y: ev.clientY,
                      items: [
                        { label: "Copy text", run: () => { void navigator.clipboard?.writeText(t).catch(() => undefined); } },
                        { label: "Edit into input", run: () => setInput(t) },
                        { label: "Send again", run: () => { void send(t); } },
                      ],
                    });
                  }}
                >
                  {m.text}
                </div>
                <span className="ava user" aria-hidden="true">Y</span>
              </div>
            ) : (
              <div key={i} className="row-xr">
                <XrAvatar size={26} />
                <div
                  className="bubble xr"
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    const t = m.text;
                    setCtx({
                      x: ev.clientX,
                      y: ev.clientY,
                      items: [
                        { label: "Copy text", run: () => { void navigator.clipboard?.writeText(t).catch(() => undefined); } },
                        { label: "Ask a follow-up", run: () => setInput(`About your last reply ("${t.slice(0, 120)}…") — `) },
                      ],
                    });
                  }}
                >
                  {m.text || (running && i === msgs.length - 1 ? "" : <span className="faint">(empty reply)</span>)}
                </div>
              </div>
            ),
          )}

          {tools.length > 0 && (
            <div className="toolrows" aria-label="Tool calls">
              {tools.map((t) => (
                <div key={t.id} className="toolrow">
                  <span className={`cdot ${t.done ? (t.ok ? "g" : "r") : "c"}`} aria-hidden="true" />
                  <span className="mono tool">{t.tool}</span>
                  <span className="mono faint args">{args1(t.args)}</span>
                  <span className="spacer" />
                  <span className="mono dur faint">{dur(t)}</span>
                  {t.done && (t.ok
                    ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3ddc84" strokeWidth="2.4" aria-label="succeeded"><path d="M4 12l5 5L20 6" /></svg>
                    : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="2.4" aria-label="failed"><path d="M6 6l12 12M18 6L6 18" /></svg>)}
                </div>
              ))}
            </div>
          )}

          {running && status && (
            <div className="thinking" role="status">
              <span className="tdots" aria-hidden="true"><i /><i /><i /></span> {status}
            </div>
          )}

          {approvals.map((a) => (
            <div key={a.id} className="appr-card" role="alertdialog" aria-label="Approval request">
              <div className="appr-h">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" />
                </svg>
                XR wants to run:
                <ApprovalCountdown deadline={a} />
              </div>
              <div className="appr-action mono">{String(a.action ?? JSON.stringify(a).slice(0, 160))}</div>
              {a.reason && <div className="appr-reason faint">{String(a.reason)}</div>}
              <div className="appr-row">
                <button className="btn small" onClick={() => decide(a, false)}>Deny</button>
                <button className="btn small primary" onClick={() => decide(a, true)}>Allow once</button>
              </div>
            </div>
          ))}

          {err && (
            <div className="errline mono">
              <span className="err-text">error: {err}</span>
              <span className="err-actions">
                {lastTask.current && (
                  <button className="chipbtn" onClick={() => { void send(lastTask.current ?? ""); }}>Retry</button>
                )}
                <button className="chipbtn" onClick={() => setErr(null)}>Dismiss</button>
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form className="composer2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={running ? "XR is working… (stop button to abort)" : "Continue the task…"}
            aria-label="Message XR"
            rows={2}
          />
          <div className="cbar">
            <input ref={fileRef} type="file" hidden onChange={(e) => onPickFile(e.target.files?.[0])} />
            <button type="button" className="pill" onClick={() => fileRef.current?.click()} title="Attach a text file (read locally, first 4KB)">
              + Attach{attach ? ` · ${attach}` : ""}
            </button>
            <label className="pill select" title="Autonomy mode">
              Mode
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="Mode">
                <option value="agent">Agent</option>
                <option value="ask">Ask</option>
                <option value="plan">Plan</option>
              </select>
            </label>
            <label className="pill select" title="Model preference — engine may route per policy">
              Model
              <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
                {providers.length === 0 && <option value="">engine default</option>}
                {providers.map((p) =>
                  (p.models?.length ? p.models : [p.id]).map((m) => <option key={`${p.id}/${m}`} value={m}>{p.id} · {m}</option>),
                )}
              </select>
            </label>
            <span className="spacer" />
            {running ? (
              <button type="button" className="send stop" aria-label="Stop XR" onClick={() => abort.current?.abort()}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              </button>
            ) : (
              <button className="send" type="submit" aria-label="Send" disabled={!input.trim() && !attach}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
              </button>
            )}
          </div>
        </form>
      </div>

      <aside className="inspector" aria-label="Run Inspector">
        <div className="insp-head">
          <span className="insp-title">Run Inspector</span>
          {running && <i className="sdot run" title="run in progress" />}
        </div>
        <div className="insp-tabs" role="tablist">
          {(["transcript", "plan", "files", "tools", "approvals", "artifacts", "memory", "cost"] as InspTab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "itab on" : "itab"} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="insp-body mono">
          {tab === "transcript" && (
            evs.length === 0 ? <p className="faint">No events yet this run.</p> :
            evs.map((e, i) => <div key={i} className="ev"><b className="faint">{new Date(e.t).toLocaleTimeString()}</b> <span className="evtype">{e.type}</span> {e.detail}</div>)
          )}
          {tab === "plan" && (
            plan.length === 0 ? <p className="faint">Engine status events will appear here as the run progresses.</p> :
            plan.map((p, i) => <div key={i} className="ev"><b className="faint">{new Date(p.t).toLocaleTimeString()}</b> <span className="evtype">{p.type}</span> {p.detail}</div>)
          )}
          {tab === "files" && (
            tools.filter((t) => FILE_TOOLS.test(t.tool)).length === 0 ? <p className="faint">No file-related tool calls this run.</p> :
            tools.filter((t) => FILE_TOOLS.test(t.tool)).map((t) => (
              <div key={t.id} className="ev">
                <span className="evtype">{t.tool}</span> {args1(t.args)}
                {t.result && <pre className="ev-pre">{t.result.slice(0, 400)}</pre>}
              </div>
            ))
          )}
          {tab === "tools" && (
            tools.length === 0 ? <p className="faint">No tool calls this run.</p> :
            tools.map((t) => (
              <div key={t.id} className="ev">
                <span className={`cdot ${t.done ? (t.ok ? "g" : "r") : "c"}`} aria-hidden="true" />
                <span className="evtype">{t.tool}</span> {args1(t.args)} <b className="faint">{dur(t)}</b>
                {t.error && <pre className="ev-pre err">{String(t.error).slice(0, 300)}</pre>}
              </div>
            ))
          )}
          {tab === "approvals" && (
            decisions.length === 0 ? <p className="faint">No decisions this run yet. Requests appear inline in the transcript.</p> :
            decisions.map((d, i) => (
              <div key={i} className="ev">
                <span className={`cdot ${d.approved ? "g" : "r"}`} aria-hidden="true" />
                <span className="evtype">{d.approved ? "allowed" : "denied"}</span> {d.action || d.id}
                <b className="faint"> {new Date(d.at).toLocaleTimeString()}</b>
              </div>
            ))
          )}
          {tab === "artifacts" && (
            artifacts.length === 0 ? <p className="faint">No files produced this run. Write/edit tool calls land here as they happen.</p> :
            artifacts.map((a, i) => (
              <div key={i} className="ev"><span className="evtype">{a.tool}</span> {a.path}</div>
            ))
          )}
          {tab === "memory" && (
            memory === null ? <p className="faint">loading engine memory…</p> :
            memory.length === 0 ? <p className="faint">Memory is empty. XR stores durable facts here when the engine learns them.</p> :
            memory.map((m) => (
              <div key={m.id} className="ev"><span className="evtype">{m.category ?? "fact"}</span> {String(m.content ?? "").slice(0, 180)}</div>
            ))
          )}
          {tab === "cost" && (
            <div className="costcard">
              <div className="cost-big">{typeof cost?.usd === "number" ? `$${(cost.usd as number).toFixed(4)}` : typeof cost?.totalUsd === "number" ? `$${(cost.totalUsd as number).toFixed(4)}` : "—"}</div>
              <div className="faint">engine-reported spend (budget enforced engine-side)</div>
              {cost && <pre className="ev-pre">{JSON.stringify(cost, null, 1).slice(0, 600)}</pre>}
            </div>
          )}
        </div>
      </aside>

      {dragOver && (
        <div className="dropzone" role="status" aria-live="polite">
          <div className="dropzone-card">
            <b>Drop to attach to your next message</b>
            <span className="faint">text-based files · first 4 KB read locally · other types are rejected</span>
          </div>
        </div>
      )}

      {ctx && <ContextMenu state={ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}
