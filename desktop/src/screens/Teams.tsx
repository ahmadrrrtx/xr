import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type TeamView, type WorkflowDetail, type WorkflowSummary } from "../api/client";

/** Teams — Multi-Agent orchestration hardened elite Phase 1
 * Engine is sole authority for cost/progress/policy (SEC-07), real SSE + poll fallback.
 * Tokens var(--xr-*), motion 120/200/320, skeleton/empty/error, a11y focus cyan.
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
const RING_HEX: Record<string, string> = { g: "#22c55e", r: "#ef4444", a: "#f59e0b", p: "#8b5cf6", c: "#22d3ee", n: "#64748b" };
function money(n: number): string { return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

interface Layout { pos: Map<string, { x: number; y: number }>; width: number; height: number; }
function layout(view: TeamView): Layout {
  const tiers = new Map<number, TeamView["nodes"]>();
  for (const n of view.nodes) { const list = tiers.get(n.tier) ?? []; list.push(n); tiers.set(n.tier, list); }
  const pos = new Map<string, { x: number; y: number }>();
  let width = 0;
  const maxTier = Math.max(0, ...[...tiers.keys()]);
  for (let t = 0; t <= maxTier; t++) {
    const list = tiers.get(t) ?? [];
    width = Math.max(width, list.length * GAP_X);
    list.forEach((n, i) => { pos.set(n.taskId, { x: width / 2 + (i - (list.length - 1) / 2) * GAP_X - NODE_W / 2, y: 16 + t * TIER_H }); });
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
  const [loading, setLoading] = useState(true);
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
    } catch { /* honest empty */ } finally { setLoading(false); }
  }, []);

  const loadActive = useCallback(async () => {
    if (!activeId) { setView(null); setRecord(null); return; }
    try {
      const [v, r] = await Promise.all([api.workflowView(activeId), api.workflow(activeId)]);
      setView(v.workflow); setRecord(r);
      setSelected((cur) => { if (cur && v.workflow.nodes.some((n) => n.taskId === cur)) return cur; return (v.workflow.nodes.find((n) => n.status === "running") ?? v.workflow.nodes[0])?.taskId ?? null; });
    } catch { setView(null); setRecord(null); }
  }, [activeId]);

  reloadRef.current = () => { void loadList(); void loadActive(); };
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { void loadActive(); }, [loadActive]);

  useEffect(() => {
    let timer: number | undefined; let es: EventSource | null = null;
    try {
      es = new EventSource("/api/agents/events");
      es.onmessage = () => { window.clearTimeout(timer); timer = window.setTimeout(() => reloadRef.current(), 350); };
    } catch { /* poll fallback */ }
    const poll = window.setInterval(() => { if (view && ["running", "paused", "awaiting_review", "planned"].includes(view.status)) reloadRef.current(); }, 5000);
    return () => { window.clearTimeout(timer); window.clearInterval(poll); es?.close(); };
  }, [view]);

  const control = async (action: "pause" | "resume" | "cancel") => {
    if (!activeId) return; setBusy(action); setNotice(null);
    try { const d = await api.workflowControl(activeId, action); setView(d.workflow); void loadList(); void loadActive(); }
    catch (e) { setNotice(String((e as Error)?.message ?? e)); } finally { setBusy(null); }
  };
  const start = async () => {
    if (!goal.trim()) return; setBusy("start"); setNotice(null);
    try { const d = await api.workflowCreate({ goal: goal.trim(), budget: Number(budget) || undefined, dryRun }); setActiveId(d.workflow.workflowId); setGoal(""); void loadList(); }
    catch (e) { setNotice(String((e as Error)?.message ?? e)); } finally { setBusy(null); }
  };
  const steer = async () => {
    if (!activeId || !steerText.trim()) return; setBusy("steer"); setNotice(null);
    try { const d = await api.workflowSteer(activeId, steerText.trim(), selected); setView(d.workflow); setSteerText(""); void loadList(); void loadActive(); }
    catch (e) { setNotice(String((e as Error)?.message ?? e)); } finally { setBusy(null); }
  };
  const review = async (approved: boolean) => {
    if (!activeId || !selected) return; setBusy(approved ? "approve" : "reject"); setNotice(null);
    try { const d = await api.workflowReview(activeId, selected, approved, reviewComment.trim() || undefined); setView(d.workflow); setReviewComment(""); void loadList(); void loadActive(); }
    catch (e) { setNotice(String((e as Error)?.message ?? e)); } finally { setBusy(null); }
  };

  const lay = useMemo(() => (view ? layout(view) : null), [view]);
  const selNode = view?.nodes.find((n) => n.taskId === selected) ?? null;
  const selTask = record?.tasks?.find((t) => t.taskId === selected) ?? null;

  if (loading) {
    return <div style={{ padding: "var(--xr-space-4)", display: "grid", gap: 12 }}>{Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 120, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", animation: "xr-pulse 1.2s infinite" }} />)}</div>;
  }

  return (
    <div style={{ padding: "var(--xr-space-4)", display: "grid", gap: "var(--xr-space-3)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--xr-text-2)" }}>Multi-agent orchestration — engine is authority (SEC-07)</span>
        {runs.length > 0 && (
          <select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value || null)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }}>
            {runs.map((w) => <option key={w.id} value={w.id}>{String(w.goal ?? w.id).slice(0, 48)} · {String(w.status ?? "?")}</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{runs.length} workflows</span>
      </div>

      {view && lay && (
        <>
          <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 16, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{["completed", "failed", "cancelled"].includes(view.status) ? "Team Run" : "Active Team Run"}: {view.goal}</span>
              <span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 12, color: "var(--xr-text-2)", marginLeft: "auto" }}>{view.progressPct}%</span>
            </div>
            <div style={{ height: 6, background: "var(--xr-surface-3)", borderRadius: 999, overflow: "hidden" }}><i style={{ display: "block", height: "100%", width: `${view.progressPct}%`, background: "var(--xr-accent)", transition: "width var(--xr-motion-state) var(--xr-ease-default)" }} /></div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-2)" }}>
              <span>Total Cost: {money(view.costUsd)}{view.costCapUsd > 0 ? ` / cap ${money(view.costCapUsd)}` : ""} · {view.tasksCompleted}/{view.tasksTotal} tasks{view.tasksFailed > 0 ? ` · ${view.tasksFailed} failed` : ""} · {view.status}</span>
              <span style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                <button disabled={!view.affordances.pause || busy !== null} onClick={() => void control("pause")} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", cursor: "pointer" }}>{busy === "pause" ? "…" : "⏸ Pause"}</button>
                <button disabled={!view.affordances.resume || busy !== null} onClick={() => void control("resume")} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", cursor: "pointer" }}>{busy === "resume" ? "…" : "▶ Resume"}</button>
                <button disabled={!view.affordances.cancel || busy !== null} onClick={() => void control("cancel")} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--xr-danger)", color: "var(--xr-danger)", background: "transparent", cursor: "pointer" }}>{busy === "cancel" ? "…" : "⊗ Cancel"}</button>
              </span>
            </div>
            {notice && <div style={{ padding: "8px 12px", borderRadius: 6, background: "color-mix(in srgb, var(--xr-danger) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--xr-danger) 30%, transparent)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }}>{notice}</div>}
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "var(--xr-space-3)", minHeight: 0 }}>
            <div style={{ position: "relative", background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", overflow: "auto", minHeight: lay.height }}>
              <svg width={lay.width} height={lay.height} aria-hidden style={{ position: "absolute", inset: 0 }}>
                <defs><marker id="ma-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#475569" /></marker></defs>
                {view.edges.map((e) => {
                  const a = lay.pos.get(e.from); const b = lay.pos.get(e.to); if (!a || !b) return null;
                  const x1 = a.x + NODE_W / 2; const y1 = a.y + NODE_H; const x2 = b.x + NODE_W / 2; const y2 = b.y - 4; const my = (y1 + y2) / 2;
                  return <path key={`${e.from}-${e.to}`} d={`M${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`} fill="none" stroke="#475569" strokeWidth={1.4} markerEnd="url(#ma-arrow)" />;
                })}
              </svg>
              {view.nodes.map((n) => {
                const p = lay.pos.get(n.taskId); if (!p) return null;
                const ring = ringFor(n.status); const pct = n.budget.capUsd > 0 ? Math.min(100, (100 * n.budget.consumedUsd) / n.budget.capUsd) : 0;
                return (
                  <button key={n.taskId} onClick={() => setSelected(n.taskId)} aria-label={`${n.name} (${n.status})`} style={{ position: "absolute", left: p.x, top: p.y, width: NODE_W, height: NODE_H, display: "flex", gap: 10, alignItems: "center", padding: 10, background: selected === n.taskId ? "var(--xr-surface-2)" : "var(--xr-surface-1)", border: selected === n.taskId ? "2px solid var(--xr-accent)" : "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-md)", cursor: "pointer", textAlign: "left", transition: "border-color var(--xr-motion-micro) var(--xr-ease-default)" }}>
                    <span style={{ width: 36, height: 36, borderRadius: 999, border: `2px solid ${RING_HEX[ring]}`, display: "grid", placeItems: "center", fontSize: 10, color: RING_HEX[ring] }}>{n.role.slice(0, 2).toUpperCase()}</span>
                    <span style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
                      <span style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
                      <span style={{ fontSize: 10, color: RING_HEX[ring] }}>Status: {n.status}</span>
                      <span style={{ display: "flex", gap: 4, alignItems: "center" }}><span style={{ width: 40, height: 4, background: "var(--xr-surface-3)", borderRadius: 999, overflow: "hidden" }}><b style={{ display: "block", height: "100%", width: `${pct}%`, background: RING_HEX[ring] }} /></span>{n.budget.capUsd > 0 && <em style={{ fontFamily: "var(--xr-font-mono)", fontSize: 10, fontStyle: "normal" }}>{money(n.budget.consumedUsd)}/{money(n.budget.capUsd)}</em>}</span>
                    </span>
                    {n.phase && <span style={{ fontFamily: "var(--xr-font-mono)", fontSize: 9, color: "var(--xr-text-3)" }}>{n.phase}</span>}
                  </button>
                );
              })}
            </div>

            <aside style={{ display: "flex", flexDirection: "column", gap: 12, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 12, overflow: "auto", maxHeight: "70vh" }}>
              <div style={{ fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{selNode ? `${selNode.name}${selNode.phase ? ` (${selNode.phase})` : ""} — Transcript` : "Transcript Preview"}</div>
              <div style={{ display: "grid", gap: 6, fontFamily: "var(--xr-font-mono)", fontSize: 11, maxHeight: 220, overflow: "auto" }}>
                {(selTask?.auditTrail ?? []).slice(-40).map((ev, i) => (<div key={`${(ev as any).ts ?? i}-${i}`}><span style={{ color: RING_HEX[ringFor(String((ev as any).kind ?? "note"))] }}>[{String((ev as any).kind ?? "note").toUpperCase()}]</span> {String((ev as any).message ?? "")}</div>))}
                {(selTask?.auditTrail ?? []).length === 0 && <div style={{ color: "var(--xr-text-3)" }}>no events yet for this task — honest, not invented</div>}
                {selTask?.blockedReason && <div style={{ color: "var(--xr-danger)" }}>blocked: {selTask.blockedReason}</div>}
                {selTask?.outputs?.summary && <div style={{ color: "var(--xr-success)" }}>summary: {selTask.outputs.summary}</div>}
              </div>
              {selNode?.awaitingReview && (
                <div style={{ display: "grid", gap: 8, padding: 10, background: "var(--xr-surface-2)", border: "1px solid var(--xr-warning)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>Review decision (engine-enforced)</div>
                  <input placeholder="comment (required for rejects)" value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }} />
                  <div style={{ display: "flex", gap: 8 }}><button disabled={busy !== null} onClick={() => void review(true)} style={{ padding: "6px 12px", borderRadius: 6, background: "var(--xr-success)", color: "white", border: "none", cursor: "pointer" }}>Approve</button><button disabled={busy !== null} onClick={() => void review(false)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--xr-danger)", color: "var(--xr-danger)", background: "transparent", cursor: "pointer" }}>Request changes</button></div>
                </div>
              )}
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>Steer {selNode ? `· ${selNode.name}` : ""}</div>
                <textarea rows={2} placeholder="Inject instruction into live run (delegates a task, audited)" value={steerText} onChange={(e) => setSteerText(e.target.value)} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 11, resize: "vertical" }} />
                <button disabled={busy !== null || !steerText.trim() || !(view?.affordances.steer)} onClick={() => void steer()} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "var(--xr-accent)", color: "white", cursor: "pointer", opacity: busy !== null || !steerText.trim() || !view?.affordances.steer ? 0.5 : 1 }}>{busy === "steer" ? "…" : "Steer run"}</button>
                {view && !view.affordances.steer && <span style={{ fontSize: 10, color: "var(--xr-text-3)", fontFamily: "var(--xr-font-mono)" }}>run is {view.status} — steer unavailable</span>}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(selTask?.outputs?.artifacts ?? []).slice(0, 8).map((a, i) => (<span key={`${a.path}-${i}`} title={a.path} style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 10 }}>{a.description ?? a.path}</span>))}
                {selNode && selNode.reviewState !== "not_required" && <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 10 }}>review: {selNode.reviewState}</span>}
                {(selTask?.outputs?.artifacts ?? []).length === 0 && <span style={{ fontSize: 10, color: "var(--xr-text-3)" }}>… no artifacts yet</span>}
              </div>
            </aside>
          </div>
        </>
      )}

      {!view && (
        <section style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 20, display: "grid", gap: 12 }}>
          <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--xr-text-2)" }}>No team run selected — start one</div>
          <p style={{ fontSize: 12, color: "var(--xr-text-2)" }}>Start a team run: engine plans task graph (supervisor → workers → reviewer → synthesis), funds every worker from ledger partition, streams live status here. Dry-run plans graph without executing.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input placeholder="Goal — e.g. ship the billing retry fix with tests" value={goal} onChange={(e) => setGoal(e.target.value)} style={{ flex: 1, minWidth: 260, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 12 }} />
            <input placeholder="budget cap USD (optional)" value={budget} onChange={(e) => setBudget(e.target.value)} style={{ width: 180, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }} />
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> plan only (dry run)</label>
            <button disabled={busy !== null || !goal.trim()} onClick={() => void start()} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--xr-accent)", color: "white", cursor: "pointer", opacity: busy !== null || !goal.trim() ? 0.5 : 1 }}>{busy === "start" ? "planning…" : "Start team run"}</button>
          </div>
          {notice && <div style={{ padding: "8px 12px", borderRadius: 6, background: "color-mix(in srgb, var(--xr-danger) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--xr-danger) 30%, transparent)", fontFamily: "var(--xr-font-mono)", fontSize: 12 }}>{notice}</div>}
        </section>
      )}
    </div>
  );
}
