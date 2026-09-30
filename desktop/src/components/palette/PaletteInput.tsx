/*
 * Palette input row (Phase 5) — 56px: brand mark left (Logo in command mode,
 * Avatar while quick-asking), the cmdk input, ESC badge right.
 *
 * In the HUD context the row is also the window drag handle: Tauri's
 * data-tauri-drag-region only fires when the attribute element itself is the
 * mousedown target, so clicks on the input still place the caret while clicks
 * on the row's padding move the window. A pointerdown fallback covers the
 * logo/badge children explicitly.
 */
import { useRef } from 'react';
import { Command } from 'cmdk';

import { Avatar } from '@/components/brand/Avatar';
import { Logo } from '@/components/brand/Logo';
import { usePaletteStore } from '@/stores/paletteStore';
import { cn } from '@/lib/utils';

interface PaletteInputProps {
  isHud: boolean;
}

export function PaletteInput({ isHud }: PaletteInputProps) {
  const query = usePaletteStore((s) => s.query);
  const setQuery = usePaletteStore((s) => s.setQuery);
  const mode = usePaletteStore((s) => s.mode);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const startWindowDrag = (target: EventTarget | null): void => {
    if (!isHud) return;
    // Drag only when the press is on the chrome (row, logo, badge) — never
    // the input itself, or caret placement would fight the window move.
    if (target === inputRef.current) return;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().startDragging();
      } catch {
        /* browser preview / permission gap — no-op */
      }
    })();
  };

  return (
    <div
      data-tauri-drag-region={isHud ? '' : undefined}
      onPointerDown={(e) => startWindowDrag(e.target)}
      className={cn(
        'flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle px-4',
        isHud && 'cursor-default'
      )}
    >
      {mode === 'quick-ask' ? (
        <Avatar size="sm" variant="head" state="thinking" className="shrink-0" aria-hidden="true" />
      ) : (
        <Logo variant="icon" size={24} className="shrink-0" aria-hidden="true" />
      )}
      <Command.Input
        ref={inputRef}
        // The HUD window has no Radix dialog to focus its first control —
        // the input IS the palette, so it takes focus on mount (hud:show
        // re-focuses it on every subsequent show; see usePaletteIpc).
        autoFocus={isHud}
        value={query}
        onValueChange={setQuery}
        placeholder="Ask XR anything, or type a command..."
        aria-label="Ask XR anything, or type a command"
        className="placeholder:text-text-secondary text-text-primary h-full w-full bg-transparent text-[18px] leading-none outline-none"
      />
      <kbd
        aria-hidden="true"
        className="xr-kbd text-text-tertiary shrink-0 font-mono text-[11px]"
      >
        esc
      </kbd>
    </div>
  );
}
