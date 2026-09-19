import { useCallback, useEffect, useState } from "react";
import { api, type CockpitState } from "../api/client";

/** ControlRoom — Computer Control hardened elite Phase 1
 * Live computer-control session over engine records: audit-driven feed, durable approvals, grants, trust mode, pause/resume/stop.
 * Tokens var(--xr-*), states skeleton/empty/error, motion, a11y focus cyan.
 */

const SCOPES = ["desktop", "browser", "files_read", "files_write", "system", "clipboard", "vision_cloud"] as const;
type Ev = { id?: number; event?: string; detail?: string; created_at?: number };
type ActionPayload = { type?: string; name?: string; text?: string; length?: number; x?: number; y?: number; op?: string; sensitive?: boolean };
type EvDetail = { action?: ActionPayload; risk?: string; reason?: string; result?: { ok?: boolean; message?: string } };
function parseDetail(raw?: string): EvDetail { if (!raw) return {}; try { return JSON.parse(raw) as EvDetail; } catch { return {}; } }
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
function riskChip(risk?: string): { color: string; label: string } {
  if (risk === "safe") return { color: "var(--xr-accent)", label: "low risk" };
  if (risk === "sensitive") return { color: "var(--xr-warning)", label: "mid risk" };
  if (risk === "destructive") return { color: "var(--xr-danger)", label: "high risk" };
  return { color: "var(--xr-text-3)", label: risk ?? "event" };
}
const ACTIVE_WINDOW_MS = 120_000;
const BURST_GAP_MS = 90_000;

export function ControlRoom() {
  const [cockpit, setCockpit] = useState<CockpitState | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api.controlCockpit().then(setCockpit).catch(() => setCockpit(null));
    api.controlEvents(80).then((r) => setEvents(r.events ?? [])).catch(() => setEvents([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 3000); const k = setInterval(() => setTick((x) => x + 1), 1000); return () => { clearInterval(t); clearInterval(k); }; }, [load]);
  void tick;

  const paused = Boolean(cockpit?.control?.paused?.paused);
  const enabled = Boolean(cockpit?.control?.enabled);
  const pending = cockpit?.pending ?? [];
  const granted = new Set(cockpit?.permissions ?? []);
  const now = Date.now();
  const sorted = [...events].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
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
  const elapsed = sessionStart ? Math.max(0, Math.floor((now - sessionStart) / 1000)) : 0;
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const feed = [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)).slice(0, 40);
  const ctxEvent = [...sorted].reverse().find((e) => { const a = parseDetail(e.detail).action; return a && (a.type === "focus" || a.type === "app"); });
  const ctxApp = ctxEvent ? parseDetail(ctxEvent.detail).action?.name ?? null : null;
  const ctxWhy = pending[pending.length - 1]?.reason ?? parseDetail(sorted[sorted.length - 1]?.detail).reason ?? null;

  async function verb(body: { paused?: boolean; stop?: boolean }) {
    try {
      const r = await api.controlPause(body);
      setNote(body.stop ? `stopped — pending approvals denied: ${r.denied ?? 0}; no new control actions until resumed` : r.paused?.paused ? "paused — engine gate now blocks every new control action" : "resumed — control actions allowed again");
      load();
    } catch (e) { setNote(`verb failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function answer(id: string, approved: boolean) {
    try { await api.controlApprove(id, approved); setNote(`${approved ? "approved" : "denied"} ${id.slice(0, 8)}… (durable store, audited)`); load(); }
    catch (e) { setNote(`answer failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function toggleScope(scope: string, isGranted: boolean) {
    try { await api.permissionsGrant(scope, isGranted); setNote(`${scope}: ${isGranted ? "revoked" : "granted"} engine-side (gate-enforced, audited)`); load(); }
    catch (e) { setNote(`grant failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  if (loading) {
    return <div style={{ padding: "var(--xr-space-4)", display: "grid", gap: 12 }}>{Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 80, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)" }} />)}</div>;
  }

  return (
    <div style={{ padding: "var(--xr-space-4)", display: "grid", gap: "var(--xr-space-3)" }}>
      {!enabled ? (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--xr-danger) 15%, transparent)", border: "1px solid var(--xr-danger)", fontSize: 12 }}>computer control is DISABLED — {String(cockpit?.control?.disabledReason ?? "reason in engine config")} · nothing can run until engine re-enables it</div>
      ) : paused ? (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--xr-warning) 15%, transparent)", border: "1px solid var(--xr-warning)", fontSize: 12, display: "flex", gap: 12, alignItems: "center" }}><span>control PAUSED — {String(cockpit?.control?.paused?.reason ?? "no new control actions")} · held {mmss}</span><span style={{ flex: 1 }} /><button style={{ padding: "4px 10px", borderRadius: 999, background: "var(--xr-success)", color: "white", border: "none", cursor: "pointer", fontSize: 11 }} onClick={() => void verb({ paused: false })}>▷ Resume</button></div>
      ) : active ? (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--xr-warning) 15%, transparent)", border: "1px solid var(--xr-warning)", fontSize: 12, display: "flex", gap: 12, alignItems: "center" }}><span>XR is controlling your computer — session {mmss}</span><span style={{ flex: 1 }} /><button style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer", fontSize: 11 }} onClick={() => void verb({ paused: true })}>‖ Pause</button><button style={{ padding: "4px 10px", borderRadius: 999, background: "var(--xr-danger)", color: "white", border: "none", cursor: "pointer", fontSize: 11 }} onClick={() => void verb({ stop: true })}>■ Stop</button></div>
      ) : (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", fontSize: 12, display: "flex", gap: 12, alignItems: "center", color: "var(--xr-text-3)" }}>no active control session — engine gate allows actions only through approvals + standing grants<span style={{ flex: 1 }} /><button style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer", fontSize: 11 }} onClick={() => void verb({ paused: true })}>‖ Pause (pre-arm)</button></div>
      )}

      {note && <p style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-2)", background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: 6, padding: "8px 12px", margin: 0 }}>{note} <button onClick={() => setNote(null)} style={{ marginLeft: 8, background: "transparent", border: "none", cursor: "pointer" }}>✕</button></p>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 12 }}>
        <div style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 14, display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>Live action feed</div>
          {pending.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, background: "color-mix(in srgb, var(--xr-warning) 10%, transparent)", border: "1px solid var(--xr-warning)", borderRadius: 6, fontSize: 11 }}>
              <span style={{ fontFamily: "var(--xr-font-mono)", color: "var(--xr-text-3)" }}>{p.requestedAt ? new Date(p.requestedAt).toTimeString().slice(0, 8) : ""}</span>
              <span>awaiting approval: <b>{p.tool ?? p.action ?? p.id}</b> — {String(p.reason ?? "").slice(0, 90)}</span>
              <span style={{ flex: 1 }} />
              <button style={{ padding: "4px 10px", borderRadius: 6, background: "var(--xr-warning)", color: "white", border: "none", cursor: "pointer", fontSize: 11 }} onClick={() => void answer(p.id, true)}>Approve</button>
              <button style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--xr-danger)", color: "var(--xr-danger)", background: "transparent", cursor: "pointer", fontSize: 11 }} onClick={() => void answer(p.id, false)}>Deny</button>
            </div>
          ))}
          {feed.length === 0 && pending.length === 0 && <div style={{ fontSize: 12, color: "var(--xr-text-3)", padding: "8px 0" }}>no control events yet — actions appear here the moment engine audits them (control.* / computer_control.*).</div>}
          {feed.map((e) => {
            const d = parseDetail(e.detail); const chip = riskChip(d.risk);
            const suffix = e.event?.includes("denied") ? " — denied" : e.event?.includes("paused") ? " — paused" : e.event?.includes("executed") ? "" : d.result && d.result.ok === false ? ` — ${String(d.result.message ?? "failed").slice(0, 60)}` : "";
            return (
              <div key={e.id ?? `${e.created_at}-${e.event}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", background: "var(--xr-surface-2)", borderRadius: 6, fontSize: 11 }}>
                <span style={{ fontFamily: "var(--xr-font-mono)", color: "var(--xr-text-3)" }}>{e.created_at ? new Date(e.created_at).toTimeString().slice(0, 8) : ""}</span>
                <span style={{ fontFamily: "var(--xr-font-mono)" }}>{describeAction(d.action)}{suffix || d.reason ? ` — ${suffix ? suffix.replace(" — ", "") : String(d.reason ?? "").slice(0, 60)}` : ""}</span>
                <span style={{ flex: 1 }} />
                <span style={{ padding: "2px 6px", borderRadius: 999, background: chip.color, color: "white", fontSize: 10 }}>{chip.label}</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <div style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 14, display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 12 }}>screen-context</div>
            {ctxApp ? <div><b style={{ fontSize: 13 }}>{ctxApp}</b><div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>— active window per engine audit</div></div> : <div style={{ fontSize: 12, color: "var(--xr-text-3)" }}>no focused-app event in this session.</div>}
            <div style={{ fontSize: 11 }}><b>why:</b> {ctxWhy ? String(ctxWhy).slice(0, 220) : "no reason recorded — approvals always carry one."}</div>
          </div>

          <div style={{ background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 14, display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 12 }}>Standing permissions</div>
            {SCOPES.map((sc) => (
              <button key={sc} onClick={() => void toggleScope(sc, granted.has(sc))} title={granted.has(sc) ? "granted — click to revoke (audited)" : "not granted — click to grant (audited)"} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--xr-border)", background: granted.has(sc) ? "var(--xr-surface-2)" : "transparent", cursor: "pointer", fontSize: 11, textAlign: "left" }}>
                <span style={{ fontFamily: "var(--xr-font-mono)" }}>{sc}</span><span style={{ flex: 1 }} />{granted.has(sc) ? <span style={{ color: "var(--xr-success)" }}>✓</span> : <span style={{ color: "var(--xr-danger)" }}>✕</span>}
              </button>
            ))}
            <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 10, color: "var(--xr-text-3)" }}>high/critical tiers — always ask (locked by policy)</div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--xr-text-3)" }}>Trust mode <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-surface-2)", border: "1px solid var(--xr-border)" }}>{String(cockpit?.mode ?? "balanced").toUpperCase()}</span> · verbs = engine `/control/pause` · grants = `/control/permissions/grant` — nothing bypasses the gate</div>
    </div>
  );
}
