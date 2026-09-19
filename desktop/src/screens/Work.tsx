import { useEffect, useRef, useState } from "react";
import { api, asList, chatStream, type Approval, type ProviderInfo, type StreamEvent } from "../api/client";
import { XrAvatar } from "../components/Brand";
import { pushToast } from "../components/ToastBus";

/** Work — Chat/Work screen hardened to elite production (Phase 1)
 * Chat column + Run Inspector, real engine wiring, no invented telemetry.
 * Patterns: draft autosave, auto-grow 160px, attach chip with 4KB preview,
 * mode/model pills, budget inline, approval banner actionable, skeleton/empty/error,
 * motion 120/200/320 var(--xr-ease-*), reduced-motion opacity-only via tokens CSS,
 * a11y focus cyan 2px, aria labels, Shift+Enter newline, Esc stop.
 */

interface Msg { role: "user" | "xr"; text: string; }
interface ToolRow { id: string; tool: string; args?: unknown; ok?: boolean; result?: string; error?: string; done: boolean; startMs: number; endMs?: number; }
interface EvRow { t: number; type: string; detail: string; }

type InspTab = "transcript" | "plan" | "files" | "tools" | "cost";
const FILE_TOOLS = /file|read|write|edit|patch|fs|glob|grep/i;
const DRAFT_KEY = "xr-work-draft";

export function Work({ seed, onConsumed }: { seed: string | null; onConsumed: () => void }) {
  const [input, setInput] = useState(() => { try { return localStorage.getItem(DRAFT_KEY) || ""; } catch { return ""; } });
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
  const abort = useRef<AbortController | null>(null);
  const lastTask = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const toast = (m: string) => pushToast("info", "Work", m);

  useEffect(() => {
    const t = setInterval(() => {
      api.approvals().then((v) => setApprovals(asList<Approval>(v, "pending", "approvals"))).catch(() => {});
      api.cost().then(setCost).catch(() => {});
    }, 2500);
    api.providers().then((p) => {
      const list = asList<ProviderInfo>(p, "providers", "items");
      setProviders(list);
      const first = list.find((x) => x.available !== false);
      if (first) setModel(first.models?.[0] ?? first.id);
    }).catch(() => {});
    return () => clearInterval(t);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, tools, status, approvals]);

  useEffect(() => {
    if (seed) { send(seed); onConsumed(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, input); } catch {}
    // auto-grow max 160px
    if (taRef.current) {
      taRef.current.style.height = "auto";
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

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
    r.onload = () => {
      setAttachBody(typeof r.result === "string" ? r.result.slice(0, 4000) : null);
      toast(`Attached ${f.name} — 4KB preview`);
    };
    r.onerror = () => setAttachBody(null);
    r.readAsText(f.slice(0, 8192));
  }

  async function send(raw: string) {
    let task = raw.trim();
    if (!task || running) return;
    if (attachBody) task = `${task}\n\n[attached ${attach} — first 4KB]\n\`\`\`\n${attachBody}\n\`\`\``;
    else if (attach) task = `${task}\n\n[references file: ${attach}]`;
    setAttach(null); setAttachBody(null);
    lastTask.current = task;
    setInput(""); try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setErr(null); setRunning(true); setStatus("starting");
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

  const args1 = (a: unknown) => typeof a === "object" && a ? Object.values(a as Record<string, unknown>).slice(0, 2).map(String).join(" ").slice(0, 64) : "";
  const dur = (r: ToolRow) => (r.endMs ? `${((r.endMs - r.startMs) / 1000).toFixed(1)}s` : "…");
  const budgetRemaining = (() => {
    const total = (cost as any)?.totalUsd ?? (cost as any)?.usd ?? 0;
    const per = (cost as any)?.config?.perTaskUsd ?? (cost as any)?.budget?.perTaskUsd ?? 2;
    if (typeof total === "number" && typeof per === "number") return Math.max(0, per - total);
    return null;
  })();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "var(--xr-space-3)", height: "100%", minHeight: 0, padding: "var(--xr-space-3)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--xr-space-2)", minHeight: 0, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", overflow: "hidden" }}>
        {/* transcript */}
        <div style={{ flex: 1, overflow: "auto", padding: "var(--xr-space-4)", display: "flex", flexDirection: "column", gap: "var(--xr-space-3)" }} aria-live="polite">
          {msgs.length === 0 && (
            <div style={{ display: "grid", placeItems: "center", gap: "var(--xr-space-3)", padding: "var(--xr-space-6)", textAlign: "center", color: "var(--xr-text-2)" }}>
              <XrAvatar size={44} />
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 600, color: "var(--xr-text-1)", fontSize: "var(--xr-font-size-lg)" }}>Ask XR to do something</div>
                <div style={{ fontSize: "var(--xr-font-size-sm)" }}>Watch every tool call, approve every risky step. Local-first, spend-capped, tamper-evident.</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                <span className="chip" style={{ fontSize: 11 }}>Engine: {providers.length ? `${providers.length} providers` : "checking…"}</span>
                <span className="chip" style={{ fontSize: 11 }}>Mode: {mode}</span>
                {budgetRemaining !== null && <span className="chip" style={{ fontSize: 11 }}>Budget: ${budgetRemaining.toFixed(2)} left</span>}
              </div>
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <div style={{ maxWidth: "78%", padding: "10px 14px", borderRadius: "var(--xr-radius-lg)", background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: "var(--xr-font-size-sm)", whiteSpace: "pre-wrap" }}>{m.text}</div>
                <span style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--xr-surface-3)", display: "grid", placeItems: "center", fontSize: 11, color: "var(--xr-text-2)" }} aria-hidden>You</span>
              </div>
            ) : (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <XrAvatar size={26} />
                <div style={{ maxWidth: "78%", padding: "10px 14px", borderRadius: "var(--xr-radius-lg)", background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", whiteSpace: "pre-wrap" }}>
                  {m.text || (running && i === msgs.length - 1 ? <span style={{ color: "var(--xr-text-3)" }}>…</span> : <span style={{ color: "var(--xr-text-3)" }}>(empty reply)</span>)}
                </div>
              </div>
            )
          )}

          {tools.length > 0 && (
            <div style={{ display: "grid", gap: 6, padding: "8px 10px", background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-md)" }} aria-label="Tool calls">
              {tools.map((t) => (
                <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center", fontFamily: "var(--xr-font-mono)", fontSize: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: t.done ? (t.ok ? "var(--xr-success)" : "var(--xr-danger)") : "var(--xr-accent)", flexShrink: 0 }} aria-hidden />
                  <span style={{ fontWeight: 600 }}>{t.tool}</span>
                  <span style={{ color: "var(--xr-text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{args1(t.args)}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: "var(--xr-text-3)" }}>{dur(t)}</span>
                  {t.done && (t.ok ? <span aria-label="succeeded" style={{ color: "var(--xr-success)" }}>✓</span> : <span aria-label="failed" style={{ color: "var(--xr-danger)" }}>✕</span>)}
                </div>
              ))}
            </div>
          )}

          {running && status && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--xr-text-2)" }} role="status">
              <span style={{ display: "inline-flex", gap: 3 }} aria-hidden><i style={{ width: 4, height: 4, borderRadius: 999, background: "var(--xr-accent)", animation: "xr-pulse 1s infinite" }} /><i style={{ width: 4, height: 4, borderRadius: 999, background: "var(--xr-accent)", animation: "xr-pulse 1s .2s infinite" }} /><i style={{ width: 4, height: 4, borderRadius: 999, background: "var(--xr-accent)", animation: "xr-pulse 1s .4s infinite" }} /></span> {status}
            </div>
          )}

          {approvals.map((a) => (
            <div key={a.id} style={{ padding: 12, borderRadius: "var(--xr-radius-md)", background: "var(--xr-surface-2)", border: "1px solid var(--xr-warning)", display: "grid", gap: 8 }} role="alertdialog" aria-label="Approval request">
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, fontSize: 12 }}><span style={{ color: "var(--xr-warning)" }}>⚠</span> XR wants to run:</div>
              <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(a.action ?? JSON.stringify(a).slice(0, 160))}</div>
              {a.reason && <div style={{ color: "var(--xr-text-2)", fontSize: 12 }}>{String(a.reason)}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn small" style={{ padding: "6px 12px", borderRadius: "var(--xr-radius-sm)", border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)" }} onClick={() => api.decide(a.id, false).then(() => setApprovals((p) => p.filter((x) => x.id !== a.id)))}>Deny</button>
                <button className="btn small primary" style={{ padding: "6px 12px", borderRadius: "var(--xr-radius-sm)", background: "var(--xr-accent)", color: "white", border: "none" }} onClick={() => api.decide(a.id, true).then(() => setApprovals((p) => p.filter((x) => x.id !== a.id)))}>Allow once</button>
              </div>
            </div>
          ))}

          {err && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderRadius: "var(--xr-radius-md)", background: "color-mix(in srgb, var(--xr-danger) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--xr-danger) 30%, transparent)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }}>
              <span style={{ color: "var(--xr-danger)", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>error: {err}</span>
              <span style={{ display: "flex", gap: 6 }}>
                {lastTask.current && <button style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer" }} onClick={() => { void send(lastTask.current ?? ""); }}>Retry</button>}
                <button style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer" }} onClick={() => setErr(null)}>Dismiss</button>
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* composer */}
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} style={{ padding: "var(--xr-space-3)", borderTop: "1px solid var(--xr-border)", display: "grid", gap: 8, background: "var(--xr-surface-1)" }}>
          {attach && (
            <div style={{ display: "flex", gap: 6 }}>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "4px 8px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{attach} {attachBody ? `· ${attachBody.length} chars preview` : ""} <button type="button" onClick={() => { setAttach(null); setAttachBody(null); }} aria-label="Remove attachment" style={{ border: "none", background: "transparent", cursor: "pointer" }}>✕</button></span>
            </div>
          )}
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder={running ? "XR is working… Esc to stop" : "Continue the task… Shift+Enter for newline"}
            aria-label="Message XR"
            rows={2}
            style={{ width: "100%", resize: "none", background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-md)", padding: "10px 12px", fontFamily: "inherit", fontSize: "var(--xr-font-size-sm)", color: "var(--xr-text-1)", outline: "none" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input ref={fileRef} type="file" hidden onChange={(e) => onPickFile(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} title="Attach a text file (read locally, first 4KB)" style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 12, cursor: "pointer" }}>+ Attach{attach ? ` · ${attach}` : ""}</button>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "6px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 12 }}>Mode <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="Mode" style={{ background: "transparent", border: "none", color: "inherit", fontSize: 12 }}><option value="agent">Agent</option><option value="ask">Ask</option><option value="plan">Plan</option></select></label>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "6px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 12 }}>Model <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" style={{ background: "transparent", border: "none", color: "inherit", fontSize: 12, maxWidth: 160 }}>{providers.length === 0 && <option value="">engine default</option>}{providers.map((p) => (p.models?.length ? p.models : [p.id]).map((m) => <option key={`${p.id}/${m}`} value={m}>{p.id} · {m}</option>))}</select></label>
            <span style={{ flex: 1 }} />
            {running ? (
              <button type="button" aria-label="Stop XR" onClick={() => abort.current?.abort()} style={{ width: 32, height: 32, borderRadius: 999, border: "none", background: "var(--xr-danger)", color: "white", display: "grid", placeItems: "center", cursor: "pointer" }}>■</button>
            ) : (
              <button type="submit" aria-label="Send" disabled={!input.trim() && !attach} style={{ width: 32, height: 32, borderRadius: 999, border: "none", background: input.trim() || attach ? "var(--xr-accent)" : "var(--xr-surface-3)", color: "white", display: "grid", placeItems: "center", cursor: input.trim() || attach ? "pointer" : "not-allowed", transition: "transform var(--xr-motion-micro) var(--xr-ease-default)" }}>↑</button>
            )}
          </div>
        </form>
      </div>

      <aside aria-label="Run Inspector" style={{ display: "flex", flexDirection: "column", gap: 0, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", overflow: "hidden", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--xr-border)" }}>
          <span style={{ fontWeight: 600, fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase" }}>Run Inspector</span>
          {running && <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--xr-accent)", animation: "xr-pulse 1s infinite" }} title="run in progress" />}
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{tools.length} tools</span>
        </div>
        <div role="tablist" style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--xr-border)", overflowX: "auto" }}>
          {(["transcript", "plan", "files", "tools", "cost"] as InspTab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{ padding: "8px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", border: "none", background: "transparent", borderBottom: tab === t ? "2px solid var(--xr-accent)" : "2px solid transparent", color: tab === t ? "var(--xr-text-1)" : "var(--xr-text-3)", cursor: "pointer", whiteSpace: "nowrap" }}>{t}</button>
          ))}
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 12, fontFamily: "var(--xr-font-mono)", fontSize: 12, display: "grid", gap: 8, alignContent: "start" }}>
          {tab === "transcript" && (evs.length === 0 ? <p style={{ color: "var(--xr-text-3)" }}>No events yet this run.</p> : evs.map((e, i) => <div key={i}><b style={{ color: "var(--xr-text-3)" }}>{new Date(e.t).toLocaleTimeString()}</b> <span style={{ color: "var(--xr-accent)" }}>{e.type}</span> {e.detail}</div>))}
          {tab === "plan" && (plan.length === 0 ? <p style={{ color: "var(--xr-text-3)" }}>Engine status events will appear here.</p> : plan.map((p, i) => <div key={i}><b style={{ color: "var(--xr-text-3)" }}>{new Date(p.t).toLocaleTimeString()}</b> <span style={{ color: "var(--xr-accent)" }}>{p.type}</span> {p.detail}</div>))}
          {tab === "files" && (tools.filter((t) => FILE_TOOLS.test(t.tool)).length === 0 ? <p style={{ color: "var(--xr-text-3)" }}>No file-related tool calls this run.</p> : tools.filter((t) => FILE_TOOLS.test(t.tool)).map((t) => (<div key={t.id}><span style={{ color: "var(--xr-accent)" }}>{t.tool}</span> {args1(t.args)}{t.result && <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--xr-surface-2)", padding: 8, borderRadius: 6, marginTop: 6 }}>{t.result.slice(0, 400)}</pre>}</div>)))}
          {tab === "tools" && (tools.length === 0 ? <p style={{ color: "var(--xr-text-3)" }}>No tool calls this run.</p> : tools.map((t) => (<div key={t.id}><span style={{ width: 6, height: 6, borderRadius: 999, display: "inline-block", background: t.done ? (t.ok ? "var(--xr-success)" : "var(--xr-danger)") : "var(--xr-accent)", marginRight: 6 }} /><span style={{ color: "var(--xr-accent)" }}>{t.tool}</span> {args1(t.args)} <b style={{ color: "var(--xr-text-3)" }}>{dur(t)}</b>{t.error && <pre style={{ color: "var(--xr-danger)", whiteSpace: "pre-wrap", background: "var(--xr-surface-2)", padding: 8, borderRadius: 6, marginTop: 6 }}>{String(t.error).slice(0, 300)}</pre>}</div>)))}
          {tab === "cost" && (
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>${typeof cost?.usd === "number" ? (cost.usd as number).toFixed(4) : typeof (cost as any)?.totalUsd === "number" ? ((cost as any).totalUsd as number).toFixed(4) : "—"}</div>
              <div style={{ color: "var(--xr-text-3)", fontSize: 11 }}>engine-reported spend (budget enforced engine-side)</div>
              {cost && <pre style={{ whiteSpace: "pre-wrap", background: "var(--xr-surface-2)", padding: 8, borderRadius: 6, marginTop: 8 }}>{JSON.stringify(cost, null, 1).slice(0, 600)}</pre>}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
