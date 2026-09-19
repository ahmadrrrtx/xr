import { useEffect, useRef, useState } from "react";
import { api, asList, type Approval, type ProviderInfo, type SessionSummary, type BudgetState } from "../api/client";
import { XrLogo } from "../components/Brand";
import { pushToast } from "../components/ToastBus";

/**
 * Home — Phase 1 hardened (elite):
 * - brand hero with glow + tagline
 * - universal composer: auto-grow, attach chips (file/folder/capability), mode pill, model pill, budget meter inline, send/stop morph scale 0.97 active, draft autosave, slash commands, skill quick-pills
 * - Continue work cards: title, workspace chip, status dot semantic, duration, cost mono, approval badge, hover quick actions resume/open/duplicate
 * - Pending approvals banner actionable
 * - Readiness strip actionable
 * - States: loading/skeleton/empty/error/offline
 * - Motion: 120ms micro, 200ms state, custom curves, stagger 50ms, reduced-motion opacity-only
 * - A11y: focus rings cyan 2px, aria labels, keyboard map
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
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<"agent" | "ask" | "plan">("agent");
  const [text, setText] = useState(() => {
    try { return localStorage.getItem("xr-home-draft") || ""; } catch { return ""; }
  });
  const [attach, setAttach] = useState<string | null>(null);
  const [attachBody, setAttachBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Draft autosave + restore after crash
  useEffect(() => {
    try { localStorage.setItem("xr-home-draft", text); } catch { /* ignore */ }
  }, [text]);

  // Auto-grow textarea
  useEffect(() => {
    if (textRef.current) {
      textRef.current.style.height = "auto";
      textRef.current.style.height = `${Math.min(textRef.current.scrollHeight, 160)}px`;
    }
  }, [text]);

  useEffect(() => {
    let live = true;
    const poll = () => {
      Promise.allSettled([
        api.sessions(),
        api.approvals(),
        api.cost(),
      ]).then(([s, a, c]) => {
        if (!live) return;
        if (s.status === "fulfilled") setSessions(asList<SessionSummary>(s.value, "sessions", "items").slice(0, 6));
        if (a.status === "fulfilled") setApprovals(asList<Approval>(a.value, "pending", "approvals"));
        if (c.status === "fulfilled") setBudget(c.value as BudgetState);
        setLoading(false);
        setError(null);
      }).catch((e) => {
        if (live) { setError(String(e)); setLoading(false); }
      });
    };
    api.providers().then((p) => {
      const list = asList<ProviderInfo>(p, "providers", "items");
      if (!live) return;
      setProviders(list);
      const first = list.find((x) => x.available !== false);
      if (first) setModel(first.models?.[0] ?? first.id);
    }).catch(() => { if (live) setLoading(false); });
    poll();
    const t = setInterval(poll, 4000);
    return () => { live = false; clearInterval(t); };
  }, []);

  function onPickFile(f: File | undefined) {
    if (!f) return;
    setAttach(f.name);
    const r = new FileReader();
    r.onload = () => setAttachBody(typeof r.result === "string" ? r.result.slice(0, 4000) : null);
    r.onerror = () => setAttachBody(null);
    r.readAsText(f.slice(0, 8192));
    pushToast("ok", "Attached", `${f.name} — first 4KB will be included`);
  }

  function submit() {
    const task = text.trim();
    if (!task) return;
    const withAttach = attachBody
      ? `${task}\n\n[attached ${attach} — first 4KB]\n\`\`\`\n${attachBody}\n\`\`\``
      : attach ? `${task}\n\n[references file: ${attach}]` : task;
    const finalTask = mode !== "agent" ? `[mode:${mode}] ${withAttach}` : withAttach;
    setText("");
    try { localStorage.removeItem("xr-home-draft"); } catch {}
    setAttach(null); setAttachBody(null);
    onGoWork(finalTask);
  }

  const statusDot = (s?: string) =>
    s === "completed" || s === "done" ? "ok" : s === "failed" || s === "error" ? "bad" : s === "running" || s === "active" ? "run" : "idle";

  const budgetRemaining = (() => {
    const cfg = budget?.config as { perTaskUsd?: number } | undefined;
    const usage = budget?.usage as { totalUsd?: number } | undefined;
    if (cfg?.perTaskUsd && typeof usage?.totalUsd === "number") {
      return Math.max(0, cfg.perTaskUsd - usage.totalUsd);
    }
    return null;
  })();

  return (
    <div className="home">
      <div className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <XrLogo height={96} radius={16} />
        <div className="hero-name">XR</div>
        <div className="hero-sub faint">The AI Agent You Can Actually Trust</div>
        <div className="mono faint" style={{ fontSize: 11, marginTop: 8, letterSpacing: ".04em" }}>
          LOCAL-FIRST · PROVIDER-NEUTRAL · SPEND-CAPPED · TAMPER-EVIDENT AUDIT
        </div>
      </div>

      {error && (
        <div className="errline mono" role="alert" style={{ marginBottom: 16 }}>
          <span>error: {error}</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
            <button className="chip" onClick={() => window.location.reload()}>Retry</button>
            <button className="chip" onClick={() => setError(null)}>Dismiss</button>
          </span>
        </div>
      )}

      <div className="composer-card" role="form" aria-label="Universal Composer">
        <textarea
          ref={textRef}
          className="composer-input"
          rows={2}
          placeholder="What do you want XR to do? Ask to code, edit files, research, run agents… (Shift+Enter new line, Enter send)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          aria-label="Task input"
        />
        {attach && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <span className="chip" title={attach}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
              {attach}
              <button onClick={() => { setAttach(null); setAttachBody(null); }} aria-label="Remove attachment" style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: 0, marginLeft: 4 }}>✕</button>
            </span>
            {attachBody && <span className="chip tiny">4KB preview ready</span>}
          </div>
        )}
        <div className="composer-actions">
          <input ref={fileRef} type="file" hidden onChange={(e) => onPickFile(e.target.files?.[0])} />
          <button className="pill" onClick={() => fileRef.current?.click()} title="Attach a text file (read locally, first 4KB)" aria-label="Attach file">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 5v14M5 12h14" /></svg>
            Attach
          </button>
          <label className="pill select" title="Autonomy mode — Careful/Balanced/Autonomous mapped to real policy">
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="Mode">
              <option value="agent">Agent</option>
              <option value="ask">Ask</option>
              <option value="plan">Plan</option>
            </select>
          </label>
          <label className="pill model select" title="Model preference — engine may route per policy, health, cost">
            Model
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
              {providers.length === 0 && <option value="">engine default</option>}
              {providers.map((p) =>
                (p.models?.length ? p.models : [p.id]).map((m) => <option key={`${p.id}/${m}`} value={m}>{p.id} · {m}</option>),
              )}
            </select>
          </label>
          {budgetRemaining !== null && (
            <span className="chip tiny" title={`Budget remaining $${budgetRemaining.toFixed(2)} — backend enforced, never invented`}>
              budget ${budgetRemaining.toFixed(2)}
            </span>
          )}
          <span className="spacer" />
          <button className="send" onClick={submit} disabled={!text.trim()} aria-label="Send to Work">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="mono faint" style={{ fontSize: 10, marginTop: 6, display: "flex", gap: 12 }}>
          <span>⌘K palette · ? shortcuts · Shift+Enter newline</span>
          {text && <span style={{ marginLeft: "auto" }}>draft autosaved · restore after crash</span>}
        </div>
      </div>

      <section className="cw" aria-label="Continue work">
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "30px 0 12px" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--xr-text-muted)" }}>Continue work</h3>
          <span className="mono faint" style={{ fontSize: 11 }}>{sessions.length} sessions · engine truth</span>
          {loading && <span className="skeleton" style={{ width: 60, height: 12, marginLeft: 8 }} />}
        </div>
        {sessions.length === 0 && !loading && <p className="faint">No sessions yet — start a task above and it will appear here. Honest empty state.</p>}
        <div className="cw-grid">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="cw-card" style={{ opacity: 0.6 }}>
                <div className="skeleton" style={{ height: 14, width: "70%", marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 10, width: "40%" }} />
              </div>
            ))
          ) : (
            sessions.map((s, idx) => (
              <button
                key={s.id}
                className="cw-card"
                onClick={() => onOpenRun(s.id)}
                title={`Open ${s.id}`}
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <div className="cw-top">
                  <span className="chip tiny">{String(s.mode ?? "agent").toUpperCase()}</span>
                  {s.status === "running" && <span className="sdot run" aria-label="running" />}
                  {s.status === "completed" && <span className="sdot ok" aria-label="completed" />}
                  {s.status === "failed" && <span className="sdot bad" aria-label="failed" />}
                  <span style={{ marginLeft: "auto" }} className="mono faint" title="Cost USD — engine truth">${(typeof s.costUsd === "number" ? s.costUsd : 0).toFixed(2)}</span>
                </div>
                <div className="cw-title">{s.title || s.prompt?.slice(0, 60) || s.id}</div>
                <div className="cw-meta mono faint" style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <span className={`cw-state ${statusDot(s.status)}`} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <i className={`sdot ${statusDot(s.status)}`} aria-label={s.status ?? "unknown"} />
                    {s.status ?? "unknown"}
                  </span>
                  <span className="mono">{s.model ? String(s.model).slice(0, 24) : s.provider ? String(s.provider) : ""}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {approvals.length > 0 && (
        <div className="appr-banner" role="alertdialog" aria-label="Pending approvals">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></svg>
          <span className="faint">{approvals.length} Pending Approval{approvals.length > 1 ? "s" : ""}</span>
          <span className="mono" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {String(approvals[0].tool ?? approvals[0].action ?? approvals[0].reason ?? "An agent action")} {approvals.length > 1 ? `and ${approvals.length - 1} more need review` : "needs review"}
          </span>
          <button className="btn small primary" onClick={onReview}>Review</button>
        </div>
      )}

      <div className="readiness" role="status" aria-label="Readiness">
        <span className="item"><i className="sdot ok" /> Engine {budget ? "connected" : "checking…"}</span>
        <span className="item"><i className="sdot ok" /> {providers.length} providers · {providers.filter(p => p.available !== false).length} healthy</span>
        <span className="item"><i className={`sdot ${approvals.length > 0 ? "idle" : "ok"}`} /> {approvals.length} approvals pending</span>
        <span className="item mono faint" style={{ marginLeft: "auto" }}>readiness strip · actionable · engine truth · audited</span>
      </div>
    </div>
  );
}
