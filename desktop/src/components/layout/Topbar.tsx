/*
 * Topbar — the permanent 52px chrome (docs/SCREEN-BRIEFS.md · GLOBAL
 * APPLICATION SHELL · Phase 1 brief §5.3). Doubles as the frameless window's
 * drag region. Left: screen title (inset for macOS traffic lights). Center:
 * the command-palette trigger pill. Right: wallet, mic, bell, avatar —
 * with clearance for the Windows/Linux window-control cluster.
 */
import { Search } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { ActivityDot } from '@/components/layout/ActivityDot';
import { MicButton } from '@/components/layout/MicButton';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { UserMenu } from '@/components/layout/UserMenu';
import { WalletWidget } from '@/components/layout/WalletWidget';
import { WindowControls } from '@/components/layout/WindowControls';
import { usePlatform } from '@/hooks/usePlatform';
import { NAV_ITEMS } from '@/lib/nav';
import { isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { usePaletteStore } from '@/stores/paletteStore';
import { useBrainStore } from '@/stores/brainStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * Resolve the current screen's display name from the route. Brain appends
 * the open run's short id ("Brain · #847") so the breadcrumb tracks the
 * active trace (Phase 9).
 */
function useScreenTitle(): string {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  const segment = segments[0] ?? 'chat';
  const runId = segment === 'brain' ? segments[1] : undefined;
  const shortId = useBrainStore((s) =>
    runId ? s.runs[runId]?.shortId : undefined
  );
  const wsId = segment === 'workspaces' ? segments[1] : undefined;
  const wsName = useWorkspaceStore((s) =>
    wsId ? s.workspaces.find((w) => w.id === wsId)?.name : undefined
  );
  const match = NAV_ITEMS.find((item) => item.id === segment);
  const label = match?.label ?? 'XR';
  if (segment === 'brain' && runId) {
    return shortId ? `${label} · ${shortId}` : `${label} · ${runId}`;
  }
  if (segment === 'workspaces' && wsId) {
    return wsName ? `${label} · ${wsName}` : label;
  }
  return label;
}

/** The centered command-palette trigger pill (opens cmdk). */
function CommandTrigger() {
  const openPalette = usePaletteStore((s) => s.openPalette);
  const platform = usePlatform();
  const hint = platform === 'macos' ? '⌘K' : 'Ctrl K';

  return (
    <button
      type="button"
      aria-label="Open command palette"
      aria-keyshortcuts="Meta+K Control+K"
      title="Command palette (⌘K)"
      onClick={() => openPalette()}
      className={cn(
        'bg-bg-ink border-border-default hover:border-accent/60 focus-visible:border-accent focus-visible:ring-accent/30',
        'flex h-9 w-full max-w-[480px] flex-1 items-center gap-2.5 rounded-full border px-3',
        'transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none'
      )}
    >
      <Search
        size={16}
        strokeWidth={1.5}
        aria-hidden="true"
        className="text-text-tertiary shrink-0"
      />
      <span className="text-text-secondary truncate text-left text-[14px]">
        Type a command or ask XR...
      </span>
      <span
        aria-hidden="true"
        className="bg-bg-raised text-text-tertiary ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] leading-none"
      >
        {hint}
      </span>
    </button>
  );
}

export function Topbar() {
  const title = useScreenTitle();
  const platform = usePlatform();

  // Windows/Linux: the window-control cluster occupies the far right (~138px).
  const controlsOnRight = isTauri() && platform !== 'macos';

  return (
    <header
      data-tauri-drag-region
      className="bg-bg-void border-border-subtle relative z-40 flex h-[52px] shrink-0 items-center gap-3 border-b px-4"
    >
      <WindowControls platform={platform} />

      {/* Screen title — macOS leaves room for the traffic lights */}
      <h1
        className={cn(
          'text-text-primary min-w-[120px] truncate text-[18px] leading-none font-semibold',
          platform === 'macos' ? 'ml-[68px]' : 'ml-2'
        )}
      >
        {title}
      </h1>

      {/* Centered palette trigger */}
      <div className="mx-auto flex min-w-0 flex-1 justify-center px-4">
        <CommandTrigger />
      </div>

      {/* Right actions */}
      <div
        className={cn(
          'flex items-center gap-1',
          controlsOnRight && 'mr-[138px]'
        )}
      >
        <WalletWidget />
        <MicButton />
        <ActivityDot />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
