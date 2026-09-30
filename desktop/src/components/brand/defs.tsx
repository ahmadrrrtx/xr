/**
 * Shared SVG helpers for the brand components (Phase 2).
 *
 * The Logo and Avatar now render Ahmad's ORIGINAL art, auto-vectorized from
 * his uploads (see ./art.ts) — flat fills only, no gradients. The only
 * gradient remaining in the brand family is the CompanionOrb's glossy
 * sphere + glowing core, defined here with theme CSS variables.
 */
import { useId, type ReactNode } from 'react';

/* eslint-disable react-refresh/only-export-components -- leaf design module:
   the gradient defs component and its shared constants belong together. */

export function useBrandId(prefix: string): string {
  const raw = useId();
  return `${prefix}-${raw.replace(/[^a-zA-Z0-9-]/g, '')}`;
}

export interface BrandDefsIds {
  /** Glossy black sphere radial (top-left highlight) — orb only. */
  helmet: string;
  /** Glowing core radial (bright center → transparent edge) — orb only. */
  core: string;
}

/** Renders the orb's `<defs>`; place inside the same `<svg>`. */
export function BrandDefs({ ids }: { ids: BrandDefsIds }): ReactNode {
  return (
    <defs>
      {/* Glossy black dome: subtle metal sheen top-left → brand ink → deep. */}
      <radialGradient id={ids.helmet} cx="34%" cy="24%" r="85%">
        <stop
          offset="0%"
          style={{
            stopColor: 'color-mix(in oklab, var(--metal) 22%, var(--brand-ink))',
          }}
        />
        <stop offset="55%" style={{ stopColor: 'var(--brand-ink)' }} />
        <stop
          offset="100%"
          style={{
            stopColor: 'color-mix(in oklab, var(--brand-ink) 70%, black)',
          }}
        />
      </radialGradient>

      {/* Glowing core: white-hot center → brand cyan → transparent rim. */}
      <radialGradient id={ids.core} cx="50%" cy="50%" r="50%">
        <stop
          offset="0%"
          style={{
            stopColor: 'color-mix(in oklab, var(--brand-bright) 45%, white)',
          }}
        />
        <stop offset="55%" style={{ stopColor: 'var(--brand-bright)' }} />
        <stop
          offset="100%"
          style={{
            stopColor: 'color-mix(in oklab, var(--brand-bright) 55%, transparent)',
          }}
        />
      </radialGradient>
    </defs>
  );
}

/**
 * Theme-adaptive glow applied to energy layers / orb eyes. Strength comes
 * from `--avatar-glow-strength` (0 in Paper/Arctic → no visible glow).
 */
export const brandGlow = {
  filter: 'drop-shadow(0 0 var(--avatar-glow-strength) var(--accent-glow))',
} as const;
