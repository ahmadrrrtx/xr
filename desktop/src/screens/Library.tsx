import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  api,
  asList,
  type McpServer,
  type PluginInfo,
  type ProviderInfo,
  type SkillInfo,
  type SkillInspect,
} from "../api/client";

const TABS = ["Skills", "MCP", "Plugins", "Models"] as const;
type Tab = (typeof TABS)[number];

function StatusDot({ ok, warn }: { ok?: boolean; warn?: boolean }) {
  return <span className={`dot ${ok ? "green" : warn ? "amber" : "red"}`} />;
}

/** Defensive label for engine report entries (objects with name/tool/id/scope or plain strings). */
function entryLabel(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const name = o.name ?? o.tool ?? o.id ?? o.kind ?? o.scope;
    if (name !== undefined) {
      const why = o.reason ?? o.description ?? o.detail;
      return why ? `${String(name)} — ${String(why).slice(0, 120)}` : String(name);
    }
    return JSON.stringify(v).slice(0, 140);
  }
  return String(v);
}

/** Short chip label for card footers (permission objects show their scope only). */
function permShort(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 22);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const s = o.scope ?? o.name ?? o.tool ?? o.id ?? o.kind;
    if (s !== undefined) return String(s).slice(0, 22);
  }
  return JSON.stringify(v).slice(0, 22);
}

function ReportList({ title, items, tone }: { title: string; items: unknown[]; tone?: "bad" | "warn" }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={`report-list ${tone ?? ""}`}>
      <div className="mono faint">{title} ({items.length})</div>
      <ul>{items.slice(0, 12).map((v, i) => <li key={i} className="mono">{entryLabel(v)}</li>)}</ul>
    </div>
  );
}

/** Phase 6 · category rail glyphs (icons only; category names come from engine data). */
const CAT_ICONS: Record<string, ReactNode> = {
  all: <path d="M4 6h16M4 12h16M4 18h16" />,
  research: <path d="M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l5 5" />,
  developer: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 6l-2 12" />,
  creative: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9z" />,
  security: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" />,
  business: <path d="M4 8h16v12H4zM9 8V5h6v3M4 13h16" />,
  writing: <path d="M5 19l1-4L16 5l3 3L9 18zM14 7l3 3" />,
  productivity: <path d="M12 7v5l3 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />,
  data: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
};

function catIcon(name: string): ReactNode {
  const key = name.toLowerCase();
  return CAT_ICONS[key] ?? CAT_ICONS.all;
}

export function Library({ onRun, initialQuery, onQueryConsumed }: { onRun?: (prompt: string) => void; initialQuery?: string | null; onQueryConsumed?: () => void }) {
  const [tab, setTab] = useState<Tab>("Skills");
  const [note, setNote] = useState<string | null>(null);
  // Phase 6 · mock 07: category rail + selection detail panel
  const [cat, setCat] = useState<string>("all");
  const [sel, setSel] = useState<SkillInfo | null>(null);

  // Models
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);

  // Skills — installed
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsHealth, setSkillsHealth] = useState<Record<string, unknown> | null>(null);
  const [skillQ, setSkillQ] = useState("");
  // Skills — inspect detail
  const [inspect, setInspect] = useState<{ id: string; data: SkillInspect | null; loading: boolean } | null>(null);
  // Skills — marketplace
  const [skillMode, setSkillMode] = useState<"installed" | "market">("installed");
  const [market, setMarket] = useState<Record<string, unknown> | null>(null);
  const [marketQ, setMarketQ] = useState("");
  const [marketLoading, setMarketLoading] = useState(false);

  // MCP
  const [servers, setServers] = useState<McpServer[]>([]);
  const [mcpForm, setMcpForm] = useState({ id: "", transport: "stdio", command: "", url: "" });

  // Plugins (+ permission grants editor)
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [pluginsSummary, setPluginsSummary] = useState<Record<string, unknown> | null>(null);
  const [grants, setGrants] = useState<Record<string, string[]>>({});

  const loadSkills = useCallback((q?: string) => {
    api.skills(q || undefined)
      .then((v) => { setSkills(v.skills ?? []); setSkillsHealth((v.health as Record<string, unknown>) ?? null); })
      .catch((e) => { setSkills([]); setNote(`skills: ${e}`); });
  }, []);

  // Global titlebar search lands here: Skills tab · installed view · engine-side query.
  useEffect(() => {
    if (!initialQuery) return;
    setTab("Skills");
    setSkillMode("installed");
    setSkillQ(initialQuery);
    loadSkills(initialQuery);
    onQueryConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const loadMarket = useCallback((q?: string) => {
    setMarketLoading(true);
    api.skillsMarketplace(q || undefined)
      .then((v) => setMarket(v))
      .catch((e) => { setMarket(null); setNote(`marketplace: ${e}`); })
      .finally(() => setMarketLoading(false));
  }, []);

  const loadMcp = useCallback(() => {
    api.mcpServers().then((v) => setServers(v.servers ?? [])).catch((e) => { setServers([]); setNote(`mcp: ${e}`); });
  }, []);

  const loadPlugins = useCallback(() => {
    api.plugins()
      .then((v) => {
        setPlugins(v.plugins ?? []);
        setPluginsSummary((v.summary as Record<string, unknown>) ?? null);
        setGrants(Object.fromEntries((v.plugins ?? []).map((p) => [p.id, (p.grantedPermissions ?? []).map(String)])));
      })
      .catch((e) => { setPlugins([]); setNote(`plugins: ${e}`); });
  }, []);

  useEffect(() => {
    setNote(null);
    if (tab === "Models") {
      api.providers().then((v) => {
        setProviders(asList<ProviderInfo>(v, "providers"));
        setActive(typeof (v as { active?: string }).active === "string" ? (v as { active: string }).active : null);
      }).catch(() => setProviders([]));
    } else if (tab === "Skills") {
      loadSkills();
      if (skillMode === "market") loadMarket();
    } else if (tab === "MCP") loadMcp();
    else if (tab === "Plugins") loadPlugins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, skillMode]);

  // Skills search is server-side (same unified index the CLI uses); debounce lightly.
  useEffect(() => {
    if (tab !== "Skills" || skillMode !== "installed") return;
    const t = setTimeout(() => loadSkills(skillQ.trim()), 250);
    return () => clearTimeout(t);
  }, [skillQ, tab, skillMode, loadSkills]);

  useEffect(() => {
    if (tab !== "Skills" || skillMode !== "market") return;
    const t = setTimeout(() => loadMarket(marketQ.trim()), 350);
    return () => clearTimeout(t);
  }, [marketQ, tab, skillMode, loadMarket]);

  const openInspect = (id: string) => {
    setInspect({ id, data: null, loading: true });
    api.skillInspect(id)
      .then((data) => setInspect({ id, data, loading: false }))
      .catch((e) => { setInspect(null); setNote(`inspect ${id}: ${e}`); });
  };

  const marketSkills = asList<SkillInfo>((market?.skills as SkillInfo[]) ?? [], "skills");
  const marketStats = (market?.stats ?? null) as Record<string, unknown> | null;
  const registries = asList<Record<string, unknown>>((market?.registries as Record<string, unknown>[]) ?? [], "registries");
  const updates = asList<Record<string, unknown>>((market?.updates as Record<string, unknown>[]) ?? [], "updates");

  // Phase 6: category rail derived from engine data; filtering is display-side only.
  const categories = [...new Set(skills.flatMap((s) => (s.categories ?? []).map(String)))].sort();
  const filtered = cat === "all" ? skills : skills.filter((s) => (s.categories ?? []).map(String).some((c) => c.toLowerCase() === cat.toLowerCase()));

  const renderDetail = () => {
    if (!sel) return null;
    const ins = inspect?.id === sel.id ? inspect.data : null;
    const isMarket = skillMode === "market";
    return (
      <aside className="detail-panel" aria-label="Skill detail">
        <div className="dp-head">
          <span className="dp-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{catIcon(String((sel.categories ?? [])[0] ?? "all"))}</svg></span>
          <div>
            <div className="dp-name">{sel.name ?? sel.id}
              {sel.verification === "official" && <span className="chip green tiny">official</span>}
            </div>
            <div className="mono faint">{sel.id} · v{String(sel.version ?? "?")}</div>
          </div>
          <button className="tab-x" style={{ marginLeft: "auto" }} onClick={() => { setSel(null); setInspect(null); }} aria-label="Close detail">×</button>
        </div>
        {sel.description && <p className="dp-desc">{String(sel.description)}</p>}

        <div className="dp-sec">
          <div className="dp-h">Provenance</div>
          <div className="dp-kv mono">
            <span>verification</span><b>{String(sel.verification ?? "unknown")}</b>
            <span>kind</span><b>{String(sel.kind ?? "skill")}</b>
            {sel.publisher !== undefined && <><span>publisher</span><b>{String(sel.publisher)}</b></>}
            <span>categories</span><b>{(sel.categories ?? []).map(String).join(", ") || "—"}</b>
          </div>
        </div>

        <div className="dp-sec">
          <div className="dp-h">Required permissions</div>
          {isMarket && <div className="faint mono">inspect available after install</div>}
          {!isMarket && inspect?.loading && <div className="faint mono">loading engine report…</div>}
          {!isMarket && !inspect?.loading && !ins && <div className="faint mono">open a skill to load its engine inspect report</div>}
          {ins && (
            <>
              <ReportList title="safe" items={ins.permissions?.safe ?? []} />
              <ReportList title="dangerous (approval-gated)" items={ins.permissions?.dangerous ?? []} tone="warn" />
              <ReportList title="MISSING approval gate" items={ins.permissions?.missingApproval ?? []} tone="bad" />
              {(ins.permissions?.safe ?? []).length === 0 && (ins.permissions?.dangerous ?? []).length === 0 && (ins.permissions?.missingApproval ?? []).length === 0 &&
                <div className="faint mono">no permissions declared</div>}
            </>
          )}
        </div>

        {ins && (
          <div className="dp-sec">
            <div className="dp-h">Prompts & capabilities</div>
            <div className="dp-kv mono">
              <span>commands</span><b>{Array.isArray(ins.skill?.commands) ? (ins.skill!.commands as unknown[]).length : 0}</b>
              <span>workflows</span><b>{Array.isArray(ins.skill?.workflows) ? (ins.skill!.workflows as unknown[]).length : 0}</b>
              <span>voice intents</span><b>{Array.isArray(ins.skill?.voiceIntents) ? (ins.skill!.voiceIntents as unknown[]).length : 0}</b>
              <span>dependencies</span><b>{ins.dependencies?.ok ? "ok" : "issues"}</b>
            </div>
            <ReportList title="required missing" items={ins.dependencies?.requiredMissing ?? []} tone="bad" />
            <ReportList title="warnings" items={(ins.skill?.warnings as unknown[]) ?? []} tone="warn" />
          </div>
        )}

        <div className="dp-actions">
          {isMarket ? (
            sel.installed
              ? <span className="chip green">installed</span>
              : (
                <button
                  className="btn primary wide"
                  onClick={() => api.skillInstall(sel.id, sel.source ? String(sel.source) : undefined)
                    .then((r) => { setNote(`install ${sel.id}: ${JSON.stringify(r).slice(0, 200)}`); loadSkills(); loadMarket(marketQ.trim()); })
                    .catch((e) => setNote(`install ${sel.id}: ${e}`))}
                >
                  Install from {String(sel.source ?? "registry")}
                </button>
              )
          ) : (
            <>
              <label className="toggle" title={sel.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}>
                <input
                  type="checkbox"
                  checked={!!sel.enabled}
                  onChange={() => api.skillSet(sel.id, !sel.enabled).then(() => { loadSkills(skillQ.trim()); setSel({ ...sel, enabled: !sel.enabled }); }).catch((e) => setNote(`${sel.id}: ${e}`))}
                />
                <i className="tk" aria-hidden="true" />
              </label>
              <button className="btn run" disabled={!sel.enabled} onClick={() => onRun?.(`Use the "${sel.name ?? sel.id}" skill to `)} title={sel.enabled ? "Seed a Work task with this skill" : "Enable the skill first"}>
                ▶ Run
              </button>
            </>
          )}
        </div>
      </aside>
    );
  };

  const scard = (s: SkillInfo, market: boolean) => (
    <button
      key={s.id}
      className={sel?.id === s.id ? "scard on" : "scard"}
      onClick={() => { setSel(s); if (!market) openInspect(s.id); else setInspect(null); }}
      aria-pressed={sel?.id === s.id}
    >
      <div className="sc-top">
        <span className="sc-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{catIcon(String((s.categories ?? [])[0] ?? "all"))}</svg></span>
        <span className="sc-name">{s.name ?? s.id}</span>
        {s.verification === "official" && <span className="chip green tiny">official</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <StatusDot ok={(s.enabled ?? true) && s.health !== "broken"} warn={s.enabled === false} />
          {!market && (
            <span
              className="toggle mini"
              role="switch"
              aria-checked={!!s.enabled}
              title={s.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
              onClick={(e) => {
                e.stopPropagation();
                api.skillSet(s.id, !s.enabled).then(() => loadSkills(skillQ.trim())).catch((ev) => setNote(`${s.id}: ${ev}`));
              }}
            >
              <i className={s.enabled ? "tk on" : "tk"} aria-hidden="true" />
            </span>
          )}
        </span>
      </div>
      {s.description && <div className="sc-desc">{String(s.description).slice(0, 120)}</div>}
      <div className="sc-foot mono faint">
        {Array.isArray(s.permissions) && s.permissions.length > 0
          ? s.permissions.slice(0, 2).map((p) => (
            <span key={JSON.stringify(p)} className="chip tiny" title={entryLabel(p)}>{permShort(p)}</span>
          ))
          : <span className="chip tiny">no declared permissions</span>}
        {market && s.installed ? <span className="chip green tiny">installed</span> : null}
        {market && s.updateAvailable ? <span className="chip amber tiny">update</span> : null}
      </div>
    </button>
  );

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
            <div className="seg" role="group" aria-label="Skills source">
              <button className={skillMode === "installed" ? "on" : ""} onClick={() => setSkillMode("installed")}>Installed</button>
              <button className={skillMode === "market" ? "on" : ""} onClick={() => setSkillMode("market")}>Marketplace</button>
            </div>
            {skillMode === "installed" ? (
              <>
                <input
                  className="mono"
                  placeholder="search skills (server-side unified index)"
                  value={skillQ}
                  onChange={(e) => setSkillQ(e.target.value)}
                />
                <span className="faint mono" style={{ whiteSpace: "nowrap" }}>
                  {skills.length} shown{skillsHealth && typeof skillsHealth.total === "number" ? ` · ${String(skillsHealth.total)} in registry` : ""}
                </span>
              </>
            ) : (
              <>
                <input
                  className="mono"
                  placeholder="search registries (online; empty = no registry configured / offline)"
                  value={marketQ}
                  onChange={(e) => setMarketQ(e.target.value)}
                />
                <button
                  className="btn"
                  onClick={() => api.skillsMarketplaceSync().then((r) => { setNote(`sync: ${JSON.stringify(r).slice(0, 200)}`); loadMarket(marketQ.trim()); }).catch((e) => setNote(`sync: ${e}`))}
                >
                  Sync registries
                </button>
              </>
            )}
          </div>

          {skillMode === "market" && market && (
            <div className="market-meta mono faint">
              {marketStats ? `installed ${String(marketStats.installed ?? 0)} · verified ${String(marketStats.verified ?? 0)} · updates ${String(marketStats.updates ?? 0)}` : ""}
              {registries.length > 0
                ? ` · registries: ${registries.map((r) => String(r.id ?? r.name ?? "?")).join(", ")}`
                : " · no registries configured (online search unavailable — honest empty)"}
            </div>
          )}

          {skillMode === "installed" && (
            <div className="lib-wrap">
              <nav className="cat-rail" aria-label="Skill categories">
                <button className={cat === "all" ? "cat on" : "cat"} onClick={() => setCat("all")}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">{catIcon("all")}</svg>
                  All
                </button>
                {categories.map((c) => (
                  <button key={c} className={cat === c ? "cat on" : "cat"} onClick={() => setCat(c)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">{catIcon(c)}</svg>
                    {c}
                  </button>
                ))}
              </nav>
              <div className="scard-grid">
                {filtered.map((s) => scard(s, false))}
                {filtered.length === 0 && (
                  <div className="empty">
                    {skills.length === 0
                      ? "No skills match — the bundled library loads from the engine's skill registry."
                      : `No skills in category "${cat}".`}
                  </div>
                )}
              </div>
              {renderDetail()}
            </div>
          )}

          {skillMode === "market" && (
            <div className="lib-wrap">
              <div className="scard-grid market-grid">
                {marketLoading && <div className="empty">querying registries…</div>}
                {!marketLoading && marketSkills.map((s) => scard(s, true))}
                {!marketLoading && marketSkills.length === 0 && (
                  <div className="empty">
                    Nothing online — registries are unreachable or none are configured. This is reported honestly, never faked.
                    {updates.length > 0 ? ` (${updates.length} pending updates from the last successful sync.)` : ""}
                  </div>
                )}
              </div>
              {renderDetail()}
            </div>
          )}
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
            Installed plugins — engine-owned sandbox status, permission grants, trust level.
            Installation is CLI-first (signed allowlist); this surface manages what is already installed.
            {pluginsSummary ? ` · summary: ${JSON.stringify(pluginsSummary).slice(0, 200)}` : ""}
          </p>
          <div className="cards">
            {plugins.map((p) => {
              const declared = (p.permissions ?? []).map(String);
              const granted = grants[p.id] ?? (p.grantedPermissions ?? []).map(String);
              const grantsDirty = JSON.stringify([...granted].sort()) !== JSON.stringify([...(p.grantedPermissions ?? []).map(String)].sort());
              return (
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
                  {declared.length > 0 && (
                    <div className="grants">
                      <div className="mono faint">permission grants (engine enforces; invalid scopes are filtered server-side)</div>
                      {declared.map((perm) => (
                        <label key={perm} className="mono grant">
                          <input
                            type="checkbox"
                            checked={granted.includes(perm)}
                            onChange={(e) =>
                              setGrants((g) => ({
                                ...g,
                                [p.id]: e.target.checked ? [...(g[p.id] ?? []), perm] : (g[p.id] ?? []).filter((x) => x !== perm),
                              }))
                            }
                          />
                          {perm}
                        </label>
                      ))}
                      {grantsDirty && (
                        <button
                          className="btn btn-accent"
                          style={{ marginTop: 6 }}
                          onClick={() => api.pluginPermissions(p.id, granted)
                            .then((r) => { setNote(`grants ${p.id}: ${JSON.stringify(r).slice(0, 200)}`); loadPlugins(); })
                            .catch((e) => setNote(`grants ${p.id}: ${e}`))}
                        >
                          Save grants
                        </button>
                      )}
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      className="btn"
                      onClick={() => api.pluginSet(p.id, !p.enabled).then(() => loadPlugins()).catch((e) => setNote(`${p.id}: ${e}`))}
                    >
                      {p.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </div>
              );
            })}
            {plugins.length === 0 && <div className="empty">No plugins installed — install via the CLI (signed allowlist enforced engine-side).</div>}
          </div>
        </>
      )}
    </div>
  );
}
