import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

/* Phase 4 · Model Center — ONE unambiguous view of local runtimes (live
 * probe), cloud BYOK connect, default+fallback pair, capability table.
 * Every number/state below is engine-reported (/models, /providers,
 * /providers/capabilities); keys are written ONLY through the engine's
 * onboarding provider route (secret store) and never touch shell state.
 */

type Runtime = {
  id: string; providerId?: string; label?: string; installed?: boolean;
  running?: boolean; healthy?: boolean; models?: string[]; detail?: string;
};
type ProviderRow = {
  id: string; label?: string; kind?: string; tier?: string; hasKey?: boolean;
  authOk?: boolean; healthy?: boolean; latencyMs?: number | null;
  capabilities?: Record<string, unknown>; defaultModel?: string;
};
type ProvidersView = {
  primary?: string; model?: string; fallback?: string | null; fallbackModel?: string | null;
  providers?: ProviderRow[];
};
type ModelsView = {
  selected?: { runtime?: string; model?: string; routing?: string; enabled?: boolean };
  current?: Runtime | null;
  hardware?: { summary?: string };
  runtimes?: Runtime[];
};
type CapsView = {
  capabilities?: Record<string, boolean>;
  knownModels?: string[];
  credential?: { required?: boolean; available?: boolean };
  health?: { ok?: boolean; latencyMs?: number | null; authOk?: boolean } | null;
};

const CLOUD_IDS = ["openai", "anthropic", "openrouter", "groq", "gemini", "mistral"];

function Check({ ok }: { ok?: boolean }) {
  return ok ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--xr-green)" strokeWidth="2.4" aria-label="yes"><path d="M4 12.5l5 5L20 7" /></svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--xr-red)" strokeWidth="2.4" aria-label="no"><path d="M6 6l12 12M18 6L6 18" /></svg>
  );
}

export function ModelCenter() {
  const [models, setModels] = useState<ModelsView | null>(null);
  const [prov, setProv] = useState<ProvidersView | null>(null);
  const [caps, setCaps] = useState<CapsView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [probeMs, setProbeMs] = useState<number | null | "busy">(null);
  const [connectFor, setConnectFor] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const load = useCallback(() => {
    api.models().then((m) => setModels(m as ModelsView)).catch(() => setModels({}));
    api.providers().then((p) => {
      const v = Array.isArray(p) ? { providers: p } : p;
      setProv(v as ProvidersView);
    }).catch(() => setProv({}));
  }, []);
  useEffect(load, [load]);

  const selRuntime = models?.selected?.runtime ?? "ollama";
  const selModel = models?.selected?.model ?? "";
  const local = (models?.runtimes ?? []).find((r) => r.id === selRuntime) ?? models?.current ?? null;
  const localRunning = Boolean(local?.running);
  const cloudRows = (prov?.providers ?? []).filter((p) => p.kind !== "local" || CLOUD_IDS.includes(String(p.id)));
  const fallbackId = prov?.fallback ?? null;
  const fallbackRow = cloudRows.find((p) => p.id === fallbackId) ?? null;
  const primaryIsLocal = Boolean(prov?.primary && (prov.primary === local?.providerId || String(prov.primary).startsWith("ollama") || String(prov.primary).startsWith("local")));

  useEffect(() => {
    const target = primaryIsLocal ? (local?.providerId ?? selRuntime) : (prov?.primary ?? selRuntime);
    api.providersCapabilities(String(target)).then((c) => setCaps(c as CapsView)).catch(() => setCaps(null));
  }, [prov?.primary, selRuntime, local?.providerId, primaryIsLocal]);

  async function probe() {
    if (!selModel) { setNote("select a local model first"); return; }
    setProbeMs("busy");
    try {
      const r = await api.modelsTest(selRuntime, selModel) as { result?: { ok?: boolean; latencyMs?: number | null; detail?: string } };
      const ms = r.result?.latencyMs ?? null;
      setProbeMs(ms);
      setNote(r.result?.ok ? `probe ok — ${ms ?? "?"} ms round-trip on ${selRuntime}` : `probe: ${r.result?.detail ?? "failed"}`);
    } catch (e) {
      setProbeMs(null);
      setNote(`probe failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function selectModel(model: string) {
    try {
      await api.modelsSelect(selRuntime, model);
      setNote(`selected ${selRuntime} · ${model} (engine persisted + audited)`);
      load();
    } catch (e) {
      setNote(`select failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function testCloud(row: ProviderRow) {
    try {
      const fresh = (await api.providers()) as ProvidersView | ProviderRow[];
      const rows = Array.isArray(fresh) ? fresh : (fresh.providers ?? []);
      const f = rows.find((p) => p.id === row.id);
      if (!f) { setNote(`${row.id}: not in engine provider list`); return; }
      if (!f.hasKey) { setNote(`${row.id}: no key stored — connect first (key goes straight to the engine secret store)`); return; }
      setNote(`${row.id}: ${f.healthy ? `reachable — ${f.latencyMs ?? "?"} ms, auth ok` : f.authOk ? "auth ok, health probe degraded" : `unreachable — ${String((f as { detail?: string }).detail ?? "check key/network")}`}`);
    } catch (e) {
      setNote(`test failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function saveKey(providerId: string) {
    const key = keyDraft.trim();
    if (!key) return;
    setSavingKey(true);
    try {
      const r = await api.onboardingProvider({ providerId, apiKey: key }) as { ok?: boolean; error?: string };
      setNote(r.ok === false ? `connect: ${r.error ?? "rejected"}` : `${providerId}: key stored in the engine secret store (never in the shell)`);
      setKeyDraft("");
      setConnectFor(null);
      load();
    } catch (e) {
      setNote(`connect failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingKey(false);
    }
  }

  async function setDefault(row: ProviderRow) {
    try {
      const fb = localRunning ? { provider: String(local?.providerId ?? selRuntime), model: selModel } : undefined;
      await api.providersSet(row.id, row.defaultModel, fb);
      setNote(`default → ${row.id}${fb ? ` · fallback → local ${selRuntime}` : ""} (engine persisted + audited)`);
      load();
    } catch (e) {
      setNote(`set default failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function makeLocalPrimary() {
    if (!selModel) { setNote("select a local model first"); return; }
    try {
      await api.modelsSelect(selRuntime, selModel, "local-only");
      setNote(`${selRuntime} · ${selModel} is now the primary route (engine persisted)`);
      load();
    } catch (e) {
      setNote(`route change failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const capRows: Array<[string, boolean | undefined]> = caps?.capabilities ? [
    ["streaming", caps.capabilities.streaming],
    ["tools", Boolean(caps.capabilities.toolCalling || caps.capabilities.functionCalling)],
    ["vision", caps.capabilities.vision],
    ["structured output", caps.capabilities.structuredOutput],
    ["reasoning", caps.capabilities.reasoning],
    ["embeddings", caps.capabilities.embeddings],
  ] : [];

  return (
    <div className="mc">
      <div className="section-h">
        <h2>Models &amp; Providers</h2>
        <span className="faint" style={{ fontSize: 12 }}>{models?.hardware?.summary ?? ""}</span>
      </div>

      {/* ONE unambiguous active-pair hero: local primary → cloud fallback */}
      <div className="mc-hero">
        <button className={`mc-hero-card ${localRunning ? "on" : ""}`} onClick={() => void makeLocalPrimary()}
          title={localRunning ? "local runtime is the primary route — click to re-assert local-only routing" : "click to make the selected local model the primary route"}>
          <div className="mc-hero-k faint">LOCAL {primaryIsLocal ? "· ACTIVE" : ""}</div>
          <div className="mc-hero-v">{String(local?.label ?? selRuntime)} · {selModel || "no model selected"}</div>
          <div className={`mc-hero-s ${localRunning ? "green" : "amber"}`}>
            {localRunning ? "● RUNNING LOCALLY" : local?.installed ? "● installed — not running" : "● not installed"}
          </div>
        </button>
        <span className="mc-arrow faint" aria-hidden="true">→</span>
        <div className="mc-hero-card">
          <div className="mc-hero-k faint">CLOUD FALLBACK {prov?.primary && !primaryIsLocal ? "· ACTIVE" : ""}</div>
          <div className="mc-hero-v">{fallbackRow?.label ?? prov?.fallback ?? prov?.primary ?? "none"}</div>
          <div className="mc-hero-s faint">● {fallbackRow ? (fallbackRow.hasKey ? "ready if local fails" : "needs a key") : "configure a provider"}</div>
        </div>
      </div>

      {note && <p className="ob-note mono">{note}</p>}

      <div className="mc-cols">
        <div className="mc-col">
          <div className="card prov mc-card">
            <div className="mc-card-h">
              <b>{String(local?.label ?? selRuntime)}</b>
              <span className="spacer" />
              <button className="chipbtn" onClick={() => void probe()} disabled={probeMs === "busy"}>{probeMs === "busy" ? "probing…" : "probe"}</button>
              {typeof probeMs === "number" && <span className="chip green tiny">{probeMs}ms</span>}
              {probeMs === null && local?.healthy && <span className="chip green tiny">healthy</span>}
              {probeMs !== "busy" && probeMs === null && !local?.healthy && <span className="chip amber tiny">not running</span>}
            </div>
            <div className="mc-sub faint">Available models ({(local?.models ?? []).length})</div>
            <div className="mc-models">
              {(local?.models ?? []).length === 0 && <div className="faint" style={{ fontSize: 12 }}>no models detected for this runtime — {String(local?.detail ?? "install one with your runtime's CLI")}</div>}
              {(local?.models ?? []).map((m) => (
                <button key={m} className={`mc-model ${m === selModel ? "on" : ""}`} onClick={() => void selectModel(m)}>
                  {String(local?.label ?? selRuntime)} · {m}
                  {m === selModel && <span className="chip green tiny">selected</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="card prov mc-card">
            <div className="mc-card-h"><b>Capability</b><span className="spacer" /><span className="faint mono">{String(caps?.credential?.available ? "key stored" : "no key needed")}</span></div>
            {capRows.length === 0 && <div className="faint" style={{ fontSize: 12 }}>no capability data from the engine yet.</div>}
            {capRows.map(([name, ok]) => (
              <div key={name} className="mc-caprow">
                <span>{name}</span>
                <Check ok={ok} />
              </div>
            ))}
          </div>
        </div>

        <div className="mc-col">
          {cloudRows.map((row) => (
            <div key={row.id} className="card prov mc-card">
              <div className="mc-card-h">
                <b>{row.label ?? row.id}</b>
                <span className="spacer" />
                <button className="chipbtn" onClick={() => void testCloud(row)}>
                  Test{row.healthy ? " ✓" : ""}
                </button>
                <button className="chipbtn" onClick={() => void setDefault(row)}>Set default</button>
                <span className={`chip tiny ${row.hasKey ? "green" : "amber"}`}>{row.hasKey ? "key stored" : "no key"}</span>
              </div>
              {prov?.primary === row.id && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>current default · model {prov.model ?? row.defaultModel ?? "—"}</div>}
              {connectFor === row.id ? (
                <div className="mc-connect">
                  <input
                    type="password"
                    value={keyDraft}
                    autoFocus
                    placeholder={`paste ${row.id} key — sent once to the engine secret store`}
                    aria-label={`API key for ${row.id}`}
                    onChange={(e) => setKeyDraft(e.target.value)}
                  />
                  <button className="chipbtn" disabled={savingKey || !keyDraft.trim()} onClick={() => void saveKey(row.id)}>{savingKey ? "…" : "save"}</button>
                  <button className="chipbtn" onClick={() => { setConnectFor(null); setKeyDraft(""); }}>cancel</button>
                </div>
              ) : (
                <div className="mc-connect">
                  <span className="mono faint" style={{ fontSize: 12 }}>{row.hasKey ? "•••• stored engine-side — the shell never sees keys" : "not connected"}</span>
                  <span className="spacer" />
                  <button className="chipbtn" onClick={() => { setConnectFor(row.id); setKeyDraft(""); }}>connect…</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {!localRunning && (
        <div className="mc-banner">
          <span>⚠ No local model running — cloud fallback will be used</span>
          <span className="spacer" />
          <button className="chipbtn" onClick={() => void probe()} title="probe the selected local runtime">probe local</button>
        </div>
      )}
    </div>
  );
}
