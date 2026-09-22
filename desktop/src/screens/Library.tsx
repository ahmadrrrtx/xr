import { useMemo, useState } from "react";
import { Icon } from "../components/icons";
import { StatusDot } from "../components/StatusDot";
import { pushToast } from "../components/ToastBus";
import { undoable } from "../undo";

type LibTab = "skills" | "mcp" | "plugins" | "integrations" | "automations";

type Skill = {
  id: string; name: string; cat: string; desc: string; tools: string[];
  enabled: boolean; legacy?: boolean; installed?: boolean; featured?: boolean;
};
type McpServer = {
  id: string; name: string; url: string; status: "ok" | "err" | "warn" | "unapproved";
  tools: number; drift?: { added: string[]; removed: string[]; changed: string[] };
};
type Plugin = { id: string; name: string; desc: string; version: string; state: "sandboxed" | "unsigned" | "quarantine" };
type Integration = { id: string; name: string; kind: string; desc: string; connected: boolean };
type Trigger = { id: string; when: string; what: string; enabled: boolean };

const CATEGORIES = ["All", "Code", "Web", "Data", "Writing", "DevOps", "Research", "Files"];

const SKILLS: Skill[] = [
  { id: "write-code", name: "Write code", cat: "Code", desc: "Write, refactor, and edit code with per-hunk diffs and approvals.", tools: ["Read","Edit","Shell"], enabled: true, featured: true, installed: true },
  { id: "review-pr", name: "Review PR", cat: "Code", desc: "Summarize a PR diff, flag risks, and suggest improvements.", tools: ["Read","Git"], enabled: true, installed: true },
  { id: "fix-errors", name: "Fix errors", cat: "Code", desc: "Read compiler errors, trace causes, and apply minimal patches.", tools: ["Read","Edit","Shell"], enabled: true },
  { id: "write-tests", name: "Write tests", cat: "Code", desc: "Generate unit tests for highlighted or open code.", tools: ["Read","Edit","Shell"], enabled: true },
  { id: "explain-code", name: "Explain code", cat: "Code", desc: "Plain-language explanation of a function or file.", tools: ["Read"], enabled: true },
  { id: "web-search", name: "Web search", cat: "Web", desc: "Search the web, fetch pages, extract key facts.", tools: ["Fetch"], enabled: true, featured: true },
  { id: "scrape-site", name: "Scrape site", cat: "Web", desc: "Crawl a site and extract structured content.", tools: ["Fetch"], enabled: false },
  { id: "summarize-page", name: "Summarize page", cat: "Web", desc: "Open a URL and write a concise summary.", tools: ["Fetch"], enabled: true },
  { id: "analyze-csv", name: "Analyze CSV", cat: "Data", desc: "Load a CSV, profile columns, and answer questions.", tools: ["Read","Compute"], enabled: true },
  { id: "chart-data", name: "Chart data", cat: "Data", desc: "Generate a chart from tabular data (SVG).", tools: ["Read","Compute"], enabled: false },
  { id: "draft-email", name: "Draft email", cat: "Writing", desc: "Compose a short email from bullet points.", tools: [], enabled: true },
  { id: "rewrite", name: "Rewrite for clarity", cat: "Writing", desc: "Tighten prose without changing meaning.", tools: [], enabled: true },
  { id: "run-command", name: "Run command", cat: "DevOps", desc: "Execute approved shell commands in the workspace PTY.", tools: ["Shell"], enabled: true },
  { id: "deploy", name: "Deploy", cat: "DevOps", desc: "Run the configured deploy pipeline (needs approval).", tools: ["Shell"], enabled: false, legacy: true },
  { id: "research-deep", name: "Deep research", cat: "Research", desc: "Run a multi-source research task with citations.", tools: ["Fetch","Plan"], enabled: true, featured: true },
  { id: "find-file", name: "Find file", cat: "Files", desc: "Locate files by name or content across the workspace.", tools: ["Read","Shell"], enabled: true },
  { id: "rename-symbol", name: "Rename symbol", cat: "Code", desc: "Rename across files with sanity checks.", tools: ["Read","Edit"], enabled: false },
  { id: "commit", name: "Commit changes", cat: "DevOps", desc: "Stage, write a message, and commit.", tools: ["Git","Shell"], enabled: true },
];

const MCP_SERVERS: McpServer[] = [
  { id: "filesystem", name: "filesystem", url: "npx -y @modelcontextprotocol/server-filesystem ~/xr", status: "ok", tools: 6 },
  { id: "github", name: "github", url: "npx -y @modelcontextprotocol/server-github", status: "ok", tools: 24 },
  { id: "postgres", name: "postgres", url: "postgresql://localhost:5432/app", status: "warn", tools: 8, drift: { added: ["pg:runQuery"], removed: ["pg:listTables"], changed: ["pg:describeTable"] } },
  { id: "browser", name: "puppeteer", url: "npx -y @modelcontextprotocol/server-puppeteer", status: "unapproved", tools: 0 },
  { id: "old-slack", name: "slack-legacy", url: "https://mcp.example.com/slack", status: "err", tools: 0 },
];

const PLUGINS: Plugin[] = [
  { id: "theme-cyan", name: "Cyan Accent Pack", desc: "Alternate primary accent set (Electric, Marine, Arctic).", version: "1.0.0", state: "sandboxed" },
  { id: "vim-mode", name: "Vim Mode", desc: "Modal key bindings in the editor (beta).", version: "0.4.2", state: "sandboxed" },
  { id: "sketchy", name: "Community Theme: Sketchy", desc: "Hand-drawn look for screenshots.", version: "2.1.0", state: "unsigned" },
  { id: "crashed", name: "Auto-Docstring", desc: "Generate docstrings on save.", version: "0.9.0", state: "quarantine" },
];

const INTEGRATIONS: Integration[] = [
  { id: "gh", name: "GitHub", kind: "git", desc: "Issues, PRs, gist create, commit-as-you-type.", connected: true },
  { id: "linear", name: "Linear", kind: "issue", desc: "Create & update issues from runs.", connected: true },
  { id: "slack", name: "Slack", kind: "chat", desc: "Post summaries & ask questions in channels.", connected: false },
  { id: "notion", name: "Notion", kind: "notes", desc: "Append findings to pages.", connected: false },
  { id: "figma", name: "Figma", kind: "design", desc: "Inspect designs & grab assets.", connected: false },
  { id: "sentry", name: "Sentry", kind: "observability", desc: "Pull stack traces into Runs.", connected: true },
];

const TRIGGERS: Trigger[] = [
  { id: "t1", when: "@startup", what: "Refresh MCP connections and provider health.", enabled: true },
  { id: "t2", when: "on run fail", what: "Capture a screenshot and write diagnostics entry.", enabled: true },
  { id: "t3", when: "budget ≥ 80%", what: "Pause autonomous runs and ask for cap raise.", enabled: true },
  { id: "t4", when: "every 15 min idle", what: "Suggest continuing the last unfinished task.", enabled: false },
];

export function Library() {
  const [tab, setTab] = useState<LibTab>("skills");
  return (
    <div className="xr-page xr-library">
      <div className="xr-page-head">
        <div>
          <h1>Library</h1>
          <p className="xr-subtitle">Skills, MCP tools, plugins, integrations, and automations — all in one place.</p>
        </div>
      </div>
      <div className="xr-library-tabs" role="tablist">
        {([
          ["skills", `Skills · ${SKILLS.length}`],
          ["mcp", "MCP servers"],
          ["plugins", "Plugins"],
          ["integrations", "Integrations"],
          ["automations", "Automations"],
        ] as const).map(([id, label]) => (
          <button key={id} className="xr-tab" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="xr-library-body">
        {tab === "skills" && <SkillsPane/>}
        {tab === "mcp" && <McpPane/>}
        {tab === "plugins" && <PluginsPane/>}
        {tab === "integrations" && <IntegrationsPane/>}
        {tab === "automations" && <AutomationsPane/>}
      </div>
    </div>
  );
}

function SkillsPane() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [detail, setDetail] = useState<Skill | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(SKILLS.map(s => [s.id, s.enabled])));
  const [pinned, setPinned] = useState<Record<string, boolean>>({});
  const list = useMemo(() => {
    const all = SKILLS.filter(s =>
      (cat === "All" || s.cat === cat) &&
      (q === "" || s.name.toLowerCase().includes(q.toLowerCase()) || s.desc.toLowerCase().includes(q.toLowerCase()))
    );
    // Pinned skills float to top.
    return [...all].sort((a, b) => Number(!!pinned[b.id]) - Number(!!pinned[a.id]));
  }, [q, cat, pinned]);

  return (
    <>
      <aside className="xr-library-side">
        <h4>Categories</h4>
        {CATEGORIES.map(c => (
          <div key={c} className="side-link" aria-current={cat === c ? "page" : undefined} onClick={() => setCat(c)}>
            {c}
            <span className="count">{c === "All" ? SKILLS.length : SKILLS.filter(s => s.cat === c).length}</span>
          </div>
        ))}
        <h4>Shortcuts</h4>
        <div className="side-link" onClick={() => setCat("All")}><Icon.Sparkles width={14} height={14}/> Featured</div>
        <div className="side-link" onClick={() => setCat("All")}><Icon.Download width={14} height={14}/> Installed</div>
        <div className="side-link" onClick={() => setCat("All")}><Icon.AlertTriangle width={14} height={14}/> Legacy <span className="count" style={{ color: "var(--xr-warning)" }}>{SKILLS.filter(s => s.legacy).length}</span></div>
      </aside>
      <main className="xr-library-main">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div className="xr-library-search" style={{ marginBottom: 0, flex: 1 }}>
            <Icon.Search width={15} height={15}/>
            <input className="xr-input" placeholder={`Search ${SKILLS.length} installed skills…`} value={q} onChange={e => setQ(e.target.value)}/>
          </div>
          <span className="xr-dim" style={{ fontSize: 12 }}>{list.length} result{list.length === 1 ? "" : "s"}</span>
        </div>
        {list.length === 0 ? (
          <EmptyState illust="search" title="No skills match" desc="Try a different category or clear your search."/>
        ) : (
          <div className="xr-cap-grid">
            {list.map(s => (
              <div key={s.id} className={"xr-cap-card" + (s.legacy ? " legacy" : "") + (pinned[s.id] ? " pinned" : "")} onClick={() => setDetail(s)}>
                <div className="toggle-corner" onClick={e => e.stopPropagation()}>
                  <label className="xr-toggle"><input type="checkbox" checked={enabled[s.id]} onChange={e => setEnabled(v => ({ ...v, [s.id]: e.target.checked }))}/><span/></label>
                </div>
                <button className={`cap-pin ${pinned[s.id] ? "on" : ""}`} title={pinned[s.id] ? "Unpin from quick bar" : "Pin to quick bar"} onClick={(e) => {
                  e.stopPropagation();
                  const was = !!pinned[s.id];
                  undoable("skill-pin", was ? "Unpinned skill" : "Pinned skill", s.name, {
                    do: () => setPinned(p => ({ ...p, [s.id]: !was })),
                    undo: () => setPinned(p => ({ ...p, [s.id]: was })),
                  });
                }}><Icon.Pin width={12} height={12}/></button>
                <div className="cap-ic"><Icon.Bolt width={18} height={18}/></div>
                <h4>{s.name}{pinned[s.id] && <span className="xr-pill xr-pill--low" style={{ marginLeft: 6 }}>Pinned</span>}{s.featured && !pinned[s.id] && <span className="xr-pill xr-pill--low" style={{ marginLeft: 6 }}>Featured</span>}{s.legacy && <span className="xr-pill xr-pill--warn" style={{ marginLeft: 6 }}>Legacy</span>}</h4>
                <p>{s.desc}</p>
                <div className="cap-meta">
                  {s.tools.slice(0, 3).map(t => <span key={t} className="xr-pill">{t}</span>)}
                  {s.tools.length > 3 && <span className="xr-pill">+{s.tools.length - 3}</span>}
                  <span className="xr-pill">{s.cat}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      {detail && <SkillDetailSheet skill={detail} enabled={enabled[detail.id]} onClose={() => setDetail(null)} onToggle={() => setEnabled(v => ({ ...v, [detail.id]: !v[detail.id] }))} onRun={() => { pushToast("ok", "Running skill", detail.name); setDetail(null); }}/>}
    </>
  );
}

function SkillDetailSheet({ skill, enabled, onClose, onToggle, onRun }: { skill: Skill; enabled: boolean; onClose: () => void; onToggle: () => void; onRun: () => void }) {
  const examples = [
    `@${skill.name.toLowerCase().replace(/\s+/g, "-")} on src/core/agent.ts`,
    `Use ${skill.name.toLowerCase()} for the open file`,
    `XR, ${skill.name.toLowerCase()} and explain what you changed`,
  ];
  return (
    <div className="xr-modal-backdrop" onClick={onClose}>
      <div className="xr-modal" style={{ width: 640 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "20px 22px 14px", display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={{ width: 44, height: 44, borderRadius: "var(--xr-radius-md)", background: skill.legacy ? "rgba(255,181,71,0.1)" : "rgba(0,212,255,0.1)", color: skill.legacy ? "var(--xr-warning)" : "var(--xr-primary)", display: "grid", placeItems: "center" }}>
            <Icon.Bolt width={22} height={22}/>
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>{skill.name}</h2>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <span className="xr-pill">{skill.cat}</span>
              {skill.tools.map(t => <span key={t} className="xr-pill">{t}</span>)}
              {skill.legacy && <span className="xr-pill xr-pill--warn">Basic manifest</span>}
              {skill.installed && <span className="xr-pill xr-pill--low">Installed</span>}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--xr-text-dim)", lineHeight: 1.55 }}>{skill.desc}</p>
          </div>
          <button className="xr-btn xr-btn--icon xr-btn--sm" onClick={onClose} title="Close"><Icon.X width={14} height={14}/></button>
        </div>

        <div style={{ padding: "4px 22px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: "var(--xr-bg-2)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-md)", padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--xr-muted)", marginBottom: 6 }}>Permissions required</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--xr-text-dim)", lineHeight: 1.8 }}>
              {skill.tools.includes("Shell") && <li>Run shell commands in workspace</li>}
              {skill.tools.includes("Edit") && <li>Read & write files in workspace</li>}
              {skill.tools.includes("Fetch") && <li>Fetch web pages (egress)</li>}
              {skill.tools.includes("Git") && <li>Git operations (commit, diff, branch)</li>}
              {skill.tools.length === 0 && <li>In-editor only — no external access</li>}
            </ul>
          </div>
          <div style={{ background: "var(--xr-bg-2)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-md)", padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--xr-muted)", marginBottom: 6 }}>Provenance</div>
            <div style={{ fontSize: 12, color: "var(--xr-text-dim)", lineHeight: 1.8 }}>
              <div>Source: <span style={{ color: "var(--xr-text)" }}>xr/builtin</span></div>
              <div>Version: <span className="mono">1.3.0</span></div>
              <div>Last updated: <span className="mono">3 days ago</span></div>
              <div>Signed: <span style={{ color: "var(--xr-success)" }}>xr-official</span></div>
            </div>
          </div>
        </div>

        <div style={{ padding: "0 22px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--xr-muted)", marginBottom: 6 }}>Example prompts</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {examples.map((e, i) => (
              <div key={i} className="mono" style={{ background: "var(--xr-bg-2)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-sm)", padding: "8px 10px", fontSize: 11.5 }}>{e}</div>
            ))}
          </div>
        </div>

        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--xr-border)", background: "var(--xr-bg-2)", display: "flex", alignItems: "center", gap: 10 }}>
          <label className="xr-toggle"><input type="checkbox" checked={enabled} onChange={onToggle}/><span/></label>
          <span style={{ fontSize: 12, color: "var(--xr-text-dim)" }}>{enabled ? "Enabled" : "Disabled"} in composer</span>
          <div style={{ flex: 1 }}/>
          <button className="xr-btn xr-btn--sm xr-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="xr-btn xr-btn--sm xr-btn--primary" onClick={onRun}><Icon.Play width={12} height={12}/> Run in Work</button>
        </div>
      </div>
    </div>
  );
}

function McpPane() {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [servers, setServers] = useState(MCP_SERVERS);
  function add() {
    if (!url.trim()) return;
    setServers(s => [{ id: "new-"+Date.now(), name: url.split("/").pop() || url, url, status: "unapproved", tools: 0 }, ...s]);
    setUrl(""); setAdding(false);
    pushToast("ok","Server added","Approve tool grants to activate");
  }
  return (
    <main className="xr-library-main" style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="xr-btn xr-btn--primary xr-btn--sm" onClick={() => setAdding(v => !v)}><Icon.Plus width={12} height={12}/> Connect server</button>
        <button className="xr-btn xr-btn--ghost xr-btn--sm" onClick={() => pushToast("ok", "Health rechecked", "All approved servers responded")}><Icon.Refresh width={12} height={12}/> Recheck health</button>
      </div>
      {adding && (
        <div style={{ background: "var(--xr-surface)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-md)", padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Connect MCP server</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="xr-input" placeholder="npx -y @modelcontextprotocol/server-…" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: 1 }} autoFocus/>
            <button className="xr-btn xr-btn--sm xr-btn--primary" onClick={add}>Connect</button>
            <button className="xr-btn xr-btn--sm xr-btn--ghost" onClick={() => { setAdding(false); setUrl(""); }}>Cancel</button>
          </div>
          <div className="xr-dim" style={{ fontSize: 11.5, marginTop: 6 }}>Paste an npx command, STDIO path, or http(s) URL. XR will fetch the manifest and ask you to approve each tool before activation.</div>
        </div>
      )}
      {servers.map(m => (
        <div key={m.id} className={"xr-mcp-card" + (m.drift ? " drift" : "")}>
          <StatusDot kind={m.status === "ok" ? "ok" : m.status === "err" ? "err" : "warn"} size={10}/>
          <div className="mcp-body">
            <div className="mcp-title">
              {m.name}
              {m.status === "unapproved" && <span className="xr-pill xr-pill--warn">needs approval</span>}
              {m.drift && <span className="xr-pill xr-pill--warn">contract changed</span>}
              {!m.tools && <span className="xr-pill xr-pill--err">unreachable</span>}
            </div>
            <div className="mcp-url">{m.url}</div>
            {m.tools > 0 && (
              <div className="mcp-tools">
                {Array.from({ length: Math.min(m.tools, 7) }).map((_, i) => <span key={i} className="xr-pill">tool_{i+1}</span>)}
                {m.tools > 7 && <span className="xr-pill">+{m.tools - 7}</span>}
              </div>
            )}
            {m.drift && (
              <table className="mcp-drift-table">
                <tbody>
                  {m.drift.added.map(n => <tr key={"+"+n}><td className="plus">+</td><td>{n}</td><td style={{ paddingLeft: 12, color: "var(--xr-muted)" }}>new tool — review before granting</td></tr>)}
                  {m.drift.removed.map(n => <tr key={"-"+n}><td className="minus">−</td><td>{n}</td><td style={{ paddingLeft: 12, color: "var(--xr-muted)" }}>removed — existing grants revoked</td></tr>)}
                  {m.drift.changed.map(n => <tr key={"m"+n}><td className="mod">~</td><td>{n}</td><td style={{ paddingLeft: 12, color: "var(--xr-muted)" }}>signature changed</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
          <div className="mcp-actions">
            {m.status === "unapproved" && <button className="xr-btn xr-btn--sm xr-btn--primary">Approve</button>}
            {m.drift && <button className="xr-btn xr-btn--sm" onClick={() => pushToast("ok", "Re-approved", "Drift reviewed; grants reapplied")}>Review & re-approve</button>}
            <button className="xr-btn xr-btn--sm xr-btn--ghost">Config</button>
          </div>
        </div>
      ))}
    </main>
  );
}

function PluginsPane() {
  return (
    <main className="xr-library-main" style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="xr-btn xr-btn--primary xr-btn--sm"><Icon.Plus width={12} height={12}/> Install plugin</button>
      </div>
      <p className="xr-dim" style={{ fontSize: 12, marginBottom: 14 }}>Plugins run in a sandboxed worker. Unsigned plugins are blocked by default; quarantined plugins crashed more than 3 times.</p>
      {PLUGINS.map(p => (
        <div key={p.id} className="xr-plugin-card">
          <div className="xr-plugin-icon"><Icon.Layers width={18} height={18}/></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name} <span className="xr-dim mono" style={{ fontSize: 11, marginLeft: 6 }}>v{p.version}</span></div>
            <div className="xr-dim" style={{ fontSize: 11.5, marginTop: 2 }}>{p.desc}</div>
          </div>
          <span className={"sandbox " + p.state}>{p.state === "sandboxed" ? "Sandboxed" : p.state === "unsigned" ? "Blocked" : "Quarantined"}</span>
          <label className="xr-toggle"><input type="checkbox" defaultChecked={p.state === "sandboxed"} disabled={p.state !== "sandboxed"}/><span/></label>
        </div>
      ))}
    </main>
  );
}

function IntegrationsPane() {
  return (
    <main className="xr-library-main">
      <div className="xr-cap-grid">
        {INTEGRATIONS.map(i => (
          <div key={i.id} className="xr-cap-card">
            <div className="cap-ic"><Icon.Plug width={18} height={18}/></div>
            <h4>{i.name}{i.connected && <span className="xr-pill xr-pill--low" style={{ marginLeft: 6 }}>Connected</span>}</h4>
            <p>{i.desc}</p>
            <div className="cap-meta"><span className="xr-pill">{i.kind}</span></div>
            <div style={{ marginTop: 10 }}>
              <button className={"xr-btn xr-btn--sm " + (i.connected ? "xr-btn--ghost" : "xr-btn--primary")}>
                {i.connected ? "Disconnect" : "Connect"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

function AutomationsPane() {
  const [triggers, setTriggers] = useState(TRIGGERS);
  return (
    <main className="xr-library-main" style={{ maxWidth: 780 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button className="xr-btn xr-btn--primary xr-btn--sm"><Icon.Plus width={12} height={12}/> New automation</button>
        <button className="xr-btn xr-btn--secondary xr-btn--sm" onClick={() => {
          setTriggers(ts => ts.map(t => ({ ...t, enabled: false })));
          pushToast("warn", "All automations paused", "Triggers will not fire until you resume them.");
        }}>Pause all</button>
        <span className="xr-dim" style={{ fontSize: 12, marginLeft: "auto" }}>{triggers.filter(t => t.enabled).length} of {triggers.length} active</span>
      </div>
      {triggers.map(t => (
        <div key={t.id} className="xr-trigger-row">
          <span className="when">{t.when}</span>
          <span className="what">{t.what}</span>
          <label className="xr-toggle"><input type="checkbox" checked={t.enabled} onChange={e => setTriggers(ts => ts.map(x => x.id === t.id ? { ...x, enabled: e.target.checked } : x))}/><span/></label>
        </div>
      ))}
    </main>
  );
}

function EmptyState({ title, desc, illust: _, action }: { title: string; desc: string; illust: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="xr-empty-state">
      <Icon.Search width={56} height={56} className="xr-empty-illust"/>
      <h3>{title}</h3>
      <p>{desc}</p>
      {action && <div className="actions"><button className="xr-btn xr-btn--primary xr-btn--sm" onClick={action.run}>{action.label}</button></div>}
    </div>
  );
}
