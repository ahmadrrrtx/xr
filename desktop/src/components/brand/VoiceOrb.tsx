/**
 * VoiceOrb (Phase 31 · Bucket F v2) — the Companion Orb v2 animation pack
 * (glass nebula sphere, dual electron rings, layered core) delivered as
 * pre-rendered 48-frame loops. Used directly as delivered — never redrawn.
 *
 * Runtime voice states map onto the 9 delivered states; `approved` and
 * `denied` are acknowledgements the caller shows briefly (~1.8s) before
 * returning to `idle` (the pack ships them as full loops so no timing is
 * baked in here).
 *
 * Honesty rules from the bucket:
 *  - Small surfaces (≤64px) render the poster still — animated WebP at
 *    favicon size is wasted bytes and motion noise.
 *  - `prefers-reduced-motion` always renders the poster still.
 *  - Idle themes (nebula/solar/emerald/crimson) only recolor the idle loop;
 *    every other state keeps the canonical cyan pack.
 */
import { useReducedMotion } from 'framer-motion';

import { orbPoster, orbSrc, type OrbTheme } from '@/components/brand/assets';
import type { AvatarState } from '@/components/brand/types';
import { cn } from '@/lib/utils';

export type { OrbTheme };
export type VoiceOrbState = AvatarState;

const STATE_LABEL: Record<AvatarState, string> = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  'waiting-approval': 'waiting for your approval',
  approved: 'approved',
  denied: 'denied',
  error: 'in an error state',
  sleeping: 'sleeping',
};

export function VoiceOrb({
  state = 'idle',
  size = 280,
  theme = 'default',
  className,
  decorative = false,
}: {
  state?: AvatarState;
  /** Rendered diameter in px. ≤64 renders the poster still. */
  size?: number;
  theme?: OrbTheme;
  className?: string;
  decorative?: boolean;
}) {
  const reduced = useReducedMotion();
  const still = reduced || size <= 64;
  const src = still ? orbPoster(state, theme) : orbSrc(state, theme);
  return (
    <img
      src={src}
      width={size}
      height={size}
      draggable={false}
      alt={decorative ? '' : `XR is ${STATE_LABEL[state]}`}
      aria-hidden={decorative || undefined}
      data-orb-state={state}
      data-orb-theme={theme}
      className={cn('block shrink-0 select-none', className)}
      style={{ width: size, height: size }}
    />
  );
}

VoiceOrb.displayName = 'VoiceOrb';
