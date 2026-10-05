/*
 * Brain · Gantt timeline (Phase 9, brief §4d).
 *
 * Hand-rolled (no chart lib — brief §2 research note). One 10px bar per
 * visible tree row on a 12px pitch, positioned by (start − pan) × pxPerMs.
 * Zoom (buttons, ⌘+scroll around the cursor), drag-pan, double-click fit,
 * hover tooltip, click-to-select, running bars grow in real time with a
 * brighter leading tip. Culling keeps 10k-node runs cheap:
 *   - vertical: only rows inside the scroll viewport render
 *   - horizontal: only spans intersecting the time window render
 *   - sub-1px spans render as 1px ticks
 * Reduced motion: no tip glow, widths snap (the 100ms tick IS the tween).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';

import { catColor, type TreeRow } from './tree';
import { fmtDuration, fmtTokens } from './format';
import {
  CATEGORY_LABEL,
  type Run,
  type Span,
  type SpanCategory,
} from './types';
import { cn } from '@/lib/utils';
import { useBrainStore } from '@/stores/brainStore';

const ROW_PITCH = 12;
const BAR_H = 10;

interface GanttProps {
  runId: string;
  run: Run;
  rows: TreeRow[];
  selectedSpanId: string | null;
  onSelect: (id: string) => void;
}

interface Hover {
  x: number;
  y: number;
  span: Span;
}

export function Gantt({
  runId,
  run,
  rows,
  selectedSpanId,
  onSelect,
}: GanttProps) {
  const spans = useBrainStore((s) => s.data[runId]?.spans);
  const zoom = useBrainStore((s) => s.ganttZoom);
  const panMs = useBrainStore((s) => s.ganttPanMs);
  const setZoom = useBrainStore((s) => s.setZoom);
  const setPan = useBrainStore((s) => s.setPan);
  const resetView = useBrainStore((s) => s.resetView);
  const reduced = useReducedMotion();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const drag = useRef<{ x: number; pan: number; moved: boolean } | null>(null);

  // Is anything still running? (drives the 100ms ticker)
  const runActive = run.status === 'running' || run.status === 'waiting';

  useEffect(() => {
    if (!runActive) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [runActive]);

  // Measure the scroll viewport (drives both culling and the zoom math).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight })
    );
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* ── Time window maths ─────────────────────────────────────────────── */

  const totalMs = useMemo(() => {
    if (!spans)
      return run.endedAt ? run.endedAt - run.startedAt : now - run.startedAt;
    let end = run.endedAt ? run.endedAt - run.startedAt : 0;
    for (const sp of Object.values(spans)) {
      const e = sp.endedAt
        ? sp.endedAt - run.startedAt
        : sp.status === 'running'
          ? now - run.startedAt
          : 0;
      if (e > end) end = e;
    }
    return Math.max(end, 1000);
  }, [spans, run, now]);

  const windowMs = Math.max(1, totalMs / zoom);
  const width = size.w;
  const pxPerMs = width > 0 ? width / windowMs : 0;
  const maxPan = Math.max(0, totalMs - windowMs);

  const clampPan = useCallback(
    (p: number): number => Math.min(maxPan, Math.max(0, p)),
    [maxPan]
  );

  /* ── Interaction ───────────────────────────────────────────────────── */

  // ⌘/Ctrl + wheel zooms around the cursor. Native NON-passive listener so
  // preventDefault actually works (React registers wheel as passive).
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelRef.current = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return; // plain wheel = vertical scroll
      e.preventDefault();
      const el = scrollRef.current;
      if (!el || size.w === 0) return;
      const rect = el.getBoundingClientRect();
      const frac = Math.min(
        1,
        Math.max(0, (e.clientX - rect.left) / rect.width)
      );
      const anchorMs = panMs + frac * windowMs;
      const nextZoom = Math.min(
        64,
        Math.max(1, zoom * (e.deltaY < 0 ? 1.25 : 0.8))
      );
      const nextWindow = Math.max(1, totalMs / nextZoom);
      setZoom(nextZoom);
      setPan(clampPan(anchorMs - frac * nextWindow));
    };
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fn = (e: WheelEvent): void => wheelRef.current(e);
    el.addEventListener('wheel', fn, { passive: false });
    return () => el.removeEventListener('wheel', fn);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, pan: panMs, moved: false };
    },
    [panMs]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 3) d.moved = true;
      if (!d.moved || width === 0) return;
      setPan(clampPan(d.pan - dx / pxPerMs));
    },
    [clampPan, pxPerMs, setPan, width]
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  const zoomBy = (factor: number): void => {
    const center = panMs + windowMs / 2;
    const nextZoom = Math.min(64, Math.max(1, zoom * factor));
    const nextWindow = Math.max(1, totalMs / nextZoom);
    setZoom(nextZoom);
    setPan(clampPan(center - nextWindow / 2));
  };

  /* ── Row culling (vertical) ────────────────────────────────────────── */

  const viewportH = Math.max(200, size.h);
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_PITCH) - 4);
  const lastRow = Math.min(
    rows.length,
    firstRow + Math.ceil(viewportH / ROW_PITCH) + 8
  );

  const windowStart = panMs;
  const windowEnd = panMs + windowMs;

  const bars: React.ReactNode[] = [];
  for (let i = firstRow; i < lastRow; i++) {
    const row = rows[i];
    const sp = spans?.[row.id];
    if (!sp) continue;
    const startMs = sp.startedAt - run.startedAt;
    const endMs = sp.endedAt
      ? sp.endedAt - run.startedAt
      : sp.status === 'running'
        ? Math.max(startMs, now - run.startedAt)
        : sp.status === 'waiting'
          ? Math.max(startMs, now - run.startedAt)
          : sp.status === 'pending'
            ? -1
            : startMs;
    if (endMs < 0) continue; // pending — no bar yet
    if (endMs < windowStart || startMs > windowEnd) continue; // horizontal cull
    const left = (startMs - windowStart) * pxPerMs;
    const w = Math.max(0, (endMs - startMs) * pxPerMs);
    const top = i * ROW_PITCH + 1;
    const isRunning = sp.status === 'running' || sp.status === 'waiting';
    const isSel = sp.id === selectedSpanId;
    const color = catColor(sp.category);

    if (w < 1) {
      // Sub-pixel: a 1px tick at the span's offset.
      bars.push(
        <span
          key={sp.id}
          aria-hidden="true"
          className="absolute rounded-full"
          style={{
            left,
            top,
            width: 1,
            height: BAR_H,
            backgroundColor: color,
            opacity: 0.8,
          }}
        />
      );
      continue;
    }
    bars.push(
      <span
        key={sp.id}
        role="img"
        aria-label={`${sp.name} — ${fmtDuration(endMs - startMs)}`}
        onMouseEnter={(e) => {
          const rect = trackRef.current?.getBoundingClientRect();
          if (rect)
            setHover({
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
              span: sp,
            });
        }}
        onMouseMove={(e) => {
          const rect = trackRef.current?.getBoundingClientRect();
          if (rect)
            setHover({
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
              span: sp,
            });
        }}
        onMouseLeave={() => setHover(null)}
        onClick={() => {
          if (drag.current?.moved) return;
          onSelect(sp.id);
        }}
        className={cn(
          'absolute cursor-pointer rounded-[2px]',
          isSel && 'ring-accent ring-1 ring-inset'
        )}
        style={{
          left,
          top,
          width: Math.max(1, w),
          height: BAR_H,
          backgroundColor: color,
          opacity: row.dimmed ? 0.4 : 1,
        }}
      >
        {/* Running leading tip — brighter 2px edge with a soft glow. */}
        {isRunning && !reduced && (
          <span
            aria-hidden="true"
            className="xr-gantt-tip absolute top-0 right-0 h-full w-[3px] rounded-r-[2px]"
            style={{ backgroundColor: 'var(--accent)' }}
          />
        )}
      </span>
    );
  }

  /* ── Axis ticks (over the visible window) ──────────────────────────── */

  const ticks = useMemo(() => {
    const target = 6;
    const raw = windowMs / target;
    const steps = [
      1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000,
      60000, 120000, 300000, 600000,
    ];
    let step = steps[steps.length - 1];
    for (const s of steps)
      if (s >= raw) {
        step = s;
        break;
      }
    const out: { at: number; x: number }[] = [];
    const first = Math.ceil(windowStart / step) * step;
    for (let t = first; t <= windowEnd + step / 2; t += step) {
      out.push({ at: t, x: (t - windowStart) * pxPerMs });
    }
    return out;
  }, [windowStart, windowEnd, windowMs, pxPerMs]);

  const innerWidth = windowMs * pxPerMs;
  const innerHeight = Math.max(rows.length * ROW_PITCH, 0);

  return (
    <div className="bg-bg-ink relative flex h-full w-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="border-border-subtle flex h-7 shrink-0 items-center gap-1 border-b px-2">
        <span className="text-text-tertiary font-mono text-[10px] tracking-wider uppercase">
          timeline
        </span>
        <span className="text-text-tertiary ml-auto font-mono text-[10px]">
          {fmtDuration(panMs)} →{' '}
          {fmtDuration(Math.min(totalMs, panMs + windowMs))} ·{' '}
          {zoom.toFixed(zoom < 10 ? 1 : 0)}×
        </span>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out (⌘−)"
          onClick={() => zoomBy(0.8)}
          className="hover:bg-bg-raised text-text-secondary focus-visible:ring-accent flex h-5 w-5 items-center justify-center rounded focus-visible:ring-1 focus-visible:outline-none"
        >
          <Minus size={12} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in (⌘+)"
          onClick={() => zoomBy(1.25)}
          className="hover:bg-bg-raised text-text-secondary focus-visible:ring-accent flex h-5 w-5 items-center justify-center rounded focus-visible:ring-1 focus-visible:outline-none"
        >
          <Plus size={12} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Fit timeline"
          title="Fit (⌘0 / double-click)"
          onClick={resetView}
          className="hover:bg-bg-raised text-text-secondary focus-visible:ring-accent flex h-5 w-5 items-center justify-center rounded focus-visible:ring-1 focus-visible:outline-none"
        >
          <Maximize2 size={12} strokeWidth={1.5} />
        </button>
      </div>

      {/* Scrollable canvas */}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        {/* Axis */}
        <div className="bg-bg-ink/95 border-border-subtle sticky top-0 z-10 h-5 border-b">
          <div
            ref={trackRef}
            className="relative h-full"
            style={{ width: '100%' }}
          >
            {ticks.map((t) => (
              <span
                key={t.at}
                className="text-text-tertiary border-border-subtle absolute top-0 h-full border-l pl-1 font-mono text-[10px] leading-5 whitespace-nowrap"
                style={{ left: t.x }}
              >
                {t.at === 0 ? '0' : fmtDuration(t.at)}
              </span>
            ))}
          </div>
        </div>

        {/* Bars canvas — drag to pan, ⌘+scroll to zoom, double-click to fit */}
        <div
          role="img"
          aria-label="Gantt chart of all spans"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={resetView}
          className="relative w-full cursor-grab touch-none select-none active:cursor-grabbing"
          style={{ height: innerHeight }}
        >
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: innerWidth }}
          >
            {/* Faint grid lines at tick positions */}
            {ticks.map((t) => (
              <span
                key={t.at}
                aria-hidden="true"
                className="border-border-subtle absolute inset-y-0 border-l"
                style={{ left: t.x }}
              />
            ))}
            {bars}
          </div>
        </div>
      </div>

      {/* Hover tooltip */}
      {hover && (
        <div
          role="tooltip"
          className="bg-bg-raised border-border-default text-text-primary pointer-events-none absolute z-20 max-w-[280px] rounded-md border px-2.5 py-1.5 shadow-lg"
          style={{
            left: Math.min(hover.x + 12, Math.max(0, size.w - 260)),
            top: hover.y + 14,
          }}
        >
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: catColor(hover.span.category) }}
            />
            <span className="truncate text-[12px] font-semibold">
              {hover.span.name}
            </span>
          </div>
          <div className="text-text-secondary mt-0.5 font-mono text-[11px]">
            {fmtDuration(
              hover.span.durationMs ??
                (hover.span.status === 'running'
                  ? now - hover.span.startedAt
                  : 0)
            )}
            {hover.span.tokensOut != null && hover.span.tokensOut > 0 && (
              <span> · {fmtTokens(hover.span.tokensOut)} tok</span>
            )}
          </div>
          <div className="text-text-tertiary font-mono text-[10px]">
            start +{fmtDuration(hover.span.startedAt - run.startedAt)} ·{' '}
            {CATEGORY_LABEL[hover.span.category as SpanCategory]} ·{' '}
            {hover.span.status}
          </div>
        </div>
      )}

      {/* Screen-reader table equivalent (first 500 rows on huge runs) */}
      <table className="sr-only">
        <caption>Trace timeline: {rows.length} spans</caption>
        <thead>
          <tr>
            <th scope="col">Span</th>
            <th scope="col">Category</th>
            <th scope="col">Start</th>
            <th scope="col">Duration</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((r) => {
            const sp = spans?.[r.id];
            if (!sp) return null;
            return (
              <tr key={r.id}>
                <th scope="row">{sp.name}</th>
                <td>{CATEGORY_LABEL[sp.category]}</td>
                <td>{fmtDuration(sp.startedAt - run.startedAt)}</td>
                <td>{fmtDuration(sp.durationMs ?? 0)}</td>
                <td>{sp.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
