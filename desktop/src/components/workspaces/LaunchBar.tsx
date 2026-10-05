/*
 * Phase 10 — glass launch bar (multi-select mode).
 *
 * Slides up over the bottom of the screen: "N selected" · select-all ·
 * Rocket "Launch N windows" · Esc exits. In dev (browser) the store shows an
 * honest toast that real windows need the app shell.
 */
import { CheckCheck, Rocket, X } from 'lucide-react';

import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/tauri';

interface Props {
  count: number;
  totalCount: number;
  launching: boolean;
  onLaunch: () => void;
  onSelectAll: () => void;
  onExit: () => void;
}

export function LaunchBar({
  count,
  totalCount,
  launching,
  onLaunch,
  onSelectAll,
  onExit,
}: Props) {
  return (
    <div
      data-testid="launch-bar"
      role="region"
      aria-label="Launch selected workspaces"
      className={cn(
        'xr-glass absolute inset-x-4 bottom-4 z-30 flex items-center gap-3 rounded-xl px-4 py-3',
        'transition-transform duration-200 ease-out'
      )}
    >
      <span className="text-[13px] font-medium">
        {count} selected
        <span className="text-text-tertiary font-normal"> of {totalCount}</span>
      </span>

      <button
        type="button"
        onClick={onSelectAll}
        className="hover:bg-bg-raised text-text-secondary hover:text-text-primary ml-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors"
      >
        <CheckCheck className="size-3.5" strokeWidth={1.5} />
        All
      </button>

      <span className="text-text-tertiary ml-auto hidden items-center gap-1.5 text-[11px] sm:flex">
        <Kbd>esc</Kbd> exit
      </span>

      <button
        type="button"
        onClick={onExit}
        aria-label="Exit multi-select"
        className="hover:bg-bg-raised text-text-tertiary hover:text-text-primary flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors"
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>

      <button
        type="button"
        data-testid="launch-btn"
        disabled={count === 0 || launching}
        onClick={onLaunch}
        className={cn(
          'bg-accent text-accent-contrast flex h-8 cursor-pointer items-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-all',
          'disabled:cursor-not-allowed disabled:opacity-40'
        )}
      >
        <Rocket className="size-4" strokeWidth={1.5} />
        Launch {count > 1 ? `${count} windows` : 'window'}
        {!isTauri() && (
          <span className="text-[10px] font-normal opacity-70">(dev)</span>
        )}
      </button>
    </div>
  );
}
