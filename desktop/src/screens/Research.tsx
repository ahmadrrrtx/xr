import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ResearchJobV } from "../api/client";

/**
 * Phase 3 · Research — source-first research workspace over the engine's
 * research job registry. Jobs, states, sources, citations and errors are all
 * engine-reported; the shell renders and forwards (start/cancel) only.
 */
export function Research() {
  const [jobs, setJobs] = useState<ResearchJobV[]>([]);
  const [sel, setSel] = useState<ResearchJobV | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = sel?.id ?? null;

  const load = useCallback(() => {
    api.researchJobs().then((r) => {
      setJobs(r.jobs ?? []);
      const id = selRef.current;
      if (id) api.researchJob(id).then((j) => setSel(j.job ?? null)).catch(() => undefined);
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  async function start() {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await api.researchSearch(q);
      if (r.job) { setSel(r.job); setNote(`job ${r.job.id} · ${r.job.state}`); }
      load();
    } catch (e) {
      setNote(`research failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    try {
      const r = await api.researchCancel(id);
      setNote(r.ok ? `cancelled ${id}` : `engine: ${r.error ?? "cannot cancel"}`);
      load();
    } catch (e) {
      setNote(`cancel failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const answer = sel?.result?.answer ?? sel?.result?.text ?? sel?.result?.report ?? null;

  return (
    <div className="rs">
      <div className="rs-left">
        <div className="section-h" style={{ padding: "14px 14px 8px" }}>
          <h2 style={{ fontSize: 16 }}>Research</h2>
        </div>
        <form className="rs-compose" onSubmit={(e) => { e.preventDefault(); void start(); }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask XR to research…" aria-label="Research query" />
          <button className="btn small" disabled={busy} type="submit">{busy ? "working…" : "Research"}</button>
        </form>
        {note && <p className="ob-note mono" style={{ margin: "8px 14px" }}>{note}</p>}
        <div className="rs-jobs">
          {jobs.length === 0 && <div className="faint" style={{ padding: "10px 14px", fontSize: 12 }}>no research jobs yet — queries run through the engine's source-first pipeline (citations + content guards).</div>}
          {jobs.map((j) => (
            <button key={j.id} className={sel?.id === j.id ? "rs-job on" : "rs-job"} onClick={() => { setSel(j); }}>
              <span className={`sdot ${/fail|error/.test(j.state ?? "") ? "bad" : /run|work/.test(j.state ?? "") ? "run" : /done|complete/.test(j.state ?? "") ? "ok" : "idle"}`} aria-hidden="true" />
              <span className="rs-job-q">{String(j.request?.query ?? j.kind ?? j.id).slice(0, 60)}</span>
              <span className="mono faint">{j.state}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rs-main">
        {!sel && <div className="faint" style={{ padding: 24 }}>select a job or start a research run.</div>}
        {sel && (
          <>
            <div className="rs-head">
              <b>{String(sel.request?.query ?? sel.kind ?? sel.id).slice(0, 120)}</b>
              <span className="chip">{String(sel.state ?? "unknown")}</span>
              {/run|work|pending|queue/.test(String(sel.state ?? "")) && (
                <button className="chipbtn" onClick={() => void cancel(sel.id)}>cancel</button>
              )}
            </div>
            {sel.error && <div className="ob-err mono">{sel.error}<div className="faint">— the engine's own error for this job.</div></div>}
            {answer && <pre className="rs-answer">{String(answer)}</pre>}
            {!answer && !sel.error && (
              <div className="faint" style={{ padding: "10px 0", fontSize: 12 }}>
                {/run|work|pending|queue/.test(String(sel.state ?? "")) ? "working — sources are being gathered; this view refreshes live." : "no answer payload in this job record."}
              </div>
            )}
            <div className="rs-sources">
              <div className="ar-h">Sources · {(sel.sources ?? []).length}</div>
              {(sel.sources ?? []).map((s, i) => (
                <div key={i} className="rs-source">
                  <span className="mono faint">[{i + 1}]</span>
                  <span className="mono rs-source-url">{String(s.url ?? s.title ?? "source")}</span>
                  {s.trust ? <span className={`chip tiny ${String(s.trust) === "verified" ? "green" : "amber"}`}>{String(s.trust)}</span> : null}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
