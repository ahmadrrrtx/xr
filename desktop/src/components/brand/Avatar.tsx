/**
 * Avatar — Ahmad's v2 sentinel renders (Phase 31 · Bucket F), replacing
 * the old hand-traced SVG figure. Static surfaces render the delivered
 * front/side masters (size-converted WebPs); animation lives in
 * `AnimatedAvatar` (state GIFs) and `VoiceOrb` (Orb v2 pack) so the
 * ~1MB loops never load into small chips, bubbles, or rails.
 *
 * Variants (unchanged API):
 *  - `bust` (default md/lg/xl): the complete front figure.
 *  - `head` (default xs/sm): square crop of the helmet + eyes.
 *  - `side` / `side2`: the two profile renders (working / acting).
 *  - `orb`: delegates to VoiceOrb.
 */
import { motion, useReducedMotion } from 'framer-motion';

import {
  XR_AVATAR_128,
  XR_AVATAR_256,
  XR_AVATAR_512,
  XR_AVATAR_SIDE,
  XR_AVATAR_SIDE_2,
  avatarGif,
} from '@/components/brand/assets';
import { VoiceOrb } from '@/components/brand/VoiceOrb';
import type { AvatarSize, AvatarState, AvatarVariant } from '@/components/brand/types';
import { cn } from '@/lib/utils';

/** Pixel HEIGHTS (width follows each artwork's aspect ratio). */
const SIZE_PX: Record<AvatarSize, number> = {
  xs: 16,
  sm: 24,
  md: 40,
  lg: 80,
  xl: 200,
};

const TINY: ReadonlySet<AvatarSize> = new Set(['xs', 'sm']);

/* Front master aspect (2224×1948) and side aspects from the 4x exports. */
const FRONT_ASPECT = 2224 / 1948;
const SIDE_ASPECT = 1180 / 1084;
const SIDE2_ASPECT = 2224 / 1830;

function bustSrc(size: AvatarSize): string {
  if (size === 'xl') return XR_AVATAR_512;
  if (size === 'lg' || size === 'md') return XR_AVATAR_256;
  return XR_AVATAR_128;
}

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

export function Avatar({
  size = 'md',
  state = 'idle',
  variant,
  showRingsOnSpeak = true,
  className,
}: {
  size?: AvatarSize;
  state?: AvatarState;
  /** Defaults per size: xs/sm → head, md/lg/xl → bust. */
  variant?: AvatarVariant;
  className?: string;
  /** Voice rings while speaking (default true). */
  showRingsOnSpeak?: boolean;
}) {
  const resolvedVariant: AvatarVariant = variant ?? (TINY.has(size) ? 'head' : 'bust');

  if (resolvedVariant === 'orb') {
    return <VoiceOrb size={SIZE_PX[size]} state={state} className={className} decorative />;
  }

  const h = SIZE_PX[size];
  const dimmed = state === 'sleeping';
  const imgStyle = dimmed ? { opacity: 0.55, filter: 'saturate(0.6)' } : undefined;

  if (resolvedVariant === 'head') {
    return (
      <span
        className={cn('relative inline-block shrink-0 overflow-hidden', className)}
        style={{ width: h, height: h }}
        data-avatar-state={state}
      >
        <img
          src={bustSrc(size)}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="block h-full w-full select-none object-cover"
          style={{ objectPosition: '50% 16%', ...imgStyle }}
        />
      </span>
    );
  }

  const isSide = resolvedVariant === 'side' || resolvedVariant === 'side2';
  const src = isSide ? (resolvedVariant === 'side' ? XR_AVATAR_SIDE : XR_AVATAR_SIDE_2) : bustSrc(size);
  const aspect = resolvedVariant === 'side' ? SIDE_ASPECT : resolvedVariant === 'side2' ? SIDE2_ASPECT : FRONT_ASPECT;
  const width = Math.round(h * aspect);

  return (
    <span
      className={cn('relative inline-block shrink-0', className)}
      style={{ width, height: h }}
      data-avatar-state={state}
    >
      <img
        src={src}
        width={width}
        height={h}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="block select-none"
        style={{ width, height: h, ...imgStyle }}
      />
      {showRingsOnSpeak && state === 'speaking' && !isSide && <SpeakingRings height={h} />}
    </span>
  );
}

/** Voice rings while speaking — 3 pulses emanating from the chest core. */
function SpeakingRings({ height }: { height: number }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  const d = Math.round(height * 0.34);
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{ width: d, height: d, left: '50%', top: '68%', translate: '-50% -50%' }}
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="border-brand-bright absolute inset-0 rounded-full border"
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: [1, 3.1], opacity: [0.75, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }}
        />
      ))}
    </span>
  );
}

/**
 * AnimatedAvatar (Phase 31 · Bucket F F5) — the 9 delivered helmet
 * sentinel GIF loops (480px, 48 frames). For LARGE surfaces only:
 * Onboarding/Ready hero, About hero, Chat's empty pane, Voice Theater
 * Sentinel mode. Never use in rails, chips, or bubbles (~1MB each).
 * Reduced-motion renders the still front render instead.
 */
export function AnimatedAvatar({
  state = 'idle',
  size = 280,
  className,
  decorative = false,
}: {
  state?: AvatarState;
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  const reduced = useReducedMotion();
  const src = reduced ? XR_AVATAR_512 : avatarGif(state);
  return (
    <img
      src={src}
      width={size}
      height={size}
      draggable={false}
      alt={decorative ? '' : `XR sentinel — ${STATE_LABEL[state]}`}
      aria-hidden={decorative || undefined}
      data-avatar-state={state}
      className={cn('block shrink-0 select-none', className)}
      style={{ width: size, height: size }}
    />
  );
}

Avatar.displayName = 'Avatar';
AnimatedAvatar.displayName = 'AnimatedAvatar';
