import { useEffect, useState } from "react";
import { useVoice } from "./session";
import { AVATAR_SRC, poseForVoiceState } from "../components/Brand";

/**
 * Docked voice avatar: when the user navigates away from the Voice page the
 * session KEEPS RUNNING (listening, acting, speaking) and the avatar shrinks
 * to a corner orb — click the body to return full-screen; the small mic icon
 * in the corner toggles mute without opening the panel.
 */
export function DockedVoice({ onExpand }: { onExpand: () => void }) {
  const voice = useVoice();
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLevel(voice.state === "speaking" ? voice.outLevel.current : voice.micLevel.current), 120);
    return () => clearInterval(t);
  }, [voice]);
  return (
    <div className={`vd-orb ${voice.state} ${voice.muted ? "muted" : ""}`}>
      <button
        className="vd-orb-main"
        onClick={onExpand}
        title={`Voice ${voice.state} — click to open`}
        aria-label={`Voice ${voice.state} — click to open`}
      >
        <span className="vd-glow" style={{ opacity: 0.35 + Math.min(1, level * 2) * 0.65 }} aria-hidden="true" />
        <img src={AVATAR_SRC[poseForVoiceState(voice.state)]} alt="" className="vd-avatar" data-pose={poseForVoiceState(voice.state)} />
      </button>
      <button
        className={`vd-mic ${voice.muted ? "on" : ""}`}
        onClick={(e) => { e.stopPropagation(); voice.toggleMute(); }}
        title={voice.muted ? "Unmute" : "Mute (keeps session running)"}
        aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          {voice.muted && <path d="M4 4l16 16" stroke="currentColor" />}
        </svg>
      </button>
    </div>
  );
}
