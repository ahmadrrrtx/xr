/*
 * Custom window controls for the frameless main window.
 *
 *  - macOS: traffic-light dots (12px, 8px apart, 20px from the left edge),
 *    vertically centered in the 52px topbar (docs/SCREEN-BRIEFS.md).
 *  - Windows/Linux: 46px-tall caption buttons flush to the right edge
 *    (minimize / maximize / close, Windows style — Phase 1 brief §5.3).
 *  - Browser preview: not rendered (nothing to control).
 */
import { Minus, Square, X } from 'lucide-react';

import {
  closeWindow,
  isTauri,
  minimizeWindow,
  toggleMaximize,
} from '@/lib/tauri';
import type { Platform } from '@/lib/tauri';
import { cn } from '@/lib/utils';

export function WindowControls({ platform }: { platform: Platform }) {
  if (!isTauri()) return null;
  return platform === 'macos' ? <MacTrafficLights /> : <WindowsControls />;
}

function MacTrafficLights() {
  return (
    <div
      data-tauri-drag-region
      className="absolute top-0 left-5 z-10 flex h-[52px] items-center gap-2"
    >
      <TrafficLight
        color="bg-traffic-red hover:bg-traffic-red-hover"
        label="Close window"
        onClick={() => void closeWindow()}
      />
      <TrafficLight
        color="bg-traffic-yellow hover:bg-traffic-yellow-hover"
        label="Minimize window"
        onClick={() => void minimizeWindow()}
      />
      <TrafficLight
        color="bg-traffic-green hover:bg-traffic-green-hover"
        label="Toggle maximize"
        onClick={() => void toggleMaximize()}
      />
    </div>
  );
}

function TrafficLight({
  color,
  label,
  onClick,
}: {
  color: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn('h-3 w-3 rounded-full', color)}
    />
  );
}

function WindowsControls() {
  return (
    <div className="absolute top-0 right-0 z-10 flex h-[52px] items-center">
      <WinButton label="Minimize window" onClick={() => void minimizeWindow()}>
        <Minus size={14} strokeWidth={1.5} aria-hidden="true" />
      </WinButton>
      <WinButton label="Toggle maximize" onClick={() => void toggleMaximize()}>
        <Square size={12} strokeWidth={1.5} aria-hidden="true" />
      </WinButton>
      <WinButton label="Close window" onClick={() => void closeWindow()} danger>
        <X size={15} strokeWidth={1.5} aria-hidden="true" />
      </WinButton>
    </div>
  );
}

function WinButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'text-text-secondary flex h-[46px] w-[46px] items-center justify-center transition-colors duration-150 ease-out',
        danger
          ? 'hover:bg-danger hover:text-danger-contrast'
          : 'hover:bg-bg-raised hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}
