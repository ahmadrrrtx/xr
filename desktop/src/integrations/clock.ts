/*
 * A clock, for countdowns (Phase 26).
 *
 * The expiry countdowns in the Discord and WhatsApp dialogs need to tick every
 * second, and the lint rules this repo enforces forbid writing state directly in
 * an effect body — a clock is exactly the case where an interval *callback* is
 * the right place, so the rule stays satisfiable without a suppression.
 *
 * `useNow` returns the current wall-clock time, refreshed on an interval. It
 * starts from a lazy initializer (no render-time drift) and stops on unmount.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Whole seconds until `deadline`, never negative. `null` when there is no deadline. */
export function secondsUntil(deadline: number | null | undefined, now: number): number | null {
  if (deadline === null || deadline === undefined) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
