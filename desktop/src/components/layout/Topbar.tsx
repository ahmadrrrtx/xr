import { Bell, Mic, Wallet } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { NAV_ITEMS } from '@/lib/nav';
import { WindowControls } from '@/components/layout/WindowControls';
import { usePlatform } from '@/hooks/usePlatform';
import { cn } from '@/lib/utils';

/** Resolve the current screen's display name from the route. */
function useScreenTitle(): string {
  const { pathname } = useLocation();
  const segment = pathname.split('/').filter(Boolean)[0] ?? 'chat';
  const match = NAV_ITEMS.find((item) => item.id === segment);
  return match?.label ?? 'XR';
}

interface TopbarButtonProps {
  label: string;
  children: React.ReactNode;
}

function TopbarButton({ label, children }: TopbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex h-8 w-8 items-center justify-center rounded-md"
    >
      {children}
    </button>
  );
}

/**
 * Placeholder topbar (52px) — doubles as the custom titlebar drag region.
 * Phase 1 ships the command-palette pill, wallet widget and notifications.
 */
export function Topbar() {
  const title = useScreenTitle();
  const platform = usePlatform();

  return (
    <header
      data-tauri-drag-region
      className="border-border-subtle bg-bg-void relative flex h-[52px] shrink-0 items-center border-b pr-4"
    >
      {/* Window controls (native shell only): macOS traffic lights inset the
          title; Windows/Linux keep the title flush-left with controls right. */}
      <WindowControls platform={platform} />

      <h1
        className={cn(
          'text-text-primary truncate text-lg font-semibold',
          platform === 'macos' ? 'ml-[84px]' : 'ml-6'
        )}
      >
        {title}
      </h1>

      <div className="ml-auto flex items-center gap-1">
        <TopbarButton label="Wallet and budget">
          <Wallet size={16} strokeWidth={1.5} aria-hidden="true" />
        </TopbarButton>
        <TopbarButton label="Voice">
          <Mic size={16} strokeWidth={1.5} aria-hidden="true" />
        </TopbarButton>
        <TopbarButton label="Notifications">
          <Bell size={16} strokeWidth={1.5} aria-hidden="true" />
        </TopbarButton>

        {/* Avatar placeholder — sentinel head lands in Phase 2. */}
        <div
          aria-label="XR avatar"
          title="XR"
          className="border-border-subtle bg-bg-ink ml-2 flex h-7 w-7 items-center justify-center rounded-full border"
        >
          <span className="bg-accent h-1.5 w-1.5 rounded-full" />
        </div>
      </div>
    </header>
  );
}
