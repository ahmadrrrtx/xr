/*
 * AvatarBust (Phase 16) — the Voice Theater's sentinel.
 *
 * The silhouette is the traced brand bust (art.ts: glossy black egg helmet,
 * dark cowl, rim-lit shoulders, plasma trails sweeping back from the
 * shoulders). On top of it the theater draws what it must control frame by
 * frame, at the coordinates measured from the art:
 *
 *   eyes       almond slits, NO pupils — brightness, narrowing, blink,
 *              look-shift, and the only red in the theater (error, 4 s)
 *   chest core ONE perfect circle with a radial glow (never segmented)
 *   rings      speaking rings emanate from the core, not the mouth
 *   mic ring   one inward ring while listening, driven by the mic level
 *   orbit dots two 2 px dots circling the helmet while thinking
 *   shield     warning-yellow badge while an approval is pending
 *   mute slash near the chest while the microphone is muted
 *
 * Levels never re-render React: the stage hands a ref and this component
 * writes two attributes per frame from a single rAF (brief §12).
 */
/* eslint-disable react-refresh/only-export-components -- leaf brand module:
   the geometry helpers (bustCorePx) ship with the bust they describe. */
import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';

import { AVATAR_HALO, AVATAR_LAYERS, AVATAR_VIEWBOX } from '@/components/brand/art';
import { showsMutedLook, type TheaterState } from '@/lib/theaterCore';

/* ── Geometry (viewBox 38 28 455 458 — see docs/phases/16-theater-notes.md) ── */

const VIEW = { x: 38, y: 28, w: 455, h: 458 } as const;
export const BUST_EYES = [
  { cx: 200, cy: 133, tilt: -9 },
  { cx: 294, cy: 133, tilt: 9 },
] as const;
export const BUST_CORE = { cx: 264, cy: 333, r: 20 } as const;
const HELMET = { cx: 252, cy: 110 } as const;

/** Chest-core position in CSS px for a bust of `size` px height (sparks). */
export function bustCorePx(size: number): { x: number; y: number; width: number } {
  const scale = size / VIEW.h;
  return { x: (BUST_CORE.cx - VIEW.x) * scale, y: (BUST_CORE.cy - VIEW.y) * scale, width: VIEW.w * scale };
}

export interface Levels {
  mic: number;
  out: number;
}

export interface AvatarBustProps {
  /** Rendered height in px (width follows the art's aspect). */
  size?: number;
  state: TheaterState;
  muted?: boolean;
  /** prefers-reduced-motion: opacity-only transitions, static dots/rings. */
  reduced?: boolean;
  /** Live levels (0..1-ish RMS) — read inside rAF, never a React prop. */
  levels?: RefObject<Levels>;
  className?: string;
  style?: CSSProperties;
}

const EYE_PATH = 'M -21 0 Q -9 -9.5 0 -8.5 Q 11 -9.5 21 0 Q 11 9.5 0 8.5 Q -9 9.5 -21 0 Z';
const SHIELD_PATH =
  'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z';

const ARIA: Record<TheaterState, string> = {
  idle: 'XR avatar, idle',
  listening: 'XR avatar, listening',
  thinking: 'XR avatar, thinking',
  speaking: 'XR avatar, speaking',
  approval: 'XR avatar, waiting for your approval',
  error: 'XR avatar, error',
};

export function AvatarBust({ size = 280, state, muted = false, reduced = false, levels, className, style }: AvatarBustProps) {
  const width = Math.round((size * VIEW.w) / VIEW.h);
  const coreLevelRef = useRef<SVGGElement>(null);
  const micRingRef = useRef<SVGCircleElement>(null);
  const dimmed = showsMutedLook(state, muted);

  // One rAF for both level-driven attributes; nothing else re-renders.
  useEffect(() => {
    const core = coreLevelRef.current;
    const ring = micRingRef.current;
    const live = !reduced && (state === 'speaking' || state === 'listening');
    if (!live || dimmed) {
      core?.setAttribute('transform', 'scale(1)');
      if (ring) {
        ring.setAttribute('r', '64');
        ring.style.opacity = state === 'listening' && !dimmed ? '0.25' : '0';
      }
      return;
    }
    let raf = 0;
    let out = 0;
    let mic = 0;
    const tick = (): void => {
      const lv = levels?.current ?? { mic: 0, out: 0 };
      out += (Math.min(1, lv.out * 4) - out) * 0.35;
      mic += (Math.min(1, lv.mic * 5) - mic) * 0.3;
      if (state === 'speaking') core?.setAttribute('transform', `scale(${(1 + out * 0.15).toFixed(3)})`);
      else if (ring) {
        ring.setAttribute('r', (64 - mic * 30).toFixed(1));
        ring.style.opacity = (0.2 + mic * 0.6).toFixed(2);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, reduced, dimmed, levels]);

  const uid = 'bust';

  return (
    <svg
      className={['xr-bust', className].filter(Boolean).join(' ')}
      data-state={state}
      data-muted={dimmed || undefined}
      data-reduced={reduced || undefined}
      viewBox={AVATAR_VIEWBOX.full}
      width={width}
      height={size}
      role="img"
      aria-label={ARIA[state]}
      style={style}
    >
      <defs>
        <radialGradient id={`${uid}-core`}>
          <stop offset="0" stopColor="#F4FEFF" />
          <stop offset="0.35" stopColor="#7FF2FF" />
          <stop offset="0.75" stopColor="#00E5FF" />
          <stop offset="1" stopColor="#00B8D4" />
        </radialGradient>
        <radialGradient id={`${uid}-glow`}>
          <stop offset="0" stopColor="rgba(0,229,255,0.85)" />
          <stop offset="0.4" stopColor="rgba(0,141,168,0.45)" />
          <stop offset="1" stopColor="rgba(0,229,255,0)" />
        </radialGradient>
        <radialGradient id={`${uid}-eye`} cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor="#F2FDFF" />
          <stop offset="0.45" stopColor="#9BEFFF" />
          <stop offset="1" stopColor="#00E5FF" />
        </radialGradient>
        <filter id={`${uid}-soft`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        <filter id={`${uid}-bloom`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      <g className="xr-bust-breathe">
        <g className="xr-bust-shake">
          {/* traced brand art — halo bands, ink layers, cyan energy */}
          <g className="xr-bust-art">
            {AVATAR_HALO.map((halo, i) => (
              <g key={`h${i}`} fill={`var(${halo.var})`} opacity={halo.opacity}>
                {halo.paths.map((p, j) => (
                  <path key={j} d={p.d} transform={`translate(${p.t[0]},${p.t[1]})`} />
                ))}
              </g>
            ))}
            {AVATAR_LAYERS.map((layer, i) => (
              <g key={`l${i}`} className={layer.cls === 'cy' ? 'xr-bust-energy' : undefined} fill={`var(${layer.var})`}>
                {layer.paths.map((p, j) => (
                  <path key={j} d={p.d} transform={`translate(${p.t[0]},${p.t[1]})`} />
                ))}
              </g>
            ))}
          </g>

          {/* eyes */}
          <g className="xr-bust-eyes">
            {BUST_EYES.map((eye, i) => (
              <g key={i} transform={`translate(${eye.cx},${eye.cy}) rotate(${eye.tilt})`}>
                <ellipse className="xr-bust-eye-cover" rx="27" ry="12.5" filter={`url(#${uid}-soft)`} />
                <g className="xr-bust-eye">
                  <path className="xr-bust-eye-bloom" d={EYE_PATH} filter={`url(#${uid}-bloom)`} />
                  <path className="xr-bust-eye-slit" d={EYE_PATH} fill={`url(#${uid}-eye)`} />
                  <path className="xr-bust-eye-red" d={EYE_PATH} />
                  <ellipse className="xr-bust-eye-lid" rx="23" ry="10.5" />
                </g>
              </g>
            ))}
          </g>

          {/* chest core — one perfect circle */}
          <g transform={`translate(${BUST_CORE.cx},${BUST_CORE.cy})`}>
            <g className="xr-bust-rings" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <circle key={i} className="xr-bust-ring" r={BUST_CORE.r + 6} style={{ animationDelay: `${i * 200}ms` }} />
              ))}
            </g>
            <circle ref={micRingRef} className="xr-bust-mic-ring" r="64" />
            <g className="xr-bust-core">
              <g ref={coreLevelRef}>
                <circle className="xr-bust-core-glow" r={BUST_CORE.r + 34} fill={`url(#${uid}-glow)`} />
                <circle className="xr-bust-core-disc" r={BUST_CORE.r} fill={`url(#${uid}-core)`} />
                <circle className="xr-bust-core-rim" r={BUST_CORE.r + 3} />
              </g>
            </g>
            {dimmed && (
              <g className="xr-bust-mute" transform="translate(46,30) scale(1.5)" aria-hidden="true">
                <path d="M2 2l20 20" />
                <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2M5 10v2a7 7 0 0 0 12 5M15 9.34V5a3 3 0 0 0-5.68-1.33M9 9v3a3 3 0 0 0 5.12 2.12M12 19v3" />
              </g>
            )}
          </g>

          {/* thinking — two dots on an orbit around the helmet */}
          <g className="xr-bust-orbit" transform={`translate(${HELMET.cx},${HELMET.cy}) scale(1,0.82)`} aria-hidden="true">
            <g className="xr-bust-orbit-spin">
              <circle className="xr-bust-dot" cx="122" cy="0" r="3.2" />
              <circle className="xr-bust-dot" cx="-122" cy="0" r="3.2" />
            </g>
          </g>

          {/* approval — warning shield, top-right of the bust */}
          <g className="xr-bust-shield" transform="translate(386,44) scale(1.9)" aria-hidden="true">
            <path d={SHIELD_PATH} />
          </g>
        </g>
      </g>
    </svg>
  );
}
