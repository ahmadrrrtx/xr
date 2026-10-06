/*
 * Stacked area chart (Phase 13) — hand-rolled SVG, no chart library.
 * Four layers (LLM / Tools / Voice / Compute) stacked bottom-up, 800 ms
 * draw-in on first paint (opacity-only under reduced motion), hover
 * crosshair with a per-category tooltip, and an sr-only table twin.
 */
import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

import { fmtUsd, niceCeil } from '@/budget/core';
import {
  CATEGORY_LABEL,
  SPEND_CATEGORIES,
  type SeriesBucket,
  type SpendCategory,
} from '@/budget/types';

import { CategorySwatch } from './shared';

const W = 640;
const H = 200;
const PAD = { top: 10, right: 12, bottom: 24, left: 44 };

function smoothPath(points: Array<[number, number]>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

export function SpendChart({
  buckets,
  rangeLabel,
  testId = 'spend-chart',
}: {
  buckets: SeriesBucket[];
  rangeLabel: string;
  testId?: string;
}) {
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);

  const { layers, max, xs, labelsEvery } = useMemo(() => {
    const n = buckets.length;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const xs = buckets.map(
      (_, i) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
    );
    const totals = buckets.map((b) => b.total);
    const max = niceCeil(Math.max(0, ...totals));
    const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
    // Stack order bottom-up: llm, tools, voice, compute.
    const cum = new Array<number>(n).fill(0);
    const layers = SPEND_CATEGORIES.map((cat) => {
      const lower = cum.slice();
      for (let i = 0; i < n; i++) cum[i] += buckets[i].byCategory[cat];
      const upper = cum.slice();
      const top = smoothPath(
        upper.map((v, i) => [xs[i], y(v)] as [number, number])
      );
      const bottomPts = lower
        .map((v, i) => [xs[i], y(v)] as [number, number])
        .reverse();
      const bottom = smoothPath(bottomPts);
      const area = n
        ? `${top} L${bottomPts[0][0]},${bottomPts[0][1]} ${bottom.slice(1)} Z`
        : '';
      return { cat, area, line: top };
    });
    const labelsEvery = n > 16 ? Math.ceil(n / 6) : n > 8 ? 2 : 1;
    return { layers, max, xs, labelsEvery };
  }, [buckets]);

  const innerH = H - PAD.top - PAD.bottom;
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const hovered = hover !== null ? buckets[hover] : null;
  const tooltipLeft = hover !== null ? (xs[hover] / W) * 100 : 0;

  return (
    <div className="relative" data-testid={testId}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Spend by category, ${rangeLabel}`}
        className="block h-auto w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          let bestD = Infinity;
          xs.forEach((x, i) => {
            const d = Math.abs(x - px);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          setHover(best);
        }}
      >
        <defs>
          <clipPath id="spend-chart-clip">
            {/* Draw-in: the clip widens left → right over 800 ms. */}
            <rect x={PAD.left} y={0} height={H} width={W - PAD.left}>
              {!reduced && (
                <animate
                  attributeName="width"
                  from="0"
                  to={W - PAD.left}
                  dur="0.8s"
                  fill="freeze"
                />
              )}
            </rect>
          </clipPath>
        </defs>

        {/* Grid + y labels */}
        {gridVals.map((v) => {
          const y = PAD.top + innerH - (v / max) * innerH;
          return (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
                stroke="var(--border-subtle)"
                strokeDasharray={v === 0 ? undefined : '2 4'}
              />
              <text
                x={PAD.left - 8}
                y={y + 3.5}
                textAnchor="end"
                fontSize={10}
                fill="var(--text-tertiary)"
                fontFamily="var(--font-mono, ui-monospace)"
              >
                {fmtUsd(v, { compact: true })}
              </text>
            </g>
          );
        })}

        {/* Areas */}
        <g
          clipPath="url(#spend-chart-clip)"
          style={reduced ? { animation: 'none' } : undefined}
        >
          {layers.map((l) => (
            <g key={l.cat}>
              <path
                d={l.area}
                fill={`var(--spend-${l.cat})`}
                fillOpacity={0.28}
              />
              <path
                d={l.line}
                fill="none"
                stroke={`var(--spend-${l.cat})`}
                strokeWidth={1.5}
              />
            </g>
          ))}
        </g>

        {/* X labels */}
        {buckets.map((b, i) =>
          i % labelsEvery === 0 || i === buckets.length - 1 ? (
            <text
              key={b.at}
              x={xs[i]}
              y={H - 6}
              textAnchor={
                i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle'
              }
              fontSize={10}
              fill="var(--text-tertiary)"
            >
              {b.label}
            </text>
          ) : null
        )}

        {/* Hover crosshair */}
        {hover !== null && (
          <line
            x1={xs[hover]}
            x2={xs[hover]}
            y1={PAD.top}
            y2={PAD.top + innerH}
            stroke="var(--text-tertiary)"
            strokeDasharray="3 3"
          />
        )}
      </svg>

      {hovered && (
        <div
          role="tooltip"
          className="border-border-subtle bg-bg-raised pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-lg border px-2.5 py-2 text-[11px] shadow-lg"
          style={{
            left: `${tooltipLeft}%`,
            transform:
              tooltipLeft > 70
                ? 'translateX(calc(-100% - 8px))'
                : 'translateX(8px)',
          }}
        >
          <div className="text-text-primary mb-1 font-medium">
            {hovered.label}
          </div>
          {SPEND_CATEGORIES.map((c) => (
            <div key={c} className="flex items-center justify-between gap-3">
              <CategorySwatch category={c} />
              <span className="text-text-secondary font-mono tabular-nums">
                {fmtUsd(hovered.byCategory[c], {
                  precise:
                    hovered.byCategory[c] < 0.01 && hovered.byCategory[c] > 0,
                })}
              </span>
            </div>
          ))}
          <div className="border-border-subtle text-text-primary mt-1 flex justify-between border-t pt-1 font-medium">
            <span>Total</span>
            <span className="font-mono tabular-nums">
              {fmtUsd(hovered.total)}
            </span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-4 px-1">
        {SPEND_CATEGORIES.map((c) => (
          <CategorySwatch key={c} category={c} />
        ))}
      </div>

      {/* Screen-reader twin */}
      <table className="sr-only">
        <caption>Spend by category, {rangeLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {SPEND_CATEGORIES.map((c: SpendCategory) => (
              <th key={c} scope="col">
                {CATEGORY_LABEL[c]}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.at}>
              <th scope="row">{b.label}</th>
              {SPEND_CATEGORIES.map((c) => (
                <td key={c}>{fmtUsd(b.byCategory[c], { precise: true })}</td>
              ))}
              <td>{fmtUsd(b.total, { precise: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
