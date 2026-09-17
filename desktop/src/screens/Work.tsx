import { useEffect, useRef, useState } from "react";
import { api, asList, chatStream, type Approval, type MemoryEntry, type StreamEvent } from "../api/client";
import { XrAvatar } from "../components/Brand";

interface Msg { role: "user" | "xr"; text: string; }
interface ToolRow { id: string; tool: string; args?: unknown; ok?: boolean; result?: string; error?: string; done: boolean; }

export function Work({ seed, onConsumed }: { seed: string | null; onConsumed: () => void }) {
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [cost, setCost] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => {
      api.approvals().then((v) => setApprovals(asList<Approval>(v, "pending", "approvals"))).catch(() => {});
      api.cost().then(setCost).catch(() => {});
    }, 2500);
    api.memory().then((v) => setMemory(asList<MemoryEntry>(v, "entries", "memories").slice(0, 4))).catch(() => {});
    return () => clearInterval(t);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, tools, status]);

  useEffect(() => {
    if (seed) { send(seed); onConsumed(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  async function send(text: string) {
    const task = text.trim();
    if (!task || running) return;
    setInput(""); setErr(null); setRunning(true); setStatus("starting");
    setMsgs((m) => [...m, { role: "user", text: task }, { role: "xr", text: "" }]);
    setTools([]);
    const ac = new AbortController();
    abort.current = ac;
    try {
      await chatStream({ message: task, mode: "agent" }, (e: StreamEvent) => {
        switch (e.type) {
          case "token":
            setMsgs((m) => { const c = [...m]; const last = c[c.length - 1]; c[c.length - 1] = { ...last, text: last.text + (e.text ?? "") }; return c; });
            break;
          case "tool_call": {
            const tc = e as unknown as { id: string; tool: string; args?: unknown };
            setTools((t) => [...t, { id: tc.id, tool: tc.tool, args: tc.args, done: false }]);
            setStatus(`using ${tc.tool}`);
            break;
          }
          case "tool_result": {
            const tr = e as unknown as { id: string; ok?: boolean; result?: string; error?: string };
            setTools((t) => t.map((r) => (r.id === tr.id ? { ...r, ok: tr.ok, result: tr.result, error: tr.error, done: true } : r)));
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
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setRunning(false);
      setStatus(null);
      api.cost().then(setCost).catch(() => {});
    }
  }

  return (
    <div className="work">
      <div className="work-main">
        <div className="transcript" aria-live="polite">
          {msgs.length === 0 && (
            <div className="empty">
              <XrAvatar size={44} />
              <p>Ask XR to do something. Watch every tool call, approve every risky step.</p>
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="msg user mono">{m.text}</div>
            ) : (
              <div key={i} className="msg xr">
                <XrAvatar size={24} />
                <div className="bubble">{m.text || (running && i === msgs.length - 1 ? <span className="faint">…</span> : "")}</div>
              </div>
            ),
          )}

          {tools.length > 0 && (
            <div className="timeline" aria-label="Tool timeline">
              {tools.map((t) => (
                <div key={t.id} className="trow">
                  <span className={`dot ${t.done ? (t.ok ? "green" : "red") : "cyan"}`} />
                  <span className="mono">{t.tool}</span>
                  <span className="faint mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {typeof t.args === "object" && t.args ? Object.values(t.args as Record<string, unknown>).slice(0, 2).join(" ").slice(0, 60) : ""}
                  </span>
                  {!t.done && <span className="faint">running…</span>}
                </div>
              ))}
            </div>
          )}

          {approvals.map((a) => (
            <div key={a.id} className="approval-inline" role="alertdialog" aria-label="Approval request">
              <div className="t">XR needs your approval</div>
              <div className="mono" style={{ fontSize: 12 }}>{String(a.action ?? JSON.stringify(a).slice(0, 140))}</div>
              {a.reason && <div className="faint" style={{ fontSize: 12 }}>{String(a.reason)}</div>}
              <div className="row">
                <button className="btn danger" onClick={() => api.decide(a.id, false).then(() => setApprovals((p) => p.filter((x) => x.id !== a.id)))}>Deny</button>
                <button className="btn primary" onClick={() => api.decide(a.id, true).then(() => setApprovals((p) => p.filter((x) => x.id !== a.id)))}>Allow once</button>
              </div>
            </div>
          ))}

          {err && <div className="errline mono">error: {err}</div>}
          <div ref={endRef} />
        </div>

        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={running ? "XR is working… (⌘. to stop)" : "Continue the task…"}
            aria-label="Message XR"
          />
          <div className="row">
            <span className="pill" title="Autonomy mode (named modes land Phase 4)">◈ Balanced</span>
            <span className="pill mono" title="Model Center lives in Library → Models">⚙ engine default</span>
            {running ? (
              <button type="button" className="send stop" aria-label="Stop XR" onClick={() => abort.current?.abort()}>■</button>
            ) : (
              <button className="send" type="submit" aria-label="Send">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 20v-6l8-2-8-2V4l19 8z" /></svg>
              </button>
            )}
          </div>
        </form>
        <div className="statusline mono faint">{status ?? ""}</div>
      </div>

      <aside className="work-rail">
        <div className="rail-card">
          <div className="rail-h">Spend</div>
          <div className="mono" style={{ fontSize: 13 }}>
            {typeof cost?.usd === "number" ? `$${(cost.usd as number).toFixed(4)}` : typeof cost?.totalUsd === "number" ? `$${(cost.totalUsd as number).toFixed(4)}` : "$0.0000"}
          </div>
          <div className="faint" style={{ fontSize: 11 }}>budget enforced engine-side</div>
        </div>
        <div className="rail-card">
          <div className="rail-h">Memory peek</div>
          {memory.length === 0 && <div className="faint" style={{ fontSize: 12 }}>nothing stored yet</div>}
          {memory.map((m) => (
            <div key={m.id} className="mem" title={m.scope ?? m.category}>
              · {String(m.text ?? m.content ?? m.id).slice(0, 90)}
            </div>
          ))}
        </div>
        <div className="rail-card">
          <div className="rail-h">Approvals</div>
          <div className="faint" style={{ fontSize: 12 }}>{approvals.length} pending</div>
        </div>
      </aside>
    </div>
  );
}
