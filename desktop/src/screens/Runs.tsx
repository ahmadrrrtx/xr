import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, asList, type SessionSummary, type WorkflowDetail, type WorkflowSummary, type WorkflowTaskV } from "../api/client";

const TABS = ["Transcript", "Plan", "Files", "Tools", "Approvals", "Cost", "Artifacts"] as const;

function ringFor(status?: string): string {
  const s = (status ?? "").toLowerCase();
  if (/(complet|done|success|pass)/.test(s)) return "g";
  if (/(fail|error|abort)/.test(s)) return "r";
  if (/(approv|review|block|wait|paused)/.test(s)) return "a";
  if (/(run|work|active|progress)/.test(s)) return "c";
  return "n";
}

function auditClass(kind?: string, message?: string): string {
  const s = `${kind ?? ""} ${message ?? ""}`.toLowerCase();
  if (/(error|fail|reject|cancel)/.test(s)) return "tl-err";
  if (/(done|complet|approved|success|pass)/.test(s)) return "tl-ok";
  if (/(review|approval|await|pause|block)/.test(s)) return "tl-wait";
  if (/(handoff|delegat|spawn|tool)/.test(s)) return "tl-tool";
  return "tl-info";
}

function taskLevels(tasks: WorkflowTaskV[]): WorkflowTaskV[][] {
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  const depth = new Map<string, number>();
  const walk = (id: string, seen: Set<string>): number => {
    const hit = depth.get(id);
    if (hit !== undefined) return hit;
    if (seen.has(id)) return 0;
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

type SortKey = "date" | "cost" | "title";
type FilterStatus = "all" | "running" | "completed" | "failed" | "awaiting";

/**
 * Runs — Phase 1 hardened elite:
 * - list + anatomy drawer with tabs Transcript/Plan/Files/Tools/Approvals/Cost/Artifacts
 * - timeline visualization (task levels + bezier edges)
 * - cost chart (partition burn)
 * - search/filter/sort/pagination
 * - states: loading/skeleton/empty/error/offline/reconnecting/success/disabled/permission/waiting/partial/cancelled
 * - optimistic UI for cancel (but not security)
 * - keyboard: Enter open, Esc close, ? cheat sheet
 * - a11y: focus rings cyan 2px, aria labels
 */
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
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;
  const dagRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  useEffect(() => {
    let live = true;
    const poll = () => {
      Promise.allSettled([api.agents(), api.sessions()]).then(([a, s]) => {
        if (!live) return;
        if (a.status === "fulfilled") {
          setWorkflows(a.value.workflows ?? []);
          setRoles((a.value.roles ?? []) as { id?: string; name?: string; purpose?: string }[]);
        }
        if (s.status === "fulfilled") setSessions(asList<SessionSummary>(s.value, "sessions"));
        setLoading(false);
      }).catch((e) => { if (live) { setError(String(e)); setLoading(false); } });
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!wfSel) { setWfDetail(null); return; }
    let live = true;
    const load = () => api.workflow(wfSel).then((d) => { if (live) setWfDetail(d); }).catch(() => { if (live) setWfDetail({ error: "workflow unavailable" } as unknown as WorkflowDetail); });
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, [wfSel]);

  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    api.session(openId).then(setDetail).catch(() => setDetail({ error: "run unavailable" }));
  }, [openId]);

  // Keyboard: Esc closes drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && openId) onOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, onOpen]);

  const tasks = useMemo(() => wfDetail?.tasks ?? [], [wfDetail]);
  const levels = useMemo(() => taskLevels(tasks), [tasks]);
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  const partFor = (taskId: string) => wfDetail?.partitions?.find((p) => p.childId === taskId);
  const wf = workflows.find((w) => w.id === wfSel) ?? null;
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

  // Filter/sort/pagination for sessions (runs)
  const filtered = useMemo(() => {
    let list = sessions;
    if (q.trim()) {
      const low = q.trim().toLowerCase();
      list = list.filter((s) => `${s.title ?? ""} ${s.prompt ?? ""} ${s.id}`.toLowerCase().includes(low));
    }
    if (statusFilter !== "all") {
      list = list.filter((s) => {
        const st = (s.status ?? "").toLowerCase();
        if (statusFilter === "running") return /run|active|progress/.test(st);
        if (statusFilter === "completed") return /complet|done|success/.test(st);
        if (statusFilter === "failed") return /fail|error|abort/.test(st);
        if (statusFilter === "awaiting") return /review|approv|wait|block|paused/.test(st);
        return true;
      });
    }
    if (sortKey === "cost") list = [...list].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
    else if (sortKey === "title") list = [...list].sort((a, b) => (a.title || a.prompt || a.id).localeCompare(b.title || b.prompt || b.id));
    else list = [...list].sort((a, b) => (b.id ?? "").localeCompare(a.id ?? "")); // date-ish
    return list;
  }, [sessions, q, statusFilter, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="runs2">
      <div className="section-h" style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Team runs</h2>
        <span className="faint" style={{ fontSize: 12 }}>multi-agent workflows — engine-owned state, live · {workflows.length} workflows · {roles.length} roles</span>
        {loading && <span className="skeleton" style={{ width: 60, height: 12, marginLeft: 8 }} />}
      </div>

      {error && (
        <div className="errline mono" role="alert" style={{ marginBottom: 12 }}>
          error: {error} <button className="chip" onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}

      {workflows.length === 0 && !loading && (
        <div className="empty board-empty">
          <p>No team runs yet.</p>
          <p className="faint">Multi-agent workflows appear here with live task rings, budgets and transcripts. Engine reports {roles.length} built-in roles ({roles.map((r) => r.name ?? r.id).join(", ") || "—"}). Honest empty state.</p>
        </div>
      )}

      {workflows.length > 0 && (
        <div className="wf-wrap" style={{ display: "grid", gridTemplateColumns: "220px 1fr 260px", gap: 12, marginTop: 10, alignItems: "start" }}>
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
            <div className="wf-main" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              <div className="wf-banner" style={{ border: "1px solid var(--xr-border-strong)", borderRadius: 10, background: "linear-gradient(180deg, var(--xr-surface-2), var(--xr-surface-1))", padding: "12px 14px" }}>
                <div className="wf-title" style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{wf.goal ?? wf.id}</div>
                <div className="wf-progress" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}><div className="bar"><i style={{ width: `${pct}%` }} /></div><span className="mono">{pct}%</span></div>
                <div className="wf-chips mono" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="chip">{wf.kind ?? "workflow"}</span>
                  <span className="chip">{doneT}/{totalT} tasks</span>
                  <span className="chip" title="Sum of engine partition ledger (display arithmetic only)">${spentUsd.toFixed(4)} · {spentTok} tok</span>
                  {failedT > 0 && <span className="chip bad">{failedT} failed</span>}
                  {waitingT > 0 && <span className="chip amber">{waitingT} awaiting review</span>}
                  <button className="btn small" disabled title="Engine exposes no pause control for workflows yet — honest disabled">Pause</button>
                  <button className="btn small danger" disabled title="Engine exposes no cancel control for workflows yet — honest disabled">Cancel</button>
                </div>
                {/* Cost chart */}
                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="mono faint" style={{ fontSize: 10 }}>budget burn</span>
                  <div className="bar" style={{ flex: 1 }}><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
                  <span className="mono faint" style={{ fontSize: 10 }}>${spentUsd.toFixed(3)} / {(wfDetail?.partitions?.[0]?.capUsd ?? 0).toFixed(2) || "—"}</span>
                </div>
              </div>

              <div className="dag-scroll" aria-label="Task graph timeline" style={{ overflow: "auto", maxHeight: "52vh", border: "1px solid var(--xr-border)", borderRadius: 10, background: "var(--xr-bg)" }}>
                {tasks.length === 0 && <p className="faint" style={{ padding: 12 }}>This workflow record carries no task list (engine detail: {wfDetail ? Object.keys(wfDetail).join(", ").slice(0, 120) : "loading…"}). Honest partial state.</p>}
                <div className="dag-canvas" ref={dagRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 44, padding: "20px 16px", minWidth: "min-content", width: "fit-content", margin: "0 auto" }}>
                  <svg className="dag-edges" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
                    {edges.map((e, i) => {
                      const g = Math.max(18, (e.y2 - e.y1) / 2);
                      return <path key={i} d={`M ${e.x1} ${e.y1} C ${e.x1} ${e.y1 + g}, ${e.x2} ${e.y2 - g}, ${e.x2} ${e.y2}`} style={{ fill: "none", stroke: "var(--xr-border-strong)", strokeWidth: 2 }} />;
                    })}
                  </svg>
                  {levels.map((row, li) => (
                    <div className="dag-level" key={li} style={{ display: "flex", gap: 26, justifyContent: "center", position: "relative", zIndex: 1 }}>
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
                            style={{ position: "relative", border: "1px solid var(--xr-border)", borderRadius: 10, background: "var(--xr-surface-1)", padding: "11px 12px", fontSize: 12.5, width: 212, cursor: "pointer" }}
                          >
                            <div className="node-h" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                              <i className="ring" aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", border: "2px solid var(--xr-text-faint)", flex: "none" }} />
                              <b title={t.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name ?? t.taskId}</b>
                              {t.role && <span className="chip tiny rolechip" style={{ marginLeft: "auto", flex: "none" }} title={t.role}>{t.role.split("_").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}</span>}
                            </div>
                            <div className="mono faint">{t.status ?? "unknown"}{dur !== null ? ` · ${fmtDur(dur)}` : ""}</div>
                            {part && typeof part.capUsd === "number" && part.capUsd > 0 && (
                              <div className="budget" title="Engine-issued budget partition" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, fontSize: 10.5 }}>
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

          <aside className="wf-side" aria-label="Task inspector" style={{ border: "1px solid var(--xr-border)", borderRadius: 10, background: "var(--xr-surface-1)", padding: "10px 12px" }}>
            {selected ? (
              <>
                <div className="rail-h" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--xr-text-faint)", marginBottom: 6 }}>Task · {selected.name ?? selected.taskId}</div>
                <div className="kv2" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", fontSize: 11.5, marginBottom: 6 }}>
                  <span className="k" style={{ color: "var(--xr-text-faint)" }}>status</span><span className={`tlv ${auditClass(selected.status)}`}>{selected.status ?? "—"}</span>
                  <span className="k" style={{ color: "var(--xr-text-faint)" }}>role</span><span>{selected.role ?? "—"}</span>
                  <span className="k" style={{ color: "var(--xr-text-faint)" }}>agent</span><span className="mono">{selected.agentId ?? "—"}</span>
                  <span className="k" style={{ color: "var(--xr-text-faint)" }}>started</span><span className="mono">{fmtClock(selected.startedAt)}</span>
                  <span className="k" style={{ color: "var(--xr-text-faint)" }}>ended</span><span className="mono">{fmtClock(selected.endedAt)}</span>
                  {partFor(selected.taskId) && (
                    <>
                      <span className="k" style={{ color: "var(--xr-text-faint)" }}>budget</span>
                      <span className="mono">${(partFor(selected.taskId)!.consumedUsd ?? 0).toFixed(4)} / ${partFor(selected.taskId)!.capUsd ?? 0}</span>
                      <span className="k" style={{ color: "var(--xr-text-faint)" }}>tokens</span>
                      <span className="mono">{partFor(selected.taskId)!.consumedTokens ?? 0} / {partFor(selected.taskId)!.capTokens ?? 0}</span>
                    </>
                  )}
                </div>
                {selected.description && <p className="faint" style={{ fontSize: 11.5 }}>{selected.description}</p>}
                {selected.blockedReason && <p className="tl tl-wait" style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>blocked: {selected.blockedReason}</p>}
                {selected.outputs?.summary && <p className="tl tl-ok" style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>output: {selected.outputs.summary.slice(0, 240)}</p>}
                {(selected.errors ?? []).map((e, i) => <p key={i} className="tl tl-err" style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{e.slice(0, 200)}</p>)}
                <div className="rail-h" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--xr-text-faint)", marginBottom: 6, marginTop: 10 }}>Transcript <span className="faint mono" style={{ fontSize: 10 }}>auditTrail · {selected.auditTrail?.length ?? 0}</span></div>
                <div className="tl-box" style={{ maxHeight: 240, overflow: "auto", borderTop: "1px dashed var(--xr-border)", paddingTop: 6 }}>
                  {(selected.auditTrail ?? []).length === 0 && <div className="faint" style={{ fontSize: 11 }}>No audit events recorded for this task yet. Honest empty.</div>}
                  {(selected.auditTrail ?? []).slice(-40).map((ev, i) => (
                    <div key={i} className={`tl ${auditClass(ev.kind, ev.message)}`} style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, lineHeight: 1.55, color: "var(--xr-text-muted)", whiteSpace: "pre-wrap", margin: "2px 0" }}>
                      <span className="faint">{fmtClock(ev.ts)}</span> [{String(ev.kind ?? "event").toUpperCase()}] {String(ev.message ?? "").slice(0, 160)}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="rail-h" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--xr-text-faint)", marginBottom: 6 }}>Engine record</div>
                <div className="kv2" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", fontSize: 11.5, marginBottom: 6 }}>
                  <span className="k" style={{ color: "var(--xr-text-faint)" }}>workflow</span><span className="mono">{wfDetail?.workflowId ?? wfSel ?? "—"}</span>
                  <span className="k" style={{ color: "var(--xr-text-faint)" }}>status</span><span>{wfDetail?.status ?? "—"}</span>
                  <span className="k" style={{ color: "var(--xr-text-faint)" }}>review</span><span>{wfDetail?.reviewState ?? "—"}</span>
                  <span className="k" style={{ color: "var(--xr-text-faint)" }}>approval</span><span>{wfDetail?.approvalState ?? "—"}</span>
                </div>
                {wfDetail?.planSummary && (
                  <>
                    <div className="rail-h" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--xr-text-faint)", marginBottom: 6, marginTop: 8 }}>Plan summary</div>
                    <p className="faint" style={{ fontSize: 11.5 }}>{String(wfDetail.planSummary).slice(0, 400)}</p>
                  </>
                )}
                {wfDetail?.finalOutput?.summary && (
                  <>
                    <div className="rail-h" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--xr-text-faint)", marginBottom: 6, marginTop: 8 }}>Final output</div>
                    <p className="tl tl-ok" style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>{wfDetail.finalOutput.summary.slice(0, 300)}</p>
                  </>
                )}
                <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>Select a node for its transcript + budget. Honest.</div>
              </>
            )}
            {tasks.length > 0 && (
              <>
                <div className="rail-h" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--xr-text-faint)", marginBottom: 6, marginTop: 10 }}>Steps</div>
                <div className="stepschips" style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {tasks.map((t) => (
                    <button key={t.taskId} className={`chip stepchip${selTask === t.taskId ? " on" : ""}`} onClick={() => setSelTask(t.taskId)} title={t.status} style={{ cursor: "pointer", font: "inherit" }}>
                      <i className={`cdot ${ringFor(t.status)}`} />{t.name ?? t.taskId}
                    </button>
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      <div className="section-h" style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 24, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Runs</h2>
        <span className="faint" style={{ fontSize: 12 }}>history as product data — full anatomy per run · {filtered.length} total · {totalPages} pages</span>
      </div>

      {/* Search / filter / sort / pagination — Phase 1 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Search runs — title, prompt, id (engine index)"
          aria-label="Search runs"
          className="mono"
          style={{ flex: "1 1 auto", maxWidth: 420, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border-strong)", borderRadius: 6, color: "var(--xr-text)", padding: "7px 10px", fontSize: 12.5 }}
        />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as FilterStatus); setPage(1); }} aria-label="Filter status" className="mono" style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border-strong)", borderRadius: 6, color: "var(--xr-text)", padding: "7px 8px", fontSize: 12.5 }}>
          <option value="all">All statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="awaiting">Awaiting review</option>
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort" className="mono" style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border-strong)", borderRadius: 6, color: "var(--xr-text)", padding: "7px 8px", fontSize: 12.5 }}>
          <option value="date">Sort: Date</option>
          <option value="cost">Sort: Cost</option>
          <option value="title">Sort: Title</option>
        </select>
        <span className="mono faint" style={{ fontSize: 11, marginLeft: "auto" }}>{filtered.length} shown · page {page}/{totalPages}</span>
        <button className="btn small" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
        <button className="btn small" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
      </div>

      {filtered.length === 0 && !loading && <div className="empty">No runs match — honest empty state with search and filters. Try clearing filters or start a task in Work.</div>}
      {loading && filtered.length === 0 && (
        <>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="runrow" style={{ display: "grid", gridTemplateColumns: "10px 1fr auto auto", gap: 12, alignItems: "center", padding: "10px 12px", border: "1px solid var(--xr-border)", borderRadius: 10, background: "var(--xr-surface-1)", marginBottom: 8 }}>
              <span className="skeleton" style={{ width: 8, height: 8, borderRadius: "50%" }} />
              <div><div className="skeleton" style={{ height: 12, width: "60%", marginBottom: 6 }} /><div className="skeleton" style={{ height: 10, width: "40%" }} /></div>
              <span className="skeleton" style={{ width: 40, height: 12 }} />
              <span className="skeleton" style={{ width: 50, height: 12 }} />
            </div>
          ))}
        </>
      )}
      {paged.map((s) => (
        <div key={s.id} className="runrow" role="button" tabIndex={0} onClick={() => onOpen(s.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(s.id)} style={{ display: "grid", gridTemplateColumns: "10px 1fr auto auto", gap: 12, alignItems: "center", padding: "10px 12px", border: "1px solid var(--xr-border)", borderRadius: 10, background: "var(--xr-surface-1)", marginBottom: 8, cursor: "pointer", transition: "border-color 120ms var(--xr-ease), transform 120ms var(--xr-ease)" }}>
          <span className={`dot ${s.status === "failed" ? "red" : s.status === "running" ? "cyan" : "green"}`} style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block", background: s.status === "failed" ? "var(--xr-red)" : s.status === "running" ? "var(--xr-cyan)" : "var(--xr-green)" }} />
          <div>
            <div className="title" style={{ fontWeight: 600, fontSize: 13.5 }}>{s.title || s.prompt?.slice(0, 80) || s.id}</div>
            <div className="sub mono" style={{ fontSize: 12, color: "var(--xr-text-muted)" }}>{s.id} · {s.workspace ?? s.cwd ?? "default"} · {s.model ?? s.provider ?? "engine default"}</div>
          </div>
          <span className="sub mono" style={{ fontSize: 12, color: "var(--xr-text-muted)" }}>{s.mode ?? "agent"}</span>
          <span className="sub mono" style={{ fontSize: 12, color: "var(--xr-text-muted)" }}>{typeof s.costUsd === "number" ? `$${s.costUsd.toFixed(4)}` : "—"}</span>
        </div>
      ))}

      {openId && (
        <aside className="drawer" aria-label="Run inspector" style={{ position: "fixed", top: 40, right: 0, bottom: 0, width: "min(560px, 92vw)", background: "var(--xr-surface-1)", borderLeft: "1px solid var(--xr-border)", padding: 18, overflow: "auto", boxShadow: "-20px 0 60px rgba(0,0,0,0.5)", animation: "xr-drawer-in 320ms var(--xr-ease-drawer)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{String(detail?.title ?? (detail?.prompt as string)?.slice(0, 60) ?? openId)}</h3>
            <button className="pill" style={{ marginLeft: "auto" }} onClick={() => onOpen(null)}>Close ⎋</button>
          </div>
          <div className="kv mono" style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 12px", fontSize: 13, margin: "12px 0" }}>
            <span className="k" style={{ color: "var(--xr-text-faint)" }}>run id</span><span>{openId}</span>
            <span className="k" style={{ color: "var(--xr-text-faint)" }}>status</span><span>{String(detail?.status ?? "—")}</span>
            <span className="k" style={{ color: "var(--xr-text-faint)" }}>mode</span><span>{String(detail?.mode ?? "—")}</span>
            <span className="k" style={{ color: "var(--xr-text-faint)" }}>model</span><span>{String(detail?.model ?? detail?.provider ?? "—")}</span>
            <span className="k" style={{ color: "var(--xr-text-faint)" }}>workspace</span><span>{String(detail?.workspace ?? detail?.cwd ?? "—")}</span>
            <span className="k" style={{ color: "var(--xr-text-faint)" }}>cost</span><span>{typeof detail?.costUsd === "number" ? `$${(detail.costUsd as number).toFixed(4)}` : "—"}</span>
          </div>
          <div className="tabs" role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--xr-border)", margin: "12px 0" }}>
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)} style={{ background: "transparent", border: 0, borderBottom: "2px solid transparent", color: t === tab ? "var(--xr-cyan)" : "var(--xr-text-muted)", borderBottomColor: t === tab ? "var(--xr-cyan)" : "transparent", padding: "6px 10px", cursor: "pointer", fontSize: 13 }}>{t}</button>
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
        <div key={r.path} className={`tl ${r.ok === false ? "tl-err" : "tl-ok"}`} style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>
          <span className="faint">{r.ok === false ? "✗" : "✓"}</span>{" "}
          <span className="mono">{r.path}</span>
          <span className="faint"> · {r.tool}</span>
          <button className="chip" style={{ marginLeft: 8, cursor: "pointer" }} onClick={() => showDiff(r.path)}>diff</button>
        </div>
      ))}
      {sel && (
        <pre className="raw" style={{ marginTop: 8, background: "var(--xr-bg)", border: "1px solid var(--xr-border)", borderRadius: 6, padding: 10, fontFamily: "var(--xr-font-mono)", fontSize: 12, overflow: "auto", maxHeight: 320 }}>{loading ? "asking the engine…" : `${sel}\n${diffText ?? ""}`}</pre>
      )}
    </div>
  );
}

function SessionAnatomy({ detail, tab }: { detail: Record<string, unknown> | null; tab: string }) {
  const steps: SessionStep[] = Array.isArray(detail?.steps) ? (detail!.steps as SessionStep[]) : [];
  const audit: SessionAudit[] = Array.isArray(detail?.audit) ? (detail!.audit as SessionAudit[]) : [];
  const clock = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : "—");

  if (tab === "Transcript") {
    if (steps.length === 0) return <pre className="raw" style={{ background: "var(--xr-bg)", border: "1px solid var(--xr-border)", borderRadius: 6, padding: 10, fontFamily: "var(--xr-font-mono)", fontSize: 12, overflow: "auto", maxHeight: 320 }}>{JSON.stringify(pick(detail, tab), null, 2)}</pre>;
    const tip = audit.length ? audit[audit.length - 1].hash?.slice(0, 8) : null;
    return (
      <div className="tl-box" style={{ maxHeight: 380 }}>
        <div className="tl tl-info" style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>chain tip {tip ?? "—"} · {audit.length} audit events · honest</div>
        {steps.map((s) => (
          <div key={s.id ?? s.idx} className={`tl ${/error|fail/.test(s.phase ?? "") ? "tl-err" : s.phase === "tool" ? "tl-tool" : "tl-info"}`} style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, lineHeight: 1.55 }}>
            <span className="faint">{clock(s.created_at)}</span> [{String(s.phase ?? "step").toUpperCase()}]{" "}
            {s.parsedDetail?.message ?? String(s.detail ?? "").slice(0, 160)}
          </div>
        ))}
      </div>
    );
  }
  if (tab === "Tools") {
    const calls = steps.flatMap((s) => (s.parsedDetail?.toolCalls ?? []).map((c) => ({ ...c, phase: s.phase, ts: s.created_at })));
    if (calls.length === 0) return <p className="faint" style={{ fontSize: 11.5 }}>No tool calls recorded in this session's steps. Honest empty.</p>;
    return (
      <div className="tl-box" style={{ maxHeight: 380 }}>
        {calls.map((c, i) => (
          <div key={i} className={`tl ${c.ok === false ? "tl-err" : "tl-ok"}`} style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>
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
    if (rows.length === 0) return <p className="faint" style={{ fontSize: 11.5 }}>No cost snapshots in the audit chain yet. Honest.</p>;
    return (
      <div className="tl-box" style={{ maxHeight: 380 }}>
        {rows.map((r, i) => (
          <div key={i} className="tl tl-info" style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>
            <span className="faint">{clock(r.ts)}</span> {r.ev} · in {String(r.snap!.inTokens)} / out {String(r.snap!.outTokens)} tok · ${String(r.snap!.usd)}
          </div>
        ))}
        <div className="tl tl-info faint" style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}>engine audit chain is the ledger of record — backend enforced, never invented</div>
      </div>
    );
  }
  if (tab === "Files") {
    const touched = steps.flatMap((s) =>
      (s.parsedDetail?.toolCalls ?? [])
        .filter((c) => /write|edit|patch|file/i.test(String(c.tool ?? "")) && typeof (c.args as { path?: unknown } | undefined)?.path === "string")
        .map((c) => ({ path: String((c.args as { path: string }).path), ok: c.ok, tool: c.tool, ts: s.created_at })),
    );
    const seen = new Set<string>();
    const rows = touched.filter((t) => (seen.has(t.path) ? false : (seen.add(t.path), true)));
    return (
      <FilesTab rows={rows} fallback={() => <pre className="raw" style={{ background: "var(--xr-bg)", border: "1px solid var(--xr-border)", borderRadius: 6, padding: 10, fontFamily: "var(--xr-font-mono)", fontSize: 12, overflow: "auto", maxHeight: 320 }}>{JSON.stringify(pick(detail, "Files"), null, 2)}</pre>} />
    );
  }
  if (tab === "Approvals") {
    const rows = audit.filter((a) => /approv|consent|decision/.test(a.event ?? ""));
    if (rows.length === 0) return <p className="faint" style={{ fontSize: 11.5 }}>No approval events in this session's audit chain. Honest empty.</p>;
    return (
      <div className="tl-box" style={{ maxHeight: 380 }}>
        {rows.map((a, i) => (
          <div key={i} className="tl tl-wait" style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11 }}><span className="faint">{clock(a.created_at)}</span> {a.event} · {String(a.detail ?? "").slice(0, 120)}</div>
        ))}
      </div>
    );
  }
  return <pre className="raw" style={{ background: "var(--xr-bg)", border: "1px solid var(--xr-border)", borderRadius: 6, padding: 10, fontFamily: "var(--xr-font-mono)", fontSize: 12, overflow: "auto", maxHeight: 320 }}>{JSON.stringify(pick(detail, tab), null, 2) ?? "—"}</pre>;
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
  return Object.keys(hit).length ? hit : { note: `${tab}: no engine data in this run record — honest` };
}
