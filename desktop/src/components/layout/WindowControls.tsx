/*
 * Custom window controls for the main window.
 *
 *  - macOS: NOTHING. XR uses the native traffic lights.
 *
 *    This is a deliberate reversal (Phase 27 §E). Phase 1 shipped fake
 *    traffic-light dots in a frameless window; research says that is the one
 *    thing Mac users reliably hate. Apple's own guidance is blunt — "Don't
 *    draw your own chrome… don't try to replicate the system-provided
 *    appearance. Doing so without perfectly matching the system's look and
 *    behavior can make your app feel broken" — and the Human Interface
 *    Guidelines are explicit that the close/minimize/zoom buttons "must remain
 *    in the top-left corner" and must never be hidden or repositioned.
 *
 *    So `tauri.conf.json` now sets `decorations: true` +
 *    `titleBarStyle: "Overlay"` + `hiddenTitle: true` and a
 *    `trafficLightPosition` of (20, 20). The lights are real: correct colours,
 *    correct hover glyphs, correct ⌥/⌘ modifiers, correct fullscreen
 *    behaviour, and they work when the window is unfocused. The topbar adds
 *    left padding (see AppShell) so content never slides under them.
 *
 *  - Windows/Linux: 46px-tall caption buttons flush to the right edge. These
 *    platforms have no equivalent native overlay for a custom title bar, and
 *    the window is genuinely frameless there (set at runtime in
 *    `apply_platform_chrome`, not in the config, so the macOS window is built
 *    decorated and never flashes).
 *
 *  - Browser preview: not rendered (nothing to control).
 *
 * Research notes: docs/macos/WINDOW-CHROME.md.
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
  // macOS keeps the system's own traffic lights — see the header comment.
  return platform === 'macos' ? null : <WindowsControls />;
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
