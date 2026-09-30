/**
 * XR Logo — Ahmad's ORIGINAL crest, auto-vectorized from
 * `uploads/xr logo (1).png` (dark diamond shield · silver+cyan sentinel
 * face · energy sweeping to the tip · monogram + tagline).
 *
 * Variants:
 *  - `icon`  (default 28px tall): the emblem crop (crest without tagline) —
 *    sidebar rail, cmdk.
 *  - `full`  (default 22px): emblem + "XR" Orbitron wordmark — expanded
 *    sidebar.
 *  - `large` (default 140px): the complete art including the tagline line,
 *    with a subtle energy breathe — splash/hero.
 *
 * Geometry lives in ./art.ts (generated); fills are CSS vars from
 * themes.css. No hand-drawn shapes, no images.
 */
import { motion, useReducedMotion } from 'framer-motion';

import {
  LOGO_HALO,
  LOGO_LAYERS,
  LOGO_VIEWBOX,
  type ArtLayer,
  type ArtPath,
} from '@/components/brand/art';
import { brandGlow } from '@/components/brand/defs';
import { cn } from '@/lib/utils';

/** Renders one traced art layer (a flat fill color) as a `<g>` of paths. */
export function ArtLayerPaths({ layer }: { layer: ArtLayer }) {
  return (
    <g fill={`var(${layer.var})`}>
      {layer.paths.map((p: ArtPath, i: number) => (
        <path key={i} d={p.d} transform={`translate(${p.t[0]},${p.t[1]})`} />
      ))}
    </g>
  );
}

function vbSize(vb: string): { w: number; h: number } {
  const [, , w, h] = vb.split(' ').map(Number);
  return { w, h };
}

export function Logo({
  variant,
  size,
  className,
  decorative = true,
}: {
  variant: 'icon' | 'full' | 'large';
  /** Height in px (width follows the art's aspect ratio). */
  size?: number;
  className?: string;
  /** Standalone display (dev gallery) passes false for a real role="img". */
  decorative?: boolean;
}) {
  const reduced = useReducedMotion();

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

  const isLarge = variant === 'large';
  const vb = isLarge ? LOGO_VIEWBOX.full : LOGO_VIEWBOX.emblem;
  const h = size ?? (isLarge ? 140 : 28);
  const { w } = vbSize(vb);
  const width = Math.round((h * w) / vbSize(vb).h);

  // Energy layers breathe on the large variant (Apple-calm, 4s).
  const energyVars = new Set(
    LOGO_LAYERS.filter((l) => l.cls === 'cy' || l.cls === 'hi').map((l) => l.var),
  );

  return (
    <svg
      width={width}
      height={h}
      viewBox={vb}
      fill="none"
      className={cn('shrink-0', className)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'XR'}
      aria-hidden={decorative || undefined}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Soft edge halo bands (traced from the original's alpha falloff). */}
      {LOGO_HALO.map((hl) => (
        <g
          key={`halo-${hl.var}-${hl.opacity}`}
          fill={`var(${hl.var})`}
          opacity={hl.opacity}
        >
          {hl.paths.map((p, j) => (
            <path key={j} d={p.d} transform={`translate(${p.t[0]},${p.t[1]})`} />
          ))}
        </g>
      ))}
      {LOGO_LAYERS.map((layer) =>
        isLarge && energyVars.has(layer.var) ? (
          <motion.g
            key={layer.var}
            fill={`var(${layer.var})`}
            style={brandGlow}
            initial={{ opacity: 0.9 }}
            animate={
              reduced ? { opacity: 0.9 } : { opacity: [0.82, 1, 0.82] }
            }
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            {layer.paths.map((p, j) => (
              <path key={j} d={p.d} transform={`translate(${p.t[0]},${p.t[1]})`} />
            ))}
          </motion.g>
        ) : (
          <ArtLayerPaths key={layer.var} layer={layer} />
        ),
      )}
    </svg>
  );
}

Logo.displayName = 'Logo';
