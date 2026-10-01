/**
 * CompanionOrb — the desktop-widget orb variant of the XR sentinel
 * (docs/SCREEN-BRIEFS.md §OV-3, Phase 2).
 *
 * Glossy black sphere + almond cyan eyes + single core dot, a thin tilted
 * equatorial ring (12s rotation), soft halo, and voice wave rings while
 * listening/speaking. Theme-adaptive via CSS vars; reduced-motion renders a
 * static frame with the ring stopped. Drag/window behavior is Phase 6 —
 * this component is pure presentation.
 *
 * The error state is a finite 2s red-flash (shake + flicker via keyframes
 * that end on the settled frame) — no timers or setState, so it restarts
 * cleanly every time the state re-enters error.
 */
import { motion, useReducedMotion } from 'framer-motion';

import {
  BrandDefs,
  brandGlow,
  useBrandId,
  type BrandDefsIds,
} from '@/components/brand/defs';
import type { AvatarState } from '@/components/brand/types';
import { cn } from '@/lib/utils';

const SPRING = { type: 'spring', stiffness: 380, damping: 26 } as const;

const ORB_EYE_L = 'M30 45.5 Q38 39 46 44.5 Q38 49 30 45.5 Z';
const ORB_EYE_R = 'M54 44.5 Q62 39 70 45.5 Q62 49 54 44.5 Z';

/** Eyes: closed horizontal slits (sleeping) vs almond glows. */
function OrbEyes({ state }: { state: AvatarState }) {
  if (state === 'sleeping') {
    return (
      <g stroke="var(--brand-bright)" strokeWidth="1.6" opacity="0.4" strokeLinecap="round">
        <path d="M31 44 Q38 47 45 44" />
        <path d="M55 44 Q62 47 69 44" />
      </g>
    );
  }

  const narrowed = state === 'thinking' ? 0.7 : state === 'listening' ? 0.85 : 1;
  const wide = state === 'waiting-approval' ? 1.15 : 1;

  return (
    <motion.g
      style={{ transformOrigin: '50px 44px', ...brandGlow }}
      animate={{ scaleY: narrowed * wide }}
      transition={SPRING}
    >
      <path d={ORB_EYE_L} fill="var(--brand-bright)" transform="rotate(-6 38 45)" />
      <path d={ORB_EYE_R} fill="var(--brand-bright)" transform="rotate(6 62 45)" />
    </motion.g>
  );
}

/** Error: red eye overlay that flickers for 2s, then fades out (settled). */
function OrbErrorEyes({ reduced }: { reduced: boolean | null }) {
  return (
    <motion.g
      initial={false}
      animate={reduced ? { opacity: 0 } : { opacity: [1, 0.25, 1, 0.25, 1, 0] }}
      transition={{ duration: 2, ease: 'easeInOut' }}
    >
      <path d={ORB_EYE_L} fill="var(--danger)" transform="rotate(-6 38 45)" />
      <path d={ORB_EYE_R} fill="var(--danger)" transform="rotate(6 62 45)" />
    </motion.g>
  );
}

/** Concentric wave rings — outward while listening/speaking. */
function WaveRings({
  active,
  fast,
  reduced,
}: {
  active: boolean;
  fast: boolean;
  reduced: boolean | null;
}) {
  if (!active || reduced) return null;
  const duration = fast ? 1 : 1.4;
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx="50"
          cy="50"
          r="30"
          fill="none"
          stroke="var(--brand-bright)"
          strokeWidth="1.5"
          style={{ transformOrigin: '50px 50px' }}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: [0.6, 2.2], opacity: [0.7, 0] }}
          transition={{
            duration,
            repeat: Infinity,
            delay: (i * duration) / 3,
            ease: 'easeOut',
          }}
        />
      ))}
    </g>
  );
}

/** Thinking: two small dots orbiting the sphere. */
function OrbitDots({ reduced }: { reduced: boolean | null }) {
  if (reduced) {
    return (
      <g fill="var(--brand-bright)">
        <circle cx="50" cy="8" r="2" />
        <circle cx="92" cy="50" r="2" />
      </g>
    );
  }
  return (
    <motion.g
      style={{ transformOrigin: '50px 50px' }}
      animate={{ rotate: 360 }}
      transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
    >
      <circle cx="50" cy="8" r="2" fill="var(--brand-bright)" style={brandGlow} />
      <circle cx="92" cy="50" r="1.6" fill="var(--brand-mid)" />
    </motion.g>
  );
}

export function CompanionOrb({
  size = 80,
  state = 'idle',
  className,
}: {
  /** Orb diameter in px. */
  size?: number;
  state?: AvatarState;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const ids: BrandDefsIds = {
    helmet: useBrandId('orb-helmet'),
    core: useBrandId('orb-core'),
  };

  const isError = state === 'error';
  const dim = state === 'sleeping';
  const speaking = state === 'speaking';
  const listening = state === 'listening';

  const rootAnimate = reduced
    ? undefined
    : isError
      ? { x: [0, -1.5, 1.5, -1.5, 1.5, 0] }
      : dim
        ? { scale: [1, 0.97, 1] }
        : { scale: [1, 1.02, 1] };
  const rootTransition = reduced
    ? undefined
    : isError
      ? { duration: 1, repeat: 1 }
      : {
          duration: dim ? 6 : 3.5,
          repeat: Infinity,
          ease: 'easeInOut' as const,
        };

  const coreFill = isError ? 'var(--danger)' : `url(#${ids.core})`;
  const coreAnimate = reduced
    ? { opacity: isError ? 0.55 : 0.8 }
    : isError
      ? { opacity: [1, 0.25, 1, 0.25, 0.55] }
      : speaking
        ? { opacity: [1, 0.7, 1], scale: [1, 1.25, 1] }
        : listening
          ? { opacity: [1, 0.75, 1] }
          : dim
            ? { opacity: [0.2, 0.35, 0.2] }
            : { opacity: [0.65, 1, 0.65] };
  const coreTransition = reduced
    ? undefined
    : isError
      ? { duration: 2, ease: 'easeInOut' as const }
      : {
          duration: speaking ? 1.2 : listening ? 1.5 : dim ? 6 : 3.5,
          repeat: Infinity,
          ease: 'easeInOut' as const,
        };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={cn('shrink-0', className)}
      role="img"
      aria-label={`XR Companion — ${state}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <BrandDefs ids={ids} />

      <motion.g
        style={{ transformOrigin: '50px 50px' }}
        animate={rootAnimate}
        transition={rootTransition}
      >
        {/* Voice waves (behind the sphere). */}
        <WaveRings active={listening || speaking} fast={speaking} reduced={reduced} />

        {/* Tilted equatorial ring — slow 12s rotation (stopped while asleep). */}
        <motion.g
          style={{ transformOrigin: '50px 50px' }}
          animate={reduced || dim ? undefined : { rotate: 360 }}
          transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
        >
          <ellipse
            cx="50"
            cy="50"
            rx="46"
            ry="14"
            transform="rotate(-20 50 50)"
            stroke="var(--brand-bright)"
            strokeOpacity={dim ? 0.25 : 0.8}
            strokeWidth="2"
            style={dim ? undefined : brandGlow}
          />
        </motion.g>

        {/* Halo behind the sphere. */}
        <circle
          className="xr-orb-halo"
          cx="50"
          cy="50"
          r="45"
          fill="var(--brand-bright)"
          opacity={dim ? 0.03 : 0.07}
        />

        {/* Glossy black sphere. */}
        <circle cx="50" cy="50" r="40" fill={`url(#${ids.helmet})`} />
        {/* Specular sheen, top-left. */}
        <ellipse
          cx="36"
          cy="32"
          rx="11"
          ry="6.5"
          fill="var(--metal)"
          opacity="0.14"
          transform="rotate(-32 36 32)"
        />

        {/* Eyes. */}
        <motion.g animate={{ opacity: dim ? 0.55 : isError ? 0.45 : 1 }}>
          <OrbEyes state={state} />
        </motion.g>
        {isError && <OrbErrorEyes reduced={reduced} />}

        {/* Chest core dot — single smooth circle. */}
        <motion.circle
          cx="50"
          cy="62"
          r="4"
          fill={coreFill}
          style={{
            transformOrigin: '50px 62px',
            ...(isError ? {} : brandGlow),
          }}
          animate={coreAnimate}
          transition={coreTransition}
        />

        {/* Thinking orbit dots. */}
        {state === 'thinking' && <OrbitDots reduced={reduced} />}

        {/* Waiting approval: amber shield dot above the orb. */}
        {state === 'waiting-approval' && (
          <motion.g
            style={{ transformOrigin: '50px 10px' }}
            animate={reduced ? undefined : { scale: [1, 1.18, 1], opacity: [1, 0.75, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <path
              d="M50 4 L55 7 L55 12 Q55 16.5 50 18 Q45 16.5 45 12 L45 7 Z"
              fill="var(--warning)"
            />
            <path
              d="M47.6 11 L49.4 13 L52.6 9"
              stroke="var(--bg-void)"
              strokeWidth="1.4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.g>
        )}
      </motion.g>
    </svg>
  );
}

CompanionOrb.displayName = 'CompanionOrb';
