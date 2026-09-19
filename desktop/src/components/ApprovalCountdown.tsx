import { useEffect, useState } from "react";
import { formatRemaining, remainingMs, urgencyOf, type Deadline } from "../countdown";

/**
 * "auto-denies in 4:32" — the engine's TTL default-deny, counted down.
 *
 * Text updates once a second are a fact changing, not an animation (no
 * transition on the digits); only the urgency colour is allowed to ease.
 * `role="timer"` with `aria-live="off"` keeps screen readers from reading a
 * new number every second; the surrounding card announces the request once.
 */
export function ApprovalCountdown({ deadline, compact = false }: { deadline: Deadline; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const ms = remainingMs(deadline, now);
  const urgency = urgencyOf(ms);
  if (ms === null || urgency === null) {
    return <span className="appr-ttl mono faint" data-urgency="none">no deadline reported</span>;
  }
  const label = urgency === "expired" ? "expired — denied by policy" : `${compact ? "" : "auto-denies in "}${formatRemaining(ms)}`;
  return (
    <span className="appr-ttl mono" role="timer" aria-live="off" data-urgency={urgency} title="The engine denies an unanswered request when its TTL ends">
      {label}
    </span>
  );
}
