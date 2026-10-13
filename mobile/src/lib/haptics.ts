/**
 * Haptics. Silent no-ops where unsupported (iOS Safari has no vibrate API —
 * there we simply do nothing rather than fake feedback).
 * Always suppressed under prefers-reduced-motion.
 */

export type HapticKind = 'light' | 'medium' | 'success' | 'warning' | 'error';

const PATTERNS: Record<HapticKind, number | number[]> = {
  light: 8,
  medium: 14,
  success: [10, 40, 18],
  warning: [18, 60, 18],
  error: [30, 50, 30],
};

function reducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function haptic(kind: HapticKind = 'light'): void {
  if (reducedMotion()) return;
  const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
  if (typeof nav.vibrate !== 'function') return;
  try {
    nav.vibrate(PATTERNS[kind]);
  } catch {
    /* Some browsers throw when the document isn't visible. Ignore. */
  }
}
