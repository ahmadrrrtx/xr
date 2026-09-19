import { useEffect, useMemo, useRef, useState } from "react";
import { HERO_SRC } from "../components/Brand";
import { api, asList, chatStream, type ProviderInfo } from "../api/client";
import { XrLogo } from "../components/Brand";
import { pushToast } from "../components/ToastBus";

type Status = Awaited<ReturnType<typeof api.onboardingStatus>>;

const STEPS = ["Meet XR", "Capabilities", "Local or Cloud", "Connect Model", "Workspace", "Permissions", "Test XR", "Ready"] as const;

/**
 * Phase 1 · Onboarding — first-run flow over REAL engine routes only:
 * /onboarding/status · /onboarding/provider · /providers/set · /workspaces ·
 * /trust/mode · /chat (test) · /onboarding/complete. Keys are POSTed straight
 * to the engine secret store; the shell never persists them.
 */
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
    api.providers().then((p) => {
      const list = asList<ProviderInfo>(p, "providers", "items");
      setProviders(list);
      const firstCloud = list.find((x) => x.local !== true);
      if (firstCloud) setProvId(firstCloud.id);
    }).catch(() => {});
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
      setKey(""); // never keep the key in renderer state after the POST
      if (r.health?.ok) setSaveNote(`key stored in ${r.secretBackend ?? "engine secret store"} · probe ok (${r.health.latencyMs ?? "?"}ms)`);
      else setSaveNote(`key stored in ${r.secretBackend ?? "engine secret store"} · probe: ${r.health?.detail ?? "unreachable right now (saved anyway)"}`);
      pushToast(r.health?.ok ? "ok" : "warn", "Provider saved", r.health?.ok ? `${provId} reachable` : `${provId} saved — probe failed`);
      api.onboardingStatus().then(setStatus).catch(() => {});
    } catch (e) {
      setSaveNote(`engine rejected: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function chooseLocal() {
    const id = status?.local?.runtime ?? localProviders[0]?.id ?? "ollama";
    try {
      await api.providersSet(id);
      setSaveNote(`routing set to local ${id} — engine will use it when healthy`);
      pushToast("info", "Local route selected", id);
    } catch (e) {
      setSaveNote(`engine rejected: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function runTest() {
    setTesting(true); setTestOut(""); setTestErr(null);
    const ac = new AbortController(); abortRef.current = ac;
    try {
      await chatStream({ message: testText, mode: "ask" }, (e) => {
        if (e.type === "token") setTestOut((t) => (t ?? "") + (e.text ?? ""));
        if (e.type === "error") setTestErr(String((e as { error?: string }).error ?? "run failed"));
      }, ac.signal);
    } catch (e) {
      setTestErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="ob">
      <aside className="ob-rail" aria-label="Onboarding steps">
        {STEPS.map((s, i) => (
          <div key={s} className={i === step ? "ob-step on" : i < step ? "ob-step done" : "ob-step"}>
            <span className="ob-n mono">{i + 1}</span>
            <span className="ob-s">{s}</span>
          </div>
        ))}
      </aside>

      <main className="ob-main">
        {step === 0 && (
          <div className="ob-hero">
            {/* Official brand asset (uploads/xr-superior-hero-3.png), resized
                to 1200px and encoded as WebP: 59 KB instead of 2.1 MB for a
                slot that is never wider than ~700 CSS px. All three target
                webviews (WebView2, WKWebView, WebKitGTK) decode WebP. */}
            <img className="ob-banner" src={HERO_SRC} alt="" aria-hidden="true" />
            <XrLogo height={96} radius={16} />
            <h1 className="ob-title">XR</h1>
            <p className="ob-tag">The AI Agent You Can Actually Trust</p>
            <p className="faint ob-copy">
              XR is a local-first AI workstation: it codes, researches and acts on your computer —
              and every sensitive action waits for your approval. This setup takes about two minutes.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="ob-caps">
            <h2>What XR can do</h2>
            <div className="ob-cap-grid">
              {[
                ["</>", "Code & edit", "reads your project, proposes diffs you approve before apply"],
                ["⌗", "Run & automate", "approval-gated shell, files, git — streamed live"],
                ["◍", "Research", "source-first reports with citations and content guards"],
                ["⛨", "Act safely", "risk tiers, budgets, tamper-evident audit — enforced engine-side"],
              ].map(([ic, t, d]) => (
                <div key={t} className="ob-cap">
                  <span className="ob-cap-ic mono">{ic}</span>
                  <div><b>{t}</b><div className="faint">{d}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2>Where should XR think?</h2>
            <div className="ob-choice">
              <button className={route === "local" ? "ob-card on" : "ob-card"} onClick={() => setRoute("local")}>
                <b>Local model</b>
                <span className="faint">private · free · needs a runtime</span>
                <span className="ob-live mono">
                  {status?.local ? `${status.local.runtime} · ${status.local.healthy ? "healthy" : status.local.running ? "running" : "not running"} · ${status.local.installed ?? 0} models` : "probing…"}
                </span>
              </button>
              <button className={route === "cloud" ? "ob-card on" : "ob-card"} onClick={() => setRoute("cloud")}>
                <b>Cloud provider</b>
                <span className="faint">your own key (BYOK) · stored in the OS secret store</span>
                <span className="ob-live mono">{status?.cloud ? `${status.cloud.configured ?? 0} configured · ${status.cloud.ready ?? 0} reachable` : "probing…"}</span>
              </button>
            </div>
            {status?.reasons?.length ? <p className="ob-note faint">engine says: {status.reasons.join(" ")}</p> : null}
          </div>
        )}

        {step === 3 && (
          <div>
            <h2>{route === "local" ? "Use your local runtime" : "Connect a provider"}</h2>
            {route === "local" ? (
              <div className="ob-form">
                <p className="faint">
                  {status?.local?.healthy
                    ? `${status.local.runtime} is healthy — XR will route tasks to it.`
                    : `No healthy local runtime yet. Install Ollama (ollama.com) and pull a model, e.g. "ollama pull qwen2.5:7b". You can still continue; XR falls back honestly.`}
                </p>
                <button className="btn" onClick={chooseLocal}>Route to local {status?.local?.runtime ?? "ollama"}</button>
              </div>
            ) : (
              <div className="ob-form">
                <label className="ob-lab">Provider
                  <select value={provId} onChange={(e) => setProvId(e.target.value)} aria-label="Provider">
                    {cloudProviders.length === 0 && <option value="">no cloud providers known</option>}
                    {cloudProviders.map((p) => <option key={p.id} value={p.id}>{String((p as { label?: unknown }).label ?? p.name ?? p.id)}</option>)}
                  </select>
                </label>
                <label className="ob-lab">API key (sent once to the engine secret store)
                  <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" autoComplete="off" aria-label="API key" />
                </label>
                <label className="ob-lab">Model (optional)
                  <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="default for this provider" aria-label="Model" />
                </label>
                <button className="btn" disabled={saving} onClick={connectCloud}>{saving ? "saving…" : "Save key & test connection"}</button>
              </div>
            )}
            {saveNote && <p className="ob-note mono">{saveNote}</p>}
          </div>
        )}

        {step === 4 && (
          <div>
            <h2>Workspace</h2>
            <p className="faint">Where XR works. You can open more projects later from Projects.</p>
            <div className="ob-ws">
              {ws.map((w) => (
                <div key={w.id} className={w.id === activeWs ? "ob-card on" : "ob-card"}>
                  <b>{w.name ?? w.id}</b>
                  <span className="mono faint">{w.rootDir}</span>
                  {w.id === activeWs ? <span className="chip green">active</span> : (
                    <button className="chipbtn" onClick={() => api.workspacesSwitch(String(w.id)).then(() => setActiveWs(String(w.id))).catch((e) => setSaveNote(`switch: ${e}`))}>switch</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            <h2>Permissions & trust</h2>
            <p className="faint">XR enforces these engine-side. You can change them anytime in the Trust Center.</p>
            <div className="ob-trust">
              {(["careful", "balanced", "autonomous"] as const).map((m) => (
                <button key={m} className={trustMode === m ? "ob-card on" : "ob-card"} onClick={() => api.trustModeSet(m).then(() => setTrustMode(m)).catch(() => {})}>
                  <b>{m[0].toUpperCase() + m.slice(1)}</b>
                  <span className="faint">
                    {m === "careful" ? "approves more, risks less" : m === "balanced" ? "tool-declared risk tiers" : "fewer prompts — high/critical still always ask"}
                  </span>
                </button>
              ))}
            </div>
            <p className="ob-note faint">
              shell approval required: {status?.config?.approval ? "yes" : "no"} · memory {status?.config?.memory ? "on" : "off"} · voice {status?.config?.voice ? "on" : "off"}
            </p>
          </div>
        )}

        {step === 6 && (
          <div>
            <h2>Test XR</h2>
            <div className="ob-form">
              <label className="ob-lab">Ask something
                <input value={testText} onChange={(e) => setTestText(e.target.value)} aria-label="Test prompt" />
              </label>
              <button className="btn" disabled={testing} onClick={runTest}>{testing ? "thinking…" : "Run"}</button>
            </div>
            {testOut && <pre className="ob-out mono">{testOut}</pre>}
            {testErr && (
              <div className="ob-err mono">
                {testErr}
                <div className="faint">— a provider must be reachable (previous step). The error above is the engine's own words.</div>
              </div>
            )}
          </div>
        )}

        {step === 7 && (
          <div className="ob-hero">
            <h1 className="ob-title" style={{ fontSize: 30 }}>You're set.</h1>
            <p className="faint">XR remembers this setup. Everything is re-runnable from Settings or ⌘K.</p>
            <button className="btn big" onClick={() => { api.onboardingComplete().catch(() => {}); onDone(); }}>Enter XR</button>
          </div>
        )}

        <div className="ob-foot">
          <button className="ghostbtn" onClick={onSkip}>Skip for now</button>
          <span className="spacer" />
          {step > 0 && step < 7 && <button className="ghostbtn" onClick={back}>Back</button>}
          {step < 7 && <button className="btn" onClick={next}>Continue</button>}
        </div>
      </main>
    </div>
  );
}
