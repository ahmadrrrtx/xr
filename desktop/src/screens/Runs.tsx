import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  const nodeRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

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

  // Stable identity: `?? []` inline would recreate the array every render,
  // churning redraw/useLayoutEffect into a setEdges render loop.
  const tasks = useMemo(() => wfDetail?.tasks ?? [], [wfDetail]);
  const levels = useMemo(() => taskLevels(tasks), [tasks]);
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
    setEdges((prev) =>
      prev.length === next.length && prev.every((e, i) => e.x1 === next[i].x1 && e.y1 === next[i].y1 && e.x2 === next[i].x2 && e.y2 === next[i].y2) ? prev : next,
    );
  }, [tasks]);
  useLayoutEffect(() => { redraw(); }, [redraw, wfDetail]);
  useEffect(() => {
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [redraw]);

  /* Phase 1 · the run inspector is a pane (not a full surface), so it may
     overlay content — but it must never be a room with no door. Esc closes it,
     same as every other dismissible layer in the product. */
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // keep the global handler from also firing
        onOpen(null);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [openId, onOpen]);

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
                          /* D-03 · real control (was <div role="button">): the
                             task graph is the primary navigation surface on this
                             screen, so its nodes must be focusable buttons with
                             platform Space/Enter activation, not divs that
                             imitate one. */
                          <button
                            key={t.taskId}
                            ref={(el) => { nodeRefs.current.set(t.taskId, el); }}
                            type="button"
                            className={`node ring-${ringFor(t.status)}${selTask === t.taskId ? " sel" : ""}`}
                            aria-pressed={selTask === t.taskId}
                            onClick={() => setSelTask(t.taskId)}
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
                          </button>
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
        /* Phase 1 · D-03. This was a <div role="button" tabIndex={0}>: it looked
           clickable (cursor:pointer) but was not a control — no Space
           activation, no button semantics, no form association, and the audit
           measured ZERO real buttons/links on this screen. It is now a real
           <button>, so Enter/Space/focus/AT all come from the platform. */
        <button
          key={s.id}
          type="button"
          className="runrow"
          aria-expanded={openId === s.id}
          onClick={() => onOpen(s.id)}
        >
          {/* Status is a colour + a word: colour alone never carries meaning. */}
          <span className={`dot ${s.status === "failed" ? "red" : s.status === "running" ? "cyan" : "green"}`} aria-hidden="true" />
          <span className="runrow-main">
            {/* Truncation moved to CSS (was `slice(0, 80)`), so the full prompt
                stays in the document for search, copy and assistive tech. */}
            <span className="title runrow-title" title={s.title || s.prompt || s.id}>
              {s.title || s.prompt || s.id}
            </span>
            <span className="sub mono">{s.id} · {s.workspace ?? s.cwd ?? "default"}</span>
          </span>
          <span className="sub mono">{s.mode ?? "agent"}</span>
          <span className="sub mono" title="reported by the engine — never estimated in the shell">
            {typeof s.costUsd === "number" ? `$${s.costUsd.toFixed(4)}` : "cost unknown"}
          </span>
          <span className="xr-sr-only">{s.status ?? "status unknown"}</span>
        </button>
      ))}

      {openId && (
        <aside
          className="drawer"
          role="dialog"
          aria-modal="false"
          aria-label={`Run inspector — ${openId}`}
        >
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
          <SessionAnatomy detail={detail} tab={tab} />
        </aside>
      )}
    </div>
  );
}

interface SessionStep {
  id?: string; idx?: number; phase?: string; tool?: string | null; detail?: string; created_at?: number;
  parsedDetail?: { message?: string; toolCalls?: { tool?: string; args?: unknown; ok?: boolean; result?: string; error?: string }[] };
}
interface SessionAudit { id?: number; event?: string; detail?: string; hash?: string; created_at?: number; }

function auditJson(a: SessionAudit): Record<string, unknown> | null {
  if (!a.detail) return null;
  try { return JSON.parse(a.detail) as Record<string, unknown>; } catch { return null; }
}

/** Structured run anatomy from the engine session record (steps + hash-chained audit).
 *  Tabs without engine data keep the honest raw-JSON/note fallback. */
/** Phase 2 · changed-files review: rows come from the run's own tool calls;
 *  the diff per path is the engine's live `git diff` (honest: current tree). */
function FilesTab({ rows, fallback }: {
  rows: { path: string; ok?: boolean; tool?: string; ts?: number }[];
  fallback: () => ReactNode;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function showDiff(p: string) {
    setSel(p); setLoading(true); setDiffText(null);
    api.fileDiff(p)
      .then((d) => setDiffText(String((d as { diff?: string }).diff ?? "") || "(no diff — file untracked or clean now)"))
      .catch((e) => setDiffText(`engine: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setLoading(false));
  }

  if (rows.length === 0) return <>{fallback()}</>;
  return (
    <div className="tl-box" style={{ maxHeight: 380 }}>
      {rows.map((r) => (
        <div key={r.path} className={`tl ${r.ok === false ? "tl-err" : "tl-ok"}`}>
          <span className="faint">{r.ok === false ? "✗" : "✓"}</span>{" "}
          <span className="mono">{r.path}</span>
          <span className="faint"> · {r.tool}</span>
          <button className="chipbtn" style={{ marginLeft: 8 }} onClick={() => showDiff(r.path)}>diff</button>
        </div>
      ))}
      {sel && (
        <pre className="raw" style={{ marginTop: 8 }}>{loading ? "asking the engine…" : `${sel}\n${diffText ?? ""}`}</pre>
      )}
    </div>
  );
}

function SessionAnatomy({ detail, tab }: { detail: Record<string, unknown> | null; tab: string }) {
  const steps: SessionStep[] = Array.isArray(detail?.steps) ? (detail!.steps as SessionStep[]) : [];
  const audit: SessionAudit[] = Array.isArray(detail?.audit) ? (detail!.audit as SessionAudit[]) : [];
  const clock = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : "—");

  if (tab === "Transcript") {
    if (steps.length === 0) return <pre className="raw">{JSON.stringify(pick(detail, tab), null, 2)}</pre>;
    const tip = audit.length ? audit[audit.length - 1].hash?.slice(0, 8) : null;
    return (
      <div className="tl-box" style={{ maxHeight: 380 }}>
        <div className="tl tl-info">chain tip {tip ?? "—"} · {audit.length} audit event{audit.length === 1 ? "" : "s"}</div>
        {steps.map((s) => (
          <div key={s.id ?? s.idx} className={`tl ${/error|fail/.test(s.phase ?? "") ? "tl-err" : s.phase === "tool" ? "tl-tool" : "tl-info"}`}>
            <span className="faint">{clock(s.created_at)}</span> [{String(s.phase ?? "step").toUpperCase()}]{" "}
            {s.parsedDetail?.message ?? String(s.detail ?? "").slice(0, 160)}
          </div>
        ))}
      </div>
    );
  }
  if (tab === "Tools") {
    const calls = steps.flatMap((s) => (s.parsedDetail?.toolCalls ?? []).map((c) => ({ ...c, phase: s.phase, ts: s.created_at })));
    if (calls.length === 0) return <p className="faint" style={{ fontSize: 11.5 }}>No tool calls recorded in this session&apos;s steps.</p>;
    return (
      <div className="tl-box" style={{ maxHeight: 380 }}>
        {calls.map((c, i) => (
          <div key={i} className={`tl ${c.ok === false ? "tl-err" : "tl-ok"}`}>
            <span className="faint">{clock(c.ts)}</span> {c.ok === false ? "✗" : "✓"} {c.tool ?? "tool"}{" "}
            <span className="faint">{JSON.stringify(c.args ?? {}).slice(0, 90)}</span>
          </div>
        ))}
      </div>
    );
  }
  if (tab === "Cost") {
    const rows = audit.map((a) => ({ ev: a.event, snap: (auditJson(a)?.snapshot ?? null) as Record<string, unknown> | null, ts: a.created_at }))
      .filter((r) => r.snap && typeof r.snap.usd === "number");
    if (rows.length === 0) return <p className="faint" style={{ fontSize: 11.5 }}>No cost snapshots in the audit chain yet.</p>;
    return (
      <div className="tl-box" style={{ maxHeight: 380 }}>
        {rows.map((r, i) => (
          <div key={i} className="tl tl-info">
            <span className="faint">{clock(r.ts)}</span> {r.ev} · in {String(r.snap!.inTokens)} / out {String(r.snap!.outTokens)} tok · ${String(r.snap!.usd)}
          </div>
        ))}
        <div className="tl tl-info faint">engine audit chain is the ledger of record</div>
      </div>
    );
  }
  if (tab === "Files") {
    // Phase 2 · changed files = paths the run's OWN tool calls touched
    // (engine step records — never invented), each with a live engine diff.
    const touched = steps.flatMap((s) =>
      (s.parsedDetail?.toolCalls ?? [])
        .filter((c) => /write|edit|patch|file/i.test(String(c.tool ?? "")) && typeof (c.args as { path?: unknown } | undefined)?.path === "string")
        .map((c) => ({ path: String((c.args as { path: string }).path), ok: c.ok, tool: c.tool, ts: s.created_at })),
    );
    const seen = new Set<string>();
    const rows = touched.filter((t) => (seen.has(t.path) ? false : (seen.add(t.path), true)));
    return (
      <FilesTab rows={rows} fallback={() => <pre className="raw">{JSON.stringify(pick(detail, "Files"), null, 2)}</pre>} />
    );
  }
  if (tab === "Approvals") {
    const rows = audit.filter((a) => /approv|consent|decision/.test(a.event ?? ""));
    if (rows.length === 0) return <p className="faint" style={{ fontSize: 11.5 }}>No approval events in this session&apos;s audit chain.</p>;
    return (
      <div className="tl-box" style={{ maxHeight: 380 }}>
        {rows.map((a, i) => (
          <div key={i} className="tl tl-wait"><span className="faint">{clock(a.created_at)}</span> {a.event} · {String(a.detail ?? "").slice(0, 120)}</div>
        ))}
      </div>
    );
  }
  return <pre className="raw">{JSON.stringify(pick(detail, tab), null, 2) ?? "—"}</pre>;
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
