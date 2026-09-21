import { useMemo, useState } from "react";
import { Icon } from "../components/icons";
import { StatusDot } from "../components/StatusDot";

type RunStatus = "running" | "done" | "failed" | "paused" | "waiting";
type Run = {
  id: string;
  title: string;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  cost?: number;
  kind: "code" | "research" | "multi-agent" | "chat";
  model: string;
  error?: { title: string; fix: string; action?: string };
  steps?: { total: number; done: number; current?: string };
};

const sampleRuns: Run[] = [
  { id: "r1", title: "Fix the build errors in diff.ts", status: "running", startedAt: Date.now() - 1000*42, kind: "code", model: "Claude Sonnet 4.6", steps: { total: 7, done: 3, current: "Writing patch for HunkReview" } },
  { id: "r2", title: "Research Q3 competitor landscape for AI IDEs", status: "done", startedAt: Date.now() - 1000*60*23, finishedAt: Date.now() - 1000*60*20, durationMs: 1000*60*3, cost: 0.08, kind: "research", model: "Claude Sonnet 4.6" },
  { id: "r3", title: "Refactor AppShell to support full-width screens", status: "done", startedAt: Date.now() - 1000*60*60*2, finishedAt: Date.now() - 1000*60*58, durationMs: 1000*60*2, cost: 0.03, kind: "code", model: "Claude Sonnet 4.6" },
  { id: "r4", title: "Run end-to-end tests and fix failures", status: "failed", startedAt: Date.now() - 1000*60*80, kind: "code", model: "GPT-5", error: { title: "Test runner crashed", fix: "Ollama isn't running — start it to resume local inference.", action: "Start Ollama" } },
  { id: "r5", title: "Multi-agent: design v2 runs history screen", status: "done", startedAt: Date.now() - 1000*60*60*5, finishedAt: Date.now() - 1000*60*60*4, durationMs: 1000*60*55, cost: 0.14, kind: "multi-agent", model: "Multi-model" },
  { id: "r6", title: "Implement ApprovalCountdown component", status: "done", startedAt: Date.now() - 1000*60*60*8, finishedAt: Date.now() - 1000*60*60*8 + 1000*45, durationMs: 1000*45, cost: 0.01, kind: "code", model: "Claude Sonnet 4.6" },
  { id: "r7", title: "Draft release notes for v2.1 phase 1", status: "paused", startedAt: Date.now() - 1000*60*60*12, kind: "chat", model: "Claude Opus 4.6", error: { title: "Awaiting approval", fix: "XR is waiting for your decision on a shell command.", action: "Review" } },
  { id: "r8", title: "Find recent papers on RLHF tool use", status: "waiting", startedAt: Date.now() - 1000*12, kind: "research", model: "Claude Sonnet 4.6", steps: { total: 4, done: 0, current: "Queued" } },
];

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms/1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s/60); const rs = s%60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m/60), rm = m%60;
  return `${h}h ${rm}m`;
}
function fmtAgo(ts: number) {
  const ms = Date.now() - ts;
  if (ms < 60_000) return `${Math.round(ms/1000)}s ago`;
  if (ms < 3600_000) return `${Math.round(ms/60000)}m ago`;
  if (ms < 86400_000) return `${Math.round(ms/3600000)}h ago`;
  return `${Math.round(ms/86400000)}d ago`;
}
function costStr(c?: number) { return c == null ? "—" : `$${c.toFixed(2)}`; }

export function Runs() {
  const [filter, setFilter] = useState<"all"|RunStatus|"failed">("all");
  const [kind, setKind] = useState<"all"|Run["kind"]>("all");
  const [sel, setSel] = useState<string | null>(sampleRuns[0].id);

  const rows = useMemo(() => sampleRuns.filter(r =>
    (filter === "all" || r.status === filter) &&
    (kind === "all" || r.kind === kind)
  ), [filter, kind]);

  const selected = rows.find(r => r.id === sel) ?? rows[0];

  return (
    <div className="xr-page">
      <div className="xr-page-head">
        <div>
          <h1>Runs</h1>
          <p className="xr-subtitle">Every task XR has started for you — what it did, what it cost, and whether it worked.</p>
        </div>
        <div className="xr-page-head-actions">
          <button className="xr-btn xr-btn--ghost xr-btn--sm">Export CSV</button>
        </div>
      </div>

      <div className="xr-toolbar">
        <button className="xr-filter-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
        <button className="xr-filter-chip" aria-pressed={filter === "running"} onClick={() => setFilter("running")}>● Running</button>
        <button className="xr-filter-chip" aria-pressed={filter === "done"} onClick={() => setFilter("done")}>✓ Done</button>
        <button className="xr-filter-chip" aria-pressed={filter === "failed"} onClick={() => setFilter("failed")}>✕ Failed</button>
        <button className="xr-filter-chip" aria-pressed={filter === "waiting"} onClick={() => setFilter("waiting")}>… Waiting</button>
        <div style={{ width: 1, height: 20, background: "var(--xr-border)", margin: "0 6px" }}/>
        <button className="xr-filter-chip" aria-pressed={kind === "all"} onClick={() => setKind("all")}>Any kind</button>
        <button className="xr-filter-chip" aria-pressed={kind === "code"} onClick={() => setKind("code")}>Code</button>
        <button className="xr-filter-chip" aria-pressed={kind === "research"} onClick={() => setKind("research")}>Research</button>
        <button className="xr-filter-chip" aria-pressed={kind === "multi-agent"} onClick={() => setKind("multi-agent")}>Multi-agent</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", height: "calc(100% - 120px)" }}>
        <div style={{ overflowY: "auto" }}>
          <table className="xr-table">
            <thead><tr><th style={{ width: 16 }}/><th>Task</th><th style={{ width: 90 }}>Kind</th><th style={{ width: 80 }}>Duration</th><th style={{ width: 70 }}>Cost</th><th style={{ width: 100 }}>When</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={sel === r.id ? "selected" : ""} onClick={() => setSel(r.id)}>
                  <td><StatusDot kind={r.status === "done" ? "ok" : r.status === "failed" ? "err" : r.status === "running" ? "info" : "warn"} pulse={r.status === "running"}/></td>
                  <td>
                    <div className="xr-run-title">{r.title}</div>
                    <div className="xr-run-meta">{r.model}{r.error ? ` · ${r.error.title}` : ""}</div>
                  </td>
                  <td><span className={"xr-pill xr-pill--" + (r.kind === "code" ? "low" : r.kind === "research" ? "medium" : "")} style={{ textTransform: "capitalize" }}>{r.kind.replace("-", " ")}</span></td>
                  <td className="mono">{r.status === "running" || r.status === "waiting" ? (r.steps ? `${r.steps.done}/${r.steps.total} steps` : "…") : fmtDuration(r.durationMs ?? 0)}</td>
                  <td className="mono">{costStr(r.cost)}</td>
                  <td className="mono faint">{fmtAgo(r.startedAt)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6}>
                  <div className="xr-empty">
                    <Icon.History width={48} height={48} className="ic"/>
                    <h3>No runs match those filters</h3>
                    <p>Try clearing filters to see all runs.</p>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ borderLeft: "1px solid var(--xr-border)", padding: 20, overflowY: "auto", background: "var(--xr-bg-2)" }}>
          {selected && <RunDetail run={selected}/>}
        </div>
      </div>
    </div>
  );
}

function RunDetail({ run }: { run: Run }) {
  const pct = run.steps ? Math.round((run.steps.done / run.steps.total) * 100) : (run.status === "done" ? 100 : run.status === "failed" ? 50 : 0);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
        <StatusDot kind={run.status === "done" ? "ok" : run.status === "failed" ? "err" : run.status === "running" ? "info" : "warn"} size={12} pulse={run.status === "running"}/>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>{run.title}</div>
          <div className="xr-dim" style={{ fontSize: 11.5, marginTop: 4 }}>
            {run.model} · started {fmtAgo(run.startedAt)}{run.durationMs ? ` · took ${fmtDuration(run.durationMs)}` : ""}
          </div>
        </div>
      </div>

      {run.steps && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--xr-text-dim)", marginBottom: 6 }}>
            <span>{run.steps.current}</span>
            <span className="mono">{run.steps.done}/{run.steps.total} steps · {pct}%</span>
          </div>
          <div style={{ height: 4, background: "var(--xr-surface-2)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: pct + "%", background: run.status === "failed" ? "var(--xr-error)" : "var(--xr-primary)", transition: "width 300ms" }}/>
          </div>
        </div>
      )}

      {run.error && (
        <div className="xr-alert xr-alert--error" style={{ marginBottom: 16 }}>
          <Icon.AlertTriangle width={18} height={18}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{run.error.title}</div>
            <div style={{ fontSize: 12, color: "var(--xr-text-dim)", marginTop: 2 }}>{run.error.fix}</div>
          </div>
          {run.error.action && <button className="xr-btn xr-btn--sm xr-btn--primary"><Icon.Wrench width={12} height={12}/> {run.error.action}</button>}
        </div>
      )}

      <div className="xr-timeline">
        <TimelineItem t="-1m" icon="ok" label="Read project structure" detail="Scanned 42 files"/>
        <TimelineItem t="-45s" icon="ok" label="Analyzed build errors" detail="Found 3 TS errors in diff.ts"/>
        {run.status !== "failed" && <TimelineItem t="-20s" icon="run" label="Writing patch" detail={run.steps?.current ?? "Editing files"} current={run.status === "running"}/>}
        {run.status === "running" && <TimelineItem t="" icon="wait" label="Running tests" detail="Pending"/>}
        {run.status === "done" && <TimelineItem t="now" icon="ok" label="Completed" detail="Build passes, 0 errors"/>}
        {run.status === "failed" && <TimelineItem t="-10s" icon="err" label={run.error?.title ?? "Failed"} detail={run.error?.fix}/>}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {run.status === "running" && <>
          <button className="xr-btn xr-btn--sm xr-btn--secondary">Pause</button>
          <button className="xr-btn xr-btn--sm">Stop</button>
        </>}
        {(run.status === "failed" || run.status === "paused") && <button className="xr-btn xr-btn--sm xr-btn--primary"><Icon.Play width={12} height={12}/> Resume</button>}
        {run.status === "done" && <button className="xr-btn xr-btn--sm xr-btn--primary"><Icon.RotateCw width={12} height={12}/> Re-run</button>}
        <button className="xr-btn xr-btn--sm xr-btn--ghost">View transcript</button>
      </div>
    </div>
  );
}

function TimelineItem({ t, icon, label, detail, current }: { t: string; icon: "ok"|"run"|"wait"|"err"; label: string; detail?: string; current?: boolean }) {
  const kind = icon === "ok" ? "ok" : icon === "err" ? "err" : icon === "run" ? "info" : "warn";
  return (
    <div className={"xr-timeline-item" + (current ? " current" : "")}>
      <div className="xr-timeline-line"/>
      <div className="xr-timeline-dot"><StatusDot kind={kind as any} pulse={current} size={10}/></div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: current ? 600 : 500 }}>{label}</div>
        {detail && <div className="xr-dim" style={{ fontSize: 11.5 }}>{detail}</div>}
      </div>
      {t && <div className="mono faint" style={{ fontSize: 11 }}>{t}</div>}
    </div>
  );
}
