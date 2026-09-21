import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { LOCALES, getLocale, setLocale, subscribeLocale } from "../i18n";
import { api, asList, type ProviderInfo, type ShieldStatus, type TriggersState } from "../api/client";
import { notificationsEnabled, setNotificationsEnabled, requestNotificationPermission, notificationChannel } from "../notify";
import {
  getDensity,
  getTheme,
  isLightActive,
  setDensity,
  setTheme,
  type Density,
  type ThemePref,
} from "../prefs";
import { isTauri, nativeAutostartStatus, nativeSetAutostart, nativeCheckUpdate } from "../tauri-bridge";
import { README_HERO_SRC } from "../components/Brand";

const TABS = ["General", "Models", "Local", "Automations", "Voice", "Privacy", "Advanced"] as const;
type Tab = (typeof TABS)[number];

/**
 * Settings (Phase 1–4 shell per master plan): general / models / local /
 * automations / voice / privacy / advanced. Every value is engine-reported;
 * writers forward to engine routes (/providers/set, /workspaces/switch,
 * /triggers/pause). No policy is computed in the shell (SEC-07).
 */
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
  /* Phase 1 · appearance prefs (prefs.ts owns them; this is a view). */
  const [themeChoice, setThemeChoice] = useState<ThemePref>(getTheme());
  const [density, setDensityChoice] = useState<Density>(getDensity());
  /* Phase 5 · i18n locale picker state. */
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  /* Phase 5 · native matrix opt-ins (honest about host capabilities). */
  const [notifOn, setNotifOn] = useState(notificationsEnabled());
  const [notifChannel, setNotifChannel] = useState<string>("…");
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [updateInfo, setUpdateInfo] = useState<string | null>(null);
  useEffect(() => {
    void notificationChannel().then(setNotifChannel);
    void nativeAutostartStatus().then(setAutostart);
    // Report the OS motion preference rather than assuming: a user who set
    // "reduce motion" system-wide must see that XR honored it.
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

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
    }
    if (t === "Automations") api.triggers().then(setTriggers).catch(() => setTriggers(null));
    if (t === "Voice") {
      api.voiceStatus().then(setVoice).catch(() => setVoice(null));
    }
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
          {/* Phase 3 · About — the official readme hero (winged avatar +
              lockup) on the identity surface, exactly as provided. */}
          <section className="tc-card about-card">
            <img className="about-hero" src={README_HERO_SRC} alt="XR — The AI Agent You Can Actually Trust" />
            <div className="kv2">
              <span className="k">product</span><span>XR Desktop — a local-first AI workstation</span>
              <span className="k">engine</span><span className="mono">{version ?? "—"}</span>
              <span className="k">license</span><span>MIT · no telemetry · BYOK</span>
            </div>
          </section>
          <section className="tc-card">
            <div className="rail-h">System</div>
            <div className="kv2">
              <span className="k">engine</span><span className="mono">{version ?? "—"}</span>
              <span className="k">daemon</span><span className="tl-ok">connected</span>
              <span className="k">shell</span><span>XR Desktop · phase 6 chrome</span>
            </div>
          </section>
          {/* Phase 1 · D-05 — appearance. The tokens, the media query and the
              pre-paint script all existed, but NOTHING in the product let a
              user choose: theme and density were unreachable without editing
              localStorage by hand. These controls write through prefs.ts (the
              single source of truth) so <html> attributes, color-scheme and
              every screen update together. */}
          <section className="tc-card">
            <div className="rail-h">Appearance</div>
            <div className="kv2">
              <span className="k">theme</span>
              <span className="seg" role="radiogroup" aria-label="Theme">
                {(["dark", "light", "void", "system"] as const).map((t) => (
                  <button
                    key={t}
                    role="radio"
                    aria-checked={themeChoice === t}
                    className={`segbtn ${themeChoice === t ? "on" : ""}`}
                    onClick={() => { setTheme(t); setThemeChoice(t); setNote(`theme: ${t}${t === "system" ? ` (following OS → ${isLightActive() ? "light" : "dark"})` : ""}`); }}
                  >{t === "void" ? "void (minimal)" : t}</button>
                ))}
              </span>
              <span className="k">density</span>
              <span className="seg" role="radiogroup" aria-label="Interface density">
                {(["comfortable", "compact"] as const).map((d) => (
                  <button
                    key={d}
                    role="radio"
                    aria-checked={density === d}
                    className={`segbtn ${density === d ? "on" : ""}`}
                    onClick={() => { setDensity(d); setDensityChoice(d); setNote(`density: ${d} — spacing only, type size is unchanged for legibility`); }}
                  >{d}</button>
                ))}
              </span>
              <span className="k">motion</span>
              <span className="faint">
                {prefersReducedMotion ? "reduced — following the OS setting" : "full — reduced-motion is honored automatically when the OS asks for it"}
              </span>
              {/* Phase 5 · i18n — en/es/ur core-chrome catalog, persisted. */}
              <span className="k">language</span>
              <span className="seg" role="radiogroup" aria-label="Interface language">
                {LOCALES.map((l) => (
                  <button
                    key={l.id}
                    role="radio"
                    aria-checked={locale === l.id}
                    className={`segbtn ${locale === l.id ? "on" : ""}`}
                    onClick={() => { setLocale(l.id); setNote(`language: ${l.id} — core chrome translated; domain screens remain English (recorded limitation)`); }}
                  >{l.label}</button>
                ))}
              </span>
            </div>
          </section>
          <section className="tc-card">
            <div className="rail-h">Phase 5 · OS integration (opt-in)</div>
            <div className="kv2">
              <span className="k">notifications</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className={`chipbtn ${notifOn ? "green" : ""}`}
                  onClick={() => {
                    const next = !notifOn;
                    if (next) void requestNotificationPermission().then(() => void notificationChannel().then(setNotifChannel));
                    setNotificationsEnabled(next); setNotifOn(next);
                    setNote(next ? "notifications on — approval due / run done (opt-in honored)" : "notifications off");
                  }}
                >{notifOn ? "on" : "off"}</button>
                <span className="faint">channel: {notifChannel}{isTauri() ? " (packaged app → OS notifications)" : " (browser Notification API)"}</span>
              </span>
              <span className="k">autostart</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {autostart === null ? (
                  <span className="faint">available only in the packaged app (Tauri autostart plugin)</span>
                ) : (
                  <button
                    className={`chipbtn ${autostart ? "green" : ""}`}
                    onClick={() => void nativeSetAutostart(!autostart).then((v) => { if (v !== null) { setAutostart(v); setNote(`autostart ${v ? "enabled" : "disabled"} (opt-in)`); } })}
                  >{autostart ? "enabled" : "disabled"}</button>
                )}
              </span>
              <span className="k">updates</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="chipbtn" onClick={() => void nativeCheckUpdate().then((r) => setUpdateInfo(r.error ? `updater: ${r.error}` : r.available ? `update available: ${r.version}` : "up to date"))}>check</button>
                <span className="faint">{updateInfo ?? "signed updater — inactive until operator provisions keys (docs/release/UPDATER.md)"}</span>
              </span>
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
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              {onOnboard && <button className="chipbtn" onClick={onOnboard}>Re-run onboarding</button>}
            </div>
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
        <section className="tc-card" style={{ maxWidth: 720 }}>
          <div className="rail-h">Voice pipeline (GET /voice/status) — offline, on-device</div>
          <div className="kv2">
            <span className="k">session</span><span className={voice?.state === "idle" ? "" : "tl-ok"}>{String(voice?.state ?? "—")}</span>
            <span className="k">stt</span>
            <span className={(voice?.stt as Record<string, unknown> | undefined)?.available ? "tl-ok" : "tl-wait"}>
              {String((voice?.stt as Record<string, unknown> | undefined)?.backend ?? "—")} · {String((voice?.stt as Record<string, unknown> | undefined)?.detail ?? "unavailable")}
            </span>
            <span className="k">tts</span>
            <span className={(voice?.tts as Record<string, unknown> | undefined)?.available ? "tl-ok" : "tl-wait"}>
              {String((voice?.tts as Record<string, unknown> | undefined)?.engine ?? "—")} · {String((voice?.tts as Record<string, unknown> | undefined)?.detail ?? "unavailable")}
            </span>
            <span className="k">native</span><span className="mono">{String((voice?.native as Record<string, unknown> | undefined)?.detail ?? "—")}</span>
          </div>
          <p className="faint" style={{ fontSize: 12 }}>
            Voice mode lives on the rail (mic icon): full-screen avatar overlay with push-to-talk, barge-in,
            approvals-in-voice and a docked mini-avatar that keeps controlling XR while you work. STT/TTS run
            locally (sherpa-onnx zipformer + Piper); whisper CLI / espeak are fallbacks; cloud is opt-in only.
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
