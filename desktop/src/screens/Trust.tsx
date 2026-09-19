import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, asList, type Approval, type CockpitState, type AuditEntry, type BudgetState, type ControlStatus, type ShieldStatus, type TrustClassification, type TrustStatus, type TriggersState } from "../api/client";

/** Trust Center hardened elite Phase 1 — vertical nav, approval sheets, modes, audit, budgets, network, perms, shield.
 * Tokens var(--xr-*), real wiring only, engine authority SEC-07, states skeleton/empty/error, motion, a11y.
 */

const TABS = ["Cockpit", "Approvals", "Modes", "Audit", "Budgets", "Network", "Permissions", "Shield"] as const;
type Tab = (typeof TABS)[number];
const NAV_ICON: Record<Tab, ReactNode> = {
  Cockpit: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  Approvals: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" />,
  Modes: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4" />,
  Audit: <path d="M8 4h8v16H8zM11 9h2M11 13h2" />,
  Budgets: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 3v2M12 19v2M5 12H3M21 12h-2" />,
  Network: <path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4 12h16M12 4c-3 2.6-3 13.4 0 16 3-2.6 3-13.4 0-16z" />,
  Permissions: <path d="M8 11h8v9H8zM10 11V8a2 2 0 0 1 4 0v3" />,
  Shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
};
const clock = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : "—");
const money = (v?: number) => (typeof v === "number" ? `$${v.toFixed(4)}` : "—");
function scopeForTool(tool?: string): string | null {
  const t = (tool ?? "").toLowerCase();
  if (!t) return null;
  if (/(browser|web|navigate)/.test(t)) return "browser";
  if (/(clipboard)/.test(t)) return "clipboard";
  if (/(vision)/.test(t)) return "vision_cloud";
  if (/(write_file|edit_file|files\.write|patch)/.test(t)) return "files_write";
  if (/(read_file|files\.read|list_dir)/.test(t)) return "files_read";
  if (/(shell|exec|system|process)/.test(t)) return "system";
  if (/(desktop|computer|screen|mouse|keyboard)/.test(t)) return "desktop";
  return null;
}

export function Trust() {
  const [tab, setTab] = useState<Tab>("Cockpit");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [controlPend, setControlPend] = useState<Approval[]>([]);
  const [contextPend, setContextPend] = useState<Record<string, unknown>[]>([]);
  const [trust, setTrust] = useState<TrustStatus | null>(null);
  const trustMode = String((trust as { mode?: string } | null)?.mode ?? "balanced");
  const [cockpit, setCockpit] = useState<CockpitState | null>(null);
  const [control, setControl] = useState<ControlStatus | null>(null);
  const [ctxPolicy, setCtxPolicy] = useState<Record<string, unknown> | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [exportNote, setExportNote] = useState<string | null>(null);
  async function exportAudit() {
    setExportNote("exporting…");
    try {
      const r = await api.auditExport();
      const md = r.markdown ?? "";
      const m = md.match(/<!-- xr-signature: ([a-f0-9]{64}) -->/);
      let verdict = "signature missing";
      if (m) {
        const body = md.replace(/\n\n<!-- xr-signature: [a-f0-9]{64} -->\n?$/, "");
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
        const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
        verdict = hex === m[1] ? `signature VALID (${hex.slice(0, 12)}…) · chain ${r.chain?.valid ? "INTACT" : "BROKEN"}` : "signature MISMATCH — bundle altered";
      }
      const blob = new Blob([md], { type: "text/markdown" }); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `xr-audit-${new Date().toISOString().slice(0, 10)}.md`; a.click(); URL.revokeObjectURL(url);
      setExportNote(`exported ${r.count ?? 0} entries — ${verdict}`);
    } catch (e) { setExportNote(`export failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const [chain, setChain] = useState<Record<string, unknown> | null>(null);
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [envPolicy, setEnvPolicy] = useState<Record<string, unknown> | null>(null);
  const [controlPerms, setControlPerms] = useState<string[]>([]);
  const [shield, setShield] = useState<ShieldStatus | null>(null);
  const [bench, setBench] = useState<Record<string, unknown> | null>(null);
  const [triggers, setTriggers] = useState<TriggersState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cmd, setCmd] = useState("rm -rf /tmp/x");
  const [cls, setCls] = useState<TrustClassification | null>(null);
  const [scanning, setScanning] = useState(false);

  const loadQueue = useCallback(() => {
    api.approvals().then((v) => setApprovals(asList<Approval>(v, "pending", "approvals"))).catch(() => {});
    api.controlPending().then((v) => setControlPend(v.pending ?? [])).catch(() => {});
    api.contextPending().then((v) => setContextPend(asList<Record<string, unknown>>(v, "pending", "items"))).catch(() => {});
    api.controlPermissions().then((v) => setControlPerms(((v?.granted ?? []) as unknown[]).map(String))).catch(() => {});
  }, []);
  const loadRail = useCallback(() => {
    api.audit().then((v) => { setAudit(v.entries ?? []); setChain((v as { chain?: Record<string, unknown> }).chain ?? null); }).catch(() => {});
    api.budget().then(setBudget).catch(() => setBudget(null));
  }, []);
  const loadTab = useCallback((t: Tab) => {
    if (t === "Cockpit") { api.controlCockpit().then(setCockpit).catch(() => setCockpit(null)); loadQueue(); }
    if (t === "Approvals") loadQueue();
    if (t === "Modes") { api.trust().then(setTrust).catch(() => setTrust(null)); api.controlStatus().then(setControl).catch(() => setControl(null)); api.contextPolicy().then(setCtxPolicy).catch(() => setCtxPolicy(null)); api.triggers().then(setTriggers).catch(() => setTriggers(null)); }
    if (t === "Audit") api.audit().then((v) => { setAudit(v.entries ?? []); setChain((v as { chain?: Record<string, unknown> }).chain ?? null); }).catch(() => setAudit([]));
    if (t === "Budgets") api.budget().then(setBudget).catch(() => setBudget(null));
    if (t === "Network") api.environmentPolicy().then(setEnvPolicy).catch(() => setEnvPolicy(null));
    if (t === "Permissions") api.controlPermissions().then((v) => setControlPerms(((v?.granted ?? []) as unknown[]).map(String))).catch(() => setControlPerms([]));
    if (t === "Shield") { api.shieldStatus().then(setShield).catch(() => setShield(null)); api.securityBench().then(setBench).catch(() => setBench(null)); }
  }, [loadQueue]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);
  useEffect(() => { loadRail(); }, [loadRail]);
  useEffect(() => { if (tab !== "Approvals") return; const t = setInterval(loadQueue, 5000); return () => clearInterval(t); }, [tab, loadQueue]);

  const decide = (id: string, ok: boolean) => api.decide(id, ok).then(() => loadQueue()).catch((e) => setNote(`decision: ${e}`));
  const controlDecide = (id: string, ok: boolean) => api.controlApprove(id, ok).then(() => loadQueue()).catch((e) => setNote(`control: ${e}`));
  const burn = (budget as (BudgetState & { burn?: { monthUsd?: number; monthlyCap?: number; burnPct?: number | null } }) | null)?.burn ?? null;
  const chainOk = chain ? Boolean((chain as { ok?: boolean }).ok ?? (chain as { valid?: boolean }).valid ?? true) : null;

  const sheet = (a: Approval) => {
    const prev = a.preview ?? null; const scope = scopeForTool(a.tool ?? String(a.action ?? "")); const sections = prev?.sections ?? [];
    return (
      <section key={a.id} style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 16, display: "grid", gap: 10 }}>
        <header style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}><b>{String(a.surface ?? "agent")} agent wants to:</b> <code style={{ background: "var(--xr-surface-2)", padding: "2px 6px", borderRadius: 4 }}>{String(a.tool ?? a.action ?? a.id).slice(0, 90)}</code></span>
          <span style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 999, background: String(prev?.riskTier ?? a.risk ?? "").match(/high|critical/) ? "var(--xr-danger)" : "var(--xr-warning)", color: "white", fontSize: 11 }}>⚠ {String(prev?.riskTier ?? a.risk ?? "review")}</span>
        </header>
        <div style={{ fontSize: 12 }}>WHY: {String(prev?.untrustedReason ?? a.reason ?? "no reason supplied")} <em style={{ color: "var(--xr-text-3)" }}>(agent-stated — untrusted data, never authority)</em></div>
        {sections.map((s, i) => (
          <div key={i} style={{ display: "grid", gap: 4 }}>
            {s.title && <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-2)" }}>{s.title}{s.truncated ? " · truncated" : ""}</div>}
            {s.kind === "code" ? <pre style={{ margin: 0, padding: 10, background: "var(--xr-surface-2)", borderRadius: 6, fontFamily: "var(--xr-font-mono)", fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{String(s.body ?? "").split("\n").slice(0, 40).map((ln) => ln).join("\n")}</pre> : <div style={{ fontSize: 12 }}>{String(s.body ?? "").slice(0, 900)}</div>}
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>Affected Data: {sections.map((s, i) => <span key={i} style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontSize: 10 }}>{String(s.title ?? s.kind ?? "section").slice(0, 26)}</span>)}<span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontSize: 10 }}>{String(a.tool ?? "?")}</span></div>
        <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>◍ {String(a.surface ?? "interactive")} · {a.runId ? `run ${String(a.runId).slice(0, 10)}` : a.sessionId ? `session ${String(a.sessionId).slice(0, 10)}` : "interactive"} {a.taskId ? `· task ${String(a.taskId).slice(0, 10)}` : ""} · ttl {Math.round(Number(a.ttlMs ?? 0) / 1000)}s</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => decide(a.id, false)} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", cursor: "pointer" }}>Deny</button>
          <button onClick={() => decide(a.id, true)} style={{ padding: "8px 14px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer" }}>Allow once</button>
          {scope && !controlPerms.includes(scope) ? <button title="Grants a STANDING engine permission for this scope (persisted, audited), then approves this request." onClick={() => api.permissionsGrant(scope).then(() => decide(a.id, true)).catch((e) => setNote(`grant: ${e}`))} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid var(--xr-accent)", color: "var(--xr-accent)", background: "transparent", cursor: "pointer" }}>Always allow (scope: {scope})</button> : null}
        </div>
      </section>
    );
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 260px", gap: "var(--xr-space-3)", height: "100%", minHeight: 0, padding: "var(--xr-space-3)" }}>
      <nav aria-label="Trust Center sections" style={{ display: "grid", gap: 4, alignContent: "start", background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 4px 10px", fontWeight: 700, fontSize: 13 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--xr-accent)" strokeWidth={1.5} aria-hidden><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" /></svg> Trust Center</div>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-current={tab === t} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 8, border: tab === t ? "1px solid var(--xr-accent)" : "1px solid transparent", background: tab === t ? "var(--xr-surface-2)" : "transparent", color: tab === t ? "var(--xr-text-1)" : "var(--xr-text-2)", cursor: "pointer", fontSize: 12, textAlign: "left" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>{NAV_ICON[t]}</svg> {t}
            {t === "Shield" && shield?.score ? <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--xr-success)", marginLeft: "auto" }} /> : null}
            {t === "Approvals" && approvals.length > 0 ? <span style={{ marginLeft: "auto", padding: "2px 6px", borderRadius: 999, background: "var(--xr-danger)", color: "white", fontSize: 10 }}>{approvals.length}</span> : null}
          </button>
        ))}
      </nav>

      <div style={{ display: "grid", gap: "var(--xr-space-3)", overflow: "auto", minHeight: 0, alignContent: "start" }}>
        {note && <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderRadius: 6, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }}><span style={{ flex: 1 }}>{note}</span><button style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer" }} onClick={() => setNote(null)}>dismiss</button></div>}

        {tab === "Cockpit" && (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}><h2 style={{ margin: 0, fontSize: 16 }}>Control Cockpit</h2><span style={{ padding: "4px 10px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{String(cockpit?.mode ?? "balanced").toUpperCase()}</span></div>
            {!cockpit && <p style={{ fontSize: 12, color: "var(--xr-text-3)" }}>Loading cockpit… (single GET /control/cockpit)</p>}
            {cockpit && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Control status</div><p style={{ fontSize: 12, margin: 0 }}><span style={{ color: cockpit.control.enabled ? "var(--xr-success)" : "var(--xr-danger)" }}>{cockpit.control.enabled ? "● enabled" : "● disabled"}</span>{cockpit.control.disabledReason ? <span style={{ color: "var(--xr-text-3)" }}> — {cockpit.control.disabledReason}</span> : null}</p><p style={{ fontSize: 11, color: "var(--xr-text-3)", margin: 0 }}>trust mode: <b>{cockpit.mode}</b> — enforced by capabilities policy gate</p></section>
                <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Pending approvals ({cockpit.pending.length})</div>{cockpit.pending.length === 0 && <p style={{ fontSize: 12, color: "var(--xr-text-3)" }}>Queue empty — nothing waiting.</p>}{cockpit.pending.slice(0, 4).map((r) => <div key={r.id ?? r.tool} style={{ padding: 8, background: "var(--xr-surface-2)", borderRadius: 6 }}><b style={{ fontSize: 12 }}>{r.tool ?? "action"}</b><div style={{ fontSize: 11, color: "var(--xr-text-3)", marginTop: 3 }}>{String(r.reason ?? r.summary ?? "").slice(0, 160)}</div></div>)}{cockpit.pending.length > 4 && <p style={{ fontSize: 11, color: "var(--xr-text-3)" }}>+ {cockpit.pending.length - 4} more — see Approvals tab</p>}</section>
                <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Standing permissions ({cockpit.permissions.length})</div>{cockpit.permissions.length === 0 && <p style={{ fontSize: 12, color: "var(--xr-text-3)" }}>No standing grants — every action asks.</p>}<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{cockpit.permissions.map((sc) => <span key={sc} style={{ padding: "4px 8px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontSize: 11 }}>{sc}</span>)}</div></section>
                <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Triggers</div><p style={{ fontSize: 12, margin: 0 }}>{cockpit.triggers.pauseAll ? <span style={{ color: "var(--xr-danger)" }}>paused (all)</span> : <span style={{ color: "var(--xr-success)" }}>armed</span>} · {cockpit.triggers.triggers.length} configured · {cockpit.triggers.inflight} in-flight</p></section>
              </div>
            )}
          </>
        )}
        {tab === "Approvals" && (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}><h2 style={{ margin: 0, fontSize: 16 }}>Approval Sheet</h2><span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{approvals.length + controlPend.length + contextPend.length} pending</span></div>
            {approvals.length === 0 && controlPend.length === 0 && contextPend.length === 0 && <p style={{ fontSize: 12, color: "var(--xr-text-3)" }}>Nothing awaiting your decision — queues empty.</p>}
            {approvals.map(sheet)}
            {controlPend.length > 0 && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}><h2 style={{ margin: 0, fontSize: 14 }}>Computer-control queue · {controlPend.length}</h2></div>}
            {controlPend.map((a) => <section key={a.id} style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 16, display: "grid", gap: 10 }}><header style={{ fontWeight: 600, fontSize: 13 }}>control action: <code>{String(a.action ?? JSON.stringify(a).slice(0, 90))}</code></header><div style={{ display: "flex", gap: 8 }}><button onClick={() => controlDecide(a.id, false)} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", cursor: "pointer" }}>Deny</button><button onClick={() => controlDecide(a.id, true)} style={{ padding: "8px 14px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer" }}>Approve</button></div></section>)}
            {contextPend.length > 0 && <div style={{ marginTop: 8 }}><h2 style={{ margin: 0, fontSize: 14 }}>Context plane · {contextPend.length} pending</h2></div>}
            {contextPend.map((c, i) => <div key={String(c.id ?? i)} style={{ display: "flex", gap: 8, alignItems: "center", padding: 10, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: 8 }}><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", fontSize: 12 }}>{String(c.summary ?? c.source ?? JSON.stringify(c).slice(0, 90))}</span>{typeof c.id === "string" && <button style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => api.contextRevoke(c.id as string).then(() => loadQueue()).catch((e) => setNote(`revoke: ${e}`))}>revoke</button>}</div>)}
          </>
        )}
        {tab === "Modes" && (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}><h2 style={{ margin: 0, fontSize: 16 }}>Trust Modes</h2></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {[{ id: "careful", t: "Careful", d: "Full audit of every action. Slower but secure." }, { id: "balanced", t: "Balanced", d: "Approvals for risky actions only. Optimal workflow." }, { id: "autonomous", t: "Autonomous", d: "AI makes most decisions. Fast, highest risk." }].map((m) => (
                <button key={m.id} type="button" aria-pressed={trustMode === m.id} onClick={() => api.trustModeSet(m.id).then(() => { setNote(`trust mode → ${m.id}`); loadTab("Modes"); }).catch((e) => setNote(`trust mode: ${e}`))} style={{ textAlign: "left", padding: 14, borderRadius: "var(--xr-radius-lg)", border: trustMode === m.id ? "2px solid var(--xr-accent)" : "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer", display: "grid", gap: 6 }}>
                  <b style={{ fontSize: 13 }}>{m.t}</b><span style={{ width: 12, height: 12, borderRadius: 999, border: "2px solid var(--xr-border)", background: trustMode === m.id ? "var(--xr-accent)" : "transparent", display: "inline-block" }} aria-hidden /><p style={{ margin: 0, fontSize: 11, color: "var(--xr-text-2)" }}>{m.d}</p>
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "var(--xr-text-3)" }}>Mode persisted engine-side (~/.xr/trust-mode.json) and enforced at capabilities policy gate: <b>careful</b> widens approvals, <b>balanced</b> keeps tool-declared, <b>autonomous</b> relaxes except hard gate (high/critical never auto-approved). Mode changes audited.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 8 }}>
              <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Isolation backends (GET /trust)</div>{!trust?.enabled && <p style={{ fontSize: 12, color: "var(--xr-text-3)" }}>trust service: {trust?.reason ?? "not wired"}</p>}{(trust?.backends ?? []).map((b) => <div key={b.id} style={{ padding: 8, background: "var(--xr-surface-2)", borderRadius: 6 }}><b style={{ fontSize: 12 }}>{b.id}</b> · <span style={{ color: b.available ? "var(--xr-success)" : "var(--xr-danger)", fontSize: 11 }}>{b.placement}</span><div style={{ fontSize: 11, color: "var(--xr-text-3)", marginTop: 4 }}>{String(b.describe ?? "").slice(0, 220)}</div></div>)}</section>
              <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Computer control (GET /control/status)</div><div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 4, fontSize: 11 }}><span style={{ color: "var(--xr-text-3)" }}>enabled</span><span style={{ color: control?.enabled ? "var(--xr-success)" : "var(--xr-danger)" }}>{String(control?.enabled ?? false)}</span><span style={{ color: "var(--xr-text-3)" }}>kill reason</span><span>{control?.disabledReason ?? "—"}</span></div>{control?.capabilities && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{Object.entries((control.capabilities.tools ?? {}) as Record<string, unknown>).map(([k, v]) => <span key={k} style={{ padding: "2px 8px", borderRadius: 999, background: v ? "var(--xr-success)" : "var(--xr-surface-2)", color: v ? "white" : "var(--xr-text-3)", fontSize: 10, border: "1px solid var(--xr-border)" }}>{k} {v ? "✓" : "✗"}</span>)}</div>}<div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)", marginTop: 8 }}>Automations (GET /triggers)</div><div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 4, fontSize: 11 }}><span style={{ color: "var(--xr-text-3)" }}>pause-all</span><span style={{ color: triggers?.pauseAll ? "var(--xr-warning)" : "var(--xr-success)" }}>{String(triggers?.pauseAll ?? false)}</span><span style={{ color: "var(--xr-text-3)" }}>in-flight</span><span>{String(triggers?.inflight ?? 0)}</span><span style={{ color: "var(--xr-text-3)" }}>triggers</span><span>{String((triggers?.triggers ?? []).length)}</span></div><button style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => api.triggersPause(!(triggers?.pauseAll ?? false)).then(() => loadTab("Modes")).catch((e) => setNote(`triggers: ${e}`))}>{triggers?.pauseAll ? "Resume all triggers" : "Pause all triggers"}</button></section>
              <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Context tiers (GET /context/policy)</div>{((ctxPolicy?.tiers ?? []) as Record<string, unknown>[]).slice(0, 5).map((t) => <div key={String(t.tier)} style={{ padding: 8, background: "var(--xr-surface-2)", borderRadius: 6, fontSize: 11 }}><b>{String(t.tier)}</b> · mayInstruct {String(t.mayInstruct)} · max {String(t.maxItems)} items / {String(t.maxChars)} chars</div>)}<div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)", marginTop: 8 }}>Pre-flight classifier (POST /trust/classify)</div><form style={{ display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); api.trustClassify(cmd).then(setCls).catch((ev) => setNote(`classify: ${ev}`)); }}><input value={cmd} onChange={(e) => setCmd(e.target.value)} aria-label="Command to classify" style={{ flex: 1, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", borderRadius: 8, padding: "7px 10px", fontFamily: "var(--xr-font-mono)", fontSize: 11 }} /><button type="submit" style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>Classify</button></form>{cls?.classification && <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 4, fontSize: 11, marginTop: 4 }}><span style={{ color: "var(--xr-text-3)" }}>tier</span><span style={{ color: "var(--xr-warning)" }}>{cls.classification.tier ?? "—"}</span><span style={{ color: "var(--xr-text-3)" }}>approval</span><span>{cls.classification.requiredApprovalLevel ?? "—"}</span><span style={{ color: "var(--xr-text-3)" }}>credential</span><span>{cls.classification.requiredCredentialMode ?? "—"}</span><span style={{ color: "var(--xr-text-3)" }}>reasons</span><span>{(cls.classification.reasons ?? []).join(", ") || "—"}</span></div>}</section>
            </div>
          </>
        )}
        {tab === "Audit" && (
          <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Hash-chained audit chain (GET /audit) · {audit.length} entries</span><span style={{ marginLeft: "auto" }}><button style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => void exportAudit()}>export signed bundle</button></span></div>
            {exportNote && <p style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-2)", margin: 0 }}>{exportNote}</p>}
            <div style={{ maxHeight: "56vh", overflow: "auto", display: "grid", gap: 4 }}>{audit.slice(-80).reverse().map((a) => <div key={a.id} style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}><span style={{ color: "var(--xr-text-3)" }}>{clock(a.created_at)}</span> <span style={{ color: "var(--xr-accent)" }}>{a.event}</span> {String(a.detail ?? "").slice(0, 110)} <span style={{ color: "var(--xr-text-3)" }}>#{(a.hash ?? "").slice(0, 8)}</span></div>)}{audit.length === 0 && <p style={{ fontSize: 12, color: "var(--xr-text-3)" }}>No audit entries yet.</p>}</div>
          </section>
        )}
        {tab === "Budgets" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 12 }}>
            <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Usage (engine ledger)</div><div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 6, fontSize: 12 }}><span style={{ color: "var(--xr-text-3)" }}>total</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>{money(budget?.usage?.totalUsd)} · {String(budget?.usage?.totalTokens ?? 0)} tok</span><span style={{ color: "var(--xr-text-3)" }}>today</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>{money(budget?.usage?.dayUsd)}</span><span style={{ color: "var(--xr-text-3)" }}>this month</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>{money(budget?.usage?.monthUsd)}</span><span style={{ color: "var(--xr-text-3)" }}>per-task cap</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>${String(budget?.config?.perTaskUsd ?? "—")} / {String(budget?.config?.perTaskTokens ?? "—")} tok</span><span style={{ color: "var(--xr-text-3)" }}>monthly cap</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>{budget?.persisted?.monthly_cap ? `$${budget.persisted.monthly_cap}` : "unset"}</span><span style={{ color: "var(--xr-text-3)" }}>daily cap</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>{budget?.persisted?.daily_cap ? `$${budget.persisted.daily_cap}` : "unset"}</span><span style={{ color: "var(--xr-text-3)" }}>burn (engine)</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>{burn?.burnPct == null ? "no cap set" : `${burn.burnPct}% of $${burn.monthlyCap}`}</span></div></section>
            <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Set caps (POST /budget/set — engine enforces)</div><BudgetForm initial={budget} onDone={() => loadTab("Budgets")} onNote={setNote} /></section>
          </div>
        )}
        {tab === "Network" && (
          <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Environment policy (GET /environment/policy)</div>
            {(() => {
              const env = (envPolicy?.environment ?? {}) as Record<string, unknown>; const mods = (env.modalities ?? {}) as Record<string, unknown>; const browser = (env.browser ?? {}) as Record<string, unknown>;
              return (<><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{Object.entries(mods).map(([k, v]) => <span key={k} style={{ padding: "2px 8px", borderRadius: 999, background: v ? "var(--xr-success)" : "var(--xr-surface-2)", color: v ? "white" : "var(--xr-text-3)", fontSize: 10, border: "1px solid var(--xr-border)" }}>{k} {v ? "on" : "off"}</span>)}</div><div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 6, fontSize: 12 }}><span style={{ color: "var(--xr-text-3)" }}>private networks</span><span style={{ color: browser.blockPrivateNetworks ? "var(--xr-success)" : "var(--xr-warning)" }}>{browser.blockPrivateNetworks ? "blocked" : "allowed"}</span><span style={{ color: "var(--xr-text-3)" }}>allowed domains</span><span>{((browser.allowedDomains ?? []) as unknown[]).length ? String(browser.allowedDomains) : "any (none pinned)"}</span><span style={{ color: "var(--xr-text-3)" }}>blocked domains</span><span>{String(browser.blockedDomains ?? "—")}</span><span style={{ color: "var(--xr-text-3)" }}>max download</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>{String(browser.maxDownloadMb ?? browser.maxDownloads ?? "—")}</span></div><p style={{ fontSize: 11, color: "var(--xr-text-3)" }}>Domain pinning + diff re-approval live engine-side (SEC-01); this panel reports active policy only.</p></>);
            })()}
          </section>
        )}
        {tab === "Permissions" && (
          <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Standing computer-use grants (GET /control/permissions)</div>
            {controlPerms.length === 0 && <p style={{ fontSize: 12, color: "var(--xr-text-3)" }}>No standing grants — every consequential action asks.</p>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{controlPerms.map((g) => <span key={g} style={{ padding: "4px 10px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 11, display: "inline-flex", gap: 6, alignItems: "center" }}>{g} <button title="Revoke this standing grant (audited)" onClick={() => api.permissionsGrant(g, true).then(() => loadTab("Permissions")).catch((e) => setNote(`revoke: ${e}`))} style={{ background: "transparent", border: "none", color: "white", cursor: "pointer" }}>×</button></span>)}</div>
            <p style={{ fontSize: 11, color: "var(--xr-text-3)" }}>Grants persisted engine-side and enforced by computer-use gate; "Always allow (scope…)" on approval sheet creates one. Per-skill / per-plugin permission reports live in Library.</p>
          </section>
        )}
        {tab === "Shield" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Posture score · {String(shield?.score?.score ?? "—")}/100</div>{(shield?.score?.checks ?? []).map((c, i) => <div key={i} style={{ fontSize: 12, color: c.ok ? "var(--xr-success)" : "var(--xr-warning)" }}>{c.ok ? "✓" : "·"} {c.name}{c.detail ? ` — ${String(c.detail).slice(0, 80)}` : ""}</div>)}<div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 4, fontSize: 11, marginTop: 4 }}><span style={{ color: "var(--xr-text-3)" }}>quarantined</span><span>{String((shield?.state?.quarantined ?? []).length)}</span><span style={{ color: "var(--xr-text-3)" }}>whitelisted</span><span>{String((shield?.state?.whitelisted ?? []).length)}</span><span style={{ color: "var(--xr-text-3)" }}>ad-block</span><span>{shield?.state?.adBlockEnabled ? "on" : "off"}</span><span style={{ color: "var(--xr-text-3)" }}>telemetry</span><span>{shield?.state?.telemetryDisabled ? "disabled" : "enabled"}</span></div><button disabled={scanning} onClick={() => { setScanning(true); api.shieldScan().then(() => loadTab("Shield")).catch((e) => setNote(`scan: ${e}`)).finally(() => setScanning(false)); }} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }}>{scanning ? "scanning…" : "Run shield scan"}</button><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)", marginTop: 8 }}>Scan history</div>{(shield?.state?.history ?? []).slice(-5).reverse().map((h, i) => <div key={i} style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}><span style={{ color: "var(--xr-text-3)" }}>{clock(h.timestamp)}</span> {h.type} · {String(h.threatsCount)} threats · {h.scanMode}</div>)}</section>
            <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Injection bench (GET /security)</div><div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 4, fontSize: 11 }}><span style={{ color: "var(--xr-text-3)" }}>outcomes</span><span>{String(bench?.total ?? "—")}</span><span style={{ color: "var(--xr-text-3)" }}>blocked</span><span style={{ color: "var(--xr-success)" }}>{String(bench?.blocked ?? "—")}</span><span style={{ color: "var(--xr-text-3)" }}>block rate</span><span>{String(bench?.rate ?? "—")}</span></div>{((bench?.outcomes ?? []) as Record<string, unknown>[]).slice(0, 8).map((o, i) => <div key={i} style={{ fontSize: 11, color: o.blocked ? "var(--xr-success)" : "var(--xr-danger)" }}>{o.blocked ? "✓" : "✗"} {String(o.category)} · {String(o.description).slice(0, 70)}</div>)}</section>
          </div>
        )}
      </div>

      <aside style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Audit Chain</div><div style={{ padding: "6px 10px", borderRadius: 999, background: chainOk ? "var(--xr-success)" : chain ? "var(--xr-danger)" : "var(--xr-surface-2)", color: chainOk ? "white" : chain ? "white" : "var(--xr-text-3)", fontSize: 11, textAlign: "center" }}>{chainOk ? "✓ chain intact" : chain ? "✗ chain BROKEN" : "chain unknown"}</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{audit.slice(-6).reverse().map((a) => <span key={a.id} title={`${a.event} · ${clock(a.created_at)}`} style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 10 }}>{(a.hash ?? "").slice(0, 12)}…</span>)}{audit.length === 0 && <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontSize: 10 }}>— empty ledger —</span>}</div></section>
        <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, display: "grid", gap: 8 }}><div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--xr-text-3)" }}>Budget Burn</div><div style={{ display: "flex", gap: 8, alignItems: "center" }}><div style={{ flex: 1, height: 6, background: "var(--xr-surface-3)", borderRadius: 999, overflow: "hidden" }}><i style={{ display: "block", height: "100%", width: `${burn?.burnPct ?? 0}%`, background: "var(--xr-accent)" }} /></div><span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{burn?.burnPct == null ? "no cap" : `${burn.burnPct}%`}</span></div><div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 10, color: "var(--xr-text-3)" }}>{money(burn?.monthUsd ?? budget?.usage?.monthUsd)} this month{burn?.monthlyCap ? ` of $${burn.monthlyCap}` : " · cap unset"}</div></section>
      </aside>
    </div>
  );
}

function BudgetForm({ initial, onDone, onNote }: { initial: BudgetState | null; onDone: () => void; onNote: (s: string) => void }) {
  const [perTaskUsd, setPerTaskUsd] = useState<string>(""); const [monthlyCap, setMonthlyCap] = useState<string>(""); const [dailyCap, setDailyCap] = useState<string>("");
  useEffect(() => { if (!initial) return; setPerTaskUsd(String(initial.config?.perTaskUsd ?? "")); setMonthlyCap(String(initial.persisted?.monthly_cap ?? "")); setDailyCap(initial.persisted?.daily_cap == null ? "" : String(initial.persisted.daily_cap)); }, [initial]);
  const submit = (patch: Record<string, unknown>) => api.budgetSet(patch).then(() => onDone()).catch((e) => onNote(`budget/set: ${e}`));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label style={{ fontSize: 11, color: "var(--xr-text-3)", display: "grid", gap: 4 }}>per-task cap (USD)<input value={perTaskUsd} onChange={(e) => setPerTaskUsd(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }} /></label>
      <label style={{ fontSize: 11, color: "var(--xr-text-3)", display: "grid", gap: 4 }}>monthly cap (0 = unset)<input value={monthlyCap} onChange={(e) => setMonthlyCap(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }} /></label>
      <label style={{ fontSize: 11, color: "var(--xr-text-3)", display: "grid", gap: 4 }}>daily cap (empty = unset)<input value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }} /></label>
      <div style={{ display: "flex", gap: 8 }}><button style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => submit({ perTaskUsd: Number(perTaskUsd) })}>Apply per-task</button><button style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => submit({ monthlyCap: Number(monthlyCap), dailyCap: dailyCap === "" ? null : Number(dailyCap) })}>Apply caps</button></div>
      <p style={{ fontSize: 11, color: "var(--xr-text-3)", margin: 0 }}>Engine enforces these; shell only forwards numbers you type.</p>
    </div>
  );
}
