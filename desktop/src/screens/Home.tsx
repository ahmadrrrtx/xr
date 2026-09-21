import { useCallback, useState } from "react";
import { Icon } from "../components/icons";
import { StatusDot } from "../components/StatusDot";

export function Home({
  onOpenRun, onGoWork, onReview, approvalCount = 2,
}: {
  onOpenRun: (id: string) => void;
  onGoWork: (seed?: string) => void;
  onReview: () => void;
  approvalCount?: number;
}) {
  const [composer, setComposer] = useState("");
  const send = useCallback(() => {
    const seed = composer.trim();
    if (!seed) return;
    onGoWork(seed);
  }, [composer, onGoWork]);
  const hour = new Date().getHours();
  const greet = hour < 5 ? "Late night." : hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";

  return (
    <div className="xr-home">
      <div className="xr-home-inner">
        {/* Hero */}
        <div className="hero full-width">
          <img src="/src/assets/xr-logo.png" alt="XR" style={{ width: 48, height: 48, objectFit: "contain", filter: "drop-shadow(0 0 14px rgba(0,212,255,0.45))" }}/>
          <div>
            <h2 className="greet">{greet}
              <span className="sub">You're working on <b style={{ color: "var(--xr-text)" }}>xr</b>. XR is ready.</span>
            </h2>
          </div>
          <div className="cta">
            <button className="xr-btn xr-btn--primary" onClick={() => onGoWork()}>
              <Icon.Code width={14} height={14}/> Open Workbench
            </button>
          </div>
        </div>

        {/* Approval callout */}
        {approvalCount > 0 && (
          <div className="card approval-callout full-width">
            <Icon.AlertTriangle width={22} height={22}/>
            <div>
              <h3>{approvalCount} approval{approvalCount > 1 ? "s" : ""} waiting</h3>
              <p>XR needs your decision before continuing.</p>
            </div>
            <div className="actions">
              <button className="xr-btn xr-btn--sm xr-btn--secondary">Review</button>
              <button className="xr-btn xr-btn--sm" style={{ background: "var(--xr-warning)", color: "#0A0A0F" }}>Approve all</button>
            </div>
          </div>
        )}

        {/* Continue Working */}
        <div className="card">
          <h3>
            <Icon.Clock width={14} height={14} style={{ color: "var(--xr-primary)" }}/>
            Continue working
            <span className="count">4 recent</span>
          </h3>
          <div className="continue-list">
            {[
              { title: "Refactor retry loop in agent.ts", time: "2 min ago", kind: "ok", proj: "xr" },
              { title: "Summarize docs folder", time: "1 hour ago", kind: "ok", proj: "xr" },
              { title: "Fix the Ollama connection handler", time: "4 hours ago", kind: "err", proj: "xr" },
              { title: "Research competitor pricing pages", time: "Yesterday", kind: "working", proj: "xr" },
            ].map((r, i) => (
              <div key={i} className="continue-item" onClick={() => onOpenRun(String(i))}>
                <StatusDot kind={r.kind as "ok" | "err" | "working"} size={8}/>
                <span className="ctitle">{r.title}</span>
                <span className="ctime">{r.time}</span>
                <Icon.ChevronRight width={12} height={12} className="xr-muted"/>
              </div>
            ))}
          </div>
        </div>

        {/* Quick actions */}
        <div className="card">
          <h3>
            <Icon.Sparkles width={14} height={14} style={{ color: "var(--xr-secondary)" }}/>
            Quick actions
          </h3>
          <div className="quick-actions">
            {[
              { ic: <Icon.Code width={16} height={16}/>, title: "Open project", desc: "Pick a folder", act: () => onGoWork() },
              { ic: <Icon.Bolt width={16} height={16}/>, title: "Build website", desc: "Start Builder", act: () => onGoWork("Build a landing page") },
              { ic: <Icon.Book width={16} height={16}/>, title: "Research", desc: "Deep search", act: () => onGoWork("Research: ") },
              { ic: <Icon.Folder width={16} height={16}/>, title: "Open folder", desc: "Browse local", act: () => {} },
              { ic: <Icon.Globe width={16} height={16}/>, title: "Connect model", desc: "Add provider", act: () => {} },
              { ic: <Icon.Shield width={16} height={16}/>, title: "Review trust", desc: "Policy & approvals", act: onReview },
            ].map((q, i) => (
              <div key={i} className="qa-tile" onClick={q.act}>
                <div className="qic">{q.ic}</div>
                <div className="qtitle">{q.title}</div>
                <div className="qdesc">{q.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Today's Spend */}
        <div className="card">
          <h3>
            <Icon.Wallet width={14} height={14} style={{ color: "var(--xr-success)" }}/>
            Today's spend
          </h3>
          <div className="spend-mini">
            <div><span className="amount">$0.42</span><span className="cap"> / $5.00 cap</span></div>
            <div className="bar"><div className="bar-fill" style={{ width: "8.4%" }}/></div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, fontSize: 11 }}>
              <span className="xr-pill xr-pill--green">Within budget</span>
              <button className="xr-btn xr-btn--sm xr-btn--ghost" style={{ marginLeft: "auto", padding: "2px 8px", height: 22, fontSize: 11 }}>Adjust cap</button>
            </div>
          </div>
        </div>

        {/* System Status */}
        <div className="card">
          <h3>
            <Icon.Activity width={14} height={14} style={{ color: "var(--xr-info)" }}/>
            System status
          </h3>
          <div className="sys-status">
            {[
              { label: "Engine", kind: "ok" as const, value: "Online" },
              { label: "Ollama", kind: "warn" as const, value: "Not detected" },
              { label: "Cloud providers", kind: "ok" as const, value: "Connected" },
              { label: "Voice", kind: "idle" as const, value: "Offline" },
            ].map((r, i) => (
              <div key={i} className="row">
                <StatusDot kind={r.kind} size={8}/>
                <span className="label">{r.label}</span>
                <span className="xr-dim">{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>
            <Icon.Layers width={14} height={14} style={{ color: "var(--xr-warning)" }}/>
            Activity
          </h3>
          <div className="activity">
            {[
              { ic: <Icon.Check width={13} height={13} style={{ color: "var(--xr-success)" }}/>, t: "XR completed", d: "Refactor retry loop in agent.ts", time: "2 min ago" },
              { ic: <Icon.AlertTriangle width={13} height={13} style={{ color: "var(--xr-warning)" }}/>, t: "Approval requested", d: "Run shell command: npm test", time: "5 min ago" },
              { ic: <Icon.X width={13} height={13} style={{ color: "var(--xr-error)" }}/>, t: "Run failed", d: "Ollama unreachable — switching to cloud", time: "4 hours ago" },
              { ic: <Icon.Book width={13} height={13} style={{ color: "var(--xr-secondary)" }}/>, t: "Report generated", d: "research/competitor-pricing.md", time: "Yesterday" },
              { ic: <Icon.Shield width={13} height={13} style={{ color: "var(--xr-success)" }}/>, t: "Audit verified", d: "1,247 events logged", time: "Today" },
            ].map((a, i) => (
              <div key={i} className="act-item">
                <span className="ic">{a.ic}</span>
                <div style={{ flex: 1 }}>
                  <span className="tt">{a.t}:</span> {a.d}
                  <div className="time">{a.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Full-width composer */}
        <div className="home-composer full-width">
          <textarea
            className="xr-textarea"
            rows={1}
            placeholder="Tell XR what to do…  (try: 'add exponential backoff to agent.ts', 'research top landing page trends', 'build a personal site')"
            value={composer}
            onChange={(e) => { setComposer(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px"; }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 4px 4px" }}>
            <button className="xr-btn xr-btn--sm xr-btn--ghost"><Icon.Paperclip width={14} height={14}/> Attach</button>
            <button className="xr-model-pill"><span className="dot"/>Claude Opus<Icon.ChevronDown width={10} height={10}/></button>
            <div style={{ flex: 1 }}/>
            <span className="xr-keycap">↵</span>
            <button className="xr-send-btn" onClick={send} disabled={!composer.trim()}><Icon.Send width={13} height={13}/></button>
          </div>
        </div>
      </div>
    </div>
  );
}
