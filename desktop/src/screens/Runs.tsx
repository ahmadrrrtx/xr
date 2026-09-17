import { useEffect, useState } from "react";
import { api, asList, type SessionSummary } from "../api/client";

const TABS = ["Transcript", "Plan", "Files", "Tools", "Approvals", "Cost", "Artifacts"] as const;

export function Runs({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Transcript");

  useEffect(() => {
    api.sessions().then((v) => setSessions(asList<SessionSummary>(v, "sessions"))).catch(() => setSessions([]));
  }, []);
  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    api.session(openId).then(setDetail).catch(() => setDetail({ error: "run unavailable" }));
  }, [openId]);

  return (
    <div className="runs">
      <div className="section-h"><h2>Runs</h2><span className="faint" style={{ fontSize: 12 }}>history as product data — full anatomy per run</span></div>
      {sessions.length === 0 && <div className="empty">No runs yet. Tasks you start in Work appear here with full anatomy.</div>}
      {sessions.map((s) => (
        <div key={s.id} className="runrow" role="button" tabIndex={0} onClick={() => onOpen(s.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(s.id)}>
          <span className={`dot ${s.status === "failed" ? "red" : s.status === "running" ? "cyan" : "green"}`} />
          <div>
            <div className="title">{s.title || s.prompt?.slice(0, 80) || s.id}</div>
            <div className="sub mono">{s.id} · {s.workspace ?? s.cwd ?? "default"}</div>
          </div>
          <span className="sub mono">{s.mode ?? "agent"}</span>
          <span className="sub mono">{typeof s.costUsd === "number" ? `$${s.costUsd.toFixed(4)}` : "—"}</span>
        </div>
      ))}

      {openId && (
        <aside className="drawer" aria-label="Run inspector">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h3>{String(detail?.title ?? (detail?.prompt as string)?.slice(0, 60) ?? openId)}</h3>
            <button className="pill" style={{ marginLeft: "auto" }} onClick={() => onOpen(null)}>Close ⎋</button>
          </div>
          <div className="kv mono">
            <span className="k">run id</span><span>{openId}</span>
            <span className="k">status</span><span>{String(detail?.status ?? "—")}</span>
            <span className="k">mode</span><span>{String(detail?.mode ?? "—")}</span>
            <span className="k">model</span><span>{String(detail?.model ?? detail?.provider ?? "—")}</span>
            <span className="k">workspace</span><span>{String(detail?.workspace ?? detail?.cwd ?? "—")}</span>
            <span className="k">cost</span><span>{typeof detail?.costUsd === "number" ? `$${(detail.costUsd as number).toFixed(4)}` : "—"}</span>
          </div>
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
          <pre className="raw">{JSON.stringify(pick(detail, tab), null, 2) ?? "—"}</pre>
        </aside>
      )}
    </div>
  );
}

function pick(d: Record<string, unknown> | null, tab: string): unknown {
  if (!d) return null;
  const map: Record<string, string[]> = {
    Transcript: ["messages", "transcript", "events"],
    Plan: ["plan", "steps"],
    Files: ["files", "fileChanges", "diffs"],
    Tools: ["toolCalls", "tools"],
    Approvals: ["approvals"],
    Cost: ["cost", "costUsd", "tokens", "budget"],
    Artifacts: ["artifacts", "outputs"],
  };
  const keys = map[tab] ?? [];
  const hit: Record<string, unknown> = {};
  for (const k of keys) if (k in d) hit[k] = d[k];
  return Object.keys(hit).length ? hit : { note: `${tab}: no engine data in this run record (phase 2 wires execution fabric detail)` };
}
