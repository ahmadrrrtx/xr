import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type TeamView, type WorkflowDetail, type WorkflowSummary } from "../api/client";

/**
 * Phase 4 · Multi-agent page (mockup 05). Everything rendered here comes from
 * the engine: GET /agents (run list), GET /agents/workflows/{id}/view (the
 * composed snapshot — progress, cost roll-ups, budget partitions, DAG tiers,
 * control affordances) and GET /agents/workflows/{id} (transcript + artifacts).
 * The shell lays out and forwards verbs (pause/resume/cancel/create); it never
 * computes cost, progress or policy (SEC-07). Live updates ride the engine's
 * SSE task-event stream with a slow poll as fallback.
 */

const NODE_W = 236;
const NODE_H = 96;
const TIER_H = 132;
const GAP_X = 276;

function ringFor(status: string): string {
  const s = status.toLowerCase();
  if (/(complet|done|success|pass)/.test(s)) return "g";
  if (/(fail|error|abort)/.test(s)) return "r";
  if (/(approv|review|block|wait)/.test(s)) return "a";
  if (/(paused|cancel)/.test(s)) return "p";
  if (/(run|work|active|progress)/.test(s)) return "c";
  return "n";
}

const RING_HEX: Record<string, string> = {
  g: "#22c55e",
  r: "#ef4444",
  a: "#f59e0b",
  p: "#8b5cf6",
  c: "#22d3ee",
  n: "#64748b",
};

/** Role glyph inside the status ring — presentation only. */
function RoleGlyph({ role }: { role: string }) {
  const r = role.toLowerCase();
  if (/(orchestr|supervis|plan)/.test(r)) return <text x="16" y="21" fontSize="12" fill="currentColor">{">_"}</text>;
  if (/(research)/.test(r)) return <path d="M16 8a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM8 16h16M16 8c-3 2.6-3 13.4 0 16 3-2.6 3-13.4 0-16z" fill="none" stroke="currentColor" strokeWidth="1.6" />;
  if (/(cod|build|exec)/.test(r)) return <path d="M12 10l-4 6 4 6M20 10l4 6-4 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />;
  if (/(review|verif|secur)/.test(r)) return <path d="M11 8h10v16H11zM14 12h4M14 16h4M14 20h2" fill="none" stroke="currentColor" strokeWidth="1.6" />;
  return <path d="M11 8h10v16H11zM14 13h4M14 17h4" fill="none" stroke="currentColor" strokeWidth="1.6" />;
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Layout {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

function layout(view: TeamView): Layout {
  const tiers = new Map<number, TeamView["nodes"]>();
  for (const n of view.nodes) {
    const list = tiers.get(n.tier) ?? [];
    list.push(n);
    tiers.set(n.tier, list);
  }
  const pos = new Map<string, { x: number; y: number }>();
  let width = 0;
  const maxTier = Math.max(0, ...[...tiers.keys()]);
  for (let t = 0; t <= maxTier; t++) {
    const list = tiers.get(t) ?? [];
    width = Math.max(width, list.length * GAP_X);
    list.forEach((n, i) => {
      pos.set(n.taskId, {
        x: width / 2 + (i - (list.length - 1) / 2) * GAP_X - NODE_W / 2,
        y: 16 + t * TIER_H,
      });
    });
  }
  return { pos, width: Math.max(width, 560), height: 32 + (maxTier + 1) * TIER_H };
}

export function Teams() {
  const [runs, setRuns] = useState<WorkflowSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<TeamView | null>(null);
  const [record, setRecord] = useState<WorkflowDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [steerText, setSteerText] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const reloadRef = useRef<() => void>(() => undefined);

  const loadList = useCallback(async () => {
    try {
      const d = await api.agents();
      const list = (d.workflows ?? []) as WorkflowSummary[];
      setRuns(list);
      setActiveId((cur) => {
        if (cur && list.some((w) => w.id === cur)) return cur;
        const live = list.find((w) => ["running", "paused", "planned", "awaiting_review", "blocked"].includes(w.status ?? ""));
        return (live ?? list[0])?.id ?? null;
      });
    } catch {
      /* engine unreachable — honest empty board */
    }
  }, []);

  const loadActive = useCallback(async () => {
    if (!activeId) {
      setView(null);
      setRecord(null);
      return;
    }
    try {
      const [v, r] = await Promise.all([api.workflowView(activeId), api.workflow(activeId)]);
      setView(v.workflow);
      setRecord(r);
      setSelected((cur) => {
        if (cur && v.workflow.nodes.some((n) => n.taskId === cur)) return cur;
        return (v.workflow.nodes.find((n) => n.status === "running") ?? v.workflow.nodes[0])?.taskId ?? null;
      });
    } catch {
      setView(null);
      setRecord(null);
    }
  }, [activeId]);

  reloadRef.current = () => {
    void loadList();
    void loadActive();
  };

  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    void loadActive();
  }, [loadActive]);

  // Live: engine SSE task events → debounced refresh; slow poll as fallback.
  useEffect(() => {
    let timer: number | undefined;
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/agents/events");
      es.onmessage = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => reloadRef.current(), 350);
      };
    } catch {
      /* no SSE — poll below covers us */
    }
    const poll = window.setInterval(() => {
      if (view && ["running", "paused", "awaiting_review", "planned"].includes(view.status)) reloadRef.current();
    }, 5000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      es?.close();
    };
  }, [view]);

  const control = async (action: "pause" | "resume" | "cancel") => {
    if (!activeId) return;
    setBusy(action);
    setNotice(null);
    try {
      const d = await api.workflowControl(activeId, action);
      setView(d.workflow);
      void loadList();
      void loadActive();
    } catch (e) {
      setNotice(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    if (!goal.trim()) return;
    setBusy("start");
    setNotice(null);
    try {
      const d = await api.workflowCreate({
        goal: goal.trim(),
        budget: Number(budget) || undefined,
        dryRun,
      });
      setActiveId(d.workflow.workflowId);
      setGoal("");
      void loadList();
    } catch (e) {
      setNotice(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const steer = async () => {
    if (!activeId || !steerText.trim()) return;
    setBusy("steer");
    setNotice(null);
    try {
      const d = await api.workflowSteer(activeId, steerText.trim(), selected);
      setView(d.workflow);
      setSteerText("");
      void loadList();
      void loadActive();
    } catch (e) {
      setNotice(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const review = async (approved: boolean) => {
    if (!activeId || !selected) return;
    setBusy(approved ? "approve" : "reject");
    setNotice(null);
    try {
      const d = await api.workflowReview(activeId, selected, approved, reviewComment.trim() || undefined);
      setView(d.workflow);
      setReviewComment("");
      void loadList();
      void loadActive();
    } catch (e) {
      setNotice(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const lay = useMemo(() => (view ? layout(view) : null), [view]);
  const selNode = view?.nodes.find((n) => n.taskId === selected) ?? null;
  const selTask = record?.tasks?.find((t) => t.taskId === selected) ?? null;

  return (
    <div className="ma-root">
      <div className="ma-toprow">
        <div className="rail-h">Multi-agent orchestration</div>
        {runs.length > 0 && (
          <select className="ma-picker mono" value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value || null)}>
            {runs.map((w) => (
              <option key={w.id} value={w.id}>
                {String(w.goal ?? w.id).slice(0, 48)} · {String(w.status ?? "?")}
              </option>
            ))}
          </select>
        )}
      </div>

      {view && lay && (
        <>
          <section className="ma-banner">
            <div className="ma-b-head">
              <span className="ma-b-title">
                {["completed", "failed", "cancelled"].includes(view.status) ? "Team Run" : "Active Team Run"}: {view.goal}
              </span>
              <span className="ma-b-pct mono">{view.progressPct}%</span>
            </div>
            <div className="ma-b-bar">
              <i style={{ width: `${view.progressPct}%` }} />
            </div>
            <div className="ma-b-foot">
              <span className="mono faint">
                Total Cost: {money(view.costUsd)}
                {view.costCapUsd > 0 ? ` / cap ${money(view.costCapUsd)}` : ""} · {view.tasksCompleted}/{view.tasksTotal} tasks
                {view.tasksFailed > 0 ? ` · ${view.tasksFailed} failed` : ""} · {view.status}
              </span>
              <span className="ma-b-btns">
                <button className="btn ghost" disabled={!view.affordances.pause || busy !== null} onClick={() => void control("pause")}>
                  {busy === "pause" ? "…" : "❚❚ Pause"}
                </button>
                <button className="btn ghost" disabled={!view.affordances.resume || busy !== null} onClick={() => void control("resume")}>
                  {busy === "resume" ? "…" : "▶ Resume"}
                </button>
                <button className="btn ghost danger" disabled={!view.affordances.cancel || busy !== null} onClick={() => void control("cancel")}>
                  {busy === "cancel" ? "…" : "⊗ Cancel"}
                </button>
              </span>
            </div>
            {notice && <div className="ma-notice mono">{notice}</div>}
          </section>

          <div className="ma-cols">
            <div className="ma-graph" style={{ height: lay.height }}>
              <svg className="ma-edges" width={lay.width} height={lay.height} aria-hidden="true">
                <defs>
                  <marker id="ma-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0L10 5L0 10z" fill="#475569" />
                  </marker>
                </defs>
                {view.edges.map((e) => {
                  const a = lay.pos.get(e.from);
                  const b = lay.pos.get(e.to);
                  if (!a || !b) return null;
                  const x1 = a.x + NODE_W / 2;
                  const y1 = a.y + NODE_H;
                  const x2 = b.x + NODE_W / 2;
                  const y2 = b.y - 4;
                  const my = (y1 + y2) / 2;
                  return <path key={`${e.from}-${e.to}`} d={`M${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`} fill="none" stroke="#475569" strokeWidth="1.4" markerEnd="url(#ma-arrow)" />;
                })}
              </svg>
              {view.nodes.map((n) => {
                const p = lay.pos.get(n.taskId);
                if (!p) return null;
                const ring = ringFor(n.status);
                const pct = n.budget.capUsd > 0 ? Math.min(100, (100 * n.budget.consumedUsd) / n.budget.capUsd) : 0;
                return (
                  <button
                    key={n.taskId}
                    className={`ma-node ${selected === n.taskId ? "sel" : ""}`}
                    style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                    onClick={() => setSelected(n.taskId)}
                    aria-label={`${n.name} (${n.status})`}
                  >
                    <svg className={`ma-ring r-${ring}`} viewBox="0 0 32 32" width="44" height="44" aria-hidden="true">
                      <circle cx="16" cy="16" r="13" fill="none" stroke="#1e293b" strokeWidth="3" />
                      <circle cx="16" cy="16" r="13" fill="none" stroke={RING_HEX[ring]} strokeWidth="3" strokeDasharray={ring === "c" ? "60 22" : "82 0"} strokeLinecap="round" transform="rotate(-90 16 16)" />
                      <g color={RING_HEX[ring]}>
                        <RoleGlyph role={n.role} />
                      </g>
                    </svg>
                    <span className="ma-n-body">
                      <span className="ma-n-name">{n.name}</span>
                      <span className="ma-n-status" style={{ color: RING_HEX[ring] }}>
                        Status: {n.status}
                      </span>
                      <span className="ma-n-budget">
                        budget: <i><b style={{ width: `${pct}%` }} /></i>
                        {n.budget.capUsd > 0 ? <em className="mono">{money(n.budget.consumedUsd)}/{money(n.budget.capUsd)}</em> : null}
                      </span>
                    </span>
                    {n.phase && <span className="ma-n-phase mono">{n.phase}</span>}
                  </button>
                );
              })}
            </div>

            <aside className="ma-side">
              <div className="ma-side-head">
                {selNode ? `${selNode.name}${selNode.phase ? ` (${selNode.phase})` : ""} — Transcript Preview` : "Transcript Preview"}
              </div>
              <div className="ma-log">
                {(selTask?.auditTrail ?? []).slice(-40).map((ev, i) => (
                  <div key={`${ev.ts ?? i}-${i}`} className="ma-line">
                    <span className={`ma-kind k-${ringFor(String(ev.kind ?? "note"))}`}>[{String(ev.kind ?? "note").toUpperCase()}]</span> {String(ev.message ?? "")}
                  </div>
                ))}
                {selTask?.blockedReason && <div className="ma-line tl-err">blocked: {selTask.blockedReason}</div>}
                {selTask?.outputs?.summary && <div className="ma-line tl-ok">summary: {selTask.outputs.summary}</div>}
                {(selTask?.auditTrail ?? []).length === 0 && <div className="ma-line faint">no events yet for this task</div>}
              </div>
              {selNode?.awaitingReview && (
                <div className="ma-review">
                  <div className="rail-h">Review decision (engine-enforced)</div>
                  <input className="inp mono" placeholder="comment (required context for rejects)" value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} />
                  <div className="ma-review-btns">
                    <button className="btn" disabled={busy !== null} onClick={() => void review(true)}>Approve</button>
                    <button className="btn ghost danger" disabled={busy !== null} onClick={() => void review(false)}>Request changes</button>
                  </div>
                </div>
              )}
              <div className="ma-steer">
                <div className="rail-h">Steer {selNode ? `· ${selNode.name}` : ""}</div>
                <textarea className="inp mono" rows={2} placeholder="Inject an instruction into the live run (delegates a task, audited)" value={steerText} onChange={(e) => setSteerText(e.target.value)} />
                <button className="btn" disabled={busy !== null || !steerText.trim() || !(view?.affordances.steer)} onClick={() => void steer()}>
                  {busy === "steer" ? "…" : "Steer run"}
                </button>
                {view && !view.affordances.steer && <span className="faint mono" style={{ fontSize: 10 }}>run is {view.status} — steer unavailable</span>}
              </div>
              <div className="ma-chips">
                {(selTask?.outputs?.artifacts ?? []).slice(0, 8).map((a, i) => (
                  <span key={`${a.path}-${i}`} className="ma-chip mono" title={a.path}>
                    {a.description ?? a.path}
                  </span>
                ))}
                {selNode && selNode.reviewState !== "not_required" && (
                  <span className={`ma-chip mono ${selNode.reviewState === "approved" ? "ok" : selNode.reviewState === "pending" ? "wait" : ""}`}>review: {selNode.reviewState}</span>
                )}
                {(selTask?.outputs?.artifacts ?? []).length === 0 && <span className="ma-chip mono faint">…</span>}
              </div>
            </aside>
          </div>
        </>
      )}

      {!view && (
        <section className="ma-empty tc-card">
          <div className="rail-h">No team run selected</div>
          <p className="faint" style={{ fontSize: 12 }}>
            Start a team run: the engine plans the task graph (supervisor → workers → reviewer → synthesis), funds every
            worker from a ledger partition, and streams live status here. Dry-run plans the graph without executing.
          </p>
          <div className="ma-form">
            <input className="inp" placeholder="Goal — e.g. ship the billing retry fix with tests" value={goal} onChange={(e) => setGoal(e.target.value)} />
            <input className="inp mono" placeholder="budget cap USD (optional)" value={budget} onChange={(e) => setBudget(e.target.value)} />
            <label className="ma-dry">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> plan only (dry run)
            </label>
            <button className="btn" disabled={busy !== null || !goal.trim()} onClick={() => void start()}>
              {busy === "start" ? "planning…" : "Start team run"}
            </button>
          </div>
          {notice && <div className="ma-notice mono">{notice}</div>}
        </section>
      )}
    </div>
  );
}
