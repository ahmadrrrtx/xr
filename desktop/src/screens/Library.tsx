import { useCallback, useEffect, useState } from "react";
import { api, asList, type McpServer, type PluginInfo, type ProviderInfo, type SkillInfo } from "../api/client";

const TABS = ["Skills", "MCP", "Plugins", "Models"] as const;
type Tab = (typeof TABS)[number];

function StatusDot({ ok, warn }: { ok?: boolean; warn?: boolean }) {
  return <span className={`dot ${ok ? "green" : warn ? "amber" : "red"}`} />;
}

export function Library() {
  const [tab, setTab] = useState<Tab>("Models");
  const [note, setNote] = useState<string | null>(null);

  // Models
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);

  // Skills
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsHealth, setSkillsHealth] = useState<Record<string, unknown> | null>(null);
  const [skillQ, setSkillQ] = useState("");

  // MCP
  const [servers, setServers] = useState<McpServer[]>([]);
  const [mcpForm, setMcpForm] = useState({ id: "", transport: "stdio", command: "", url: "" });

  // Plugins
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [pluginsSummary, setPluginsSummary] = useState<Record<string, unknown> | null>(null);

  const loadSkills = useCallback((q?: string) => {
    api.skills(q || undefined)
      .then((v) => { setSkills(v.skills ?? []); setSkillsHealth((v.health as Record<string, unknown>) ?? null); })
      .catch((e) => { setSkills([]); setNote(`skills: ${e}`); });
  }, []);

  const loadMcp = useCallback(() => {
    api.mcpServers().then((v) => setServers(v.servers ?? [])).catch((e) => { setServers([]); setNote(`mcp: ${e}`); });
  }, []);

  const loadPlugins = useCallback(() => {
    api.plugins()
      .then((v) => { setPlugins(v.plugins ?? []); setPluginsSummary((v.summary as Record<string, unknown>) ?? null); })
      .catch((e) => { setPlugins([]); setNote(`plugins: ${e}`); });
  }, []);

  useEffect(() => {
    setNote(null);
    if (tab === "Models") {
      api.providers().then((v) => {
        setProviders(asList<ProviderInfo>(v, "providers"));
        setActive(typeof (v as { active?: string }).active === "string" ? (v as { active: string }).active : null);
      }).catch(() => setProviders([]));
    } else if (tab === "Skills") loadSkills();
    else if (tab === "MCP") loadMcp();
    else if (tab === "Plugins") loadPlugins();
  }, [tab, loadSkills, loadMcp, loadPlugins]);

  // Skills search is server-side (same unified index the CLI uses); debounce lightly.
  useEffect(() => {
    if (tab !== "Skills") return;
    const t = setTimeout(() => loadSkills(skillQ.trim()), 250);
    return () => clearTimeout(t);
  }, [skillQ, tab, loadSkills]);

  return (
    <div className="lib">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {note && <div className="errline mono" style={{ borderColor: "var(--xr-border)", marginBottom: 10 }}>{note}</div>}

      {tab === "Models" && (
        <>
          <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
            Model Center — connect providers, test models, set primary. Keys go to the OS keyring (engine-side only).
          </p>
          <div className="cards">
            {providers.map((p) => (
              <div key={p.id} className="card prov">
                <div className="t">
                  {p.id}
                  {active === p.id && <span className="chip green">primary</span>}
                  {p.local && <span className="chip">local</span>}
                </div>
                <div className="meta mono faint">{(p.capabilities ?? []).slice(0, 4).join(" · ") || "—"}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="btn"
                    onClick={() => api.providersSet(p.id).then(() => { setActive(p.id); setNote(`primary → ${p.id}`); }).catch((e) => setNote(String(e)))}
                  >
                    Set primary
                  </button>
                  <button
                    className="btn"
                    onClick={() => api.modelsTest(p.id, String((p.models ?? [])[0] ?? "")).then((r) => setNote(`${p.id}: ${r.ok === false ? "FAILED" : "ok"}`)).catch((e) => setNote(`${p.id}: ${e}`))}
                  >
                    Test
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "Skills" && (
        <>
          <div className="lib-bar">
            <input
              className="mono"
              placeholder="search skills (server-side unified index)"
              value={skillQ}
              onChange={(e) => setSkillQ(e.target.value)}
            />
            <span className="faint mono" style={{ whiteSpace: "nowrap" }}>
              {skills.length} shown{skillsHealth && typeof skillsHealth.loaded === "number" ? ` · ${String(skillsHealth.loaded)} loaded` : ""}
            </span>
          </div>
          <div className="cards">
            {skills.map((s) => (
              <div key={s.id} className="card prov">
                <div className="t">
                  <StatusDot ok={s.enabled && s.health !== "broken"} warn={!s.enabled} />
                  {" "}{s.name ?? s.id}
                  {s.enabled ? <span className="chip green">enabled</span> : <span className="chip">disabled</span>}
                  {s.verification && s.verification !== "unknown" && <span className="chip">{String(s.verification)}</span>}
                </div>
                <div className="meta mono faint">
                  {s.id} · v{String(s.version ?? "?")} · {String(s.kind ?? "skill")}
                  {Array.isArray(s.categories) && s.categories.length > 0 ? ` · ${s.categories.slice(0, 2).join(", ")}` : ""}
                </div>
                {s.description && <div className="meta" style={{ fontSize: 12 }}>{String(s.description).slice(0, 160)}</div>}
                {Array.isArray(s.permissions) && s.permissions.length > 0 && (
                  <div className="meta mono faint" style={{ fontSize: 11 }}>perms: {s.permissions.slice(0, 5).map((p) => String(typeof p === "object" && p ? (p as { name?: string }).name ?? JSON.stringify(p) : p)).join(", ")}</div>
                )}
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="btn"
                    onClick={() => api.skillSet(s.id, !s.enabled).then(() => loadSkills(skillQ.trim())).catch((e) => setNote(`${s.id}: ${e}`))}
                  >
                    {s.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            ))}
            {skills.length === 0 && <div className="empty">No skills match — the bundled library loads from the engine's skill registry.</div>}
          </div>
        </>
      )}

      {tab === "MCP" && (
        <>
          <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
            MCP connections — engine-owned registry: trust levels, health, enable/disable. Adding a server registers it
            with the engine (tool descriptions are treated as supply-chain input; re-approval applies on config change).
          </p>
          <div className="cards">
            {servers.map((s) => (
              <div key={s.id} className="card prov">
                <div className="t">
                  <StatusDot ok={s.enabled && s.health !== "error"} warn={!s.enabled} />
                  {" "}{s.name ?? s.id}
                  {s.enabled ? <span className="chip green">enabled</span> : <span className="chip">disabled</span>}
                  {s.trust && <span className="chip">trust: {String(s.trust)}</span>}
                </div>
                <div className="meta mono faint">
                  {String(s.transport ?? "?")} · {s.command ? `${String(s.command)} ${(Array.isArray(s.args) ? (s.args as unknown[]).map(String) : []).join(" ")}`.trim() : String(s.url ?? "")} · {String(s.lifecycleState ?? "installed")}
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="btn"
                    onClick={() => api.mcpSet(s.id, !s.enabled).then(() => loadMcp()).catch((e) => setNote(`${s.id}: ${e}`))}
                  >
                    {s.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="btn"
                    onClick={() => api.mcpHealth().then((r) => setNote(`health probe: ${JSON.stringify(r.reports ?? []).slice(0, 300)}`)).catch((e) => setNote(`health: ${e}`))}
                  >
                    Probe health
                  </button>
                  <button
                    className="btn btn-bad"
                    onClick={() => { if (confirm(`Remove MCP server ${s.id}?`)) api.mcpRemove(s.id).then(() => loadMcp()).catch((e) => setNote(`${s.id}: ${e}`)); }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {servers.length === 0 && <div className="empty">No MCP servers registered.</div>}
          </div>
          <form
            className="mcp-add"
            onSubmit={(e) => {
              e.preventDefault();
              const id = mcpForm.id.trim();
              if (!id) return;
              const body = mcpForm.transport === "stdio"
                ? { id, transport: "stdio", command: mcpForm.command.trim(), args: [] as string[] }
                : { id, transport: mcpForm.transport, url: mcpForm.url.trim() };
              api.mcpAdd(body).then(() => { setNote(`registered ${id}`); setMcpForm({ id: "", transport: "stdio", command: "", url: "" }); loadMcp(); }).catch((err) => setNote(`add: ${err}`));
            }}
          >
            <input className="mono" placeholder="id (e.g. github)" value={mcpForm.id} onChange={(e) => setMcpForm((f) => ({ ...f, id: e.target.value }))} />
            <select className="mono" value={mcpForm.transport} onChange={(e) => setMcpForm((f) => ({ ...f, transport: e.target.value }))}>
              <option value="stdio">stdio</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </select>
            {mcpForm.transport === "stdio" ? (
              <input className="mono" placeholder="command (e.g. npx -y @modelcontextprotocol/server-github)" value={mcpForm.command} onChange={(e) => setMcpForm((f) => ({ ...f, command: e.target.value }))} />
            ) : (
              <input className="mono" placeholder="https://…" value={mcpForm.url} onChange={(e) => setMcpForm((f) => ({ ...f, url: e.target.value }))} />
            )}
            <button className="btn btn-accent" type="submit">Register</button>
          </form>
        </>
      )}

      {tab === "Plugins" && (
        <>
          <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
            Installed plugins — engine-owned sandbox status, permissions vs granted permissions, trust level.
            Installation is CLI-first (signed allowlist); this surface manages what is already installed.
            {pluginsSummary ? ` · summary: ${JSON.stringify(pluginsSummary).slice(0, 200)}` : ""}
          </p>
          <div className="cards">
            {plugins.map((p) => (
              <div key={p.id} className="card prov">
                <div className="t">
                  <StatusDot ok={p.enabled && p.loaded} warn={!p.enabled} />
                  {" "}{p.name ?? p.id}
                  {p.enabled ? <span className="chip green">enabled</span> : <span className="chip">disabled</span>}
                  {p.status && <span className="chip">{String(p.status)}</span>}
                </div>
                <div className="meta mono faint">
                  {p.id} · v{String(p.version ?? "?")} · {String(p.type ?? "plugin")} · trust: {String(p.trustLevel ?? "unknown")}
                </div>
                {p.description && <div className="meta" style={{ fontSize: 12 }}>{String(p.description).slice(0, 160)}</div>}
                {p.detail && <div className="meta mono faint" style={{ fontSize: 11 }}>{String(p.detail).slice(0, 160)}</div>}
                <div className="meta mono faint" style={{ fontSize: 11 }}>
                  perms: {(p.permissions ?? []).length} declared · {(p.grantedPermissions ?? []).length} granted
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="btn"
                    onClick={() => api.pluginSet(p.id, !p.enabled).then(() => loadPlugins()).catch((e) => setNote(`${p.id}: ${e}`))}
                  >
                    {p.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            ))}
            {plugins.length === 0 && <div className="empty">No plugins installed — install via the CLI (signed allowlist enforced engine-side).</div>}
          </div>
        </>
      )}
    </div>
  );
}
