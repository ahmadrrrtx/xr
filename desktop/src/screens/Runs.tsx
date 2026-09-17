import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, asList, type SessionSummary, type WorkflowDetail, type WorkflowSummary, type WorkflowTaskV } from "../api/client";

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

/** Audit-line color class from engine-reported kind/message (display only). */
function auditClass(kind?: string, message?: string): string {
  const s = `${kind ?? ""} ${message ?? ""}`.toLowerCase();
  if (/(error|fail|reject|cancel)/.test(s)) return "tl-err";
  if (/(done|complet|approved|success|pass)/.test(s)) return "tl-ok";
  if (/(review|approval|await|pause|block)/.test(s)) return "tl-wait";
  if (/(handoff|delegat|spawn|tool)/.test(s)) return "tl-tool";
  return "tl-info";
}

/** Topological levels from engine `dependencies` (cycle-guarded). */
function taskLevels(tasks: WorkflowTaskV[]): WorkflowTaskV[][] {
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  const depth = new Map<string, number>();
  const walk = (id: string, seen: Set<string>): number => {
    const hit = depth.get(id);
    if (hit !== undefined) return hit;
    if (seen.has(id)) return 0; // cycle guard — never hang on a malformed graph
    seen.add(id);
    const deps = (byId.get(id)?.dependencies ?? []).filter((d) => byId.has(d) && d !== id);
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((x) => walk(x, seen)));
    depth.set(id, d);
    return d;
  };
  for (const t of tasks) walk(t.taskId, new Set());
  const rows: WorkflowTaskV[][] = [];
  for (const t of tasks) {
    const d = depth.get(t.taskId) ?? 0;
    (rows[d] ??= []).push(t);
  }
  return rows.filter(Boolean);
}

interface Edge { x1: number; y1: number; x2: number; y2: number; }

const fmtDur = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const fmtClock = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : "—");

/** Runs (phase 6, mock 05): team-run board — leveled DAG with dependency edges,
 *  engine-issued partition budgets, per-task auditTrail transcript — plus session history. */
export function Runs({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [roles, setRoles] = useState<{ id?: string; name?: string; purpose?: string }[]>([]);
  const [wfSel, setWfSel] = useState<string | null>(null);
  const [wfDetail, setWfDetail] = useState<WorkflowDetail | null>(null);
  const [selTask, setSelTask] = useState<string | null>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Transcript");
  const dagRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

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

  // Live-refresh the selected workflow while it may still be moving.
  useEffect(() => {
    if (!wfSel) { setWfDetail(null); return; }
    let live = true;
    const load = () => api.workflow(wfSel).then((d) => { if (live) setWfDetail(d); }).catch(() => { if (live) setWfDetail({ error: "workflow unavailable" }); });
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, [wfSel]);

  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    api.session(openId).then(setDetail).catch(() => setDetail({ error: "run unavailable" }));
  }, [openId]);

  const tasks = wfDetail?.tasks ?? [];
  const levels = taskLevels(tasks);
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  const partFor = (taskId: string) => wfDetail?.partitions?.find((p) => p.childId === taskId);
  const wf = workflows.find((w) => w.id === wfSel) ?? null;
  // Header stats: prefer the detail record's own task list (summaries may omit counts),
  // falling back to the summary counters. Display arithmetic over engine-reported states only.
  const isDone = (s?: string) => /complet|done|success/.test((s ?? "").toLowerCase());
  const isFailed = (s?: string) => /fail|error|abort/.test((s ?? "").toLowerCase());
  const isWaiting = (s?: string) => /review|approv|wait|block/.test((s ?? "").toLowerCase());
  const totalT = tasks.length || wf?.tasks?.total || 0;
  const doneT = tasks.length ? tasks.filter((t) => isDone(t.status)).length : (wf?.tasks?.completed ?? 0);
  const failedT = tasks.length ? tasks.filter((t) => isFailed(t.status)).length : (wf?.tasks?.failed ?? 0);
  const waitingT = tasks.length ? tasks.filter((t) => isWaiting(t.status)).length : (wf?.tasks?.awaitingReview ?? 0);
  const pct = totalT ? Math.round((doneT / totalT) * 100) : 0;
  const spentUsd = (wfDetail?.partitions ?? []).reduce((s, p) => s + (p.consumedUsd ?? 0), 0);
  const spentTok = (wfDetail?.partitions ?? []).reduce((s, p) => s + (p.consumedTokens ?? 0), 0);
  const selected = selTask ? byId.get(selTask) ?? null : null;

  // Dependency edges: bottom-center of parent → top-center of child (bezier).
  const redraw = useCallback(() => {
    const canvas = dagRef.current;
    if (!canvas) { setEdges([]); return; }
    const base = canvas.getBoundingClientRect();
    const next: Edge[] = [];
    for (const t of tasks) {
      const b = nodeRefs.current.get(t.taskId);
      if (!b) continue;
      const rb = b.getBoundingClientRect();
      for (const d of t.dependencies ?? []) {
        const a = nodeRefs.current.get(d);
        if (!a) continue;
        const ra = a.getBoundingClientRect();
        next.push({
          x1: ra.left - base.left + ra.width / 2, y1: ra.top - base.top + ra.height,
          x2: rb.left - base.left + rb.width / 2, y2: rb.top - base.top,
        });
      }
    }
    setEdges(next);
  }, [tasks]);
  useLayoutEffect(() => { redraw(); }, [redraw, wfDetail]);
  useEffect(() => {
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [redraw]);

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
              <button key={w.id} role="option" aria-selected={w.id === wfSel} className={w.id === wfSel ? "wf-item on" : "wf-item"} onClick={() => { setWfSel(w.id); setSelTask(null); }}>
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
                  <span className="chip">{doneT}/{totalT} tasks</span>
                  <span className="chip" title="Sum of engine partition ledger (display arithmetic only)">${spentUsd.toFixed(4)} · {spentTok} tok</span>
                  {failedT > 0 && <span className="chip bad">{failedT} failed</span>}
                  {waitingT > 0 && <span className="chip amber">{waitingT} awaiting review</span>}
                  {wfDetail?.cancellationState != null && <span className="chip">{String(typeof wfDetail.cancellationState === "object" ? JSON.stringify(wfDetail.cancellationState) : wfDetail.cancellationState).slice(0, 40)}</span>}
                  <button className="btn small" disabled title="Engine exposes no pause control for workflows yet">Pause</button>
                  <button className="btn small danger" disabled title="Engine exposes no cancel control for workflows yet">Cancel</button>
                </div>
              </div>

              <div className="dag-scroll" aria-label="Task graph">
                {tasks.length === 0 && <p className="faint">This workflow record carries no task list (engine detail: {wfDetail ? Object.keys(wfDetail).join(", ").slice(0, 120) : "loading…"}).</p>}
                <div className="dag-canvas" ref={dagRef}>
                  <svg className="dag-edges" aria-hidden="true">
                    {edges.map((e, i) => {
                      const g = Math.max(18, (e.y2 - e.y1) / 2);
                      return <path key={i} d={`M ${e.x1} ${e.y1} C ${e.x1} ${e.y1 + g}, ${e.x2} ${e.y2 - g}, ${e.x2} ${e.y2}`} />;
                    })}
                  </svg>
                  {levels.map((row, li) => (
                    <div className="dag-level" key={li}>
                      {row.map((t) => {
                        const part = partFor(t.taskId);
                        const dur = t.startedAt ? (t.endedAt ?? Date.now()) - t.startedAt : null;
                        return (
                          <div
                            key={t.taskId}
                            ref={(el) => { nodeRefs.current.set(t.taskId, el); }}
                            className={`node ring-${ringFor(t.status)}${selTask === t.taskId ? " sel" : ""}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelTask(t.taskId)}
                            onKeyDown={(e) => { if (e.key === "Enter") setSelTask(t.taskId); }}
                          >
                            <div className="node-h">
                              <i className="ring" aria-hidden="true" />
                              <b title={t.name}>{t.name ?? t.taskId}</b>
                              {t.role && <span className="chip tiny rolechip" title={t.role}>{t.role.split("_").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}</span>}
                            </div>
                            <div className="mono faint">{t.status ?? "unknown"}{dur !== null ? ` · ${fmtDur(dur)}` : ""}</div>
                            {part && typeof part.capUsd === "number" && part.capUsd > 0 && (
                              <div className="budget" title="Engine-issued budget partition">
                                <div className="bar"><i style={{ width: `${Math.min(100, Math.round(((part.consumedUsd ?? 0) / part.capUsd) * 100))}%` }} /></div>
                                <span className="mono faint">${(part.consumedUsd ?? 0).toFixed(3)}/${part.capUsd}</span>
                              </div>
                            )}
                            {(t.errors?.length ?? 0) > 0 && <div className="mono" style={{ color: "var(--xr-red)", fontSize: 10.5 }}>{t.errors!.length} error{t.errors!.length === 1 ? "" : "s"}</div>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <aside className="wf-side" aria-label="Task inspector">
            {selected ? (
              <>
                <div className="rail-h">Task · {selected.name ?? selected.taskId}</div>
                <div className="kv2">
                  <span className="k">status</span><span className={`tlv ${auditClass(selected.status)}`}>{selected.status ?? "—"}</span>
                  <span className="k">role</span><span>{selected.role ?? "—"}</span>
                  <span className="k">agent</span><span className="mono">{selected.agentId ?? "—"}</span>
                  <span className="k">started</span><span className="mono">{fmtClock(selected.startedAt)}</span>
                  <span className="k">ended</span><span className="mono">{fmtClock(selected.endedAt)}</span>
                  {partFor(selected.taskId) && (
                    <>
                      <span className="k">budget</span>
                      <span className="mono">${(partFor(selected.taskId)!.consumedUsd ?? 0).toFixed(4)} / ${partFor(selected.taskId)!.capUsd ?? 0}</span>
                      <span className="k">tokens</span>
                      <span className="mono">{partFor(selected.taskId)!.consumedTokens ?? 0} / {partFor(selected.taskId)!.capTokens ?? 0}</span>
                    </>
                  )}
                </div>
                {selected.description && <p className="faint" style={{ fontSize: 11.5 }}>{selected.description}</p>}
                {selected.blockedReason && <p className="tl tl-wait">blocked: {selected.blockedReason}</p>}
                {selected.outputs?.summary && <p className="tl tl-ok">output: {selected.outputs.summary.slice(0, 240)}</p>}
                {(selected.errors ?? []).map((e, i) => <p key={i} className="tl tl-err">{e.slice(0, 200)}</p>)}
                <div className="rail-h" style={{ marginTop: 10 }}>Transcript <span className="faint mono" style={{ fontSize: 10 }}>auditTrail · {selected.auditTrail?.length ?? 0}</span></div>
                <div className="tl-box">
                  {(selected.auditTrail ?? []).length === 0 && <div className="faint" style={{ fontSize: 11 }}>No audit events recorded for this task yet.</div>}
                  {(selected.auditTrail ?? []).slice(-40).map((ev, i) => (
                    <div key={i} className={`tl ${auditClass(ev.kind, ev.message)}`}>
                      <span className="faint">{fmtClock(ev.ts)}</span> [{String(ev.kind ?? "event").toUpperCase()}] {String(ev.message ?? "").slice(0, 160)}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="rail-h">Engine record</div>
                <div className="kv2">
                  <span className="k">workflow</span><span className="mono">{wfDetail?.workflowId ?? wfSel ?? "—"}</span>
                  <span className="k">status</span><span>{wfDetail?.status ?? "—"}</span>
                  <span className="k">review</span><span>{wfDetail?.reviewState ?? "—"}</span>
                  <span className="k">approval</span><span>{wfDetail?.approvalState ?? "—"}</span>
                </div>
                {wfDetail?.planSummary && (
                  <>
                    <div className="rail-h" style={{ marginTop: 8 }}>Plan summary</div>
                    <p className="faint" style={{ fontSize: 11.5 }}>{String(wfDetail.planSummary).slice(0, 400)}</p>
                  </>
                )}
                {wfDetail?.finalOutput?.summary && (
                  <>
                    <div className="rail-h" style={{ marginTop: 8 }}>Final output</div>
                    <p className="tl tl-ok">{wfDetail.finalOutput.summary.slice(0, 300)}</p>
                  </>
                )}
                <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>Select a node for its transcript + budget.</div>
              </>
            )}
            {tasks.length > 0 && (
              <>
                <div className="rail-h" style={{ marginTop: 10 }}>Steps</div>
                <div className="stepschips">
                  {tasks.map((t) => (
                    <button key={t.taskId} className={`chip stepchip${selTask === t.taskId ? " on" : ""}`} onClick={() => setSelTask(t.taskId)} title={t.status}>
                      <i className={`cdot ${ringFor(t.status)}`} />{t.name ?? t.taskId}
                    </button>
                  ))}
                </div>
              </>
            )}
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
