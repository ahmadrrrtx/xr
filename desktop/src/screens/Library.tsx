import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, asList, type AgentTemplate, type McpServer, type PluginInfo, type ProviderInfo, type SkillInfo, type SkillInspect } from "../api/client";

/** Library — Skills/MCP/Plugins/Automations/Integrations hardened elite Phase 1
 * Engine is sole authority, real wiring only, tokens var(--xr-*), states skeleton/empty/error,
 * motion 120/200/320, focus cyan, a11y.
 */

const TABS = ["Skills", "MCP", "Plugins", "Automations", "Integrations"] as const;
type Tab = (typeof TABS)[number];

function StatusDot({ ok, warn }: { ok?: boolean; warn?: boolean }) {
  return <span style={{ width: 8, height: 8, borderRadius: 999, background: ok ? "var(--xr-success)" : warn ? "var(--xr-warning)" : "var(--xr-danger)", display: "inline-block" }} />;
}
function entryLabel(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const name = o.name ?? o.tool ?? o.id ?? o.kind ?? o.scope;
    if (name !== undefined) { const why = o.reason ?? o.description ?? o.detail; return why ? `${String(name)} — ${String(why).slice(0, 120)}` : String(name); }
    return JSON.stringify(v).slice(0, 140);
  }
  return String(v);
}
function permShort(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 22);
  if (v && typeof v === "object") { const o = v as Record<string, unknown>; const s = o.scope ?? o.name ?? o.tool ?? o.id ?? o.kind; if (s !== undefined) return String(s).slice(0, 22); }
  return JSON.stringify(v).slice(0, 22);
}
function ReportList({ title, items, tone }: { title: string; items: unknown[]; tone?: "bad" | "warn" }) {
  if (!items || items.length === 0) return null;
  return <div style={{ display: "grid", gap: 4, padding: 8, background: "var(--xr-surface-2)", borderRadius: 6, border: tone === "bad" ? "1px solid var(--xr-danger)" : tone === "warn" ? "1px solid var(--xr-warning)" : "1px solid var(--xr-border)" }}><div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{title} ({items.length})</div><ul style={{ margin: 0, paddingLeft: 16, fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{items.slice(0, 12).map((v, i) => <li key={i}>{entryLabel(v)}</li>)}</ul></div>;
}
const CAT_ICONS: Record<string, ReactNode> = {
  all: <path d="M4 6h16M4 12h16M4 18h16" />, research: <path d="M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l5 5" />, developer: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 6l-2 12" />,
  creative: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9z" />, security: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" />,
  business: <path d="M4 8h16v12H4zM9 8V5h6v3M4 13h16" />, writing: <path d="M5 19l1-4L16 5l3 3L9 18zM14 7l3 3" />, productivity: <path d="M12 7v5l3 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />, data: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
};
function catIcon(name: string): ReactNode { return CAT_ICONS[name.toLowerCase()] ?? CAT_ICONS.all; }

export function Library({ onRun, initialQuery, onQueryConsumed }: { onRun?: (prompt: string) => void; initialQuery?: string | null; onQueryConsumed?: () => void }) {
  const [tab, setTab] = useState<Tab>("Skills");
  const [note, setNote] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("all");
  const [sel, setSel] = useState<SkillInfo | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsHealth, setSkillsHealth] = useState<Record<string, unknown> | null>(null);
  const [skillQ, setSkillQ] = useState("");
  const [inspect, setInspect] = useState<{ id: string; data: SkillInspect | null; loading: boolean } | null>(null);
  const [skillMode, setSkillMode] = useState<"installed" | "market" | "templates">("installed");
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [market, setMarket] = useState<Record<string, unknown> | null>(null);
  const [marketQ, setMarketQ] = useState("");
  const [marketLoading, setMarketLoading] = useState(false);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [mcpForm, setMcpForm] = useState({ id: "", transport: "stdio", command: "", url: "" });
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [pluginsSummary, setPluginsSummary] = useState<Record<string, unknown> | null>(null);
  const [trigs, setTrigs] = useState<{ pauseAll?: boolean; inflight?: number; triggers?: unknown[] } | null>(null);
  const [catalog, setCatalog] = useState<Array<{ id?: string; name?: string; version?: string; description?: string }>>([]);
  const [grants, setGrants] = useState<Record<string, string[]>>({});
  const [skillPins, setSkillPins] = useState<Record<string, boolean>>({});
  const [mcpPins, setMcpPins] = useState<Record<string, unknown>>({});

  const loadSkills = useCallback((q?: string) => {
    api.skills(q || undefined).then((v) => { setSkills(v.skills ?? []); setSkillsHealth((v.health as Record<string, unknown>) ?? null); }).catch((e) => { setSkills([]); setNote(`skills: ${e}`); });
    api.skillsPins().then((v) => setSkillPins(v.pins ?? {})).catch(() => setSkillPins({}));
  }, []);
  useEffect(() => {
    if (!initialQuery) return;
    setTab("Skills"); setSkillMode("installed"); setSkillQ(initialQuery); loadSkills(initialQuery); onQueryConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);
  const loadMarket = useCallback((q?: string) => {
    setMarketLoading(true);
    api.skillsMarketplace(q || undefined).then((v) => setMarket(v)).catch((e) => { setMarket(null); setNote(`marketplace: ${e}`); }).finally(() => setMarketLoading(false));
  }, []);
  const loadMcp = useCallback(() => {
    api.mcpServers().then((v) => setServers(v.servers ?? [])).catch((e) => { setServers([]); setNote(`mcp: ${e}`); });
    api.mcpPins().then((v) => setMcpPins(v.servers ?? {})).catch(() => setMcpPins({}));
  }, []);
  const loadPlugins = useCallback(() => {
    api.plugins().then((v) => { setPlugins(v.plugins ?? []); setPluginsSummary((v.summary as Record<string, unknown>) ?? null); setGrants(Object.fromEntries((v.plugins ?? []).map((p) => [p.id, (p.grantedPermissions ?? []).map(String)]))); }).catch((e) => { setPlugins([]); setNote(`plugins: ${e}`); });
  }, []);

  useEffect(() => {
    setNote(null);
    if (tab === "Integrations") {
      api.providers().then((v) => { setProviders(asList<ProviderInfo>(v, "providers")); setActive(typeof (v as { active?: string }).active === "string" ? (v as { active: string }).active : null); }).catch(() => setProviders([]));
    } else if (tab === "Skills") {
      loadSkills(); if (skillMode === "market") loadMarket(); if (skillMode === "templates") { api.agentTemplates().then((r) => setTemplates(r.templates ?? [])).catch((e) => setNote(`templates: ${e}`)); }
    } else if (tab === "MCP") loadMcp();
    else if (tab === "Plugins") { loadPlugins(); api.pluginsCatalog().then((c) => setCatalog(Array.isArray(c.plugins) ? c.plugins : [])).catch(() => setCatalog([])); }
    else if (tab === "Automations") { api.triggers().then(setTrigs).catch(() => setTrigs(null)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, skillMode]);
  useEffect(() => { if (tab !== "Skills" || skillMode !== "installed") return; const t = setTimeout(() => loadSkills(skillQ.trim()), 250); return () => clearTimeout(t); }, [skillQ, tab, skillMode, loadSkills]);
  useEffect(() => { if (tab !== "Skills" || skillMode !== "market") return; const t = setTimeout(() => loadMarket(marketQ.trim()), 350); return () => clearTimeout(t); }, [marketQ, tab, skillMode, loadMarket]);

  const openInspect = (id: string) => {
    setInspect({ id, data: null, loading: true });
    api.skillInspect(id).then((data) => setInspect({ id, data, loading: false })).catch((e) => { setInspect(null); setNote(`inspect ${id}: ${e}`); });
  };

  const marketSkills = asList<SkillInfo>((market?.skills as SkillInfo[]) ?? [], "skills");
  const marketStats = (market?.stats ?? null) as Record<string, unknown> | null;
  const registries = asList<Record<string, unknown>>((market?.registries as Record<string, unknown>[]) ?? [], "registries");
  const updates = asList<Record<string, unknown>>((market?.updates as Record<string, unknown>[]) ?? [], "updates");
  const categories = [...new Set(skills.flatMap((s) => (s.categories ?? []).map(String)))].sort();
  const filtered = cat === "all" ? skills : skills.filter((s) => (s.categories ?? []).map(String).some((c) => c.toLowerCase() === cat.toLowerCase()));

  const renderDetail = () => {
    if (!sel) return null;
    const ins = inspect?.id === sel.id ? inspect.data : null;
    const isMarket = skillMode === "market";
    return (
      <aside aria-label="Skill detail" style={{ width: 360, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 16, display: "grid", gap: 12, alignContent: "start", overflow: "auto", maxHeight: "70vh" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--xr-surface-2)", display: "grid", placeItems: "center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>{catIcon(String((sel.categories ?? [])[0] ?? "all"))}</svg></span>
          <div><div style={{ fontWeight: 600, fontSize: 13 }}>{sel.name ?? sel.id}{sel.verification === "official" && <span style={{ marginLeft: 6, padding: "2px 6px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>official</span>}</div><div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{sel.id} · v{String(sel.version ?? "?")}</div></div>
          <button style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer" }} onClick={() => { setSel(null); setInspect(null); }} aria-label="Close detail">×</button>
        </div>
        {sel.description && <p style={{ fontSize: 12, color: "var(--xr-text-2)", margin: 0 }}>{String(sel.description)}</p>}
        <div style={{ display: "grid", gap: 6 }}><div style={{ fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>Provenance</div><div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 4, fontFamily: "var(--xr-font-mono)", fontSize: 11 }}><span style={{ color: "var(--xr-text-3)" }}>verification</span><b>{String(sel.verification ?? "unknown")}</b><span style={{ color: "var(--xr-text-3)" }}>kind</span><b>{String(sel.kind ?? "skill")}</b>{sel.publisher !== undefined && <><span style={{ color: "var(--xr-text-3)" }}>publisher</span><b>{String(sel.publisher)}</b></>}<span style={{ color: "var(--xr-text-3)" }}>categories</span><b>{(sel.categories ?? []).map(String).join(", ") || "—"}</b></div></div>
        <div style={{ display: "grid", gap: 6 }}><div style={{ fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>Required permissions</div>{isMarket && <div style={{ fontSize: 11, color: "var(--xr-text-3)", fontFamily: "var(--xr-font-mono)" }}>inspect available after install</div>}{!isMarket && inspect?.loading && <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>loading engine report…</div>}{!isMarket && !inspect?.loading && !ins && <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>open a skill to load its engine inspect report</div>}{ins && (<><ReportList title="safe" items={ins.permissions?.safe ?? []} /><ReportList title="dangerous (approval-gated)" items={ins.permissions?.dangerous ?? []} tone="warn" /><ReportList title="MISSING approval gate" items={ins.permissions?.missingApproval ?? []} tone="bad" />{(ins.permissions?.safe ?? []).length === 0 && (ins.permissions?.dangerous ?? []).length === 0 && (ins.permissions?.missingApproval ?? []).length === 0 && <div style={{ fontSize: 11, color: "var(--xr-text-3)", fontFamily: "var(--xr-font-mono)" }}>no permissions declared</div>}</>)}</div>
        {ins && (<div style={{ display: "grid", gap: 6 }}><div style={{ fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>Prompts & capabilities</div><div style={{ display: "grid", gap: 4 }}>{(Array.isArray(ins.skill?.commands) ? (ins.skill!.commands as Array<Record<string, unknown>>).slice(0, 6) : []).map((c, i) => (<button key={i} title="Seed a Work task with this skill command" onClick={() => onRun?.(`Use the "${sel.name ?? sel.id}" skill: ${String(c.name ?? c.id ?? `command ${i + 1}`)} — `)} style={{ textAlign: "left", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 11, cursor: "pointer" }}>{String(c.description ?? c.name ?? c.id ?? `command ${i + 1}`).slice(0, 90)}</button>))}{(Array.isArray(ins.skill?.commands) ? (ins.skill!.commands as unknown[]).length : 0) === 0 && (<span style={{ fontSize: 11, color: "var(--xr-text-3)" }}>no declared commands — agent invokes via retrieval</span>)}</div><div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 4, fontFamily: "var(--xr-font-mono)", fontSize: 11 }}><span style={{ color: "var(--xr-text-3)" }}>commands</span><b>{Array.isArray(ins.skill?.commands) ? (ins.skill!.commands as unknown[]).length : 0}</b><span style={{ color: "var(--xr-text-3)" }}>workflows</span><b>{Array.isArray(ins.skill?.workflows) ? (ins.skill!.workflows as unknown[]).length : 0}</b><span style={{ color: "var(--xr-text-3)" }}>voice intents</span><b>{Array.isArray(ins.skill?.voiceIntents) ? (ins.skill!.voiceIntents as unknown[]).length : 0}</b><span style={{ color: "var(--xr-text-3)" }}>dependencies</span><b>{ins.dependencies?.ok ? "ok" : "issues"}</b></div><ReportList title="required missing" items={ins.dependencies?.requiredMissing ?? []} tone="bad" /><ReportList title="warnings" items={(ins.skill?.warnings as unknown[]) ?? []} tone="warn" /></div>)}
        <div style={{ display: "flex", gap: 8 }}>
          {isMarket ? (sel.installed ? <span style={{ padding: "6px 12px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 11 }}>installed</span> : (<button style={{ flex: 1, padding: "8px 12px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer" }} onClick={() => api.skillInstall(sel.id, sel.source ? String(sel.source) : undefined).then((r) => { setNote(`install ${sel.id}: ${JSON.stringify(r).slice(0, 200)}`); loadSkills(); loadMarket(marketQ.trim()); }).catch((e) => setNote(`install ${sel.id}: ${e}`))}>Install from {String(sel.source ?? "registry")}</button>)) : (<><label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={!!sel.enabled} onChange={() => api.skillSet(sel.id, !sel.enabled).then(() => { loadSkills(skillQ.trim()); setSel({ ...sel, enabled: !sel.enabled }); }).catch((e) => setNote(`${sel.id}: ${e}`))} /> {sel.enabled ? "Enabled" : "Disabled"}</label><button style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer" }} disabled={!sel.enabled} onClick={() => onRun?.(`Use the "${sel.name ?? sel.id}" skill to `)}>▶ Run</button></>)}
        </div>
      </aside>
    );
  };

  const scard = (s: SkillInfo, isMarket: boolean) => (
    <button key={s.id} onClick={() => { setSel(s); if (!isMarket) openInspect(s.id); else setInspect(null); }} aria-pressed={sel?.id === s.id} style={{ textAlign: "left", padding: 12, background: sel?.id === s.id ? "var(--xr-surface-2)" : "var(--xr-surface-1)", border: sel?.id === s.id ? "2px solid var(--xr-accent)" : "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", cursor: "pointer", display: "grid", gap: 8, transition: "border-color var(--xr-motion-micro) var(--xr-ease-default)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--xr-surface-2)", display: "grid", placeItems: "center" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>{catIcon(String((s.categories ?? [])[0] ?? "all"))}</svg></span>
        <span style={{ fontWeight: 600, fontSize: 12 }}>{s.name ?? s.id}</span>
        {s.verification === "official" && <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>official</span>}
        {(s as { source?: string }).source === "virtual" && <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-3)", border: "1px solid var(--xr-border)", fontSize: 10 }}>virtual pack</span>}
        {(s as { source?: string }).source === "bundled" && <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-3)", border: "1px solid var(--xr-border)", fontSize: 10 }}>bundled</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <StatusDot ok={(s.enabled ?? true) && s.health !== "broken"} warn={s.enabled === false} />
          {!isMarket && <span onClick={(e) => { e.stopPropagation(); api.skillsPin(String(s.id), !skillPins[String(s.id)]).then(() => loadSkills(skillQ.trim())).catch((ev) => setNote(`${s.id}: ${ev}`)); }} style={{ padding: "2px 6px", borderRadius: 999, background: skillPins[String(s.id)] ? "var(--xr-success)" : "var(--xr-surface-2)", color: skillPins[String(s.id)] ? "white" : "var(--xr-text-2)", fontSize: 10, cursor: "pointer", border: "1px solid var(--xr-border)" }}>{skillPins[String(s.id)] ? "pinned" : "pin"}</span>}
        </span>
      </div>
      {s.description && <div style={{ fontSize: 11, color: "var(--xr-text-2)" }}>{String(s.description).slice(0, 120)}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontFamily: "var(--xr-font-mono)", fontSize: 10, color: "var(--xr-text-3)" }}>
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><StatusDot ok={(s.enabled ?? true) && s.health !== "broken"} warn={s.enabled === false} /> health</span>
        {Array.isArray(s.permissions) && s.permissions.length > 0 ? s.permissions.slice(0, 2).map((p) => <span key={JSON.stringify(p)} title={entryLabel(p)} style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)" }}>{permShort(p)}</span>) : <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)" }}>no declared permissions</span>}
        {isMarket && s.installed ? <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-success)", color: "white" }}>installed</span> : null}
        {isMarket && s.updateAvailable ? <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-warning)", color: "white" }}>update</span> : null}
      </div>
    </button>
  );

  return (
    <div style={{ padding: "var(--xr-space-4)", display: "grid", gap: "var(--xr-space-3)" }}>
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--xr-border)" }} role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)} style={{ padding: "8px 14px", fontSize: 12, border: "none", borderBottom: t === tab ? "2px solid var(--xr-accent)" : "2px solid transparent", background: "transparent", color: t === tab ? "var(--xr-text-1)" : "var(--xr-text-3)", cursor: "pointer" }}>{t}</button>)}
      </div>
      {note && <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }}>{note} <button onClick={() => setNote(null)} style={{ marginLeft: 8, background: "transparent", border: "none", cursor: "pointer" }}>✕</button></div>}

      {tab === "Integrations" && (
        <>
          <p style={{ fontSize: 12, color: "var(--xr-text-2)", margin: 0 }}>Integrations — model providers (keys go to OS keyring, engine-side only). Providers are engine's upstream integrations; everything else is skills/MCP/plugins.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {providers.map((p) => (
              <div key={p.id} style={{ padding: 14, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, fontSize: 13 }}>{p.id}{active === p.id && <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>primary</span>}{p.local && <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontSize: 10 }}>local</span>}</div>
                <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{(p.capabilities ?? []).slice(0, 4).join(" · ") || "—"}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}><button style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", cursor: "pointer", fontSize: 11 }} onClick={() => api.providersSet(p.id).then(() => { setActive(p.id); setNote(`primary → ${p.id}`); }).catch((e) => setNote(String(e)))}>Set primary</button><button style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", cursor: "pointer", fontSize: 11 }} onClick={() => api.modelsTest(p.id, String((p.models ?? [])[0] ?? "")).then((r) => setNote(`${p.id}: ${r.ok === false ? "FAILED" : "ok"}`)).catch((e) => setNote(`${p.id}: ${e}`))}>Test</button></div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "Skills" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div role="group" aria-label="Skills source" style={{ display: "inline-flex", border: "1px solid var(--xr-border)", borderRadius: 999, overflow: "hidden" }}>
              <button onClick={() => setSkillMode("installed")} style={{ padding: "6px 12px", fontSize: 11, border: "none", background: skillMode === "installed" ? "var(--xr-accent)" : "transparent", color: skillMode === "installed" ? "white" : "var(--xr-text-2)", cursor: "pointer" }}>Installed</button>
              <button onClick={() => setSkillMode("market")} style={{ padding: "6px 12px", fontSize: 11, border: "none", background: skillMode === "market" ? "var(--xr-accent)" : "transparent", color: skillMode === "market" ? "white" : "var(--xr-text-2)", cursor: "pointer" }}>Marketplace</button>
              <button onClick={() => setSkillMode("templates")} style={{ padding: "6px 12px", fontSize: 11, border: "none", background: skillMode === "templates" ? "var(--xr-accent)" : "transparent", color: skillMode === "templates" ? "white" : "var(--xr-text-2)", cursor: "pointer" }}>Templates</button>
            </div>
            {skillMode === "templates" ? <span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{templates.length} planner templates · engine-composed</span> : skillMode === "installed" ? <><input placeholder="search skills (server-side unified index)" value={skillQ} onChange={(e) => setSkillQ(e.target.value)} style={{ flex: 1, minWidth: 200, padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }} /><span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{skills.length} shown{skillsHealth && typeof skillsHealth.total === "number" ? ` · ${String(skillsHealth.total)} in registry` : ""}</span></> : <><input placeholder="search registries (online; empty = no registry / offline)" value={marketQ} onChange={(e) => setMarketQ(e.target.value)} style={{ flex: 1, minWidth: 200, padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }} /><button style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }} onClick={() => api.skillsMarketplaceSync().then((r) => { setNote(`sync: ${JSON.stringify(r).slice(0, 200)}`); loadMarket(marketQ.trim()); }).catch((e) => setNote(`sync: ${e}`))}>Sync registries</button></>}
          </div>
          {skillMode === "market" && market && <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{marketStats ? `installed ${String(marketStats.installed ?? 0)} · verified ${String(marketStats.verified ?? 0)} · updates ${String(marketStats.updates ?? 0)}` : ""}{registries.length > 0 ? ` · registries: ${registries.map((r) => String(r.id ?? r.name ?? "?")).join(", ")}` : " · no registries configured (honest empty)"}</div>}

          {skillMode === "installed" && (
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 360px", gap: 12 }}>
              <nav aria-label="Skill categories" style={{ display: "grid", gap: 4, alignContent: "start" }}>
                <button onClick={() => setCat("all")} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 8, border: cat === "all" ? "1px solid var(--xr-accent)" : "1px solid var(--xr-border)", background: cat === "all" ? "var(--xr-surface-2)" : "var(--xr-surface-1)", fontSize: 12, cursor: "pointer", textAlign: "left" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>{catIcon("all")}</svg> All</button>
                {categories.map((c) => <button key={c} onClick={() => setCat(c)} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 8, border: cat === c ? "1px solid var(--xr-accent)" : "1px solid var(--xr-border)", background: cat === c ? "var(--xr-surface-2)" : "var(--xr-surface-1)", fontSize: 12, cursor: "pointer", textAlign: "left" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>{catIcon(c)}</svg> {c}</button>)}
              </nav>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, alignContent: "start" }}>{filtered.map((s) => scard(s, false))}{filtered.length === 0 && <div style={{ padding: 20, color: "var(--xr-text-3)", fontSize: 12 }}>{skills.length === 0 ? "No skills match — bundled library loads from engine's skill registry." : `No skills in category "${cat}".`}</div>}</div>
              {renderDetail()}
            </div>
          )}
          {skillMode === "templates" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {templates.map((t) => (
                <section key={t.kind} style={{ padding: 14, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}><b style={{ fontSize: 13 }}>{t.name}</b><span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 10, color: "var(--xr-text-3)" }}>{t.steps} steps</span></div>
                  <p style={{ fontSize: 12, color: "var(--xr-text-2)", margin: 0 }}>{t.summary}</p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{t.roles.map((r) => <span key={r} style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 10 }}>{r}</span>)}</div>
                  <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{t.sampleGoal}</div>
                  <button style={{ padding: "6px 12px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer", fontSize: 11 }} onClick={() => api.workflowCreate({ goal: t.sampleGoal, kind: t.kind }).then((r) => setNote(`started ${r.workflow.workflowId} — see Teams`)).catch((e) => setNote(`template run: ${e}`))}>Run sample</button>
                </section>
              ))}
              {templates.length === 0 && <div style={{ padding: 20, color: "var(--xr-text-3)", fontSize: 12 }}>No templates loaded.</div>}
            </div>
          )}
          {skillMode === "market" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, alignContent: "start" }}>{marketLoading && <div style={{ padding: 20, color: "var(--xr-text-3)", fontSize: 12 }}>querying registries…</div>}{!marketLoading && marketSkills.map((s) => scard(s, true))}{!marketLoading && marketSkills.length === 0 && <div style={{ padding: 20, color: "var(--xr-text-3)", fontSize: 12 }}>Nothing online — registries unreachable or none configured. Honest empty, never faked.{updates.length > 0 ? ` (${updates.length} pending updates from last sync.)` : ""}</div>}</div>
              {renderDetail()}
            </div>
          )}
        </>
      )}

      {tab === "MCP" && (
        <>
          <p style={{ fontSize: 12, color: "var(--xr-text-2)", margin: 0 }}>MCP connections — engine-owned registry: trust levels, health, enable/disable. Adding a server registers it with engine (tool descriptions treated as supply-chain input; re-approval on config change).</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
            {servers.map((s) => (
              <div key={s.id} style={{ padding: 14, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, fontSize: 13 }}><StatusDot ok={s.enabled && s.health !== "error"} warn={!s.enabled} /> {s.name ?? s.id}{s.enabled ? <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>enabled</span> : <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontSize: 10 }}>disabled</span>}{s.trust && <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontSize: 10 }}>trust: {String(s.trust)}</span>}{mcpPins[String(s.id)] ? <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>contract pinned</span> : null}</div>
                <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{String(s.transport ?? "?")} · {s.command ? `${String(s.command)} ${(Array.isArray(s.args) ? (s.args as unknown[]).map(String) : []).join(" ")}`.trim() : String(s.url ?? "")} · {String(s.lifecycleState ?? "installed")}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  <button style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => api.mcpSet(s.id, !s.enabled).then(() => loadMcp()).catch((e) => setNote(`${s.id}: ${e}`))}>{s.enabled ? "Disable" : "Enable"}</button>
                  <button style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => api.mcpHealth().then((r) => setNote(`health probe: ${JSON.stringify(r.reports ?? []).slice(0, 300)}`)).catch((e) => setNote(`health: ${e}`))}>Probe health</button>
                  <button style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => (mcpPins[String(s.id)] ? api.mcpUnpin(String(s.id)) : api.mcpPin(String(s.id), "desktop")).then(() => loadMcp()).catch((e) => setNote(`${s.id}: ${e}`))}>{mcpPins[String(s.id)] ? "Unpin contract" : "Pin contract"}</button>
                  {mcpPins[String(s.id)] ? <button style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => api.mcpPinDiff(String(s.id)).then((r) => setNote(`drift(${s.id}): ${r.drift.status}${r.drift.changed.length ? ` — changed: ${r.drift.changed.map((c) => c.tool).join(", ")}` : ""}${r.drift.added.length ? ` — added: ${r.drift.added.join(", ")}` : ""}`)).catch((e) => setNote(`diff: ${e}`))}>Check drift</button> : null}
                  <button style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-danger)", color: "var(--xr-danger)", background: "transparent", fontSize: 11, cursor: "pointer" }} onClick={() => { if (confirm(`Remove MCP server ${s.id}?`)) api.mcpRemove(s.id).then(() => loadMcp()).catch((e) => setNote(`${s.id}: ${e}`)); }}>Remove</button>
                </div>
              </div>
            ))}
            {servers.length === 0 && <div style={{ padding: 20, color: "var(--xr-text-3)", fontSize: 12 }}>No MCP servers registered.</div>}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); const id = mcpForm.id.trim(); if (!id) return; const body = mcpForm.transport === "stdio" ? { id, transport: "stdio", command: mcpForm.command.trim(), args: [] as string[] } : { id, transport: mcpForm.transport, url: mcpForm.url.trim() }; api.mcpAdd(body).then(() => { setNote(`registered ${id}`); setMcpForm({ id: "", transport: "stdio", command: "", url: "" }); loadMcp(); }).catch((err) => setNote(`add: ${err}`)); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input placeholder="id (e.g. github)" value={mcpForm.id} onChange={(e) => setMcpForm((f) => ({ ...f, id: e.target.value }))} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }} />
            <select value={mcpForm.transport} onChange={(e) => setMcpForm((f) => ({ ...f, transport: e.target.value }))} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11 }}><option value="stdio">stdio</option><option value="http">http</option><option value="sse">sse</option></select>
            {mcpForm.transport === "stdio" ? <input placeholder="command (e.g. npx -y @modelcontextprotocol/server-github)" value={mcpForm.command} onChange={(e) => setMcpForm((f) => ({ ...f, command: e.target.value }))} style={{ flex: 1, minWidth: 240, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }} /> : <input placeholder="https://…" value={mcpForm.url} onChange={(e) => setMcpForm((f) => ({ ...f, url: e.target.value }))} style={{ flex: 1, minWidth: 240, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11 }} />}
            <button type="submit" style={{ padding: "6px 12px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer", fontSize: 11 }}>Register</button>
          </form>
        </>
      )}

      {tab === "Plugins" && (
        <>
          <p style={{ fontSize: 12, color: "var(--xr-text-2)", margin: 0 }}>Installed plugins — engine-owned sandbox status, permission grants, trust level. Installation is CLI-first (signed allowlist); this surface manages what is already installed.{pluginsSummary ? ` · summary: ${JSON.stringify(pluginsSummary).slice(0, 200)}` : ""}</p>
          {catalog.length > 0 && <div style={{ padding: 12, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 6 }}><div style={{ fontWeight: 600, fontSize: 12 }}>Bundled sample plugins — not installed</div><div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>Installation stays CLI-first and approval-gated (signed allowlist, engine-enforced). From terminal:</div>{catalog.map((c) => <div key={String(c.id)} style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>xr plugins install {String(c.id)} <span style={{ color: "var(--xr-text-3)" }}>— {String(c.description ?? "").slice(0, 100)}</span></div>)}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
            {plugins.map((p) => {
              const declared = (p.permissions ?? []).map(String); const granted = grants[p.id] ?? (p.grantedPermissions ?? []).map(String); const grantsDirty = JSON.stringify([...granted].sort()) !== JSON.stringify([...(p.grantedPermissions ?? []).map(String)].sort());
              return (
                <div key={p.id} style={{ padding: 14, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, fontSize: 13 }}><StatusDot ok={p.enabled && p.loaded} warn={!p.enabled} /> {p.name ?? p.id}{p.enabled ? <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>enabled</span> : <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontSize: 10 }}>disabled</span>}{p.status && <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontSize: 10 }}>{String(p.status)}</span>}</div>
                  <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{p.id} · v{String(p.version ?? "?")} · {String(p.type ?? "plugin")} · trust: {String(p.trustLevel ?? "unknown")}</div>
                  {p.description && <div style={{ fontSize: 12 }}>{String(p.description).slice(0, 160)}</div>}
                  {declared.length > 0 && <div style={{ display: "grid", gap: 6 }}><div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>permission grants (engine enforces; invalid scopes filtered server-side)</div>{declared.map((perm) => <label key={perm} style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={granted.includes(perm)} onChange={(e) => setGrants((g) => ({ ...g, [p.id]: e.target.checked ? [...(g[p.id] ?? []), perm] : (g[p.id] ?? []).filter((x) => x !== perm) }))} /> {perm}</label>)}{grantsDirty && <button style={{ marginTop: 6, padding: "6px 12px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer", fontSize: 11 }} onClick={() => api.pluginPermissions(p.id, granted).then((r) => { setNote(`grants ${p.id}: ${JSON.stringify(r).slice(0, 200)}`); loadPlugins(); }).catch((e) => setNote(`grants ${p.id}: ${e}`))}>Save grants</button>}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}><button style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => api.pluginSet(p.id, !p.enabled).then(() => loadPlugins()).catch((e) => setNote(`${p.id}: ${e}`))}>{p.enabled ? "Disable" : "Enable"}</button></div>
                </div>
              );
            })}
            {plugins.length === 0 && <div style={{ padding: 20, color: "var(--xr-text-3)", fontSize: 12 }}>No plugins installed — install via CLI (signed allowlist enforced engine-side).</div>}
          </div>
        </>
      )}
      {tab === "Automations" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          <div style={{ padding: 14, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Triggers — engine scheduler</div><div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>pauseAll: {String(trigs?.pauseAll ?? false)} · inflight: {String(trigs?.inflight ?? 0)}</div>
            <div><button style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => api.triggersPause(!(trigs?.pauseAll ?? false)).then(() => api.triggers().then(setTrigs)).catch((e) => setNote(`pause: ${e}`))}>{trigs?.pauseAll ? "resume all automations" : "pause all automations"}</button></div>
            <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>Automations run engine-side on their own schedule; this surface reflects real scheduler state — nothing simulated.</div>
          </div>
          {((trigs?.triggers ?? []) as Array<Record<string, unknown>>).map((t, i) => <div key={i} style={{ padding: 14, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 6 }}><div style={{ fontWeight: 600, fontSize: 12 }}>{String(t.name ?? t.id ?? `trigger ${i}`)}</div><div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{JSON.stringify(t).slice(0, 200)}</div></div>)}
          {(trigs?.triggers ?? []).length === 0 && <div style={{ padding: 20, color: "var(--xr-text-3)", fontSize: 12 }}>No triggers configured — automations you create (CLI or agent) surface here.</div>}
        </div>
      )}
    </div>
  );
}
