import { useState } from "react";
import { Icon } from "../components/icons";
import { StatusDot } from "../components/StatusDot";

type AgentState = "idle" | "running" | "done" | "failed" | "waiting";
type Agent = { id: string; role: string; model: string; state: AgentState; step?: string; pct?: number; error?: { title: string; fix: string; action?: string } };

const lanes = [
  { label: "Planning", agents: [
    { id: "planner", role: "Planner", model: "Claude Opus 4.6", state: "done", step: "Plan finalized — 7 steps" },
  ] as Agent[] },
  { label: "Coding", agents: [
    { id: "fe", role: "Frontend Dev", model: "Claude Sonnet 4.6", state: "running", step: "Implementing DiffViewer per-hunk UX", pct: 68 },
    { id: "be", role: "Backend Dev", model: "Claude Sonnet 4.6", state: "waiting", step: "Waiting on hunks API schema" },
    { id: "ui", role: "UI / Design", model: "GPT-5", state: "done", step: "Approval modal + Diff viewer tokens" },
  ] as Agent[] },
  { label: "Review", agents: [
    { id: "reviewer", role: "Reviewer", model: "Claude Opus 4.6", state: "idle", step: "Waiting for code changes" },
    { id: "tester", role: "Tester", model: "GPT-5", state: "failed", step: "Unit tests", pct: 40, error: { title: "Test runner can't start", fix: "Node 20 isn't on PATH. Install or select a different runtime.", action: "Fix runtime" } },
  ] as Agent[] },
];

export function Agents() {
  const [compact, setCompact] = useState(false);
  return (
    <div className="xr-page">
      <div className="xr-page-head">
        <div>
          <h1>Multi-agent workspaces</h1>
          <p className="xr-subtitle">Orchestrate specialized agents working in parallel on the same task.</p>
        </div>
        <div className="xr-page-head-actions">
          <label className="xr-toggle" style={{ marginRight: 8 }}><input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)}/><span>Compact</span></label>
          <button className="xr-btn xr-btn--sm xr-btn--ghost">Team templates</button>
          <button className="xr-btn xr-btn--sm xr-btn--primary"><Icon.Plus width={13} height={13}/> New team</button>
        </div>
      </div>

      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--xr-border)", display: "flex", alignItems: "center", gap: 14 }}>
        <StatusDot kind="info" pulse size={10}/>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Phase 2 build — V2.1 Operator</span>
        <span className="xr-dim" style={{ fontSize: 12 }}>5 agents · 3 of 7 steps complete · 2m 14s elapsed</span>
        <div style={{ flex: 1 }}/>
        <button className="xr-btn xr-btn--sm xr-btn--secondary"><Icon.Pause width={12} height={12}/> Pause all</button>
        <button className="xr-btn xr-btn--sm"><Icon.StopCircle width={12} height={12}/> Stop</button>
      </div>

      <div className="xr-swimlanes" style={{ flex: 1, overflowY: "auto" }}>
        {lanes.map(l => (
          <div key={l.label} className="xr-lane">
            <div className="xr-lane-label">{l.label}</div>
            <div className="xr-lane-cards">
              {l.agents.map(a => <AgentCard key={a.id} a={a}/>)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: "1px solid var(--xr-border)", height: 240, display: "grid", gridTemplateColumns: "2fr 1fr" }}>
        <div style={{ borderRight: "1px solid var(--xr-border)", padding: 16, overflowY: "auto" }}>
          <div className="xr-section-header" style={{ padding: "0 0 10px" }}><h3>Activity stream</h3></div>
          {[
            { who: "Frontend Dev", t: "now", msg: "Applying patch to HunkReview.tsx" },
            { who: "Reviewer", t: "-8s", msg: "Said: waiting for code changes to review" },
            { who: "Tester", t: "-22s", msg: "❌ Test runner failed — Node 20 not on PATH", err: true },
            { who: "UI / Design", t: "-45s", msg: "Completed: Approval modal + Diff viewer tokens designed" },
            { who: "Backend Dev", t: "-1m", msg: "Waiting on hunks API schema from Frontend Dev" },
            { who: "Planner", t: "-2m", msg: "Plan finalized — 7 steps across 5 agents" },
          ].map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", fontSize: 12 }}>
              <span className="mono faint" style={{ width: 48, flexShrink: 0 }}>{e.t}</span>
              <span style={{ fontWeight: 600, width: 90, flexShrink: 0, color: e.err ? "var(--xr-error)" : "var(--xr-text)" }}>{e.who}</span>
              <span className="xr-dim" style={{ color: e.err ? "var(--xr-error)" : "var(--xr-text-dim)" }}>{e.msg}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: 16, overflowY: "auto", background: "var(--xr-bg-2)" }}>
          <div className="xr-section-header" style={{ padding: "0 0 10px" }}><h3>Shared artifacts</h3></div>
          {["ApprovalModal.tsx", "DiffViewer.tsx", "runs.patch", "design-spec.md"].map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", fontSize: 12, borderBottom: "1px solid var(--xr-border)" }}>
              <Icon.File width={14} height={14} style={{ color: "var(--xr-primary)" }}/>
              <span style={{ fontFamily: "var(--xr-font-mono)", flex: 1 }}>{f}</span>
              <Icon.ChevronRight width={12} height={12} className="xr-dim"/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentCard({ a }: { a: Agent }) {
  const cls = a.state === "done" ? "done" : a.state === "failed" ? "failed" : a.state === "running" ? "running" : "";
  return (
    <div className={"xr-agent-card " + cls}>
      <div className="role">
        <StatusDot kind={a.state === "done" ? "ok" : a.state === "failed" ? "err" : a.state === "running" ? "info" : "warn"} size={9} pulse={a.state === "running"}/>
        {a.role}
      </div>
      <div className="xr-dim" style={{ fontSize: 10.5, marginTop: 2 }}>{a.model}</div>
      <div className="step">{a.step}</div>
      {a.pct != null && (
        <div className="progress"><div style={{ width: a.pct + "%" }}/></div>
      )}
      {a.error && (
        <>
          <div style={{ fontSize: 11, color: "var(--xr-error)", marginTop: 8 }}>{a.error.fix}</div>
          <button className="xr-btn xr-btn--sm xr-btn--primary fix-btn"><Icon.Wrench width={11} height={11}/> {a.error.action ?? "Fix"}</button>
        </>
      )}
    </div>
  );
}
