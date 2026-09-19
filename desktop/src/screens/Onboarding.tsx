import { useEffect, useMemo, useRef, useState } from "react";
import { api, asList, chatStream, type ProviderInfo } from "../api/client";
import { XrLogo } from "../components/Brand";
import { pushToast } from "../components/ToastBus";

/** Onboarding — hardened elite Phase 1, first-run flow over REAL engine routes only.
 * Tokens var(--xr-*), states skeleton/empty/error, motion 120/200/320, focus cyan, a11y.
 */

type Status = Awaited<ReturnType<typeof api.onboardingStatus>>;
const STEPS = ["Meet XR", "Capabilities", "Local or Cloud", "Connect Model", "Workspace", "Permissions", "Test XR", "Ready"] as const;

export function Onboarding({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [route, setRoute] = useState<"local" | "cloud">("local");
  const [provId, setProvId] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ws, setWs] = useState<{ id?: string; name?: string; rootDir?: string }[]>([]);
  const [activeWs, setActiveWs] = useState<string | null>(null);
  const [trustMode, setTrustMode] = useState<string>("balanced");
  const [testText, setTestText] = useState("Introduce yourself in one sentence.");
  const [testOut, setTestOut] = useState<string | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api.onboardingStatus().then(setStatus).catch(() => setStatus(null));
    api.providers().then((p) => { const list = asList<ProviderInfo>(p, "providers", "items"); setProviders(list); const firstCloud = list.find((x) => x.local !== true); if (firstCloud) setProvId(firstCloud.id); }).catch(() => {});
    api.workspaces().then((w) => { setWs(w.workspaces ?? []); setActiveWs(w.active ?? null); }).catch(() => {});
    api.trust().then((t) => setTrustMode(String(t.mode ?? "balanced"))).catch(() => {});
  }, []);

  const cloudProviders = useMemo(() => providers.filter((p) => p.local !== true), [providers]);
  const localProviders = useMemo(() => providers.filter((p) => p.local === true), [providers]);

  async function connectCloud() {
    if (!provId || !key.trim()) { setSaveNote("provider and API key are required"); return; }
    setSaving(true); setSaveNote(null);
    try {
      const r = await api.onboardingProvider({ providerId: provId, apiKey: key.trim(), model: model.trim() || undefined });
      setKey("");
      if (r.health?.ok) setSaveNote(`key stored in ${r.secretBackend ?? "engine secret store"} · probe ok (${r.health.latencyMs ?? "?"}ms)`);
      else setSaveNote(`key stored in ${r.secretBackend ?? "engine secret store"} · probe: ${r.health?.detail ?? "unreachable right now (saved anyway)"}`);
      pushToast(r.health?.ok ? "ok" : "warn", "Provider saved", r.health?.ok ? `${provId} reachable` : `${provId} saved — probe failed`);
      api.onboardingStatus().then(setStatus).catch(() => {});
    } catch (e) { setSaveNote(`engine rejected: ${e instanceof Error ? e.message : String(e)}`); } finally { setSaving(false); }
  }
  async function chooseLocal() {
    const id = status?.local?.runtime ?? localProviders[0]?.id ?? "ollama";
    try { await api.providersSet(id); setSaveNote(`routing set to local ${id} — engine will use it when healthy`); pushToast("info", "Local route selected", id); }
    catch (e) { setSaveNote(`engine rejected: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function runTest() {
    setTesting(true); setTestOut(""); setTestErr(null);
    const ac = new AbortController(); abortRef.current = ac;
    try {
      await chatStream({ message: testText, mode: "ask" }, (e) => {
        if (e.type === "token") setTestOut((t) => (t ?? "") + (e.text ?? ""));
        if (e.type === "error") setTestErr(String((e as { error?: string }).error ?? "run failed"));
      }, ac.signal);
    } catch (e) { setTestErr(e instanceof Error ? e.message : String(e)); } finally { setTesting(false); }
  }

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", height: "100vh", background: "var(--xr-bg)" }}>
      <aside aria-label="Onboarding steps" style={{ padding: "var(--xr-space-4)", display: "grid", gap: 8, alignContent: "start", background: "var(--xr-surface-1)", borderRight: "1px solid var(--xr-border)" }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 8, background: i === step ? "var(--xr-surface-2)" : "transparent", border: i === step ? "1px solid var(--xr-accent)" : "1px solid transparent", opacity: i < step ? 0.6 : 1 }}>
            <span style={{ width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center", background: i < step ? "var(--xr-success)" : i === step ? "var(--xr-accent)" : "var(--xr-surface-3)", color: i <= step ? "white" : "var(--xr-text-3)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{i < step ? "✓" : i + 1}</span>
            <span style={{ fontSize: 12, fontWeight: i === step ? 600 : 400 }}>{s}</span>
          </div>
        ))}
      </aside>

      <main style={{ padding: "var(--xr-space-6)", overflow: "auto", display: "grid", gap: "var(--xr-space-4)", alignContent: "start" }}>
        {step === 0 && (
          <div style={{ display: "grid", placeItems: "center", gap: 16, textAlign: "center", padding: "var(--xr-space-8) 0" }}>
            <XrLogo height={96} radius={16} />
            <h1 style={{ margin: 0, fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em" }}>XR</h1>
            <p style={{ margin: 0, fontSize: 16, color: "var(--xr-text-2)" }}>The AI Agent You Can Actually Trust</p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--xr-text-3)", maxWidth: 520 }}>XR is a local-first AI workstation: it codes, researches and acts on your computer — and every sensitive action waits for your approval. This setup takes about two minutes.</p>
          </div>
        )}
        {step === 1 && (
          <div style={{ display: "grid", gap: 16 }}>
            <h2 style={{ margin: 0 }}>What XR can do</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {[["</>", "Code & edit", "reads your project, proposes diffs you approve before apply"], ["⌗", "Run & automate", "approval-gated shell, files, git — streamed live"], ["◍", "Research", "source-first reports with citations and content guards"], ["⛨", "Act safely", "risk tiers, budgets, tamper-evident audit — enforced engine-side"]].map(([ic, t, d]) => (
                <div key={t} style={{ padding: 14, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 8 }}>
                  <span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 12, color: "var(--xr-accent)" }}>{ic}</span>
                  <div><b style={{ fontSize: 13 }}>{t}</b><div style={{ fontSize: 11, color: "var(--xr-text-3)", marginTop: 4 }}>{d}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}
        {step === 2 && (
          <div style={{ display: "grid", gap: 16 }}>
            <h2 style={{ margin: 0 }}>Where should XR think?</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <button onClick={() => setRoute("local")} style={{ textAlign: "left", padding: 16, borderRadius: "var(--xr-radius-lg)", border: route === "local" ? "2px solid var(--xr-accent)" : "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer", display: "grid", gap: 6 }}>
                <b>Local model</b><span style={{ fontSize: 11, color: "var(--xr-text-3)" }}>private · free · needs a runtime</span><span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-2)" }}>{status?.local ? `${status.local.runtime} · ${status.local.healthy ? "healthy" : status.local.running ? "running" : "not running"} · ${status.local.installed ?? 0} models` : "probing…"}</span>
              </button>
              <button onClick={() => setRoute("cloud")} style={{ textAlign: "left", padding: 16, borderRadius: "var(--xr-radius-lg)", border: route === "cloud" ? "2px solid var(--xr-accent)" : "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer", display: "grid", gap: 6 }}>
                <b>Cloud provider</b><span style={{ fontSize: 11, color: "var(--xr-text-3)" }}>your own key (BYOK) · stored in OS secret store</span><span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-2)" }}>{status?.cloud ? `${status.cloud.configured ?? 0} configured · ${status.cloud.ready ?? 0} reachable` : "probing…"}</span>
              </button>
            </div>
            {status?.reasons?.length ? <p style={{ fontSize: 11, color: "var(--xr-text-3)", fontFamily: "var(--xr-font-mono)" }}>engine says: {status.reasons.join(" ")}</p> : null}
          </div>
        )}
        {step === 3 && (
          <div style={{ display: "grid", gap: 16 }}>
            <h2 style={{ margin: 0 }}>{route === "local" ? "Use your local runtime" : "Connect a provider"}</h2>
            {route === "local" ? (
              <div style={{ display: "grid", gap: 12 }}>
                <p style={{ fontSize: 12, color: "var(--xr-text-2)", margin: 0 }}>{status?.local?.healthy ? `${status.local.runtime} is healthy — XR will route tasks to it.` : `No healthy local runtime yet. Install Ollama (ollama.com) and pull a model, e.g. "ollama pull qwen2.5:7b". You can still continue; XR falls back honestly.`}</p>
                <button style={{ padding: "8px 14px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer", width: "fit-content" }} onClick={chooseLocal}>Route to local {status?.local?.runtime ?? "ollama"}</button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12, maxWidth: 400 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--xr-text-2)" }}>Provider<select value={provId} onChange={(e) => setProvId(e.target.value)} aria-label="Provider" style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 12 }}>{cloudProviders.length === 0 && <option value="">no cloud providers known</option>}{cloudProviders.map((p) => <option key={p.id} value={p.id}>{String((p as { label?: unknown }).label ?? p.name ?? p.id)}</option>)}</select></label>
                <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--xr-text-2)" }}>API key (sent once to engine secret store)<input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" autoComplete="off" aria-label="API key" style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 12 }} /></label>
                <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--xr-text-2)" }}>Model (optional)<input value={model} onChange={(e) => setModel(e.target.value)} placeholder="default for this provider" aria-label="Model" style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 12 }} /></label>
                <button disabled={saving} onClick={connectCloud} style={{ padding: "8px 14px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "saving…" : "Save key & test connection"}</button>
              </div>
            )}
            {saveNote && <p style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-2)" }}>{saveNote}</p>}
          </div>
        )}
        {step === 4 && (
          <div style={{ display: "grid", gap: 12 }}>
            <h2 style={{ margin: 0 }}>Workspace</h2><p style={{ fontSize: 12, color: "var(--xr-text-3)", margin: 0 }}>Where XR works. You can open more projects later from Projects.</p>
            <div style={{ display: "grid", gap: 8 }}>{ws.map((w) => <div key={w.id} style={{ padding: 12, borderRadius: 8, border: w.id === activeWs ? "2px solid var(--xr-accent)" : "1px solid var(--xr-border)", background: "var(--xr-surface-1)", display: "flex", gap: 12, alignItems: "center" }}><div><b style={{ fontSize: 13 }}>{w.name ?? w.id}</b><div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{w.rootDir}</div></div>{w.id === activeWs ? <span style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>active</span> : <button style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }} onClick={() => api.workspacesSwitch(String(w.id)).then(() => setActiveWs(String(w.id))).catch((e) => setSaveNote(`switch: ${e}`))}>switch</button>}</div>)}</div>
          </div>
        )}
        {step === 5 && (
          <div style={{ display: "grid", gap: 12 }}>
            <h2 style={{ margin: 0 }}>Permissions & trust</h2><p style={{ fontSize: 12, color: "var(--xr-text-3)", margin: 0 }}>XR enforces these engine-side. You can change them anytime in Trust Center.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {(["careful", "balanced", "autonomous"] as const).map((m) => <button key={m} onClick={() => api.trustModeSet(m).then(() => setTrustMode(m)).catch(() => {})} style={{ textAlign: "left", padding: 14, borderRadius: "var(--xr-radius-lg)", border: trustMode === m ? "2px solid var(--xr-accent)" : "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer", display: "grid", gap: 6 }}><b>{m[0].toUpperCase() + m.slice(1)}</b><span style={{ fontSize: 11, color: "var(--xr-text-3)" }}>{m === "careful" ? "approves more, risks less" : m === "balanced" ? "tool-declared risk tiers" : "fewer prompts — high/critical still always ask"}</span></button>)}
            </div>
            <p style={{ fontSize: 11, color: "var(--xr-text-3)", fontFamily: "var(--xr-font-mono)" }}>shell approval required: {status?.config?.approval ? "yes" : "no"} · memory {status?.config?.memory ? "on" : "off"} · voice {status?.config?.voice ? "on" : "off"}</p>
          </div>
        )}
        {step === 6 && (
          <div style={{ display: "grid", gap: 12 }}>
            <h2 style={{ margin: 0 }}>Test XR</h2>
            <div style={{ display: "flex", gap: 8, maxWidth: 480 }}><input value={testText} onChange={(e) => setTestText(e.target.value)} aria-label="Test prompt" style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 12 }} /><button disabled={testing} onClick={runTest} style={{ padding: "8px 14px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer", opacity: testing ? 0.6 : 1 }}>{testing ? "thinking…" : "Run"}</button></div>
            {testOut && <pre style={{ padding: 12, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: 8, fontFamily: "var(--xr-font-mono)", fontSize: 12, whiteSpace: "pre-wrap" }}>{testOut}</pre>}
            {testErr && <div style={{ padding: 12, background: "color-mix(in srgb, var(--xr-danger) 10%, transparent)", border: "1px solid var(--xr-danger)", borderRadius: 8, fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{testErr}<div style={{ color: "var(--xr-text-3)", marginTop: 6 }}>— a provider must be reachable (previous step). The error above is engine's own words.</div></div>}
          </div>
        )}
        {step === 7 && (
          <div style={{ display: "grid", placeItems: "center", gap: 16, textAlign: "center", padding: "var(--xr-space-8) 0" }}>
            <h1 style={{ fontSize: 30, margin: 0 }}>You're set.</h1><p style={{ fontSize: 12, color: "var(--xr-text-3)", margin: 0 }}>XR remembers this setup. Everything is re-runnable from Settings or ⌘K.</p>
            <button onClick={() => { api.onboardingComplete().catch(() => {}); onDone(); }} style={{ padding: "12px 24px", borderRadius: 999, background: "var(--xr-accent)", color: "white", border: "none", fontWeight: 600, cursor: "pointer" }}>Enter XR</button>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: "var(--xr-space-6)", paddingTop: "var(--xr-space-4)", borderTop: "1px solid var(--xr-border)" }}>
          <button onClick={onSkip} style={{ padding: "8px 14px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "transparent", cursor: "pointer", fontSize: 12 }}>Skip for now</button>
          <span style={{ flex: 1 }} />
          {step > 0 && step < 7 && <button onClick={back} style={{ padding: "8px 14px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer", fontSize: 12 }}>Back</button>}
          {step < 7 && <button onClick={next} style={{ padding: "8px 14px", borderRadius: 999, background: "var(--xr-accent)", color: "white", border: "none", cursor: "pointer", fontSize: 12 }}>Continue</button>}
        </div>
      </main>
    </div>
  );
}
