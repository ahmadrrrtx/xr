/*
 * Splash / boot screen (Phase 3 · docs/SCREEN-BRIEFS.md OV-7).
 *
 * Always XR-Native (cinematic exception — wrapped in data-theme so CSS vars
 * resolve to the xr-native palette regardless of the user's theme). Real
 * progress phases are driven by App's boot sequence; min show 800ms, hard
 * cap 5s (App enforces both). Reduced-motion: static logo + dots.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';

import { Logo } from '@/components/brand/Logo';

export type SplashStatus =
  | 'Starting XR...'
  | 'Loading settings...'
  | 'Preparing memory...'
  | 'Ready.';

/** Deterministic pseudo-random particles so SSR/tests are stable. */
function particleField(count: number) {
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: rand() * 100,
    top: rand() * 100,
    size: 1 + rand() * 1.4,
    delay: rand() * 6,
    duration: 14 + rand() * 10,
    cyan: rand() > 0.45,
  }));
}

export function Splash({
  progress,
  status,
}: {
  progress: number; // 0..100
  status: SplashStatus;
}) {
  const reduced = useReducedMotion();
  const particles = useMemo(() => particleField(28), []);

  return (
    <motion.div
      data-theme="xr-native"
      className="bg-bg-void fixed inset-0 z-[100] overflow-hidden"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4, ease: 'easeOut' } }}
      role="status"
      aria-label={`XR is starting — ${status}`}
    >
      {/* Space dust */}
      <div aria-hidden="true" className="absolute inset-0">
        {particles.map((p) => (
          <motion.span
            key={p.id}
            className="absolute rounded-full"
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: p.size,
              height: p.size,
              backgroundColor: p.cyan ? 'var(--accent)' : 'var(--metal-bright)',
            }}
            initial={{ opacity: 0.1 }}
            animate={
              reduced
                ? { opacity: 0.25 }
                : { opacity: [0.08, 0.5, 0.08], y: [0, -6, 0] }
            }
            transition={
              reduced
                ? undefined
                : {
                    duration: p.duration,
                    delay: p.delay,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }
            }
          />
        ))}
      </div>

      {/* Center column, slightly above middle */}
      <div className="absolute left-1/2 top-[38%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <Logo variant="large" size={130} decorative={false} />

        <span
          className="text-text-primary font-display mt-6 text-5xl font-bold tracking-[0.08em]"
          style={{ lineHeight: 1 }}
        >
          XR
        </span>

        {/* Progress bar — real phases, 280px */}
        <div
          className="border-border-subtle mt-10 h-[4px] w-[280px] overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <motion.div
            className="bg-accent h-full rounded-full"
            style={{ boxShadow: '0 0 8px var(--accent-glow)' }}
            initial={{ width: '0%' }}
            animate={{ width: `${Math.min(100, progress)}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>

        <p className="text-text-tertiary mt-4 text-[13px] font-medium">{status}</p>
      </div>
    </motion.div>
  );
}
