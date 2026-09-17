import { useEffect, useMemo, useState } from "react";
import { api, asList, type Approval, type SessionSummary } from "../api/client";
import { XrLogo } from "../components/Brand";

export function Home({ onOpenRun, onGoWork }: { onOpenRun: (id: string) => void; onGoWork: (task: string) => void }) {
  const [task, setTask] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [s, a, h] = await Promise.allSettled([api.sessions(), api.approvals(), api.health()]);
      if (!live) return;
      if (s.status === "fulfilled") setSessions(asList<SessionSummary>(s.value, "sessions").slice(0, 6));
      if (a.status === "fulfilled") setApprovals(asList<Approval>(a.value, "approvals", "pending").filter((x) => x.status === "pending" || x.status === undefined).slice(0, 5));
      if (h.status === "fulfilled") setHealth(h.value as Record<string, unknown>);
    };
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const recent = useMemo(() => sessions, [sessions]);

  return (
    <div className="home">
      <div className="hero">
        <XrLogo height={132} radius={10} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          const t = task.trim();
          if (t) onGoWork(t);
        }}
      >
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="What do you want XR to do?"
          aria-label="Task composer"
        />
        <div className="row">
          <span className="pill" title="Attach files (Phase 2)">⌗ Attach</span>
          <span className="pill" title="Autonomy mode (Phase 4)">◈ Balanced</span>
          <span className="pill mono" title="Model (Model Center, Phase 2)">⚙ model</span>
          <button className="send" type="submit" aria-label="Send task">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 20v-6l8-2-8-2V4l19 8z" /></svg>
          </button>
        </div>
      </form>

      {approvals.length > 0 && (
        <>
          <div className="section-h"><h2>Needs your decision</h2></div>
          <div className="badge-amber" role="status">
            <span className="dot amber" /> {approvals.length} pending approval{approvals.length > 1 ? "s" : ""} — open Trust Center
          </div>
        </>
      )}

      <div className="section-h"><h2>Continue work</h2><span className="faint mono" style={{ fontSize: 12 }}>{recent.length} recent</span></div>
      {recent.length === 0 ? (
        <div className="empty">Your first task will live here. Ask XR anything above.</div>
      ) : (
        <div className="cards">
          {recent.map((s) => (
            <button key={s.id} className="card" style={{ textAlign: "left" }} onClick={() => onOpenRun(s.id)}>
              <div className="t">{s.title || s.prompt?.slice(0, 60) || s.id}</div>
              <div className="meta">
                <span className={`dot ${s.status === "failed" ? "red" : s.status === "running" ? "cyan" : "green"}`} />
                <span>{s.status ?? "done"}</span>
                <span className="faint">·</span>
                <span className="mono faint">{s.mode ?? "agent"}</span>
                {typeof s.costUsd === "number" && <span className="mono faint" style={{ marginLeft: "auto" }}>${s.costUsd.toFixed(4)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="readiness" role="status" aria-label="System readiness">
        <span className="item"><span className={`dot ${health ? "green" : "red"}`} /> engine {health ? "online" : "offline"}</span>
        <span className="item mono faint">v{String((health?.version as { version?: string } | undefined)?.version ?? "—")}</span>
        <span className="item faint">providers: local-first</span>
        <span className="item faint">voice: idle</span>
        <span className="item faint" style={{ marginLeft: "auto" }}>⌘K palette · Phase 2</span>
      </div>
    </div>
  );
}
