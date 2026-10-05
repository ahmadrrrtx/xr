/*
 * Stats bar + surface chips (Phase 11, brief §4.3 / §4.2).
 * Five tiles, 28px numerals that tween on change; the Failed tile is a
 * button that jumps to the Failed tab. Surface chips slide in only while
 * something is running (160 ms) and don't take space otherwise.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  Globe,
  Hammer,
  MessageCircle,
  Mic,
  Moon,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

import { fmtTokens, fmtUsd } from '@/brain/format';
import type { RunSurface } from '@/brain/types';
import { cn } from '@/lib/utils';
import { SURFACES, type RunStats, type SurfaceCounts } from '@/runs/core';
import { useRunsStore } from '@/stores/runsStore';

import { useTween } from '../useTween';

const SURFACE_ICON: Record<RunSurface, LucideIcon> = {
  chat: MessageCircle,
  builder: Hammer,
  research: Globe,
  voice: Mic,
  background: Moon,
  cli: Terminal,
};
const SURFACE_LABEL: Record<RunSurface, string> = {
  chat: 'Chat',
  builder: 'Builder',
  research: 'Research',
  voice: 'Voice',
  background: 'Background',
  cli: 'CLI',
};

export function SurfaceChips({
  counts,
  show,
}: {
  counts: SurfaceCounts;
  show: boolean;
}) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="surfaces"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="overflow-hidden"
          data-testid="runs-surfaces"
        >
          <div className="flex items-center gap-1.5 px-4 pt-3">
            <span className="text-text-tertiary mr-1 text-[11px] tracking-wide uppercase">
              Active
            </span>
            {SURFACES.map((s) => {
              const Icon = SURFACE_ICON[s];
              const n = counts[s];
              return (
                <span
                  key={s}
                  className={cn(
                    'flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px]',
                    n > 0
                      ? 'border-border-accent text-accent bg-accent/10'
                      : 'border-border-subtle text-text-tertiary'
                  )}
                >
                  <Icon
                    className="size-3"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  {SURFACE_LABEL[s]}
                  <span className="font-mono tabular-nums">{n}</span>
                </span>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function StatsBar({ stats }: { stats: RunStats }) {
  const runsToday = useTween(stats.runsToday);
  const tokensToday = useTween(stats.tokensToday);
  const costToday = useTween(stats.costToday);
  const running = useTween(stats.runningCount, 200);
  const failed = useTween(stats.failed24h);

  return (
    <div
      className="grid shrink-0 grid-cols-2 gap-2 px-4 pt-3 md:grid-cols-5"
      data-testid="runs-stats"
      aria-label="Today at a glance"
      role="group"
    >
      <Tile label="Runs today" value={Math.round(runsToday).toLocaleString()} />
      <Tile label="Tokens today" value={fmtTokens(Math.round(tokensToday))} />
      <Tile
        label="Cost today"
        value={stats.costToday > 0 ? fmtUsd(costToday) : '$0'}
        accent={stats.costToday > 0}
      />
      <Tile
        label="Running"
        value={Math.round(running).toString()}
        accent={stats.runningCount > 0}
        pulse={stats.runningCount > 0}
      />
      <Tile
        label="Failed · 24h"
        value={Math.round(failed).toString()}
        danger={stats.failed24h > 0}
        onClick={() => useRunsStore.getState().setStatusFilter('failed')}
        hint="Show failed runs"
      />
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
  danger,
  pulse,
  onClick,
  hint,
}: {
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
  pulse?: boolean;
  onClick?: () => void;
  hint?: string;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={hint}
      data-testid={`stat-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      className={cn(
        'border-border-subtle bg-bg-ink flex h-[68px] flex-col justify-center rounded-lg border px-3 text-left',
        onClick &&
          'hover:border-border-default hover:bg-bg-raised focus-visible:border-border-accent cursor-pointer transition-colors outline-none'
      )}
    >
      <span className="text-text-tertiary flex items-center gap-1.5 text-[11px] tracking-wide uppercase">
        {pulse && (
          <span
            aria-hidden="true"
            className="xr-dot-pulse bg-accent inline-block size-1.5 rounded-full"
          />
        )}
        {label}
      </span>
      <span
        className={cn(
          'mt-0.5 font-mono text-[28px] leading-none font-medium tabular-nums',
          danger ? 'text-danger' : accent ? 'text-accent' : 'text-text-primary'
        )}
      >
        {value}
      </span>
    </Comp>
  );
}
