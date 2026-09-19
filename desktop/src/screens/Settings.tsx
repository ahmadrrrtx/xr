import { useCallback, useEffect, useState } from "react";
import { api, asList, type ProviderInfo, type ShieldStatus, type TriggersState } from "../api/client";
import { notificationsEnabled, setNotificationsEnabled, requestNotificationPermission, notificationChannel } from "../notify";
import { getDensity, getTheme, isLightActive, setDensity, setTheme, type Density, type ThemePref } from "../prefs";
import { isTauri, nativeAutostartStatus, nativeSetAutostart, nativeCheckUpdate } from "../tauri-bridge";

/** Settings — Phase 2 hardened elite: general/models/local/automations/voice/privacy/advanced.
 * Tokens var(--xr-*), skeleton/empty/error, motion, a11y, real wiring only, SEC-07.
 */

const TABS = ["General", "Models", "Local", "Automations", "Voice", "Privacy", "Advanced"] as const;
type Tab = (typeof TABS)[number];

export function Settings({ onOnboard }: { onOnboard?: () => void }) {
  const [tab, setTab] = useState<Tab>("General");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [ws, setWs] = useState<{ active?: string; workspaces?: { id?: string; name?: string; rootDir?: string }[] } | null>(null);
  const [onb, setOnb] = useState<Record<string, unknown> | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [envCaps, setEnvCaps] = useState<Record<string, unknown> | null>(null);
  const [envStatus, setEnvStatus] = useState<Record<string, unknown> | null>(null);
  const [triggers, setTriggers] = useState<TriggersState | null>(null);
  const [privacy, setPrivacy] = useState<ShieldStatus | null>(null);
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [voice, setVoice] = useState<Record<string, unknown> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [themeChoice, setThemeChoice] = useState<ThemePref>(getTheme());
  const [density, setDensityChoice] = useState<Density>(getDensity());
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [notifOn, setNotifOn] = useState(notificationsEnabled());
  const [notifChannel, setNotifChannel] = useState<string>("…");
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [updateInfo, setUpdateInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void notificationChannel().then(setNotifChannel);
    void nativeAutostartStatus().then(setAutostart);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReducedMotion(mq.matches);
    sync(); mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const load = useCallback((t: Tab) => {
    setLoading(true);
    const promises: Promise<unknown>[] = [];
    if (t === "General") { promises.push(api.health().then(setHealth).catch(() => setHealth(null)), api.workspaces().then(setWs).catch(() => setWs(null)), api.onboardingStatus().then(setOnb).catch(() => setOnb(null))); }
    if (t === "Models") { promises.push(api.providers().then((v) => setProviders(asList<ProviderInfo>(v, "providers", "items"))).catch(() => setProviders([])), api.config().then(setConfig).catch(() => setConfig(null))); }
    if (t === "Local") { promises.push(api.environmentCapabilities().then(setEnvCaps).catch(() => setEnvCaps(null)), api.environmentStatus().then(setEnvStatus).catch(() => setEnvStatus(null))); }
    if (t === "Automations") promises.push(api.triggers().then(setTriggers).catch(() => setTriggers(null)));
    if (t === "Voice") promises.push(api.voiceStatus().then(setVoice).catch(() => setVoice(null)));
    if (t === "Privacy") promises.push(api.shieldPrivacy().then(setPrivacy).catch(() => setPrivacy(null)));
    if (t === "Advanced") promises.push(api.config().then(setConfig).catch(() => setConfig(null)), api.metrics().then(setMetrics).catch(() => setMetrics(null)));
    Promise.allSettled(promises).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(tab); }, [tab, load]);

  const version = (health?.version as { version?: string } | undefined)?.version ?? (typeof health?.version === "string" ? health.version : null);

  const cardStyle = { background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 14, display: "grid", gap: 10 } as const;
  const railStyle = { fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.04em", color: "var(--xr-text-3)" };

  return (
    <div style={{ padding: "var(--xr-space-4)", display: "grid", gap: "var(--xr-space-3)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Settings</h2>
        <span style={{ fontSize: 12, color: "var(--xr-text-3)" }}>engine-backed preferences — shell forwards, engine decides (SEC-07)</span>
      </div>
      <div role="tablist" style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--xr-border)" }}>
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{ padding: "8px 14px", fontSize: 12, border: "none", borderBottom: tab === t ? "2px solid var(--xr-accent)" : "2px solid transparent", background: "transparent", color: tab === t ? "var(--xr-text-1)" : "var(--xr-text-3)", cursor: "pointer" }}>{t}</button>)}
      </div>
      {note && <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderRadius: 6, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }}><span style={{ flex: 1 }}>{note}</span><button onClick={() => setNote(null)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer" }}>dismiss</button></div>}
      {loading && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>{Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 100, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)" }} />)}</div>}

      {!loading && tab === "General" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          <section style={cardStyle}><div style={railStyle}>System</div><div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 6, fontSize: 12 }}><span style={{ color: "var(--xr-text-3)" }}>engine</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>{version ?? "—"}</span><span style={{ color: "var(--xr-text-3)" }}>daemon</span><span style={{ color: "var(--xr-success)" }}>connected</span><span style={{ color: "var(--xr-text-3)" }}>shell</span><span>XR Desktop · phase 2 elite</span></div></section>
          <section style={cardStyle}><div style={railStyle}>Appearance</div><div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, fontSize: 12 }}><span style={{ color: "var(--xr-text-3)" }}>theme</span><span style={{ display: "inline-flex", border: "1px solid var(--xr-border)", borderRadius: 999, overflow: "hidden" }}>{(["dark", "light", "system"] as const).map((t) => <button key={t} role="radio" aria-checked={themeChoice === t} onClick={() => { setTheme(t); setThemeChoice(t); setNote(`theme: ${t}${t === "system" ? ` (following OS → ${isLightActive() ? "light" : "dark"})` : ""}`); }} style={{ padding: "4px 10px", fontSize: 11, border: "none", background: themeChoice === t ? "var(--xr-accent)" : "transparent", color: themeChoice === t ? "white" : "var(--xr-text-2)", cursor: "pointer" }}>{t}</button>)}</span><span style={{ color: "var(--xr-text-3)" }}>density</span><span style={{ display: "inline-flex", border: "1px solid var(--xr-border)", borderRadius: 999, overflow: "hidden" }}>{(["comfortable", "compact"] as const).map((d) => <button key={d} role="radio" aria-checked={density === d} onClick={() => { setDensity(d); setDensityChoice(d); setNote(`density: ${d} — spacing only`); }} style={{ padding: "4px 10px", fontSize: 11, border: "none", background: density === d ? "var(--xr-accent)" : "transparent", color: density === d ? "white" : "var(--xr-text-2)", cursor: "pointer" }}>{d}</button>)}</span><span style={{ color: "var(--xr-text-3)" }}>motion</span><span style={{ fontSize: 11, color: "var(--xr-text-3)" }}>{prefersReducedMotion ? "reduced — following OS" : "full — reduced-motion honored automatically"}</span></div></section>
          <section style={cardStyle}><div style={railStyle}>OS integration (opt-in)</div><div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, fontSize: 12 }}><span style={{ color: "var(--xr-text-3)" }}>notifications</span><span style={{ display: "flex", gap: 8, alignItems: "center" }}><button onClick={() => { const next = !notifOn; if (next) void requestNotificationPermission().then(() => void notificationChannel().then(setNotifChannel)); setNotificationsEnabled(next); setNotifOn(next); setNote(next ? "notifications on — approval due / run done (opt-in)" : "notifications off"); }} style={{ padding: "4px 10px", borderRadius: 999, background: notifOn ? "var(--xr-success)" : "var(--xr-surface-2)", color: notifOn ? "white" : "var(--xr-text-2)", border: "1px solid var(--xr-border)", fontSize: 11, cursor: "pointer" }}>{notifOn ? "on" : "off"}</button><span style={{ fontSize: 11, color: "var(--xr-text-3)" }}>channel: {notifChannel}{isTauri() ? " (packaged → OS)" : " (browser API)"}</span></span><span style={{ color: "var(--xr-text-3)" }}>autostart</span><span style={{ display: "flex", gap: 8, alignItems: "center" }}>{autostart === null ? <span style={{ fontSize: 11, color: "var(--xr-text-3)" }}>available only in packaged app (Tauri autostart plugin)</span> : <button onClick={() => void nativeSetAutostart(!autostart).then((v) => { if (v !== null) { setAutostart(v); setNote(`autostart ${v ? "enabled" : "disabled"} (opt-in)`); } })} style={{ padding: "4px 10px", borderRadius: 999, background: autostart ? "var(--xr-success)" : "var(--xr-surface-2)", color: autostart ? "white" : "var(--xr-text-2)", border: "1px solid var(--xr-border)", fontSize: 11, cursor: "pointer" }}>{autostart ? "enabled" : "disabled"}</button>}</span><span style={{ color: "var(--xr-text-3)" }}>updates</span><span style={{ display: "flex", gap: 8, alignItems: "center" }}><button onClick={() => void nativeCheckUpdate().then((r) => setUpdateInfo(r.error ? `updater: ${r.error}` : r.available ? `update available: ${r.version}` : "up to date"))} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>check</button><span style={{ fontSize: 11, color: "var(--xr-text-3)" }}>{updateInfo ?? "signed updater — inactive until operator provisions keys"}</span></span></div></section>
          <section style={cardStyle}><div style={railStyle}>Workspaces (GET /workspaces)</div>{(ws?.workspaces ?? []).map((w) => <div key={w.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, background: "var(--xr-surface-2)", borderRadius: 6 }}><span style={{ flex: 1 }}><b style={{ fontSize: 12 }}>{w.name ?? w.id}</b> <span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{w.rootDir}</span></span>{w.id === ws?.active ? <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>active</span> : <button onClick={() => api.workspacesSwitch(w.id!).then(() => load("General")).catch((e) => setNote(`switch: ${e}`))} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>switch</button>}</div>)}</section>
          <section style={cardStyle}><div style={railStyle}>Onboarding (GET /onboarding/status)</div><div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 6, fontSize: 12 }}><span style={{ color: "var(--xr-text-3)" }}>needs setup</span><span style={{ color: onb?.needsSetup ? "var(--xr-warning)" : "var(--xr-success)" }}>{String(onb?.needsSetup ?? "—")}</span></div>{((onb?.reasons ?? []) as string[]).map((r, i) => <div key={i} style={{ fontSize: 11, color: "var(--xr-warning)" }}>· {r}</div>)}<div style={{ marginTop: 8 }}>{onOnboard && <button onClick={onOnboard} style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>Re-run onboarding</button>}</div></section>
        </div>
      )}

      {!loading && tab === "Models" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <section style={cardStyle}><div style={railStyle}>Active routing (GET /config)</div><div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 6, fontSize: 12 }}><span style={{ color: "var(--xr-text-3)" }}>provider</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>{String(config?.provider ?? "—")}</span><span style={{ color: "var(--xr-text-3)" }}>model</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>{String(config?.model ?? "—")}</span><span style={{ color: "var(--xr-text-3)" }}>mode</span><span>{String(config?.mode ?? "—")}</span><span style={{ color: "var(--xr-text-3)" }}>fallback</span><span style={{ fontFamily: "var(--xr-font-mono)" }}>{String(config?.fallbackProvider ?? "—")} / {String(config?.fallbackModel ?? "—")}</span><span style={{ color: "var(--xr-text-3)" }}>routing</span><span>{String(config?.routing ?? "—")}</span><span style={{ color: "var(--xr-text-3)" }}>local enabled</span><span>{String(config?.localEnabled ?? "—")}</span></div></section>
          <section style={cardStyle}><div style={railStyle}>Providers (GET /providers → POST /providers/set)</div>{providers.map((p) => <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, background: "var(--xr-surface-2)", borderRadius: 6 }}><span style={{ flex: 1 }}><b style={{ fontSize: 12 }}>{p.name ?? p.id}</b> {p.local ? <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-3)", border: "1px solid var(--xr-border)", fontSize: 10 }}>local</span> : null} {p.keyless ? <span style={{ padding: "2px 6px", borderRadius: 999, background: "var(--xr-surface-3)", border: "1px solid var(--xr-border)", fontSize: 10 }}>keyless</span> : null}<div style={{ fontSize: 11, color: "var(--xr-text-3)", marginTop: 3 }}>{(p.models ?? []).slice(0, 4).join(", ") || "no models listed"}</div></span><button onClick={() => api.providersSet(p.id).then(() => load("Models")).catch((e) => setNote(`providers/set: ${e}`))} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>set active</button></div>)}<p style={{ fontSize: 11, color: "var(--xr-text-3)" }}>Full Model Center (tests, capabilities, SLOs) lives in Library → Models.</p></section>
        </div>
      )}

      {!loading && tab === "Local" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <section style={cardStyle}><div style={railStyle}>Environment capabilities</div><pre style={{ margin: 0, maxHeight: 260, overflow: "auto", background: "var(--xr-surface-2)", padding: 10, borderRadius: 6, fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{envCaps ? JSON.stringify(envCaps, null, 2).slice(0, 1200) : "—"}</pre></section>
          <section style={cardStyle}><div style={railStyle}>Environment status</div><pre style={{ margin: 0, maxHeight: 260, overflow: "auto", background: "var(--xr-surface-2)", padding: 10, borderRadius: 6, fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{envStatus ? JSON.stringify(envStatus, null, 2).slice(0, 1200) : "—"}</pre></section>
        </div>
      )}

      {!loading && tab === "Automations" && (
        <section style={{ ...cardStyle, maxWidth: 640 }}><div style={railStyle}>Triggers (GET /triggers · POST /triggers/pause)</div><div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 6, fontSize: 12 }}><span style={{ color: "var(--xr-text-3)" }}>pause-all</span><span style={{ color: triggers?.pauseAll ? "var(--xr-warning)" : "var(--xr-success)" }}>{String(triggers?.pauseAll ?? false)}</span><span style={{ color: "var(--xr-text-3)" }}>in-flight</span><span>{String(triggers?.inflight ?? 0)}</span><span style={{ color: "var(--xr-text-3)" }}>registered</span><span>{String((triggers?.triggers ?? []).length)}</span></div>{((triggers?.triggers ?? []) as Record<string, unknown>[]).map((t, i) => <div key={i} style={{ padding: 8, background: "var(--xr-surface-2)", borderRadius: 6, fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{JSON.stringify(t).slice(0, 140)}</div>)}<button onClick={() => api.triggersPause(!(triggers?.pauseAll ?? false)).then(() => load("Automations")).catch((e) => setNote(`triggers: ${e}`))} style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>{triggers?.pauseAll ? "Resume all triggers" : "Pause all triggers"}</button></section>
      )}

      {!loading && tab === "Voice" && (
        <section style={{ ...cardStyle, maxWidth: 720 }}><div style={railStyle}>Voice pipeline (GET /voice/status) — offline, on-device</div><div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 6, fontSize: 12 }}><span style={{ color: "var(--xr-text-3)" }}>session</span><span style={{ color: voice?.state === "idle" ? "var(--xr-text-3)" : "var(--xr-success)" }}>{String(voice?.state ?? "—")}</span><span style={{ color: "var(--xr-text-3)" }}>stt</span><span style={{ color: (voice?.stt as any)?.available ? "var(--xr-success)" : "var(--xr-warning)" }}>{String((voice?.stt as any)?.backend ?? "—")} · {String((voice?.stt as any)?.detail ?? "unavailable")}</span><span style={{ color: "var(--xr-text-3)" }}>tts</span><span style={{ color: (voice?.tts as any)?.available ? "var(--xr-success)" : "var(--xr-warning)" }}>{String((voice?.tts as any)?.engine ?? "—")} · {String((voice?.tts as any)?.detail ?? "unavailable")}</span><span style={{ color: "var(--xr-text-3)" }}>native</span><span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{String((voice?.native as any)?.detail ?? "—")}</span></div><p style={{ fontSize: 12, color: "var(--xr-text-3)" }}>Voice mode lives on rail (mic icon): full-screen avatar overlay with push-to-talk, barge-in, approvals-in-voice and docked mini-avatar that keeps controlling XR while you work. STT/TTS run locally (sherpa-onnx zipformer + Piper); whisper CLI / espeak fallbacks; cloud opt-in only.</p></section>
      )}

      {!loading && tab === "Privacy" && (
        <section style={{ ...cardStyle, maxWidth: 720 }}><div style={railStyle}>Privacy checks (GET /shield/privacy) · score {String(privacy?.score?.score ?? "—")}</div>{(privacy?.score?.checks ?? []).map((c, i) => <div key={i} style={{ fontSize: 12, color: c.ok ? "var(--xr-success)" : "var(--xr-warning)" }}>{c.ok ? "✓" : "·"} {c.name}{c.detail ? ` — ${String(c.detail).slice(0, 100)}` : ""}</div>)}</section>
      )}

      {!loading && tab === "Advanced" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <section style={cardStyle}><div style={railStyle}>Engine config (GET /config)</div><pre style={{ margin: 0, maxHeight: 300, overflow: "auto", background: "var(--xr-surface-2)", padding: 10, borderRadius: 6, fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{config ? JSON.stringify(config, null, 2).slice(0, 1400) : "—"}</pre></section>
          <section style={cardStyle}><div style={railStyle}>Metrics (GET /metrics)</div><pre style={{ margin: 0, maxHeight: 300, overflow: "auto", background: "var(--xr-surface-2)", padding: 10, borderRadius: 6, fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{metrics ? JSON.stringify(metrics, null, 2).slice(0, 1400) : "—"}</pre></section>
        </div>
      )}
    </div>
  );
}
