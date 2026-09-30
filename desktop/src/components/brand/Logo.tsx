/*
 * XR logo — temporary Phase 1 inline SVG (docs/phases/01-app-shell.plan.md §5.1).
 *
 * `icon`: minimal X — two silver strokes (metal sweep) + cyan core dot.
 * `full`: icon + "XR" wordmark in Orbitron (font-display), accent cyan.
 * The detailed atomic-ring SVG lands in Phase 2 (docs/IMPLEMENTATION-PLAN.md).
 * Colors come from theme tokens; the metal sweep gradient is defined inline
 * from those tokens so it adapts per theme (no hardcoded hex here).
 */
import { cn } from '@/lib/utils';

export function LogoX({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="xr-logo-sweep" x1="4" y1="4" x2="24" y2="24">
          <stop offset="0%" stopColor="var(--metal-bright)" />
          <stop offset="55%" stopColor="var(--metal)" />
          <stop offset="100%" stopColor="var(--metal-bright)" />
        </linearGradient>
      </defs>
      {/* X — two diagonal strokes with rounded caps */}
      <line
        x1="6.5"
        y1="6.5"
        x2="21.5"
        y2="21.5"
        stroke="url(#xr-logo-sweep)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <line
        x1="21.5"
        y1="6.5"
        x2="6.5"
        y2="21.5"
        stroke="url(#xr-logo-sweep)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* cyan core at the intersection */}
      <circle cx="14" cy="14" r="2.6" fill="var(--accent)" />
    </svg>
  );
}

export function Logo({
  variant,
  className,
}: {
  variant: 'icon' | 'full';
  className?: string;
}) {
  if (variant === 'icon') {
    return <LogoX size={28} />;
  }

  return (
    <span className={cn('flex items-center gap-2', className)}>
      <LogoX size={24} />
      <span className="font-display text-accent text-xl font-bold tracking-[0.04em]">
        XR
      </span>
    </span>
  );
}
