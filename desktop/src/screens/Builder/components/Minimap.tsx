/*
 * Minimap (Phase 17) — 80px canvas: one 2px bar per line, width ∝ length,
 * a translucent band for the visible viewport, click to scroll. Redraws are
 * rAF-coalesced by the parent; no dependency.
 */
import type { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';

const WIDTH = 80;
const ROW = 2;
const MAX_LINES = 20_000;

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function Minimap({ view }: { view: EditorView | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;
    let raf: number | null = null;
    const draw = () => {
      raf = null;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const height = canvas.clientHeight || 1;
      if (canvas.width !== WIDTH * dpr || canvas.height !== height * dpr) {
        canvas.width = WIDTH * dpr;
        canvas.height = height * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, WIDTH, height);
      const doc = view.state.doc;
      const lines = Math.min(doc.lines, MAX_LINES);
      const scale = Math.min(1, height / Math.max(1, lines * ROW));
      const ink = cssVar('--text-tertiary', '#6b7a90');
      const accent = cssVar('--accent', '#00e5ff');
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.55;
      const step = scale < 1 ? Math.ceil(1 / scale) : 1;
      for (let n = 1; n <= lines; n += step) {
        const text = doc.line(n).text;
        const lead = /^[ \t]*/.exec(text)?.[0].length ?? 0;
        const len = Math.min(text.length - lead, 120);
        if (len <= 0) continue;
        const y = (n - 1) * ROW * scale;
        ctx.fillRect(2 + Math.min(lead, 40) * 0.5, y, (len / 120) * (WIDTH - 6), Math.max(1, ROW * scale * 0.8));
      }
      // Viewport band.
      const first = doc.lineAt(view.viewport.from).number;
      const last = doc.lineAt(view.viewport.to).number;
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = accent;
      ctx.fillRect(0, (first - 1) * ROW * scale, WIDTH, Math.max(4, (last - first + 1) * ROW * scale));
      ctx.globalAlpha = 1;
    };
    const schedule = () => {
      if (raf === null) raf = window.requestAnimationFrame(draw);
    };
    schedule();
    const scroller = view.scrollDOM;
    scroller.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(canvas);
    const obs = new MutationObserver(schedule);
    obs.observe(view.contentDOM, { childList: true, characterData: true, subtree: true });
    return () => {
      if (raf !== null) window.cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', schedule);
      ro.disconnect();
      obs.disconnect();
    };
  }, [view]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const doc = view.state.doc;
    const lines = Math.min(doc.lines, MAX_LINES);
    const scale = Math.min(1, rect.height / Math.max(1, lines * ROW));
    const line = Math.min(doc.lines, Math.max(1, Math.round((e.clientY - rect.top) / (ROW * scale)) + 1));
    view.scrollDOM.scrollTo({ top: view.lineBlockAt(doc.line(line).from).top - rect.height / 2, behavior: 'auto' });
  };

  return <canvas ref={canvasRef} className="xb-minimap" width={WIDTH} aria-hidden="true" onClick={onClick} />;
}
