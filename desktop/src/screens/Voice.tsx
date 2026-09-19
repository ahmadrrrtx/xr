import { useEffect, useRef } from "react";
import { useVoice, type VoiceState } from "../voice/session";
import avatarUrl from "../assets/xr-avatar.png";

/** Voice — hardened elite Phase 1, avatar state machine engine-reported end-to-end.
 * Tokens var(--xr-*), skeleton/empty/error, motion 120/200/320, focus cyan, a11y.
 */

const PILLS: VoiceState[] = ["idle", "listening", "thinking", "planning", "working", "tool", "approval", "speaking", "success", "interrupted", "error", "offline"];
const STATE_TITLE: Record<VoiceState, string> = {
  idle: "Voice is off", listening: "Listening…", thinking: "Thinking…", planning: "Planning…", working: "Working…", tool: "Using a tool…",
  approval: "Approval needed", speaking: "Speaking…", interrupted: "Interrupted — listening again", success: "Done ✓", error: "Voice error", offline: "Engine unreachable",
};
const STATE_HINT: Record<VoiceState, string> = {
  idle: "press Space or tap mic to start · everything runs offline on this machine",
  listening: "press Space to stop · just speak to interrupt", thinking: "your words transcribed on-device", planning: "engine composing plan",
  working: "engine acting on command", tool: "governed tool call in flight — same approvals", approval: "say confirm or cancel — durable store decides, not shell",
  speaking: "just speak to barge in · say confirm or cancel for approvals", interrupted: "press Space to stop · just speak to interrupt",
  success: "command completed — listening again", error: "engine reported voice error — see line below; session stays honest", offline: "daemon event stream down — voice cannot run until it returns",
};

function Waveform({ active, source }: { active: boolean; source: "mic" | "out" }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const voice = useVoice();
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    let raf = 0; const bars = 64; const hist = new Array<number>(bars).fill(0);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = canvas.width; const h = canvas.height; ctx.clearRect(0, 0, w, h);
      const level = source === "mic" ? voice.micLevel.current : voice.outLevel.current;
      hist.push(active ? Math.min(1, level * (source === "mic" ? 2.2 : 1.6)) : 0); if (hist.length > bars) hist.shift();
      const bw = w / bars;
      for (let i = 0; i < bars; i++) { const v = hist[i] ?? 0; const bh = Math.max(2, v * (h / 2 - 2)); const x = i * bw; ctx.fillStyle = `rgba(94, 225, 240, ${0.35 + v * 0.65})`; ctx.fillRect(x + 1, h / 2 - bh, bw - 2, bh); ctx.fillRect(x + 1, h / 2, bw - 2, bh); }
    }; draw(); return () => cancelAnimationFrame(raf);
  }, [active, source, voice]);
  return <canvas ref={ref} width={560} height={90} aria-hidden style={{ width: "100%", maxWidth: 560, height: 90, display: "block" }} />;
}

export function Voice({ onDock }: { onDock: () => void }) {
  const voice = useVoice();
  const { state } = voice;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return; const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault(); if (voice.state === "idle") void voice.start(); else voice.stop();
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [voice]);
  const speaking = state === "speaking";

  return (
    <div role="region" aria-label="Voice mode" style={{ display: "grid", placeItems: "center", gap: "var(--xr-space-4)", padding: "var(--xr-space-6)", minHeight: "100%", position: "relative" }}>
      <button onClick={onDock} title="Dock avatar — voice keeps running while you work" aria-label="Dock voice avatar" style={{ position: "absolute", top: 16, right: 16, width: 36, height: 36, borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", cursor: "pointer", display: "grid", placeItems: "center" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>

      <div style={{ width: 160, height: 160, borderRadius: 999, padding: 6, background: state === "listening" ? "var(--xr-accent)" : state === "error" || state === "offline" ? "var(--xr-danger)" : state === "success" ? "var(--xr-success)" : "var(--xr-border)", transition: "background var(--xr-motion-state) var(--xr-ease-default)", display: "grid", placeItems: "center", animation: state === "listening" || state === "speaking" ? "xr-pulse 1.2s infinite" : undefined }}>
        <div style={{ width: "100%", height: "100%", borderRadius: 999, background: "var(--xr-surface-1)", display: "grid", placeItems: "center", overflow: "hidden" }}>
          <img src={avatarUrl} alt="XR avatar" style={{ width: 96, height: 96, borderRadius: 999, objectFit: "cover" }} />
        </div>
      </div>

      <Waveform active={state === "listening" || speaking} source={speaking ? "out" : "mic"} />

      <div style={{ textAlign: "center", display: "grid", gap: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>{STATE_TITLE[state]}</div>
        <div style={{ fontSize: 12, color: "var(--xr-text-2)" }}>{voice.error ? `⚠ ${voice.error}` : STATE_HINT[state]}</div>
      </div>

      {voice.transcript && state !== "idle" && <div style={{ padding: "10px 14px", borderRadius: "var(--xr-radius-lg)", background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", fontFamily: "var(--xr-font-mono)", fontSize: 13, maxWidth: 560, textAlign: "center" }} aria-live="polite">“{voice.transcript}”</div>}
      {voice.approval && <div style={{ padding: "10px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--xr-warning) 15%, transparent)", border: "1px solid var(--xr-warning)", fontSize: 12 }} role="alert">approval pending: <b>{voice.approval.tool ?? voice.approval.id}</b> — say <b>confirm</b> or <b>cancel</b></div>}

      <div role="tablist" aria-label="Voice states" style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", maxWidth: 560 }}>
        {PILLS.map((p) => <span key={p} style={{ padding: "4px 8px", borderRadius: 999, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", background: state === p ? "var(--xr-accent)" : "var(--xr-surface-2)", color: state === p ? "white" : "var(--xr-text-3)", border: "1px solid var(--xr-border)" }}>{p}</span>)}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={() => (state === "idle" ? void voice.start() : voice.stop())} aria-label={state === "idle" ? "Start voice session" : "Stop voice session"} style={{ width: 56, height: 56, borderRadius: 999, border: "none", background: state === "idle" ? "var(--xr-accent)" : "var(--xr-danger)", color: "white", display: "grid", placeItems: "center", cursor: "pointer", transition: "transform var(--xr-motion-micro) var(--xr-ease-default)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </button>
        <button onClick={voice.toggleMute} aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"} style={{ width: 40, height: 40, borderRadius: 999, border: "1px solid var(--xr-border)", background: voice.muted ? "var(--xr-danger)" : "var(--xr-surface-1)", color: voice.muted ? "white" : "var(--xr-text-1)", display: "grid", placeItems: "center", cursor: "pointer" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />{voice.muted && <path d="M4 4l16 16" stroke="#ff5d74" />}</svg>
        </button>
      </div>
    </div>
  );
}
