/*
 * StarField (Phase 16) — hand-rolled canvas, three depth layers.
 *
 *   layer 0  ~150 × 1 px   dim        drift 0.02 px/frame
 *   layer 1   ~60 × 1.5 px mid        drift 0.05
 *   layer 2   ~20 × 2 px   cyan       drift 0.10
 *
 * Counts scale with the viewport area (theaterCore.starCounts). Stars drift
 * right with a whisper of downward parallax and respawn at the edges. While
 * XR speaks, ~5 sparks/s rise from the chest core and fade. One rAF, capped
 * by the display; paused while the document is hidden; static under
 * prefers-reduced-motion (one frame, no sparks); −70 % stars on low-end
 * machines (DPR < 1 or a 2 s frame-time probe over 24 ms).
 */
import { memo, useEffect, useRef } from 'react';

import {
  LOW_END_FRAME_MS,
  PROBE_MS,
  SPARKS_PER_SECOND,
  STAR_LAYERS,
  isLowEnd,
  starCounts,
} from '@/lib/theaterCore';

interface Star {
  x: number;
  y: number;
  /** per-star twinkle phase */
  p: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface StarFieldProps {
  /** Sparks rise while true. */
  speaking: boolean;
  reduced: boolean;
  /** Spark origin in CSS px (the chest core), read per frame. */
  origin: React.RefObject<{ x: number; y: number }>;
}

function seedLayers(width: number, height: number, lowEnd: boolean): Star[][] {
  return starCounts(width, height, lowEnd).map((count) =>
    Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      p: Math.random() * Math.PI * 2,
    }))
  );
}

export const StarField = memo(function StarField({ speaking, reduced, origin }: StarFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let lowEnd = isLowEnd(window.devicePixelRatio || 1, null);
    let layers: Star[][] = [];
    const sparks: Spark[] = [];
    let raf = 0;
    let last = performance.now();
    let sparkDebt = 0;
    // frame-time probe (first 2 s)
    let probeStart = last;
    let probeFrames = 0;
    let probeDone = reduced;

    const resize = (): void => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layers = seedLayers(width, height, lowEnd);
      if (reduced) draw(0, 0);
    };

    const draw = (dt: number, now: number): void => {
      ctx.clearRect(0, 0, width, height);
      const frames = reduced ? 0 : dt / (1000 / 60);
      layers.forEach((stars, li) => {
        const spec = STAR_LAYERS[li];
        ctx.fillStyle = spec.color;
        for (const star of stars) {
          if (frames > 0) {
            star.x += spec.drift * frames;
            star.y += spec.drift * 0.25 * frames;
            if (star.x > width + 2) star.x = -2;
            if (star.y > height + 2) star.y = -2;
          }
          // gentle twinkle on the two brighter layers
          if (li > 0 && !reduced) {
            const tw = 0.75 + 0.25 * Math.sin(now / 1400 + star.p);
            ctx.globalAlpha = tw;
          }
          if (spec.size <= 1) ctx.fillRect(star.x, star.y, 1, 1);
          else {
            ctx.beginPath();
            ctx.arc(star.x, star.y, spec.size / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      });

      if (reduced) return;
      // sparks — spawn while speaking, always let the living ones finish
      if (speakingRef.current) {
        sparkDebt += (SPARKS_PER_SECOND * dt) / 1000;
        const o = origin.current;
        while (sparkDebt >= 1 && o) {
          sparkDebt -= 1;
          sparks.push({
            x: o.x + (Math.random() - 0.5) * 18,
            y: o.y + (Math.random() - 0.5) * 6,
            vx: (Math.random() - 0.5) * 0.25,
            vy: -(0.35 + Math.random() * 0.45),
            life: 1,
          });
        }
      } else sparkDebt = 0;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * frames;
        s.y += s.vy * frames;
        s.life -= 0.012 * frames;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, s.life) * 0.9;
        ctx.fillStyle = s.life > 0.5 ? '#9BEFFF' : '#00E5FF';
        ctx.fillRect(s.x, s.y, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number): void => {
      const dt = Math.min(100, now - last);
      last = now;
      if (!probeDone) {
        probeFrames += 1;
        if (now - probeStart >= PROBE_MS) {
          probeDone = true;
          const avg = (now - probeStart) / Math.max(1, probeFrames);
          if (avg > LOW_END_FRAME_MS && !lowEnd) {
            lowEnd = true;
            layers = seedLayers(width, height, true);
          }
        }
      }
      draw(dt, now);
      raf = requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (reduced || raf) return;
      last = performance.now();
      probeStart = last;
      probeFrames = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = (): void => {
      if (document.hidden) stop();
      else start();
    };

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    ro?.observe(canvas);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    if (!document.hidden) start();

    return () => {
      stop();
      ro?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reduced, origin]);

  return <canvas ref={canvasRef} className="theater-stars" aria-hidden="true" />;
});
