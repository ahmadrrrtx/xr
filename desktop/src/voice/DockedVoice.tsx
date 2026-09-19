import { useEffect, useState } from "react";
import { useVoice } from "./session";
import { AVATAR_SRC, poseForVoiceState } from "../components/Brand";

/**
 * Docked voice avatar: when the user navigates away from the Voice page the
 * session KEEPS RUNNING (listening, acting, speaking) and the avatar shrinks
 * to a corner orb — click to return full-screen.
 */
export function DockedVoice({ onExpand }: { onExpand: () => void }) {
  const voice = useVoice();
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLevel(voice.state === "speaking" ? voice.outLevel.current : voice.micLevel.current), 120);
    return () => clearInterval(t);
  }, [voice]);
  return (
    <button
      className={`vd-orb ${voice.state}`}
      onClick={onExpand}
      title={`Voice ${voice.state} — click to open`}
      aria-label={`Voice ${voice.state} — click to open`}
    >
      <span className="vd-glow" style={{ opacity: 0.35 + Math.min(1, level * 2) * 0.65 }} aria-hidden="true" />
      <img src={AVATAR_SRC[poseForVoiceState(voice.state)]} alt="" className="vd-avatar" data-pose={poseForVoiceState(voice.state)} />
      {voice.muted && <span className="vd-mute" aria-hidden="true" />}
    </button>
  );
}
