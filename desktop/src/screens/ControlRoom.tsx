import { useCallback, useEffect, useState } from "react";
import { api, type CockpitState } from "../api/client";

/* Phase 4 · Control Room — live computer-control session over the engine's
 * own records: audit-driven action feed, durable approvals (approve/deny),
 * standing grants, trust mode, and the engine-enforced pause/resume/stop
 * verbs. The shell renders + forwards; it never derives policy and never
 * bypasses the gate.
 */

const SCOPES = ["desktop", "browser", "files_read", "files_write", "system", "clipboard", "vision_cloud"] as const;

type Ev = { id?: number; event?: string; detail?: string; created_at?: number };
type ActionPayload = { type?: string; name?: string; text?: string; length?: number; x?: number; y?: number; op?: string; sensitive?: boolean };
type EvDetail = { action?: ActionPayload; risk?: string; reason?: string; result?: { ok?: boolean; message?: string } };

function parseDetail(raw?: string): EvDetail {
  if (!raw) return {};
  try { return JSON.parse(raw) as EvDetail; } catch { return {}; }
}

function describeAction(a?: ActionPayload): string {
  if (!a?.type) return "control event";
  switch (a.type) {
    case "focus": return `focus app: ${a.name ?? "?"}`;
    case "app": return `launch app: ${a.name ?? "?"}`;
    case "close": return `close app: ${a.name ?? "?"}`;
    case "click": return `click (${a.x ?? "?"}, ${a.y ?? "?"})`;
    case "type": return a.sensitive ? "type «redacted» (sensitive)" : `type ${a.text ? `${a.text.length}` : a.length ?? "?"} chars`;
    case "screenshot": return `screenshot ${a.name ?? a.op ?? ""}`;
    case "file": return `file ${a.op ?? ""} ${a.name ?? ""}`;
    case "system": return `system ${a.op ?? ""}`;
    default: return `${a.type} ${a.name ?? ""}`;
  }
}

function riskChip(risk?: string): { cls: string; label: string } {
  if (risk === "safe") return { cls: "cyan", label: "low risk" };
  if (risk === "sensitive") return { cls: "amber", label: "mid risk" };
  if (risk === "destructive") return { cls: "red", label: "high risk" };
  return { cls: "", label: risk ?? "event" };
}

const ACTIVE_WINDOW_MS = 120_000;
const BURST_GAP_MS = 90_000;

export function ControlRoom() {
  const [cockpit, setCockpit] = useState<CockpitState | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    api.controlCockpit().then(setCockpit).catch(() => setCockpit(null));
    api.controlEvents(80).then((r) => setEvents(r.events ?? [])).catch(() => setEvents([]));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    const k = setInterval(() => setTick((x) => x + 1), 1000);
    return () => { clearInterval(t); clearInterval(k); };
  }, [load]);
  void tick;

  const paused = Boolean(cockpit?.control?.paused?.paused);
  const enabled = Boolean(cockpit?.control?.enabled);
  const pending = cockpit?.pending ?? [];
  const granted = new Set(cockpit?.permissions ?? []);

  const now = Date.now();
  const sorted = [...events].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
  // session = contiguous burst ending in the newest event
  let sessionStart: number | null = null;
  if (sorted.length > 0) {
    sessionStart = sorted[sorted.length - 1]?.created_at ?? null;
    for (let i = sorted.length - 1; i > 0; i--) {
      const gap = (sorted[i]?.created_at ?? 0) - (sorted[i - 1]?.created_at ?? 0);
      if (gap > BURST_GAP_MS) break;
      sessionStart = sorted[i - 1]?.created_at ?? sessionStart;
    }
  }
  const newest = sorted.length > 0 ? (sorted[sorted.length - 1]?.created_at ?? 0) : 0;
  const active = enabled && !paused && (now - newest < ACTIVE_WINDOW_MS || pending.length > 0);
  /* Phase 4 · acting-indicator: an engine event inside the last 5 s means the
     agent is mid-action; derived from the audited event feed, never guessed. */
  const acting = enabled && !paused && sorted.length > 0 && now - newest < 5000;
  const elapsed = sessionStart ? Math.max(0, Math.floor((now - sessionStart) / 1000)) : 0;
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  const feed = [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)).slice(0, 40);

  // screen context: newest app-ish event or the newest pending approval
  const ctxEvent = [...sorted].reverse().find((e) => {
    const a = parseDetail(e.detail).action;
    return a && (a.type === "focus" || a.type === "app");
  });
  const ctxApp = ctxEvent ? parseDetail(ctxEvent.detail).action?.name ?? null : null;
  const ctxWhy = pending[pending.length - 1]?.reason ?? parseDetail(sorted[sorted.length - 1]?.detail).reason ?? null;

  async function verb(body: { paused?: boolean; stop?: boolean }) {
    try {
      const r = await api.controlPause(body);
      setNote(body.stop ? `stopped — pending approvals denied: ${r.denied ?? 0}; no new control actions until resumed` : r.paused?.paused ? "paused — the engine gate now blocks every new control action" : "resumed — control actions allowed again");
      load();
    } catch (e) {
      setNote(`verb failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function answer(id: string, approved: boolean) {
    try {
      await api.controlApprove(id, approved);
      setNote(`${approved ? "approved" : "denied"} ${id.slice(0, 8)}… (durable store, audited)`);
      load();
    } catch (e) {
      setNote(`answer failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function toggleScope(scope: string, isGranted: boolean) {
    try {
      await api.permissionsGrant(scope, isGranted);
      setNote(`${scope}: ${isGranted ? "revoked" : "granted"} engine-side (gate-enforced, audited)`);
      load();
    } catch (e) {
      setNote(`grant failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="xr-page" style={{ padding: 0 }}>
      <div style={{ padding: "24px 32px 14px", flexShrink: 0 }}>
        <div className="xr-page-head" style={{ padding: 0 }}>
          <div>
            <h1>Computer Control</h1>
            <p className="xr-subtitle">XR is acting on your machine — stop anytime. Every action is audited, gated, and visible.</p>
          </div>
        </div>
      </div>
      <div style={{ padding: "0 32px 16px", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {!enabled ? (
        <div className="cr-banner red">
          <span>computer control is DISABLED — {String(cockpit?.control?.disabledReason ?? "reason in engine config")} · nothing can run until the engine re-enables it</span>
          <span className="spacer" />
          <button className="chipbtn red" title="Stop is always available — denies pending approvals, blocks new control actions" onClick={() => void verb({ stop: true })}>■ Stop</button>
        </div>
      ) : paused ? (
        <div className="cr-banner amber">
          <span>control PAUSED — {String(cockpit?.control?.paused?.reason ?? "no new control actions")} · held {mmss}</span>
          <span className="spacer" />
          <button className="chipbtn green" onClick={() => void verb({ paused: false })}>▷ Resume</button>
        </div>
      ) : active ? (
        <div className="cr-banner amber">
          <span>
            XR is controlling your computer — session {mmss}
            {/* Phase 4 · acting-indicator: engine event recency, not a guess. */}
            {acting && <span className="cr-acting" role="status">● acting</span>}
          </span>
          <span className="spacer" />
          <button className="chipbtn" onClick={() => void verb({ paused: true })}>‖ Pause</button>
          <button className="chipbtn red" onClick={() => void verb({ stop: true })}>■ Stop</button>
        </div>
      ) : (
        <div className="cr-banner dim">
          no active control session — the engine gate allows actions only through approvals + standing grants
          <span className="spacer" />
          <button className="chipbtn" onClick={() => void verb({ paused: true })}>‖ Pause (pre-arm)</button>
          {/* Phase 4 · STOP is ALWAYS visible — it denies anything pending. */}
          <button className="chipbtn red" title="Stop is always available — denies pending approvals, blocks new control actions" onClick={() => void verb({ stop: true })}>■ Stop</button>
        </div>
      )}

      {note && <p className="ob-note mono">{note}</p>}

      <div className="cr-grid">
        <div className="card prov cr-feed">
          <div className="t">Live action feed</div>
          {pending.map((p) => (
            <div key={p.id} className="cr-row pending">
              <span className="mono faint">{p.requestedAt ? new Date(p.requestedAt).toTimeString().slice(0, 8) : ""}</span>
              <span className="cr-await">awaiting approval: <b>{p.tool ?? p.action ?? p.id}</b> — {String(p.reason ?? "").slice(0, 90)}</span>
              <span className="spacer" />
              <button className="chipbtn amber" onClick={() => void answer(p.id, true)}>Approve</button>
              <button className="chipbtn red" onClick={() => void answer(p.id, false)}>Deny</button>
            </div>
          ))}
          {feed.length === 0 && pending.length === 0 && (
            <div className="faint" style={{ fontSize: 12, padding: "8px 0" }}>
              no control events yet — actions appear here the moment the engine audits them (control.* / computer_control.*).
            </div>
          )}
          {feed.map((e) => {
            const d = parseDetail(e.detail);
            const chip = riskChip(d.risk);
            const suffix = e.event?.includes("denied") ? " — denied" : e.event?.includes("paused") ? " — paused" : e.event?.includes("executed") ? "" : d.result && d.result.ok === false ? ` — ${String(d.result.message ?? "failed").slice(0, 60)}` : "";
            return (
              <div key={e.id ?? `${e.created_at}-${e.event}`} className="cr-row">
                <span className="mono faint">{e.created_at ? new Date(e.created_at).toTimeString().slice(0, 8) : ""}</span>
                <span className="mono">{describeAction(d.action)}{suffix || d.reason ? ` — ${suffix ? suffix.replace(" — ", "") : String(d.reason ?? "").slice(0, 60)}` : ""}</span>
                <span className="spacer" />
                <span className={`chip tiny ${chip.cls}`}>{chip.label}</span>
              </div>
            );
          })}
        </div>

        <div className="card prov cr-ctx">
          <div className="t">screen-context</div>
          {ctxApp ? (
            <div className="cr-app">
              <b>{ctxApp}</b>
              <div className="faint">— active window per engine audit</div>
            </div>
          ) : (
            <div className="faint" style={{ fontSize: 12 }}>no focused-app event in this session.</div>
          )}
          <div className="cr-why">
            <b>why:</b> {ctxWhy ? String(ctxWhy).slice(0, 220) : "no reason recorded — approvals always carry one."}
          </div>
        </div>

        <div className="card prov cr-perms">
          <div className="t">Standing permissions</div>
          {SCOPES.map((sc) => (
            <button key={sc} className="cr-perm" onClick={() => void toggleScope(sc, granted.has(sc))}
              title={granted.has(sc) ? "granted — click to revoke (audited)" : "not granted — click to grant (audited)"}>
              <span className="mono">{sc}</span>
              <span className="spacer" />
              {granted.has(sc) ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--xr-green)" strokeWidth="2.4" aria-label="granted"><path d="M4 12.5l5 5L20 7" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--xr-red)" strokeWidth="2.4" aria-label="not granted"><path d="M6 6l12 12M18 6L6 18" /></svg>
              )}
            </button>
          ))}
          <div className="cr-locked mono faint">high/critical tiers — always ask (locked by policy)</div>
        </div>
      </div>

      <div className="cr-foot" style={{ marginTop: 14 }}>
        Trust mode <span className="chip">{String(cockpit?.mode ?? "balanced").toUpperCase()}</span>
        <span className="faint" style={{ fontSize: 11.5 }}>· verbs = engine `/control/pause` · grants = `/control/permissions/grant` — nothing bypasses the gate</span>
      </div>
      </div>
    </div>
  );
}
