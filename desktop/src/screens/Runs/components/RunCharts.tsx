/*
 * Control Room charts (Phase 11, brief §4.6) — hand-rolled SVG, no chart
 * library. Three panels over the CURRENT filter set + a totals line:
 *   • runs per hour (24 bars, grow 400 ms)
 *   • cost per day, stacked by model family (30 d, fade/draw 800 ms)
 *   • tokens by model donut (top 5 + Other, centre total)
 * Every panel has an sr-only data table; colours come from the theme's
 * --chart-* tokens so Paper/Arctic get print inks, not neon.
 */
import { useId, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { fmtTokens, fmtUsd } from '@/brain/format';
import type { RunSummary } from '@/brain/types';
import { cn } from '@/lib/utils';
import {
  COST_STACK,
  FAMILY_LABEL,
  costPerDay,
  familyColorVar,
  niceMax,
  runsPerHour,
  tokensByModel,
  totals,
  type DayBucket,
  type HourBucket,
  type ModelSlice,
} from '@/runs/core';

export function RunCharts({
  open,
  rows,
  now,
}: {
  open: boolean;
  rows: RunSummary[];
  now: number;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.section
          key="charts"
          aria-label="Charts"
          data-testid="runs-charts"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="shrink-0 overflow-hidden"
        >
          <ChartsBody rows={rows} now={now} />
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function ChartsBody({ rows, now }: { rows: RunSummary[]; now: number }) {
  // Bucket "now" to the minute so ticking doesn't recompute every 500 ms.
  const minute = Math.floor(now / 60_000) * 60_000;
  const hours = useMemo(() => runsPerHour(rows, minute), [rows, minute]);
  const days = useMemo(() => costPerDay(rows, minute), [rows, minute]);
  const slices = useMemo(() => tokensByModel(rows), [rows]);
  const sum = useMemo(() => totals(rows), [rows]);

  return (
    <div className="px-4 pt-3">
      <div className="grid gap-2 lg:grid-cols-3">
        <Panel title="Runs per hour" sub="Last 24 hours">
          <HourBars data={hours} />
        </Panel>
        <Panel title="Cost per day" sub="Last 30 days · by model family">
          <CostArea data={days} />
        </Panel>
        <Panel title="Tokens by model" sub="Top 5 + other">
          <ModelDonut data={slices} />
        </Panel>
      </div>
      <TotalsLine t={sum} />
    </div>
  );
}

function Panel({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border-subtle bg-bg-ink rounded-lg border p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-text-primary text-[12px] font-medium">{title}</h3>
        <span className="text-text-tertiary text-[11px]">{sub}</span>
      </div>
      {children}
    </div>
  );
}

/* ── Runs per hour ─────────────────────────────────────────────────────── */

function HourBars({ data }: { data: HourBucket[] }) {
  const W = 480;
  const H = 120;
  const padL = 24;
  const padB = 16;
  const max = niceMax(Math.max(1, ...data.map((d) => d.count)));
  const innerW = W - padL;
  const slot = innerW / 24;
  const bw = Math.max(4, slot - 4);
  const plotH = H - padB - 4;
  const y = (v: number): number => 4 + plotH - (v / max) * plotH;
  const id = useId();
  // Integer ticks only — a half tick on a max of 2 would read "1, 1".
  const ticks = max >= 4 ? [0, 0.5, 1] : [0, 1];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-[120px] w-full"
        aria-labelledby={id}
      >
        <title id={id}>Runs per hour, last 24 hours</title>
        {ticks.map((f) => (
          <g key={f}>
            <line
              x1={padL}
              x2={W}
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="var(--border-subtle)"
              strokeDasharray={f === 0 ? undefined : '2 3'}
            />
            <text
              x={padL - 4}
              y={y(max * f) + 3}
              textAnchor="end"
              fontSize="9"
              fontFamily="var(--font-mono)"
              fill="var(--text-tertiary)"
            >
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = (d.count / max) * plotH;
          const x = padL + i * slot + (slot - bw) / 2;
          return (
            <g key={d.at}>
              <rect
                className="run-bar"
                style={{ animationDelay: `${i * 12}ms` }}
                x={x}
                y={y(d.count)}
                width={bw}
                height={Math.max(d.count > 0 ? 2 : 0, h)}
                rx={1.5}
                fill={
                  d.isCurrent
                    ? 'var(--accent)'
                    : 'color-mix(in oklab, var(--accent) 45%, transparent)'
                }
              >
                <title>{`${d.label}: ${d.count} ${d.count === 1 ? 'run' : 'runs'}`}</title>
              </rect>
              {i % 6 === 0 && (
                <text
                  x={x + bw / 2}
                  y={H - 4}
                  textAnchor="middle"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fill="var(--text-tertiary)"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Runs per hour</caption>
        <thead>
          <tr>
            <th>Hour</th>
            <th>Runs</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.at}>
              <td>{d.label}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/* ── Cost per day (stacked area) ───────────────────────────────────────── */

function CostArea({ data }: { data: DayBucket[] }) {
  const W = 480;
  const H = 120;
  const padL = 34;
  const padB = 16;
  const plotH = H - padB - 6;
  const max = niceMax(Math.max(0.01, ...data.map((d) => d.total)));
  const n = data.length;
  const x = (i: number): number =>
    padL + (i / Math.max(1, n - 1)) * (W - padL - 2);
  const y = (v: number): number => 6 + plotH - (v / max) * plotH;
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);

  // Cumulative stacks per family (bottom → top).
  const layers = useMemo(() => {
    const base = data.map(() => 0);
    return COST_STACK.map((fam) => {
      const lower = [...base];
      const upper = data.map((d, i) => {
        const v = d.byFamily[fam];
        const u = lower[i] + v;
        base[i] = u;
        return u;
      });
      const path =
        upper
          .map(
            (u, i) =>
              `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(u).toFixed(1)}`
          )
          .join(' ') +
        ' ' +
        lower
          .map(
            (_, i) =>
              `L${x(n - 1 - i).toFixed(1)},${y(lower[n - 1 - i]).toFixed(1)}`
          )
          .join(' ') +
        ' Z';
      const line = upper
        .map(
          (u, i) =>
            `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(u).toFixed(1)}`
        )
        .join(' ');
      const any = upper.some((u, i) => u - lower[i] > 0);
      return { fam, path, line, any };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, max]);

  const used = layers.filter((l) => l.any).map((l) => l.fam);
  const legend = [
    ...used,
    ...(used.includes('local') ? [] : ['local' as const]),
  ];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-[120px] w-full"
        aria-labelledby={id}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - padL) / (W - padL - 2)) * (n - 1));
          setHover(i >= 0 && i < n ? i : null);
        }}
      >
        <title id={id}>Cost per day, last 30 days</title>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={padL}
              x2={W}
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="var(--border-subtle)"
              strokeDasharray={f === 0 ? undefined : '2 3'}
            />
            <text
              x={padL - 4}
              y={y(max * f) + 3}
              textAnchor="end"
              fontSize="9"
              fontFamily="var(--font-mono)"
              fill="var(--text-tertiary)"
            >
              {max * f >= 1
                ? `$${(max * f).toFixed(0)}`
                : `$${(max * f).toFixed(2)}`}
            </text>
          </g>
        ))}
        {layers.map(
          (l) =>
            l.any && (
              <g key={l.fam}>
                <path
                  d={l.path}
                  className="run-area"
                  fill={familyColorVar(l.fam)}
                  fillOpacity={0.28}
                />
                <path
                  d={l.line}
                  className="run-line"
                  pathLength={1}
                  fill="none"
                  stroke={familyColorVar(l.fam)}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
              </g>
            )
        )}
        {[0, Math.floor(n / 2), n - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 4}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            fontSize="9"
            fontFamily="var(--font-mono)"
            fill="var(--text-tertiary)"
          >
            {data[i]?.label}
          </text>
        ))}
        {hover !== null && data[hover] && (
          <g pointerEvents="none">
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={6}
              y2={6 + plotH}
              stroke="var(--text-tertiary)"
              strokeDasharray="2 2"
            />
            <circle
              cx={x(hover)}
              cy={y(data[hover].total)}
              r={3}
              fill="var(--accent)"
            />
            <HoverLabel
              x={x(hover)}
              y={y(data[hover].total)}
              w={W}
              text={`${data[hover].label} · ${fmtUsd(data[hover].total)}`}
            />
          </g>
        )}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1" aria-label="Legend">
        {legend.map((fam) => (
          <li
            key={fam}
            className="text-text-tertiary flex items-center gap-1.5 text-[10px]"
          >
            <span
              aria-hidden="true"
              className="inline-block size-2 rounded-sm"
              style={{ background: familyColorVar(fam) }}
            />
            {FAMILY_LABEL[fam]}
            {fam === 'local' && <span className="font-mono">$0</span>}
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>Cost per day by model family</caption>
        <thead>
          <tr>
            <th>Day</th>
            {COST_STACK.map((f) => (
              <th key={f}>{FAMILY_LABEL[f]}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.at}>
              <td>{d.label}</td>
              {COST_STACK.map((f) => (
                <td key={f}>{fmtUsd(d.byFamily[f])}</td>
              ))}
              <td>{fmtUsd(d.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function HoverLabel({
  x,
  y,
  w,
  text,
}: {
  x: number;
  y: number;
  w: number;
  text: string;
}) {
  const bw = text.length * 5.6 + 12;
  const left = Math.min(Math.max(x - bw / 2, 2), w - bw - 2);
  const top = Math.max(2, y - 22);
  return (
    <g>
      <rect
        x={left}
        y={top}
        width={bw}
        height={16}
        rx={3}
        fill="var(--tooltip-bg)"
      />
      <text
        x={left + bw / 2}
        y={top + 11}
        textAnchor="middle"
        fontSize="9.5"
        fontFamily="var(--font-mono)"
        fill="var(--tooltip-fg)"
      >
        {text}
      </text>
    </g>
  );
}

/* ── Tokens by model (donut) ───────────────────────────────────────────── */

function ModelDonut({ data }: { data: ModelSlice[] }) {
  const R = 40;
  const C = 2 * Math.PI * R;
  const total = data.reduce((a, s) => a + s.tokens, 0);
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  // Arc start offsets, derived up front (render stays pure).
  const offsets = data.reduce<number[]>((acc, _s, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + data[i - 1].share * C);
    return acc;
  }, []);

  if (data.length === 0) {
    return (
      <div className="text-text-tertiary flex h-[120px] items-center justify-center text-[12px]">
        No token usage in this view.
      </div>
    );
  }

  return (
    <figure className="m-0 flex items-center gap-3">
      <svg
        viewBox="0 0 120 120"
        className="block size-[120px] shrink-0"
        aria-labelledby={id}
      >
        <title id={id}>Tokens by model</title>
        <circle
          cx={60}
          cy={60}
          r={R}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={14}
        />
        <g transform="rotate(-90 60 60)">
          {data.map((s, i) => {
            const len = s.share * C;
            const dash = `${Math.max(0, len - 1.5)} ${C - Math.max(0, len - 1.5)}`;
            return (
              <circle
                key={s.model}
                className="run-donut-seg run-area"
                cx={60}
                cy={60}
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={hover === i ? 18 : 14}
                strokeDasharray={dash}
                strokeDashoffset={-offsets[i]}
                opacity={hover === null || hover === i ? 1 : 0.45}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${s.model}: ${fmtTokens(s.tokens)} tokens (${Math.round(s.share * 100)}%)`}</title>
              </circle>
            );
          })}
        </g>
        <text
          x={60}
          y={57}
          textAnchor="middle"
          fontSize="15"
          fontWeight={600}
          fontFamily="var(--font-mono)"
          fill="var(--text-primary)"
        >
          {hover !== null
            ? `${Math.round(data[hover].share * 100)}%`
            : fmtTokens(total)}
        </text>
        <text
          x={60}
          y={71}
          textAnchor="middle"
          fontSize="8.5"
          fill="var(--text-tertiary)"
        >
          {hover !== null ? truncate(data[hover].model, 16) : 'tokens'}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1" aria-label="Legend">
        {data.map((s, i) => (
          <li
            key={s.model}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={cn(
              'flex items-center gap-2 text-[11px] transition-opacity',
              hover !== null && hover !== i && 'opacity-50'
            )}
          >
            <span
              aria-hidden="true"
              className="inline-block size-2 shrink-0 rounded-sm"
              style={{ background: s.color }}
            />
            <span className="text-text-secondary min-w-0 flex-1 truncate font-mono">
              {s.model}
            </span>
            <span className="text-text-tertiary font-mono tabular-nums">
              {fmtTokens(s.tokens)}
            </span>
            <span className="text-text-primary w-8 text-right font-mono tabular-nums">
              {Math.round(s.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>Tokens by model</caption>
        <thead>
          <tr>
            <th>Model</th>
            <th>Tokens</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          {data.map((s) => (
            <tr key={s.model}>
              <td>{s.model}</td>
              <td>{s.tokens}</td>
              <td>{Math.round(s.share * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* ── Totals line ───────────────────────────────────────────────────────── */

function TotalsLine({ t }: { t: ReturnType<typeof totals> }) {
  const rateClass =
    t.successRate >= 90
      ? 'text-success'
      : t.successRate >= 70
        ? 'text-warning'
        : 'text-danger';
  return (
    <p
      className="text-text-tertiary mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]"
      data-testid="runs-totals"
    >
      <span>
        <span className="text-text-secondary">{t.runs.toLocaleString()}</span>{' '}
        runs
      </span>
      <span aria-hidden="true">·</span>
      <span>
        <span className="text-text-secondary">{fmtTokens(t.tokens)}</span>{' '}
        tokens
      </span>
      <span aria-hidden="true">·</span>
      <span>
        <span className="text-text-secondary">{fmtUsd(t.cost)}</span> spent
      </span>
      <span aria-hidden="true">·</span>
      <span>
        <span className={rateClass}>{t.successRate}%</span> success
        {t.failed > 0 && <span> ({t.failed} failed)</span>}
      </span>
    </p>
  );
}
