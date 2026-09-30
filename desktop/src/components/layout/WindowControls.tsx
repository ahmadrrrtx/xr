import { Minus, Square, X } from 'lucide-react';

import {
  closeWindow,
  isTauri,
  minimizeWindow,
  toggleMaximize,
} from '@/lib/tauri';
import type { Platform } from '@/lib/tauri';
import { cn } from '@/lib/utils';

/**
 * Custom window controls for the frameless main window.
 *
 *  - macOS: traffic-light dots (12px) at the top-left, 20px from the edge,
 *    vertically centered in the 52px topbar (per Phase 0 brief).
 *  - Windows/Linux: minimize / maximize / close cluster on the right, 40px tall.
 *  - Browser preview: not rendered (nothing to control).
 */
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
    <div className="absolute top-0 right-4 z-10 flex h-[52px] items-stretch">
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
        'text-text-secondary flex h-10 w-11 items-center justify-center rounded-md',
        danger
          ? 'hover:bg-danger hover:text-danger-contrast'
          : 'hover:bg-bg-raised hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}
