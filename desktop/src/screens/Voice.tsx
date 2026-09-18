import { useEffect, useRef } from "react";
import { useVoice, type VoiceState } from "../voice/session";
import avatarUrl from "../assets/xr-avatar.png";

const PILLS: VoiceState[] = ["idle", "listening", "thinking", "working", "speaking"];

const STATE_TITLE: Record<VoiceState, string> = {
  idle: "Voice is off",
  listening: "Listening…",
  thinking: "Thinking…",
  working: "Working…",
  speaking: "Speaking…",
  interrupted: "Interrupted — listening again",
};

const STATE_HINT: Record<VoiceState, string> = {
  idle: "press Space or tap the mic to start · everything runs offline on this machine",
  listening: "press Space to stop · just speak to interrupt",
  thinking: "your words are being transcribed on-device",
  working: "the engine is acting on your command",
  speaking: "just speak to barge in · say confirm or cancel for approvals",
  interrupted: "press Space to stop · just speak to interrupt",
};

/** Mirrored bar waveform, drawn from live mic or TTS analyser levels. */
function Waveform({ active, source }: { active: boolean; source: "mic" | "out" }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const voice = useVoice();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const bars = 64;
    const hist = new Array<number>(bars).fill(0);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const level = source === "mic" ? voice.micLevel.current : voice.outLevel.current;
      hist.push(active ? Math.min(1, level * (source === "mic" ? 2.2 : 1.6)) : 0);
      if (hist.length > bars) hist.shift();
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        const v = hist[i] ?? 0;
        const bh = Math.max(2, v * (h / 2 - 2));
        const x = i * bw;
        ctx.fillStyle = `rgba(94, 225, 240, ${0.35 + v * 0.65})`;
        ctx.fillRect(x + 1, h / 2 - bh, bw - 2, bh);
        ctx.fillRect(x + 1, h / 2, bw - 2, bh);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, source, voice]);
  return <canvas ref={ref} width={560} height={90} className="vc-wave" aria-hidden="true" />;
}

export function Voice({ onDock }: { onDock: () => void }) {
  const voice = useVoice();
  const { state } = voice;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      if (voice.state === "idle") void voice.start();
      else voice.stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voice]);

  const speaking = state === "speaking";

  return (
    <div className="vc-root" role="region" aria-label="Voice mode">
      <button className="vc-dock-btn" onClick={onDock} title="Dock the avatar — voice keeps running while you work" aria-label="Dock voice avatar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      <div className={`vc-ring ${state}`} >
        <div className="vc-ring-inner">
          <img src={avatarUrl} alt="XR avatar" className="vc-avatar" />
        </div>
      </div>

      <Waveform active={state === "listening" || speaking} source={speaking ? "out" : "mic"} />

      <div className="vc-title">{STATE_TITLE[state]}</div>
      <div className="vc-hint">{voice.error ? `⚠ ${voice.error}` : STATE_HINT[state]}</div>

      {voice.transcript && state !== "idle" && (
        <div className="vc-transcript mono" aria-live="polite">“{voice.transcript}”</div>
      )}
      {voice.approval && (
        <div className="vc-approval" role="alert">
          approval pending: <b>{voice.approval.tool ?? voice.approval.id}</b> — say <b>confirm</b> or <b>cancel</b>
        </div>
      )}

      <div className="vc-pills" role="tablist" aria-label="Voice states">
        {PILLS.map((p) => (
          <span key={p} className={`vc-pill ${state === p ? "on" : ""}`}>{p}</span>
        ))}
      </div>

      <div className="vc-bar">
        <button
          className="vc-mic"
          onClick={() => (state === "idle" ? void voice.start() : voice.stop())}
          aria-label={state === "idle" ? "Start voice session" : "Stop voice session"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </button>
        <button className={`vc-mute ${voice.muted ? "on" : ""}`} onClick={voice.toggleMute} aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            {voice.muted && <path d="M4 4l16 16" stroke="#ff5d74" />}
          </svg>
        </button>
      </div>
    </div>
  );
}
