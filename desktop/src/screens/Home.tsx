import { useEffect, useRef, useState } from "react";
import { asList, type Approval, type ProviderInfo, type SessionSummary } from "../api/client";
import { XrLogo } from "../components/Brand";
import { poll } from "../poll";

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
    /* Phase 1 · subscribers of the shared poll hub (src/poll.ts). Home used to
     * fetch sessions and approvals on its own 4 s timer while the toast bus
     * fetched the same two on a 3 s timer — two unsynchronised views of the
     * same run list. The model default is still seeded exactly once. */
    let seededModel = false;
    const off = poll.subscribe(["sessions", "approvals", "providers"], (o) => {
      if (o.key === "sessions") {
        if (o.ok) setSessions(asList<SessionSummary>(o.value, "sessions", "items").slice(0, 4));
        return;
      }
      if (o.key === "approvals") {
        if (o.ok) setApprovals(asList<Approval>(o.value, "pending", "approvals"));
        return;
      }
      if (!o.ok || seededModel) return;
      const list = asList<ProviderInfo>(o.value, "providers", "items");
      setProviders(list);
      const first = list.find((x) => x.available !== false);
      if (first) {
        seededModel = true;
        setModel(first.models?.[0] ?? first.id);
      }
    });
    return off;
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
      <div className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <XrLogo height={112} radius={20} />
        <div className="hero-sub faint">The AI Agent You Can Actually Trust</div>
      </div>

      <div className="composer-card">
        <textarea
          className="composer-input"
          rows={2}
          placeholder="What do you want XR to do?"
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
            <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3.4 11.2 20.6 3.3c.6-.3 1.2.3.9.9l-7.9 17.2c-.3.7-1.3.6-1.5-.1l-1.9-6.6a.8.8 0 0 0-.55-.55l-6.6-1.9c-.7-.2-.8-1.2-.1-1.5z" />
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
              <div className="cw-title">{s.title || s.prompt?.slice(0, 60) || s.id}</div>
              <div className="cw-top">
                <span className="chip cw-cat">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <path d="M4 8h16v12H4zM9 8V5h6v3" />
                  </svg>
                  {String(s.mode ?? "agent").toUpperCase()}
                </span>
              </div>
              <div className="cw-foot">
                <span className={`cw-state ${statusDot(s.status)}`}>
                  <i className={`sdot ${statusDot(s.status)}`} aria-label={s.status ?? "unknown"} />
                  {statusDot(s.status) === "ok" ? "Green" : statusDot(s.status) === "bad" ? "Red" : statusDot(s.status) === "run" ? "Yellow" : "Idle"}
                </span>
                <span className="cw-cost mono">{`$${(typeof s.costUsd === "number" ? s.costUsd : 0).toFixed(2)}`}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {approvals.length > 0 && (
        <div className="appr-banner" role="status">
          <span className="ab-pill">{approvals.length} Pending Approval{approvals.length > 1 ? "s" : ""}</span>
          <div className="ab-line">
            {String(approvals[0].tool ?? approvals[0].action ?? approvals[0].reason ?? "An agent action")}
            {" "}and {approvals.length > 1 ? `${approvals.length - 1} more` : "the latest"} request{approvals.length > 1 ? "s" : ""} need review
          </div>
          <button className="btn small" onClick={onReview}>Review</button>
        </div>
      )}
    </div>
  );
}
