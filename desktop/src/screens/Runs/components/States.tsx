/*
 * Loading / empty / error states (Phase 11, brief §4.5).
 */
import { AlertTriangle, MessageCircle, Play, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { demoRunIsReal } from '@/brain/demo';
import { useRunsStore } from '@/stores/runsStore';

import { GRID, ROW_HEIGHT } from './RunsTable';

/** 12 shimmer rows laid out on the real grid so the swap is seamless. */
export function RunsSkeleton() {
  const widths = [
    'w-4',
    'w-10',
    'w-3/4',
    'w-16',
    'w-20',
    'w-24',
    'w-12',
    'w-10',
    'w-16',
    'w-10',
    'w-12',
  ];
  return (
    <div
      className="min-w-[1040px]"
      aria-busy="true"
      aria-label="Loading runs"
      data-testid="runs-skeleton"
    >
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className={cn(GRID, 'border-border-subtle border-b px-3')}
          style={{ height: ROW_HEIGHT, opacity: 1 - i * 0.06 }}
        >
          {widths.map((w, j) => (
            <div
              key={j}
              className={cn('flex', j >= 7 && j <= 9 && 'justify-end')}
            >
              <div className={cn('run-shimmer h-3 rounded', w)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyFiltered() {
  return (
    <div
      className="text-text-tertiary flex h-full min-h-[240px] flex-col items-center justify-center gap-3 px-6 text-center"
      data-testid="runs-empty-filtered"
    >
      <Search
        className="size-6 opacity-60"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <p className="text-text-secondary text-[13px]">
        No runs match these filters.
      </p>
      <button
        type="button"
        onClick={() => useRunsStore.getState().clearFilters()}
        className="border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised h-8 cursor-pointer rounded-lg border px-3 text-[12px] transition-colors"
      >
        Clear filters
      </button>
    </div>
  );
}

export function EmptyFresh() {
  const navigate = useNavigate();
  return (
    <div
      className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 px-6 text-center"
      data-testid="runs-empty"
    >
      <EmptyArt />
      <div className="space-y-1">
        <p className="text-text-primary text-[15px] font-medium">No runs yet</p>
        <p className="text-text-tertiary max-w-[360px] text-[13px]">
          Runs will appear here once agents start working. Start a chat to see
          your first run.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/chat')}
          className="bg-accent text-accent-contrast flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-opacity hover:opacity-90"
        >
          <MessageCircle
            className="size-4"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          Go to Chat
        </button>
        <button
          type="button"
          data-testid="runs-demo"
          onClick={() => {
            const id = useRunsStore.getState().startDemoRun();
            toast(demoRunIsReal() ? 'Run started' : 'Demo run started', {
              description: demoRunIsReal()
                ? 'A real agent turn on the engine. Watch it live here, or open the trace.'
                : 'No model configured — this is a canned trace. Watch it live here, or open it.',
              action: {
                label: 'View trace',
                onClick: () => navigate(`/brain/${id}`),
              },
            });
          }}
          className="border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors"
        >
          <Play className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          Start a demo run
        </button>
      </div>
    </div>
  );
}

/** Three quiet grid lines + a dot: "nothing on the board yet". */
function EmptyArt() {
  return (
    <svg
      width="96"
      height="56"
      viewBox="0 0 96 56"
      aria-hidden="true"
      className="opacity-70"
    >
      {[12, 26, 40].map((y) => (
        <rect
          key={y}
          x="8"
          y={y}
          width="80"
          height="4"
          rx="2"
          fill="var(--border-default)"
        />
      ))}
      <circle
        cx="14"
        cy="14"
        r="3"
        fill="var(--accent)"
        className="xr-dot-pulse"
      />
    </svg>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border-danger/30 bg-danger/10 text-text-primary mx-4 mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]"
      data-testid="runs-error"
    >
      <AlertTriangle
        className="text-danger size-4 shrink-0"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <button
        type="button"
        onClick={() => useRunsStore.getState().reseed('default')}
        className="text-text-secondary hover:text-text-primary cursor-pointer text-[12px] underline-offset-2 hover:underline"
      >
        Retry
      </button>
    </div>
  );
}
