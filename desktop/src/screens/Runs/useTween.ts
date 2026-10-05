/*
 * Tween a number toward `target` over `ms` (ease-out). Reduced motion → the
 * target is returned as-is (no state churn). Returns the displayed value; the
 * caller formats it.
 */
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

export function useTween(target: number, ms = 300): number {
  const reduced = useReducedMotion();
  const snap = reduced || ms <= 0;
  const [value, setValue] = useState(target);
  const shownRef = useRef(target); // last value actually displayed

  useEffect(() => {
    if (snap) {
      shownRef.current = target;
      return;
    }
    const from = shownRef.current;
    if (from === target) return;
    let raf = 0;
    const start = performance.now();
    const step = (t: number): void => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const v = p < 1 ? from + (target - from) * e : target;
      shownRef.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, snap]);

  return snap ? target : value;
}
