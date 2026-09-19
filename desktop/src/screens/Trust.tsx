import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  api, asList, type Approval, type CockpitState, type AuditEntry, type BudgetState, type ControlStatus,
  type ShieldStatus, type TrustClassification, type TrustStatus, type TriggersState,
} from "../api/client";
import { poll } from "../poll";

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

/** Tool → standing computer-use scope (the ONLY scopes the engine grant route accepts). */
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

/**
 * Phase 4 · Trust Center, mockup 08 layout: vertical sub-nav, approval SHEETS
 * (engine StructuredPreview diff sections, untrusted WHY framed as data,
 * provenance line, Deny / Allow once / scoped Always-allow), Trust Modes
 * presets, and a right rail with the hash-chain badge + engine-computed
 * budget burn. Every number is engine-reported; decisions are forwarded
 * (SEC-07). Scoped grants ride the REAL persisted permission store.
 */
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

  /** Phase 5 · signed audit export: fetch the engine-composed bundle, verify
   *  its sha256 signature LOCALLY (WebCrypto), then download. Verification is
   *  real: body re-hashed after stripping the signature trailer. */
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
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `xr-audit-${new Date().toISOString().slice(0, 10)}.md`;
      a.click(); URL.revokeObjectURL(url);
      setExportNote(`exported ${r.count ?? 0} entries — ${verdict}`);
    } catch (e) {
      setExportNote(`export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
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

  /**
   * Phase 1 · the approvals queue and the control-pending list come from the
   * shared poll hub (src/poll.ts) — the Trust Center and the status bar must not
   * be two independent observations of the same queue. What stays here is what
   * the hub does not own: this tab's own context/permission reads, which are
   * fetched when the tab is shown rather than on a timer.
   */
  const loadQueue = useCallback(() => {
    api.contextPending().then((v) => setContextPend(asList<Record<string, unknown>>(v, "pending", "items"))).catch(() => {});
    api.controlPermissions().then((v) => setControlPerms(((v?.granted ?? []) as unknown[]).map(String))).catch(() => {});
  }, []);

  useEffect(() => {
    const off = poll.subscribe(["approvals", "pending"], (o) => {
      if (o.key === "approvals") {
        if (o.ok) setApprovals(asList<Approval>(o.value, "pending", "approvals"));
        return;
      }
      if (o.ok) setControlPend(o.value.pending ?? []);
    });
    return off;
  }, []);
  const loadRail = useCallback(() => {
    api.audit().then((v) => { setAudit(v.entries ?? []); setChain((v as { chain?: Record<string, unknown> }).chain ?? null); }).catch(() => {});
    api.budget().then(setBudget).catch(() => setBudget(null));
  }, []);
  const loadTab = useCallback((t: Tab) => {
    if (t === "Cockpit") { api.controlCockpit().then(setCockpit).catch(() => setCockpit(null)); loadQueue(); }
    if (t === "Approvals") loadQueue();
    if (t === "Modes") {
      api.trust().then(setTrust).catch(() => setTrust(null));
      api.controlStatus().then(setControl).catch(() => setControl(null));
      api.contextPolicy().then(setCtxPolicy).catch(() => setCtxPolicy(null));
      api.triggers().then(setTriggers).catch(() => setTriggers(null));
    }
    if (t === "Audit") api.audit().then((v) => { setAudit(v.entries ?? []); setChain((v as { chain?: Record<string, unknown> }).chain ?? null); }).catch(() => setAudit([]));
    if (t === "Budgets") api.budget().then(setBudget).catch(() => setBudget(null));
    if (t === "Network") api.environmentPolicy().then(setEnvPolicy).catch(() => setEnvPolicy(null));
    if (t === "Permissions") api.controlPermissions().then((v) => setControlPerms(((v?.granted ?? []) as unknown[]).map(String))).catch(() => setControlPerms([]));
    if (t === "Shield") {
      api.shieldStatus().then(setShield).catch(() => setShield(null));
      api.securityBench().then(setBench).catch(() => setBench(null));
    }
  }, [loadQueue]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);
  useEffect(() => { loadRail(); }, [loadRail]);
  useEffect(() => {
    if (tab !== "Approvals") return;
    const t = setInterval(loadQueue, 5000);
    return () => clearInterval(t);
  }, [tab, loadQueue]);

  const decide = (id: string, ok: boolean) =>
    api.decide(id, ok).then(() => loadQueue()).catch((e) => setNote(`decision: ${e}`));
  const controlDecide = (id: string, ok: boolean) =>
    api.controlApprove(id, ok).then(() => loadQueue()).catch((e) => setNote(`control: ${e}`));

  const burn = (budget as (BudgetState & { burn?: { monthUsd?: number; monthlyCap?: number; burnPct?: number | null } }) | null)?.burn ?? null;
  const chainOk = chain ? Boolean((chain as { ok?: boolean }).ok ?? (chain as { valid?: boolean }).valid ?? true) : null;

  const sheet = (a: Approval) => {
    const prev = a.preview ?? null;
    const scope = scopeForTool(a.tool ?? String(a.action ?? ""));
    const sections = prev?.sections ?? [];
    return (
      <section key={a.id} className="appr-sheet">
        <header className="as-head">
          <span className="as-wants">
            <b>{String(a.surface ?? "agent")} agent wants to:</b>{" "}
            <code>{String(a.tool ?? a.action ?? a.id).slice(0, 90)}</code>
          </span>
          <span className={`as-risk ${String(prev?.riskTier ?? a.risk ?? "").match(/high|critical/) ? "hi" : "med"}`}>
            ⚠ {String(prev?.riskTier ?? a.risk ?? "review")}
          </span>
        </header>
        <div className="as-why">
          WHY: {String(prev?.untrustedReason ?? a.reason ?? "no reason supplied")}{" "}
          <em className="faint">(agent-stated — untrusted data, never authority)</em>
        </div>
        {sections.map((s, i) => (
          <div key={i} className="as-sec">
            {s.title && <div className="as-sec-t mono">{s.title}{s.truncated ? " · truncated" : ""}</div>}
            {s.kind === "code" ? (
              <pre className="as-diff mono">
                {String(s.body ?? "").split("\n").slice(0, 40).map((ln, j) => (
                  <span key={j} className={ln.startsWith("+") ? "add" : ln.startsWith("-") ? "del" : ""}>{ln}{"\n"}</span>
                ))}
              </pre>
            ) : (
              <div className="as-text">{String(s.body ?? "").slice(0, 900)}</div>
            )}
          </div>
        ))}
        <div className="as-aff">
          Affected Data:{" "}
          {sections.map((s, i) => <span key={i} className="chip tiny">{String(s.title ?? s.kind ?? "section").slice(0, 26)}</span>)}
          <span className="chip tiny">{String(a.tool ?? "?")}</span>
        </div>
        <div className="as-prov">
          <span className="as-prov-ic" aria-hidden="true">◍</span>{" "}
          {String(a.surface ?? "interactive")} · {a.runId ? `run ${String(a.runId).slice(0, 10)}` : a.sessionId ? `session ${String(a.sessionId).slice(0, 10)}` : "interactive session"}
          {a.taskId ? ` · task ${String(a.taskId).slice(0, 10)}` : ""} · ttl {Math.round(Number(a.ttlMs ?? 0) / 1000)}s
        </div>
        <div className="as-acts">
          <button className="as-deny" onClick={() => decide(a.id, false)}>Deny</button>
          <button className="as-once" onClick={() => decide(a.id, true)}>Allow once</button>
          {scope && !controlPerms.includes(scope) ? (
            <button
              className="as-scope"
              title="Grants a STANDING engine permission for this scope (persisted, audited), then approves this request."
              onClick={() => api.permissionsGrant(scope).then(() => decide(a.id, true)).catch((e) => setNote(`grant: ${e}`))}
            >
              Always allow (scope: {scope})
            </button>
          ) : null}
        </div>
      </section>
    );
  };

  return (
    <div className="tc2">
      <nav className="tc2-nav" aria-label="Trust Center sections">
        <div className="tc2-brand">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--xr-cyan)" strokeWidth="1.5" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" /></svg>
          <b>Trust Center</b>
        </div>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "tc2-n on" : "tc2-n"} onClick={() => setTab(t)} aria-current={tab === t}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{NAV_ICON[t]}</svg>
            {t}
            {t === "Shield" && shield?.score ? <span className="dot green" style={{ marginLeft: "auto" }} /> : null}
            {t === "Approvals" && approvals.length > 0 ? <span className="tc2-badge">{approvals.length}</span> : null}
          </button>
        ))}
      </nav>

      <div className="tc2-main">
        {note && <div className="appr2" style={{ marginBottom: 12 }}><div className="cmd">{note}</div><button className="chipbtn" onClick={() => setNote(null)}>dismiss</button></div>}

                {tab === "Cockpit" && (
          <>
            <div className="section-h">
              <h2>Control Cockpit</h2>
              <span className={`mode-badge m-${cockpit?.mode ?? "balanced"}`}>{String(cockpit?.mode ?? "balanced").toUpperCase()}</span>
            </div>
            {!cockpit && <p className="faint" style={{ fontSize: 12 }}>Loading cockpit… (single GET /control/cockpit)</p>}
            {cockpit && (
              <div className="ck-grid">
                <section className="tc-card">
                  <div className="rail-h">Control status</div>
                  <p style={{ fontSize: 12 }}>
                    <span className={cockpit.control.enabled ? "tl-ok" : "tl-err"}>
                      {cockpit.control.enabled ? "● enabled" : "● disabled"}
                    </span>
                    {cockpit.control.disabledReason ? <span className="faint"> — {cockpit.control.disabledReason}</span> : null}
                  </p>
                  <p className="faint" style={{ fontSize: 11 }}>
                    trust mode: <b>{cockpit.mode}</b> — enforced by the capabilities policy gate
                  </p>
                </section>
                <section className="tc-card">
                  <div className="rail-h">Pending approvals ({cockpit.pending.length})</div>
                  {cockpit.pending.length === 0 && <p className="faint" style={{ fontSize: 12 }}>Queue empty — nothing waiting on you.</p>}
                  {cockpit.pending.slice(0, 4).map((r) => (
                    <div key={r.id ?? r.tool} className="stepchip">
                      <b>{r.tool ?? "action"}</b>
                      <div className="faint" style={{ marginTop: 3 }}>{String(r.reason ?? r.summary ?? "").slice(0, 160)}</div>
                    </div>
                  ))}
                  {cockpit.pending.length > 4 && <p className="faint" style={{ fontSize: 11 }}>+ {cockpit.pending.length - 4} more — see Approvals tab</p>}
                </section>
                <section className="tc-card">
                  <div className="rail-h">Standing permissions ({cockpit.permissions.length})</div>
                  {cockpit.permissions.length === 0 && <p className="faint" style={{ fontSize: 12 }}>No standing grants — every action asks.</p>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {cockpit.permissions.map((sc) => <span key={sc} className="stepchip" style={{ margin: 0 }}>{sc}</span>)}
                  </div>
                </section>
                <section className="tc-card">
                  <div className="rail-h">Triggers</div>
                  <p style={{ fontSize: 12 }}>
                    {cockpit.triggers.pauseAll ? <span className="tl-err">paused (all)</span> : <span className="tl-ok">armed</span>}
                    {" · "}{cockpit.triggers.triggers.length} configured · {cockpit.triggers.inflight} in-flight
                  </p>
                </section>
              </div>
            )}
          </>
        )}
        {tab === "Approvals" && (
          <>
            <div className="section-h"><h2>Approval Sheet</h2></div>
            {approvals.length === 0 && controlPend.length === 0 && contextPend.length === 0 && (
              <p className="faint" style={{ fontSize: 12 }}>Nothing awaiting your decision — the queues are empty.</p>
            )}
            {approvals.map(sheet)}
            {controlPend.length > 0 && <div className="section-h" style={{ marginTop: 16 }}><h2>Computer-control queue · {controlPend.length}</h2></div>}
            {controlPend.map((a) => (
              <section key={a.id} className="appr-sheet">
                <header className="as-head"><span className="as-wants"><b>control action:</b> <code>{String(a.action ?? JSON.stringify(a).slice(0, 90))}</code></span></header>
                <div className="as-acts">
                  <button className="as-deny" onClick={() => controlDecide(a.id, false)}>Deny</button>
                  <button className="as-once" onClick={() => controlDecide(a.id, true)}>Approve</button>
                </div>
              </section>
            ))}
            {contextPend.length > 0 && <div className="section-h" style={{ marginTop: 16 }}><h2>Context plane · {contextPend.length} pending</h2></div>}
            {contextPend.map((c, i) => (
              <div key={String(c.id ?? i)} className="stepchip" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{String(c.summary ?? c.source ?? JSON.stringify(c).slice(0, 90))}</span>
                {typeof c.id === "string" && (
                  <button className="chipbtn" style={{ padding: "3px 10px" }} onClick={() => api.contextRevoke(c.id as string).then(() => loadQueue()).catch((e) => setNote(`revoke: ${e}`))}>revoke</button>
                )}
              </div>
            ))}
          </>
        )}

        {tab === "Modes" && (
          <>
            <div className="section-h"><h2>Trust Modes</h2></div>
            <div className="mode-cards">
              {[
                { id: "careful", t: "Careful", d: "Full audit of every action. Slower but secure." },
                { id: "balanced", t: "Balanced", d: "Approvals for risky actions only. Optimal workflow." },
                { id: "autonomous", t: "Autonomous", d: "AI agent makes most decisions. Fast, but highest risk." },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`mode-card${trustMode === m.id ? " on" : ""}`}
                  aria-pressed={trustMode === m.id}
                  onClick={() => api.trustModeSet(m.id).then(() => { setNote(`trust mode → ${m.id}`); loadTab("Modes"); }).catch((e) => setNote(`trust mode: ${e}`))}
                >
                  <b>{m.t}</b>
                  <span className={`mode-radio${trustMode === m.id ? " on" : ""}`} aria-hidden="true" />
                  <p>{m.d}</p>
                </button>
              ))}
            </div>
            <p className="faint" style={{ fontSize: 11 }}>
              The mode is persisted engine-side (~/.xr/trust-mode.json) and enforced at the capabilities policy
              gate on every decision: <b>careful</b> widens approvals to dangerous-declared permissions and
              mid-or-higher risk tiers; <b>balanced</b> keeps tool-declared approvals; <b>autonomous</b> relaxes
              everything except the hard gate — high/critical risk tiers and dangerous permissions are never
              auto-approved. Mode changes are written to the audit log.
            </p>
            <div className="tc-grid" style={{ marginTop: 14 }}>
              <section className="tc-card">
                <div className="rail-h">Isolation backends (GET /trust)</div>
                {!trust?.enabled && <p className="faint" style={{ fontSize: 12 }}>trust service: {trust?.reason ?? "not wired"}</p>}
                {(trust?.backends ?? []).map((b) => (
                  <div key={b.id} className="stepchip">
                    <b>{b.id}</b> · <span className={b.available ? "tl-ok" : "tl-err"}>{b.placement}</span>
                    <div className="faint" style={{ marginTop: 4 }}>{String(b.describe ?? "").slice(0, 220)}</div>
                  </div>
                ))}
              </section>
              <section className="tc-card">
                <div className="rail-h">Computer control (GET /control/status)</div>
                <div className="kv2">
                  <span className="k">enabled</span><span className={control?.enabled ? "tl-ok" : "tl-err"}>{String(control?.enabled ?? false)}</span>
                  <span className="k">kill reason</span><span>{control?.disabledReason ?? "—"}</span>
                </div>
                {control?.capabilities && (
                  <div className="pkchips">
                    {Object.entries((control.capabilities.tools ?? {}) as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className={`chip ${v ? "green" : ""}`}>{k} {v ? "✓" : "✗"}</span>
                    ))}
                  </div>
                )}
                <div className="rail-h" style={{ marginTop: 10 }}>Automations (GET /triggers)</div>
                <div className="kv2">
                  <span className="k">pause-all</span><span className={triggers?.pauseAll ? "tl-wait" : "tl-ok"}>{String(triggers?.pauseAll ?? false)}</span>
                  <span className="k">in-flight</span><span>{String(triggers?.inflight ?? 0)}</span>
                  <span className="k">triggers</span><span>{String((triggers?.triggers ?? []).length)}</span>
                </div>
                <button
                  className="chipbtn"
                  onClick={() => api.triggersPause(!(triggers?.pauseAll ?? false)).then(() => loadTab("Modes")).catch((e) => setNote(`triggers: ${e}`))}
                >
                  {triggers?.pauseAll ? "Resume all triggers" : "Pause all triggers"}
                </button>
              </section>
              <section className="tc-card">
                <div className="rail-h">Context tiers (GET /context/policy)</div>
                {((ctxPolicy?.tiers ?? []) as Record<string, unknown>[]).slice(0, 5).map((t) => (
                  <div key={String(t.tier)} className="stepchip">
                    <b>{String(t.tier)}</b> · mayInstruct {String(t.mayInstruct)} · max {String(t.maxItems)} items / {String(t.maxChars)} chars
                  </div>
                ))}
                <div className="rail-h" style={{ marginTop: 10 }}>Pre-flight classifier (POST /trust/classify)</div>
                <form className="inrow" style={{ display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); api.trustClassify(cmd).then(setCls).catch((ev) => setNote(`classify: ${ev}`)); }}>
                  <input value={cmd} onChange={(e) => setCmd(e.target.value)} aria-label="Command to classify" className="mono" style={{ flex: 1, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border-strong)", borderRadius: 8, padding: "7px 10px", color: "var(--xr-text)" }} />
                  <button className="chipbtn" type="submit">Classify</button>
                </form>
                {cls?.classification && (
                  <div className="kv2" style={{ marginTop: 8 }}>
                    <span className="k">tier</span><span className="tl-wait">{cls.classification.tier ?? "—"}</span>
                    <span className="k">approval</span><span>{cls.classification.requiredApprovalLevel ?? "—"}</span>
                    <span className="k">credential</span><span>{cls.classification.requiredCredentialMode ?? "—"}</span>
                    <span className="k">reasons</span><span>{(cls.classification.reasons ?? []).join(", ") || "—"}</span>
                  </div>
                )}
              </section>
            </div>
          </>
        )}

        {tab === "Audit" && (
          <section className="tc-card">
            <div className="rail-h" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Hash-chained audit chain (GET /audit) · {audit.length} entries — the ledger of record</span>
              <span style={{ marginLeft: "auto" }}>
                <button className="chipbtn" onClick={() => void exportAudit()} title="Phase 5 · download the signed, hash-chained bundle and verify its signature in-shell">
                  export signed bundle
                </button>
              </span>
            </div>
            {exportNote && <p className="ob-note mono" style={{ margin: "6px 0 0" }}>{exportNote}</p>}
            <div className="tl-box" style={{ maxHeight: "56vh" }}>
              {audit.slice(-80).reverse().map((a) => (
                <div key={a.id} className="tl tl-info">
                  <span className="faint">{clock(a.created_at)}</span> <span className="k-tool">{a.event}</span>{" "}
                  {String(a.detail ?? "").slice(0, 110)} <span className="faint">#{(a.hash ?? "").slice(0, 8)}</span>
                </div>
              ))}
              {audit.length === 0 && <p className="faint" style={{ fontSize: 12 }}>No audit entries yet.</p>}
            </div>
          </section>
        )}

        {tab === "Budgets" && (
          <div className="tc-grid">
            <section className="tc-card">
              <div className="rail-h">Usage (engine ledger)</div>
              <div className="kv2">
                <span className="k">total</span><span className="mono">{money(budget?.usage?.totalUsd)} · {String(budget?.usage?.totalTokens ?? 0)} tok</span>
                <span className="k">today</span><span className="mono">{money(budget?.usage?.dayUsd)}</span>
                <span className="k">this month</span><span className="mono">{money(budget?.usage?.monthUsd)}</span>
                <span className="k">per-task cap</span><span className="mono">${String(budget?.config?.perTaskUsd ?? "—")} / {String(budget?.config?.perTaskTokens ?? "—")} tok</span>
                <span className="k">monthly cap</span><span className="mono">{budget?.persisted?.monthly_cap ? `$${budget.persisted.monthly_cap}` : "unset"}</span>
                <span className="k">daily cap</span><span className="mono">{budget?.persisted?.daily_cap ? `$${budget.persisted.daily_cap}` : "unset"}</span>
                <span className="k">burn (engine)</span><span className="mono">{burn?.burnPct == null ? "no cap set" : `${burn.burnPct}% of $${burn.monthlyCap}`}</span>
              </div>
            </section>
            <section className="tc-card">
              <div className="rail-h">Set caps (POST /budget/set — engine enforces)</div>
              <BudgetForm onDone={() => loadTab("Budgets")} onNote={setNote} initial={budget} />
            </section>
          </div>
        )}

        {tab === "Network" && (
          <section className="tc-card">
            <div className="rail-h">Environment policy (GET /environment/policy)</div>
            {(() => {
              const env = (envPolicy?.environment ?? {}) as Record<string, unknown>;
              const mods = (env.modalities ?? {}) as Record<string, unknown>;
              const browser = (env.browser ?? {}) as Record<string, unknown>;
              return (
                <>
                  <div className="pkchips" style={{ marginBottom: 10 }}>
                    {Object.entries(mods).map(([k, v]) => <span key={k} className={`chip ${v ? "green" : "bad"}`}>{k} {v ? "on" : "off"}</span>)}
                  </div>
                  <div className="kv2">
                    <span className="k">private networks</span><span className={browser.blockPrivateNetworks ? "tl-ok" : "tl-wait"}>{browser.blockPrivateNetworks ? "blocked" : "allowed"}</span>
                    <span className="k">allowed domains</span><span>{((browser.allowedDomains ?? []) as unknown[]).length ? String(browser.allowedDomains) : "any (none pinned)"}</span>
                    <span className="k">blocked domains</span><span>{String(browser.blockedDomains ?? "—")}</span>
                    <span className="k">max download</span><span className="mono">{String(browser.maxDownloadMb ?? browser.maxDownloads ?? "—")}</span>
                  </div>
                  <p className="faint" style={{ fontSize: 11 }}>Domain pinning + diff re-approval live engine-side (SEC-01); this panel reports the active policy only.</p>
                </>
              );
            })()}
          </section>
        )}

        {tab === "Permissions" && (
          <section className="tc-card">
            <div className="rail-h">Standing computer-use grants (GET /control/permissions)</div>
            {controlPerms.length === 0 && <p className="faint" style={{ fontSize: 12 }}>No standing grants — every consequential action asks.</p>}
            <div className="pkchips">
              {controlPerms.map((g) => (
                <span key={g} className="chip green">
                  {g}{" "}
                  <button
                    className="chip-x"
                    title="Revoke this standing grant (audited)"
                    onClick={() => api.permissionsGrant(g, true).then(() => loadTab("Permissions")).catch((e) => setNote(`revoke: ${e}`))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <p className="faint" style={{ fontSize: 11 }}>
              Grants are persisted engine-side and enforced by the computer-use gate; "Always allow (scope…)" on an
              approval sheet creates one. Per-skill / per-plugin permission reports live in Library.
            </p>
          </section>
        )}

        {tab === "Shield" && (
          <div className="tc-grid">
            <section className="tc-card">
              <div className="rail-h">Posture score · {String(shield?.score?.score ?? "—")}/100</div>
              {(shield?.score?.checks ?? []).map((c, i) => (
                <div key={i} className={`tl ${c.ok ? "tl-ok" : "tl-wait"}`}>{c.ok ? "✓" : "·"} {c.name}{c.detail ? ` — ${String(c.detail).slice(0, 80)}` : ""}</div>
              ))}
              <div className="kv2" style={{ marginTop: 8 }}>
                <span className="k">quarantined</span><span>{String((shield?.state?.quarantined ?? []).length)}</span>
                <span className="k">whitelisted</span><span>{String((shield?.state?.whitelisted ?? []).length)}</span>
                <span className="k">ad-block</span><span>{shield?.state?.adBlockEnabled ? "on" : "off"}</span>
                <span className="k">telemetry</span><span>{shield?.state?.telemetryDisabled ? "disabled" : "enabled"}</span>
              </div>
              <button className="chipbtn" disabled={scanning} onClick={() => { setScanning(true); api.shieldScan().then(() => loadTab("Shield")).catch((e) => setNote(`scan: ${e}`)).finally(() => setScanning(false)); }}>
                {scanning ? "scanning…" : "Run shield scan"}
              </button>
              <div className="rail-h" style={{ marginTop: 10 }}>Scan history</div>
              {(shield?.state?.history ?? []).slice(-5).reverse().map((h, i) => (
                <div key={i} className="tl tl-info"><span className="faint">{clock(h.timestamp)}</span> {h.type} · {String(h.threatsCount)} threats · {h.scanMode}</div>
              ))}
            </section>
            <section className="tc-card">
              <div className="rail-h">Injection bench (GET /security)</div>
              <div className="kv2">
                <span className="k">outcomes</span><span>{String(bench?.total ?? "—")}</span>
                <span className="k">blocked</span><span className="tl-ok">{String(bench?.blocked ?? "—")}</span>
                <span className="k">block rate</span><span>{String(bench?.rate ?? "—")}</span>
              </div>
              {((bench?.outcomes ?? []) as Record<string, unknown>[]).slice(0, 8).map((o, i) => (
                <div key={i} className={`tl ${o.blocked ? "tl-ok" : "tl-err"}`}>{o.blocked ? "✓" : "✗"} {String(o.category)} · {String(o.description).slice(0, 70)}</div>
              ))}
            </section>
          </div>
        )}
      </div>

      <aside className="tc2-rail">
        <section className="tc-card">
          <div className="rail-h">Audit Chain</div>
          <div className={chainOk ? "chain-badge ok" : "chain-badge bad"}>
            {chainOk ? "✓ chain intact" : chain ? "✗ chain BROKEN" : "chain unknown"}
          </div>
          <div className="chain-chips mono">
            {audit.slice(-6).reverse().map((a) => (
              <span key={a.id} className="chain-chip" title={`${a.event} · ${clock(a.created_at)}`}>{(a.hash ?? "").slice(0, 12)}…</span>
            ))}
            {audit.length === 0 && <span className="chain-chip">— empty ledger —</span>}
          </div>
        </section>
        <section className="tc-card">
          <div className="rail-h">Budget Burn</div>
          <div className="burn-row">
            <div className="burn-bar"><i style={{ width: `${burn?.burnPct ?? 0}%` }} /></div>
            <span className="mono">{burn?.burnPct == null ? "no cap" : `${burn.burnPct}%`}</span>
          </div>
          <div className="mono faint" style={{ fontSize: 10.5 }}>
            {money(burn?.monthUsd ?? budget?.usage?.monthUsd)} this month{burn?.monthlyCap ? ` of $${burn.monthlyCap}` : " · cap unset"}
          </div>
        </section>
      </aside>
    </div>
  );
}

function BudgetForm({ initial, onDone, onNote }: { initial: BudgetState | null; onDone: () => void; onNote: (s: string) => void }) {
  const [perTaskUsd, setPerTaskUsd] = useState<string>("");
  const [monthlyCap, setMonthlyCap] = useState<string>("");
  const [dailyCap, setDailyCap] = useState<string>("");
  useEffect(() => {
    if (!initial) return;
    setPerTaskUsd(String(initial.config?.perTaskUsd ?? ""));
    setMonthlyCap(String(initial.persisted?.monthly_cap ?? ""));
    setDailyCap(initial.persisted?.daily_cap == null ? "" : String(initial.persisted.daily_cap));
  }, [initial]);
  const submit = (patch: Record<string, unknown>) =>
    api.budgetSet(patch).then(() => onDone()).catch((e) => onNote(`budget/set: ${e}`));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label className="faint" style={{ fontSize: 11 }}>per-task cap (USD)
        <input className="mono" value={perTaskUsd} onChange={(e) => setPerTaskUsd(e.target.value)} style={{ display: "block", width: "100%", background: "var(--xr-surface-2)", border: "1px solid var(--xr-border-strong)", borderRadius: 8, padding: "7px 10px", color: "var(--xr-text)" }} />
      </label>
      <label className="faint" style={{ fontSize: 11 }}>monthly cap (0 = unset)
        <input className="mono" value={monthlyCap} onChange={(e) => setMonthlyCap(e.target.value)} style={{ display: "block", width: "100%", background: "var(--xr-surface-2)", border: "1px solid var(--xr-border-strong)", borderRadius: 8, padding: "7px 10px", color: "var(--xr-text)" }} />
      </label>
      <label className="faint" style={{ fontSize: 11 }}>daily cap (empty = unset)
        <input className="mono" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} style={{ display: "block", width: "100%", background: "var(--xr-surface-2)", border: "1px solid var(--xr-border-strong)", borderRadius: 8, padding: "7px 10px", color: "var(--xr-text)" }} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="chipbtn" onClick={() => submit({ perTaskUsd: Number(perTaskUsd) })}>Apply per-task</button>
        <button className="chipbtn" onClick={() => submit({ monthlyCap: Number(monthlyCap), dailyCap: dailyCap === "" ? null : Number(dailyCap) })}>Apply caps</button>
      </div>
      <p className="faint" style={{ fontSize: 11 }}>Engine enforces these; the shell only forwards numbers you type.</p>
    </div>
  );
}
