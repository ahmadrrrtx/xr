/*
 * Temporary Phase 1 avatar — the XR sentinel in miniature (brief §1.3/§5.3):
 * a black helmet circle, two almond cyan eye slits, a tiny cyan chest dot.
 * Deliberately simple (≤20 SVG lines); Phase 2 replaces it with the real
 * Avatar component (7 states, 5 sizes). Helmet ink is a brand constant
 * declared once in themes.css (`--brand-ink`); the eyes/core use the theme
 * accent so the sentinel adapts to every theme.
 */
import { cn } from '@/lib/utils';

export function MiniAvatar({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
    >
      {/* helmet */}
      <circle cx="14" cy="14" r="13" fill="var(--brand-ink)" />
      {/* almond eye slits — angled, no pupils */}
      <path
        d="M8.5 11.5c1.4-1.8 3.6-1.8 5 0"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M19.5 11.5c-1.4-1.8-3.6-1.8-5 0"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* chest core dot below the eyes */}
      <circle cx="14" cy="18.5" r="1.4" fill="var(--accent)" />
    </svg>
  );
}
