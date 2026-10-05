/*
 * Brain · secondary tabs (Phase 9, brief §4f) — functional, real mock data,
 * intentionally less polished than the Trace tab.
 *
 *   Timeline — full-width Gantt + 200px pinned compact tree
 *   Events   — virtualized reverse-chron log (search + "N new" pill)
 *   Cost     — totals tiles + per-category div bars (no chart lib)
 *   Logs     — virtualized raw log with a small ANSI-style colorizer
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { List, type ListImperativeAPI } from 'react-window';

import { Gantt } from './gantt';
import { catColor, TraceTree, type TreeRow } from './tree';
import { fmtClockTime, fmtTokens, fmtUsd } from './format';
import {
  CATEGORY_LABEL,
  type BrainEvent,
  type BrainLogLine,
  type Run,
  type SpanCategory,
} from '@/brain/types';
import { cn } from '@/lib/utils';
import { useBrainStore } from '@/stores/brainStore';

function NewPill({ n, onJump }: { n: number; onJump: () => void }) {
  if (n <= 0) return null;
  return (
    <button
      type="button"
      onClick={onJump}
      className="bg-accent text-accent-contrast absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-[12px] font-medium shadow-lg"
    >
      {n} new
    </button>
  );
}

/* ── Timeline ─────────────────────────────────────────────────────────── */

export function TimelineTab({
  runId,
  run,
  rows,
  selectedSpanId,
  onSelect,
}: {
  runId: string;
  run: Run;
  rows: TreeRow[];
  selectedSpanId: string | null;
  onSelect: (id: string) => void;
}) {
  const toggleExpanded = useBrainStore((s) => s.toggleExpanded);
  const listRef = useRef<ListImperativeAPI | null>(null);
  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="border-border-subtle w-[200px] shrink-0 border-r">
        <TraceTree
          runId={runId}
          rows={rows}
          selectedSpanId={selectedSpanId}
          focusedRow={-1}
          runningSpanId={null}
          onSelect={onSelect}
          onToggle={(id) => toggleExpanded(runId, id)}
          listRef={listRef}
        />
      </div>
      <div className="min-w-0 flex-1">
        <Gantt
          runId={runId}
          run={run}
          rows={rows}
          selectedSpanId={selectedSpanId}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

/* ── Events ───────────────────────────────────────────────────────────── */

const EVENT_H = 40;

interface EventRowProps {
  events: BrainEvent[];
  index: number;
  style: React.CSSProperties;
  ariaAttributes: Record<string, unknown>;
}

function EventRow({ index, style, ariaAttributes, events }: EventRowProps) {
  const ev = events[index];
  if (!ev) return null;
  const color = ev.category ? catColor(ev.category) : 'var(--text-tertiary)';
  return (
    <div
      {...ariaAttributes}
      className="border-border-subtle flex items-start gap-2 border-b px-3"
      style={style}
    >
      <span className="text-text-tertiary mt-1 font-mono text-[11px] whitespace-nowrap">
        {fmtClockTime(ev.ts)}
      </span>
      <span
        aria-hidden="true"
        className="mt-[7px] size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-5">{ev.label}</span>
        {ev.detail && (
          <span className="text-text-tertiary block truncate font-mono text-[11px] leading-4">
            {ev.detail}
          </span>
        )}
      </span>
    </div>
  );
}

export function EventsTab({ runId }: { runId: string }) {
  const events = useBrainStore((s) => s.data[runId]?.events);
  const search = useBrainStore((s) => s.search.trim().toLowerCase());

  const [height, setHeight] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevLen = useRef(0);

  // Reverse-chronological (newest first) with search filter.
  const rows = useMemo(() => {
    const list = events ?? [];
    const filtered = search
      ? list.filter(
          (e) =>
            e.label.toLowerCase().includes(search) ||
            (e.detail ?? '').toLowerCase().includes(search)
        )
      : list;
    return filtered.reverse();
  }, [events, search]);

  // Track "new" arrivals while the user is scrolled away from the top.
  useEffect(() => {
    const len = (events ?? []).length;
    if (
      len > prevLen.current &&
      scrollRef.current &&
      scrollRef.current.scrollTop > 80
    ) {
      setNewCount((c) => c + (len - prevLen.current));
    }
    prevLen.current = len;
  }, [events]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const jumpTop = (): void => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setNewCount(0);
  };

  return (
    <div className="relative h-full min-h-0 min-w-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          if (e.currentTarget.scrollTop < 40) setNewCount(0);
        }}
        className="h-full overflow-y-auto"
        role="log"
        aria-label="Run events, newest first"
        aria-live="off"
      >
        {rows.length === 0 ? (
          <div className="text-text-tertiary flex h-full items-center justify-center text-[13px]">
            No events {search ? 'match the search' : 'yet'}
          </div>
        ) : (
          <List<{ events: BrainEvent[] }>
            rowComponent={EventRow}
            rowCount={rows.length}
            rowHeight={EVENT_H}
            rowKey={(i) => String(rows[i].id)}
            rowProps={{ events: rows }}
            overscanCount={6}
            style={{ height }}
          />
        )}
      </div>
      <NewPill n={newCount} onJump={jumpTop} />
      <span className="sr-only" aria-live="polite">
        {rows.length} events total
      </span>
    </div>
  );
}

/* ── Cost ─────────────────────────────────────────────────────────────── */

const COST_ORDER: SpanCategory[] = [
  'llm',
  'tool',
  'file',
  'network',
  'shell',
  'approval',
  'agent',
  'subagent',
  'user',
];

export function CostTab({ runId, run }: { runId: string; run: Run }) {
  const spans = useBrainStore((s) => s.data[runId]?.spans);
  const runActive = run.status === 'running' || run.status === 'waiting';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!runActive) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [runActive]);

  const { byCat, totalCost, totalTokens, avgTokSec, mostExpensive } =
    useMemo(() => {
      const byCat = new Map<
        SpanCategory,
        { cost: number; tokens: number; count: number }
      >();
      let totalCost = 0;
      let totalTokens = 0;
      let mostExpensive: { name: string; cost: number } | null = null;
      for (const sp of Object.values(spans ?? {})) {
        const c = sp.costUsd ?? 0;
        const t = (sp.tokensIn ?? 0) + (sp.tokensOut ?? 0);
        totalCost += c;
        totalTokens += t;
        const e = byCat.get(sp.category) ?? { cost: 0, tokens: 0, count: 0 };
        e.cost += c;
        e.tokens += t;
        e.count += 1;
        byCat.set(sp.category, e);
        if (c > (mostExpensive?.cost ?? 0))
          mostExpensive = { name: sp.name, cost: c };
      }
      const durSec = Math.max(
        1,
        (run.endedAt ? run.endedAt - run.startedAt : now - run.startedAt) / 1000
      );
      return {
        byCat,
        totalCost,
        totalTokens,
        avgTokSec: totalTokens / durSec,
        mostExpensive,
      };
    }, [spans, run, now]);

  const maxCatCost = Math.max(0.001, ...[...byCat.values()].map((v) => v.cost));

  const tiles = [
    { label: 'Total cost', value: fmtUsd(totalCost), accent: true },
    { label: 'Total tokens', value: fmtTokens(totalTokens) },
    { label: 'Avg tokens/sec', value: avgTokSec.toFixed(1) },
    {
      label: 'Most expensive span',
      value: mostExpensive
        ? `${mostExpensive.name} · ${fmtUsd(mostExpensive.cost)}`
        : '—',
      small: true,
    },
  ];

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-[720px]">
        {/* Totals tiles */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {tiles.map((t) => (
            <div
              key={t.label}
              className="border-border-subtle bg-bg-ink rounded-lg border p-3"
            >
              <div className="text-text-tertiary font-mono text-[10px] tracking-wide uppercase">
                {t.label}
              </div>
              <div
                className={cn(
                  'mt-1 truncate font-mono',
                  t.accent
                    ? 'text-accent text-[16px]'
                    : t.small
                      ? 'text-[12px]'
                      : 'text-[16px]'
                )}
                title={t.value}
              >
                {t.value}
              </div>
            </div>
          ))}
        </div>

        {/* Per-category bars (plain divs — no chart lib) */}
        <div className="border-border-subtle bg-bg-ink mt-3 rounded-lg border p-3">
          <div className="text-text-tertiary mb-3 font-mono text-[10px] tracking-wide uppercase">
            Cost by category
          </div>
          <div className="space-y-2.5">
            {COST_ORDER.filter((c) => byCat.has(c)).map((c) => {
              const v = byCat.get(c)!;
              return (
                <div key={c} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-right font-mono text-[11px]">
                    {CATEGORY_LABEL[c]}
                  </span>
                  <div className="bg-bg-raised h-3 min-w-0 flex-1 overflow-hidden rounded-sm">
                    <div
                      className="h-full rounded-sm transition-[width] duration-300"
                      style={{
                        width: `${Math.max(1.5, (v.cost / maxCatCost) * 100)}%`,
                        backgroundColor: catColor(c),
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 font-mono text-[11px]">
                    {fmtUsd(v.cost)}
                  </span>
                  <span className="text-text-tertiary w-24 shrink-0 font-mono text-[10px]">
                    {fmtTokens(v.tokens)} tok · {v.count} span
                    {v.count === 1 ? '' : 's'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-text-tertiary mt-3 text-[12px]">
          Run cost reflects the mock pricing table (gpt-4o $2.50/$10.00 per
          Mtok). Local models count as free.
        </div>
      </div>
    </div>
  );
}

/* ── Logs ─────────────────────────────────────────────────────────────── */

const LOG_H = 20;

/** Tiny ANSI-style colorizer: prompt lines accent, stderr red, system dim. */
function colorize(line: BrainLogLine): React.ReactNode {
  const t = line.text;
  if (
    line.stream === 'stderr' ||
    /\b(error|failed|exit [1-9]|not found|aborted)\b/i.test(t)
  ) {
    return <span className="text-danger">{t}</span>;
  }
  if (line.stream === 'system')
    return <span className="text-text-tertiary">{t}</span>;
  if (t.startsWith('$')) {
    return (
      <>
        <span className="text-accent">$</span>
        <span className="text-text-primary">{t.slice(1)}</span>
      </>
    );
  }
  if (/^\d{3} (OK|error|teapot|found)/i.test(t) || /^\d{3}\b/.test(t)) {
    const code = t.slice(0, 3);
    return (
      <>
        <span className={Number(code) < 400 ? 'text-success' : 'text-danger'}>
          {code}
        </span>
        <span className="text-text-secondary">{t.slice(3)}</span>
      </>
    );
  }
  return <span className="text-text-secondary">{t}</span>;
}

interface LogRowProps {
  logs: BrainLogLine[];
  index: number;
  style: React.CSSProperties;
  ariaAttributes: Record<string, unknown>;
}

function LogRow({ logs, index, style, ariaAttributes }: LogRowProps) {
  const line = logs[index];
  if (!line) return null;
  return (
    <div
      {...ariaAttributes}
      className="flex items-center gap-2 px-3"
      style={style}
    >
      <span className="text-text-tertiary shrink-0 font-mono text-[10px]">
        {fmtClockTime(line.ts)}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-5">
        {colorize(line)}
      </span>
    </div>
  );
}

export function LogsTab({ runId }: { runId: string }) {
  const logs = useBrainStore((s) => s.data[runId]?.logs);
  const [height, setHeight] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevLen = useRef(0);
  const stuckRef = useRef(true);

  const list = useMemo(() => logs ?? [], [logs]);

  // Terminal semantics: stick to the bottom (newest) unless the user scrolls up.
  useEffect(() => {
    const len = list.length;
    const el = scrollRef.current;
    if (len > prevLen.current) {
      if (stuckRef.current && el) {
        el.scrollTop = el.scrollHeight;
      } else {
        setNewCount((c) => c + (len - prevLen.current));
      }
    }
    prevLen.current = len;
  }, [list]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    el.scrollTop = el.scrollHeight;
    return () => ro.disconnect();
  }, []);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stuckRef.current = atBottom;
    if (atBottom) setNewCount(0);
  };

  return (
    <div className="bg-editor-bg relative h-full min-h-0 min-w-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto"
        role="log"
        aria-label="Run logs"
        aria-live="off"
      >
        {list.length === 0 ? (
          <div className="text-text-tertiary flex h-full items-center justify-center font-mono text-[12px]">
            No log output yet — shell, network and file spans emit logs.
          </div>
        ) : (
          <List<{ logs: BrainLogLine[] }>
            rowComponent={LogRow}
            rowCount={list.length}
            rowHeight={LOG_H}
            rowKey={(i) => String(list[i].id)}
            rowProps={{ logs: list }}
            overscanCount={10}
            style={{ height }}
          />
        )}
      </div>
      {newCount > 0 && (
        <button
          type="button"
          onClick={() => {
            const el = scrollRef.current;
            el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            setNewCount(0);
          }}
          className="bg-accent text-accent-contrast absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-[12px] font-medium shadow-lg"
        >
          {newCount} new lines
        </button>
      )}
    </div>
  );
}
