import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ResearchJobV } from "../api/client";

/** Research — Phase 2 hardened elite, source-first workspace over engine registry.
 * Tokens var(--xr-*), skeleton/empty/error, motion, a11y, real wiring only.
 */

export function Research() {
  const [jobs, setJobs] = useState<ResearchJobV[]>([]);
  const [sel, setSel] = useState<ResearchJobV | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [qFilter, setQFilter] = useState("");
  const selRef = useRef<string | null>(null);
  selRef.current = sel?.id ?? null;

  const load = useCallback(() => {
    api.researchJobs().then((r) => {
      setJobs(r.jobs ?? []);
      const id = selRef.current;
      if (id) api.researchJob(id).then((j) => setSel(j.job ?? null)).catch(() => undefined);
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);

  async function start() {
    const q = query.trim(); if (!q || busy) return;
    setBusy(true); setNote(null);
    try { const r = await api.researchSearch(q); if (r.job) { setSel(r.job); setNote(`job ${r.job.id} · ${r.job.state}`); } load(); }
    catch (e) { setNote(`research failed: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  }
  async function cancel(id: string) {
    try { const r = await api.researchCancel(id); setNote(r.ok ? `cancelled ${id}` : `engine: ${r.error ?? "cannot cancel"}`); load(); }
    catch (e) { setNote(`cancel failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  const answer = sel?.result?.answer ?? sel?.result?.text ?? sel?.result?.report ?? null;
  const filtered = qFilter.trim() ? jobs.filter((j) => `${j.request?.query ?? j.kind ?? j.id} ${j.state}`.toLowerCase().includes(qFilter.trim().toLowerCase())) : jobs;

  if (loading) {
    return <div style={{ padding: "var(--xr-space-4)", display: "grid", gridTemplateColumns: "280px 1fr", gap: 12 }}>{Array.from({ length: 4 }).map((_, i) => <div key={i} style={{ height: 80, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)" }} />)}</div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "var(--xr-space-3)", height: "100%", minHeight: 0, padding: "var(--xr-space-3)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", overflow: "hidden", minHeight: 0 }}>
        <div style={{ padding: "14px 14px 8px", display: "flex", gap: 8, alignItems: "center" }}><h2 style={{ margin: 0, fontSize: 16 }}>Research</h2><span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{jobs.length} jobs</span></div>
        <form onSubmit={(e) => { e.preventDefault(); void start(); }} style={{ padding: "0 12px", display: "flex", gap: 8 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask XR to research… (source-first, citations)" aria-label="Research query" style={{ flex: 1, padding: "8px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 12 }} />
          <button disabled={busy} type="submit" style={{ padding: "8px 14px", borderRadius: 999, background: "var(--xr-accent)", color: "white", border: "none", fontSize: 11, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>{busy ? "working…" : "Research"}</button>
        </form>
        <div style={{ padding: "0 12px" }}><input value={qFilter} onChange={(e) => setQFilter(e.target.value)} placeholder="Filter jobs — query, state" aria-label="Filter research jobs" style={{ width: "100%", padding: "6px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }} /></div>
        {note && <p style={{ margin: "0 12px", fontFamily: "var(--xr-font-mono)", fontSize: 11, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", borderRadius: 6, padding: "6px 10px" }}>{note} <button onClick={() => setNote(null)} style={{ marginLeft: 8, background: "transparent", border: "none", cursor: "pointer" }}>✕</button></p>}
        <div style={{ flex: 1, overflow: "auto", display: "grid", gap: 4, padding: "8px 8px", alignContent: "start" }}>
          {filtered.length === 0 && <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--xr-text-3)" }}>{jobs.length === 0 ? "no research jobs yet — queries run through engine's source-first pipeline (citations + content guards)." : "no jobs match filter — honest empty."}</div>}
          {filtered.map((j) => (
            <button key={j.id} onClick={() => setSel(j)} style={{ textAlign: "left", display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 8, border: sel?.id === j.id ? "2px solid var(--xr-accent)" : "1px solid var(--xr-border)", background: sel?.id === j.id ? "var(--xr-surface-2)" : "var(--xr-surface-1)", cursor: "pointer" }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: /fail|error/.test(j.state ?? "") ? "var(--xr-danger)" : /run|work/.test(j.state ?? "") ? "var(--xr-accent)" : /done|complete/.test(j.state ?? "") ? "var(--xr-success)" : "var(--xr-text-3)", flexShrink: 0 }} aria-hidden />
              <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{String(j.request?.query ?? j.kind ?? j.id).slice(0, 60)}</span>
              <span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 10, color: "var(--xr-text-3)" }}>{j.state}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 16, overflow: "auto", minHeight: 0, display: "grid", gap: 12, alignContent: "start" }}>
        {!sel && <div style={{ color: "var(--xr-text-3)", padding: 24, fontSize: 12 }}>select a job or start a research run — source-first pipeline, citations + content guards enforced engine-side.</div>}
        {sel && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><b style={{ fontSize: 14 }}>{String(sel.request?.query ?? sel.kind ?? sel.id).slice(0, 120)}</b><span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontSize: 10 }}>{String(sel.state ?? "unknown")}</span>{/run|work|pending|queue/.test(String(sel.state ?? "")) && <button onClick={() => void cancel(sel.id)} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>cancel</button>}</div>
            {sel.error && <div style={{ padding: 12, background: "color-mix(in srgb, var(--xr-danger) 10%, transparent)", border: "1px solid var(--xr-danger)", borderRadius: 8, fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{sel.error}<div style={{ color: "var(--xr-text-3)", marginTop: 6 }}>— engine's own error for this job.</div></div>}
            {answer && <pre style={{ margin: 0, padding: 14, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13, lineHeight: 1.6 }}>{String(answer)}</pre>}
            {!answer && !sel.error && <div style={{ padding: "10px 0", fontSize: 12, color: "var(--xr-text-3)" }}>{/run|work|pending|queue/.test(String(sel.state ?? "")) ? "working — sources gathered; view refreshes live." : "no answer payload in this job record — honest empty."}</div>}
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Sources · {(sel.sources ?? []).length}</div>
              {(sel.sources ?? []).length === 0 && <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>no sources yet — engine collects citations live.</div>}
              {(sel.sources ?? []).map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", background: "var(--xr-surface-2)", borderRadius: 6, fontSize: 11 }}>
                  <span style={{ fontFamily: "var(--xr-font-mono)", color: "var(--xr-text-3)" }}>[{i + 1}]</span>
                  <span style={{ fontFamily: "var(--xr-font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{String(s.url ?? s.title ?? "source")}</span>
                  {s.trust ? <span style={{ padding: "2px 6px", borderRadius: 999, background: String(s.trust) === "verified" ? "var(--xr-success)" : "var(--xr-warning)", color: "white", fontSize: 10 }}>{String(s.trust)}</span> : null}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
