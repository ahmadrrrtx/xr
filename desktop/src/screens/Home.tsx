import { useEffect, useRef, useState } from "react";
import { api, asList, type Approval, type ProviderInfo, type SessionSummary } from "../api/client";
import { XrLogo } from "../components/Brand";

/**
 * Home (phase 6, mock 02): brand hero, universal composer, "Continue work" cards
 * from real sessions (cost/status engine-owned), pending-approvals banner.
 */
export function Home({
  onOpenRun,
  onGoWork,
  onReview,
}: {
  onOpenRun: (id: string) => void;
  onGoWork: (task: string) => void;
  onReview: () => void;
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [model, setModel] = useState("");
  const [text, setText] = useState("");
  const [attach, setAttach] = useState<string | null>(null);
  const [attachBody, setAttachBody] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const poll = () => {
      api.sessions().then((s) => setSessions(asList<SessionSummary>(s, "sessions", "items").slice(0, 4))).catch(() => {});
      api.approvals().then((v) => setApprovals(asList<Approval>(v, "pending", "approvals"))).catch(() => {});
    };
    api.providers().then((p) => {
      const list = asList<ProviderInfo>(p, "providers", "items");
      setProviders(list);
      const first = list.find((x) => x.available !== false);
      if (first) setModel(first.models?.[0] ?? first.id);
    }).catch(() => {});
    poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, []);

  function onPickFile(f: File | undefined) {
    if (!f) return;
    setAttach(f.name);
    const r = new FileReader();
    r.onload = () => setAttachBody(typeof r.result === "string" ? r.result.slice(0, 4000) : null);
    r.onerror = () => setAttachBody(null);
    r.readAsText(f.slice(0, 8192));
  }

  function submit() {
    const task = text.trim();
    if (!task) return;
    const withAttach = attachBody
      ? `${task}\n\n[attached ${attach} — first 4KB]\n\`\`\`\n${attachBody}\n\`\`\``
      : attach ? `${task}\n\n[references file: ${attach}]` : task;
    setText(""); setAttach(null); setAttachBody(null);
    onGoWork(withAttach);
  }

  const statusDot = (s?: string) =>
    s === "completed" || s === "done" ? "ok" : s === "failed" || s === "error" ? "bad" : s === "running" || s === "active" ? "run" : "idle";

  return (
    <div className="home">
      {approvals.length > 0 && (
        <div className="appr-banner" role="status">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" />
          </svg>
          <span>
            <b>{approvals.length} pending approval{approvals.length > 1 ? "s" : ""}</b>
            <span className="faint"> — {approvals[0].action ?? approvals[0].reason ?? "action"} awaiting your decision</span>
          </span>
          <button className="btn small" onClick={onReview}>Review</button>
        </div>
      )}

      <div className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <XrLogo height={72} radius={14} />
        <div className="hero-name">XR Desktop</div>
        <div className="hero-sub faint">Your AI operating system — agents, skills, and workflows in one workspace.</div>
      </div>

      <div className="composer-card">
        <textarea
          className="composer-input"
          rows={2}
          placeholder="Ask XR anything…  (Shift+Enter for newline)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <div className="composer-actions">
          <input ref={fileRef} type="file" hidden onChange={(e) => onPickFile(e.target.files?.[0])} />
          <button className="pill" onClick={() => fileRef.current?.click()} title="Attach a text file (read locally)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Attach{attach ? ` · ${attach}` : ""}
          </button>
          <label className="pill model" title="Model (engine providers)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h6v6H9z" />
            </svg>
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
              {providers.length === 0 && <option value="">no providers</option>}
              {providers.map((p) =>
                (p.models?.length ? p.models : [p.id]).map((m) => <option key={`${p.id}/${m}`} value={m}>{p.id} · {m}</option>),
              )}
            </select>
          </label>
          <span className="spacer" />
          <button className="send" onClick={submit} disabled={!text.trim()} aria-label="Send to Work">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 12h13M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <section className="cw" aria-label="Continue work">
        <h3>Continue work</h3>
        {sessions.length === 0 && <p className="faint">No sessions yet — start a task above and it will appear here.</p>}
        <div className="cw-grid">
          {sessions.map((s) => (
            <button key={s.id} className="cw-card" onClick={() => onOpenRun(s.id)} title={`Open ${s.id}`}>
              <div className="cw-top">
                <span className="chip">{s.mode ?? "agent"}</span>
                <i className={`sdot ${statusDot(s.status)}`} aria-label={s.status ?? "unknown"} title={s.status ?? "unknown"} />
              </div>
              <div className="cw-title">{s.title || s.prompt?.slice(0, 60) || s.id}</div>
              <div className="cw-meta faint mono">
                {s.provider ?? "—"} · {typeof s.costUsd === "number" ? `$${s.costUsd.toFixed(4)}` : "no cost data"}
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
