/**
 * XR — typing pulse for chat surfaces (Phase 26 shared layer).
 *
 * Platforms show "typing…" for only a few seconds per trigger, so a long task
 * re-sends it on an interval. The caller owns the stop function and must call
 * it when the task settles, including on failure.
 */
export function startTypingPulse(pulse: () => unknown, intervalMs: number): () => void {
  const timer = setInterval(() => void pulse(), intervalMs);
  return () => clearInterval(timer);
}
