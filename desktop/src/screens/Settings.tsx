import { useCallback, useEffect, useState } from "react";
import { api, asList, type ProviderInfo, type ShieldStatus, type TriggersState } from "../api/client";

const TABS = ["General", "Models", "Local", "Automations", "Voice", "Privacy", "Advanced"] as const;
type Tab = (typeof TABS)[number];

/**
 * Settings (Phase 1–4 shell per master plan): general / models / local /
 * automations / voice / privacy / advanced. Every value is engine-reported;
 * writers forward to engine routes (/providers/set, /workspaces/switch,
 * /triggers/pause). No policy is computed in the shell (SEC-07).
 */
export function Settings() {
  const [tab, setTab] = useState<Tab>("General");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [ws, setWs] = useState<{ active?: string; workspaces?: { id?: string; name?: string; rootDir?: string }[] } | null>(null);
  const [onb, setOnb] = useState<Record<string, unknown> | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [envCaps, setEnvCaps] = useState<Record<string, unknown> | null>(null);
  const [envStatus, setEnvStatus] = useState<Record<string, unknown> | null>(null);
  const [envPolicy, setEnvPolicy] = useState<Record<string, unknown> | null>(null);
  const [triggers, setTriggers] = useState<TriggersState | null>(null);
  const [privacy, setPrivacy] = useState<ShieldStatus | null>(null);
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback((t: Tab) => {
    if (t === "General") {
      api.health().then(setHealth).catch(() => setHealth(null));
      api.workspaces().then(setWs).catch(() => setWs(null));
      api.onboardingStatus().then(setOnb).catch(() => setOnb(null));
    }
    if (t === "Models") {
      api.providers().then((v) => setProviders(asList<ProviderInfo>(v, "providers", "items"))).catch(() => setProviders([]));
      api.config().then(setConfig).catch(() => setConfig(null));
    }
    if (t === "Local") {
      api.environmentCapabilities().then(setEnvCaps).catch(() => setEnvCaps(null));
      api.environmentStatus().then(setEnvStatus).catch(() => setEnvStatus(null));
      api.environmentPolicy().then(setEnvPolicy).catch(() => setEnvPolicy(null));
    }
    if (t === "Automations") api.triggers().then(setTriggers).catch(() => setTriggers(null));
    if (t === "Voice") api.environmentPolicy().then(setEnvPolicy).catch(() => setEnvPolicy(null));
    if (t === "Privacy") api.shieldPrivacy().then(setPrivacy).catch(() => setPrivacy(null));
    if (t === "Advanced") {
      api.config().then(setConfig).catch(() => setConfig(null));
      api.metrics().then(setMetrics).catch(() => setMetrics(null));
    }
  }, []);
  useEffect(() => { load(tab); }, [tab, load]);

  const version = (health?.version as { version?: string } | undefined)?.version ?? (typeof health?.version === "string" ? health.version : null);

  return (
    <div style={{ padding: "14px 18px" }}>
      <div className="section-h">
        <h2>Settings</h2>
        <span className="faint" style={{ fontSize: 12 }}>engine-backed preferences — the shell forwards, the engine decides</span>
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {note && <div className="appr2" style={{ marginBottom: 12 }}><div className="cmd">{note}</div><button className="chipbtn" onClick={() => setNote(null)}>dismiss</button></div>}

      {tab === "General" && (
        <div className="tc-grid">
          <section className="tc-card">
            <div className="rail-h">System</div>
            <div className="kv2">
              <span className="k">engine</span><span className="mono">{version ?? "—"}</span>
              <span className="k">daemon</span><span className="tl-ok">connected</span>
              <span className="k">shell</span><span>XR Desktop · phase 6 chrome</span>
            </div>
          </section>
          <section className="tc-card">
            <div className="rail-h">Workspaces (GET /workspaces)</div>
            {(ws?.workspaces ?? []).map((w) => (
              <div key={w.id} className="stepchip" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1 }}><b>{w.name ?? w.id}</b> <span className="faint mono">{w.rootDir}</span></span>
                {w.id === ws?.active
                  ? <span className="chip green">active</span>
                  : <button className="chipbtn" style={{ padding: "3px 10px" }} onClick={() => api.workspacesSwitch(w.id!).then(() => load("General")).catch((e) => setNote(`switch: ${e}`))}>switch</button>}
              </div>
            ))}
          </section>
          <section className="tc-card">
            <div className="rail-h">Onboarding (GET /onboarding/status)</div>
            <div className="kv2">
              <span className="k">needs setup</span><span className={onb?.needsSetup ? "tl-wait" : "tl-ok"}>{String(onb?.needsSetup ?? "—")}</span>
            </div>
            {((onb?.reasons ?? []) as string[]).map((r, i) => <div key={i} className="tl tl-wait">· {r}</div>)}
          </section>
        </div>
      )}

      {tab === "Models" && (
        <div className="tc-grid">
          <section className="tc-card">
            <div className="rail-h">Active routing (GET /config)</div>
            <div className="kv2">
              <span className="k">provider</span><span className="mono">{String(config?.provider ?? "—")}</span>
              <span className="k">model</span><span className="mono">{String(config?.model ?? "—")}</span>
              <span className="k">mode</span><span>{String(config?.mode ?? "—")}</span>
              <span className="k">fallback</span><span className="mono">{String(config?.fallbackProvider ?? "—")} / {String(config?.fallbackModel ?? "—")}</span>
              <span className="k">routing</span><span>{String(config?.routing ?? "—")}</span>
              <span className="k">local enabled</span><span>{String(config?.localEnabled ?? "—")}</span>
            </div>
          </section>
          <section className="tc-card">
            <div className="rail-h">Providers (GET /providers → POST /providers/set)</div>
            {providers.map((p) => (
              <div key={p.id} className="stepchip" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1 }}>
                  <b>{p.name ?? p.id}</b> {p.local ? <span className="chip">local</span> : null} {p.keyless ? <span className="chip">keyless</span> : null}
                  <div className="faint" style={{ marginTop: 3 }}>{(p.models ?? []).slice(0, 4).join(", ") || "no models listed"}</div>
                </span>
                <button className="chipbtn" style={{ padding: "3px 10px" }} onClick={() => api.providersSet(p.id).then(() => load("Models")).catch((e) => setNote(`providers/set: ${e}`))}>set active</button>
              </div>
            ))}
            <p className="faint" style={{ fontSize: 11 }}>Full Model Center (tests, capabilities, SLOs) lives in Library → Models.</p>
          </section>
        </div>
      )}

      {tab === "Local" && (
        <div className="tc-grid">
          <section className="tc-card">
            <div className="rail-h">Environment capabilities</div>
            <pre className="raw" style={{ maxHeight: 260 }}>{envCaps ? JSON.stringify(envCaps, null, 2).slice(0, 1200) : "—"}</pre>
          </section>
          <section className="tc-card">
            <div className="rail-h">Environment status</div>
            <pre className="raw" style={{ maxHeight: 260 }}>{envStatus ? JSON.stringify(envStatus, null, 2).slice(0, 1200) : "—"}</pre>
          </section>
        </div>
      )}

      {tab === "Automations" && (
        <section className="tc-card" style={{ maxWidth: 640 }}>
          <div className="rail-h">Triggers (GET /triggers · POST /triggers/pause)</div>
          <div className="kv2">
            <span className="k">pause-all</span><span className={triggers?.pauseAll ? "tl-wait" : "tl-ok"}>{String(triggers?.pauseAll ?? false)}</span>
            <span className="k">in-flight</span><span>{String(triggers?.inflight ?? 0)}</span>
            <span className="k">registered</span><span>{String((triggers?.triggers ?? []).length)}</span>
          </div>
          {((triggers?.triggers ?? []) as Record<string, unknown>[]).map((t, i) => (
            <div key={i} className="stepchip">{JSON.stringify(t).slice(0, 140)}</div>
          ))}
          <button className="chipbtn" onClick={() => api.triggersPause(!(triggers?.pauseAll ?? false)).then(() => load("Automations")).catch((e) => setNote(`triggers: ${e}`))}>
            {triggers?.pauseAll ? "Resume all triggers" : "Pause all triggers"}
          </button>
        </section>
      )}

      {tab === "Voice" && (
        <section className="tc-card" style={{ maxWidth: 640 }}>
          <div className="rail-h">Voice pipeline</div>
          <div className="kv2">
            <span className="k">modality policy</span>
            <span className={((envPolicy?.environment as Record<string, unknown> | undefined)?.modalities as Record<string, unknown> | undefined)?.voice ? "tl-ok" : "tl-err"}>
              {String((((envPolicy?.environment as Record<string, unknown> | undefined)?.modalities as Record<string, unknown> | undefined)?.voice) ?? false)}
            </span>
            <span className="k">build state</span><span className="tl-wait">not in this build</span>
          </div>
          <p className="faint" style={{ fontSize: 12 }}>
            The engine exposes voice approval + STT/TTS primitives, but the desktop overlay (PTT, barge-in,
            approvals-in-voice) ships with the Phase-4 backend wave. The status bar reports VOICE OFFLINE honestly.
          </p>
        </section>
      )}

      {tab === "Privacy" && (
        <section className="tc-card" style={{ maxWidth: 720 }}>
          <div className="rail-h">Privacy checks (GET /shield/privacy) · score {String(privacy?.score?.score ?? "—")}</div>
          {(privacy?.score?.checks ?? []).map((c, i) => (
            <div key={i} className={`tl ${c.ok ? "tl-ok" : "tl-wait"}`}>
              {c.ok ? "✓" : "·"} {c.name}{c.detail ? ` — ${String(c.detail).slice(0, 100)}` : ""}
            </div>
          ))}
        </section>
      )}

      {tab === "Advanced" && (
        <div className="tc-grid">
          <section className="tc-card">
            <div className="rail-h">Engine config (GET /config)</div>
            <pre className="raw" style={{ maxHeight: 300 }}>{config ? JSON.stringify(config, null, 2).slice(0, 1400) : "—"}</pre>
          </section>
          <section className="tc-card">
            <div className="rail-h">Metrics (GET /metrics)</div>
            <pre className="raw" style={{ maxHeight: 300 }}>{metrics ? JSON.stringify(metrics, null, 2).slice(0, 1400) : "—"}</pre>
          </section>
        </div>
      )}
    </div>
  );
}
