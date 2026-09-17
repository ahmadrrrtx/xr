import { useEffect, useState } from "react";
import { api, asList, type SessionSummary, type WorkflowSummary } from "../api/client";

const TABS = ["Transcript", "Plan", "Files", "Tools", "Approvals", "Cost", "Artifacts"] as const;

/** Status ring colors — driven only by engine-reported strings. */
function ringFor(status?: string): string {
  const s = (status ?? "").toLowerCase();
  if (/(complet|done|success|pass)/.test(s)) return "g";
  if (/(fail|error|abort)/.test(s)) return "r";
  if (/(approv|review|block|wait|paused)/.test(s)) return "a";
  if (/(run|work|active|progress)/.test(s)) return "c";
  return "n";
}

interface WfTask { id?: string; role?: string; name?: string; status?: string; owns?: string[]; progress?: number; budget?: { used?: number; total?: number }; [k: string]: unknown; }

/** Runs (phase 6, mock 05): team-run board (engine workflows) + session run history with anatomy drawer. */
export function Runs({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [roles, setRoles] = useState<{ id?: string; name?: string; purpose?: string }[]>([]);
  const [wfSel, setWfSel] = useState<string | null>(null);
  const [wfDetail, setWfDetail] = useState<Record<string, unknown> | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Transcript");

  useEffect(() => {
    const poll = () => {
      api.agents().then((a) => {
        setWorkflows(a.workflows ?? []);
        setRoles((a.roles ?? []) as { id?: string; name?: string; purpose?: string }[]);
      }).catch(() => {});
      api.sessions().then((v) => setSessions(asList<SessionSummary>(v, "sessions"))).catch(() => setSessions([]));
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!wfSel) { setWfDetail(null); return; }
    api.workflow(wfSel).then(setWfDetail).catch(() => setWfDetail({ error: "workflow unavailable" }));
  }, [wfSel]);

  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    api.session(openId).then(setDetail).catch(() => setDetail({ error: "run unavailable" }));
  }, [openId]);

  const tasks: WfTask[] = Array.isArray(wfDetail?.tasks) ? (wfDetail!.tasks as WfTask[]) : [];
  const wf = workflows.find((w) => w.id === wfSel) ?? null;
  const pct = wf?.tasks?.total ? Math.round(((wf.tasks.completed ?? 0) / wf.tasks.total) * 100) : 0;

  return (
    <div className="runs2">
      <div className="section-h"><h2>Team runs</h2><span className="faint" style={{ fontSize: 12 }}>multi-agent workflows — engine-owned state, live</span></div>

      {workflows.length === 0 && (
        <div className="empty board-empty">
          <p>No team runs yet.</p>
          <p className="faint">Multi-agent workflows appear here with live task rings, budgets and transcripts. The engine reports {roles.length} built-in roles ({roles.map((r) => r.name ?? r.id).join(", ") || "—"}).</p>
        </div>
      )}

      {workflows.length > 0 && (
        <div className="wf-wrap">
          <div className="wf-list" role="listbox" aria-label="Workflows">
            {workflows.map((w) => (
              <button key={w.id} role="option" aria-selected={w.id === wfSel} className={w.id === wfSel ? "wf-item on" : "wf-item"} onClick={() => setWfSel(w.id)}>
                <i className={`cdot ${ringFor(w.status)}`} />
                <span className="wf-goal">{w.goal ?? w.id}</span>
                <span className="mono faint">{w.status ?? "—"}</span>
              </button>
            ))}
          </div>

          {wf && (
            <div className="wf-main">
              <div className="wf-banner">
                <div className="wf-title">{wf.goal ?? wf.id}</div>
                <div className="wf-progress"><div className="bar"><i style={{ width: `${pct}%` }} /></div><span className="mono">{pct}%</span></div>
                <div className="wf-chips mono">
                  <span className="chip">{wf.kind ?? "workflow"}</span>
                  <span className="chip">{wf.tasks?.completed ?? 0}/{wf.tasks?.total ?? 0} tasks</span>
                  {(wf.tasks?.failed ?? 0) > 0 && <span className="chip bad">{wf.tasks?.failed} failed</span>}
                  {(wf.tasks?.awaitingReview ?? 0) > 0 && <span className="chip amber">{wf.tasks?.awaitingReview} awaiting review</span>}
                  <button className="btn small" disabled title="Engine exposes no pause control for workflows yet">Pause</button>
                  <button className="btn small danger" disabled title="Engine exposes no cancel control for workflows yet">Cancel</button>
                </div>
              </div>

              <div className="dag" aria-label="Task graph">
                {tasks.length === 0 && <p className="faint">This workflow record carries no task list (engine detail: {wfDetail ? Object.keys(wfDetail).join(", ").slice(0, 120) : "loading…"}).</p>}
                {tasks.map((t, i) => {
                  const used = typeof t.budget?.used === "number" ? t.budget.used : null;
                  const tot = typeof t.budget?.total === "number" && t.budget.total > 0 ? t.budget.total : null;
                  return (
                    <div key={String(t.id ?? i)} className={`node ring-${ringFor(t.status)}`}>
                      <div className="node-h"><i className="ring" aria-hidden="true" /><b>{t.name ?? t.role ?? t.id ?? `task ${i + 1}`}</b></div>
                      <div className="mono faint">{t.status ?? "unknown"}</div>
                      {tot && used !== null && (
                        <div className="budget"><div className="bar"><i style={{ width: `${Math.min(100, Math.round((used / tot) * 100))}%` }} /></div><span className="mono faint">{used.toFixed(2)}/{tot}</span></div>
                      )}
                      {Array.isArray(t.owns) && t.owns.length > 0 && (
                        <div className="owns">{t.owns.slice(0, 4).map((o) => <span key={o} className="chip tiny">{o}</span>)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <aside className="wf-side" aria-label="Workflow record">
            <div className="rail-h">Engine record</div>
            <pre className="raw">{wfDetail ? JSON.stringify(wfDetail, null, 2).slice(0, 1400) : "select a workflow"}</pre>
          </aside>
        </div>
      )}

      <div className="section-h" style={{ marginTop: 18 }}><h2>Runs</h2><span className="faint" style={{ fontSize: 12 }}>history as product data — full anatomy per run</span></div>
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
  return Object.keys(hit).length ? hit : { note: `${tab}: no engine data in this run record` };
}
