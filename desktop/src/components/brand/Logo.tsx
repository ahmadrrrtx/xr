/**
 * XR Logo — Ahmad's final v2 lockup (Phase 31 · Bucket F): curved silver
 * blades + tilted orbital ring + cyan core over the "XR" wordmark and the
 * tagline "The AI Agent You Can Actually Trust", delivered as traced
 * masters and shipped as size-converted rasters (assets.ts).
 *
 * Variants (unchanged API):
 *  - `icon`  (default 28px tall): the emblem only — sidebar rail, cmdk.
 *  - `full`  (default 22px): emblem + "XR" wordmark — expanded sidebar.
 *  - `large` (default 140px): the complete lockup incl. tagline — splash.
 *
 * The old hand-traced crest (art.ts) is retired; nothing here redraws the
 * delivered geometry.
 */
import { motion, useReducedMotion } from 'framer-motion';

import { XR_EMBLEM_256, XR_LOGO } from '@/components/brand/assets';
import { brandGlow } from '@/components/brand/defs';
import { cn } from '@/lib/utils';

/* Lockup aspect from the 4x master (1896×1496). */
const LOCKUP_ASPECT = 1896 / 1496;

export function Logo({
  variant,
  size,
  className,
  decorative = true,
}: {
  variant: 'icon' | 'full' | 'large';
  /** Height in px (width follows the artwork's aspect ratio). */
  size?: number;
  className?: string;
  /** Standalone display (dev gallery) passes false for a real role="img". */
  decorative?: boolean;
}) {
  const reduced = useReducedMotion();

  if (variant === 'icon') {
    const h = size ?? 28;
    return (
      <img
        src={XR_EMBLEM_256}
        width={h}
        height={h}
        draggable={false}
        alt={decorative ? '' : 'XR'}
        aria-hidden={decorative || undefined}
        className={cn('shrink-0 select-none', className)}
        style={{ width: h, height: h }}
      />
    );
  }

  if (variant === 'full') {
    const h = size ?? 22;
    return (
      <span
        className={cn('flex items-center gap-2', className)}
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : 'XR'}
        aria-hidden={decorative || undefined}
      >
        <Logo variant="icon" size={h + 6} decorative />
        <span
          className="font-display text-accent font-bold tracking-[0.04em]"
          style={{ fontSize: `${h}px`, lineHeight: 1 }}
        >
          XR
        </span>
      </span>
    );
  }

  /* large — full lockup; the core breathes (Apple-calm, 4s). */
  const h = size ?? 140;
  const width = Math.round(h * LOCKUP_ASPECT);
  return (
    <motion.img
      src={XR_LOGO}
      width={width}
      height={h}
      draggable={false}
      alt={decorative ? '' : 'XR — The AI Agent You Can Actually Trust'}
      aria-hidden={decorative || undefined}
      className={cn('shrink-0 select-none', className)}
      style={{ width, height: h, ...brandGlow }}
      initial={{ opacity: 0.92 }}
      animate={reduced ? { opacity: 0.92 } : { opacity: [0.88, 1, 0.88] }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

Logo.displayName = 'Logo';

/** Emblem-only mark for favicon-sized UI slots (Phase 31 · Bucket F F1). */
export function XrEmblem({
  size = 16,
  className,
  decorative = true,
}: {
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      src={XR_EMBLEM_256}
      width={size}
      height={size}
      draggable={false}
      alt={decorative ? '' : 'XR'}
      aria-hidden={decorative || undefined}
      className={cn('shrink-0 select-none', className)}
      style={{ width: size, height: size }}
    />
  );
}

XrEmblem.displayName = 'XrEmblem';
