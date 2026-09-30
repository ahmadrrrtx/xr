/**
 * Avatar — Ahmad's ORIGINAL sentinel, auto-vectorized from
 * `uploads/XR AVATAR .png` (dark helmet · glowing cyan eyes · energy crest
 * and plume · flowing energy shoulders tapering to a point).
 *
 * Variants:
 *  - `bust` (default md/lg/xl): the complete front figure.
 *  - `head` (default xs/sm): square crop of the helmet + eyes + crest.
 *  - `side` / `side2`: the two profile references, traced the same way.
 *  - `orb`: delegates to CompanionOrb.
 *
 * States animate the ENERGY layers (cyan + highlights) — the art itself is
 * never redrawn: idle breathe, listening pulse, speaking voice-rings,
 * thinking orbit dots, sleeping dim, waiting-approval amber pip, error
 * 2s red flash then settle. Reduced-motion renders static frames.
 * (docs/phases/02-brand-components.plan.md)
 */
import { motion, useReducedMotion } from 'framer-motion';

import {
  AVATAR_LAYERS,
  AVATAR_VIEWBOX,
  AVATAR_HALO,
  SIDE1_LAYERS,
  SIDE2_LAYERS,
  SIDE_VIEWBOX,
  SIDE1_HALO,
  SIDE2_HALO,
  type ArtHalo,
  type ArtLayer,
  type ArtPath,
} from '@/components/brand/art';
import { CompanionOrb } from '@/components/brand/CompanionOrb';
import { brandGlow } from '@/components/brand/defs';
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

interface ArtSource {
  layers: ArtLayer[];
  vb: string;
  /** Soft-edge bands (traced from the original's alpha falloff). */
  halos: ArtHalo[];
}

const ART: Record<Exclude<AvatarVariant, 'orb'>, ArtSource> = {
  bust: { layers: AVATAR_LAYERS, vb: AVATAR_VIEWBOX.full, halos: AVATAR_HALO },
  head: { layers: AVATAR_LAYERS, vb: AVATAR_VIEWBOX.head, halos: AVATAR_HALO },
  side: { layers: SIDE1_LAYERS, vb: SIDE_VIEWBOX.side1, halos: SIDE1_HALO },
  side2: { layers: SIDE2_LAYERS, vb: SIDE_VIEWBOX.side2, halos: SIDE2_HALO },
};

function vbParts(vb: string) {
  const [x, y, w, h] = vb.split(' ').map(Number);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

function Paths({ paths }: { paths: ArtPath[] }) {
  return (
    <>
      {paths.map((p, i) => (
        <path key={i} d={p.d} transform={`translate(${p.t[0]},${p.t[1]})`} />
      ))}
    </>
  );
}

/** Voice rings while speaking — 3 pulses, scale 1→3.2, opacity .8→0. */
function SpeakingRings({
  cx,
  cy,
  r,
  count,
  reduced,
}: {
  cx: number;
  cy: number;
  r: number;
  count: number;
  reduced: boolean | null;
}) {
  if (reduced) return null;
  return (
    <g>
      {Array.from({ length: count }, (_, i) => (
        <motion.circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--brand-bright)"
          strokeWidth={r / 6}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: [1, 3.2], opacity: [0.8, 0] }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            delay: i * 0.5,
            ease: 'easeOut',
          }}
        />
      ))}
    </g>
  );
}

/** Thinking: two small dots orbiting the figure (1.2s). */
function OrbitDots({
  cx,
  cy,
  r,
  reduced,
}: {
  cx: number;
  cy: number;
  r: number;
  reduced: boolean | null;
}) {
  if (reduced) {
    return (
      <g fill="var(--brand-bright)">
        <circle cx={cx} cy={cy - r} r={r / 16} />
        <circle cx={cx + r} cy={cy} r={r / 20} />
      </g>
    );
  }
  return (
    <motion.g
      style={{ transformOrigin: `${cx}px ${cy}px` }}
      animate={{ rotate: 360 }}
      transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
    >
      <circle cx={cx} cy={cy - r} r={r / 16} fill="var(--brand-bright)" style={brandGlow} />
      <circle cx={cx + r} cy={cy} r={r / 20} fill="var(--brand-mid)" />
    </motion.g>
  );
}

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
  const resolvedVariant: AvatarVariant =
    variant ?? (TINY.has(size) ? 'head' : 'bust');

  if (resolvedVariant === 'orb') {
    return <CompanionOrb size={SIZE_PX[size]} state={state} className={className} />;
  }

  return (
    <AvatarBody
      size={size}
      state={state}
      variant={resolvedVariant}
      showRingsOnSpeak={showRingsOnSpeak}
      className={className}
    />
  );
}

function AvatarBody({
  size,
  state,
  variant,
  showRingsOnSpeak,
  className,
}: {
  size: AvatarSize;
  state: AvatarState;
  variant: Exclude<AvatarVariant, 'orb'>;
  showRingsOnSpeak: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const art = ART[variant];
  const vb = vbParts(art.vb);

  const h = SIZE_PX[size];
  const w = Math.round((h * vb.w) / vb.h);
  const tiny = TINY.has(size);
  const dim = state === 'sleeping';
  const isError = state === 'error';

  const energy = art.layers.filter((l) => l.cls === 'cy' || l.cls === 'hi');
  const body = art.layers.filter((l) => l.cls === 'ink' || l.cls === 'steel');

  // Energy-layer opacity per state (reduced motion → static mid frame).
  const energyOpacity = reduced
    ? 0.9
    : isError
      ? 0.55
      : state === 'speaking'
        ? [1, 0.65, 1]
        : state === 'listening'
          ? [1, 0.75, 1]
          : state === 'thinking'
            ? 0.9
            : state === 'waiting-approval'
              ? 0.95
              : dim
                ? [0.3, 0.45, 0.3]
                : [0.85, 1, 0.85];
  const energyTransition = reduced
    ? undefined
    : isError || state === 'thinking' || state === 'waiting-approval'
      ? { duration: 0.3 }
      : {
          duration:
            state === 'speaking' ? 1.2 : state === 'listening' ? 1.5 : dim ? 6 : 3.5,
          repeat: Infinity,
          ease: 'easeInOut' as const,
        };

  const ringR = variant === 'head' ? 32 : 60;
  const orbitR = variant === 'head' ? 70 : 150;

  return (
    <svg
      width={w}
      height={h}
      viewBox={art.vb}
      fill="none"
      className={cn('shrink-0', className)}
      role="img"
      aria-label={`XR ${state}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Voice rings behind the figure while speaking. */}
      {state === 'speaking' && showRingsOnSpeak && (
        <SpeakingRings
          cx={vb.cx}
          cy={vb.cy}
          r={ringR}
          count={tiny ? 1 : 3}
          reduced={reduced}
        />
      )}

      {/* Error: 2s red flash over the whole frame, settling to a faint tint. */}
      {isError && (
        <motion.rect
          x={vb.x}
          y={vb.y}
          width={vb.w}
          height={vb.h}
          fill="var(--danger)"
          initial={false}
          animate={
            reduced
              ? { opacity: 0.05 }
              : { opacity: [0.2, 0.04, 0.2, 0.04, 0.2, 0.05] }
          }
          transition={{ duration: 2, ease: 'easeInOut' }}
        />
      )}

      <motion.g
        style={{ transformOrigin: `${vb.cx}px ${vb.cy}px` }}
        animate={
          reduced || !isError
            ? { x: 0 }
            : { x: [0, -4, 4, -4, 4, 0] }
        }
        transition={{ duration: 1, repeat: 1 }}
      >
        {/* Whole-figure dimming (sleeping). */}
        <motion.g animate={{ opacity: dim ? 0.6 : 1 }} transition={{ duration: 0.6 }}>
          {/* Soft outer-edge halo bands (traced alpha falloff). */}
          {art.halos.map((hl) => (
            <g
              key={`${hl.var}-${hl.opacity}`}
              fill={`var(${hl.var})`}
              opacity={hl.opacity * (dim ? 0.4 : 1)}
            >
              <Paths paths={hl.paths} />
            </g>
          ))}

          {/* Dark body layers — constant. */}
          {body.map((layer) => (
            <g key={layer.var} fill={`var(${layer.var})`}>
              <Paths paths={layer.paths} />
            </g>
          ))}

          {/* Energy layers — glow + state animation. */}
          <motion.g style={brandGlow} animate={{ opacity: energyOpacity }} transition={energyTransition}>
            {energy.map((layer) => (
              <g key={layer.var} fill={`var(${layer.var})`}>
                <Paths paths={layer.paths} />
              </g>
            ))}
          </motion.g>

          {/* Error: red copy of the energy layers — flickers 2s, then fades
              out to reveal the settled dim energy underneath. */}
          {isError && !reduced && (
            <motion.g
              fill="var(--danger)"
              initial={false}
              animate={{ opacity: [1, 0.3, 1, 0.3, 1, 0] }}
              transition={{ duration: 2, ease: 'easeInOut' }}
            >
              {energy.map((layer) => (
                <Paths key={layer.var} paths={layer.paths} />
              ))}
            </motion.g>
          )}
        </motion.g>
      </motion.g>

      {/* Thinking: orbiting dots. */}
      {state === 'thinking' && (
        <OrbitDots cx={vb.cx} cy={vb.cy} r={orbitR} reduced={reduced} />
      )}

      {/* Waiting approval: amber pip above the figure. */}
      {state === 'waiting-approval' && (
        <motion.g
          style={{ transformOrigin: `${vb.cx}px ${vb.y + 8}px` }}
          animate={
            reduced ? undefined : { scale: [1, 1.25, 1], opacity: [1, 0.7, 1] }
          }
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <circle cx={vb.cx} cy={vb.y + 10} r={variant === 'head' ? 9 : 14} fill="var(--warning)" />
        </motion.g>
      )}
    </svg>
  );
}

Avatar.displayName = 'Avatar';
