import { useState } from "react";
import { Icon } from "../components/icons";
import { StatusDot } from "../components/StatusDot";
import { pushToast } from "../components/ToastBus";

type NodeState = "running" | "done" | "failed" | "waiting" | "idle";
type AgentNode = {
  id: string; role: string; name: string; step: string; state: NodeState;
  pct: number; cost?: number; tokens?: number; x: number; y: number; deps: string[];
};

const BOARD: AgentNode[] = [
  { id: "planner", name: "Planner", role: "planner", step: "Broke task into 5 steps; emitted workflow graph.", state: "done", pct: 100, cost: 0.01, tokens: 420, x: 40, y: 40, deps: [] },
  { id: "research", name: "Researcher", role: "research", step: "Pulled Q3 pricing from 6 sources.", state: "done", pct: 100, cost: 0.04, tokens: 2800, x: 300, y: 20, deps: ["planner"] },
  { id: "fe", name: "Frontend", role: "coder", step: "Rendering DiffViewer per-hunk UX (75%)", state: "running", pct: 75, cost: 0.02, tokens: 1800, x: 300, y: 180, deps: ["planner"] },
  { id: "be", name: "Backend", role: "coder", step: "Awaiting hunks API schema from Frontend", state: "waiting", pct: 0, x: 300, y: 320, deps: ["planner", "fe"] },
  { id: "reviewer", name: "Reviewer", role: "review", step: "Idle — waiting on code changes", state: "idle", pct: 0, x: 580, y: 100, deps: ["fe", "be"] },
  { id: "tester", name: "Tester", role: "qa", step: "Node 20 not on PATH", state: "failed", pct: 40, cost: 0.005, x: 580, y: 260, deps: ["fe", "be"] },
];

const ROLE_COLORS: Record<string, string> = {
  planner: "#6048F8", research: "#00D4FF", coder: "#4DA3FF", review: "#B794FF", qa: "#FFB547",
};

export function Teams() {
  const [nodes, setNodes] = useState(BOARD);
  const [selected, setSelected] = useState<string | null>("tester");
  const [paused, setPaused] = useState(false);
  const active = nodes.filter(n => n.state === "running").length;
  const done = nodes.filter(n => n.state === "done").length;
  const failed = nodes.filter(n => n.state === "failed").length;
  const totalCost = nodes.reduce((s, n) => s + (n.cost ?? 0), 0);

  function retry(id: string) {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, state: "running", pct: 5, step: "Retrying…" } : n));
    pushToast("info", "Retrying node", "Restarting the agent with fresh context.");
  }

  const sel = nodes.find(n => n.id === selected);

  return (
    <div className="xr-page" style={{ display: "flex", flexDirection: "column" }}>
      <div className="xr-page-head">
        <div>
          <h1>Team run</h1>
          <p className="xr-subtitle">Phase 2 build — V2.1 Operator · 6 roles · live</p>
        </div>
        <div className="xr-page-head-actions">
          <button className="xr-btn xr-btn--sm xr-btn--ghost" onClick={() => pushToast("info","Replan","Asking planner for an updated graph")}><Icon.Refresh width={12} height={12}/> Replan</button>
          {paused
            ? <button className="xr-btn xr-btn--sm xr-btn--primary" onClick={() => setPaused(false)}><Icon.Play width={12} height={12}/> Resume</button>
            : <button className="xr-btn xr-btn--sm xr-btn--secondary" onClick={() => setPaused(true)}><Icon.Pause width={12} height={12}/> Pause all</button>}
          <button className="xr-btn xr-btn--sm" onClick={() => pushToast("info","Stopped","Run cancelled")}><Icon.Stop width={12} height={12}/> Stop</button>
        </div>
      </div>

      <div className="xr-board-controls">
        <StatusDot kind={failed ? "err" : active ? "info" : "ok"} size={10} pulse={active > 0 && !paused}/>
        <span style={{ fontSize: 12.5 }}>{paused ? "Paused" : active ? `${active} running` : failed ? `${failed} failed` : "All done"}</span>
        <div className="stats">
          <span><b>{done}</b> done</span>
          <span><b>{active}</b> running</span>
          <span><b style={{ color: failed ? "var(--xr-error)" : "inherit" }}>{failed}</b> failed</span>
          <span>spend <b className="mono">${totalCost.toFixed(3)}</b></span>
          <span>elapsed <b className="mono">3m 42s</b></span>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div className="xr-agents-board">
          <svg className="edges">
            {nodes.map(n => n.deps.map(depId => {
              const d = nodes.find(x => x.id === depId);
              if (!d) return null;
              const x1 = d.x + 220, y1 = d.y + 50;
              const x2 = n.x, y2 = n.y + 50;
              const isActive = n.state === "running" || d.state === "running";
              return <line key={depId + "->" + n.id} x1={x1} y1={y1} x2={x2} y2={y2} className={isActive ? "active" : ""}/>;
            }))}
          </svg>
          {nodes.map(n => (
            <div key={n.id} className={"xr-node " + n.state} style={{ left: n.x, top: n.y }} onClick={() => setSelected(n.id)}>
              <span className="role-chip" style={{ color: ROLE_COLORS[n.role], background: `${ROLE_COLORS[n.role]}14` }}>
                <StatusDot kind={n.state === "done" ? "ok" : n.state === "failed" ? "err" : n.state === "running" ? "info" : "warn"} size={8} pulse={n.state === "running"}/>
                {n.role}
              </span>
              <h4>{n.name}</h4>
              <div className="step">{n.step}</div>
              <div className="burn"><div style={{ width: n.pct + "%" }}/></div>
              <div className="meta-row">
                <span>{n.pct}%</span>
                <span>{n.cost ? `$${n.cost.toFixed(3)}` : "—"} · {n.tokens ? n.tokens.toLocaleString() + " tok" : "—"}</span>
              </div>
              {n.state === "failed" && (
                <div className="node-actions">
                  <button className="xr-btn xr-btn--sm xr-btn--primary" onClick={(e) => { e.stopPropagation(); retry(n.id); }}><Icon.Wrench width={11} height={11}/> Fix & retry</button>
                  <button className="xr-btn xr-btn--sm xr-btn--ghost">View log</button>
                </div>
              )}
              {n.state === "waiting" && (
                <div className="node-actions">
                  <button className="xr-btn xr-btn--sm xr-btn--ghost" onClick={(e) => { e.stopPropagation(); pushToast("info","Message sent","Sending steer message to agent"); }}>Nudge</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Inspector */}
        {sel && (
          <aside style={{ width: 340, borderLeft: "1px solid var(--xr-border)", padding: 16, overflowY: "auto", background: "var(--xr-bg-2)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span className="role-chip" style={{ color: ROLE_COLORS[sel.role], background: `${ROLE_COLORS[sel.role]}14` }}>{sel.role}</span>
              <span className={"xr-pill xr-pill--" + (sel.state === "done" ? "ok" : sel.state === "failed" ? "err" : sel.state === "running" ? "low" : "warn")}>{sel.state}</span>
            </div>
            <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>{sel.name}</h3>
            <p className="xr-dim" style={{ fontSize: 12, margin: "0 0 14px" }}>{sel.step}</p>

            <div className="xr-stat-grid" style={{ gridTemplateColumns: "1fr 1fr", margin: "0 0 14px" }}>
              <div className="xr-stat-card"><div className="label">Progress</div><div className="value" style={{ fontSize: 18 }}>{sel.pct}%</div></div>
              <div className="xr-stat-card"><div className="label">Cost</div><div className="value mono" style={{ fontSize: 18 }}>{sel.cost ? `$${sel.cost.toFixed(3)}` : "—"}</div></div>
            </div>

            <h4 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--xr-muted)", margin: "14px 0 8px" }}>Activity</h4>
            <div className="xr-timeline">
              {[
                { icon: "ok" as const, text: "Accepted plan from Planner", t: "3m ago" },
                { icon: "ok" as const, text: "Loaded tools: Read, Edit, Shell", t: "2m 50s" } as const,
                ...(sel.state === "failed" ? [{ icon: "err" as const, text: sel.step, t: "12s ago" }] :
                    sel.state === "running" ? [{ icon: "working" as const, text: sel.step, t: "now" }] :
                    sel.state === "done" ? [{ icon: "ok" as const, text: "Completed", t: "1m ago" }] :
                    [{ icon: "warn" as const, text: "Waiting on dependencies", t: "" }]),
              ].map((e, i) => (
                <div key={i} className="xr-timeline-item">
                  <div className="xr-timeline-line"/>
                  <div className="xr-timeline-dot"><StatusDot kind={e.icon} size={10} pulse={e.icon === "working"}/></div>
                  <div style={{ flex: 1, fontSize: 12 }}>{e.text}</div>
                  {e.t && <span className="mono faint" style={{ fontSize: 11 }}>{e.t}</span>}
                </div>
              ))}
            </div>

            {sel.state === "failed" && (
              <div className="xr-alert xr-alert--error" style={{ marginTop: 14 }}>
                <Icon.AlertTriangle width={18} height={18}/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Node failed — Node 20 not on PATH</div>
                  <div style={{ fontSize: 12, color: "var(--xr-text-dim)", marginTop: 2 }}>Tests can't start. Install Node 20 or change the runtime in project settings.</div>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
