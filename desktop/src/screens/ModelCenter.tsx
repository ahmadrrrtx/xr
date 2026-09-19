import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

/** ModelCenter — Phase 2 hardened elite: provider matrix + local runtimes + BYOK + capability table.
 * Tokens var(--xr-*), skeleton/empty/error, motion, a11y.
 */

type Runtime = { id: string; providerId?: string; label?: string; installed?: boolean; running?: boolean; healthy?: boolean; models?: string[]; detail?: string; };
type ProviderRow = { id: string; label?: string; kind?: string; tier?: string; hasKey?: boolean; authOk?: boolean; healthy?: boolean; latencyMs?: number | null; capabilities?: Record<string, unknown>; defaultModel?: string; };
type ProvidersView = { primary?: string; model?: string; fallback?: string | null; fallbackModel?: string | null; providers?: ProviderRow[]; };
type ModelsView = { selected?: { runtime?: string; model?: string; routing?: string; enabled?: boolean }; current?: Runtime | null; hardware?: { summary?: string }; runtimes?: Runtime[]; };
type CapsView = { capabilities?: Record<string, boolean>; knownModels?: string[]; credential?: { required?: boolean; available?: boolean }; health?: { ok?: boolean; latencyMs?: number | null; authOk?: boolean } | null; };

const CLOUD_IDS = ["openai", "anthropic", "openrouter", "groq", "gemini", "mistral"];
function Check({ ok }: { ok?: boolean }) { return <span style={{ color: ok ? "var(--xr-success)" : "var(--xr-danger)", fontWeight: 700 }}>{ok ? "✓" : "✕"}</span>; }

export function ModelCenter() {
  const [models, setModels] = useState<ModelsView | null>(null);
  const [prov, setProv] = useState<ProvidersView | null>(null);
  const [caps, setCaps] = useState<CapsView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [probeMs, setProbeMs] = useState<number | null | "busy">(null);
  const [connectFor, setConnectFor] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    Promise.allSettled([api.models(), api.providers()]).then(([m, p]) => {
      if (m.status === "fulfilled") setModels(m.value as ModelsView); else setModels({});
      if (p.status === "fulfilled") { const v = Array.isArray(p.value) ? { providers: p.value } : p.value; setProv(v as ProvidersView); } else setProv({});
      setLoading(false);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const selRuntime = models?.selected?.runtime ?? "ollama";
  const selModel = models?.selected?.model ?? "";
  const local = (models?.runtimes ?? []).find((r) => r.id === selRuntime) ?? models?.current ?? null;
  const localRunning = Boolean(local?.running);
  const cloudRowsAll = (prov?.providers ?? []).filter((p) => p.kind !== "local" || CLOUD_IDS.includes(String(p.id)));
  const cloudRows = q.trim() ? cloudRowsAll.filter((p) => `${p.id} ${p.label ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())) : cloudRowsAll;
  const fallbackId = prov?.fallback ?? null;
  const fallbackRow = cloudRowsAll.find((p) => p.id === fallbackId) ?? null;
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
    } catch (e) { setProbeMs(null); setNote(`probe failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function selectModel(model: string) {
    try { await api.modelsSelect(selRuntime, model); setNote(`selected ${selRuntime} · ${model} (engine persisted + audited)`); load(); }
    catch (e) { setNote(`select failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function testCloud(row: ProviderRow) {
    try {
      const fresh = (await api.providers()) as ProvidersView | ProviderRow[];
      const rows = Array.isArray(fresh) ? fresh : (fresh.providers ?? []);
      const f = rows.find((p) => p.id === row.id);
      if (!f) { setNote(`${row.id}: not in engine provider list`); return; }
      if (!f.hasKey) { setNote(`${row.id}: no key stored — connect first (key goes straight to engine secret store)`); return; }
      setNote(`${row.id}: ${f.healthy ? `reachable — ${f.latencyMs ?? "?"} ms, auth ok` : f.authOk ? "auth ok, health probe degraded" : `unreachable — ${String((f as { detail?: string }).detail ?? "check key/network")}`}`);
    } catch (e) { setNote(`test failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function saveKey(providerId: string) {
    const key = keyDraft.trim(); if (!key) return;
    setSavingKey(true);
    try {
      const r = await api.onboardingProvider({ providerId, apiKey: key }) as { ok?: boolean; error?: string };
      setNote(r.ok === false ? `connect: ${r.error ?? "rejected"}` : `${providerId}: key stored in engine secret store (never in shell)`);
      setKeyDraft(""); setConnectFor(null); load();
    } catch (e) { setNote(`connect failed: ${e instanceof Error ? e.message : String(e)}`); } finally { setSavingKey(false); }
  }
  async function setDefault(row: ProviderRow) {
    try {
      const fb = localRunning ? { provider: String(local?.providerId ?? selRuntime), model: selModel } : undefined;
      await api.providersSet(row.id, row.defaultModel, fb);
      setNote(`default → ${row.id}${fb ? ` · fallback → local ${selRuntime}` : ""} (engine persisted + audited)`);
      load();
    } catch (e) { setNote(`set default failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function makeLocalPrimary() {
    if (!selModel) { setNote("select a local model first"); return; }
    try { await api.modelsSelect(selRuntime, selModel, "local-only"); setNote(`${selRuntime} · ${selModel} is now primary route (engine persisted)`); load(); }
    catch (e) { setNote(`route change failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  const capRows: Array<[string, boolean | undefined]> = caps?.capabilities ? [["streaming", caps.capabilities.streaming],["tools", Boolean((caps.capabilities as any).toolCalling || (caps.capabilities as any).functionCalling)],["vision", caps.capabilities.vision],["structured output", (caps.capabilities as any).structuredOutput],["reasoning", (caps.capabilities as any).reasoning],["embeddings", (caps.capabilities as any).embeddings]] : [];

  if (loading) {
    return <div style={{ padding: "var(--xr-space-4)", display: "grid", gap: 12 }}>{Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 100, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)" }} />)}</div>;
  }

  return (
    <div style={{ padding: "var(--xr-space-4)", display: "grid", gap: "var(--xr-space-3)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Models & Providers</h2>
        <span style={{ fontSize: 11, color: "var(--xr-text-3)" }}>{models?.hardware?.summary ?? ""} · {prov?.providers?.length ?? 0} providers · {models?.runtimes?.length ?? 0} runtimes</span>
        <span style={{ flex: 1 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search providers — id, label, capability" aria-label="Search providers" style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 11, minWidth: 240 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center" }}>
        <button onClick={() => void makeLocalPrimary()} title={localRunning ? "local runtime is primary — click to re-assert local-only" : "click to make selected local model primary"} style={{ textAlign: "left", padding: 16, borderRadius: "var(--xr-radius-lg)", border: localRunning ? "2px solid var(--xr-success)" : "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer", display: "grid", gap: 6 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--xr-text-3)" }}>LOCAL {primaryIsLocal ? "· ACTIVE" : ""}</div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{String(local?.label ?? selRuntime)} · {selModel || "no model selected"}</div>
          <div style={{ fontSize: 11, color: localRunning ? "var(--xr-success)" : "var(--xr-warning)" }}>{localRunning ? "● RUNNING LOCALLY" : local?.installed ? "● installed — not running" : "● not installed"}</div>
        </button>
        <span style={{ color: "var(--xr-text-3)" }} aria-hidden>→</span>
        <div style={{ padding: 16, borderRadius: "var(--xr-radius-lg)", border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", display: "grid", gap: 6 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--xr-text-3)" }}>CLOUD FALLBACK {prov?.primary && !primaryIsLocal ? "· ACTIVE" : ""}</div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{fallbackRow?.label ?? prov?.fallback ?? prov?.primary ?? "none"}</div>
          <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>● {fallbackRow ? (fallbackRow.hasKey ? "ready if local fails" : "needs a key") : "configure a provider"}</div>
        </div>
      </div>

      {note && <p style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: 6, padding: "8px 12px" }}>{note} <button onClick={() => setNote(null)} style={{ marginLeft: 8, background: "transparent", border: "none", cursor: "pointer" }}>✕</button></p>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <div style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 14, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}><b style={{ fontSize: 13 }}>{String(local?.label ?? selRuntime)}</b><span style={{ flex: 1 }} /><button onClick={() => void probe()} disabled={probeMs === "busy"} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }}>{probeMs === "busy" ? "probing…" : "probe"}</button>{typeof probeMs === "number" && <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>{probeMs}ms</span>}{probeMs === null && local?.healthy && <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>healthy</span>}{probeMs !== "busy" && probeMs === null && !local?.healthy && <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-warning)", color: "white", fontSize: 10 }}>not running</span>}</div>
            <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>Available models ({(local?.models ?? []).length})</div>
            <div style={{ display: "grid", gap: 6 }}>{(local?.models ?? []).length === 0 && <div style={{ fontSize: 12, color: "var(--xr-text-3)" }}>no models detected — {String(local?.detail ?? "install one with your runtime's CLI")}</div>}{(local?.models ?? []).map((m) => <button key={m} onClick={() => void selectModel(m)} style={{ textAlign: "left", padding: "8px 10px", borderRadius: 6, border: m === selModel ? "2px solid var(--xr-accent)" : "1px solid var(--xr-border)", background: m === selModel ? "var(--xr-surface-2)" : "var(--xr-surface-1)", fontFamily: "var(--xr-font-mono)", fontSize: 11, cursor: "pointer" }}>{String(local?.label ?? selRuntime)} · {m}{m === selModel && <span style={{ marginLeft: 8, padding: "2px 6px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>selected</span>}</button>)}</div>
          </div>
          <div style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 14, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}><b style={{ fontSize: 12 }}>Capability</b><span style={{ flex: 1 }} /><span style={{ fontSize: 11, color: "var(--xr-text-3)", fontFamily: "var(--xr-font-mono)" }}>{String(caps?.credential?.available ? "key stored" : "no key needed")}</span></div>
            {capRows.length === 0 && <div style={{ fontSize: 12, color: "var(--xr-text-3)" }}>no capability data from engine yet.</div>}
            {capRows.map(([name, ok]) => <div key={name} style={{ display: "flex", gap: 8, justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--xr-border)" }}><span>{name}</span><Check ok={ok} /></div>)}
          </div>
        </div>

        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          {cloudRows.map((row) => (
            <div key={row.id} style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 14, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}><b style={{ fontSize: 13 }}>{row.label ?? row.id}</b><span style={{ flex: 1 }} /><button onClick={() => void testCloud(row)} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }}>Test{row.healthy ? " ✓" : ""}</button><button onClick={() => void setDefault(row)} style={{ padding: "4px 10px", borderRadius: 999, background: "var(--xr-accent)", color: "white", border: "none", fontSize: 11, cursor: "pointer" }}>Set default</button><span style={{ padding: "2px 8px", borderRadius: 999, background: row.hasKey ? "var(--xr-success)" : "var(--xr-warning)", color: "white", fontSize: 10 }}>{row.hasKey ? "key stored" : "no key"}</span></div>
              {prov?.primary === row.id && <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>current default · model {prov.model ?? row.defaultModel ?? "—"}</div>}
              {connectFor === row.id ? (
                <div style={{ display: "flex", gap: 8 }}><input type="password" value={keyDraft} autoFocus placeholder={`paste ${row.id} key — sent once to engine secret store`} aria-label={`API key for ${row.id}`} onChange={(e) => setKeyDraft(e.target.value)} style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11 }} /><button disabled={savingKey || !keyDraft.trim()} onClick={() => void saveKey(row.id)} style={{ padding: "4px 10px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", fontSize: 11, cursor: "pointer" }}>{savingKey ? "…" : "save"}</button><button onClick={() => { setConnectFor(null); setKeyDraft(""); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>cancel</button></div>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{row.hasKey ? "•••• stored engine-side — shell never sees keys" : "not connected"}</span><span style={{ flex: 1 }} /><button onClick={() => { setConnectFor(row.id); setKeyDraft(""); }} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>connect…</button></div>
              )}
            </div>
          ))}
          {cloudRows.length === 0 && <div style={{ padding: 20, color: "var(--xr-text-3)", fontSize: 12 }}>No providers match search — honest empty. Engine owns provider list, shell never invents.</div>}
        </div>
      </div>

      {!localRunning && <div style={{ padding: "10px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--xr-warning) 15%, transparent)", border: "1px solid var(--xr-warning)", fontSize: 12, display: "flex", gap: 12, alignItems: "center" }}><span>⚠ No local model running — cloud fallback will be used</span><span style={{ flex: 1 }} /><button onClick={() => void probe()} title="probe selected local runtime" style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>probe local</button></div>}
    </div>
  );
}
