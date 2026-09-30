/*
 * Streaming caret (Phase 4) — 2×18px cyan bar, 500ms opacity blink via a
 * CSS keyframe (Tailwind's animate-pulse is known to stall mid-stream).
 * prefers-reduced-motion → static, full opacity. Decorative (aria-hidden).
 */
export function StreamingCursor() {
  return (
    <span
      aria-hidden="true"
      className="bg-accent ml-0.5 inline-block h-[18px] w-[2px] align-[-3px]"
      style={{ animation: 'xr-caret-blink 500ms ease-in-out infinite' }}
    />
  );
}
