import { useCallback, useEffect, useState } from "react";
import {
  api, asList, type Approval, type AuditEntry, type BudgetState, type ControlStatus,
  type ShieldStatus, type TrustClassification, type TrustStatus, type TriggersState,
} from "../api/client";

const TABS = ["Queue", "Modes", "Audit", "Budgets", "Network", "Permissions", "Shield"] as const;
type Tab = (typeof TABS)[number];

const clock = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : "—");
const money = (v?: number) => (typeof v === "number" ? `$${v.toFixed(4)}` : "—");

/**
 * Trust Center (Phase 4 · master plan): queue / modes / audit / budgets /
 * network / permissions / shield — every value rendered is engine-reported
 * (GET /approvals, /control/*, /audit, /budget, /environment/policy,
 * /shield/status, /trust); decisions are forwarded, never computed here (SEC-07).
 */
export function Trust() {
  const [tab, setTab] = useState<Tab>("Queue");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [controlPend, setControlPend] = useState<Approval[]>([]);
  const [contextPend, setContextPend] = useState<Record<string, unknown>[]>([]);
  const [trust, setTrust] = useState<TrustStatus | null>(null);
  const [control, setControl] = useState<ControlStatus | null>(null);
  const [ctxPolicy, setCtxPolicy] = useState<Record<string, unknown> | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [envPolicy, setEnvPolicy] = useState<Record<string, unknown> | null>(null);
  const [controlPerms, setControlPerms] = useState<Record<string, unknown> | null>(null);
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
  }, []);
  const loadTab = useCallback((t: Tab) => {
    if (t === "Queue") loadQueue();
    if (t === "Modes") {
      api.trust().then(setTrust).catch(() => setTrust(null));
      api.controlStatus().then(setControl).catch(() => setControl(null));
      api.contextPolicy().then(setCtxPolicy).catch(() => setCtxPolicy(null));
      api.triggers().then(setTriggers).catch(() => setTriggers(null));
    }
    if (t === "Audit") api.audit().then((v) => setAudit(v.entries ?? [])).catch(() => setAudit([]));
    if (t === "Budgets") api.budget().then(setBudget).catch(() => setBudget(null));
    if (t === "Network") api.environmentPolicy().then(setEnvPolicy).catch(() => setEnvPolicy(null));
    if (t === "Permissions") api.controlPermissions().then(setControlPerms).catch(() => setControlPerms(null));
    if (t === "Shield") {
      api.shieldStatus().then(setShield).catch(() => setShield(null));
      api.securityBench().then(setBench).catch(() => setBench(null));
    }
  }, [loadQueue]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);
  useEffect(() => {
    if (tab !== "Queue") return;
    const t = setInterval(loadQueue, 5000);
    return () => clearInterval(t);
  }, [tab, loadQueue]);

  const decide = (id: string, ok: boolean) =>
    api.decide(id, ok).then(() => loadQueue()).catch((e) => setNote(`decision: ${e}`));
  const controlDecide = (id: string, ok: boolean) =>
    api.controlApprove(id, ok).then(() => loadQueue()).catch((e) => setNote(`control: ${e}`));

  return (
    <div style={{ padding: "14px 18px" }}>
      <div className="section-h">
        <h2>Trust Center</h2>
        <span className="faint" style={{ fontSize: 12 }}>engine-reported posture — the shell renders and forwards, never computes (SEC-07)</span>
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {note && <div className="appr2" style={{ marginBottom: 12 }}><div className="cmd">{note}</div><button className="chipbtn" onClick={() => setNote(null)}>dismiss</button></div>}

      {tab === "Queue" && (
        <div className="tc-grid">
          <section className="tc-card">
            <div className="rail-h">Action approvals · {approvals.length} pending</div>
            {approvals.length === 0 && <p className="faint" style={{ fontSize: 12 }}>Nothing awaiting your decision.</p>}
            {approvals.map((a) => (
              <div key={a.id} className="appr2" style={{ width: "100%" }}>
                <div className="t">⚠ {String(a.action ?? a.id).slice(0, 120)}</div>
                {a.reason && <div className="faint" style={{ fontSize: 11.5 }}>{String(a.reason).slice(0, 140)}</div>}
                {a.risk != null && <div className="chip amber" style={{ marginTop: 6 }}>risk {String(a.risk)}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="chipbtn" style={{ borderColor: "var(--xr-amber)", color: "var(--xr-amber)" }} onClick={() => decide(a.id, true)}>Allow once</button>
                  <button className="chipbtn" onClick={() => decide(a.id, false)}>Deny</button>
                </div>
              </div>
            ))}
          </section>
          <section className="tc-card">
            <div className="rail-h">Computer-control queue · {controlPend.length}</div>
            {controlPend.length === 0 && <p className="faint" style={{ fontSize: 12 }}>No pending control actions.</p>}
            {controlPend.map((a) => (
              <div key={a.id} className="appr2" style={{ width: "100%" }}>
                <div className="t">{String(a.action ?? JSON.stringify(a).slice(0, 110))}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="chipbtn" onClick={() => controlDecide(a.id, true)}>Approve</button>
                  <button className="chipbtn" onClick={() => controlDecide(a.id, false)}>Deny</button>
                </div>
              </div>
            ))}
          </section>
          <section className="tc-card">
            <div className="rail-h">Context plane · {contextPend.length} pending</div>
            {contextPend.length === 0 && <p className="faint" style={{ fontSize: 12 }}>No untrusted context awaiting review.</p>}
            {contextPend.map((c, i) => (
              <div key={String(c.id ?? i)} className="stepchip" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{String(c.summary ?? c.source ?? JSON.stringify(c).slice(0, 90))}</span>
                {typeof c.id === "string" && (
                  <button className="chipbtn" style={{ padding: "3px 10px" }} onClick={() => api.contextRevoke(c.id as string).then(() => loadQueue()).catch((e) => setNote(`revoke: ${e}`))}>revoke</button>
                )}
              </div>
            ))}
          </section>
        </div>
      )}

      {tab === "Modes" && (
        <div className="tc-grid">
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
      )}

      {tab === "Audit" && (
        <section className="tc-card">
          <div className="rail-h">Hash-chained audit chain (GET /audit) · {audit.length} entries — the ledger of record</div>
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
          <div className="rail-h">Control-plane grants (GET /control/permissions)</div>
          {(((controlPerms?.granted ?? []) as unknown[]).length === 0) && <p className="faint" style={{ fontSize: 12 }}>No standing grants — every consequential action asks.</p>}
          {((controlPerms?.granted ?? []) as Record<string, unknown>[]).map((g, i) => (
            <div key={i} className="stepchip">{JSON.stringify(g).slice(0, 140)}</div>
          ))}
          <p className="faint" style={{ fontSize: 11 }}>Per-skill / per-plugin permission reports live in Library (engine-computed safe / dangerous / missing-approval sets).</p>
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
