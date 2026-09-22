import { useState } from "react";
import { Icon } from "../components/icons";
import { StatusDot } from "../components/StatusDot";

type Section = "queue" | "modes" | "approvals" | "budget" | "audit" | "models" | "data" | "permissions" | "shield";

export function Trust() {
  const [section, setSection] = useState<Section>("queue");
  const [mode, setMode] = useState<"careful"|"balanced"|"autonomous">("balanced");

  return (
    <div className="xr-page">
      <div className="xr-page-head">
        <div>
          <h1>Trust Center</h1>
          <p className="xr-subtitle">One place for safety: approvals, modes, audit, budgets, network, and permissions.</p>
        </div>
        <div className="xr-page-head-actions">
          <span className="xr-mode-pill"><Icon.Shield width={14} height={14}/> {mode.toUpperCase()}</span>
        </div>
      </div>

      <div className="xr-two-col">
        <nav className="xr-subnav">
          <button className="sub-item" aria-current={section === "queue" ? "page" : undefined} onClick={() => setSection("queue")}>
            <Icon.AlertTriangle width={15} height={15}/> Queue
            <span className="badge">2</span>
          </button>
          <button className="sub-item" aria-current={section === "modes" ? "page" : undefined} onClick={() => setSection("modes")}>
            <Icon.Shield width={15} height={15}/> Modes
          </button>
          <button className="sub-item" aria-current={section === "approvals" ? "page" : undefined} onClick={() => setSection("approvals")}>
            <Icon.Check width={15} height={15}/> Permissions
          </button>
          <button className="sub-item" aria-current={section === "budget" ? "page" : undefined} onClick={() => setSection("budget")}>
            <Icon.Dashboard width={15} height={15}/> Budget
          </button>
          <button className="sub-item" aria-current={section === "audit" ? "page" : undefined} onClick={() => setSection("audit")}>
            <Icon.File width={15} height={15}/> Audit log
          </button>
          <button className="sub-item" aria-current={section === "models" ? "page" : undefined} onClick={() => setSection("models")}>
            <Icon.Cpu width={15} height={15}/> Providers
          </button>
          <button className="sub-item" aria-current={section === "data" ? "page" : undefined} onClick={() => setSection("data")}>
            <Icon.Folder width={15} height={15}/> Data & memory
          </button>
          <button className="sub-item" aria-current={section === "permissions" ? "page" : undefined} onClick={() => setSection("permissions")}>
            <Icon.Globe width={15} height={15}/> Networks
          </button>
          <button className="sub-item" aria-current={section === "shield" ? "page" : undefined} onClick={() => setSection("shield")}>
            <Icon.Shield width={15} height={15}/> Shield
          </button>
        </nav>

        <div className="xr-section-body" style={{ padding: 16 }}>
          {section === "queue" && <QueueSection/>}
          {section === "modes" && <ModesSection mode={mode} setMode={setMode}/>}
          {section === "approvals" && <ApprovalsSection/>}
          {section === "budget" && <BudgetSection/>}
          {section === "audit" && <AuditSection/>}
          {section === "models" && <ModelsSection/>}
          {section === "data" && <DataSection/>}
          {section === "permissions" && <NetworksSection/>}
          {section === "shield" && <ShieldSection/>}
        </div>
      </div>
    </div>
  );
}

function QueueSection() {
  const pending = [
    { id: "a1", tool: "shell", text: "npm install puppeteer", risk: "mid", reason: "installs packages into node_modules" },
    { id: "a2", tool: "fs.write", text: "write /home/user/xr/desktop/src/screens/Voice.tsx", risk: "high", reason: "modifies source file outside the active edit buffer" },
  ];
  return (
    <div>
      <div className="xr-section-header"><h3>Awaiting your decision</h3></div>
      {pending.length === 0 ? (
        <div className="xr-empty-state" style={{ minHeight: 200, padding: "40px 24px" }}>
          <Icon.Check width={48} height={48} className="xr-empty-illust" style={{ color: "var(--xr-success)" }}/>
          <h3>Nothing waiting</h3>
          <p>XR has all the approvals it needs. Approvals appear here the moment XR asks.</p>
        </div>
      ) : pending.map(p => (
        <div key={p.id} className="xr-alert xr-alert--error" style={{ marginBottom: 10 }}>
          <Icon.AlertTriangle width={20} height={20}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{p.text}</div>
            <div style={{ fontSize: 12, color: "var(--xr-text-dim)", marginTop: 2 }}>{p.tool} · {p.reason}</div>
          </div>
          <button className="xr-btn xr-btn--sm xr-btn--ghost">Deny</button>
          <button className="xr-btn xr-btn--sm xr-btn--primary">Allow once</button>
          <button className="xr-btn xr-btn--sm xr-btn--secondary">Always</button>
        </div>
      ))}
    </div>
  );
}

function ModesSection({ mode, setMode }: { mode: "careful"|"balanced"|"autonomous"; setMode: (m: "careful"|"balanced"|"autonomous") => void }) {
  const modes = [
    { id: "careful" as const, title: "Careful", desc: "Approve every action. XR plans, shows you, then waits. Best for production code and sensitive environments.", color: "var(--xr-success)" },
    { id: "balanced" as const, title: "Balanced", desc: "Approve risky actions (shell, external network, deletes). Read-only actions and edits in open files run freely.", color: "var(--xr-primary)" },
    { id: "autonomous" as const, title: "Autonomous", desc: "Run until done. Pause only on errors, budget, or explicit policy blocks. You can interrupt at any time.", color: "var(--xr-secondary)" },
  ];
  return (
    <div>
      <div className="xr-section-header"><h3>Trust mode</h3><p className="xr-dim" style={{ fontSize: 12, margin: 0 }}>Mode is a single decision. Changing it is audited.</p></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
        {modes.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} className={"xr-mode-card" + (mode === m.id ? " on" : "")} style={{ borderColor: mode === m.id ? m.color : undefined }}>
            <div className="t" style={{ color: mode === m.id ? m.color : undefined }}>{m.title}</div>
            <div className="d">{m.desc}</div>
            {mode === m.id && <div className="check" style={{ color: m.color }}><Icon.Check width={14} height={14}/> active</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

function ShieldSection() {
  return (
    <div>
      <div className="xr-section-header"><h3>Audit chain</h3></div>
      <div className="xr-stat-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", margin: "0 0 16px" }}>
        <div className="xr-stat-card ok"><div className="label">Engine</div><div className="value">signed</div><div className="hint">v2.1.0 phase4</div></div>
        <div className="xr-stat-card ok"><div className="label">App bundle</div><div className="value mono">4a93…f021</div><div className="hint">verified</div></div>
        <div className="xr-stat-card ok"><div className="label">Sidecar TLS</div><div className="value">mTLS</div><div className="hint">localhost-only</div></div>
        <div className="xr-stat-card warn"><div className="label">Telemetry</div><div className="value">off</div><div className="hint">all opt-in</div></div>
      </div>
      <div className="xr-alert"><Icon.Shield width={18} height={18}/><div style={{ flex:1 }}><b>Shield is on.</b> Every tool call, approval, and denial is signed in the audit chain. Nothing bypasses the gate.</div></div>
      <div style={{ marginTop: 14 }}>
        <button className="xr-btn xr-btn--sm xr-btn--ghost">Export audit log</button>
        <button className="xr-btn xr-btn--sm xr-btn--secondary" style={{ marginLeft: 8 }}>Verify chain</button>
      </div>
    </div>
  );
}

function ApprovalsSection() {
  const rules = [
    { id: 1, label: "Run shell commands", desc: "XR can execute terminal commands on your machine", risk: "high", always: false },
    { id: 2, label: "Read project files", desc: "XR can read any file inside the open workspace", risk: "low", always: true },
    { id: 3, label: "Edit files in project", desc: "XR can write/modify tracked project files", risk: "medium", always: true },
    { id: 4, label: "Install packages", desc: "Run npm/pip/bun install; requires approval per invocation", risk: "high", always: false },
    { id: 5, label: "Git push", desc: "Push commits to remote repositories", risk: "medium", always: false },
    { id: 6, label: "Fetch web pages", desc: "Browse the web for research tasks", risk: "low", always: true },
    { id: 7, label: "Make outbound network calls", desc: "Hit APIs, download files, contact external services", risk: "medium", always: false },
  ];
  return (
    <div>
      <div className="xr-section-header">
        <h3>Permission rules</h3>
        <button className="xr-btn xr-btn--ghost xr-btn--sm">+ New rule</button>
      </div>
      <div className="xr-card-list">
        {rules.map(r => (
          <div key={r.id} className="xr-policy-row">
            <div style={{ flex: 1 }}>
              <div className="xr-policy-label">{r.label}</div>
              <div className="xr-dim" style={{ fontSize: 12 }}>{r.desc}</div>
            </div>
            <span className={"xr-pill xr-pill--" + r.risk}>{r.risk}</span>
            <label className="xr-toggle">
              <input type="checkbox" defaultChecked={r.always}/>
              <span>Always allow</span>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetSection() {
  const spent = 2.37;
  const cap = 25.00;
  const pct = Math.min(100, (spent / cap) * 100);
  return (
    <div>
      <div className="xr-trust-hero">
        <h2>Monthly spending <span className="mode-pill" style={{ background: "rgba(0,255,136,0.1)", color: "var(--xr-success)", borderColor: "rgba(0,255,136,0.25)" }}><StatusDot kind="ok"/> On budget</span></h2>
        <p>You've spent <b style={{ color: "var(--xr-text)" }}>${spent.toFixed(2)}</b> of your <b style={{ color: "var(--xr-text)" }}>${cap.toFixed(2)}</b> monthly cap. XR will pause at the cap and ask before charging more.</p>
        <div style={{ marginTop: 18 }}>
          <div className="xr-spend-bar" style={{ maxWidth: 520 }}>
            <div style={{ width: pct + "%" }}/>
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 16, fontSize: 12 }}>
            <span className="xr-dim">Spent <b style={{ color: "var(--xr-text)", fontFamily: "var(--xr-font-mono)" }}>${spent.toFixed(2)}</b></span>
            <span className="xr-dim">Remaining <b style={{ color: "var(--xr-success)", fontFamily: "var(--xr-font-mono)" }}>${(cap - spent).toFixed(2)}</b></span>
            <span className="xr-dim">Cap <b style={{ color: "var(--xr-text)", fontFamily: "var(--xr-font-mono)" }}>${cap.toFixed(2)}/mo</b></span>
          </div>
        </div>
      </div>

      <div className="xr-stat-grid">
        <div className="xr-stat-card ok">
          <div className="label">Today</div>
          <div className="value">$0.42</div>
          <div className="hint">7 runs · 34k tokens</div>
        </div>
        <div className="xr-stat-card">
          <div className="label">This week</div>
          <div className="value">$1.88</div>
          <div className="hint">47 runs · 212k tokens</div>
        </div>
        <div className="xr-stat-card warn">
          <div className="label">Avg per run</div>
          <div className="value">$0.04</div>
          <div className="hint">up 12% vs last week</div>
        </div>
        <div className="xr-stat-card">
          <div className="label">Top model</div>
          <div className="value" style={{ fontSize: 16 }}>Claude Sonnet 4.6</div>
          <div className="hint">62% of spend</div>
        </div>
      </div>

      <div className="xr-section-header"><h3>Spend breakdown by model</h3></div>
      <table className="xr-table">
        <thead><tr><th>Model</th><th>Tokens</th><th>Calls</th><th>Cost</th><th>% of total</th></tr></thead>
        <tbody>
          <tr><td>Claude Sonnet 4.6</td><td className="mono">131k</td><td className="mono">214</td><td className="mono">$1.47</td><td><div className="xr-inline-bar"><div style={{ width: "62%" }}/></div></td></tr>
          <tr><td>Claude Opus 4.6</td><td className="mono">18k</td><td className="mono">12</td><td className="mono">$0.64</td><td><div className="xr-inline-bar"><div style={{ width: "27%", background: "var(--xr-secondary)" }}/></div></td></tr>
          <tr><td>GPT-5</td><td className="mono">22k</td><td className="mono">48</td><td className="mono">$0.18</td><td><div className="xr-inline-bar"><div style={{ width: "8%", background: "var(--xr-warning)" }}/></div></td></tr>
          <tr><td>Gemini 2.5 Pro</td><td className="mono">41k</td><td className="mono">29</td><td className="mono">$0.08</td><td><div className="xr-inline-bar"><div style={{ width: "3%", background: "var(--xr-dim)" }}/></div></td></tr>
        </tbody>
      </table>
    </div>
  );
}

function AuditSection() {
  const entries = [
    { t: "12:41:02", kind: "run", actor: "XR", action: "completed run", detail: "Fix the build errors in diff.ts", outcome: "ok" },
    { t: "12:38:47", kind: "approve", actor: "you", action: "approved shell", detail: "npm run build", outcome: "ok" },
    { t: "12:38:10", kind: "edit", actor: "XR", action: "edited file", detail: "desktop/src/components/HunkReview.tsx", outcome: "ok" },
    { t: "12:35:04", kind: "deny", actor: "you", action: "denied shell", detail: "rm -rf node_modules", outcome: "warn" },
    { t: "12:30:22", kind: "run", actor: "XR", action: "started run", detail: "Fix the build errors in diff.ts", outcome: "ok" },
    { t: "12:24:19", kind: "network", actor: "XR", action: "fetched url", detail: "https://docs.codemirror.net", outcome: "ok" },
    { t: "12:18:55", kind: "model", actor: "system", action: "provider offline", detail: "Ollama not running", outcome: "err" },
    { t: "12:10:02", kind: "run", actor: "XR", action: "completed run", detail: "Implement ApprovalModal countdown", outcome: "ok" },
  ];
  return (
    <div>
      <div className="xr-section-header"><h3>Audit log — last 24 hours</h3>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="xr-filter-chip" aria-pressed="true">All</button>
          <button className="xr-filter-chip" aria-pressed="false">Approvals</button>
          <button className="xr-filter-chip" aria-pressed="false">File edits</button>
          <button className="xr-filter-chip" aria-pressed="false">Shell</button>
          <button className="xr-filter-chip" aria-pressed="false">Errors</button>
        </div>
      </div>
      <table className="xr-table">
        <thead><tr><th style={{ width: 90 }}>Time</th><th style={{ width: 80 }}>Kind</th><th style={{ width: 80 }}>Actor</th><th>Action</th><th style={{ width: 200 }}>Detail</th></tr></thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i}>
              <td className="mono faint">{e.t}</td>
              <td><span className={"xr-pill xr-pill--" + e.outcome}>{e.kind}</span></td>
              <td>{e.actor}</td>
              <td>{e.action}</td>
              <td className="mono faint" style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelsSection() {
  const providers = [
    { name: "Anthropic", status: "ok", models: "Claude Opus 4.6, Sonnet 4.6", latency: "340ms" },
    { name: "OpenAI", status: "ok", models: "GPT-5, GPT-5 mini", latency: "412ms" },
    { name: "Google", status: "ok", models: "Gemini 2.5 Pro", latency: "287ms" },
    { name: "Ollama (local)", status: "err", models: "Llama 3.3 70B", latency: "—", fix: "Start Ollama" },
    { name: "xAI", status: "warn", models: "Grok 4", latency: "2.4s", fix: "Slow response" },
  ];
  return (
    <div>
      <div className="xr-section-header"><h3>Providers</h3><button className="xr-btn xr-btn--sm xr-btn--ghost"><Icon.Plus width={13} height={13}/> Add provider</button></div>
      <div className="xr-card-list">
        {providers.map((p, i) => (
          <div key={i} className="xr-provider-row">
            <StatusDot kind={p.status as any}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="xr-dim" style={{ fontSize: 11.5 }}>{p.models}</div>
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--xr-text-dim)" }}>{p.latency}</div>
            {p.fix ? <button className="xr-btn xr-btn--sm xr-btn--primary"><Icon.Wrench width={12} height={12}/> {p.fix}</button> : <span className="xr-pill xr-pill--ok">online</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DataSection() {
  return (
    <div>
      <div className="xr-section-header"><h3>Memory & data</h3></div>
      <div className="xr-card-list">
        <div className="xr-policy-row">
          <div style={{ flex: 1 }}>
            <div className="xr-policy-label">Persistent project memory</div>
            <div className="xr-dim" style={{ fontSize: 12 }}>XR remembers decisions, style, and conventions across sessions in this project.</div>
          </div>
          <label className="xr-toggle"><input type="checkbox" defaultChecked/><span>Enabled</span></label>
        </div>
        <div className="xr-policy-row">
          <div style={{ flex: 1 }}>
            <div className="xr-policy-label">Code indexing</div>
            <div className="xr-dim" style={{ fontSize: 12 }}>Index workspace for semantic search; embeddings stored locally.</div>
          </div>
          <label className="xr-toggle"><input type="checkbox" defaultChecked/><span>Enabled</span></label>
        </div>
        <div className="xr-policy-row">
          <div style={{ flex: 1 }}>
            <div className="xr-policy-label">Allow training on my prompts</div>
            <div className="xr-dim" style={{ fontSize: 12 }}>Share anonymized interactions with model providers.</div>
          </div>
          <label className="xr-toggle"><input type="checkbox"/><span>Disabled</span></label>
        </div>
        <div className="xr-policy-row">
          <div style={{ flex: 1 }}>
            <div className="xr-policy-label">Conversation history retention</div>
            <div className="xr-dim" style={{ fontSize: 12 }}>Keep local chat transcript for 90 days.</div>
          </div>
          <button className="xr-btn xr-btn--sm xr-btn--ghost">Export</button>
          <button className="xr-btn xr-btn--sm xr-btn--secondary">Clear</button>
        </div>
      </div>
    </div>
  );
}

function NetworksSection() {
  const tools = [
    { name: "Web fetch", desc: "Fetch pages over HTTPS", on: true },
    { name: "Shell access", desc: "Run commands in PTY", on: true },
    { name: "Filesystem (project)", desc: "Read/write inside workspace", on: true },
    { name: "Filesystem (home)", desc: "Read files outside workspace", on: false },
    { name: "Browser control", desc: "Drive browser for testing", on: false },
    { name: "Git operations", desc: "Commit, branch, push", on: true },
  ];
  return (
    <div>
      <div className="xr-section-header"><h3>Connected tools & network access</h3></div>
      <div className="xr-card-list">
        {tools.map((t, i) => (
          <div key={i} className="xr-policy-row">
            <Icon.Plug width={16} height={16} style={{ color: t.on ? "var(--xr-success)" : "var(--xr-muted)" }}/>
            <div style={{ flex: 1 }}>
              <div className="xr-policy-label">{t.name}</div>
              <div className="xr-dim" style={{ fontSize: 12 }}>{t.desc}</div>
            </div>
            <label className="xr-toggle"><input type="checkbox" defaultChecked={t.on}/><span>{t.on ? "Allowed" : "Blocked"}</span></label>
          </div>
        ))}
      </div>
    </div>
  );
}
